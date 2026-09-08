import {DatabaseSync} from 'node:sqlite';
export const sqlite=new DatabaseSync(':memory:');
function prepared(sql,params=[]){return {bind:(...values)=>prepared(sql,values),run:async()=>({meta:{changes:Number(sqlite.prepare(sql).run(...params).changes)}}),first:async()=>sqlite.prepare(sql).get(...params)??null,all:async()=>({results:sqlite.prepare(sql).all(...params)})};}
export const env={DB:{prepare:prepared,batch:async statements=>{sqlite.exec('BEGIN');try{const out=[];for(const statement of statements)out.push(await statement.run());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}}};
