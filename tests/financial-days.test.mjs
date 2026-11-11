import test from 'node:test';
import assert from 'node:assert/strict';
import {financialDayBreakdown} from '../web/financial-days.mjs';
const check=(due,elapsed,chargeable,interest)=>{
 const q={as_of:'2026-11-11',due_date:due,days:chargeable,terms:{grace_days:30,mode:'monthly',interest_percent:1}};
 const days=financialDayBreakdown(q);
 assert.deepEqual([days.elapsed,days.chargeable,days.grace,days.mismatch],[elapsed,chargeable,30,false]);
 const cents=Math.round(797000*0.01*days.chargeable/30);
 assert.equal((cents/100).toFixed(2),interest);
};
test('850029: 27/05/2026 => 168 dias vencidos, 138 sujeitos a juros',()=>check('2026-05-27',168,138,'366.62'));
test('850027: 27/03/2026 => 229 dias vencidos, 199 sujeitos a juros',()=>check('2026-03-27',229,199,'528.68'));
test('850028: 27/04/2026 => 198 dias vencidos, 168 sujeitos a juros',()=>check('2026-04-27',198,168,'446.32'));
test('carência zero e vencimento futuro não geram juros antecipados',()=>{
 assert.deepEqual(financialDayBreakdown({due_date:'2026-11-11',terms:{grace_days:0}},'2026-11-11').chargeable,0);
 assert.equal(financialDayBreakdown({due_date:'2026-11-30',terms:{grace_days:30}},'2026-11-11').elapsed,0);
 assert.equal(financialDayBreakdown({due_date:'2026-10-31',days:11,terms:{grace_days:0}},'2026-11-11').chargeable,11);
});
test('diferenças entre backend e condição contratual são detectadas',()=>{
 const v=financialDayBreakdown({due_date:'2026-05-27',as_of:'2026-11-11',days:168,terms:{grace_days:30}});
 assert.equal(v.mismatch,true);assert.equal(v.chargeable,138);
});
test('rejeita datas inválidas e carência inconsistente',()=>{
 assert.throws(()=>financialDayBreakdown({due_date:'2026-02-30',terms:{grace_days:30}},'2026-11-11'),/Data-base/);
 assert.throws(()=>financialDayBreakdown({due_date:'2026-04-27',terms:{grace_days:-1}},'2026-11-11'),/Carência/);
});
