import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {handleApi} from '../api-http.mjs';
test('prospection API isolates its scope and never forwards bearer credentials',async()=>{
 let received;const upstream=http.createServer(async(req,res)=>{let text='';for await(const b of req)text+=b;received={url:req.url,headers:req.headers,body:JSON.parse(text)};res.setHeader('Content-Type','application/json');res.writeHead(received.body.token==='invalid'?401:200);res.end(JSON.stringify(received.body.token==='invalid'?{code:'28000',message:'secret internal detail'}:{scope:'commercial_prospection'}));});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));const server=http.createServer((req,res)=>handleApi(req,res,{SUPABASE_URL:`http://127.0.0.1:${upstream.address().port}`,SUPABASE_PUBLISHABLE_KEY:'public-fixture'}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/api/v1/commercial_prospection`;
 try{
  assert.equal((await fetch(url,{method:'POST',body:'{}'})).status,401);
  const headers={'X-Integration-Key':'a'.repeat(64),'Content-Type':'application/json',Authorization:'Bearer forbidden-to-forward'};
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({operation:'health'})})).status,200);
  assert.equal(received.url,'/rest/v1/rpc/cobranca_prospect_sync');assert.equal(received.headers.authorization,undefined);assert.equal(received.body.token,'a'.repeat(64));
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({operation:'sender'})})).status,400);
  for(const operation of ['finish','claim','reply','whatsapp_check','email_check','automation_context','auto_approve'])assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({operation})})).status,400);
  const rejected=await fetch(url,{method:'POST',headers:{...headers,'X-Integration-Key':'invalid'},body:'{}'});assert.equal(rejected.status,401);assert.ok(!(await rejected.text()).includes('secret internal detail'));
 }finally{await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>upstream.close(r))]);}
});
