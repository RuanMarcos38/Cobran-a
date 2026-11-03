import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
await db.exec("create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;");
for(const name of ['supabase-schema.sql',...(await readdir(new URL('../database/',import.meta.url))).filter(n=>/^\d.*\.sql$/.test(n)).sort()]){
 if(name==='019-booking-links.sql')await db.exec(await readFile(new URL('../supabase/migrations/20261019005921_n8n_commercial_schedule.sql',import.meta.url),'utf8'));
 await db.exec((await readFile(new URL('../database/'+name,import.meta.url),'utf8')).replace('create extension if not exists "pgcrypto";',''));
}
const tenant='00000000-0000-0000-0000-000000000000',other='88888888-8888-4888-8888-888888888888',admin='11111111-1111-4111-8111-111111111111',collector='22222222-2222-4222-8222-222222222222',colleague='33333333-3333-4333-8333-333333333333',external='44444444-4444-4444-8444-444444444444';
await db.query("insert into public.cobranca_tenants(id,name) values($1,'Other')",[other]);
for(const [id,t,role] of [[admin,tenant,'admin'],[collector,tenant,'collector'],[colleague,tenant,'collector'],[external,other,'admin']]){await db.query('insert into auth.users(id) values($1)',[id]);await db.query("insert into public.cobranca_profiles(id,tenant_id,name,role) values($1,$2,'Equipe',$3)",[id,t,role]);}
const as=async id=>db.exec("reset role;set test.uid='"+id+"';set role authenticated;");
const rpc=async(action,payload={})=>(await db.query('select public.cobranca_attendance($1,$2) result',[action,JSON.stringify(payload)])).rows[0].result;
await as(admin);const account='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';await rpc('account_save',{id:account,name:'Caixa',sector:'collections',channel:'email',address:'team@example.invalid',cipher:'test-encrypted-'.repeat(6),members:[collector,colleague]});
await as(collector);const thread=await rpc('thread_open',{account_id:account,address:'client@example.invalid',name:'Cliente'});
await db.exec('reset role');
await db.query("insert into cobranca_private.attendance_messages(tenant_id,thread_id,direction,content,subject,status,created_at) select $1,$2,'outbound','Conteúdo completo antigo','Mensagem '||n,'accepted','2025-01-01T00:00:00Z'::timestamptz+n*interval '1 minute' from generate_series(1,350) n",[tenant,thread.id]);
await as(collector);
const mail=async payload=>(await db.query('select public.cobranca_mail_query($1) result',[JSON.stringify({account_id:account,...payload})])).rows[0].result;
let page=await mail({folder:'sent'});assert.equal(page.total,350);assert.equal(page.rows.length,25);assert.equal(page.counts.sent,350);
let old=await mail({search:'Mensagem 1',offset:100});assert.equal(old.total,111);assert.equal(old.rows.at(-1).subject,'Mensagem 1');
const full=await mail({operation:'detail',thread_id:thread.id,message_id:old.rows.at(-1).id});assert.equal(full.messages.length,1);assert.equal(full.messages[0].content,'Conteúdo completo antigo');
const pages=[];for(let offset=0;offset<350;offset+=50)pages.push(...(await mail({folder:'sent',limit:50,offset})).rows.map(x=>x.id));assert.equal(new Set(pages).size,350);
assert.equal((await mail({folder:'inbox',search:'Mensagem'})).total,0);
assert.equal((await mail({search:'client@example.invalid'})).total,350);
assert.equal((await mail({search:'completo antigo',from_date:'2025-01-01',to_date:'2025-01-01'})).total,171);
assert.equal((await mail({status:'unknown'})).total,0);
await as(colleague);assert.equal((await mail({})).total,0);await assert.rejects(()=>mail({operation:'detail',thread_id:thread.id,message_id:old.rows[0].id}));
await as(external);await assert.rejects(()=>mail({}));
await db.exec('reset role;set role anon');await assert.rejects(()=>mail({}));
console.log('PASS: 350 stored messages, oldest detail, full body, pagination, counts, recipient/body search, Brasília dates, status, tenant/owner/anonymous isolation.');
if(process.env.MAIL_QUERY_UI==='1'){
 await as(admin);const account2='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 await rpc('account_save',{id:account2,name:'VALIDAÇÃO LOCAL',sector:'commercial',channel:'email',address:'test@example.invalid',cipher:'test-only-'.repeat(10),members:[]});
 const demo=await rpc('thread_open',{account_id:account2,address:'demo@example.invalid',name:'Contato fictício'});
 await db.exec('reset role');await db.query('insert into cobranca_private.attendance_messages(tenant_id,thread_id,direction,content,subject,status,created_at) select tenant_id,$1,direction,content,subject,status,created_at from cobranca_private.attendance_messages where thread_id=$2',[demo.id,thread.id]);
 const {serveUiFixture}=await import('./ui-fixture.mjs');await serveUiFixture(db,admin);
}else await db.close();
