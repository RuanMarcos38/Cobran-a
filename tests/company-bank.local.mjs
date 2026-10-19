import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
await db.exec("create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;");
const files=(await readdir(new URL('../database/',import.meta.url))).filter(n=>/^\d.*\.sql$/.test(n)).sort();
for(const name of ['supabase-schema.sql',...files]){
 try{
  if(name==='019-booking-links.sql')await db.exec(await readFile(new URL('../supabase/migrations/20261019005921_n8n_commercial_schedule.sql',import.meta.url),'utf8'));
  await db.exec((await readFile(new URL('../database/'+name,import.meta.url),'utf8')).replace('create extension if not exists "pgcrypto";',''));
 }catch(e){console.error('MIGRATION',name,e.message);throw e;}
}
const tenant='00000000-0000-0000-0000-000000000000';
const tenantB='88888888-8888-4888-8888-888888888888';
const admin='11111111-1111-4111-8111-111111111111',finance='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333',collector='44444444-4444-4444-8444-444444444444';
await db.exec("insert into public.cobranca_tenants(id,name) values('"+tenantB+"','Outra empresa');");
for(const [id,t,role] of [[admin,tenant,'admin'],[finance,tenant,'finance'],[other,tenantB,'admin'],[collector,tenant,'collector']]){
 await db.exec("insert into auth.users(id,email,email_confirmed_at) values('"+id+"','"+id+"@example.invalid',now());insert into public.cobranca_profiles(id,tenant_id,name,role,discount_limit) values('"+id+"','"+t+"','Equipe','"+role+"',100);");
}
const as=async id=>db.exec("reset role;set test.uid='"+id+"';set role authenticated;");
const rpc=async(action,payload={})=>(await db.query('select public.cobranca_app($1,$2) result',[action,JSON.stringify(payload)])).rows[0].result;
await as(admin);
assert.equal((await rpc('company_get')).cnpj,'');
const cnpj='11.222.333/0001-81';
const company={legal_name:'Empresa Gestora Exemplo LTDA',trade_name:'Gestora',cnpj,email:'financeiro@example.invalid',phone:'47999999999',street:'Rua Teste',city:'Joinville',state:'SC'};
assert.equal((await rpc('company_save',company)).saved,true);
const saved=await rpc('company_get');assert.equal(saved.legal_name,company.legal_name);assert.equal(saved.cnpj,'11222333000181');
await assert.rejects(()=>rpc('company_save',{...company,cnpj:'00.000.000/0000-00'}));
const account=await rpc('fin_bank',{operation:'account',name:'Recebimentos',bank:'Banco Teste',account_ref:'123/456'});
const bankData={account_id:account.id,bank_code:'077',bank_name:'Banco Teste',provider:'inter',environment:'homologation',agency:'0001',account_number:'12345-6',beneficiary_document:cnpj,agreement:'CONV-001',wallet:'109',pix_key:''};
const bank=await rpc('bank_save',bankData);
assert.equal(bank.status,'pending_homologation');
let list=await rpc('bank_list');assert.equal(list.integrations.length,1);assert.equal(list.integrations[0].enabled,false);assert.equal(list.integrations[0].credential_configured,false);
assert.equal(JSON.stringify(list).includes('credential_cipher'),false);
await assert.rejects(()=>rpc('bank_issue',{bank_id:bank.id}),/Emissão bloqueada/);
await assert.rejects(()=>rpc('bank_save',{...bankData,beneficiary_document:'00.000.000/0000-00'}));
await assert.rejects(()=>rpc('bank_save',{...bankData,bank_code:'AB1'}));
assert.equal((await rpc('bank_secret_save',{bank_id:bank.id,cipher:'abcdefghij'.repeat(8)})).configured,true);
list=await rpc('bank_list');assert.equal(list.integrations[0].credential_configured,true);assert.equal(list.integrations[0].enabled,false);
assert.equal(JSON.stringify(list).includes('abcdefghij'),false);
assert.equal((await rpc('bank_secret_get',{bank_id:bank.id})).cipher,'abcdefghij'.repeat(8));
await as(finance);assert.equal((await rpc('company_get')).legal_name,company.legal_name);assert.equal((await rpc('bank_list')).integrations.length,1);
await assert.rejects(()=>rpc('bank_save',bankData));await assert.rejects(()=>rpc('bank_secret_get',{bank_id:bank.id}));
await as(collector);await assert.rejects(()=>rpc('company_get'));await assert.rejects(()=>rpc('bank_list'));
await as(other);assert.equal((await rpc('bank_list')).integrations.length,0);await assert.rejects(()=>rpc('bank_secret_get',{bank_id:bank.id}));await assert.rejects(()=>rpc('bank_save',bankData));
await as(admin);const invoice=await rpc('fin_list');assert.equal(invoice.rows.length,0);
console.log('PASS company and bank: company/CNPJ, account linking, bank config, tenant isolation, read vs write roles, encrypted-secret storage interface, no false boleto/receipts');
await db.close();