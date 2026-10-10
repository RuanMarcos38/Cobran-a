import {spawn} from 'node:child_process';

import {readFile} from 'node:fs/promises';

import assert from 'node:assert/strict';

const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright-core');

const db=new PGlite();

await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);

await db.exec((await readFile(new URL('../database/supabase-schema.sql',import.meta.url),'utf8')).replace('create extension if not exists "pgcrypto";',''));

await db.exec(await readFile(new URL('../database/002-app.sql',import.meta.url),'utf8'));

await db.exec(await readFile(new URL('../database/003-admin-onboarding.sql',import.meta.url),'utf8'));

await db.exec(await readFile(new URL('../database/004-explicit-deny-policies.sql',import.meta.url),'utf8'));

await db.exec(await readFile(new URL('../database/005-report-details.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../database/006-security-validation.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../database/007-contract-charges.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../database/008-company-members.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../database/009-client-access.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../database/010-profile-levels.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../database/011-sectors-api.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../database/012-private-sector-policies.sql',import.meta.url),'utf8'));

const id='11111111-1111-4111-8111-111111111111';

await db.exec(`insert into auth.users(id) values('${id}');insert into public.cobranca_profiles(id,tenant_id,name,role,discount_limit) values('${id}','00000000-0000-0000-0000-000000000000','Administrador de teste','admin',100);set test.uid='${id}';set role authenticated;`);

const server=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'3010'},windowsHide:true,stdio:'ignore'});

let browser;

try{

 for(let i=0;i<30;i++){try{await fetch('http://127.0.0.1:3010/config');break;}catch{await new Promise(r=>setTimeout(r,100));}}

 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});

 const page=await browser.newPage({viewport:{width:1366,height:768}});const errors=[];page.on('pageerror',e=>errors.push(e.message));

 await page.route('**/config',r=>r.fulfill({json:{url:'https://test.supabase.co',key:'test-public',name:'Cobrança'}}));

 await page.route('https://test.supabase.co/**',async route=>{

  const req=route.request(),url=req.url();

  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'};

  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});

  if(url.includes('/auth/v1/logout'))return route.fulfill({json:{},headers});

  if(url.includes('/auth/v1/token'))return route.fulfill({json:{access_token:'test-token',refresh_token:'test-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id,email:'test@example.invalid'}},headers});

  try{const body=req.postDataJSON();const result=await db.query('select public.cobranca_app($1,$2) result',[body.action,JSON.stringify(body.payload)]);await route.fulfill({json:result.rows[0].result,headers});}

  catch(e){await route.fulfill({status:400,json:{message:e.message},headers});}

 });

 await page.goto('http://127.0.0.1:3010');await page.locator('[name=email]').fill('test@example.invalid');await page.locator('[name=password]').fill('test-password');await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.locator('#filters').waitFor();

 await page.locator('[data-module=Cadastro]').click();await page.getByRole('button',{name:'Incluir',exact:true}).click();

 await page.locator('dialog [name=name]').fill('Credor UI');await page.locator('dialog [name=document]').fill('123456');await page.locator('dialog [name=fee_percent]').fill('10');await page.locator('dialog [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});

 await page.locator('[data-section=Devedores]').click();await page.getByRole('button',{name:'Incluir',exact:true}).click();

 await page.locator('dialog [name=name]').fill('Devedor UI');await page.locator('dialog [name=document]').fill('987654');await page.locator('dialog [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});

 await page.locator('[data-module=Processo]').click();await page.getByRole('button',{name:'Novo processo',exact:true}).click();

 await page.locator('dialog [name=external_ref]').fill('UI-001');await page.locator('dialog [name=original_amount]').fill('100.00');await page.locator('dialog [name=due_date]').fill('2026-01-01');await page.locator('dialog [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});

 await page.locator('[data-row]').first().click();await page.getByRole('button',{name:'Registrar atendimento',exact:true}).click();await page.locator('dialog [name=subject]').fill('Teste UI');await page.locator('dialog [name=content]').fill('Atendimento registrado pelo teste');await page.locator('dialog [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});

 await page.getByRole('button',{name:'Registrar recebimento',exact:true}).click();await page.locator('dialog [name=amount]').fill('25.00');await page.locator('dialog [name=reference]').fill('UI-TX-001');await page.locator('dialog [name=paid_date]').fill('2026-01-02');await page.locator('dialog [name=reason]').fill('Recebimento UI');await page.locator('dialog [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});

 await page.waitForFunction(()=>document.querySelector('#content').textContent.includes('75,00')); assert.ok((await page.locator('#content').innerText()).includes('75,00'));


 await page.getByRole('button',{name:'Alterar situação',exact:true}).click();await page.locator('dialog [name=status]').selectOption('Em cobrança');await page.locator('dialog [name=reason]').fill('Status UI');await page.locator('dialog [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});
 await page.getByRole('button',{name:'Negociar / formalizar acordo',exact:true}).click();await page.locator('dialog [name=discount_percent]').fill('10');await page.locator('dialog [name=installments]').fill('3');await page.locator('dialog [name=first_due_date]').fill('2026-10-10');await page.locator('dialog [name=reason]').fill('Aceite UI');await page.locator('dialog [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('#content').textContent.includes('67,50'));
 await page.getByRole('button',{name:'Adicionar documento',exact:true}).click();await page.locator('dialog [name=file]').setInputFiles({name:'ui.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-UI-test')});await page.locator('dialog [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});
 await page.keyboard.press('F9');await page.locator('[data-action^="download:"]').waitFor();const documentDownload=page.waitForEvent('download');await page.locator('[data-action^="download:"]').click();assert.equal((await documentDownload).suggestedFilename(),'ui.pdf');
 await page.keyboard.press('F7');await page.getByRole('button',{name:'Recebimentos / estorno',exact:true}).click();await page.locator('dialog [data-reverse]').click();await page.locator('dialog [name=reason]').fill('Estorno UI');await page.locator('dialog [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('#content').textContent.includes('92,50'));
 await page.keyboard.press('F5');await page.locator('#filters').waitFor();

 await page.getByRole('button',{name:'Pesquisar Cliente',exact:true}).click();await page.locator('dialog .lookup-results button').first().click();await page.locator('dialog').waitFor({state:'hidden'});assert.notEqual(await page.locator('#filters [name=creditor_id]').inputValue(),'');

 await page.getByRole('button',{name:'Consultar',exact:true}).click();await page.locator('[data-row]').first().waitFor();

 for(const [width,height] of [[1920,1080],[1366,768],[1024,768],[768,1024],[600,960],[390,844],[320,700]]){

  await page.setViewportSize({width,height});await page.waitForTimeout(100);

  assert.equal(await page.locator('button[data-action=search]').isVisible(),true);

  const horizontal=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);

  assert.equal(horizontal,false,`Página transborda em ${width}x${height}`);

  if(process.env.SCREENSHOT_DIR)await page.screenshot({path:process.env.SCREENSHOT_DIR+`/cobranca-${width}x${height}.png`,fullPage:true});

 }

 await page.setViewportSize({width:1366,height:768});await page.locator('[data-module=Relatórios]').click();await page.locator('.metrics').waitFor();


 // Exercise every published navigation entry and report button against the local database.
 await page.setViewportSize({width:1366,height:768});
 for(const module of ['Cadastro','Processo','Financeiro','Relatórios']){
  await page.locator(`[data-module="${module}"]`).click();
  const sections=await page.locator(`[data-section][data-parent="${module}"]`).evaluateAll(nodes=>nodes.map(n=>n.dataset.section).filter(s=>!['Regras de comissão','Distribuição automática','Integrações / API'].includes(s)));
  for(const section of sections){
   await page.locator(`[data-section="${section}"]`).click();
   await page.waitForFunction(()=>document.querySelector('#content').children.length>0);
   await page.locator('[data-action=refresh]').click();
   if(await page.locator('[data-action=export]').count()){const dl=page.waitForEvent('download');await page.locator('[data-action=export]').click();assert.equal((await dl).suggestedFilename(),'cobranca.csv');}
   if(await page.locator('#report-filter').count()){
    await page.locator('#report-filter [name=start]').fill('2026-01-01');await page.locator('#report-filter [name=end]').fill('2026-12-31');await page.locator('#report-filter button').click();
    await page.evaluate(()=>{window.print=()=>{window.testPrinted=true;};});await page.locator('[data-action=print]').click();assert.equal(await page.evaluate(()=>window.testPrinted),true);
   }
  }
 }
 for(const [module,section,fields] of [
  ['Cadastro','Cadastros auxiliares',{name:'Auxiliar UI'}],
  ['Financeiro','Despesas',{name:'Despesa UI',amount:'30.00',due_date:'2026-10-10',category:'Operação'}],
  
  ['Processo','Agenda da cobrança',{name:'Agenda UI',due_at:'2026-10-12T10:00'}]
 ]){
  await page.locator(`[data-module="${module}"]`).click();await page.locator(`[data-section="${section}"]`).click();await page.locator('[data-action=new]').click();
  for(const [name,value] of Object.entries(fields))await page.locator(`dialog [name="${name}"]`).fill(value);
  await page.locator('dialog [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});await page.locator('[data-row]').first().waitFor();
  await page.locator('[data-row]').first().click();await page.locator('dialog [name=name]').fill(fields.name+' editado');await page.locator('dialog [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});
 }

 await page.locator('[data-module=Cadastro]').click();await page.locator('[data-section=Usuários]').click();await page.locator('[data-action=new]').click();await page.locator('dialog [name=name]').fill('Colaborador UI');await page.locator('dialog [name=email]').fill('collaborator@example.invalid');await page.locator('dialog [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('#content').textContent.includes('Colaborador UI'));
 await page.locator('[data-action=notifications]').click();await page.locator('dialog').waitFor();await page.locator('dialog [data-cancel]').first().click();
 await page.locator('[data-action=settings]').click();await page.locator('dialog [name=name]').fill('Assessoria UI');await page.locator('dialog [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('.company').textContent.includes('Assessoria UI'));

 // Configure new operational screens without touching production records.
 const automaticCollector='99999999-9999-4999-8999-999999999999';
 await db.exec(`reset role;insert into auth.users(id) values('${automaticCollector}');insert into public.cobranca_profiles(id,tenant_id,name,role) values('${automaticCollector}','00000000-0000-0000-0000-000000000000','Negociador automático UI','collector');set role authenticated;`);
 await page.locator('[data-module=Cadastro]').click();await page.locator('[data-section="Regras de comissão"]').click();await page.locator('[data-sector=new]').click();await page.locator('dialog [name=name]').fill('Comissão UI');await page.locator('dialog [name=sector]').selectOption('collections');await page.locator('dialog [name=user_id]').selectOption(automaticCollector);await page.locator('dialog [name=rate]').fill('5');await page.locator('dialog [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});await page.getByText('Comissão UI',{exact:true}).waitFor();
 await page.locator('[data-section="Distribuição automática"]').click();await page.locator('[data-sector=configure]').click();await page.locator('dialog [name=enabled]').selectOption('true');await page.locator(`dialog [name="member_${automaticCollector}"]`).check();await page.locator('dialog [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});await page.getByText('Ativada · 1 negociadores na equipe.',{exact:true}).waitFor();
 await page.locator('[data-section="Integrações / API"]').click();await page.locator('[data-sector=new]').click();await page.locator('dialog [name=name]').fill('Conexão UI');await page.locator('dialog [type=submit]').click();await page.getByRole('heading',{name:'Chave da conexão'}).waitFor();assert.equal((await page.getByLabel('Chave de integração').inputValue()).length,64);await page.locator('dialog [data-cancel]').first().click();await page.locator('[data-sector^="disable:"]').click();await page.getByText('Desativada · Último borderô: Ainda não recebido',{exact:true}).waitFor();
 console.log('PASS operations UI: commission rule, automatic distribution, integration key creation and revocation.');

 await page.locator('[data-module=Processo]').click();await page.locator('[data-action=new]').click();const due=new Date();due.setUTCDate(due.getUTCDate()-30);
 await page.locator('dialog [name=external_ref]').fill('UI-CHARGES');await page.locator('dialog [name=original_amount]').fill('100.00');await page.locator('dialog [name=due_date]').fill(due.toISOString().slice(0,10));await page.locator('dialog [name=contract_ref]').fill('UI-CONTRACT');await page.locator('dialog [name=financial_mode]').selectOption('monthly');await page.locator('dialog [name=interest_percent]').fill('3');await page.locator('dialog [name=fine_percent]').fill('2');await page.locator('dialog [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});await page.locator('[data-row]').filter({hasText:'UI-CHARGES'}).click();await page.waitForFunction(()=>document.querySelector('#content').textContent.includes('105,00'));
 await page.locator('[data-action=contract]').click();await page.locator('dialog [name=financial_mode]').selectOption('daily');await page.locator('dialog [name=interest_percent]').fill('1');await page.locator('dialog [name=fine_percent]').fill('0');await page.locator('dialog [name=grace_days]').fill('5');await page.locator('dialog [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('#content').textContent.includes('125,00'));
 await page.locator('[data-action=payment]').click();await page.locator('dialog [name=amount]').fill('125.00');await page.locator('dialog [name=reference]').fill('UI-CHARGES-PAID');await page.locator('dialog [name=paid_date]').fill(new Date().toISOString().slice(0,10));await page.locator('dialog [name=reason]').fill('Quitação com encargos');await page.locator('dialog [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('#content').textContent.includes('Quitado'));
 assert.match(await page.locator('#message').innerText(),/^$|^Conexão desativada\.$/);
 await page.getByRole('button',{name:'Sair',exact:true}).click();await page.locator('#login').waitFor();



 // Manager / negotiator navigation and user creation controls.
 await db.exec(`reset role;update public.cobranca_profiles set role='supervisor',can_manage_users=false where id='${id}';set role authenticated;`);
 await page.locator('#login [name=email]').fill('test@example.invalid');await page.locator('#login [name=password]').fill('test-password');await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.locator('#filters').waitFor();await page.locator('[data-module=Cadastro]').click();assert.equal(await page.locator('[data-section=Usuários]').count(),0);assert.equal(await page.locator('[data-action=settings]').count(),0);
 await db.exec(`reset role;update public.cobranca_profiles set can_manage_users=true where id='${id}';set role authenticated;`);await page.reload();await page.locator('#filters').waitFor();await page.locator('[data-module=Cadastro]').click();await page.locator('[data-section=Usuários]').click();await page.getByRole('button',{name:'Criar usuário',exact:true}).click();await page.locator('dialog [name=role]').waitFor();assert.deepEqual(await page.locator('dialog [name=role] option').evaluateAll(os=>os.map(o=>o.value)),['collector','creditor']);await page.locator('dialog [name=name]').fill('Negociador criado pelo gestor');await page.locator('dialog [name=email]').fill('manager-created@example.invalid');await page.locator('dialog [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});await page.getByText('Negociador criado pelo gestor',{exact:true}).waitFor();
 await db.exec(`reset role;update public.cobranca_profiles set role='collector',can_manage_users=false where id='${id}';set role authenticated;`);await page.reload();await page.locator('#filters').waitFor();assert.equal(await page.locator('[data-module=Financeiro]').count(),0);await page.locator('[data-module=Cadastro]').click();assert.equal(await page.locator('[data-section=Usuários]').count(),0);assert.equal(await page.locator('[data-section=Clientes]').count(),0);await page.locator('[data-section=Devedores]').click();await page.locator('[data-row]').first().waitFor();await page.locator('[data-row]').first().click();await page.getByRole('heading',{name:'Consultar devedor'}).waitFor();assert.equal(await page.locator('dialog [type=submit]').count(),0);await page.locator('dialog').getByRole('button',{name:'Fechar',exact:true}).click();assert.equal(await page.locator('[data-module=Comercial]').count(),0);await page.locator('[data-module=Processo]').click();await page.locator('[data-section="Agenda da cobrança"]').click();await page.locator('[data-action=new]').click();await page.locator('dialog [name=name]').fill('Agenda do negociador');await page.locator('dialog [name=due_at]').fill('2026-10-12T10:00');await page.locator('dialog [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});await page.getByText('Agenda do negociador',{exact:true}).waitFor();await page.getByRole('button',{name:'Sair',exact:true}).click();await page.locator('#login').waitFor();
 console.log('PASS UI levels: manager delegated user creation, negotiator readonly debtor and personal appointment.');

 // Commercial sector has its own CRM and cannot navigate to collections.
 await db.exec(`reset role;update public.cobranca_profiles set role='commercial' where id='${id}';set role authenticated;`);
 await page.locator('#login [name=email]').fill('test@example.invalid');await page.locator('#login [name=password]').fill('test-password');await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.locator('[data-sector=new]').waitFor();
 assert.equal(await page.locator('[data-module=Processo]').count(),0);assert.equal(await page.locator('[data-module=Cadastro]').count(),0);assert.equal(await page.locator('[data-module=Financeiro]').count(),0);
 await page.locator('[data-sector=new]').click();await page.locator('dialog [name=name]').fill('Oportunidade CRM UI');await page.locator('dialog [name=amount]').fill('1000');await page.locator('dialog [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});await page.getByText('Oportunidade CRM UI',{exact:true}).waitFor();
 await page.locator('[data-move]').first().selectOption('Negociação');await page.locator('.kanban-column').filter({has:page.getByRole('heading',{name:'Negociação'})}).getByText('Oportunidade CRM UI',{exact:true}).waitFor();
 await page.locator('[data-sector^="attend:"]').first().click();await page.locator('dialog [name=subject]').fill('Contato de teste');await page.locator('dialog [name=content]').fill('Registro de atendimento');await page.locator('dialog [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});
 await page.locator('[data-sector^="attend:"]').first().click();await page.getByText('Registro de atendimento',{exact:true}).waitFor();await page.locator('dialog [data-cancel]').first().click();
 await page.locator('[data-section=Agendamentos]').click();await page.locator('[data-sector=new]').click();await page.locator('dialog [name=name]').fill('Agenda CRM UI');await page.locator('dialog [name=due_at]').fill('2026-10-20T10:00');await page.locator('dialog [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});await page.getByText('Agenda CRM UI',{exact:true}).waitFor();
 for(const section of ['Funil / Kanban','Atendimento','Comissões comerciais']){await page.locator(`[data-section="${section}"]`).click();await page.locator('[data-sector=refresh]').waitFor();await page.locator('[data-sector=refresh]').click();}
 await page.locator('[data-action=notifications]').click();await page.getByRole('heading',{name:'Pendências operacionais'}).waitFor();await page.locator('dialog [data-cancel]').first().click();await page.keyboard.press('F7');assert.equal(await page.locator('[data-module=Processo]').count(),0);
 await page.setViewportSize({width:390,height:844});await page.locator('[data-action=menu]').click();await page.locator('[data-section="Funil / Kanban"]').click();assert.equal(await page.evaluate(()=>document.body.classList.contains('menu-open')),false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.locator('[data-sector=refresh]').waitFor();await page.setViewportSize({width:1366,height:768});
 await page.getByRole('button',{name:'Sair',exact:true}).click();await page.locator('#login').waitFor();
 console.log('PASS CRM UI: commercial-only navigation, opportunity creation, Kanban stage, attendance history, task and commissions.');
 // Restricted client menus and administrator-granted capabilities.
 await db.exec(`reset role;update public.cobranca_profiles set role='creditor',creditor_id=(select id from public.cobranca_creditors where name='Credor UI' limit 1) where id='${id}';set role authenticated;`);
 await page.locator('#login [name=email]').fill('test@example.invalid');await page.locator('#login [name=password]').fill('test-password');await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.locator('#filters').waitFor();
 for(const m of ['Cadastro','Financeiro','Comercial','Relatórios'])assert.equal(await page.locator(`[data-module="${m}"]`).count(),0);
 assert.equal(await page.locator('[data-action=export]').count(),0);assert.equal(await page.locator('[data-tab="3"]').count(),0);assert.equal(await page.locator('[data-tab="4"]').count(),0);
 await db.exec(`reset role;update public.cobranca_profiles set client_access='{"processes":true,"history":true,"documents":true,"receipts":true,"reports":true,"export":true}' where id='${id}';set role authenticated;`);await page.reload();await page.locator('#filters').waitFor();
 assert.equal(await page.locator('[data-module=Relatórios]').count(),1);assert.equal(await page.locator('[data-action=export]').count(),1);assert.equal(await page.locator('[data-tab="4"]').count(),1);assert.equal(await page.locator('[data-module=Financeiro]').count(),0);
 await db.exec(`reset role;update public.cobranca_profiles set client_access='{"processes":false,"history":false,"documents":false,"receipts":false,"reports":false,"export":false}' where id='${id}';set role authenticated;`);await page.reload();await page.getByText('Seu administrador ainda não liberou consultas para este acesso.').waitFor();assert.equal(await page.locator('[data-module]').count(),0);
 console.log('PASS UI portal cliente: menus, tabs and export hidden until granted; all consultations revocable.');
 assert.deepEqual(errors,[]);

 console.log('PASS UI local: todos os módulos, relatórios, CSV, impressão acionada, despesas, prospecção, agenda, usuários, documentos, acordo, estorno e encargos contratuais;  login/logout, cliente, devedor, processo, histórico, pagamento, saldo, F5, painel e sete resoluções. Supabase Auth foi substituído por fixture de teste; PostgreSQL e RPC reais locais.');

}finally{await browser?.close();server.kill();await db.close();}

