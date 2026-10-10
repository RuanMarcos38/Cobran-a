// PostgreSQL WASM validation; production integration must be separately tested.
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
let base=await readFile(new URL('../database/supabase-schema.sql',import.meta.url),'utf8');
await db.exec(base.replace('create extension if not exists "pgcrypto";',''));
await db.exec(await readFile(new URL('../database/002-app.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../database/003-admin-onboarding.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../database/004-explicit-deny-policies.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../database/005-report-details.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../database/006-security-validation.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../database/007-contract-charges.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../database/008-company-members.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../database/009-client-access.sql',import.meta.url),'utf8'));
const admin='11111111-1111-4111-8111-111111111111',collector='22222222-2222-4222-8222-222222222222',creditor='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444';
const tenant='00000000-0000-0000-0000-000000000000',t2='55555555-5555-4555-8555-555555555555';
await db.exec(`insert into auth.users(id) values('${admin}'),('${collector}'),('${creditor}'),('${other}');insert into public.cobranca_tenants(id,name) values('${t2}','Segundo tenant');insert into public.cobranca_profiles(id,tenant_id,name,role,discount_limit) values('${admin}','${tenant}','Admin','admin',100),('${collector}','${tenant}','Operador','collector',10),('${other}','${t2}','Outro','admin',100);`);
async function as(id){await db.exec(`reset role;set test.uid='${id}';set role authenticated;`);}
async function rpc(action,payload={}){const r=await db.query('select public.cobranca_app($1,$2) result',[action,JSON.stringify(payload)]);return r.rows[0].result;}
const pending='66666666-6666-4666-8666-666666666666';
await db.exec(`insert into auth.users(id,email) values('${pending}','admin-test@example.invalid');insert into cobranca_private.bootstrap(email,tenant_id) values('admin-test@example.invalid','${tenant}');`);
await as(pending);await assert.rejects(()=>db.query('select public.cobranca_claim_admin()'));
await db.exec(`reset role;update auth.users set email_confirmed_at=now() where id='${pending}';set role authenticated;`);
assert.equal((await db.query('select public.cobranca_claim_admin() result')).rows[0].result.ready,true);
assert.equal((await db.query('select public.cobranca_claim_admin() result')).rows[0].result.ready,true);
await as(admin);
const c=(await rpc('save',{entity:'creditors',name:'Credor teste',document:'123',fee_percent:'10'})).id;
const b=(await rpc('save',{entity:'debtors',name:'Devedor teste',document:'456',creditor_id:c})).id;
const d=await rpc('new_process',{external_ref:'P001',creditor_id:c,debtor_id:b,assigned_to:collector,original_amount:'100.00',due_date:'2026-01-01',interest_percent:'0',fine_percent:'0'});
assert.equal((await rpc('processes')).count,1);
assert.equal((await rpc('processes',{filters:{min:'101'}})).count,0);
await rpc('history',{id:d.id,channel:'human',subject:'Contato',content:'Registro de teste'});
await rpc('agreement',{id:d.id,discount_percent:'0',down_payment:'0',installments:'3',first_due_date:'2026-10-10',reason:'Aceite de teste'});
let detail=await rpc('detail',{id:d.id});assert.equal(detail.installments.reduce((s,x)=>s+Math.round(Number(x.amount)*100),0),10000);
await rpc('payment',{id:d.id,amount:'33.34',reference:'TX001',paid_date:'2026-01-02',reason:'Recebimento teste'});
assert.equal(Number((await rpc('detail',{id:d.id})).process.current_amount),66.66);
assert.equal(Number((await rpc('detail',{id:d.id})).installments[0].paid_amount),33.34);
await assert.rejects(()=>rpc('payment',{id:d.id,amount:'1',reference:'TX001',paid_date:'2026-01-02',reason:'Duplicado'}));
assert.equal(Number((await rpc('detail',{id:d.id})).process.current_amount),66.66);
await assert.rejects(()=>rpc('payment',{id:d.id,amount:'100',reference:'TX002',paid_date:'2026-01-02',reason:'Excesso'}));
await as(collector);assert.equal((await rpc('processes')).count,1);
await assert.rejects(()=>rpc('save',{entity:'creditors',name:'Não autorizado'}));
await assert.rejects(()=>rpc('payment',{id:d.id,amount:'1',reference:'TX003',paid_date:'2026-01-02',reason:'Não autorizado'}));
await db.exec(`reset role;update public.cobranca_debts set assigned_to=null where id='${d.id}';set role authenticated;`);
await assert.rejects(()=>rpc('detail',{id:d.id}));
await db.exec(`reset role;update public.cobranca_debts set assigned_to='${collector}' where id='${d.id}';set role authenticated;`);
await as(other);assert.equal((await rpc('processes')).count,0);await assert.rejects(()=>rpc('detail',{id:d.id}));await assert.rejects(()=>rpc('get',{entity:'creditors',id:c}));
await db.exec(`reset role;insert into public.cobranca_profiles(id,tenant_id,name,role,creditor_id) values('${creditor}','${tenant}','Portal','creditor','${c}');`);
await as(creditor);assert.equal((await rpc('processes')).count,1);await assert.rejects(()=>rpc('status',{id:d.id,status:'Em cobrança',reason:'Não autorizado'}));
await assert.rejects(()=>db.exec(`update public.cobranca_debts set current_amount=0 where id='${d.id}'`));
await as(admin);const receipts=await rpc('report',{report:'Recebimentos'});assert.equal(Number(receipts.metrics.recovered),33.34);assert.equal(Number(receipts.metrics.fees),3.33);
await rpc('reverse',{id:d.id,receipt_id:receipts.rows[0].id,reason:'Estorno teste'});assert.equal(Number((await rpc('detail',{id:d.id})).process.current_amount),100);
assert.equal(Number((await rpc('detail',{id:d.id})).installments[0].paid_amount),0);
await assert.rejects(()=>rpc('reverse',{id:d.id,receipt_id:receipts.rows[0].id,reason:'Duplicado'}));
await rpc('import',{entity:'creditors',rows:[{name:'Importado A',document:'789'},{name:'Importado B',document:'012'}]});
assert.equal((await rpc('list',{entity:'creditors'})).count,3);
await assert.rejects(()=>rpc('import',{entity:'creditors',rows:[{name:'Rollback',document:'345'},{name:'',document:'678'}]}));
assert.equal((await rpc('list',{entity:'creditors'})).count,3);
await assert.rejects(()=>rpc('document',{id:d.id,name:'fake.pdf',mime:'application/pdf',content:btoa('not pdf')}));
await rpc('document',{id:d.id,name:'test.pdf',mime:'application/pdf',content:btoa('%PDF-test')});
assert.equal((await rpc('detail',{id:d.id})).documents.length,1);

// Forged identity fields never override server-owned identifiers.
await rpc('save',{entity:'creditors',id:c,name:'Credor teste',fee_percent:'10',tenant_id:t2,role:'master',created_at:'1900-01-01'});
const secure=await rpc('get',{entity:'creditors',id:c});assert.equal(secure.id,c);assert.equal(secure.tenant_id,tenant);assert.notEqual(secure.created_at,'1900-01-01');
const c2=(await rpc('save',{entity:'creditors',name:'Segundo credor',fee_percent:'0'})).id;
await assert.rejects(()=>rpc('save',{entity:'debtors',id:b,name:'Devedor teste',creditor_id:c2}));
assert.equal((await rpc('get',{entity:'debtors',id:b})).creditor_id,c);
await assert.rejects(()=>rpc('history',{id:d.id,channel:'promise',content:'Sem data'}));
await assert.rejects(()=>rpc('agreement',{id:d.id,installments:'2',down_payment:'0',first_due_date:'2026-10-10',reason:'Sem desconto'}));
await assert.rejects(()=>rpc('save',{entity:'creditors',name:'Taxa inválida',fee_percent:'101'}));
await assert.rejects(()=>rpc('save',{entity:'expenses',name:'Despesa inválida',amount:'10',due_date:'2026-10-10',status:'inventado'}));
await assert.rejects(()=>rpc('save',{entity:'leads',name:'Etapa inválida',stage:'inventado'}));
const document=(await rpc('detail',{id:d.id})).documents[0];
const expense=await rpc('save',{entity:'expenses',name:'Despesa sigilosa',amount:'10',due_date:'2026-10-10',status:'Pendente'});
await as(other);
for(const action of ['lookups','processes','report','notifications']){const data=await rpc(action,action==='report'?{report:'Recebimentos'}:{});const encoded=JSON.stringify(data);for(const secret of [c,b,d.id,'Credor teste','Devedor teste','Despesa sigilosa'])assert.ok(!encoded.includes(secret),action+' leaked '+secret);}
for(const [action,payload] of [
 ['get',{entity:'debtors',id:b}],['get',{entity:'expenses',id:expense.id}],['download',{id:document.id}],
 ['save',{entity:'creditors',id:c,name:'Ataque',fee_percent:'0'}],['save',{entity:'debtors',id:b,name:'Ataque',creditor_id:c}],
 ['status',{id:d.id,status:'Em cobrança',reason:'Ataque'}],['history',{id:d.id,channel:'human',content:'Ataque'}],
 ['payment',{id:d.id,amount:'1',reference:'ATTACK',paid_date:'2026-10-10',reason:'Ataque'}],
 ['reverse',{id:d.id,receipt_id:receipts.rows[0].id,reason:'Ataque'}],['distribute',{ids:[d.id],assigned_to:other,reason:'Ataque'}],
 ['document',{id:d.id,name:'attack.pdf',mime:'application/pdf',content:btoa('%PDF-attack')}]
])await assert.rejects(()=>rpc(action,payload),action+' crossed tenants');
await as(admin);assert.equal((await rpc('get',{entity:'creditors',id:c})).name,'Credor teste');assert.equal(Number((await rpc('detail',{id:d.id})).process.current_amount),100);


// Contract interest, fine, grace, partial cash allocation, reversal and snapshots.
const charged=await rpc('new_process',{external_ref:'CHARGES-001',creditor_id:c,debtor_id:b,assigned_to:collector,original_amount:'1000.00',due_date:'2026-01-01',interest_percent:'3',fine_percent:'2',financial_mode:'monthly',grace_days:'0',contract_ref:'CONTRACT-A',financial_frozen:true});
let q=await rpc('quote',{id:charged.id,as_of:'2026-01-31'});assert.equal(Number(q.principal),1000);assert.equal(Number(q.interest),30);assert.equal(Number(q.fine),20);assert.equal(Number(q.total),1050);assert.equal(q.frozen,false);
await rpc('payment',{id:charged.id,amount:'550',reference:'CHARGES-P1',paid_date:'2026-01-31',reason:'Contract payment'});
q=await rpc('quote',{id:charged.id,as_of:'2026-03-02'});assert.equal(Number(q.principal),500);assert.equal(Number(q.interest),15);assert.equal(Number(q.fine),0);assert.equal(Number(q.total),515);
const chargeReceipt=(await rpc('report',{report:'Recebimentos'})).rows.find(x=>x.reference==='CHARGES-P1');assert.equal(Number(chargeReceipt.fee_amount),55);assert.equal(Number(chargeReceipt.calculation.interest),30);
await assert.rejects(()=>rpc('contract',{id:charged.id,contract_ref:'CHANGE',financial_mode:'daily',interest_percent:'1',fine_percent:'2',grace_days:'0'}));
await rpc('reverse',{id:charged.id,receipt_id:chargeReceipt.id,reason:'Correction'});q=await rpc('quote',{id:charged.id,as_of:'2026-03-02'});assert.equal(Number(q.interest),60);assert.equal(Number(q.fine),20);assert.equal(Number(q.total),1080);
const daily=await rpc('new_process',{external_ref:'CHARGES-DAILY',creditor_id:c,debtor_id:b,assigned_to:collector,original_amount:'100.00',due_date:'2026-01-01',interest_percent:'0.1',fine_percent:'2',financial_mode:'daily',grace_days:'5',contract_ref:'CONTRACT-B'});
q=await rpc('quote',{id:daily.id,as_of:'2026-01-06'});assert.equal(Number(q.total),100);
q=await rpc('quote',{id:daily.id,as_of:'2026-01-16'});assert.equal(Number(q.interest),1);assert.equal(Number(q.fine),2);assert.equal(Number(q.total),103);
await rpc('contract',{id:daily.id,contract_ref:'CONTRACT-B-CORRECTED',financial_mode:'monthly',interest_percent:'1',fine_percent:'0',grace_days:'0'});q=await rpc('quote',{id:daily.id,as_of:'2026-01-31'});assert.equal(Number(q.total),101);
await assert.rejects(()=>rpc('payment',{id:daily.id,amount:'0.001',reference:'BAD-CENTS',paid_date:'2026-01-31',reason:'Invalid precision'}));
const beforeAgreement=await rpc('quote',{id:daily.id});await rpc('agreement',{id:daily.id,discount_percent:'10',down_payment:'0',installments:'3',first_due_date:'2026-10-10',reason:'Contract settlement'});
q=await rpc('quote',{id:daily.id});assert.equal(q.frozen,true);assert.equal(Number(q.total),Math.round(Number(beforeAgreement.total)*90)/100);
await as(other);await assert.rejects(()=>rpc('quote',{id:daily.id}));await assert.rejects(()=>rpc('contract',{id:daily.id,contract_ref:'Attack',financial_mode:'none',interest_percent:'0',fine_percent:'0',grace_days:'0'}));await as(admin);


const staff='77777777-7777-4777-8777-777777777777',founder='88888888-8888-4888-8888-888888888888';
await db.exec(`reset role;insert into auth.users(id,email,email_confirmed_at) values('${staff}','staff@example.invalid',null),('${founder}','founder@example.invalid',now());`);await as(admin);
const invitation=await rpc('team',{operation:'save',name:'Staff',email:'staff@example.invalid',role:'collector',discount_limit:'5',active:'true'});
assert.ok((await rpc('team',{operation:'list'})).rows.some(x=>x.id===invitation.id));
await as(other);assert.ok(!(await rpc('team',{operation:'list'})).rows.some(x=>x.id===invitation.id));
await assert.rejects(()=>rpc('team',{operation:'save',id:collector,name:'Attack',role:'admin',discount_limit:'100',active:'true'}));
await assert.rejects(()=>rpc('team',{operation:'save',id:invitation.id,invitation:true,email:'staff@example.invalid',name:'Attack',role:'admin',discount_limit:'100',active:'true'}));
await as(staff);await assert.rejects(()=>db.query("select public.cobranca_membership('claim','{}')"));
await db.exec(`reset role;update auth.users set email_confirmed_at=now() where id='${staff}';`);await as(staff);
assert.equal((await db.query("select public.cobranca_membership('claim','{}') result")).rows[0].result.ready,true);assert.equal((await rpc('profile')).role,'collector');
await assert.rejects(()=>rpc('team',{operation:'list'}));await assert.rejects(()=>rpc('team',{operation:'save',name:'Escalation',email:'evil@example.invalid',role:'admin',discount_limit:'100'}));
await as(founder);assert.equal((await db.query("select public.cobranca_membership('claim','{}') result")).rows[0].result.ready,false);
await db.query("select public.cobranca_membership('create_company',$1)",[JSON.stringify({name:'Independent company',tenant_id:tenant,role:'master'})]);
const own=await rpc('profile');assert.notEqual(own.tenant_id,tenant);assert.notEqual(own.tenant_id,t2);assert.equal(own.role,'admin');assert.equal((await rpc('processes')).count,0);await assert.rejects(()=>rpc('detail',{id:d.id}));
await as(admin);await assert.rejects(()=>rpc('team',{operation:'save',id:admin,name:'Self',role:'collector',discount_limit:'0',active:'true'}));
await rpc('team',{operation:'save',id:staff,name:'Staff inactive',role:'collector',discount_limit:'5',active:'false'});await as(staff);await assert.rejects(()=>rpc('processes'));await assert.rejects(()=>db.query("select public.cobranca_membership('claim','{}')"));await as(admin);


await rpc('save',{entity:'creditors',id:c,name:'Credor teste',fee_percent:'10',group:'FILTER-GROUP'});
await rpc('save',{entity:'debtors',id:b,name:'Devedor teste',creditor_id:c,phone:'(11) 98765-4321'});
const fd=await rpc('new_process',{external_ref:'P-FILTER',creditor_id:c,debtor_id:b,assigned_to:collector,original_amount:'200.00',due_date:'2026-01-01',interest_percent:'0',fine_percent:'0',commercial:'FILTER-COM',carrier:'FILTER-PORT',return_reason:'FILTER-REASON'});
await rpc('payment',{id:fd.id,amount:'10',reference:'FILTER-PAY',paid_date:'2026-01-02',reason:'Filter receipt'});
const today=(await db.query('select current_date::text as date_value')).rows[0].date_value;
for(const [key,value] of Object.entries({search:'P-FILTER',process:'P-FILTER',creditor_id:c,debtor:'Devedor teste',client_code:c,group:'FILTER-GROUP',commercial:'FILTER-COM',carrier:'FILTER-PORT',assigned_to:collector,start:today,end:today,min:'190',max:'190',status:'Parcialmente pago',scope:'Abertos',payment_start:'2026-01-02',payment_end:'2026-01-02',overdue_min:'0',overdue_max:'99999',phone:'98765',return_reason:'FILTER-REASON',inactive_days:'0'})){
 const rows=await rpc('processes',{filters:{process:'P-FILTER',[key]:value}});assert.ok(rows.rows.some(x=>x.id===fd.id),'filter failed: '+key);
}
for(const [key,value] of Object.entries({search:'MISSING',process:'MISSING',creditor_id:t2,debtor:'MISSING',client_code:'MISSING',group:'MISSING',commercial:'MISSING',carrier:'MISSING',assigned_to:other,start:'2099-01-01',end:'1900-01-01',min:'191',max:'189',status:'Suspenso',scope:'Encerrados',payment_start:'2026-01-03',payment_end:'2026-01-01',overdue_min:'99999',overdue_max:'0',phone:'000000',return_reason:'MISSING',inactive_days:'1'})){
 assert.equal((await rpc('processes',{filters:{process:'P-FILTER',[key]:value}})).count,0,'nonmatching filter failed: '+key);
}


// Administrator-controlled client portal; permissions never widen ownership.
await as(admin);
let teamRows=(await rpc('team',{operation:'list'})).rows;
let clientRow=teamRows.find(x=>x.id===creditor);
const permit={processes:true,history:false,documents:false,receipts:false,reports:false,export:false};
await rpc('team',{operation:'save',id:creditor,name:clientRow.name,role:'creditor',creditor_id:c,discount_limit:'0',active:true,client_access:permit});
await as(creditor);
assert.equal((await rpc('detail',{id:d.id})).history.length,0);
assert.equal((await rpc('detail',{id:d.id})).documents.length,0);
for(const [a,payload] of [['export',{entity:'processes'}],['report',{report:'Recebimentos'}],['report',{report:'Painel gerencial'}],['team',{operation:'list'}],['list',{entity:'creditors'}]])await assert.rejects(()=>rpc(a,payload));
await assert.rejects(()=>rpc('team',{operation:'save',id:creditor,...permit}));
await as(admin);
await assert.rejects(()=>rpc('team',{operation:'save',id:creditor,name:clientRow.name,role:'creditor',creditor_id:c,discount_limit:'0',active:true,client_access:{evil:true}}));
await rpc('team',{operation:'save',id:creditor,name:clientRow.name,role:'creditor',creditor_id:c,discount_limit:'0',active:true,client_access:Object.fromEntries(Object.keys(permit).map(k=>[k,true]))});
const hiddenDebtor=(await rpc('save',{entity:'debtors',name:'Outro cliente restrito',creditor_id:c2})).id;
const hiddenDebt=await rpc('new_process',{external_ref:'RESTRICTED-CLIENT',creditor_id:c2,debtor_id:hiddenDebtor,assigned_to:collector,original_amount:'10',due_date:'2026-01-01',interest_percent:'0',fine_percent:'0'});
await rpc('document',{id:hiddenDebt.id,name:'restricted.pdf',mime:'application/pdf',content:btoa('%PDF-restricted')});
const hiddenDoc=(await rpc('detail',{id:hiddenDebt.id})).documents[0];
await as(creditor);await assert.rejects(()=>rpc('detail',{id:hiddenDebt.id}));await assert.rejects(()=>rpc('download',{id:hiddenDoc.id}));assert.equal((await rpc('processes',{filters:{process:'RESTRICTED-CLIENT'}})).count,0);assert.equal((await rpc('lookups')).debtors.some(x=>x.id===hiddenDebtor),false);assert.ok((await rpc('detail',{id:d.id})).history.length>0);await rpc('report',{report:'Recebimentos'});await rpc('export',{entity:'processes'});
await assert.rejects(()=>rpc('report',{report:'Honorários e Repasses'}));
await as(admin);
await rpc('team',{operation:'save',id:creditor,name:clientRow.name,role:'creditor',creditor_id:c,discount_limit:'0',active:true,client_access:{processes:false}});
await as(creditor);await assert.rejects(()=>rpc('processes'));await assert.rejects(()=>rpc('detail',{id:d.id}));assert.equal((await rpc('lookups')).debtors.length,0);
console.log('PASS: client permissions grant/revoke, hidden detail arrays, forged permission rejection and restricted reports.');

await db.exec('reset role');const audit=await db.query('select count(*) n from public.cobranca_audit_logs');assert.ok(Number(audit.rows[0].n)>=7);
console.log('PASS: migrations, CRUD, filtros, histórico, acordo, centavos, pagamento parcial, duplicidade, excesso, estorno, permissões, isolamento, auditoria.');
await db.close();

