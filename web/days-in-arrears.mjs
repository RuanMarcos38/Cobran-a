// Days past due are calendar-day differences, independent from contractual grace.
export function daysInArrears(dueDate,referenceDate) {
 const parse=value=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value)))throw Error('Data inválida.');
  const [year,month,day]=value.split('-').map(Number);
  const ms=Date.UTC(year,month-1,day);
  const date=new Date(ms);
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)throw Error('Data inválida.');
  return ms;
 };
 return Math.max(0,(parse(referenceDate)-parse(dueDate))/86400000);
}
