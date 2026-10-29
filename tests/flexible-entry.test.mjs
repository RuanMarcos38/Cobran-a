import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateNegotiation} from '../web/negotiation.mjs';
import {installmentDueDate} from '../web/financial-calendar.mjs';
import {proposalRows,proposalPdf,proposalXlsx} from '../web/proposal-export.mjs';
const base={discount_percent:'0',down_payment:'100',down_payment_due_date:'2028-10-30',installments:'3'};
test('entrada independente e parcelas semanais, quinzenais, mensais e a cada 20 dias',()=>{
 for(const [frequency,first,next] of [['weekly','2028-11-06','2028-11-13'],['fortnightly','2028-11-14','2028-11-29'],['monthly','2028-11-30','2028-12-30'],['every20days','2028-11-19','2028-12-09']]){
  assert.equal(installmentDueDate(base.down_payment_due_date,1,frequency),first);
  const s=simulateNegotiation({total:'1000.01'},{...base,first_due_date:first,payment_frequency:frequency});
  assert.deepEqual(s.schedule.slice(0,3).map(x=>x.due_date),['2028-10-30',first,next]);
  assert.equal(s.schedule.reduce((n,x)=>n+Math.round(Number(x.amount)*100),0),100001);
 }
});
test('primeira parcela não pode coincidir com entrada nem antecedê-la; datas individuais preservadas',()=>{
 for(const first_due_date of ['2028-10-30','2028-10-29'])assert.throws(()=>simulateNegotiation({total:'1000'},{...base,first_due_date}),/depois da entrada/);
 assert.throws(()=>simulateNegotiation({total:'1000'},{...base,first_due_date:'2028-11-01',down_payment_due_date:''}));
 const s=simulateNegotiation({total:'1000'},{...base,first_due_date:'2028-11-01',payment_frequency:'free',due_dates:['2028-11-01','2028-11-23','2028-12-12']});
 assert.deepEqual(s.schedule.map(x=>x.due_date),['2028-10-30','2028-11-01','2028-11-23','2028-12-12']);
 const rows=proposalRows({debtor:{name:'Teste'},creditor:{name:'Teste'},process:{external_ref:'T'}},{total:'1000',principal:'1000'},s);
 assert.ok(rows.some(x=>x[0]==='Entrada'&&x[1]==='30/10/2028'));
 assert.ok(proposalPdf(rows).length>0);assert.ok(proposalXlsx(rows).length>0);
});
