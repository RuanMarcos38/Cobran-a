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

 await page.keyboard.press('F5');await page.locator('#filters').waitFor();

 await page.getByRole('button',{name:'Pesquisar Cliente',exact:true}).click();await page.locator('dialog .lookup-results button').first().click();await page.locator('dialog').waitFor({state:'hidden'});assert.notEqual(await page.locator('#filters [name=creditor_id]').inputValue(),'');

 await page.getByRole('button',{name:'Consultar',exact:true}).click();await page.locator('[data-row]').first().waitFor();

 for(const [width,height] of [[1920,1080],[1366,768],[1024,768],[768,1024],[390,844]]){

  await page.setViewportSize({width,height});await page.waitForTimeout(100);

  assert.equal(await page.locator('button[data-action=search]').isVisible(),true);

  const horizontal=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);

  assert.equal(horizontal,false,`Página transborda em ${width}x${height}`);

  if(process.env.SCREENSHOT_DIR)await page.screenshot({path:process.env.SCREENSHOT_DIR+`/cobranca-${width}x${height}.png`,fullPage:true});

 }

 await page.locator('[data-module=Relatórios]').click();await page.locator('.metrics').waitFor();


 // Exercise every published navigation entry and report button against the local database.
 await page.setViewportSize({width:1366,height:768});
 for(const module of ['Cadastro','Processo','Financeiro','Comercial','Relatórios']){
  await page.locator(`[data-module="${module}"]`).click();
  const sections=await page.locator('[data-section]').evaluateAll(nodes=>nodes.map(n=>n.dataset.section));
  for(const section of sections){
   await page.locator(`[data-section="${section}"]`).click();
   await page.waitForFunction(()=>document.querySelector('#content').children.length>0);
   await page.locator('[data-action=refresh]').click();
   const dl=page.waitForEvent('download');await page.locator('[data-action=export]').click();assert.equal((await dl).suggestedFilename(),'cobranca.csv');
   if(await page.locator('#report-filter').count()){
    await page.locator('#report-filter [name=start]').fill('2026-01-01');await page.locator('#report-filter [name=end]').fill('2026-12-31');await page.locator('#report-filter button').click();
    await page.evaluate(()=>{window.print=()=>{window.testPrinted=true;};});await page.locator('[data-action=print]').click();assert.equal(await page.evaluate(()=>window.testPrinted),true);
   }
  }
 }
 for(const [module,section,fields] of [
  ['Cadastro','Cadastros auxiliares',{name:'Auxiliar UI'}],
  ['Financeiro','Despesas',{name:'Despesa UI',amount:'30.00',due_date:'2026-10-10',category:'Operação'}],
  ['Comercial','Prospecção',{name:'Prospect UI',document:'654321'}],
  ['Comercial','Agendamentos',{name:'Agenda UI',due_at:'2026-10-12T10:00'}]
 ]){
  await page.locator(`[data-module="${module}"]`).click();await page.locator(`[data-section="${section}"]`).click();await page.locator('[data-action=new]').click();
  for(const [name,value] of Object.entries(fields))await page.locator(`dialog [name="${name}"]`).fill(value);
  await page.locator('dialog [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});await page.locator('[data-row]').first().waitFor();
  await page.locator('[data-row]').first().click();await page.locator('dialog [name=name]').fill(fields.name+' editado');await page.locator('dialog [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});
 }
 await page.locator('[data-action=notifications]').click();await page.locator('dialog').waitFor();await page.locator('dialog [data-cancel]').first().click();
 await page.locator('[data-action=settings]').click();await page.locator('dialog [name=name]').fill('Assessoria UI');await page.locator('dialog [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('.company').textContent.includes('Assessoria UI'));
 assert.equal(await page.locator('#message').innerText(),'');
 await page.getByRole('button',{name:'Sair',exact:true}).click();await page.locator('#login').waitFor();

 assert.deepEqual(errors,[]);

 console.log('PASS UI local: login/logout, cliente, devedor, processo, histórico, pagamento, saldo, F5, painel e cinco resoluções. Supabase Auth foi substituído por fixture de teste; PostgreSQL e RPC reais locais.');

}finally{await browser?.close();server.kill();await db.close();}

