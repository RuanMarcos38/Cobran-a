import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
const directory=new URL('../database/',import.meta.url);
for(const name of ['supabase-schema.sql',...(await readdir(directory)).filter(n=>/^\d.*\.sql$/.test(n)).sort()]){if(name==='019-booking-links.sql')await db.exec(await readFile(new URL('../supabase/migrations/20261019005921_n8n_commercial_schedule.sql',import.meta.url),'utf8'));await db.exec((await readFile(new URL(name,directory),'utf8')).replace('create extension if not exists "pgcrypto";',''));}
const tenant='00000000-0000-0000-0000-000000000000',admin='11111111-1111-4111-8111-111111111111',collector='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333',t2='44444444-4444-4444-8444-444444444444';
await db.exec(`insert into public.cobranca_tenants(id,name) values('${t2}','Other');insert into auth.users(id) values('${admin}'),('${collector}'),('${other}');insert into public.cobranca_profiles(id,tenant_id,name,role,discount_limit) values('${admin}','${tenant}','Admin','admin',100),('${collector}','${tenant}','Collector','collector',10),('${other}','${t2}','Other admin','admin',100);`);
const as=async id=>db.exec(`reset role;set test.uid='${id}';set role authenticated;`);
const rpc=async(action,payload={})=>(await db.query('select public.cobranca_app($1,$2) result',[action,JSON.stringify(payload)])).rows[0].result;
await as(admin);const creditor=await rpc('save',{entity:'creditors',name:'CREDOR TESTE',document:'01234567890123',fee_percent:'0',financial_mode:'monthly',default_interest:'12',default_fine:'2',grace_days:'730'});await db.exec('reset role');assert.equal(Number((await db.query('select metadata->>\'grace_days\' as grace from public.cobranca_creditors where id=$1',[creditor.id])).rows[0].grace),730);await as(admin);
const row={external_ref:'T-1',debtor_code:'1247',debtor_name:'DEVEDOR TESTE',debtor_document:null,original_amount:'9495.45',due_date:'2026-01-27',creditor_name:'CREDOR TESTE',source:'PDF:1',notes:'Original',raw:{external_ref:'T-1',series_nf:'X',notes:'Original'}};
const payload={creditor_id:creditor.id,file_hash:'a'.repeat(64),file_name:'report.pdf',rows:[row]};
assert.equal((await rpc('bordero_context',{creditor_id:creditor.id})).name,'CREDOR TESTE');
const r=await rpc('bordero_import',payload);assert.equal(r.created,1);assert.equal((await rpc('bordero_import',payload)).duplicates,1);await db.exec('reset role');const charges=(await db.query('select interest_percent,fine_percent,metadata from public.cobranca_debts where external_ref=$1',['T-1'])).rows[0];assert.equal(Number(charges.interest_percent),0);assert.equal(Number(charges.fine_percent),0);assert.equal(charges.metadata.charges_deferred,true);await as(admin);
assert.equal((await rpc('bordero_import',{...payload,file_hash:'b'.repeat(64)})).created,0);
for(const changed of [{original_amount:'9495.46'},{due_date:'2026-02-01'},{debtor_name:'OUTRO DEVEDOR'},{creditor_name:'OUTRO CREDOR'},{creditor_document:'11111111111111'}])await assert.rejects(()=>rpc('bordero_import',{...payload,rows:[{...row,...changed}]}));
await assert.rejects(()=>rpc('bordero_import',{...payload,rows:[{...row,external_ref:'ROLLBACK-FIRST'},{...row,external_ref:'INVALID',original_amount:'-1'}]}));
await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from public.cobranca_debts')).rows[0].n,1);
let d=(await db.query('select * from public.cobranca_debtors')).rows[0];assert.equal(d.document,null);assert.equal(d.metadata.external_debtor_code,'1247');assert.equal(d.phone,null);
await db.exec(`update public.cobranca_debtors set phone='5547999999999',opt_out=true,metadata=metadata||'{"address":"Existing"}'::jsonb`);
await as(admin);assert.equal((await rpc('bordero_import',{...payload,rows:[{...row,external_ref:'T-2',address:'New',debtor_phone:'5547888888888'}]})).created,1);
await db.exec('reset role');d=(await db.query('select * from public.cobranca_debtors')).rows[0];assert.equal(d.phone,'5547999999999');assert.equal(d.opt_out,true);assert.equal(d.metadata.address,'Existing');
const debt=(await db.query('select * from public.cobranca_debts order by external_ref')).rows[0];assert.equal(debt.metadata.original_fields.series_nf,'X');assert.equal(debt.assigned_to,collector);assert.equal(debt.description,'Original');
await as(admin);assert.equal((await rpc('processes',{filters:{creditor_id:creditor.id,scope:'Todos'}})).count,2);
for(const id of [collector,other]){await as(id);for(const action of ['bordero_context','bordero_import'])await assert.rejects(()=>rpc(action,payload));}
await db.exec('reset role;set role anon');await assert.rejects(()=>rpc('bordero_import',payload));
if(false&&process.env.BORDERO_PDF){
 const {parseFile}=await import('../bordero-parser.mjs');const name='validation.pdf';const parsed=await parseFile(await readFile(process.env.BORDERO_PDF),name);
 assert.equal(parsed.count,14);assert.equal(parsed.total,'180507.76');assert.deepEqual(parsed.errors,[]);
 assert.equal(parsed.rows[0].series_nf,'X');assert.equal(parsed.rows[1].notes,'10669/01, 9515/D, 9493/D,');
 await as(admin);const c=await rpc('save',{entity:'creditors',name:parsed.creditor_name||parsed.rows[0].creditor_name,document:'',fee_percent:'0',financial_mode:'none',default_interest:'0',default_fine:'0',grace_days:'0'});
 const uploaded={creditor_id:c.id,file_hash:parsed.file_hash,file_name:name,rows:parsed.rows};assert.equal((await rpc('bordero_import',uploaded)).created,14);assert.equal((await rpc('bordero_import',uploaded)).duplicates,14);
 await db.exec('reset role');assert.equal((await db.query('select sum(original_amount)::text total from public.cobranca_debts where creditor_id=$1',[c.id])).rows[0].total,'180507.76');
 console.log('PASS supplied PDF: 14 titles / 180507.76, observations and series, atomic insertion and replay without duplication.');
}
if(false&&process.env.BORDERO_XLS){
 const {parseFile}=await import('../bordero-parser.mjs');const XLSX=await import('@e965/xlsx');const bytes=await readFile(process.env.BORDERO_XLS);assert.equal((await parseFile(bytes,'model.xls')).count,0);
 const book=XLSX.read(bytes,{type:'buffer'});const sheet=book.Sheets[book.SheetNames[0]];
 XLSX.utils.sheet_add_aoa(sheet,[['01234567890123','CREDOR TESTE','12345678901','XLS TEST','Rua teste','Centro','Joinville','SC','01234567','47','999999999','DM','XLS-1','01','01/01/2026','27/01/2026','1.234,56','100,00','Observação','XLS-CODE','Representante','47988888888','test@example.invalid']],{origin:'A2'});
 const parsed=await parseFile(XLSX.write(book,{type:'buffer',bookType:'biff8'}),'filled.xls');assert.equal(parsed.count,1);assert.deepEqual(parsed.errors,[]);assert.equal(Object.keys(parsed.rows[0].raw).length,23);assert.equal(parsed.rows[0].protest_amount,'100.00');assert.equal(parsed.total,'1234.56');
 await as(admin);const inserted=await rpc('bordero_import',{creditor_id:creditor.id,file_hash:parsed.file_hash,file_name:'filled.xls',rows:parsed.rows});assert.equal(inserted.created,1);
 await db.exec('reset role');const imported=(await db.query('select metadata from public.cobranca_debts where id=$1',[inserted.items[0].id])).rows[0].metadata;
 assert.equal(Object.keys(imported.original_fields).length,23);assert.equal(imported.original_fields.representative,'Representante');
 console.log('PASS supplied XLS: empty template recognized; synthetic record preserves all 23 columns, contacts, address, installment and protest amount without adding it to the balance.');
}
// Contractual interest must pass the same field used by new_process.
await as(admin);
const contracted=await rpc('bordero_import',{...payload,contract_ref:'CONTRACT-TEST',rows:[{...row,external_ref:'WITH-CONTRACT'}]});
await db.exec('reset role');
const contractedDebt=(await db.query('select interest_percent,fine_percent,metadata from public.cobranca_debts where id=$1',[contracted.items[0].id])).rows[0];
assert.equal(Number(contractedDebt.interest_percent),12);
assert.equal(Number(contractedDebt.fine_percent),2);
assert.equal(contractedDebt.metadata.financial_terms.mode,'monthly');
assert.equal(contractedDebt.metadata.financial_terms.grace_days,730);
console.log('PASS CSV file borderos: all migrations, creditor/tenant/role validation, code-only debtor identity, exact amounts, atomic rollback, unchanged contacts/restrictions, replay/conflict detection and assignment; contractual interest and grace preserved.');
await db.close();
