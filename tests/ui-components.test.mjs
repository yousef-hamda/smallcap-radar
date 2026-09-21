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
 assert.match(source,/className="treemap-node-watermark"/);
 assert.match(source,/className="treemap-node-copy"/);
 assert.match(css,/@container allocation-tile \(max-width:90px\)/);
 assert.match(css,/@media\(max-width:600px\)\{\.allocation-legend\{grid-template-columns:1fr\}/);
 assert.match(css,/\.portfolio-visual-grid\{display:grid;grid-template-columns:1\.15fr \.85fr;align-items:start/);
 assert.match(css,/\.portfolio-insights\{align-self:start;height:max-content\}/);
 assert.match(css,/\.portfolio-treemap\{height:clamp\(240px,26vw,330px\)/);
 assert.match(css,/\.treemap-node-watermark\{position:absolute;top:50%;left:50%/);
 assert.match(css,/@container allocation-tile \(max-width:180px\)\{\.treemap-node-watermark\{display:none\}/);
});

test('portfolio company picker keeps results in a large readable dialog row',async()=>{
 const css=await readFile(path.join(root,'app/globals.css'),'utf8');
 assert.match(css,/\.portfolio-dialog\[data-slot=dialog-content\]\{width:min\(760px/);
 assert.match(css,/\.portfolio-dialog\.picker-dialog\{height:min\(520px/);
 assert.match(css,/\.portfolio-search-results\.in-dialog\{position:static;grid-column:1 \/ -1/);
 assert.match(css,/\.dialog-search\{position:relative;display:grid;[^}]*overflow:hidden/);
 assert.match(css,/\.portfolio-search-results\.in-dialog\{[^}]*max-height:100%;height:100%;overflow:auto/);
 assert.match(css,/\.portfolio-search-results\.in-dialog button\{grid-template-columns:64px minmax\(0,1fr\) auto;min-height:84px/);
 assert.match(css,/\.portfolio-search-results\.in-dialog \.company-logo\{width:56px;height:56px/);
});

test('portfolio allocation uses proportional squarified geometry inside the frame',async()=>{
 const {squarifiedTreemap}=await vite.ssrLoadModule('/app/portfolio-view.tsx');
 const positions=[
  {symbol:'AAA',name:'A',quantity:1,averageCost:700,costBasis:700,currentPrice:700,marketValue:700,unrealizedPnl:0,unrealizedPct:0,realizedPnl:0,dailyPnl:0,weight:null,quoteAsOf:null},
  {symbol:'BBB',name:'B',quantity:1,averageCost:200,costBasis:200,currentPrice:200,marketValue:200,unrealizedPnl:0,unrealizedPct:0,realizedPnl:0,dailyPnl:0,weight:null,quoteAsOf:null},
  {symbol:'CCC',name:'C',quantity:1,averageCost:100,costBasis:100,currentPrice:100,marketValue:100,unrealizedPnl:0,unrealizedPct:0,realizedPnl:0,dailyPnl:0,weight:null,quoteAsOf:null},
 ];
 const nodes=squarifiedTreemap(positions),area=node=>node.width*node.height;
 assert.equal(nodes.length,3);assert(nodes.every(node=>node.x>=0&&node.y>=0&&node.x+node.width<=100.0001&&node.y+node.height<=100.0001));
 assert(area(nodes[0])>area(nodes[1]));assert(area(nodes[1])>area(nodes[2]));
 const visibleArea=nodes.reduce((sum,node)=>sum+area(node),0);
 assert(visibleArea<10000&&visibleArea>9000,'padding should leave only a small, bounded gutter around the treemap');
 for(let left=0;left<nodes.length;left+=1){
  for(let right=left+1;right<nodes.length;right+=1){
   const overlapWidth=Math.max(0,Math.min(nodes[left].x+nodes[left].width,nodes[right].x+nodes[right].width)-Math.max(nodes[left].x,nodes[right].x));
   const overlapHeight=Math.max(0,Math.min(nodes[left].y+nodes[left].height,nodes[right].y+nodes[right].height)-Math.max(nodes[left].y,nodes[right].y));
   assert(overlapWidth*overlapHeight<0.01,`treemap nodes overlap: ${nodes[left].symbol}/${nodes[right].symbol}`);
  }
 }
});

test('Arabic enrichment preserves sourced fields and translates company news',async()=>{
 const {translateSnapshotContent}=await vite.ssrLoadModule('/lib/translation.ts');
 const originalFetch=globalThis.fetch;
 const calls=[];
 globalThis.fetch=async url=>{
  const text=new URL(url).searchParams.get('q')||'';
  calls.push(text);
  const translations={
   'Synthetic Trading Company':'شركة التداول التجريبية',
   'A synthetic company description.':'وصف شركة تجريبية.',
   'Software':'برمجيات',
   'Synthetic headline':'عنوان تجريبي',
   'Newswire':'مصدر الأخبار',
  };
  return new Response(JSON.stringify([[ [translations[text]||'ترجمة عربية'] ]]),{status:200,headers:{'content-type':'application/json'}});
 };
 try{
  const result=await translateSnapshotContent({symbol:'ARTEST',name:'Synthetic Trading Company',description:'A synthetic company description.',sector:'Software',industry:'Software',asOf:'2025-01-01T00:00:00Z',price:10,news:[{title:'Synthetic headline',source:'Newswire',url:'https://example.test/news',publishedAt:'2025-01-01'},{title:'Second synthetic headline',source:'Newswire',url:'https://example.test/news-2',publishedAt:'2025-01-02'}],provenance:{}});
  assert.equal(result.name,'Synthetic Trading Company');
  assert.equal(result.nameAr,'شركة التداول التجريبية');
  assert.equal(result.descriptionAr,'وصف شركة تجريبية.');
  assert.equal(result.sectorAr,'برمجيات');
  assert.equal(result.news[0].title,'Synthetic headline');
  assert.equal(result.news[0].titleAr,'عنوان تجريبي');
  assert.equal(result.news[0].sourceAr,'مصدر الأخبار');
  assert.equal(result.news[1].sourceAr,'مصدر الأخبار');
  assert.equal(result.provenance.translation.confidence,'medium');
  assert(calls.length<=7,'duplicate source text should be translated once');
 } finally { globalThis.fetch=originalFetch; }
});

test('Arabic enrichment records a visible issue when the translation provider fails',async()=>{
 const {translateSnapshotContent}=await vite.ssrLoadModule('/lib/translation.ts');
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>new Response('',{status:503});
 try{
  const result=await translateSnapshotContent({symbol:'ARFAIL',name:'Unique Failing Synthetic Company',description:'Unique failing synthetic description.',asOf:'2025-01-01T00:00:00Z',provenance:{}});
  assert.match((result.dataIssues||[]).join(' '),/تعذّرت ترجمة اسم الشركة/);
  assert.equal(result.nameAr,undefined);
 } finally { globalThis.fetch=originalFetch; }
});

test('portfolio logo source uses the verified public stock-logo endpoint',async()=>{
 const [route,view]=await Promise.all([readFile(path.join(root,'app/api/portfolio-logo/route.ts'),'utf8'),readFile(path.join(root,'app/portfolio-view.tsx'),'utf8')]);
 assert.match(route,/https:\/\/financialmodelingprep\.com\/image-stock\/\$\{encodeURIComponent\(symbol\)\}\.png/);
 assert.match(route,/financialLogo \|\| companyLogo \|\| parqetLogo \|\| marketCapLogo/);
 assert.match(route,/companiesmarketcap\.com\/img\/company-logos\/128/);
 assert.match(route,/logoInFlight/);
 assert.match(route,/FALLBACK_TTL/);
 assert.match(route,/forceRefresh/);
 assert.match(route,/KNOWN_DOMAINS/);
 assert.match(route,/www\.google\.com\/s2\/favicons/);
 assert.match(route,/linearGradient/);
 assert.match(view,/\/api\/portfolio-logo\?symbol=\$\{encodeURIComponent\(symbol\)\}/);
 assert.match(view,/logoVersion = '3'/);
 assert.match(view,/loading="lazy"/);
});
