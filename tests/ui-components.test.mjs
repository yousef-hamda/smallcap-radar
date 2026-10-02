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

test('SEC scan progress copy matches the issuer-wide acquisition rules', async()=>{
 const {OPPORTUNITY_SEC_PROGRESS_DETAIL,scanProgress}=await vite.ssrLoadModule('/lib/scan-progress.ts');
 const state=scanProgress({id:'run',status:'running',source:'full',stage:11,offset:8,total:100,processed:8,failed:0,created_at:'2026-09-30',updated_at:'2026-09-30'});
 assert.match(state.phase,/SEC/);assert.match(OPPORTUNITY_SEC_PROGRESS_DETAIL,/لكل سهم عادي مرتبط برقم CIK/);
 assert.match(OPPORTUNITY_SEC_PROGRESS_DETAIL,/لا يوقف الجلب/);assert.match(OPPORTUNITY_SEC_PROGRESS_DETAIL,/يمنع أهلية الترتيب/);
 assert.doesNotMatch(OPPORTUNITY_SEC_PROGRESS_DETAIL,/تعالج الشركات ذات السعر/);
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

test('radar exposes one opportunity category, favorites and portfolio without bottom navigation', async()=>{
 const {default:Radar}=await vite.ssrLoadModule('/app/page.tsx');
 const html=renderToStaticMarkup(React.createElement(Radar));
 assert.match(html,/رادار الشركات الصغيرة/);assert.match(html,/aria-label="المفضلة: 0"/);
 assert.equal((html.match(/role="tab"/g)||[]).length,3);assert.match(html,/الفرص الاستثمارية/);assert.match(html,/محفظتي/);
 assert.doesNotMatch(html,/فرص الارتداد|القيمة الأساسية/);
 assert.doesNotMatch(html,/bottom-nav|terminal-shell|sidebar-head/);
});

test('company profile consumes only the canonical Opportunity evaluation',async()=>{
 const source=await readFile(path.join(root,'app/company-sheet.tsx'),'utf8');
 const route=await readFile(path.join(root,'app/api/company/route.ts'),'utf8');
 assert.match(source,/opportunityEvaluation\.factors\.map/);
 assert.match(source,/opportunityEvaluation\.score>0\?opportunityEvaluation\.score\.toFixed\(1\):'—'/);
 assert.match(source,/أدلة القوة المالية والسيولة/);assert.match(source,/unrestrictedCash/);assert.match(source,/النقص يمنع احتساب العامل/);
 assert.doesNotMatch(source,/evaluateStrategy|SPECS\.(core|bounce)|فرص الارتداد|القيمة الأساسية/);
 assert.match(route,/evaluateOpportunityDossier\(snapshot,opportunityDossierFromSnapshot\(snapshot\)\)/);
});

test('radar displays fixed-denominator verified subtotals and sorts incomplete results by score then coverage',async()=>{
 const source=await readFile(path.join(root,'app/page.tsx'),'utf8');
 const storage=await readFile(path.join(root,'lib/storage.ts'),'utf8');
 assert.match(source,/نقاط مثبتة/);assert.match(source,/تغطية الأدلة \$\{e\.coveragePct\.toFixed\(1\)\}%/);assert.match(source,/f\.points\.toFixed\(2\)/);
 assert.match(source,/f\.complete\?'pass':f\.evidenced\?'partial':'unknown'/);
 assert.match(source,/opportunityWithEvidence\?\?0/);assert.match(source,/شركات لها نقاط موثقة/);
 const css=await readFile(path.join(root,'app/globals.css'),'utf8');assert.match(css,/\.brief-stats\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);assert.match(css,/\.brief-stats\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(storage,/json_extract\(evaluation,'\$\.opportunity\.score'\),0\) DESC, COALESCE\(json_extract\(evaluation,'\$\.opportunity\.coveragePct'\),0\) DESC/);
 assert.match(storage,/SELECT id,symbol,payload FROM fundamental_snapshots WHERE run_id=\? ORDER BY symbol ASC LIMIT \? OFFSET \?/);assert.match(storage,/Never materialize the entire multi-megabyte market snapshot/);
});

test('profile renders sourced financial-strength gaps without filling missing figures with zero',async()=>{
 const {FinancialStrengthEvidence}=await vite.ssrLoadModule('/app/company-sheet.tsx');
 const research={providerStatus:'retrieved',metrics:{unrestrictedCash:{value:1250000,unit:'USD',source:{source:'SEC fixture',url:'https://www.sec.gov/Archives/edgar/data/1/',periodEnd:'2026-06-30',availableAt:'2026-08-01T00:00:00.000Z',retrievedAt:'2026-09-30T12:00:00.000Z',currency:'USD',rightsStatus:'redistribution-permitted',confidence:'high'} }},missing:['rolling year-two debt maturity unavailable'],conflicts:[],limitations:['Standard concepts only'],readyForScoring:false};
 const html=renderToStaticMarkup(React.createElement(FinancialStrengthEvidence,{research}));
 assert.match(html,/أدلة القوة المالية والسيولة · 1\/6 مدخلات/);
 assert.match(html,/\$1\.25M/);
 assert.match(html,/rolling year-two debt maturity unavailable/);
 assert.match(html,/النقص يمنع احتساب العامل ولا يُعامل كقيمة صفرية/);
 assert.doesNotMatch(html,/إجمالي الدين المعياري[\s\S]{0,80}>\$0/);
});

test('profile source ledger displays ECB conversion rate dates, method inputs, provider, and source link',async()=>{
 const {FinancialStrengthEvidence}=await vite.ssrLoadModule('/app/company-sheet.tsx');
 const research={providerStatus:'retrieved',metrics:{unrestrictedCash:{value:1250000,unit:'USD',source:{source:'SEC fact · analytical USD translation using ECB daily reference rates',url:'https://www.sec.gov/Archives/edgar/data/1/filing.htm',periodEnd:'2026-06-30',availableAt:'2026-09-30T12:00:00.000Z',retrievedAt:'2026-09-30T12:00:00.000Z',currency:'USD',rightsStatus:'redistribution-permitted',confidence:'high',conversion:{rate:0.0067,sourceCurrency:'JPY',targetCurrency:'USD',method:'period-average-daily-reference-cross-rate',ratePeriodStart:'2026-04-01',ratePeriodEnd:'2026-06-30',observationCount:63,sourceUrl:'https://api.frankfurter.dev/v2/providers/ecb/rates?from=2026-04-01&to=2026-06-30&base=EUR&quotes=JPY%2CUSD',rateProvider:'European Central Bank (ECB) via Frankfurter API',inputAvailableAt:'2026-08-01T00:00:00.000Z',inputRetrievedAt:'2026-08-15T00:00:00.000Z'}}}},missing:['other inputs remain unavailable'],conflicts:[],limitations:[],readyForScoring:false};
 const html=renderToStaticMarkup(React.createElement(FinancialStrengthEvidence,{research}));
 assert.match(html,/JPY→USD @ 0\.006700000/);assert.match(html,/2026-04-01…2026-06-30 · 63 rates/);assert.match(html,/SEC available 2026-08-01T00:00:00\.000Z/);assert.match(html,/European Central Bank \(ECB\) via Frankfurter API/);assert.match(html,/FX rate source/);assert.match(html,/api\.frankfurter\.dev/);
});

test('profile renders SEC filing links as bounded discovery metadata, not catalyst claims',async()=>{
 const {SecFilingEvidence}=await vite.ssrLoadModule('/app/company-sheet.tsx');
 const research={providerStatus:'retrieved',items:[{form:'8-K',filed:'2026-09-20',reportDate:'2026-09-18',accession:'0000000001-26-000001',title:'SEC filing: 8-K filed 2026-09-20',url:'https://www.sec.gov/Archives/edgar/data/1/000000000126000001/current.htm'}],form8KItemIndex:{providerStatus:'retrieved',selectedDocuments:1,fetchedDocuments:1,failedDocuments:0,truncatedDocuments:0,items:[{form:'8-K',filed:'2026-09-20',accession:'0000000001-26-000001',url:'https://www.sec.gov/Archives/edgar/data/1/000000000126000001/current.htm',referencedItemNumbers:['2.02','9.01']}],limitations:['Item numbers only; human review required.']},source:{source:'SEC EDGAR submissions',url:'https://data.sec.gov/submissions/CIK0000000001.json',periodEnd:'2026-09-20',availableAt:'2026-09-20T23:59:59Z',retrievedAt:'2026-09-21T00:00:00Z',confidence:'high'},limitations:['Older filing-history files are not loaded.']};
 const html=renderToStaticMarkup(React.createElement(SecFilingEvidence,{research}));
 assert.match(html,/إفصاحات الشركة الأولية · 1/);assert.match(html,/SEC filing: 8-K/);assert.match(html,/محتواه أو إلزاميته/);assert.match(html,/فهرس بنود 8-K/);assert.match(html,/Items 2\.02, 9\.01/);assert.match(html,/Item numbers only; human review required/);assert.match(html,/Older filing-history files are not loaded/);assert.match(html,/target="_blank"/);
 const partial=renderToStaticMarkup(React.createElement(SecFilingEvidence,{research:{...research,providerStatus:'partial',limitations:[...research.limitations,'1 malformed recent-index row was rejected.']}}));assert.match(partial,/الفهرس جزئي؛ استُبعدت سجلات غير صالحة/);assert.match(partial,/malformed recent-index row/);
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
 assert.doesNotMatch(source,/treemap-node-watermark/);
 assert.match(source,/className="treemap-node-copy"/);
 assert.match(source,/className="treemap-node-company"/);
 assert.match(source,/data-density=\{density\(node\)\}/);
 assert.match(source,/left: `\$\{node\.x\}%`/);
 assert.match(source,/treemapSquarify\.ratio\(1\)/);
 assert.match(source,/loading=\{eager \? 'eager' : 'lazy'\}/);
 assert.match(css,/data-density=micro/);
 assert.doesNotMatch(css,/\.portfolio-treemap \.treemap-node-logo\{display:none/);
 assert.match(css,/\.treemap-node-logo \.company-logo\{width:44px;height:44px/);
 assert.match(css,/@media\(max-width:600px\)\{\.allocation-legend\{grid-template-columns:1fr\}/);
 assert.match(css,/\.portfolio-visual-grid\{grid-template-columns:minmax\(0,1\.2fr\) minmax\(280px,\.8fr\);gap:16px;align-items:start\}/);
 assert.match(css,/\.portfolio-insights\{align-self:start;height:max-content\}/);
 assert.match(css,/\.portfolio-treemap\{position:relative;width:100%;height:auto;min-height:240px;aspect-ratio:1\.65\/1/);
 assert.match(css,/\.sector-bars>div\{grid-template-columns:minmax\(160px,1\.4fr\) minmax\(220px,2\.2fr\) 72px;gap:10px\}/);
 assert.match(css,/\.portfolio-treemap \.treemap-node-logo \.company-logo\{width:44px;height:44px;margin:0;padding:2px;border:2px solid #fff;border-radius:10px;background:#f8fafc/);
 assert.match(css,/\.portfolio-treemap>\.treemap-node\{container-type:size;container-name:allocation-tile;box-sizing:border-box/);
 assert.doesNotMatch(css,/\.portfolio-treemap[^}]*box-shadow/);
 assert.doesNotMatch(css,/\.portfolio-treemap[^}]*text-shadow/);
 assert.doesNotMatch(css,/\.portfolio-treemap[^}]*linear-gradient/);
 assert.match(css,/\.portfolio-treemap>\.treemap-node\[data-density=micro\] \.treemap-node-copy>span/);
 assert.match(css,/\.allocation-legend\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:8px;margin-top:12px;direction:ltr\}/);
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
 assert.deepEqual(nodes.map(node=>node.symbol),['AAA','BBB','CCC']);
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

test('portfolio allocation keeps tiny holdings inside the frame and preserves descending order',async()=>{
 const {squarifiedTreemap}=await vite.ssrLoadModule('/app/portfolio-view.tsx');
 const base={quantity:1,averageCost:100,costBasis:100,currentPrice:100,unrealizedPnl:0,unrealizedPct:0,realizedPnl:0,dailyPnl:0,weight:null,quoteAsOf:null};
 const nodes=squarifiedTreemap([{...base,symbol:'LARGE',name:'Large',marketValue:720},{...base,symbol:'MID',name:'Mid',marketValue:195},{...base,symbol:'SMALL',name:'Small',marketValue:68},{...base,symbol:'TINY',name:'Tiny',marketValue:16}]);
 assert.deepEqual(nodes.map(node=>node.symbol),['LARGE','MID','SMALL','TINY']);
 assert(nodes.every(node=>node.x>=0&&node.y>=0&&node.x+node.width<=100.0001&&node.y+node.height<=100.0001));
 assert(nodes[0].width*nodes[0].height>nodes[1].width*nodes[1].height);
});

test('portfolio allocation colors tiles by the sourced daily move',async()=>{
 const {squarifiedTreemap}=await vite.ssrLoadModule('/app/portfolio-view.tsx');
 const base={quantity:1,averageCost:100,costBasis:100,currentPrice:100,marketValue:100,unrealizedPnl:0,unrealizedPct:0,realizedPnl:0,weight:null,quoteAsOf:null};
 const nodes=squarifiedTreemap([{...base,symbol:'GAIN',name:'Gain',dailyPnl:4},{...base,symbol:'LOSS',name:'Loss',dailyPnl:-4},{...base,symbol:'NONE',name:'None',dailyPnl:null}]);
 assert.match(nodes.find(node=>node.symbol==='GAIN').color,/hsl\(151/);
 assert.match(nodes.find(node=>node.symbol==='LOSS').color,/hsl\(3/);
 assert.equal(nodes.find(node=>node.symbol==='NONE').color,'#64748b');
});

test('portfolio exposes daily quote percentages and a force-refresh control',async()=>{
 const source=await readFile(path.join(root,'app/portfolio-view.tsx'),'utf8');
 const route=await readFile(path.join(root,'app/api/portfolio/route.ts'),'utf8');
 assert.match(source,/تغير يومي/);
 assert.match(source,/refresh\(true\)/);
 assert.match(source,/\/api\/portfolio\?refresh=1/);
 assert.match(route,/searchParams\.get\('refresh'\) === '1'/);
});

test('radar favorites send the displayed verified snapshot when saving',async()=>{
 const source=await readFile(path.join(root,'app/page.tsx'),'utf8');
 assert.match(source,/action:'favorite',symbol:s\.symbol,saved,\.\.\.\(saved\?\{snapshot:s\}:\{\}\)/);
});

test('unified opportunity view shows provisional weighted points while keeping completion status explicit',async()=>{
 const source=await readFile(path.join(root,'app/page.tsx'),'utf8');
 assert.match(source,/strategy=\$\{view==='opportunity'\?'opportunity':view\}/);
 assert.match(source,/state=\$\{opportunityState\}/);
 assert.match(source,/e\.state===opportunityState/);
 assert.match(source,/e\.state==='ranked'\?e\.score\.toFixed\(1\):e\.score>0\?e\.score\.toFixed\(1\):'—'/);
 assert.match(source,/\$\{f\.points\.toFixed\(2\)\} نقطة/);
 assert.match(source,/operatingCandidateSignals\(s\)/);
 assert.match(source,/candidate-signals/);
 assert.match(source,/ليست درجة نهائية/);
 assert.match(source,/useState<OpportunityState>\('needs-research'\)/);
 assert.match(source,/visibleEvaluated\.map\(\(\{s,e\},index\)=>/);
 assert.match(source,/visibleEvaluated\.length\} نتيجة معروضة/);
});

test('opportunity report uses the unified evaluation and factor blockers',async()=>{
 const [route,component]=await Promise.all([readFile(path.join(root,'app/api/scan-report/route.ts'),'utf8'),readFile(path.join(root,'app/scan-report.tsx'),'utf8')]);
 assert.match(route,/requestedStrategy!=='opportunity'/);
 assert.match(route,/OPPORTUNITY_SPEC\.factors/);
 assert.match(component,/evaluation\.factors\.map/);
 assert.match(component,/opportunityStateText/);
});

test('opening a profile synchronizes its completed-session quote back into the visible card',async()=>{
 const source=await readFile(path.join(root,'app/page.tsx'),'utf8');
 assert.match(source,/function syncCardQuote\(profile:Snapshot\)/);
 assert.match(source,/syncCardQuote\(p\.snapshot\);setSelected\(p\.snapshot\)/);
});

test('screen refresh work is bounded while manual refresh remains available',async()=>{
 const [radar,portfolio]=await Promise.all([readFile(path.join(root,'app/page.tsx'),'utf8'),readFile(path.join(root,'app/portfolio-view.tsx'),'utf8')]);
 assert.match(radar,/if\(view==='portfolio'\)return/);
 assert.match(radar,/10\*60_000/);
 assert.match(radar,/aria-label="تحديث القائمة"/);
 assert.doesNotMatch(radar,/window\.addEventListener\('focus'/);
 assert.match(portfolio,/10 \* 60_000/);
 assert.doesNotMatch(portfolio,/window\.addEventListener\('focus'/);
});

test('company profile labels SEC fact-fetch failures and keeps the sourced financial ledger collapsed and phone-readable',async()=>{
 const [source,css,route]=await Promise.all([readFile(path.join(root,'app/company-sheet.tsx'),'utf8'),readFile(path.join(root,'app/globals.css'),'utf8'),readFile(path.join(root,'app/api/company/route.ts'),'utf8')]);
 assert.match(source,/<details className="audit-details financial-history">/);
 assert.match(source,/providerStatus==='unavailable'\?/);
 assert.match(source,/providerStatus==='empty'\?/);
 assert.match(source,/providerStatus==='invalid'\?/);
 assert.match(source,/providerStatus==='retrieved'\?/);
 assert.match(source,/حالة استجابة SEC غير معروفة/);
 assert.match(source,/providerMessage&&/);
 assert.match(route,/deep:\$\{secUserAgentCacheVersion\(\)\}:/);
 assert.doesNotMatch(route,/const cacheKey = `deep:v10:/);
 assert.match(source,/القوائم المالية المنظمة · 3 سنوات و8 أرباع/);
 for(const label of ['الإيرادات','صافي الدخل','الدخل التشغيلي','التدفق النقدي التشغيلي','الإنفاق الرأسمالي','تعويضات الأسهم'])assert(source.includes(label),`financial history is missing ${label}`);
 assert.match(css,/\.financial-periods\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 const phoneRules=css.slice(css.indexOf('@media(max-width:600px)'));
 assert.match(phoneRules,/\.financial-periods\{grid-template-columns:minmax\(0,1fr\)\}/);
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
 assert.match(route,/marketCapLogo \|\| companyLogo \|\| parqetLogo \|\| financialLogo/);
 assert.match(route,/companiesmarketcap\.com\/img\/company-logos\/128/);
 assert.match(route,/logoInFlight/);
 assert.match(route,/FALLBACK_TTL/);
 assert.match(route,/forceRefresh/);
 assert.match(route,/KNOWN_DOMAINS/);
 assert.match(route,/DLO: 'dlocal\.com'/);
 assert.match(route,/white-only transparent mark/);
 assert.match(route,/www\.google\.com\/s2\/favicons/);
 assert.match(route,/linearGradient/);
 assert.match(view,/\/api\/portfolio-logo\?symbol=\$\{encodeURIComponent\(symbol\)\}/);
 assert.match(view,/logoVersion = '5'/);
 assert.match(view,/loading=\{eager \? 'eager' : 'lazy'\}/);
});
