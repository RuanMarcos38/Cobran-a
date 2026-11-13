import test from 'node:test';
import assert from 'node:assert/strict';
import {planPrincipalAgreement,validateManualAmounts} from '../web/manual-agreement-plan.mjs';
test('Acordo MM Confecção preserva principal, entrada registrada e calendário mensal misto',()=>{
 const plan=planPrincipalAgreement();
 assert.equal(plan.principal,'180507.76');
 assert.equal(plan.paid_entry,'5000.00');
 assert.equal(plan.remaining,'175507.76');
 assert.equal(plan.schedule.length,36);
 assert.deepEqual(plan.due_dates.slice(0,8),['2026-11-15','2026-11-30','2026-12-15','2026-12-30','2027-01-15','2027-01-30','2027-02-15','2027-02-28']);
 assert.deepEqual(plan.due_dates.slice(8,11),['2027-03-10','2027-03-20','2027-03-30']);
 assert.equal(plan.schedule.at(-1).due_date,'2027-12-10');
 assert.equal(plan.schedule.at(-1).amount,'507.76');
 assert.equal(plan.schedule.slice(0,-1).every(x=>x.amount==='5000.00'),true);
 assert.equal(plan.schedule.reduce((a,x)=>a+x.amount_cents,0),17550776);
 assert.equal(validateManualAmounts(plan.installment_amounts,plan.remaining),true);
});
test('Rejeita valores incompatíveis e evita plano que ultrapasse 120 parcelas',()=>{
 assert.throws(()=>validateManualAmounts(['5000','5000'],'175507.76'),/Soma/);
 assert.throws(()=>validateManualAmounts(['-1'],'100'),/inválido/);
 assert.throws(()=>planPrincipalAgreement({amountCents:10}),/120/);
});
