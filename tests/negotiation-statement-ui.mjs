// Isolated browser fixture: never calls production or writes financial records.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const html=`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/negotiation.css"><body><script type="module">
import {openNegotiation} from '/negotiation.mjs';
const original={principal:'1000.00',interest:'100.00',fine:'20.00',fees:'112.00',total:'1232.00',days:300,due_date:'2026-01-01',configured:true,terms:{mode:'monthly',interest_percent:1,fine_percent:2,fee_percent:10,fee_basis:'updated'}};
window.writes=0;window.errors=[];
const api={rpc:async(action,p)=>{if(action==='detail')return {process:{id:'a',external_ref:'DOC-TESTE',original_amount:'1000',due_date:'2026-01-01',status:'open'},debtor:{name:'Devedor local'},creditor:{name:'Credor local'},agreements:[]};if(action==='quote'){const reduced=p.rate_overrides?.a?.interest_percent==='0.5';const q=reduced?{...original,interest:'50.00',fees:'107.00',total:'1177.00',rate_overrides:p.rate_overrides.a,terms:{...original.terms,interest_percent:0.5,contract_terms:original.terms}}:original;return {...q,as_of:'2026-10-28',snapshot:reduced?'reduced':'original',contract_total:'1232.00',items:[{id:'a',reference:'DOC-TESTE',quote:q}]};}if(action==='agreement'){window.writes++;return {id:'local',total:'1177.00'};}throw Error(action);}};
const modal=(title,body,save)=>{const d=document.createElement('dialog');d.innerHTML='<form><h2>'+title+'</h2>'+body+'<div class="modal-actions"><button type="button" data-cancel>Cancelar</button><button type="submit">Confirmar</button></div></form>';document.body.append(d);d.querySelector('[data-cancel]').onclick=()=>d.close();d.querySelector('form').onsubmit=async e=>{e.preventDefault();try{await save(Object.fromEntries(new FormData(e.target)));d.close();}catch(e){window.errors.push(e.message);}};d.showModal();return d;};
await openNegotiation({api,modal,notify:()=>{},guard:f=>f().catch(e=>window.errors.push(e.message)),profile:{role:'collector',discount_limit:100},refresh:async()=>{}},'a');window.ready=true;
</script>`;
const server=createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}const name=req.url.slice(1);if(!/^[\w.-]+$/.test(name)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',name.endsWith('.mjs')?'text/javascript': 'text/css');res.end(await readFile(new URL('../web/'+name,import.meta.url)));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage({viewport:{width:1366,height:768}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);
 assert.equal(await page.locator('.negotiation-comparison').count(),2);
 await page.locator('[name=discount_percent]').fill('10');
 await page.waitForFunction(()=>document.querySelector('.negotiation-review').textContent.includes('1.108,80'));
 await page.locator('[name=down_payment]').fill('100');await page.locator('[name=installments]').fill('3');await page.locator('[name=installments]').dispatchEvent('change');
 assert.equal(await page.locator('[data-installment-date]').count(),3);
 await page.locator('[name=discount_percent]').fill('0');await page.locator('[name=down_payment]').fill('0');
 await page.locator('[data-rate-key=interest_percent]').fill('0.5');
 await page.waitForFunction(()=>document.querySelector('.negotiation-review').textContent.includes('1.177,00'));
 const comparison=await page.locator('.negotiation-comparison').first().innerText();assert.match(comparison,/1\.232,00/);assert.match(comparison,/55,00/);assert.match(comparison,/50,00%/);
 assert.ok(await page.locator('.negotiation-statement-note').isVisible());
 assert.equal(await page.evaluate(()=>window.writes),0);
 if(process.env.TEST_OUTPUT_DIR){await page.locator('.negotiation-comparison').first().scrollIntoViewIfNeeded();await page.screenshot({path:process.env.TEST_OUTPUT_DIR+'/simulador-desktop.png',fullPage:true});}
 await page.setViewportSize({width:390,height:844});assert.ok(await page.locator('.negotiation-review').isVisible());
 if(process.env.TEST_OUTPUT_DIR){await page.locator('.negotiation-comparison').first().scrollIntoViewIfNeeded();await page.screenshot({path:process.env.TEST_OUTPUT_DIR+'/simulador-celular.png',fullPage:true});}
 await page.locator('[name=reason]').fill('Aceite local de teste');await page.locator('[name=accepted]').check();await page.locator('button[type=submit]').click();
 await page.waitForFunction(()=>window.writes===1);assert.deepEqual(await page.evaluate(()=>window.errors),[]);assert.deepEqual(errors,[]);
 await page.reload();await page.waitForFunction(()=>window.ready);assert.match(await page.locator('.negotiation-comparison').first().innerText(),/1\.232,00/);
 await page.locator('[data-cancel]').click();assert.equal(await page.evaluate(()=>window.writes),0);
 console.log('PASS browser: comparison, live discounts/rates, entry and installments, mobile, confirmation, cancellation and reload; no production calls');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
