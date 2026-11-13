import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {handleApi} from '../api-http.mjs';

async function withServers(handler,run){
 const upstream=http.createServer(handler);
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 const server=http.createServer((req,res)=>handleApi(req,res,{SUPABASE_URL:'http://127.0.0.1:'+upstream.address().port,SUPABASE_PUBLISHABLE_KEY:'fixture'}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{await run('http://127.0.0.1:'+server.address().port);}finally{
  await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>upstream.close(resolve));
 }
}
test('Independent automation failure does not prevent the safe SMTP preflight from being reached',async()=>{
 const calls=[];
 await withServers(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const data=JSON.parse(raw);calls.push(data.payload.operation);
  let response={};
  switch(data.payload.operation){
   case 'automation_context':response={enabled:false};break;
   case 'sender':response={cipher:'invalid',tenant_id:'test',id:'test',address:'sales@example.invalid'};break;
   case 'sheet_updates':response=[];break;
  }
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(response));
 },async base=>{
  const response=await fetch(base+'/api/v1/commercial_prospection',{method:'POST',headers:{'Content-Type':'application/json','X-Integration-Key':'a'.repeat(64)},body:JSON.stringify({operation:'dispatch'})});
  assert.equal(response.status,200);const out=(await response.json()).data;
  assert.equal(out.status,'unavailable');
  assert.ok(out.warnings.includes('smtp_preflight_or_queue_unavailable'));
  assert.deepEqual(calls,['automation_context','sender','sheet_updates']);
 });
});
test('External contact events require scoped integration key and route to correct RPC',async()=>{
 const calls=[];
 await withServers(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const b=JSON.parse(raw);calls.push({url:req.url,body:b,hasBearer:Boolean(req.headers.authorization)});
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({saved:true,duplicate:false,id:'fixture-id'}));
 },async base=>{
  const url=base+'/api/v1/contact_events';
  assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Integration-Key':'a'.repeat(64)},body:JSON.stringify({external_id:'call-123',channel:'voice',direction:'outbound',debt_id:'test',content:'Contato registrado'})});
  assert.equal(response.status,200);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'/rest/v1/rpc/cobranca_contact_event');
  assert.equal(calls[0].hasBearer,false);
  assert.equal(calls[0].body.payload.external_id,'call-123');
 });
});
