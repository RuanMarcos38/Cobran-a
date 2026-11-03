import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';
const code=await readFile(new URL('../integrations/n8n/prospect-status.js',import.meta.url),'utf8');
const run=data=>vm.runInNewContext('(function(){'+code+'})()',{$json:{data},$:()=>({all:()=>[{json:{email:'Lead@example.invalid',empresa:'Preservar cadastro'}}]})});
test('a failed Sheet update is reconciled from durable SMTP evidence without another email',()=>{
 const data={status:'idle',sheet_updates:[{status:'accepted',email:'lead@example.invalid',attempt_id:'attempt',provider_id:'<smtp>',finished_at:'2026-01-01T10:00:00Z'}]};
 const rows=run(data);assert.equal(rows.length,1);assert.equal(rows[0].json.data_contato,'2026-01-01T10:00:00Z');assert.deepEqual(Object.keys(rows[0].json).sort(),['data_contato','email','situacao','status_email','tentativas']);
 assert.equal(run({status:'review'}).length,0);assert.throws(()=>run({status:'accepted',sheet_updates:[{status:'accepted',email:'lead@example.invalid'}]}));
});
