import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateNegotiation,monthlyDueDate} from '../web/negotiation.mjs';
import {cents} from '../web/money.mjs';
test('negotiation rounds discounts and distributes cents exactly like PostgreSQL',()=>{
 const s=simulateNegotiation({total:'100.05'},{discount_percent:'10',down_payment:'7.03',installments:'3',first_due_date:'2027-01-31'},10);
 assert.equal(s.total,'90.05');assert.equal(s.discount,'10.00');assert.equal(s.remaining,'83.02');
 assert.deepEqual(s.schedule.map(p=>p.amount),['7.03','27.68','27.67','27.67']);
 assert.equal(s.schedule.reduce((sum,p)=>sum+cents(p.amount),0n),9005n);
 assert.deepEqual(s.schedule.map(p=>p.due_date),['2027-01-31','2027-01-31','2027-02-28','2027-03-31']);
});
test('cash proposal has one payment and no fictitious receipt or deposit',()=>{
 const s=simulateNegotiation({total:'6606.30'},{discount_percent:'5',down_payment:'0',installments:'1',first_due_date:'2027-01-01'},5);
 assert.equal(s.total,'6275.99');assert.equal(s.schedule.length,1);assert.equal(s.schedule[0].label,'À vista');
});
test('invalid offers cannot exceed authorization or create zero-value installments',()=>{
 const valid={discount_percent:'0',down_payment:'0',installments:'1',first_due_date:'2027-01-01'};
 for(const p of [{discount_percent:'10.01'},{discount_percent:'100'},{down_payment:'100'},{down_payment:'-1'},{installments:'121'},{installments:'1.5'},{first_due_date:'2027-02-30'}])assert.throws(()=>simulateNegotiation({total:'100'},{...valid,...p},10));
 assert.throws(()=>simulateNegotiation({total:'0.01'},{...valid,installments:'2'},10));
 assert.equal(monthlyDueDate('2028-01-31',1),'2028-02-29');
});
