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
const tenant='00000000-0000-0000-0000-000000000000',creditor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';const config={financial_mode:'monthly',default_interest:1,default_fine:2,grace_days:30,fee_basis:'updated',fee_schedule_mode:'age',fee_age_rate_1:8,fee_age_rate_2:9,fee_age_rate_3:10,fee_age_rate_4:12,fee_age_rate_over:''};
await db.query('insert into public.cobranca_creditors(id,tenant_id,name,fee_percent,metadata) values($1,$2,$3,10,$4)',[creditor,tenant,'Credor por faixa',JSON.stringify(config)]);
const debt={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',tenant_id:tenant,creditor_id:creditor,original_amount:1000,current_amount:1000,due_date:'2026-01-01',metadata:{}};
const quote=async age=>(await db.query("select cobranca_private.financial_quote(jsonb_populate_record(null::public.cobranca_debts,$1::jsonb),'2026-01-01'::date+$2::int) q",[JSON.stringify(debt),age])).rows[0].q;
for(const [age,rate] of [[0,0],[1,8],[60,8],[61,9],[180,9],[181,10],[365,10],[366,12],[730,12]]){const q=await quote(age);assert.equal(Number(q.terms.fee_percent),rate);assert.equal(q.terms.fee_age_days,age);const interest=Math.round(1000*.01*Math.max(age-30,0)/30*100)/100;const fine=age>30?20:0;const fees=age>30?Math.round((1000+interest+fine)*rate)/100:0;assert.equal(Number(q.interest),interest);assert.equal(Number(q.fine),fine);assert.equal(Number(q.fees),fees);console.log('PASS idade',age,'dias; honorários',rate+'%; juros',q.interest,'multa',q.fine,'honorários',q.fees);}
assert.equal((await quote(731)).configured,false);await db.query("update public.cobranca_creditors set metadata=jsonb_set(metadata,'{fee_age_rate_over}','\"15\"') where id=$1",[creditor]);assert.equal(Number((await quote(731)).terms.fee_percent),15);assert.equal((await quote(731)).configured,true);
await db.query("update public.cobranca_creditors set metadata=jsonb_set(metadata,'{fee_age_rate_1}','\"101\"') where id=$1",[creditor]);await assert.rejects(()=>quote(1));console.log('PASS acima de 730 exige configuração; taxa configurável; percentual inválido rejeitado. Nenhuma alteração em produção.');await db.close();
