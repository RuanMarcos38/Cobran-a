import {cents,decimal} from './money.mjs';
import {dateParts} from './financial-calendar.mjs';
export function customSchedule(autoSchedule, amounts, expectedTotal) {
 const payments=autoSchedule.filter(p=>p.number>0);
 if(!Array.isArray(amounts)||amounts.length!==payments.length)throw Error('Confira os valores de todas as parcelas.');
 const normalized=amounts.map(value=>{
  const amount=cents(value);
  if(amount<=0n)throw Error('Cada parcela deve ser maior que zero.');
  return decimal(amount);
 });
 const schedule=autoSchedule.map(p=>{
  dateParts(p.due_date);
  return p.number===0?p:{...p,amount:normalized[p.number-1]};
 });
 const total=schedule.reduce((sum,p)=>sum+cents(p.amount),0n);
 const difference=total-cents(expectedTotal);
 return {schedule,distributed:decimal(total),difference_cents:difference,balanced:difference===0n,payment_amounts:normalized};
}
