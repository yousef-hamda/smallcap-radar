/** Cloudflare Worker entry point for the vinext-starter template. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import webpush from "web-push";
import { processScanBatch, startScan } from "../lib/scanner";
import { db, ensureSchema, log } from "../lib/storage";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  BACKGROUND_SCAN_SECRET: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) throw Object.assign(new Error("طلب غير مسموح"), { status: 403 });
}

async function sendCompletionPush(env: Env, run: any) {
  await ensureSchema();
  if (run.notification_sent_at) return true;
  const sentAt = new Date().toISOString();
  const subscriptions = (await db().prepare("SELECT endpoint,subscription,failure_count,last_success_at FROM push_subscriptions").all()).results as any[];
  if (!subscriptions.length) {
    await db().prepare("UPDATE strategy_runs SET notification_sent_at=? WHERE id=? AND notification_sent_at IS NULL").bind(sentAt, run.id).run();
    return true;
  }
  webpush.setVapidDetails("mailto:yousef-hamda@users.noreply.github.com", env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  const payload = JSON.stringify({
    title: run.status === "complete" ? "اكتمل فحص السوق" : "انتهى فحص السوق",
    body: `تمت معالجة ${Number(run.processed || 0).toLocaleString("en-US")} من ${Number(run.total || 0).toLocaleString("en-US")} سهم${run.failed ? `، وتعذّر ${run.failed}` : " دون أخطاء"}.`,
    url: "/",
  });
  let retryNeeded = false;
  await Promise.all(subscriptions.filter((row) => !row.last_success_at || row.last_success_at < run.updated_at).map(async (row) => {
    try {
      const subscription = JSON.parse(row.subscription);
      const details = webpush.generateRequestDetails(subscription, payload, { TTL: 86_400, urgency: "normal" });
      const pushBody = typeof details.body === "string" ? details.body : new Uint8Array(details.body);
      const response = await fetch(details.endpoint, { method: details.method, headers: details.headers, body: pushBody });
      if (!response.ok) throw Object.assign(new Error(`Push HTTP ${response.status}`), { statusCode: response.status });
      await db().prepare("UPDATE push_subscriptions SET last_success_at=?,failure_count=0 WHERE endpoint=?").bind(sentAt, row.endpoint).run();
    } catch (error: any) {
      if ([404, 410].includes(error.statusCode)) await db().prepare("DELETE FROM push_subscriptions WHERE endpoint=?").bind(row.endpoint).run();
      else {
        await db().prepare("UPDATE push_subscriptions SET failure_count=failure_count+1 WHERE endpoint=?").bind(row.endpoint).run();
        if (Number(row.failure_count || 0) < 2) retryNeeded = true;
      }
    }
  }));
  if (retryNeeded) return false;
  await db().prepare("UPDATE strategy_runs SET notification_sent_at=? WHERE id=? AND notification_sent_at IS NULL").bind(sentAt, run.id).run();
  return true;
}

async function scheduleNext(request: Request, runId: string, env: Env) {
  const target = new URL("/__radar-background", request.url);
  const cookie = request.headers.get("Cookie");
  for (let attempt = 0; attempt < 3; attempt++) {
    const headers: Record<string, string> = { "X-Radar-Background": env.BACKGROUND_SCAN_SECRET, "Content-Type": "application/json" };
    // Private Sites authenticate before the Worker runs. Preserve the owner's
    // session on the internal baton so the next batch reaches this Worker.
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(target, { method: "POST", headers, body: JSON.stringify({ runId }) });
    if (response.ok) return;
    await log(runId, "background", `Background baton attempt ${attempt + 1}: HTTP ${response.status}`);
    await delay(400 * (attempt + 1));
  }
  await log(runId, "background", "تعذّر تمرير مهمة الفحص إلى الدفعة التالية بعد ثلاث محاولات.");
}

async function runBackgroundBatch(request: Request, runId: string, env: Env) {
  try {
    const result = await processScanBatch(runId);
    if (result.busy) return;
    if (result.done) {
      const delivered = await sendCompletionPush(env, result.run);
      if (!delivered) { await delay(1_000); await scheduleNext(request, runId, env) }
    } else await scheduleNext(request, runId, env);
  } catch (error) {
    await log(runId, "background", error instanceof Error ? error.message : "خطأ في المهمة الخلفية").catch(() => {});
    await delay(1_000);
    await scheduleNext(request, runId, env).catch(() => {});
  }
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/push/key" && request.method === "GET") return json({ publicKey: env.VAPID_PUBLIC_KEY });

    if (url.pathname === "/api/push/subscribe" && request.method === "POST") {
      try {
        sameOrigin(request);
        await ensureSchema();
        const subscription = await request.json() as any;
        if (!subscription?.endpoint?.startsWith("https://") || !subscription?.keys?.p256dh || !subscription?.keys?.auth) return json({ error: "اشتراك الإشعارات غير صالح" }, 400);
        await db().prepare("INSERT OR REPLACE INTO push_subscriptions(endpoint,subscription,created_at,last_success_at,failure_count) VALUES(?,?,?,COALESCE((SELECT last_success_at FROM push_subscriptions WHERE endpoint=?),NULL),0)").bind(subscription.endpoint, JSON.stringify(subscription), new Date().toISOString(), subscription.endpoint).run();
        return json({ subscribed: true });
      } catch (error: any) { return json({ error: error.message || "تعذّر تفعيل الإشعارات" }, error.status || 500) }
    }

    if (url.pathname === "/api/push/test" && request.method === "POST") {
      try {
        sameOrigin(request);
        await ensureSchema();
        const input = await request.json() as any;
        if (typeof input?.endpoint !== "string") return json({ error: "اشتراك غير صالح" }, 400);
        const row = await db().prepare("SELECT subscription FROM push_subscriptions WHERE endpoint=?").bind(input.endpoint).first() as any;
        if (!row) return json({ error: "هذا الجهاز غير مسجل للإشعارات" }, 404);
        webpush.setVapidDetails("mailto:yousef-hamda@users.noreply.github.com", env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
        const payload = JSON.stringify({ title: "إشعارات رادار جاهزة", body: "تم ربط هذا الهاتف بنجاح. سنرسل لك تنبيهًا عند اكتمال الفحص.", url: "/" });
        const subscription = JSON.parse(row.subscription);
        const details = webpush.generateRequestDetails(subscription, payload, { TTL: 300, urgency: "high" });
        const pushBody = typeof details.body === "string" ? details.body : new Uint8Array(details.body);
        const response = await fetch(details.endpoint, { method: details.method, headers: details.headers, body: pushBody });
        if (!response.ok) throw Error(`Push HTTP ${response.status}`);
        return json({ sent: true });
      } catch (error: any) { return json({ error: error.message || "تعذّر إرسال إشعار الاختبار" }, 503) }
    }

    if (url.pathname === "/api/background-scan/start" && request.method === "POST") {
      try {
        sameOrigin(request);
        const input = await request.json() as any;
        const run = await startScan(input.mode);
        ctx.waitUntil(runBackgroundBatch(request, run.id, env));
        return json({ run, background: true }, 202);
      } catch (error: any) { return json({ error: error.message || "تعذّر بدء الفحص" }, error.status || 503) }
    }

    if (url.pathname === "/__radar-background" && request.method === "POST") {
      if (request.headers.get("X-Radar-Background") !== env.BACKGROUND_SCAN_SECRET) return json({ error: "غير مصرح" }, 401);
      const input = await request.json() as any;
      if (typeof input.runId !== "string") return json({ error: "معرّف غير صالح" }, 400);
      ctx.waitUntil(runBackgroundBatch(request, input.runId, env));
      return json({ accepted: true }, 202);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
