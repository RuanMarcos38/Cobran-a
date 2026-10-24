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

test('negotiated charge reductions and additional discounts share the same approval limit',()=>{const p={discount_percent:'0',down_payment:'0',installments:'1',first_due_date:'2027-01-01'};assert.throws(()=>simulateNegotiation({total:'800',contract_total:'1000'},p,10),/alçada/);assert.equal(simulateNegotiation({total:'900',contract_total:'1000'},p,10).total,'900.00');assert.throws(()=>simulateNegotiation({total:'900',contract_total:'1000'},{...p,discount_percent:'1'},10),/alçada/);});

test('weekly and fortnightly schedules cross months and leap day with exact cents',()=>{
 const proposal={discount_percent:'0',down_payment:'1.01',installments:'4',first_due_date:'2028-02-23'};
 for(const [frequency,dates] of [['weekly',['2028-02-23','2028-02-23','2028-03-01','2028-03-08','2028-03-15']],['fortnightly',['2028-02-23','2028-02-23','2028-03-09','2028-03-24','2028-04-08']]]){
  const s=simulateNegotiation({total:'100.05'},{...proposal,payment_frequency:frequency},100);
  assert.equal(s.payment_frequency,frequency);assert.deepEqual(s.schedule.map(p=>p.due_date),dates);
  assert.equal(s.schedule.reduce((sum,p)=>sum+cents(p.amount),0n),10005n);
 }
 assert.throws(()=>simulateNegotiation({total:'100'},{...proposal,payment_frequency:'invalid'},100),/periodicidade/);
});
