/** Supported browser push services. No arbitrary HTTPS endpoints or redirects. */
export function validPushSubscription(value:unknown):value is {endpoint:string;keys:{auth:string;p256dh:string}} {
 if(!value||typeof value!=='object')return false;
 const s=value as {endpoint?:unknown;keys?:{auth?:unknown;p256dh?:unknown}};
 if(typeof s.endpoint!=='string'||s.endpoint.length>4096)return false;
 try {
  const u=new URL(s.endpoint),host=u.hostname;
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash)return false;
  if(!(host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||host==='web.push.apple.com'||host.endsWith('.push.apple.com')))return false;
  if(typeof s.keys?.auth!=='string'||typeof s.keys.p256dh!=='string')return false;
  const decode=(v:string)=>{if(!/^[A-Za-z0-9_-]+={0,2}$/.test(v))return '';return atob(v.replace(/-/g,'+').replace(/_/g,'/'));};
  const key=decode(s.keys.p256dh);
  return decode(s.keys.auth).length===16&&key.length===65&&key.charCodeAt(0)===4;
 }catch{return false;}
}
