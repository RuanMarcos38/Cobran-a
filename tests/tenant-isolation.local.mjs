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


const as=async id=>db.exec(`reset role;set test.uid='${id}';set role authenticated;`);
const call=async(name,args)=>(await db.query(`select public.${name}($1,$2) result`,args)).rows[0].result;
const rpc=(action,payload={})=>call('cobranca_app',[action,JSON.stringify(payload)]);
const attend=(action,payload={})=>call('cobranca_attendance',[action,JSON.stringify(payload)]);
const negotiate=(action,payload={})=>call('cobranca_negotiate',[action,JSON.stringify(payload)]);
const improve=(action,payload={})=>call('cobranca_improvements',[action,JSON.stringify(payload)]);
const members=(action,payload={})=>call('cobranca_membership',[action,JSON.stringify(payload)]);
const users=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
const fixtures=[];let checks=0;
const ok=(value,message)=>{assert.ok(value,message);checks++;};
const denied=async fn=>{await assert.rejects(fn);checks++;};
for(const [index,id] of users.entries()){
 await db.exec(`reset role;insert into auth.users(id,email,email_confirmed_at) values('${id}','isolation-${index}@example.invalid',now());`);await as(id);
 await members('create_company',{name:'Empresa isolada '+index,tenant_id:'00000000-0000-0000-0000-000000000000'});
 const profile=await rpc('profile');ok(profile.tenant_id!=='00000000-0000-0000-0000-000000000000','Server creates a new tenant and ignores supplied tenant');
 const collector=index?'44444444-4444-4444-8444-444444444444':'33333333-3333-4333-8333-333333333333';
 await db.exec(`reset role;insert into auth.users(id,email,email_confirmed_at) values('${collector}','collector-${index}@example.invalid',now());insert into public.cobranca_profiles(id,tenant_id,name,role,discount_limit) values('${collector}','${profile.tenant_id}','Negociador','collector',10);`);await as(id);
 ok((await attend('accounts')).accounts.length===0,'New company does not inherit attendance accounts');
 const creditor=(await rpc('save',{entity:'creditors',name:'Credor privado '+index,document:'12345678000190',fee_percent:'0',tenant_id:'00000000-0000-0000-0000-000000000000'})).id;
 const debtor=(await rpc('save',{entity:'debtors',name:'Devedor privado '+index,document:'11111111000111',creditor_id:creditor})).id;
 const debt=(await rpc('new_process',{creditor_id:creditor,debtor_id:debtor,assigned_to:id,external_ref:'MESMA-REFERENCIA',original_amount:'100',due_date:'2026-01-01',interest_percent:'0',fine_percent:'0'})).id;
 const opportunity=await rpc('crm_save',{name:'Prospecto privado '+index,stage:'Contato',amount:'500',owner_id:id});
 const finance=await rpc('fin_save',{kind:'receivable',reference:'MESMA-REF',party:'Empresa '+index,amount:'100',due_date:'2027-01-01',creditor_id:creditor});
 const wa=index?'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 await attend('account_save',{id:wa,name:'WhatsApp privado '+index,sector:'collections',channel:'whatsapp',address:'554799999000'+index,members:[],cipher:'encrypted-test-placeholder-only'});
 const thread=await attend('thread_open',{account_id:wa,address:'5547999991111',name:'Contato privado '+index});
 const message=await attend('message_prepare',{thread_id:thread.id,nonce:index?'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',content:'Histórico privado '+index,note:true});
 await rpc('document',{id:debt,name:'privado.pdf',mime:'application/pdf',content:btoa('%PDF-fixture')});
 const detail=await rpc('detail',{id:debt});
 await call('cobranca_email',['config_save',JSON.stringify({cipher:'test-only-private-mailbox-'+index})]);
 await improve('channel_save',{cipher:'test-only-private-whatsapp-'+index});
 const connection=await rpc('ops_connections',{operation:'save',name:'ERP privado',creditor_id:creditor});
 fixtures.push({id,tenant:profile.tenant_id,creditor,debtor,debt,opportunity:opportunity.id,finance:finance.id,wa,thread:thread.id,message:message.id,document:detail.documents[0].id,connection});
}
ok(fixtures[0].tenant!==fixtures[1].tenant,'Separate companies have different tenants');
for(const [index,a] of fixtures.entries()){
 const b=fixtures[1-index];await as(a.id);
 ok((await call('cobranca_email',['config',JSON.stringify({})])).cipher==='test-only-private-mailbox-'+index,'Mailbox secret remains tenant scoped');
 ok((await improve('channel_get')).cipher==='test-only-private-whatsapp-'+index,'WhatsApp secret remains tenant scoped');
 for(const entity of ['creditors','debtors']){const list=await rpc('list',{entity,tenant_id:b.tenant});ok(list.count===1,'Only own records listed');await denied(()=>rpc('get',{entity,id:b[entity==='creditors'?'creditor':'debtor']}));}
 ok((await rpc('processes',{tenant_id:b.tenant})).count===1,'Payload cannot select another company');
 ok((await rpc('export',{entity:'processes'})).every(x=>x.tenant_id===a.tenant),'Exports scoped');
 ok(!(JSON.stringify(await rpc('lookups'))).includes(b.creditor),'Lookups do not disclose other company');
 for(const report of ['Painel gerencial','Financeiro','Títulos Cadastrados','Títulos Captados','Processos do Cliente — Totais','Histórico do Processo','E-mail de Clientes','Análise Gerencial','Recebimentos','Honorários e Repasses']){
  const data=JSON.stringify(await rpc('report',{report}));ok(!data.includes('privado '+(1-index)),'Reports do not disclose other company');
 }
 await denied(()=>rpc('detail',{id:b.debt}));await denied(()=>rpc('quote',{id:b.debt}));await denied(()=>negotiate('quote',{ids:[a.debt,b.debt]}));
 await denied(()=>rpc('download',{id:b.document}));await denied(()=>rpc('status',{id:b.debt,status:'Em cobrança',reason:'Tentativa cruzada'}));
 await denied(()=>rpc('save',{entity:'creditors',id:b.creditor,name:'Ataque'}));await denied(()=>rpc('save',{entity:'debtors',name:'Ataque',creditor_id:b.creditor}));
 await denied(()=>rpc('new_process',{creditor_id:a.creditor,debtor_id:b.debtor,external_ref:'ATAQUE',original_amount:'1',due_date:'2026-01-01',assigned_to:a.id}));
 await denied(()=>rpc('team',{operation:'save',id:b.id,name:'Ataque',role:'admin',discount_limit:'100',active:true}));
 await denied(()=>rpc('crm_detail',{id:b.opportunity}));await denied(()=>rpc('crm_save',{id:b.opportunity,name:'Ataque',stage:'Contato',owner_id:a.id,amount:'100',version:1}));
 await denied(()=>improve('crm_creditor_draft',{id:b.opportunity}));
 ok((await rpc('fin_list')).rows.every(x=>x.tenant_id===a.tenant),'Finance scoped');await denied(()=>rpc('fin_cancel',{id:b.finance,reason:'Tentativa cruzada'}));
 ok((await attend('accounts')).accounts.every(x=>x.tenant_id===a.tenant),'Accounts scoped');
 for(const action of ['account_secret','threads'])await denied(()=>attend(action,{account_id:b.wa}));
 await denied(()=>attend('thread_messages',{thread_id:b.thread}));await denied(()=>attend('message_claim',{thread_id:b.thread,message_id:b.message}));
 await denied(()=>attend('sync',{account_id:b.wa,messages:[]}));
 await denied(()=>rpc('ops_connections',{operation:'save',name:'Ataque',creditor_id:b.creditor}));
 const imported=await call('cobranca_bordero',[a.connection.token,JSON.stringify({tenant_id:b.tenant,creditor_id:b.creditor,external_id:'BOR-ISOLATION',items:[{external_ref:'IMPORT-ISOLATION',original_amount:'10',due_date:'2026-10-01',debtor_name:'Importado',debtor_document:'99999999000199'}]})]);ok(imported.count===1,'Integration accepted only within token owner');
 ok((await rpc('processes')).rows.every(x=>x.tenant_id===a.tenant),'Integration ignores forged tenant');
}
await db.exec('reset role');
const [a,b]=fixtures;
const allocations=[];
for(const company of fixtures){await as(company.id);const q=await negotiate('quote',{ids:[company.debt]});await negotiate('formalize',{ids:[company.debt],expected_snapshot:q.snapshot,discount_percent:'0',down_payment:'0',installments:'3',payment_frequency:'weekly',first_due_date:'2027-01-31',reason:'Aceite fictício de teste local'});await rpc('payment',{id:company.debt,amount:'10',reference:'LOCAL-ISOLATION',paid_date:'2026-01-02',reason:'Recebimento fictício de teste local'});const d=await rpc('detail',{id:company.debt});allocations.push({receipt:(await rpc('report',{report:'Recebimentos'})).rows[0].id,installment:d.installments[0].id});}
await db.exec('reset role');
await denied(()=>db.query('insert into public.cobranca_payment_allocations(receipt_id,installment_id,amount) values($1,$2,1)',[allocations[0].receipt,allocations[1].installment]));

await denied(()=>db.query('update public.cobranca_debts set creditor_id=$1 where id=$2',[b.creditor,a.debt]));
await denied(()=>db.query('update public.cobranca_profiles set tenant_id=$1 where id=$2',[b.tenant,a.id]));
await denied(()=>db.query('update cobranca_private.attendance_accounts set members=$1 where id=$2',[[b.id],a.wa]));
await denied(()=>db.query('update cobranca_private.crm_opportunities set owner_id=$1 where id=$2',[b.id,a.opportunity]));
const tables=(await db.query(`select n.nspname schema,c.relname name,c.relrowsecurity rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and (n.nspname='cobranca_private' or (n.nspname='public' and c.relname like 'cobranca_%'))`)).rows;
ok(tables.every(t=>t.rls),'All application tables have RLS');
for(const role of ['anon','authenticated']){
 await db.exec('reset role;set role '+role);
 for(const t of tables){const grants=(await db.query(`select has_table_privilege(current_user,$1,'SELECT') s,has_table_privilege(current_user,$1,'INSERT') i,has_table_privilege(current_user,$1,'UPDATE') u,has_table_privilege(current_user,$1,'DELETE') d`,[t.schema+'.'+t.name])).rows[0];ok(!Object.values(grants).some(Boolean),'No direct grants: '+t.name);}
}
await db.exec('reset role;set test.uid=\'\';set role anon');await denied(()=>rpc('profile'));await denied(()=>attend('accounts'));await denied(()=>negotiate('quote',{ids:[a.debt]}));
await db.exec('reset role');
const before=(await db.query('select count(*) n from public.cobranca_debts')).rows[0].n;
await db.exec(await readFile(new URL('../database/rollback/034-tenant-isolation-integrity.sql',import.meta.url),'utf8'));
ok((await db.query('select count(*) n from public.cobranca_debts')).rows[0].n===before,'Rollback preserves business data');
await db.exec(await readFile(new URL('../database/034-tenant-isolation-integrity.sql',import.meta.url),'utf8'));
console.log('PASS recuperação: reversão e reaplicação da migração sem alterar os títulos de teste');
console.log('PASS isolamento multempresa: '+checks+' verificações; duas empresas, mesmos documentos/referências, cadastros, títulos, relatórios, arquivos, equipes, CRM, financeiro, atendimento, tokens, propriedade imutável, vínculos e bloqueio de acesso direto.');await db.close();
