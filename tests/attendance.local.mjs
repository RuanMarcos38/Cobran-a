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

const sales='55555555-5555-4555-8555-555555555555',colleague='66666666-6666-4666-8666-666666666666';
for(const [id,role] of [[sales,'commercial'],[colleague,'collector']])await db.exec("insert into auth.users(id) values('"+id+"');insert into public.cobranca_profiles(id,tenant_id,name,role) values('"+id+"','"+tenant+"','Atendente','"+role+"');");
const attend=async(action,payload={})=>(await db.query('select public.cobranca_attendance($1,$2) result',[action,JSON.stringify(payload)])).rows[0].result;
await as(admin);const wa='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',mail='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const account={id:wa,name:'Cobrança',sector:'collections',channel:'whatsapp',address:'5547999990000',members:[collector,colleague],cipher:'encrypted-test-placeholder-'.repeat(3)};
await attend('account_save',account);await attend('account_save',{...account,id:mail,name:'Vendas',sector:'commercial',channel:'email',address:'sales@example.invalid',members:[sales]});
assert.equal((await attend('accounts')).accounts.length,2);assert.equal(JSON.stringify(await attend('accounts')).includes('cipher'),false);
await assert.rejects(()=>attend('account_save',{...account,members:[sales]}));await assert.rejects(()=>attend('account_save',{...account,sector:'commercial',members:[sales]}));
await as(collector);assert.equal((await attend('accounts')).accounts.length,1);await assert.rejects(()=>attend('account_secret',{account_id:mail}));await assert.rejects(()=>attend('account_save',account));
const t=await attend('thread_open',{account_id:wa,address:'5547999991111',name:'Cliente A'});const prepared=await attend('message_prepare',{thread_id:t.id,nonce:'77777777-7777-4777-8777-777777777777',content:'Mensagem de teste'});assert.equal(prepared.status,'registered');
assert.equal((await attend('message_claim',{thread_id:t.id,message_id:prepared.id})).message.status,'sending');await assert.rejects(()=>attend('message_claim',{thread_id:t.id,message_id:prepared.id}));await attend('message_finish',{thread_id:t.id,message_id:prepared.id,status:'accepted',provider_id:'provider-test-id'});
await as(colleague);assert.equal((await attend('threads',{account_id:wa})).length,0);await assert.rejects(()=>attend('thread_messages',{thread_id:t.id}));await assert.rejects(()=>attend('thread_open',{account_id:wa,address:t.address,name:'Tentativa'}));await assert.rejects(()=>attend('message_prepare',{thread_id:t.id,nonce:'88888888-8888-4888-8888-888888888888',content:'Tentativa'}));
await attend('sync',{account_id:wa,messages:[{provider_id:'forged-other-owner',address:t.address,content:'Não deve interferir'}]});await as(admin);assert.equal((await attend('thread_messages',{thread_id:t.id})).messages.some(m=>m.provider_id==='forged-other-owner'),false);await as(sales);assert.equal((await attend('accounts')).accounts.length,1);await assert.rejects(()=>attend('threads',{account_id:wa}));await assert.rejects(()=>attend('thread_messages',{thread_id:t.id}));await assert.rejects(()=>attend('sync',{account_id:wa,messages:[]}));
await as(other);assert.equal((await attend('accounts')).accounts.length,0);await assert.rejects(()=>attend('account_secret',{account_id:wa}));await assert.rejects(()=>attend('thread_messages',{thread_id:t.id}));
await as(admin);const inbound={provider_id:'incoming-1',address:t.address,content:'Resposta recebida',name:'Cliente A'};await attend('sync',{account_id:wa,messages:[inbound,inbound]});assert.equal((await attend('thread_messages',{thread_id:t.id})).messages.filter(x=>x.provider_id==='incoming-1').length,1);await attend('thread_assign',{thread_id:t.id,owner_id:colleague});await as(collector);await assert.rejects(()=>attend('thread_messages',{thread_id:t.id}));await as(colleague);assert.equal((await attend('thread_messages',{thread_id:t.id})).messages.length,2);
await db.exec('reset role;set role anon');await assert.rejects(()=>db.query("select public.cobranca_attendance('accounts')"));
console.log('PASS: contas múltiplas; isolamento de setor, empresa e responsável; credenciais fora das listas; configuração administrativa; envio idempotente; respostas deduplicadas; transferência auditada; acesso anônimo bloqueado');await db.close();

