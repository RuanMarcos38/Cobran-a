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

const tenant='00000000-0000-0000-0000-000000000000',otherTenant='88888888-8888-4888-8888-888888888888';
const admin='11111111-1111-4111-8111-111111111111',collector='22222222-2222-4222-8222-222222222222',colleague='33333333-3333-4333-8333-333333333333',external='44444444-4444-4444-8444-444444444444',sales='55555555-5555-4555-8555-555555555555';
await db.query('insert into public.cobranca_tenants(id,name) values($1,$2)',[otherTenant,'Outra empresa']);
for(const [id,t,role] of [[admin,tenant,'admin'],[collector,tenant,'collector'],[colleague,tenant,'collector'],[external,otherTenant,'admin'],[sales,tenant,'commercial']]){await db.query('insert into auth.users(id) values($1)',[id]);await db.query('insert into public.cobranca_profiles(id,tenant_id,name,role) values($1,$2,$3,$4)',[id,t,'Equipe',role]);}
const as=async id=>db.exec("reset role;set test.uid='"+id+"';set role authenticated;");
const rpc=async(action,payload={})=>(await db.query('select public.cobranca_attendance($1,$2) result',[action,JSON.stringify(payload)])).rows[0].result;
await as(admin);const account='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';await rpc('account_save',{id:account,name:'Caixa',sector:'collections',channel:'email',address:'team@example.invalid',cipher:'test-encrypted-'.repeat(6),members:[collector,colleague]});
await as(collector);const thread=await rpc('thread_open',{account_id:account,address:'client@example.invalid',name:'Cliente'});
const source={provider_id:'imap:42:7',provider_ref:'<one@example.invalid>',mail_message_id:'<one@example.invalid>',mail_location:{path:'INBOX',validity:'42',uid:'7'},address:thread.address,name:'Cliente',content:'Original',subject:'Teste',from_me:false};
await rpc('mail_sync',{account_id:account,messages:[source]});let detail=await rpc('thread_messages',{thread_id:thread.id}),message=detail.messages[0];assert.equal(message.mail_state.location.uid,'7');
const args={account_id:account,thread_id:thread.id,message_id:message.id,nonce:'99999999-9999-4999-8999-999999999999',operation:'trash'};
for(const id of [colleague,external,sales]){await as(id);await assert.rejects(()=>rpc('mail_action_begin',args));await assert.rejects(()=>rpc('mail_action_finish',args));}
await as(collector);await rpc('mail_action_begin',args);await assert.rejects(()=>rpc('mail_action_begin',args));await rpc('mail_action_finish',{...args,location:{path:'Trash',validity:'43',uid:'10'}});
detail=await rpc('thread_messages',{thread_id:thread.id});assert.equal(detail.messages[0].mail_state.trashed,true);assert.equal((await rpc('mail_trash_list',{account_id:account})).length,1);
await rpc('mail_sync',{account_id:account,messages:[{...source,provider_id:'imap-mailbox:VHJhc2g:43:10',mail_location:{path:'Trash',validity:'43',uid:'10'},mail_trashed:true}]});assert.equal((await rpc('thread_messages',{thread_id:thread.id})).messages.length,1);
await rpc('mail_action_begin',{...args,operation:'restore'});await rpc('mail_action_finish',{...args,location:{path:'INBOX',validity:'42',uid:'8'}});assert.equal((await rpc('thread_messages',{thread_id:thread.id})).messages[0].mail_state.trashed,false);
await assert.rejects(()=>rpc('mail_action_begin',{...args,operation:'purge'}));
await rpc('mail_action_begin',args);await rpc('mail_action_finish',{...args,location:{path:'Trash',validity:'43',uid:'11'}});await rpc('mail_action_begin',{...args,operation:'purge'});await rpc('mail_action_finish',{...args,location:{path:'Trash',validity:'43',uid:'11'}});assert.equal((await rpc('thread_messages',{thread_id:thread.id})).messages.length,0);
await rpc('mail_sync',{account_id:account,messages:[source]});assert.equal((await rpc('thread_messages',{thread_id:thread.id})).messages.length,0,'purged message must not reappear after cached synchronization');
const draft=await rpc('message_prepare',{thread_id:thread.id,nonce:'77777777-7777-4777-8777-777777777777',content:'Draft'});await rpc('mail_action_begin',{...args,message_id:draft.id});await assert.rejects(()=>rpc('message_claim',{thread_id:thread.id,message_id:draft.id}));await rpc('mail_action_finish',{...args,message_id:draft.id,local_only:true});await assert.rejects(()=>rpc('message_claim',{thread_id:thread.id,message_id:draft.id}));
await db.exec('reset role;set role anon');await assert.rejects(()=>rpc('mail_trash_list',{account_id:account}));
console.log('PASS: IMAP location, trash/restore/purge, no resurrection, tenant/sector/owner isolation, pending-operation serialization and blocked sends from trash.');await db.close();
