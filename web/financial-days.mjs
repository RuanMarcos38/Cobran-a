// Explicit distinction between elapsed overdue days and chargeable days after contract grace.
// Civil-date arithmetic is UTC based to avoid browser timezone/DST shifts.
// Financial amounts remain exclusively calculated by the backend; this is a read-only explanation.
function dayNumber(value){
 const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''));
 if(!match)throw Error('Data-base ou vencimento inválido');
 const y=Number(match[1]),m=Number(match[2]),d=Number(match[3]);
 const time=Date.UTC(y,m-1,d),dt=new Date(time);
 if(y<1900||y>9999||dt.getUTCFullYear()!==y||dt.getUTCMonth()!==m-1||dt.getUTCDate()!==d)
  throw Error('Data-base ou vencimento inválido');
 return Math.round(time/86400000);
}
export function financialDayBreakdown(quote,asOf){
 const due=quote.due_date,base=quote.as_of||asOf;
 const elapsed=Math.max(0,dayNumber(base)-dayNumber(due));
 const terms=quote.terms?.contract_terms||quote.terms||{};
 const graceRaw=terms.grace_days??0;
 const grace=Number(graceRaw);
 if(!Number.isInteger(grace)||grace<0||grace>365)throw Error('Carência contratual inválida');
 const chargeable=Math.max(0,elapsed-grace);
 const reported=quote.days;
 const mismatch=reported!==undefined&&reported!==null&&Number(reported)!==chargeable;
 return {elapsed,grace,chargeable,backendDays:reported,mismatch,asOf:base};
}
