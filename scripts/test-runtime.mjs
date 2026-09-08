import ts from 'typescript';
import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
await fs.mkdir('.test-build',{recursive:true});
for(const [name,path] of [['scan-progress','lib/scan-progress.ts'],['visitor','lib/visitor.ts'],['http','lib/http.ts'],['validation','lib/validation.ts'],['storage','lib/storage.ts'],['scanner','lib/scanner.ts'],['radar-api','app/api/radar/route.ts']]) {
 let js=ts.transpileModule(await fs.readFile(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 js=js.replace(/from ['"](?:\.\/|@\/lib\/)([^'"]+)['"]/g,(_,p)=>`from './${p}.mjs'`);
 js=js.replace("from 'cloudflare:workers'","from '../tests/runtime/env.mjs'");
 if(name==='scanner')js=js.replace("from './providers.mjs'","from '../tests/runtime/providers.mjs'");
 await fs.writeFile(`.test-build/${name}.mjs`,js);
}
const r=spawnSync(process.execPath,['--test','tests/runtime/regression.mjs'],{stdio:'inherit'});process.exitCode=r.status;
