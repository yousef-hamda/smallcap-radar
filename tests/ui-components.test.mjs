import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});

after(async () => {
  await vite.close();
});

async function readCssTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return readCssTree(entryPath);
      }
      return entry.name.endsWith(".css") ? readFile(entryPath, "utf8") : "";
    }),
  );
  return contents.join("\n");
}

test("emits the catalog's animation and scrolling utilities", async () => {
  const css = await readCssTree(path.join(root, "dist"));

  assert.match(css, /--tw-enter-opacity/);
  assert.match(css, /scrollbar-width:\s*thin/);
  assert.match(css, /scrollbar-width:\s*none/);
  assert.match(css, /scrollbar-gutter:\s*stable/);
  assert.match(css, /scroll-fade-reveal-b/);
  assert.match(css, /mask-image:/);
  assert.match(css, /tw-shimmer/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test("forwards progress semantics to the primitive", async () => {
  const { Progress } = await vite.ssrLoadModule("/components/ui/progress.tsx");
  const html = renderToStaticMarkup(React.createElement(Progress, { value: 37 }));

  assert.match(html, /aria-valuenow="37"/);
  assert.match(html, /aria-valuetext="37%"/);
  assert.match(html, /data-state="loading"/);
});

test("emits chart themes for the starter's media dark mode", async () => {
  const { ChartStyle } = await vite.ssrLoadModule("/components/ui/chart.tsx");
  const html = renderToStaticMarkup(
    React.createElement(ChartStyle, {
      id: "contract",
      config: {
        latency: { theme: { light: "#ffffff", dark: "#000000" } },
      },
    }),
  );

  assert.match(html, /\[data-chart=contract\]/);
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
  assert.doesNotMatch(html, /\.dark/);
});

test("renders sidebar skeletons deterministically", async () => {
  const { SidebarMenuSkeleton } = await vite.ssrLoadModule(
    "/components/ui/sidebar.tsx",
  );
  const first = renderToStaticMarkup(React.createElement(SidebarMenuSkeleton));
  const second = renderToStaticMarkup(React.createElement(SidebarMenuSkeleton));

  assert.equal(first, second);
  assert.match(first, /--skeleton-width:70%/);
});

test('radar has the two strategies, favorites and a dedicated portfolio without bottom navigation', async()=>{
 const {default:Radar}=await vite.ssrLoadModule('/app/page.tsx');
 const html=renderToStaticMarkup(React.createElement(Radar));
 assert.match(html,/رادار الشركات الصغيرة/);assert.match(html,/aria-label="المفضلة: 0"/);
 assert.equal((html.match(/role="tab"/g)||[]).length,4);assert.match(html,/محفظتي/);
 assert.doesNotMatch(html,/bottom-nav|terminal-shell|sidebar-head/);
});

test('empty chart keeps all seven period controls',async()=>{
 const {default:Chart}=await vite.ssrLoadModule('/app/price-chart.tsx');
 const html=renderToStaticMarkup(React.createElement(Chart,{snapshot:{symbol:'TEST',name:'Synthetic chart fixture',asOf:'2025-01-01',provenance:{},history:[]}}));
 assert.equal((html.match(/role="tab"/g)||[]).length,7);
 assert.match(html,/لا تتوفر جلستان موثقتان/);
});

test('historical chart filters duplicate, future and nonfinite bars and displays actual extrema',async()=>{
 const {default:Chart}=await vite.ssrLoadModule('/app/price-chart.tsx');
 const html=renderToStaticMarkup(React.createElement(Chart,{snapshot:{symbol:'TEST',name:'Synthetic chart fixture',asOf:'2025-01-03',provenance:{},history:[{date:'2025-01-01',close:10},{date:'2025-01-01',close:10},{date:'2025-01-02',close:12},{date:'2025-01-04',close:99999},{date:'2025-01-02',close:NaN}]}}));
 assert.match(html,/10\.00/);assert.match(html,/12\.00/);assert.doesNotMatch(html,/99999|NaN|Infinity/);
 assert.match(html,/polyline/);
});
