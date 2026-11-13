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
await as(admin);const c=(await rpc('save',{entity:'creditors',name:'Credor de negociação',fee_percent:'0'})).id;const b=(await rpc('save',{entity:'debtors',name:'Devedor de negociação',document:'12345678000190',creditor_id:c})).id;
const created=await rpc('new_process',{creditor_id:c,debtor_id:b,assigned_to:collector,external_ref:'NEG-LOCAL',original_amount:'100.05',due_date:'2026-01-01',interest_percent:'0',fine_percent:'0'});const quote=await rpc('quote',{id:created.id});const data={discount_percent:'10',down_payment:'7.03',installments:'3',first_due_date:'2027-01-31',reason:'Aceite em ambiente local de teste'};
const context=await loadNegotiation({rpc},created.id);assert.equal(context.detail.debtor.name,'Devedor de negociação');assert.equal(context.detail.creditor.name,'Credor de negociação');await as(collector);assert.equal((await loadNegotiation({rpc},created.id)).detail.debtor.name,'Devedor de negociação');await as(admin);const s=simulateNegotiation(quote,data,100);const before=await rpc('detail',{id:created.id});assert.equal(before.agreements.length,0);assert.equal(before.installments.length,0);
await as(other);await assert.rejects(()=>rpc('quote',{id:created.id}));await as(admin);await rpc('agreement',{id:created.id,...data});const after=await rpc('detail',{id:created.id});assert.equal(Number(after.agreements[0].total_amount),Number(s.total));assert.equal(after.installments.length,s.schedule.length);const actual=after.installments.slice().sort((a,b)=>a.installment_number-b.installment_number);for(let i=0;i<s.schedule.length;i++){assert.equal(Number(actual[i].amount),Number(s.schedule[i].amount));assert.equal(String(actual[i].due_date).slice(0,10),s.schedule[i].due_date);}await assert.rejects(()=>rpc('agreement',{id:created.id,...data}));assert.equal((await rpc('detail',{id:created.id})).agreements.length,1);
console.log('PASS negociação: simulação sem gravação; centavos, entrada e calendário equivalentes ao banco; acordo registrado apenas no teste local; bloqueio de duplicação e isolamento de empresa');await db.close();
