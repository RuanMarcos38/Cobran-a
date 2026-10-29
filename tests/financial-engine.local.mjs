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

const motor=async(action,payload={})=>(await db.query('select public.cobranca_financial_engine($1,$2) result',[action,JSON.stringify(payload)])).rows[0].result;
await as(admin);const c=(await rpc('save',{entity:'creditors',name:'Contrato local',fee_percent:'0'})).id;const b=(await rpc('save',{entity:'debtors',name:'Teste local',document:'12345678000190',creditor_id:c})).id;
let seq=0;const create=async()=> (await rpc('new_process',{creditor_id:c,debtor_id:b,assigned_to:collector,external_ref:'MOTOR-'+(++seq),contract_ref:'LOCAL',original_amount:'1000.01',due_date:'2026-01-01',interest_percent:'0',fine_percent:'0'})).id;
const id=await create();
let m=await motor('quote',{id});assert.equal(Number(m.quote.total),1000.01);assert.ok(m.calculation_id);assert.equal(m.pending.compound_interest.startsWith('Não ativada'),true);
const again=await motor('quote',{id});assert.equal(m.calculation_id,again.calculation_id);
assert.equal((await motor('memory',{id:m.calculation_id})).immutable,true);
const dash=await motor('dashboard',{creditor_id:c,contract_ref:'LOCAL'});assert.equal(Number(dash.totals.updated),1000.01);assert.equal(Number(dash.agency.calculated),0);
const draft={creditor_id:c,contract_ref:'LOCAL',reason:'Contrato depende de validação',requirements:{interest_mode:'compound',correction_index:'IPCA',jurisdiction:'pending',commission_bands:[{from_day:1,to_day:30,rate:null}]}};
const pending=await motor('pending_rule',draft);assert.equal(pending.activated,false);assert.equal(pending.version,1);assert.equal((await motor('pending_rule',draft)).version,2);assert.equal((await motor('quote',{id})).calculation_id,m.calculation_id);
await assert.rejects(()=>motor('activate_rule',{id:pending.id}));await assert.rejects(()=>motor('pending_rule',{...draft,requirements:{api_key:'not allowed'}}));
await as(collector);assert.ok((await motor('quote',{id})).calculation_id);for(const action of ['dashboard','events','list','pending_rule'])await assert.rejects(()=>motor(action,draft));
await as(other);for(const [action,payload] of [['quote',{id}],['memory',{id:m.calculation_id}],['pending_rule',draft],['dashboard',{creditor_id:c}]])await assert.rejects(()=>motor(action,payload));assert.equal((await motor('events')).rows.length,0);
await db.exec('reset role;set role anon');await assert.rejects(()=>motor('quote',{id}));
await as(admin);await db.exec('reset role');
await assert.rejects(()=>db.exec("update cobranca_private.motor_calculations set result='{}'"));await assert.rejects(()=>db.exec('delete from cobranca_private.motor_events'));await assert.rejects(()=>db.exec("update cobranca_private.motor_pending_rules set status='active'"));
await db.exec("update public.cobranca_creditors set metadata=metadata||'{\"financial_mode\":\"monthly\",\"default_interest\":\"1\",\"default_fine\":\"2\",\"grace_days\":\"0\"}'::jsonb where id='"+c+"'");
await as(admin);const changed=await motor('quote',{id});assert.notEqual(changed.calculation_id,m.calculation_id);assert.equal(Number((await motor('memory',{id:m.calculation_id})).quote.total),1000.01);
const events=await motor('events',{creditor_id:c});assert.ok(events.rows.some(x=>x.entity==='cobranca_creditors'&&x.operation==='UPDATE'));assert.equal(JSON.stringify(events).includes('api_key'),false);
await assert.rejects(()=>motor('quote',{id,as_of:'2999-01-01'}));
// No financial snapshots include credential metadata; nonfinancial changes do not create money events.
await db.exec('reset role');const beforeEvents=(await db.query('select count(*) n from cobranca_private.motor_events')).rows[0].n;
await db.query("update public.cobranca_creditors set metadata=metadata||jsonb_build_object('api_key','LOCAL_SECRET_NEVER_LOG') where id=$1",[c]);
assert.equal((await db.query('select count(*) n from cobranca_private.motor_events')).rows[0].n,beforeEvents);
await as(admin);const privateFree=await motor('quote',{id});assert.equal(JSON.stringify(privateFree).includes('LOCAL_SECRET_NEVER_LOG'),false);
// Confirmed receipts are taken from the existing ledger, not subtracted a second time by the new UI/service.
await db.exec('reset role');await db.query("insert into public.cobranca_receipts(tenant_id,debt_id,reference,amount,fee_amount,paid_date,actor,reason) values($1,$2,'MOTOR-R',100,0,current_date,$3,'Local regression')",[tenant,id,admin]);
await as(admin);const withReceipt=await motor('quote',{id});assert.equal(Number(withReceipt.received),100);assert.notEqual(withReceipt.calculation_id,changed.calculation_id);
await db.exec('reset role');const official=(await db.query('select cobranca_private.financial_quote(d) q from public.cobranca_debts d where id=$1',[id])).rows[0].q;
assert.equal(Number(withReceipt.quote.total),Number(official.total));
await db.query("update public.cobranca_receipts set reversed=true where debt_id=$1",[id]);await as(admin);assert.equal(Number((await motor('quote',{id})).received),0);
// Frozen agreements remain frozen even when creditor rates are later modified.
await db.exec('reset role');await db.query("update public.cobranca_debts set current_amount=777,metadata=metadata||jsonb_build_object('financial_frozen',true) where id=$1",[id]);
await as(admin);const frozenMemory=await motor('quote',{id});assert.equal(frozenMemory.frozen,true);assert.equal(Number(frozenMemory.quote.total),777);
await assert.rejects(()=>motor('quote',{id,as_of:'2026-01-01'}));
console.log('PASS motor: official calculations, immutable/reproducible memory, idempotence, pending-only rules, versions, isolated tenant/roles, audit, receipts/reversal, frozen values and credential exclusion');
await db.close();
