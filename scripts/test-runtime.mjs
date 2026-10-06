import ts from 'typescript';
import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
await fs.mkdir('.test-build',{recursive:true});
for(const [name,path] of [['directory-cache','lib/directory-cache.ts'],['directory-reconcile','lib/directory-reconcile.ts'],['directory-rating','lib/directory-rating.ts'],['canonical-rating','lib/canonical-rating.ts'],['sec-artifact-cache','lib/sec-artifact-cache.ts'],['opportunity-peers','lib/opportunity-peers.ts'],['snapshot-archive','lib/snapshot-archive.ts'],['compact-radar','lib/compact-radar.ts'],['filing-observations','lib/filing-observations.ts'],['opportunity-thesis','lib/opportunity-thesis.ts'],['provider-quota','lib/provider-quota.ts'],['scheduled-scan','lib/scheduled-scan.ts'],['rank-release','lib/rank-release.ts'],['export-api','app/api/export/route.ts'],['fixtures','lib/fixtures.ts'],['financial-integrity','lib/financial-integrity.ts'],['strategy-spec','lib/strategy-spec.ts'],['opportunity-spec','lib/opportunity-spec.ts'],['opportunity-candidates','lib/opportunity-candidates.ts'],['evidence','lib/evidence.ts'],['engine','lib/engine.ts'],['opportunity-engine','lib/opportunity-engine.ts'],['opportunity-proxies','lib/opportunity-proxies.ts'],['opportunity-dossier','lib/opportunity-dossier.ts'],['sec-user-agent','lib/sec-user-agent.ts'],['scan-progress','lib/scan-progress.ts'],['account','lib/account.ts'],['visitor','lib/visitor.ts'],['http','lib/http.ts'],['client-json','lib/client-json.ts'],['validation','lib/validation.ts'],['portfolio','lib/portfolio.ts'],['portfolio-storage','lib/portfolio-storage.ts'],['storage','lib/storage.ts'],['scanner','lib/scanner.ts'],['reconcile','lib/reconcile.ts'],['push-validation','lib/push-validation.ts'],['worker','worker/index.ts'],['account-api','app/api/account/route.ts'],['radar-api','app/api/radar/route.ts'],['company-api','app/api/company/route.ts'],['favorite-quotes-api','app/api/favorite-quotes/route.ts'],['recover-api','app/api/recover/route.ts'],['portfolio-api','app/api/portfolio/route.ts'],['portfolio-history-api','app/api/portfolio-history/route.ts'],['portfolio-logo-api','app/api/portfolio-logo/route.ts'],['scan-report-api','app/api/scan-report/route.ts'],['chart-api','app/api/chart/route.ts']]) {
 let js=ts.transpileModule(await fs.readFile(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 js=js.replace(/from ['"](?:\.\/|@\/lib\/)([^'"]+)['"]/g,(_,p)=>`from './${p}.mjs'`);
 js=js.replace("from 'cloudflare:workers'","from '../tests/runtime/env.mjs'");
 if(['directory-reconcile','scanner','company-api','chart-api','portfolio-storage','portfolio-api','portfolio-history-api'].includes(name))js=js.replace("from './providers.mjs'","from '../tests/runtime/providers.mjs'");
 if(name==='worker'){
  js=js.replace('/* eslint-disable @typescript-eslint/no-explicit-any */','');
  js=js.replace(/^import .* from "vinext\/server\/[^"\n]+";$/gm,'');
  js=js.replace(/from "\.\.\/lib\/([^"\n]+)"/g,(_,p)=>`from './${p}.mjs'`);
  js="const handler={fetch:()=>new Response('stub')};const handleImageOptimization=()=>{};const DEFAULT_DEVICE_SIZES=[],DEFAULT_IMAGE_SIZES=[];\n"+js;
 }
 await fs.writeFile(`.test-build/${name}.mjs`,js);
}
const r=spawnSync(process.execPath,['--test','tests/runtime/regression.mjs'],{stdio:'inherit'});process.exitCode=r.status;
