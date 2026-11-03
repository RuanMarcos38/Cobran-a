import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
process.on('uncaughtException',e=>{console.error(e.message,e.where||'',e.stack?.split('\n').filter(x=>x.includes('pricing.local')).join('\n')||'');process.exit(1);});
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
const files=await readdir(new URL('../database/',import.meta.url));
for(const name of ['supabase-schema.sql',...files.filter(n=>/^\d.*\.sql$/.test(n)).sort()]){
 try{if(name==='019-booking-links.sql')await db.exec(await readFile(new URL('../supabase/migrations/20261019005921_n8n_commercial_schedule.sql',import.meta.url),'utf8'));await db.exec((await readFile(new URL('../database/'+name,import.meta.url),'utf8')).replace('create extension if not exists "pgcrypto";',''));}catch(e){console.error('MIGRATION',name);throw e;}
}
const tenant='00000000-0000-0000-0000-000000000000',otherTenant='88888888-8888-4888-8888-888888888888';
const admin='11111111-1111-4111-8111-111111111111',finance='22222222-2222-4222-8222-222222222222',manager='33333333-3333-4333-8333-333333333333',operator='44444444-4444-4444-8444-444444444444',other='55555555-5555-4555-8555-555555555555';
await db.exec(`insert into public.cobranca_tenants(id,name) values('${otherTenant}','Other');`);
for(const[id,role]of[[admin,'admin'],[finance,'finance'],[manager,'supervisor'],[operator,'collector'],[other,'admin']])await db.exec(`insert into auth.users(id,email,email_confirmed_at) values('${id}','${id}@example.invalid',now());insert into public.cobranca_profiles(id,tenant_id,name,role,discount_limit) values('${id}','${id===other?otherTenant:tenant}','Test','${role}',100);`);
const as=async id=>db.exec(`reset role;set test.uid='${id}';set role authenticated;`);
const rpc=async(action,payload={})=>(await db.query('select public.cobranca_app($1,$2) result',[action,JSON.stringify(payload)])).rows[0].result;
const raw=async(sql,params=[])=>{await db.exec('reset role');return db.query(sql,params);};
await as(admin);
const creditor=(await rpc('save',{entity:'creditors',name:'Pricing',document:'C1',fee_percent:'3',financial_mode:'none',default_interest:'0',default_fine:'0',grace_days:'0'})).id;
const debtor=(await rpc('save',{entity:'debtors',creditor_id:creditor,name:'Test debtor',document:'529.982.247-25'})).id;
const month='2026-01-01',ref='HON-1';
const contract=await rpc('pricing_contract',{creditor_id:creditor,contract_ref:ref,model:'A',rates:['10','15','20','25','30'],minimums:['590','990','1990','4990','8990'],starts_on:'2025-01-01',ends_on:'2027-12-31'});
assert.equal(contract.volume_discount,false);
// Exhaustive age and volume boundaries plus document normalization/validation.
await db.exec('reset role');
for(const[days,expected]of[[0,0],[-1,0],[1,1],[30,1],[31,2],[90,2],[91,3],[180,3],[181,4],[365,4],[366,5]])assert.equal((await db.query('select cobranca_private.fee_band($1) b',[days])).rows[0].b,expected);
for(const[n,expected]of[[99,1],[100,2],[499,2],[500,3],[1999,3],[2000,4],[4999,4],[5000,5]])assert.equal((await db.query('select cobranca_private.fee_volume_band($1) b',[n])).rows[0].b,expected);
for(const[doc,expected]of[['529.982.247-25','52998224725'],['11.222.333/0001-81','11222333000181'],['00.000.000/E08G-12','00000000E08G12'],['11111111111',null],['52998224726',null],['',null]])assert.equal((await db.query('select cobranca_private.fee_document($1) d',[doc])).rows[0].d,expected);
const debt=async(external,days,amount='10000',contract_ref=ref)=>{
 await as(admin);const r=await rpc('new_process',{external_ref:external,creditor_id:creditor,debtor_id:debtor,contract_ref,assigned_to:operator,original_amount:amount,due_date:'2025-01-01',financial_mode:'none',interest_percent:'0',fine_percent:'0',grace_days:'0'});
 // Fixture uses historical entry; remove ONLY disposable fixture's classification.
 await raw('delete from cobranca_private.fee_classifications where debt_id=$1',[r.id]);
 await raw("update public.cobranca_debts set created_at='2026-01-01T12:00:00Z',due_date='2026-01-01'::date-$2::int where id=$1",[r.id,days]);
 await as(admin);await rpc('pricing_enroll',{contract_id:contract_ref===ref?contract.id:contractB.id,operation:'confirm',reason:'Test fixture'});return r;
};
const pay=async(d,reference,amount,paid_date='2026-01-10')=>{await as(finance);return rpc('payment',{id:d.id,reference,amount,paid_date,reason:'Confirmed reconciled test payment'});};
const d1=await debt('D1',200);await pay(d1,'PAY1','7000');
let receipt=(await raw('select * from public.cobranca_receipts where reference=$1',['PAY1'])).rows[0];
assert.equal(Number(receipt.fee_amount),1750);assert.equal(receipt.calculation.fee_rate,25);
await as(finance);await assert.rejects(()=>pay(d1,'PAY1','7000'));
// Same CPF, distinct titles remain separate while volume is one debtor.
const d2=await debt('D2',120,'10000');
await as(finance);
const canonical={contract_id:contract.id,id:d2.id,transaction_id:'BANK-123',origin:'bank-a',confirmed:true,reconciled:true,amount:'100',paid_date:'2026-01-10',reason:'Reconciled'};
assert.equal((await rpc('pricing_payment',canonical)).duplicate,false);
assert.equal((await rpc('pricing_payment',canonical)).duplicate,true);
await assert.rejects(()=>rpc('pricing_payment',{...canonical,amount:'101'}));
await assert.rejects(()=>rpc('pricing_payment',{...canonical,confirmed:false}));

const vol=(await raw('select * from cobranca_private.fee_volumes where contract_id=$1',[contract.id])).rows[0];assert.equal(vol.debtors,1);
await as(admin);
const contractB=await rpc('pricing_contract',{creditor_id:creditor,contract_ref:'HON-B',model:'B',starts_on:'2025-01-01',ends_on:'2027-12-31'});
assert.equal(contractB.volume_discount,true);
// Simulations: 800/120d => 18%; 500k/20% => 18k. Mixed portfolio exact total.
const simulate=(args={})=>rpc('pricing_simulate',{creditor_id:creditor,contract_id:contractB.id,model:'B',debtors:800,titles:800,recovery_percent:'20',bands:['0','0','500000','0','0'],cost:'0',...args});
let sim=await simulate();assert.equal(sim.discount,2);assert.equal(sim.rows[2].rate,18);assert.equal(sim.recovered,100000);assert.equal(sim.fees,18000);
sim=await simulate({debtors:600,titles:600,recovery_percent:100,bands:['24000','27000','20000','12000','8000']});assert.equal(sim.recovered,91000);assert.equal(sim.fees,14030);assert.equal(sim.billing,14030);assert.equal(sim.minimum,1990);
sim=await simulate({debtors:600,titles:600,recovery_percent:100,bands:['10000','0','0','0','0']});assert.equal(sim.fees,800);assert.equal(sim.management_topup,1190);assert.equal(sim.billing,1990);
sim=await simulate({bands:['0','0','0','0','0']});assert.equal(sim.fees,0);assert.equal(sim.billing,1990);
sim=await rpc('pricing_simulate',{creditor_id:creditor,model:'A',debtors:1,titles:1,recovery_percent:0,bands:['0','0','0','0','0']});assert.equal(sim.billing,0);
await assert.rejects(()=>simulate({bands:['NaN','0','0','0','0']}));
await assert.rejects(()=>simulate({bands:['1.001','0','0','0','0']}));
// Unpaid installments and pre-due titles earn nothing.
const d3=await debt('D3',30,'1000');await as(admin);await rpc('agreement',{id:d3.id,discount_percent:0,down_payment:0,installments:5,first_due_date:'2026-01-10',reason:'Test'});
assert.equal(Number((await raw('select count(*) n from public.cobranca_receipts where debt_id=$1',[d3.id])).rows[0].n),0);
await pay(d3,'PARCEL1','200');assert.equal(Number((await raw('select fee_amount from public.cobranca_receipts where reference=$1',['PARCEL1'])).rows[0].fee_amount),20);
const future=await debt('FUTURE',-10,'1000');await pay(future,'EARLY','100');assert.equal(Number((await raw('select fee_amount from public.cobranca_receipts where reference=$1',['EARLY'])).rows[0].fee_amount),0);
await as(finance);await rpc('pricing_snapshot',{contract_id:contract.id,period:month});
let close=await rpc('pricing_close',{contract_id:contract.id,period:month,operation:'draft'});assert.equal(close.fees,1790);assert.equal(close.management_topup,0);
close=await rpc('pricing_close',{contract_id:contract.id,period:month,operation:'approve',reason:'Reviewed'});const again=await rpc('pricing_close',{contract_id:contract.id,period:month,operation:'approve',reason:'Replay'});assert.equal(again.id,close.id);assert.equal(again.billing,close.billing);
await assert.rejects(()=>pay(d2,'BACKDATED','50'));
await as(finance);await rpc('reverse',{id:d1.id,receipt_id:receipt.id,reason:'Reversal after close'});
assert.equal(Number((await raw('select count(*) n from cobranca_private.fee_entries where receipt_id=$1',[receipt.id])).rows[0].n),2);
const reversal=(await raw("select * from cobranca_private.fee_entries where receipt_id=$1 and kind='reversal'",[receipt.id])).rows[0];assert.equal(Number(reversal.fee),-1750);assert.notEqual(reversal.period.toISOString().slice(0,10),month);assert.equal(reversal.original_period.toISOString().slice(0,10),month);
await as(finance);assert.equal((await rpc('pricing_statement',{contract_id:contract.id,period:month})).billing,1790);
// Historical receipts are never enrolled or recalculated.
await as(admin);const legacy=await rpc('new_process',{external_ref:'LEGACY',creditor_id:creditor,debtor_id:debtor,assigned_to:operator,original_amount:'100',due_date:'2025-01-01',financial_mode:'none',interest_percent:'0',fine_percent:'0',grace_days:'0'});await pay(legacy,'LEGACY','50');
assert.equal(Number((await raw('select fee_amount from public.cobranca_receipts where reference=$1',['LEGACY'])).rows[0].fee_amount),1.5);
// Isolation, config restrictions, no direct private table access, snapshot stability.
await as(manager);await rpc('pricing_list');await assert.rejects(()=>rpc('pricing_contract',{creditor_id:creditor}));await assert.rejects(()=>rpc('pricing_close',{contract_id:contract.id}));
await as(operator);await assert.rejects(()=>rpc('pricing_list'));
await as(other);assert.equal((await rpc('pricing_list')).contracts.length,0);await assert.rejects(()=>rpc('pricing_statement',{contract_id:contract.id}));
await as(admin);await assert.rejects(()=>db.query('select * from cobranca_private.fee_entries'));
assert.equal((await rpc('pricing_snapshot',{contract_id:contract.id,period:month})).debtors,1);
assert.equal(Number((await raw('select count(*) n from cobranca_private.finance_titles')).rows[0].n),0);

// Import preview, title identity, validation, replay and same-document multiple titles.
await as(admin);
const batch={contract_id:contractB.id,batch_id:'BATCH-1',items:[{external_ref:'IMP-1',debtor_name:'Imported',debtor_document:'52998224725',original_amount:'500',due_date:'2025-09-03',entry_date:'2026-01-01'},{external_ref:'IMP-2',debtor_name:'Imported',debtor_document:'529.982.247-25',original_amount:'500',due_date:'2025-09-03',entry_date:'2026-01-01'}]};
assert.equal((await rpc('pricing_import',batch)).errors,0);
assert.equal(Number((await raw("select count(*) n from public.cobranca_debts where external_ref like 'IMP-%'")).rows[0].n),0);
await as(admin);assert.equal((await rpc('pricing_import',{...batch,operation:'confirm'})).count,2);assert.equal((await rpc('pricing_import',{...batch,operation:'confirm'})).duplicate,true);
await assert.rejects(()=>rpc('pricing_import',{...batch,items:[{...batch.items[0],original_amount:'600'}]}));
const bad={...batch,batch_id:'BAD',items:[{...batch.items[0],external_ref:'BAD',due_date:''}]};assert.equal((await rpc('pricing_import',bad)).errors,1);await assert.rejects(()=>rpc('pricing_import',{...bad,operation:'confirm'}));
assert.equal((await rpc('pricing_import',{...batch,batch_id:'DUP',items:[batch.items[0],batch.items[0]]})).errors,1);
assert.equal(Number((await raw("select count(distinct debtor_id) n from public.cobranca_debts where external_ref like 'IMP-%'")).rows[0].n),1);
// 600 actual unique valid documents, 5 bands, repeated CPF across titles.
const cpf=base=>{let str=String(base).padStart(9,'0');for(let j=0;j<2;j++){let sum=[...str].reduce((v,d,i)=>v+Number(d)*(str.length+1-i),0);let digit=(sum*10)%11;str+=digit===10?'0':digit;}return str;};
const docs=Array.from({length:599},(_,i)=>({document:cpf(100000000+i),name:'Volume '+i}));
await raw(`with b as (insert into public.cobranca_debtors(tenant_id,creditor_id,name,document) select $1::uuid,$2::uuid,x.name,x.document from jsonb_to_recordset($3::jsonb) x(name text,document text) returning *) insert into public.cobranca_debts(tenant_id,creditor_id,debtor_id,external_ref,contract_ref,original_amount,current_amount,due_date,created_at,metadata) select tenant_id,creditor_id,id,'VOL:'||document,'HON-B',1000,1000,'2025-09-03','2026-01-01T12:00:00Z','{"financial_terms":{"mode":"none","interest_percent":0,"fine_percent":0,"grace_days":0}}'::jsonb from b`,[tenant,creditor,JSON.stringify(docs)]);
const mixed=[];for(const[i,days,amount]of[[0,10,'24000'],[1,60,'27000'],[2,120,'20000'],[3,200,'12000'],[4,400,'8000']])mixed.push([await debt('MIX'+i,days,amount,'HON-B'),amount]);
for(let i=0;i<mixed.length;i++)await pay(mixed[i][0],'MIX-PAY'+i,mixed[i][1]);
await as(finance);const bClose=await rpc('pricing_close',{contract_id:contractB.id,period:month,operation:'approve',reason:'Reconciled mixed fixture'});
assert.equal(bClose.debtors,600);assert.equal(bClose.discount,2);assert.equal(bClose.recovered,91000);assert.equal(bClose.fees,14030);assert.equal(bClose.billing,14030);assert.equal(bClose.minimum,1990);
// Ledger invoice and collection are explicit and idempotent, not automatic on close.
const invoice=await rpc('pricing_bill',{contract_id:contractB.id,period:month,due_date:'2026-02-10',reason:'Fixture authorization'});assert.equal(invoice.duplicate,false);
assert.equal((await rpc('pricing_bill',{contract_id:contractB.id,period:month,due_date:'2026-02-10',reason:'Replay'})).title_id,invoice.title_id);
await rpc('fin_settle',{id:invoice.title_id,amount:'1000',paid_date:'2026-02-10',reference:'AGENCY-TEST',reason:'Fixture settlement'});
const dash=await rpc('pricing_dashboard',{period:month,creditor_id:creditor});assert.equal(dash.billing,14030);assert.equal(dash.agency_received,1000);assert.equal(dash.agency_fees_received,1000);assert.equal(dash.bands.length,6);assert.ok(dash.evolution.length>0);
// Structural freeze rejects retroactive title/creditor/date mutation.
await raw('select 1');await assert.rejects(()=>db.query("update public.cobranca_debts set due_date=due_date+1 where id=$1",[mixed[0][0].id]));

await as(admin);
await assert.rejects(()=>rpc('pricing_contract',{creditor_id:creditor,contract_ref:ref,model:'A',starts_on:'2026-01-01',ends_on:'2027-01-01'}));
const version1=await rpc('pricing_contract',{creditor_id:creditor,contract_ref:'VERSIONED',model:'B',starts_on:'2026-01-01',ends_on:'2027-01-01'});
await rpc('pricing_snapshot',{contract_id:version1.id,period:'2026-01-01'});
const version2=await rpc('pricing_contract',{creditor_id:creditor,contract_ref:'VERSIONED',model:'B',starts_on:'2026-02-01',ends_on:'2027-01-01'});
assert.equal((await rpc('pricing_snapshot',{contract_id:version1.id,period:'2026-02-01'})).minimum,0);
assert.equal((await rpc('pricing_snapshot',{contract_id:version2.id,period:'2026-02-01'})).minimum,590);
assert.equal((await rpc('pricing_close',{contract_id:version1.id,period:'2026-02-01',operation:'draft'})).billing,0);
assert.equal((await rpc('pricing_close',{contract_id:version2.id,period:'2026-02-01',operation:'draft'})).billing,590);

await as(admin);
const terms={overdue_cutoffs:[7,21,45,120],volume_cutoffs:[2,5,8,11],volume_discounts:[0,2,4,6,9],minimum_fee_rate:1};
const editable=await rpc('pricing_contract',{creditor_id:creditor,contract_ref:'CUSTOM-RATES',model:'B',starts_on:'2026-01-01',ends_on:'2027-12-31',rates:[4,8,12,16,22],minimums:[100,200,300,400,500],volume_discount:true,terms});
assert.deepEqual(editable.terms.overdue_cutoffs,[7,21,45,120]);
const configured=await rpc('pricing_simulate',{creditor_id:creditor,contract_id:editable.id,model:'B',debtors:6,titles:6,recovery_percent:100,bands:[1000,0,0,0,0],cost:0});
assert.equal(configured.discount,4);assert.equal(configured.minimum,300);assert.equal(configured.rows[0].rate,1);assert.equal(configured.fees,10);
const configuredCorporate=await rpc('pricing_simulate',{creditor_id:creditor,contract_id:editable.id,model:'B',debtors:12,titles:12,recovery_percent:100,bands:[1000,0,0,0,0],cost:0});
assert.equal(configuredCorporate.discount,9);assert.equal(configuredCorporate.minimum,500);
for(const [days,band]of [[0,0],[7,1],[8,2],[21,2],[22,3],[45,3],[46,4],[120,4],[121,5]]){
 const x=await raw('select cobranca_private.fee_band_config($1,$2::jsonb) band',[days,JSON.stringify(terms.overdue_cutoffs)]);assert.equal(x.rows[0].band,band);
}
for(const [count,band]of [[1,1],[2,2],[4,2],[5,3],[7,3],[8,4],[10,4],[11,5]]){
 const x=await raw('select cobranca_private.fee_volume_band_config($1,$2::jsonb) band',[count,JSON.stringify(terms.volume_cutoffs)]);assert.equal(x.rows[0].band,band);
}
await as(admin);
for(const invalidTerms of [{...terms,overdue_cutoffs:[7,5,45,120]},{...terms,overdue_cutoffs:[7,null,45,120]},{...terms,volume_cutoffs:[2,5,null,11]},{...terms,volume_discounts:[0,2,4,-1,9]},{...terms,volume_discounts:[0,2,null,6,9]},{...terms,minimum_fee_rate:101}]){
 await assert.rejects(()=>rpc('pricing_contract',{creditor_id:creditor,contract_ref:'INVALID-CUSTOM',model:'B',starts_on:'2026-01-01',ends_on:'2027-12-31',rates:[4,8,12,16,22],terms:invalidTerms}));
}
const largerDiscount=await rpc('pricing_contract',{creditor_id:creditor,contract_ref:'CUSTOM-CORPORATE',model:'B',starts_on:'2026-01-01',ends_on:'2027-12-31',rates:[4,8,12,16,22],minimums:[100,200,300,400,500],volume_discount:true,terms:{...terms,volume_discounts:[0,2,4,6,35]}});
assert.equal(Number(largerDiscount.corporate_discount),35);
const largeConfigured=await rpc('pricing_simulate',{creditor_id:creditor,contract_id:largerDiscount.id,model:'B',debtors:12,titles:12,recovery_percent:100,bands:[1000,0,0,0,0],cost:0});
assert.equal(largeConfigured.discount,35);assert.equal(largeConfigured.rows[0].rate,1);
assert.deepEqual((await rpc('pricing_list')).contracts.find(c=>c.id===contract.id).rates,[10,15,20,25,30]);
console.log('PASS pricing: exact commercial examples; age and volume boundaries; CPF/CNPJ; installments; partial/pre-due payments; immutable legacy; approval/replay; compensated reversal; permissions and tenant isolation. No billing or transfers.');
if(process.env.PRICING_UI==='1'){await as(admin);await (await import('./pricing-ui.mjs')).runPricingUi({db,admin,creditor,contract:contractB});}
await db.close();
