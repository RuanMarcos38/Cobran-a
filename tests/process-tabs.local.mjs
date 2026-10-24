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
await as(admin);const c=(await rpc('save',{entity:'creditors',name:'Credor conjunto',fee_percent:'0'})).id;const b=(await rpc('save',{entity:'debtors',name:'Empresa conjunta',document:'12345678000190',creditor_id:c})).id;
const create=async(amount,extra={})=>(await rpc('new_process',{creditor_id:c,debtor_id:b,assigned_to:collector,external_ref:'JOINT-'+amount,original_amount:amount,due_date:'2026-01-01',interest_percent:'0',fine_percent:'0',...extra})).id;

const id=await create('100');let detail=await rpc('detail',{id});assert.equal(detail.creditor.id,c);assert.equal((await rpc('get',{entity:'debtors',id:detail.process.debtor_id})).id,b);assert.equal(detail.process.id,id);assert.ok(detail.financial);assert.equal((await rpc('processes',{filters:{process:'JOINT-100'}})).count,1);assert.equal((await rpc('processes',{filters:{creditor_id:c}})).count,1);
for(const channel of ['human','voice','email','promise'])await rpc('history',{id,channel,subject:'QA '+channel,content:'Registro isolado '+channel,...(channel==='promise'?{promised_date:'2028-01-31'}:{})});detail=await rpc('detail',{id});for(const channel of ['human','voice','email','promise'])assert.equal(detail.history.filter(x=>x.channel===channel&&x.subject==='QA '+channel).length,1);assert.equal(detail.process.promised_payment_date,'2028-01-31');assert.equal(detail.history.filter(x=>x.channel==='voice').length,1);await assert.rejects(()=>rpc('history',{id,channel:'promise',content:'Sem data'}));await assert.rejects(()=>rpc('history',{id,channel:'voice',content:''}));
const bytes=btoa('%PDF-1.4\nDocumento fictício de teste');await rpc('document',{id,name:'qa.pdf',mime:'application/pdf',content:bytes});detail=await rpc('detail',{id});assert.equal(detail.documents.length,1);const doc=await rpc('download',{id:detail.documents[0].id});assert.equal(doc.content,bytes);assert.equal(doc.mime,'application/pdf');await assert.rejects(()=>rpc('document',{id,name:'bad.pdf',mime:'application/pdf',content:btoa('invalid')}));
await as(collector);assert.equal((await rpc('detail',{id})).documents.length,1);await rpc('history',{id,channel:'voice',subject:'Ligação do negociador',content:'Ligação registrada no ambiente isolado'});assert.equal((await rpc('detail',{id})).history.filter(x=>x.channel==='voice').length,2);await as(other);for(const [action,payload] of [['detail',{id}],['history',{id,channel:'voice',content:'Não autorizado'}],['download',{id:doc.id}],['document',{id,name:'deny.pdf',mime:'application/pdf',content:bytes}]])await assert.rejects(()=>rpc(action,payload));await db.exec('reset role;set role anon');await assert.rejects(()=>rpc('detail',{id}));console.log('PASS abas: pesquisa, carteira, cliente, processo, histórico persistido, ligações, promessa e documentos com download íntegro; validação e isolamento preservados.');await db.close();
