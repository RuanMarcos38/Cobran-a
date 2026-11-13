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
const tenant='00000000-0000-0000-0000-000000000000';const c='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
await db.query('insert into public.cobranca_creditors(id,tenant_id,name,fee_percent,metadata) values($1,$2,$3,10,$4)',[c,tenant,'Credor teste de períodos',JSON.stringify({financial_mode:'monthly',default_interest:1,default_fine:2,grace_days:30,fee_basis:'updated'})]);
const debt={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',tenant_id:tenant,creditor_id:c,original_amount:1000,current_amount:1000,due_date:'2026-01-01',metadata:{}};
const quote=async date=>(await db.query('select cobranca_private.financial_quote(jsonb_populate_record(null::public.cobranca_debts,$1::jsonb),$2::date) q',[JSON.stringify(debt),date])).rows[0].q;
for(const [date,days,interest,fine,fees] of [['2026-01-01',0,0,0,0],['2026-01-31',0,0,0,0],['2026-02-01',1,.33,20,102.03],['2026-03-02',30,10,20,103],['2026-04-01',60,20,20,104]]){const q=await quote(date);assert.equal(q.days,days);assert.equal(Number(q.interest),interest);assert.equal(Number(q.fine),fine);assert.equal(Number(q.fees),fees);console.log('PASS',date,'dias',days,'juros',q.interest,'multa única',q.fine,'honorários',q.fees);}
await db.query("update public.cobranca_creditors set metadata=metadata||'{\"financial_mode\":\"daily\",\"default_interest\":0.1,\"fee_basis\":\"principal\"}'::jsonb where id=$1",[c]);const daily=await quote('2026-02-10');assert.equal(Number(daily.interest),10);assert.equal(Number(daily.fees),100);console.log('PASS juros diários: 10 dias a 0,1%; honorários sobre principal; sem capitalização');await db.close();
