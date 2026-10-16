import {test} from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {handleApi} from '../api-http.mjs';
test('API requires credentials, validates JSON and size, and serves integration documentation',async()=>{
 const server=http.createServer((req,res)=>handleApi(req,res,{SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public-test'}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{const doc=await fetch(base+'/api/openapi.json');assert.equal(doc.status,200);assert.equal((await doc.json()).openapi,'3.0.3');
 const post=body=>fetch(base+'/api/v1/processes',{method:'POST',headers:{'Content-Type':'application/json'},body});assert.equal((await post('{}')).status,401);assert.equal((await post('bad')).status,400);assert.equal((await post('[]')).status,400);assert.equal((await post(JSON.stringify({large:'x'.repeat(1024*1024)}))).status,413);
 assert.equal((await fetch(base+'/api/v1/borderos',{method:'POST',body:'{}'})).status,401);assert.equal((await fetch(base+'/api/v1/borderos',{method:'OPTIONS'})).status,204);assert.equal((await fetch(base+'/api/v1/borderos')).status,404);
 }finally{await new Promise(r=>server.close(r));}
});

test('file bordero preview checks authenticated creditor access before parsing and returns normalized data',async()=>{
 const originalFetch=globalThis.fetch;let allowed=true;const calls=[];
 globalThis.fetch=async(url,options)=>{
  if(String(url).startsWith('https://fixture.supabase.co')){calls.push(JSON.parse(options.body));return new Response(JSON.stringify(allowed?{id:'creditor',name:'Credor teste'}:{message:'Perfil de gestão necessário'}),{status:allowed?200:403});}
  return originalFetch(url,options);
 };
 const server=http.createServer((req,res)=>handleApi(req,res,{SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public-test'}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const XLSX=await import('@e965/xlsx');const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([['Nome Cliente','Cód. Cliente','Núm. Título','Vencimento','Vlr. Aberto'],['Devedor','1247','T-1','27/01/2026','9.495,45']]),'Títulos');
  const file={name:'bordero.xls',base64:XLSX.write(w,{type:'buffer',bookType:'biff8'}).toString('base64')};
  const post=token=>fetch(base+'/api/v1/bordero_preview',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer fixture-token'}:{})},body:JSON.stringify({creditor_id:'creditor',file})});
  assert.equal((await post(false)).status,401);assert.equal(calls.length,0);
  allowed=false;assert.equal((await post(true)).status,403);assert.equal(calls.at(-1).action,'bordero_context');
  allowed=true;const response=await post(true);assert.equal(response.status,200);const {data}=await response.json();assert.equal(data.count,1);assert.equal(data.total,'9495.45');assert.deepEqual(data.errors,[]);assert.equal(data.creditor.id,'creditor');
 }finally{globalThis.fetch=originalFetch;await new Promise(r=>server.close(r));}
});
