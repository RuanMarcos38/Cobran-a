import test from 'node:test';import assert from 'node:assert/strict';
import {debtorPhones,debtorAddress,debtorContextMarkup,createDebtorContextLoader} from '../web/debtor-context.mjs';
test('debtor header displays all stored contacts and address fields without executing imported HTML',()=>{
 const debtor={name:'<img src=x onerror=alert(1)>',document:'00000000000000',email:'contact@example.invalid',phone:'(47) 99999-1234',phone2:'47999991234',phones:['(47) 3333-1234',{phone:'(47) 3333-1234'}],address:{street:'Rua de teste',number:'10',complement:'Sala 2',district:'Centro',city:'Cidade',state:'SC',zip_code:'00000-000'}};
 assert.deepEqual(debtorPhones(debtor),['(47) 99999-1234','(47) 3333-1234']);assert.equal(debtorAddress(debtor),'Rua de teste, 10, Sala 2 · Centro · Cidade / SC · CEP 00000-000');
 const html=debtorContextMarkup({selection_count:14,debtor_count:1,debtor});assert.match(html,/14 título/);assert.match(html,/contact@example.invalid/);assert.match(html,/Sala 2/);assert.match(html,/&lt;img/);assert.ok(!html.includes('<img'));assert.match(html,/CPF\/CNPJ/);
});
test('empty, mixed, loading and missing data never show a different debtor',()=>{
 assert.match(debtorContextMarkup({}),/Selecione um título/);assert.match(debtorContextMarkup({selection_count:2,debtor_count:2,debtor:null}),/2 devedores/);assert.match(debtorContextMarkup({},'loading'),/Carregando/);assert.match(debtorContextMarkup({selection_count:1,debtor_count:1,debtor:{}}),/Não informado/);assert.match(debtorContextMarkup({},'error'),/Não foi possível/);
 assert.equal(debtorAddress({address:'Rua completa, 4',city:'Cidade / SC',state:'SC'}),'Rua completa, 4 · Cidade / SC');
});
test('rapid selection coalesces requests and suppresses stale or cancelled responses',async()=>{
 let next=0;const timers=new Map(),calls=[],renders=[],pending=new Map();
 const loader=createDebtorContextLoader(ids=>{calls.push(ids);return new Promise((resolve,reject)=>pending.set(ids[0],{resolve,reject}));},(data,status)=>renders.push({data,status}),{schedule:fn=>{timers.set(++next,fn);return next;},cancel:id=>timers.delete(id)});
 loader.update(['a']);loader.update(['a','b']);assert.equal(timers.size,1);let task=timers.values().next().value;timers.clear();const old=task();assert.deepEqual(calls,[['a','b']]);
 loader.update(['c']);task=timers.values().next().value;timers.clear();const current=task();pending.get('c').resolve({debtor:{name:'C'}});await current;pending.get('a').resolve({debtor:{name:'A'}});await old;assert.equal(renders.at(-1).data.debtor.name,'C');
 loader.update(['d']);task=timers.values().next().value;timers.clear();const cancelled=task();loader.clear();pending.get('d').resolve({debtor:{name:'D'}});await cancelled;assert.equal(renders.at(-1).status,'loading');loader.update([]);assert.deepEqual(renders.at(-1),{data:{},status:'ready'});
});
