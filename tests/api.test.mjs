import test from 'node:test';
import assert from 'node:assert/strict';

test('responses and refreshes from a previous login cannot expose data or replace the new session',async()=>{
 const originalFetch=globalThis.fetch,originalStorage=globalThis.sessionStorage;const values=new Map();let pending=null;let delayRoute=null;let logins=0;
 globalThis.sessionStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
 const userSession=id=>({access_token:'fixture-'+id,refresh_token:'fixture-refresh-'+id,expires_at:Math.floor(Date.now()/1000)+3600,user:{id}});
 globalThis.fetch=async(url,options={})=>{
  if(url==='/config')return response({url:'https://fixture.invalid',key:'fixture-public-key',name:'Test'});
  if(delayRoute&&url.includes(delayRoute)){delayRoute=null;return new Promise(resolve=>{pending=resolve;});}
  if(url.includes('grant_type=password'))return response(userSession(String(++logins)));
  if(url.includes('/logout'))return response({});
  if(url.includes('grant_type=refresh_token'))return response(userSession('refreshed'));
  return response({authorized:true});
 };
 try{
  const api=await import('../web/api.mjs?session-test');await api.init();await api.login('first@example.invalid','fixture-password');
  delayRoute='/rpc/cobranca_app';const first=api.rpc('profile');await new Promise(resolve=>setImmediate(resolve));
  await api.logout();await api.login('second@example.invalid','fixture-password');pending(response({private:'previous company'}));
  await assert.rejects(first,/sessão foi alterada/);assert.equal(api.user().id,'2');
  delayRoute='/rpc/cobranca_app';const staleUnauthorized=api.rpc('profile');await new Promise(resolve=>setImmediate(resolve));
  await api.logout();await api.login('third@example.invalid','fixture-password');pending(response({message:'expired'},401));
  await assert.rejects(staleUnauthorized,/sessão foi alterada/);assert.equal(api.authenticated(),true);assert.equal(api.user().id,'3');
  const stored=JSON.parse(values.get('cobranca_session'));stored.expires_at=0;values.set('cobranca_session',JSON.stringify(stored));await api.init();
  delayRoute='grant_type=refresh_token';const staleRefresh=api.rpc('profile');await new Promise(resolve=>setImmediate(resolve));
  await api.logout();await api.login('fourth@example.invalid','fixture-password');pending(response(userSession('old-refresh')));
  await assert.rejects(staleRefresh,/sessão foi alterada/);assert.equal(api.user().id,'4');assert.equal(JSON.parse(values.get('cobranca_session')).user.id,'4');
 }finally{globalThis.fetch=originalFetch;if(originalStorage===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=originalStorage;}
});
