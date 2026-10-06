import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
/** Native supervisor inspection: D1 intentionally prohibits these PRAGMAs. */
export function readStorageCapacity(mountPath) {
 if(!mountPath)return null;
 const stat=fs.statfsSync(mountPath),filesystemFreeBytes=Number(stat.bavail)*Number(stat.bsize);
 const directory=path.join(mountPath,'state/v3/d1/miniflare-D1DatabaseObject');
 if(!fs.existsSync(directory))return {reusableBytes:0,filesystemFreeBytes};
 const files=fs.readdirSync(directory).filter(name=>name.endsWith('.sqlite')&&name!=='metadata.sqlite').map(name=>({name,size:fs.statSync(path.join(directory,name)).size})).sort((a,b)=>b.size-a.size);
 if(!files.length)return {reusableBytes:0,filesystemFreeBytes};
 const database=new DatabaseSync(path.join(directory,files[0].name),{readOnly:true});
 try{return {reusableBytes:Number(database.prepare('PRAGMA freelist_count').get().freelist_count)*Number(database.prepare('PRAGMA page_size').get().page_size),filesystemFreeBytes};}
 finally{database.close();}
}
