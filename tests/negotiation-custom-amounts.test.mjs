import test from 'node:test';
import assert from 'node:assert/strict';
import {customSchedule} from '../web/negotiation-schedule.mjs';
import {simulateNegotiation} from '../web/negotiation.mjs';

const quote={total:'45000.00'};
const proposal={discount_percent:'0',down_payment:'5000',installments:'3',first_due_date:'2026-12-04',down_payment_due_date:'2026-11-04'};
test('individual amounts preserve cents and dates',()=>{
 const result=simulateNegotiation(quote,{...proposal,due_dates:['2026-12-04','2027-01-15','2027-02-20'],payment_amounts:['10000.00','15000.00','15000.00']},0);
 assert.equal(result.balanced,true);
 assert.deepEqual(result.schedule.map(p=>p.amount),['5000.00','10000.00','15000.00','15000.00']);
 assert.deepEqual(result.schedule.map(p=>p.due_date),['2026-11-04','2026-12-04','2027-01-15','2027-02-20']);
});
test('unequal sum is visible and must block formalization',()=>{
 const result=simulateNegotiation(quote,{...proposal,payment_amounts:['10000','15000','12000']},0);
 assert.equal(result.balanced,false);assert.equal(result.difference_cents,-300000n);
});
test('invalid installment values are rejected',()=>{
 const standard=simulateNegotiation(quote,proposal,0).schedule;
 for(const amounts of [['0','20000','20000'],['-1','20001','20000'],['1.001','19999','20000'],['1','2'],['10','x','39990']])
 assert.throws(()=>customSchedule(standard,amounts,'45000.00'));
});
test('automatic installment distribution stays unchanged',()=>{
 const r=simulateNegotiation(quote,proposal,0);
 assert.equal(r.payment_amounts,null);assert.equal(r.balanced,true);
 assert.deepEqual(r.schedule.map(p=>p.amount),['5000.00','13333.34','13333.33','13333.33']);
});
