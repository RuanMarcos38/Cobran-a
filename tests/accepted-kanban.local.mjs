import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
await db.exec("create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;");
for(const name of ['supabase-schema.sql',...(await readdir(new URL('../database/',import.meta.url))).filter(n=>/^\d.*\.sql$/.test(n)).sort()]){
 if(name==='019-booking-links.sql')await db.exec(await readFile(new URL('../supabase/migrations/20261019005921_n8n_commercial_schedule.sql',import.meta.url),'utf8'));
 await db.exec((await readFile(new URL('../database/'+name,import.meta.url),'utf8')).replace('create extension if not exists "pgcrypto";',''));
}
const tenant='00000000-0000-0000-0000-000000000000',owner='11111111-1111-4111-8111-111111111111';
await db.query('insert into auth.users(id) values($1)',[owner]);
await db.query("insert into public.cobranca_profiles(id,tenant_id,name,role) values($1,$2,'Teste','admin')",[owner,tenant]);
async function fixture({status='accepted',provider='<test@example.invalid>',stage='Prospecção',linked=true,email='client@example.invalid',finished=true}={}){
 const o=(await db.query('insert into cobranca_private.crm_opportunities(tenant_id,name,email,stage,owner_id) values($1,$2,$3,$4,$5) returning id',[tenant,'Fixture',email,stage,owner])).rows[0].id;
 const l=(await db.query("insert into cobranca_private.prospect_leads(tenant_id,owner_id,source_key,email,company,source,opportunity_id) values($1,$2,gen_random_uuid()::text,$3,'Fixture','{}',$4) returning id",[tenant,owner,email,linked?o:null])).rows[0].id;
 const a=(await db.query("insert into cobranca_private.prospect_attempts(tenant_id,lead_id,status,subject,message,provider_id,finished_at) values($1,$2,$3,'Apresentação','Fixture',$4,$5) returning id",[tenant,l,status,provider,finished?new Date().toISOString():null])).rows[0].id;
 return {o,l,a};
}
const stage=async id=>(await db.query('select stage from cobranca_private.crm_opportunities where id=$1',[id])).rows[0].stage;
const first=await fixture();assert.equal(await stage(first.o),'Contato');
await db.query("update cobranca_private.prospect_attempts set status='accepted' where id=$1",[first.a]);
assert.equal((await db.query('select count(*)::int n from cobranca_private.crm_activities where opportunity_id=$1',[first.o])).rows[0].n,1,'repeated events must not duplicate activities');
for(const [i,args] of [{status:'unknown'},{provider:null},{finished:false},{stage:'Negociação'}].entries()){
 const f=await fixture({...args,email:`case${i}@example.invalid`});assert.equal(await stage(f.o),args.stage||'Prospecção');
}
const late=await fixture({linked:false,email:'late@example.invalid'});assert.equal(await stage(late.o),'Prospecção');
await db.query('update cobranca_private.prospect_leads set opportunity_id=$1 where id=$2',[late.o,late.l]);assert.equal(await stage(late.o),'Contato');
await db.query("update cobranca_private.crm_opportunities set stage='Prospecção',email='different@example.invalid' where id=$1",[late.o]);
assert.equal((await db.query('select cobranca_private.prospect_advance_accepted($1) moved',[late.l])).rows[0].moved,false,'a mismatched email must never be associated');
await db.exec('set role authenticated');await assert.rejects(()=>db.query('select cobranca_private.prospect_advance_accepted($1)',[first.l]));await db.exec('reset role');
await db.exec(await readFile(new URL('../database/043-commercial-accepted-kanban.sql',import.meta.url),'utf8'));
assert.equal((await db.query('select count(*)::int n from cobranca_private.crm_activities where opportunity_id=$1',[first.o])).rows[0].n,1,'reapplication is idempotent');
await db.query("update cobranca_private.crm_opportunities set stage='Proposta',version=version+1 where id=$1",[first.o]);
const undo=await fixture({email:'rollback@example.invalid'});assert.equal(await stage(undo.o),'Contato');
await db.exec(await readFile(new URL('../database/rollback/043-commercial-accepted-kanban.sql',import.meta.url),'utf8'));
assert.equal(await stage(undo.o),'Prospecção');assert.equal(await stage(first.o),'Proposta','rollback preserves later operator edits');
assert.equal((await db.query('select count(*)::int n from cobranca_private.crm_activities where opportunity_id=$1',[undo.o])).rows[0].n,1,'rollback retains history');
console.log('PASS: accepted presentation, idempotency, uncertain/missing evidence, advanced stage, late linkage, exact email, restricted helper, and migration reapplication. No external messages sent.');
await db.close();
