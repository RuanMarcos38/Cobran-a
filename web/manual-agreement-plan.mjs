// Calendário editável; não altera títulos ou registra recebimentos.
const iso=(y,m,d)=>new Date(Date.UTC(y,m-1,d)).toISOString().slice(0,10);
const lastDay=(y,m)=>new Date(Date.UTC(y,m,0)).getUTCDate();
export function planPrincipalAgreement({
 principalCents=18050776, paidEntryCents=500000,
 entryDate='2026-10-30', startYear=2026, startMonth=11,
 amountCents=500000
}={}){
 if(!Number.isSafeInteger(principalCents)||!Number.isSafeInteger(paidEntryCents)||!Number.isSafeInteger(amountCents)
  ||principalCents<=0||paidEntryCents<0||paidEntryCents>=principalCents||amountCents<=0)
  throw Error('Valores inválidos');
 const remaining=principalCents-paidEntryCents;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)||new Date(entryDate+'T00:00:00Z').toISOString().slice(0,10)!==entryDate)throw Error('Data da entrada inválida');
 if(startYear!==2026||startMonth!==11)throw Error('Este modelo contratual começa em novembro de 2026');
 const schedule=[];let balance=remaining,y=startYear,m=startMonth;
 while(balance>0){
  if(schedule.length>=120)throw Error('Excedeu 120 parcelas');
  const days=y<2027||y===2027&&m<3?[15,30]:[10,20,30];
  for(const day of days){
   const date=iso(y,m,Math.min(day,lastDay(y,m)));
   if(date<=entryDate)continue;
   const cents=Math.min(balance,amountCents);
   schedule.push({number:schedule.length+1,due_date:date,amount:(cents/100).toFixed(2),amount_cents:cents});
   balance-=cents;
   if(balance===0)break;
  }
  if(++m>12){m=1;y++;}
  if(y>2037)throw Error('Prazo excedido');
 }
 return {principal:(principalCents/100).toFixed(2),paid_entry:(paidEntryCents/100).toFixed(2),
  paid_entry_date:entryDate,remaining:(remaining/100).toFixed(2),
  installment_amounts:schedule.map(x=>x.amount),due_dates:schedule.map(x=>x.due_date),schedule,
  pending_charges:true,prior_entry_requires_receipt_verification:true};
}
export function validateManualAmounts(amounts,expectedTotal){
 if(!Array.isArray(amounts)||amounts.length<1||amounts.length>120)throw Error('Parcelas inválidas');
 const parse=x=>{const s=String(x);if(!/^\d{1,12}(?:\.\d{1,2})?$/.test(s))throw Error('Valor inválido');
 const [a,b='']=s.split('.');const cents=Number(a)*100+Number(b.padEnd(2,'0'));
 if(!Number.isSafeInteger(cents)||cents<=0)throw Error('Valor inválido');return cents;};
 const value=amounts.reduce((acc,x)=>acc+parse(x),0);
 if(value!==parse(expectedTotal))throw Error('Soma das parcelas não corresponde ao saldo negociado');
 return true;
}
