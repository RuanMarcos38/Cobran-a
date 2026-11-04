import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {financialStatement} from '../web/negotiation-statement.mjs';
import {simulateNegotiation} from '../web/negotiation.mjs';
const db=new PGlite();
await db.exec("create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;");
const files=(await readdir(new URL('../database/',import.meta.url))).filter(n=>/^\d.*\.sql$/.test(n)).sort();
for(const name of ['supabase-schema.sql',...files]){
 if(name==='019-booking-links.sql')await db.exec(await readFile(new URL('../supabase/migrations/20261019005921_n8n_commercial_schedule.sql',import.meta.url),'utf8'));
 await db.exec((await readFile(new URL('../database/'+name,import.meta.url),'utf8')).replace('create extension if not exists "pgcrypto";',''));
}
for(const name of ['20261104190000_editable_installment_amounts.sql','20261104210000_overdue_calendar_days.sql','20261104211000_direct_payment_quotes.sql']) {
 try {await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));}
 catch(e){throw new Error('Migration '+name+': '+e.message,{cause:e});}
}
const tenant='00000000-0000-0000-0000-000000000000';
const tenantB='88888888-8888-4888-8888-888888888888';
const admin='11111111-1111-4111-8111-111111111111',other='33333333-3333-4333-8333-333333333333';
await db.exec("insert into public.cobranca_tenants(id,name) values('"+tenantB+"','Outra empresa');");
for(const [id,t] of [[admin,tenant],[other,tenantB]])await db.exec("insert into auth.users(id,email,email_confirmed_at) values('"+id+"','"+id+"@example.invalid',now());insert into public.cobranca_profiles(id,tenant_id,name,role,discount_limit) values('"+id+"','"+t+"','Equipe','admin',100);");
const as=async id=>db.exec("reset role;set test.uid='"+id+"';set role authenticated;");
const rpc=async(action,payload={})=>(await db.query('select public.cobranca_app($1,$2) result',[action,JSON.stringify(payload)])).rows[0].result;
const joint=async(action,payload={})=>(await db.query('select public.cobranca_negotiate($1,$2) result',[action,JSON.stringify(payload)])).rows[0].result;
await as(admin);
const c=(await rpc('save',{entity:'creditors',name:'Credor Pagamento Direto',financial_mode:'none',default_interest:'0',default_fine:'0',grace_days:'0',fee_percent:'10',direct_payment_contract_rate:'5'})).id;
const b=(await rpc('save',{entity:'debtors',name:'Devedor Pagamento Direto',document:'12345678000190',creditor_id:c})).id;
const create=async(label,amount)=>(await rpc('new_process',{creditor_id:c,debtor_id:b,external_ref:label,original_amount:amount,due_date:'2026-01-01',interest_percent:'0',fine_percent:'0'})).id;
const ids=[await create('DIRETO','1000.00'),await create('NORMAL','2000.00')];
const standard=await joint('quote',{ids});
const direct=await joint('quote',{ids,direct_payment_ids:[ids[0]]});
assert.equal(direct.items.find(x=>x.id===ids[0]).quote.payment_mode,'direct');
assert.equal(Number(direct.items.find(x=>x.id===ids[0]).quote.contract_fee),50);
assert.equal(Number(direct.items.find(x=>x.id===ids[0]).quote.interest),0);
assert.equal(Number(direct.items.find(x=>x.id===ids[0]).quote.fine),0);
assert.equal(Number(direct.items.find(x=>x.id===ids[0]).quote.fees),0);
assert.equal(Number(direct.total),3250);
assert.equal(Number(standard.total),3300);
assert.equal(direct.items.find(x=>x.id===ids[1]).quote.payment_mode,undefined);
assert.equal(Number((await db.query("select (cobranca_private.financial_quote(d)->>'days_in_arrears')::int days from public.cobranca_debts d where d.id=$1",[ids[0]])).rows[0].days)>0,true);
const proposal={ids,direct_payment_ids:[ids[0]],discount_percent:'0',down_payment:'0',installments:'2',first_due_date:'2027-01-10',reason:'Teste autorizado em banco local',payment_amounts:['1000.00','2250.00'],expected_snapshot:direct.snapshot};
const sim=simulateNegotiation(direct,proposal,100);
assert.equal(financialStatement(direct,sim).total,sim.total);
await assert.rejects(()=>joint('formalize',{...proposal,direct_payment_ids:[]}));
await assert.rejects(()=>joint('formalize',{...proposal,payment_amounts:['1.00','2.00']}));
await as(other);await assert.rejects(()=>joint('quote',{ids,direct_payment_ids:[ids[0]]}));await as(admin);
const saved=await joint('formalize',proposal);
assert.equal(Number(saved.total),3250);
assert.deepEqual(saved.schedule.map(x=>Number(x.amount)),[1000,2250]);
const detail=await rpc('detail',{id:ids[0]});
assert.equal(detail.agreements.length,1);
assert.equal(detail.process.metadata.agreement_payment_mode,'direct');
assert.equal(detail.installments.reduce((sum,p)=>sum+Number(p.amount),0),1050);
assert.equal(detail.receipts?.length||0,0);
await assert.rejects(()=>joint('formalize',proposal));
const unconfigured=(await rpc('save',{entity:'creditors',name:'Sem taxa direta',fee_percent:'0'})).id;
const devedor=(await rpc('save',{entity:'debtors',name:'Sem taxa',document:'12345678000191',creditor_id:unconfigured})).id;
const blocked=(await rpc('new_process',{creditor_id:unconfigured,debtor_id:devedor,external_ref:'SEM-TAXA',original_amount:'100',due_date:'2026-01-01',interest_percent:'0',fine_percent:'0'})).id;
await assert.rejects(()=>joint('quote',{ids:[blocked],direct_payment_ids:[blocked]}),/taxa contratual/i);
console.log('PASS direct-payment local: per-title rate, mixed quote, overdue days, immutable receipts, authorization, exact cents, and missing rate block.');
await db.close();
