import test from 'node:test';
import assert from 'node:assert/strict';
import {sortTitleRows} from '../web/negotiation-title-sort.mjs';
import {daysInArrears} from '../web/days-in-arrears.mjs';
import {simulateNegotiation} from '../web/negotiation.mjs';
const asOf='2026-11-04';
const list=[
 {id:'C',reference:'Título 001',due_date:'2026-04-28',amount:'6606.30'},
 {id:'A',reference:'Título 004',due_date:'2026-02-02',amount:'36469.29'},
 {id:'E',reference:'Título 003',due_date:'2026-03-02',amount:'200.01'},
 {id:'B',reference:'Título 002',due_date:'2026-04-07',amount:'10.05'},
 {id:'D',reference:'Título 005',due_date:'2026-03-20',amount:'100.00'}
];
test('ascending calendar order by YYYY-MM-DD, never formatted string or amount',()=>{
 const result=sortTitleRows(list);
 assert.deepEqual(result.map(x=>x.due_date),['2026-02-02','2026-03-02','2026-03-20','2026-04-07','2026-04-28']);
 assert.deepEqual(result.map(x=>daysInArrears(x.due_date,asOf)),[275,247,229,211,190]);
 assert.deepEqual(result.map(x=>x.id),['A','E','D','B','C']);
 assert.deepEqual(list.map(x=>x.id),['C','A','E','B','D']);
});
test('descending order and stable tie on persistent ID',()=>{
 const ties=[{id:'z',due_date:'2026-02-02'},{id:'b',due_date:'2026-02-02'},...list];
 assert.deepEqual(sortTitleRows(ties,'desc').slice(0,3).map(x=>x.id),['C','B','D']);
 assert.deepEqual(sortTitleRows(ties).slice(0,3).map(x=>x.id),['A','b','z']);
});
test('missing date last, invalid direction rejected, future title sorted',()=>{
 const rows=[{id:'future',due_date:'2027-01-01'},{id:'missing',due_date:''},...list];
 assert.equal(sortTitleRows(rows)[5].id,'future');
 assert.equal(sortTitleRows(rows).at(-1).id,'missing');
 assert.equal(daysInArrears('2027-01-01',asOf),0);
 assert.throws(()=>sortTitleRows(rows,'recent'));
});
test('row-based actions remain attached to persistent ID and exact amounts',()=>{
 const rows=sortTitleRows(list);
 for(const item of list)assert.equal(rows.find(x=>x.id===item.id).amount,item.amount);
});
test('manual mismatch can be reviewed without discarding payment values',()=>{
 const proposal={discount_percent:'0',down_payment:'20.00',installments:'2',first_due_date:'2027-01-01',payment_amounts:['30.00','40.00']};
 const manual=simulateNegotiation({total:'100.00'},proposal,0);
 assert.equal(manual.balanced,false);
 assert.equal(manual.difference_cents,-1000n);
 assert.deepEqual(manual.schedule.map(x=>x.amount),['20.00','30.00','40.00']);
});
