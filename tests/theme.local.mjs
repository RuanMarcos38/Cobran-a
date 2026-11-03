import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
 const page=await browser.newPage();await page.setContent('<html lang="pt-BR"><body><div class="app-main"><header class="topbar"><input id="global-search" value="Pesquisa"></header><section class="page-heading"><h1>Relatório gerencial</h1></section><main class="workspace"><div class="metrics"><div class="metric"><span>Carteira</span><strong>R$ 10.000,00</strong></div></div></main><footer class="footer">Autenticado</footer></div></body></html>');
 await page.addStyleTag({content:await readFile(new URL('../web/style.css',import.meta.url),'utf8')});
 for(const theme of ['light','dark']){
  await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  for(const selector of ['h1','.metric strong','#global-search','.footer']){
   const ratio=await page.locator(selector).evaluate(el=>{
    const lum=c=>{const v=c.match(/[\d.]+/g).slice(0,3).map(x=>{x=Number(x)/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});return .2126*v[0]+.7152*v[1]+.0722*v[2];};
    let parent=el,bg;do{bg=getComputedStyle(parent).backgroundColor;if(bg!=='rgba(0, 0, 0, 0)')break;parent=parent.parentElement;}while(parent);const a=lum(getComputedStyle(el).color),b=lum(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
   });assert.ok(ratio>=4.5,`${theme} ${selector}: contrast ${ratio}`);
  }
 }
 await page.emulateMedia({media:'print'});assert.equal(await page.locator('.metric strong').evaluate(e=>getComputedStyle(e).color),'rgb(0, 0, 0)');
 console.log('PASS theme: heading, metric, search and footer contrast >=4.5 in both themes; print uses black text.');
}finally{await browser.close();}
