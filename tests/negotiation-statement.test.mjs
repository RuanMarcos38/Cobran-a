import test from 'node:test';
import assert from 'node:assert/strict';
import {financialStatement,statementQuote,recordedMatches} from '../web/negotiation-statement.mjs';
import {simulateNegotiation} from '../web/negotiation.mjs';
import {proposalRows,proposalPdf,proposalXlsx} from '../web/proposal-export.mjs';
import {cents} from '../web/money.mjs';
import {recoveredStatement} from '../web/agreement-statement.mjs';
const original={principal:'1000',interest:'100',fine:'20',fees:'112',total:'1232',as_of:'2026-10-28'};
const proposal={discount_percent:'0',down_payment:'0',installments:'1',first_due_date:'2027-01-31'};
const sum=values=>values.reduce((n,v)=>n+cents(v),0n);
test('recovered agreement uses exact title totals and identifies missing legacy composition',()=>{
 const quote={...original,items:[{id:'a',reference:'DOC',quote:original,recorded_total:'1200'}]},s={...simulateNegotiation(original,proposal,100),total:'1200',schedule:[{number:1,amount:'1200',due_date:'2027-01-31'}]};
 const data={quote,simulation:s};assert.equal(recoveredStatement(data).titles[0].total,'1200.00');
 const legacy=recoveredStatement({...data,original_missing:true});assert.ok(legacy.contractUnavailable);assert.match(legacy.note,/não foi preservada/);
 assert.equal(recoveredStatement({...data,components_missing:true}),null);
 assert.throws(()=>recoveredStatement({...data,quote:{...quote,items:[{...quote.items[0],recorded_total:'1199'}]}}),/não conciliados/);
});
for(const component of ['none','interest','fine','fees','combined'])test('statement reconciles '+component+' reduction without changing quotes',()=>{
 const q=structuredClone(original);if(component==='combined'){q.interest='50';q.fine='10';q.fees='53';}else if(component!=='none')q[component]='0';
 q.total=String(Number(q.principal)+Number(q.interest)+Number(q.fine)+Number(q.fees));
 const quote={...q,contract_total:original.total,items:[{id:'a',reference:'DOC',quote:{...q,contract_quote:original}}]},before=structuredClone(quote);
 const s=simulateNegotiation(quote,proposal,100),f=financialStatement(quote,s);
 assert.equal(sum(f.rows.map(r=>r.after)),cents(s.total));assert.equal(sum(f.rows.map(r=>r.discount)),cents(original.total)-cents(s.total));
 assert.deepEqual(quote,before);assert.equal(f.titles[0].total,s.total);
});
test('combined rate and general discounts reconcile every cent across titles, components and installments',()=>{
 for(let n=1;n<=80;n++){
  const items=Array.from({length:7},(_,i)=>{const principal=((n+i+1)/100).toFixed(2),total=((n+i+4)/100).toFixed(2);return {id:String(i),reference:'DOC-'+i,quote:{principal,interest:'.01'.replace(/^\./,'0.'),fine:'0.01',fees:'0.01',total}};});
  const quote={total:String(Number(sum(items.map(i=>i.quote.total)))/100),items};
  const s=simulateNegotiation(quote,{...proposal,discount_percent:'7.35',installments:'3',down_payment:'0.01'},100),f=financialStatement(quote,s);
  assert.equal(sum(f.titles.map(t=>t.total)),cents(s.total));
  assert.equal(sum(f.rows.map(r=>r.discount)),cents(f.discount));
  for(const t of f.titles)assert.equal(sum(t.rows.map(r=>r.after)),cents(t.total));
 }
});
test('baseline is fetched read-only, checked for freshness, and never inferred from rates',async()=>{
 const q={...original,total:'1182',contract_total:'1232',items:[{id:'a',quote:{...original,interest:'50',total:'1182',rate_overrides:{interest_percent:'0.5'}}}]};
 let calls=0;const result=await statementQuote(async(action,payload)=>{assert.equal(action,'quote');calls++;return Object.keys(payload.rate_overrides).length?q:{...original,items:[{id:'a',quote:original}]};},{id:'a',rate_overrides:{a:{interest_percent:'0.5'}}});
 assert.equal(calls,2);assert.deepEqual(result.items[0].quote.contract_quote,original);
 await assert.rejects(statementQuote(async()=>({...q,as_of:String(calls++)}),{rate_overrides:{a:{}}}),/alterado/);
 assert.throws(()=>financialStatement(q,simulateNegotiation(q,proposal,100)),/pendente/);
});
test('PDF and Excel carry the same detailed statement and accepted payment total',()=>{
 const quote={...original,items:[{id:'a',reference:'DOC',quote:original}]},s=simulateNegotiation(quote,{...proposal,discount_percent:'10',down_payment:'10',installments:'3'},100);s.statement=financialStatement(quote,s);
 const rows=proposalRows({debtor:{name:'Teste'},creditor:{name:'Credor'},process:{}},quote,s);
 assert.ok(rows.some(r=>r[0]==='Total'&&r[2]===Number(s.total)));
 for(const bytes of [proposalPdf(rows),proposalXlsx(rows)])assert.ok(new TextDecoder('latin1').decode(bytes).includes('DEMONSTRATIVO FINANCEIRO'));
 assert.ok(recordedMatches({total:s.total,schedule:s.schedule},s));
 assert.equal(recordedMatches({total:'1.00'},s),false);
 assert.equal(recordedMatches({total:s.total,schedule:s.schedule.map(p=>({...p,due_date:'2027-02-01'}))},s),false);
});
