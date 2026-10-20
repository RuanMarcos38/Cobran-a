import {simulateNegotiation,loadNegotiation} from '../web/negotiation.mjs';
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

const joint=async(action,payload={})=>(await db.query('select public.cobranca_negotiate($1,$2) result',[action,JSON.stringify(payload)])).rows[0].result;

await as(admin);
const c=(await rpc('save',{entity:'creditors',name:'Contrato confirmado',financial_mode:'monthly',default_interest:'1',default_fine:'2',grace_days:'30',fee_percent:'10',fee_basis:'updated'})).id;
const b=(await rpc('save',{entity:'debtors',name:'Devedor local',creditor_id:c})).id;
const create=async(ref)=>(await rpc('new_process',{creditor_id:c,debtor_id:b,assigned_to:collector,external_ref:ref,original_amount:'1000',due_date:'2026-01-01',interest_percent:'0',fine_percent:'0'})).id;
const id=await create('CONTRATO-1');
const quote=async(date)=>(await db.query('select cobranca_private.financial_quote(d,$2::date) q from public.cobranca_debts d where id=$1',[id,date])).rows[0].q;
await db.exec('reset role');
let q=await quote('2026-01-31');assert.equal(Number(q.total),1000);assert.equal(Number(q.fees),0);
q=await quote('2026-03-02');assert.deepEqual([q.principal,q.interest,q.fine,q.fees,q.total].map(Number),[1000,10,20,103,1133]);assert.equal(q.days,30);assert.equal(q.terms.source,'creditor');
await db.query("insert into public.cobranca_receipts(tenant_id,debt_id,reference,amount,fee_amount,paid_date,actor,reason) values($1,$2,'LOCAL',133,0,'2026-03-02',$3,'Teste em memória')",[tenant,id,admin]);
q=await quote('2026-03-02');assert.equal(Number(q.total),1000);assert.equal(Number(q.fees),0);
q=await quote('2026-04-01');assert.equal(Number(q.total),1010);assert.equal(Number(q.fine),0);assert.equal(Number(q.fees),0);
await db.query('update public.cobranca_receipts set reversed=true where debt_id=$1',[id]);q=await quote('2026-03-02');assert.equal(Number(q.total),1133);
await db.query("update public.cobranca_debts set current_amount=777,metadata=metadata||jsonb_build_object('financial_frozen',true) where id=$1",[id]);q=await quote('2026-04-01');assert.equal(Number(q.total),777);assert.equal(q.frozen,true);
await db.query("update public.cobranca_debts set metadata=metadata-'financial_frozen' where id=$1",[id]);
await as(admin);const id2=await create('CONTRATO-2');const batch=await joint('quote',{ids:[id,id2]});assert.ok(Number(batch.fees)>0);assert.equal(Number(batch.total),batch.items.reduce((n,x)=>n+Number(x.quote.total),0));
await db.exec('reset role');await db.query("update public.cobranca_creditors set metadata=jsonb_set(metadata,'{default_interest}','\"2\"') where id=$1",[c]);
await as(admin);await assert.rejects(()=>joint('formalize',{ids:[id,id2],expected_snapshot:batch.snapshot,discount_percent:'0',down_payment:'0',installments:'2',first_due_date:'2030-01-01',reason:'Teste de atualização do contrato'}));
assert.equal((await rpc('detail',{id})).agreements.length,0);
await db.exec("reset role;set TimeZone to 'Pacific/Kiritimati'");await as(admin);
const localToday=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const localQuote=await joint('quote',{ids:[id,id2]});assert.equal(localQuote.as_of,localToday);assert.equal(localQuote.items[0].quote.as_of,localToday);
await joint('formalize',{ids:[id,id2],expected_snapshot:localQuote.snapshot,discount_percent:'0',down_payment:'0',installments:'2',first_due_date:localToday,reason:'Aceite fictício em banco local para validar a data brasileira'});
assert.equal((await db.query("select current_setting('TimeZone') tz")).rows[0].tz,'Pacific/Kiritimati');
console.log('PASS data brasileira preservada no cálculo e aceite, independentemente do fuso da conexão; fuso externo restaurado');
console.log('PASS contrato: taxas do credor sobrepõem importação sem encargos; vencimento, carência, honorários sobre saldo, pagamentos, estorno, congelamento, soma e bloqueio de saldo alterado');
await db.close();
