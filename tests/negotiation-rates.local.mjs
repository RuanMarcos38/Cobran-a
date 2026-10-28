import {financialStatement} from '../web/negotiation-statement.mjs';
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
await db.exec('reset role');const sample={principal:1000,interest:100,fine:20,fees:112,total:1232,configured:true,snapshot:'original',terms:{interest_percent:1,fine_percent:2,fee_percent:10,fee_basis:'updated'}};const calc=(await db.query('select cobranca_private.negotiated_quote($1,$2) q',[JSON.stringify(sample),JSON.stringify({interest_percent:'0.5',fine_percent:'1',fee_percent:'5'})])).rows[0].q;assert.equal(Number(calc.interest),50);assert.equal(Number(calc.fine),10);assert.equal(Number(calc.fees),53);assert.equal(Number(calc.total),1113);
const penny={...sample,principal:6606.30,interest:319.30,fine:132.13,fees:635.20,total:7692.93,days:145,terms:{...sample.terms,mode:'monthly',fee_percent:9}};const exact=(await db.query('select cobranca_private.negotiated_quote($1,$2) q',[JSON.stringify(penny),JSON.stringify({interest_percent:'0.5',fine_percent:'1',fee_percent:'5'})])).rows[0].q;assert.equal(Number(exact.interest),159.65);assert.equal(Number(exact.fine),66.06);assert.equal(Number(exact.fees),341.60);assert.equal(Number(exact.total),7173.61);
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
const ids=await Promise.all(['100.05','200.07','0.13'].map(x=>create(x)));const q=await joint('quote',{ids});assert.equal(Number(q.total),300.25);assert.equal(q.items.length,3);
const data={ids,discount_percent:'7.5',down_payment:'20.01',installments:'3',first_due_date:'2027-01-31',reason:'Aceite conjunto local',expected_snapshot:q.snapshot};const sim=simulateNegotiation(q,data,100);
await assert.rejects(()=>joint('formalize',{...data,expected_snapshot:'changed'}));for(const id of ids)assert.equal((await rpc('detail',{id})).agreements.length,0);
await as(other);await assert.rejects(()=>joint('quote',{ids}));await as(collector);assert.equal((await joint('quote',{ids})).items.length,3);await as(admin);
const c2=(await rpc('save',{entity:'creditors',name:'Outro credor'})).id;const b2=(await rpc('save',{entity:'debtors',name:'Outra empresa',document:'99999999000199',creditor_id:c2})).id;const wrong=await create('50',{creditor_id:c2,debtor_id:b2});await assert.rejects(()=>joint('quote',{ids:[ids[0],wrong]}));
await db.exec('reset role');await db.exec("update public.cobranca_creditors set metadata=metadata||'{\"financial_mode\":\"monthly\",\"default_interest\":\"1\",\"default_fine\":\"2\",\"grace_days\":\"0\",\"fee_basis\":\"updated\"}'::jsonb,fee_percent=10 where id='"+c+"'");await as(admin);
const contract=await joint('quote',{ids});const rates=Object.fromEntries(ids.map(id=>[id,{interest_percent:'0.5',fine_percent:'1',fee_percent:'5'}]));const changed=await joint('quote',{ids,rate_overrides:rates});assert.ok(Number(changed.total)<Number(contract.total));for(const item of changed.items){assert.equal(Number(item.quote.terms.interest_percent),0.5);assert.equal(Number(item.quote.terms.fine_percent),1);assert.equal(Number(item.quote.terms.fee_percent),5);assert.equal(Number(item.quote.terms.contract_terms.interest_percent),1);}assert.equal((await joint('quote',{ids})).snapshot,contract.snapshot);
await assert.rejects(()=>joint('quote',{ids,rate_overrides:{[ids[0]]:{interest_percent:'2'}}}));await assert.rejects(()=>joint('quote',{ids,rate_overrides:{[ids[0]]:{fine_percent:'-1'}}}));await assert.rejects(()=>joint('formalize',{...data,rate_overrides:rates,expected_snapshot:contract.snapshot}));
await db.exec('reset role');await db.exec("update public.cobranca_profiles set discount_limit=0 where id='"+collector+"'");await as(collector);await assert.rejects(()=>joint('formalize',{...data,discount_percent:'0',rate_overrides:rates,expected_snapshot:changed.snapshot}));await as(admin);
const updatedData={...data,rate_overrides:rates,expected_snapshot:changed.snapshot};const revised=simulateNegotiation(changed,updatedData,100);Object.assign(sim,revised);const result=await joint('formalize',updatedData);assert.equal(Number(result.total),Number(sim.total));assert.equal(result.schedule.length,sim.schedule.length);for(let i=0;i<sim.schedule.length;i++){assert.equal(Number(result.schedule[i].amount),Number(sim.schedule[i].amount));assert.equal(result.schedule[i].due_date,sim.schedule[i].due_date);}
let total=0;const columns=new Map();for(const id of ids){const d=await rpc('detail',{id});assert.equal(d.agreements.length,1);assert.equal(d.process.metadata.agreement_group_id,result.group_id);total+=Math.round(Number(d.agreements[0].total_amount)*100);assert.equal(d.installments.reduce((n,x)=>n+Math.round(Number(x.amount)*100),0),Math.round(Number(d.agreements[0].total_amount)*100));for(const i of d.installments)columns.set(i.installment_number,(columns.get(i.installment_number)||0)+Math.round(Number(i.amount)*100));}assert.equal(total,Math.round(Number(sim.total)*100));for(const p of result.schedule)assert.equal(columns.get(p.number),Math.round(Number(p.amount)*100));await assert.rejects(()=>joint('formalize',data));

for(const frequency of ['weekly','fortnightly']){
 const frequencyIds=await Promise.all(['100.03','200.07'].map(x=>create(x,{external_ref:frequency+'-'+x})));
 const fq=await joint('quote',{ids:frequencyIds});
 const fp={ids:frequencyIds,discount_percent:'0',down_payment:'10.01',installments:'5',first_due_date:'2028-02-23',reason:'Teste de periodicidade',expected_snapshot:fq.snapshot,payment_frequency:frequency};
 await assert.rejects(()=>joint('formalize',{...fp,payment_frequency:'invalid'}),/Periodicidade/);
 const fs=simulateNegotiation(fq,fp,100),fr=await joint('formalize',fp);
 assert.equal(fr.payment_frequency,frequency);
 assert.deepEqual(fr.schedule.map(x=>x.due_date),fs.schedule.map(x=>x.due_date));
 assert.deepEqual(fr.schedule.map(x=>Number(x.amount)),fs.schedule.map(x=>Number(x.amount)));
 for(const id of frequencyIds){const detail=await rpc('detail',{id});assert.equal(detail.process.metadata.agreement_payment_frequency,frequency);assert.match(detail.agreements[0].notes,new RegExp(frequency));for(const row of detail.installments)assert.equal(row.due_date,fs.schedule.find(x=>x.number===row.installment_number).due_date);}
}
console.log('PASS semanal e quinzenal: simulação, datas gravadas, auditoria, centavos e rejeição de frequência inválida');

await as(admin);
const recover=async agreementId=>(await db.query('select public.cobranca_agreement_statement($1) result',[JSON.stringify({id:agreementId})])).rows[0].result;
const recovered=await recover(result.agreements[0]);
assert.equal(recovered.original_missing,false);assert.equal(recovered.components_missing,false);
const recordedStatement=financialStatement(recovered.quote,recovered.simulation);
assert.equal(Number(recordedStatement.total),Number(sim.total));
assert.deepEqual(recovered.simulation.schedule.map(p=>Number(p.amount)),sim.schedule.map(p=>Number(p.amount)));
assert.deepEqual(recovered.simulation.schedule.map(p=>p.due_date),sim.schedule.map(p=>p.due_date));
assert.ok(recovered.quote.items.every(i=>i.quote.contract_quote));
await as(other);await assert.rejects(()=>recover(result.agreements[0]));
await as(collector);assert.equal(Number((await recover(result.agreements[0])).simulation.total),Number(sim.total));
await as(admin);await db.exec('reset role');
// Reopening uses recorded snapshots even if the debt's current metadata changes.
await db.query("update public.cobranca_debts set metadata=metadata-'agreement_quote' where id=any($1::uuid[])",[ids]);
await as(admin);assert.deepEqual((await recover(result.agreements[0])).quote,recovered.quote);
await db.exec('reset role');
// Controlled legacy fixture: snapshots missing, but the original frozen quotes remain.
for(const item of recovered.quote.items){await db.query("update public.cobranca_debts set metadata=metadata||jsonb_build_object('agreement_quote',$2::jsonb) where id=$1",[item.id,JSON.stringify({...item.quote,contract_quote:undefined})]);}
await db.query('update public.cobranca_agreements set financial_snapshot=null where id=any($1::uuid[])',[result.agreements]);
await as(admin);const legacy=await recover(result.agreements[0]);assert.equal(legacy.original_missing,true);assert.equal(legacy.components_missing,false);financialStatement(legacy.quote,legacy.simulation);
await db.exec('reset role');await db.query("update public.cobranca_debts set metadata=metadata-'agreement_quote' where id=any($1::uuid[])",[ids]);
await as(admin);const incomplete=await recover(result.agreements[0]);assert.equal(incomplete.components_missing,true);assert.equal(Number(incomplete.simulation.total),Number(sim.total));
await db.exec('reset role;set role anon');await assert.rejects(()=>recover(result.agreements[0]));
console.log('PASS recuperação: snapshots, parcelas efetivamente gravadas, recarga, dados legados incompletos sem reconstrução, permissões e isolamento');

await db.exec('reset role;set role anon');await assert.rejects(()=>joint('quote',{ids}));console.log('PASS percentuais: juros, multa, honorários, alçada combinada, contrato preservado e acordo com valores recalculados; proposta conjunta: seleção completa, centavos, rateio e parcelas consolidadas, calendário, saldo conferido sob bloqueio, duplicação e isolamento; nenhum recebimento fictício');await db.close();
