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

test('portfolio chart ignores unavailable points without emitting an invalid SVG path',async()=>{
 const {PerformanceChart}=await vite.ssrLoadModule('/app/portfolio-view.tsx');
 const history={points:[
  {date:'2025-01-01',marketValue:0,realizedPnl:0,unrealizedPnl:0,totalPnl:0,returnPct:null,grossPurchases:0},
  {date:'2025-01-02',marketValue:110,realizedPnl:0,unrealizedPnl:10,totalPnl:10,returnPct:.1,grossPurchases:100},
  {date:'2025-01-03',marketValue:120,realizedPnl:0,unrealizedPnl:20,totalPnl:20,returnPct:.2,grossPurchases:100},
 ],unavailable:[],incompleteSymbols:[],sources:[],asOf:'2025-01-03T00:00:00Z'};
 const html=renderToStaticMarkup(React.createElement(PerformanceChart,{history}));
 assert.match(html,/أداء المحفظة من 2025-01-02 إلى 2025-01-03/);
 assert.match(html,/d="M18\.00,/);
 assert.doesNotMatch(html,/d="L18\.00,/);
});

test('portfolio allocation shows an explicit empty state when no position has a price',async()=>{
 const {AllocationTreemap}=await vite.ssrLoadModule('/app/portfolio-view.tsx');
 const html=renderToStaticMarkup(React.createElement(AllocationTreemap,{positions:[],onOpen:()=>{}}));
 assert.match(html,/لا يمكن رسم التوزيع/);
 assert.doesNotMatch(html,/portfolio-treemap/);
});

test('portfolio allocation keeps every company logo and percentage in a readable legend',async()=>{
 const [source,css]=await Promise.all([readFile(path.join(root,'app/portfolio-view.tsx'),'utf8'),readFile(path.join(root,'app/globals.css'),'utf8')]);
 assert.match(source,/className="allocation-legend"/);
 assert.match(source,/aria-label="نسب شركات المحفظة"/);
 assert.match(source,/className="treemap-node-logo"/);
 assert.match(source,/className="treemap-node-copy"/);
 assert.match(css,/@container allocation-tile \(max-width:90px\)/);
 assert.match(css,/@media\(max-width:600px\)\{\.allocation-legend\{grid-template-columns:1fr\}/);
});
