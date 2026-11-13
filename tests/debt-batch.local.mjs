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
await db.exec("insert into auth.users(id) values('55555555-5555-4555-8555-555555555555');insert into public.cobranca_profiles(id,tenant_id,name,role) values('55555555-5555-4555-8555-555555555555','"+tenant+"','Segundo cobrador','collector');");
const second='55555555-5555-4555-8555-555555555555';await as(admin);
const c=(await rpc('save',{entity:'creditors',name:'Credor',fee_percent:'0'})).id;
const c2=(await rpc('save',{entity:'creditors',name:'Outro credor',fee_percent:'0'})).id;
const debtor=async(name,document,creditor_id=c)=>(await rpc('save',{entity:'debtors',name,document,creditor_id})).id;
const a=await debtor('Empresa A','12.345.678/0001-90'),a2=await debtor('Empresa A no outro credor','12345678000190',c2),b=await debtor('Empresa B','99999999000199');
await rpc('ops_distribution',{operation:'save',enabled:true,members:[collector,second]});
const create=async(id,ref,creditor_id=c)=>rpc('new_process',{creditor_id,debtor_id:id,external_ref:ref,assigned_to:collector,original_amount:'100',due_date:'2026-10-20',interest_percent:'0',fine_percent:'0'});
const d1=await create(a,'A1'),d2=await create(a,'A2'),d3=await create(b,'B1'),d4=await create(a2,'A3',c2);
const owner=async id=>(await rpc('detail',{id})).process.assigned_to;
assert.equal(await owner(d1.id),await owner(d2.id));assert.equal(await owner(d1.id),await owner(d4.id));assert.notEqual(await owner(d1.id),await owner(d3.id));
await rpc('distribute',{ids:[d1.id],assigned_to:second,reason:'Redistribuição por empresa'});assert.equal(await owner(d2.id),second);assert.equal(await owner(d4.id),second);
await rpc('distribute',{ids:[d1.id],assigned_to:admin,reason:'Preservar responsável administrativo existente'});const d5=await create(a,'A4');assert.equal(await owner(d5.id),admin);
const ids=[d1.id,d2.id];let preview=await rpc('debt_delete_preview',{ids});assert.equal(preview.count,2);assert.equal(Number(preview.total),200);assert.equal(preview.blocked,0);
await assert.rejects(()=>rpc('debt_delete_commit',{ids,token:preview.token,reason:'Teste de confirmação'}));
await assert.rejects(()=>rpc('debt_delete_commit',{ids,token:'forged',reason:'Importação incorreta',confirmation:'EXCLUIR'}));
await as(collector);await assert.rejects(()=>rpc('debt_delete_preview',{ids}));await as(other);await assert.rejects(()=>rpc('debt_delete_preview',{ids}));await as(admin);
await rpc('history',{id:d1.id,channel:'human',subject:'Contato',content:'Histórico que precisa ser preservado'});preview=await rpc('debt_delete_preview',{ids});assert.equal(preview.blocked,1);await assert.rejects(()=>rpc('debt_delete_commit',{ids,token:preview.token,reason:'Importação incorreta',confirmation:'EXCLUIR'}));assert.equal((await rpc('detail',{id:d2.id})).process.id,d2.id);
preview=await rpc('debt_delete_preview',{ids:[d2.id]});const result=await rpc('debt_delete_commit',{ids:[d2.id],token:preview.token,reason:'Importação incorreta confirmada',confirmation:'EXCLUIR'});assert.equal(result.deleted,1);await assert.rejects(()=>rpc('detail',{id:d2.id}));assert.equal((await rpc('get',{entity:'debtors',id:a})).id,a);
await db.exec('reset role');assert.equal((await db.query("select count(*)::int n from public.cobranca_audit_logs where action='bulk_delete'")).rows[0].n,1);
console.log('PASS: distribuição agrupada entre credores; rodízio por empresa; redistribuição integral; exclusão restrita ao administrador/tenant; confirmação; lote atômico; histórico e cadastros preservados; auditoria');await db.close();


