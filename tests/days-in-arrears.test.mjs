import test from 'node:test';
import assert from 'node:assert/strict';
import {daysInArrears} from '../web/days-in-arrears.mjs';
import {negotiationTitleRows} from '../web/negotiation.mjs';
test('calendar days match actual November 4 2026 titles',()=>{
 for(const [due,expected] of [['2026-04-28',190],['2026-04-07',211],['2026-03-02',247],['2026-02-02',275],['2026-03-20',229]])assert.equal(daysInArrears(due,'2026-11-04'),expected);
});
test('today, future, leap day and invalid dates',()=>{
 assert.equal(daysInArrears('2026-11-04','2026-11-04'),0);
 assert.equal(daysInArrears('2026-11-05','2026-11-04'),0);
 assert.equal(daysInArrears('2028-02-28','2028-03-01'),2);
 assert.throws(()=>daysInArrears('2026-02-30','2026-11-04'));
});
test('ledger reports overdue days and preserves chargeable grace days',()=>{
 const q={as_of:'2026-11-04',items:[{id:'a',reference:'a',quote:{due_date:'2026-04-28',days:160,principal:'100',interest:'0',fine:'0',fees:'0',total:'100'}}]};
 const [r]=negotiationTitleRows(q);
 assert.equal(r.days,190);assert.equal(r.chargeable_days,160);
});
