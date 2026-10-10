import {test} from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {handleApi} from '../api-http.mjs';
test('API requires credentials, validates JSON and size, and serves integration documentation',async()=>{
 const server=http.createServer((req,res)=>handleApi(req,res,{SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public-test'}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{const doc=await fetch(base+'/api/openapi.json');assert.equal(doc.status,200);assert.equal((await doc.json()).openapi,'3.0.3');
 const post=body=>fetch(base+'/api/v1/processes',{method:'POST',headers:{'Content-Type':'application/json'},body});assert.equal((await post('{}')).status,401);assert.equal((await post('bad')).status,400);assert.equal((await post('[]')).status,400);assert.equal((await post(JSON.stringify({large:'x'.repeat(1024*1024)}))).status,413);
 assert.equal((await fetch(base+'/api/v1/borderos',{method:'POST',body:'{}'})).status,401);assert.equal((await fetch(base+'/api/v1/borderos',{method:'OPTIONS'})).status,204);assert.equal((await fetch(base+'/api/v1/borderos')).status,404);
 }finally{await new Promise(r=>server.close(r));}
});
