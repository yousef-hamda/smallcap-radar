/** Cloudflare Worker entry point for the vinext-starter template. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import webpush from "web-push";
import { processScanBatch, startScan } from "../lib/scanner";
import { db, ensureSchema, log } from "../lib/storage";
import { body, sameOrigin, secureResponse, statusOf } from "../lib/http";
import { visitor } from "../lib/visitor";
import { validPushSubscription } from "../lib/push-validation";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  BACKGROUND_SCAN_SECRET?: string;
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

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options":"nosniff", "X-Frame-Options":"DENY", "Referrer-Policy":"strict-origin-when-cross-origin", "Permissions-Policy":"camera=(), microphone=(), geolocation=(), payment=()" } });
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const BATON_START_DELAY = 750;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pushConfigured=(env:Env)=>Boolean(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY);
function sameSecret(actual:string|null,expected:string){
 if(actual==null||actual.length!==expected.length)return false;
 let difference=0;for(let index=0;index<expected.length;index++)difference|=actual.charCodeAt(index)^expected.charCodeAt(index);
 return difference===0;
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
  if(!pushConfigured(env)){
    await log(run.id,"push","VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY is not configured; completion push skipped.");
    await db().prepare("UPDATE strategy_runs SET notification_sent_at=? WHERE id=? AND notification_sent_at IS NULL").bind(sentAt,run.id).run();
    return true;
  }
  webpush.setVapidDetails("mailto:yousef-hamda@users.noreply.github.com", env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
  const payload = JSON.stringify({
    title: run.status === "complete" ? "اكتمل فحص السوق" : "انتهى فحص السوق",
    body: `تمت معالجة ${Number(run.processed || 0).toLocaleString("en-US")} من ${Number(run.total || 0).toLocaleString("en-US")} سهم${run.failed ? `، وتعذّر ${run.failed}` : " دون أخطاء"}.`,
    url: "/",
  });
  let retryNeeded = false;
  await Promise.all(subscriptions.filter((row) => !row.last_success_at || row.last_success_at < run.updated_at).map(async (row) => {
    try {
      const subscription = JSON.parse(row.subscription);
      if(!validPushSubscription(subscription))throw Object.assign(Error('Invalid stored push subscription'),{statusCode:410});
      const details = webpush.generateRequestDetails(subscription, payload, { TTL: 86_400, urgency: "normal" });
      const pushBody = typeof details.body === "string" ? details.body : new Uint8Array(details.body);
      const response = await fetch(details.endpoint, { method: details.method, headers: details.headers, body: pushBody,redirect:'error',signal:AbortSignal.timeout(8000) });
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

async function scheduleNext(request: Request, runId: string, env: Env): Promise<boolean> {
  const target = new URL("/__radar-background", request.url);
  const cookie = request.headers.get("Cookie");
  const batonSecret = env.BACKGROUND_SCAN_SECRET;
  if (!batonSecret) {
    await log(runId, "background", "BACKGROUND_SCAN_SECRET غير مضبوط؛ أوقفنا baton بدل إعادة المحاولة بلا حماية.");
    return false;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const headers: Record<string, string> = { "X-Radar-Background": batonSecret, "Content-Type": "application/json" };
    // Private Sites authenticate before the Worker runs. Preserve the owner's
    // session on the internal baton so the next batch reaches this Worker.
    if (cookie) headers.Cookie = cookie;
    try {
      const response = await fetch(target, { method: "POST", headers, body: JSON.stringify({ runId }),signal:AbortSignal.timeout(5000) });
      const contentType=response.headers.get('content-type')||'';
      const payload=contentType.includes('application/json')?await response.json().catch(()=>null):null;
      if (response.ok && (payload as any)?.accepted===true) return true;
      await log(runId, "background", `Background baton attempt ${attempt + 1}: HTTP ${response.status}`);
    }catch(error){await log(runId,'background',`Baton attempt ${attempt+1}: ${error instanceof Error?error.message:'network failure'}`);}
    await delay(400 * (attempt + 1));
  }
  await log(runId, "background", "تعذّر تمرير مهمة الفحص إلى الدفعة التالية بعد ثلاث محاولات.");
  return false;
}

async function continueAfterBatonFailure(request: Request, runId: string, env: Env, directHops: number) {
  // Sites may reject a worker-to-worker self-request at the edge (401 or an
  // HTML fallback page). Do not abandon the durable cursor in that case: run a
  // small bounded number of batches inline. The bound prevents an accidental
  // infinite loop; the browser's resume endpoint can safely continue later.
  if (directHops >= 6) return;
  await log(runId, "background", `تشغيل دفعة مباشرة بعد فشل baton (${directHops + 1}/6).`);
  await delay(150);
  await runBackgroundBatch(request, runId, env, directHops + 1);
}

async function runBackgroundBatch(request: Request, runId: string, env: Env, directHops = 0) {
  try {
    const result = await processScanBatch(runId);
    if ('busy' in result && result.busy) {
      // A duplicate or restarted worker must not abandon the only live baton.
      await delay(Math.min(10_000,Math.max(500,Number(result.run.lease_until)-Date.now())));
      if (!await scheduleNext(request,runId,env)) await continueAfterBatonFailure(request,runId,env,directHops);
      return;
    }
    if (result.done) {
      const delivered = await sendCompletionPush(env, result.run);
      if (!delivered) { await delay(1_000); if (!await scheduleNext(request, runId, env)) await continueAfterBatonFailure(request,runId,env,directHops); }
    } else if (!await scheduleNext(request, runId, env)) await continueAfterBatonFailure(request,runId,env,directHops);
  } catch (error) {
    await log(runId, "background", error instanceof Error ? error.message : "خطأ في المهمة الخلفية").catch(() => {});
    if(error&&typeof error==='object'&&'status'in error&&[404,409].includes(Number(error.status)))return;
    await delay(1_000);
    if (!await scheduleNext(request, runId, env)) await continueAfterBatonFailure(request,runId,env,directHops);
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

    if (url.pathname === "/api/push/key" && request.method === "GET") return env.VAPID_PUBLIC_KEY?json({ publicKey: env.VAPID_PUBLIC_KEY }):json({error:"لم تتم تهيئة مفتاح الإشعارات"},503);

    if (url.pathname === "/api/push/subscribe" && request.method === "POST") {
      try {
        sameOrigin(request);
        if(!pushConfigured(env))return json({error:'لم تتم تهيئة مفاتيح الإشعارات'},503);
        await ensureSchema();
        const subscription = await body(request,10_000) as any;
        if (!validPushSubscription(subscription)) return json({ error: "اشتراك الإشعارات غير صالح أو خدمة الإشعارات غير مدعومة" }, 400);
        const identity=visitor(request);
        const existing=await db().prepare('SELECT owner FROM push_subscriptions WHERE endpoint=?').bind(subscription.endpoint).first() as any;
        if(existing?.owner&&existing.owner!==identity.owner)return json({error:'هذا الاشتراك مرتبط بهوية أخرى'},403);
        await db().prepare("INSERT INTO push_subscriptions(endpoint,subscription,owner,created_at) VALUES(?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET subscription=excluded.subscription,owner=excluded.owner,failure_count=0 WHERE push_subscriptions.owner='' OR push_subscriptions.owner=excluded.owner").bind(subscription.endpoint, JSON.stringify(subscription),identity.owner, new Date().toISOString()).run();
        const response=json({ subscribed: true });if(identity.cookie)response.headers.set('Set-Cookie',identity.cookie);return response;
      } catch (error: any) { return json({ error: error.message || "تعذّر تفعيل الإشعارات" }, statusOf(error,500)) }
    }

    if (url.pathname === "/api/push/test" && request.method === "POST") {
      try {
        sameOrigin(request);
        if(!pushConfigured(env))return json({error:'لم تتم تهيئة مفاتيح الإشعارات'},503);
        await ensureSchema();
        const input = await body(request,10_000) as any;
        if (typeof input?.endpoint !== "string") return json({ error: "اشتراك غير صالح" }, 400);
        const identity=visitor(request);
        const row = await db().prepare("SELECT subscription FROM push_subscriptions WHERE endpoint=? AND owner=?").bind(input.endpoint,identity.owner).first() as any;
        if (!row) return json({ error: "هذا الجهاز غير مسجل للإشعارات" }, 404);
        webpush.setVapidDetails("mailto:yousef-hamda@users.noreply.github.com", env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
        const payload = JSON.stringify({ title: "إشعارات رادار جاهزة", body: "تم ربط هذا الهاتف بنجاح. سنرسل لك تنبيهًا عند اكتمال الفحص.", url: "/" });
        const subscription = JSON.parse(row.subscription);
        if(!validPushSubscription(subscription))return json({error:'أعد تفعيل الإشعارات على هذا الجهاز'},400);
        const details = webpush.generateRequestDetails(subscription, payload, { TTL: 300, urgency: "high" });
        const pushBody = typeof details.body === "string" ? details.body : new Uint8Array(details.body);
        const response = await fetch(details.endpoint, { method: details.method, headers: details.headers, body: pushBody,redirect:'error',signal:AbortSignal.timeout(8000) });
        if([404,410].includes(response.status)){
          await db().prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND owner=?').bind(input.endpoint,identity.owner).run();
          return json({error:'انتهى الاشتراك؛ فعّل الإشعارات مجددًا'},410);
        }
        if (!response.ok) throw Error(`Push HTTP ${response.status}`);
        await db().prepare('UPDATE push_subscriptions SET last_success_at=?,failure_count=0 WHERE endpoint=? AND owner=?').bind(new Date().toISOString(),input.endpoint,identity.owner).run();
        return json({ sent: true });
      } catch (error: any) { return json({ error: error.message || "تعذّر إرسال إشعار الاختبار" }, statusOf(error,503)) }
    }

    if (url.pathname === "/api/background-scan/start" && request.method === "POST") {
      try {
        sameOrigin(request);
        const input = await body(request,8_000) as any;
        const run = await startScan(input.mode);
        ctx.waitUntil(runBackgroundBatch(request, run.id, env));
        return json({ run, background: true }, 202);
      } catch (error: any) { return json({ error: error.message || "تعذّر بدء الفحص" }, statusOf(error,503)) }
    }

    if (url.pathname === "/api/background-scan/resume" && request.method === "POST") {
      try {
        sameOrigin(request);
        const input=await body(request,8_000) as any;
        if(typeof input?.runId!=="string"||!UUID.test(input.runId))return json({error:"معرّف الفحص غير صالح"},400);
        await ensureSchema();
        const run=await db().prepare("SELECT id,status,stage FROM strategy_runs WHERE id=?").bind(input.runId).first() as any;
        if(!run)return json({error:"الفحص غير موجود"},404);
        if(!["running","partial"].includes(run.status)||Number(run.stage)>=13)return json({resumed:false,reason:"الجولة منتهية"});
        ctx.waitUntil(runBackgroundBatch(request,run.id,env));
        return json({resumed:true},202);
      }catch(error:any){return json({error:error.message||"تعذّر استئناف الفحص"},statusOf(error,503))}
    }

    if (url.pathname === "/__radar-background" && request.method === "POST") {
      const batonSecret = env.BACKGROUND_SCAN_SECRET;
      if (!batonSecret || !sameSecret(request.headers.get("X-Radar-Background"),batonSecret)) return json({ error: "غير مصرح" }, 401);
      let input:any;try{input=await body(request,8_000);}catch(error){return json({error:error instanceof Error?error.message:"طلب غير صالح"},statusOf(error,400));}
      if (typeof input.runId !== "string"||!UUID.test(input.runId)) return json({ error: "معرّف غير صالح" }, 400);
      // Let the accepted response leave the parent self-request before the
      // next D1 operation starts. Without this small hand-off delay, Sites'
      // Worker dispatcher can keep the baton requests nested and D1 rejects
      // the chain with "Subrequest depth limit exceeded".
      ctx.waitUntil((async () => {
        await delay(BATON_START_DELAY);
        await runBackgroundBatch(request, input.runId, env);
      })());
      return json({ accepted: true }, 202);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return secureResponse(await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths));
    }

    return secureResponse(await handler.fetch(request, env, ctx));
  },
};

export default worker;
