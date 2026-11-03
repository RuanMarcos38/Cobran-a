import {spawn} from 'node:child_process';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
export async function runPricingUi({db,admin,creditor,contract}){
 const server=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'3011'},windowsHide:true,stdio:'ignore'});
 let browser;
 try{
  for(let i=0;i<40;i++){try{await fetch('http://127.0.0.1:3011/health');break;}catch{await new Promise(r=>setTimeout(r,100));}}
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const page=await browser.newPage({viewport:{width:1366,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/config',r=>r.fulfill({json:{url:'https://test.supabase.co',key:'test-public',name:'Cobrança'}}));
  await page.route('https://test.supabase.co/**',async route=>{
   const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'};const req=route.request();
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
   if(req.url().includes('/auth/v1/token'))return route.fulfill({json:{access_token:'test-token',refresh_token:'fixture',expires_at:Date.now()/1000+3600,user:{id:admin,email:'test@example.invalid'}},headers});
   try{const b=req.postDataJSON();const r=await db.query('select public.cobranca_app($1,$2) result',[b.action,JSON.stringify(b.payload)]);await route.fulfill({json:r.rows[0].result,headers});}
   catch(e){console.error('UI RPC',e.message);await route.fulfill({status:400,json:{message:e.message},headers});}
  });
  await page.goto('http://127.0.0.1:3011/');await page.locator('[name=email]').fill('test@example.invalid');await page.locator('[name=password]').fill('test-password');await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await page.locator('[data-module=Financeiro]').click();await page.locator('[data-section="Precificação e Honorários"]').click();await page.locator('[data-fee=new]').waitFor();assert.ok((await page.locator('#content').innerText()).includes('HON-B'));
  await page.locator('[data-section="Simulador financeiro"]').click();await page.locator('[data-fee=simulate]').click();
  for(const[n,v]of Object.entries({name:'Cenário UI',debtors:'800',titles:'800',band_2:'500000',recovery_percent:'20'}))await page.locator(`dialog [name=${n}]`).fill(v);
  await page.locator('dialog [name=contract_id]').selectOption(contract.id);await page.locator('dialog [name=model]').selectOption('B');await page.locator('dialog [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});await page.getByText('Cenário UI',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Cenário UI · demonstrativo',exact:true}).click();assert.match(await page.locator('dialog').innerText(),/18\.000,00/);assert.match(await page.locator('dialog').innerText(),/PROJEÇÃO/);await page.locator('dialog [data-cancel]').first().click();
  await page.locator('[data-section="Fechamento mensal"]').click();await page.locator('[name=contract_id]').selectOption(contract.id);await page.locator('[name=period]').fill('2026-01-01');await page.locator('[data-fee=statement]').click();assert.match(await page.locator('dialog').innerText(),/14\.030,00/);await page.locator('dialog [data-cancel]').first().click();
  await page.locator('[data-section="Resultado da Cobrança"]').click();await page.locator('[name=period]').fill('2026-01-01');await page.locator('[data-fee=refresh]').click();await page.getByText('14.030,00',{exact:false}).first().waitFor();
  const download=page.waitForEvent('download');await page.locator('[data-fee=export]').click();assert.equal((await download).suggestedFilename(),'resultado-cobranca.csv');
  for(const[width,height]of[[1366,900],[390,844]]){await page.setViewportSize({width,height});assert.equal(await page.locator('[data-fee-dashboard]').isVisible(),true);assert.ok(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth+1),'responsive overflow');}
  assert.deepEqual(errors,[]);console.log('PASS pricing UI: integrated menu, simulator persistence, commercial statement, approved closing, dashboard, CSV and mobile/desktop. Auth fixture; real PostgreSQL RPC.');
 }finally{await browser?.close();server.kill();}
}
