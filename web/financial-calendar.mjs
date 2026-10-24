// Civil dates: no local timestamps or daylight-saving arithmetic.
export function dateParts(value){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))throw Error('Informe uma data válida.');
 const [y,m,d]=value.split('-').map(Number);
 if(y<1900||y>9999||m<1||m>12||d<1||d>new Date(Date.UTC(y,m,0)).getUTCDate())throw Error('Data inválida.');
 return [y,m,d];
}
export const isoDate=d=>d.toISOString().slice(0,10);
export function monthlyDueDate(value,offset){const [y,m,d]=dateParts(value),first=new Date(Date.UTC(y,m-1+offset,1)),last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0));if(first.getUTCFullYear()<1900||first.getUTCFullYear()>9999)throw Error('Data fora do intervalo permitido.');return isoDate(new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),Math.min(d,last.getUTCDate()))));}
export const paymentFrequencyLabels={monthly:'Mensal',cash:'À vista',daily:'Diário (a cada dia)',weekly:'Semanal (a cada 7 dias)',fortnightly:'Quinzenal (a cada 15 dias)',bimonthly:'Bimestral',quarterly:'Trimestral',semiannual:'Semestral',annual:'Anual',custom:'Personalizado',free:'Datas livres'};
export function recurrence(proposal){
 const frequency=proposal.payment_frequency??'monthly';if(!Object.hasOwn(paymentFrequencyLabels,frequency))throw Error('Selecione uma periodicidade válida.');
 if(frequency==='custom'){const n=Number(proposal.interval_count),unit=proposal.interval_unit;if(!Number.isInteger(n)||n<1||n>3660||!['days','weeks','months'].includes(unit))throw Error('Informe um intervalo inteiro de 1 a 3660 e sua unidade.');return {frequency,count:n,unit};}
 const days={daily:1,weekly:7,fortnightly:15},months={monthly:1,bimonthly:2,quarterly:3,semiannual:6,annual:12,cash:1,free:1};return {frequency,count:days[frequency]||months[frequency],unit:days[frequency]?'days':'months'};
}
export function installmentDueDate(value,offset,frequency='monthly',options={}){
 const rule=recurrence({...options,payment_frequency:frequency});if(!Number.isInteger(offset)||offset<0)throw Error('Parcela inválida.');
 if(rule.unit==='months')return monthlyDueDate(value,offset*rule.count);
 const [y,m,d]=dateParts(value),date=new Date(Date.UTC(y,m-1,d+offset*rule.count*(rule.unit==='weeks'?7:1)));if(date.getUTCFullYear()>9999)throw Error('Data fora do intervalo permitido.');return isoDate(date);
}
export function proposalDates(proposal,count){
 const rule=recurrence(proposal);dateParts(proposal.first_due_date);
 if(rule.frequency==='cash'&&(count!==1||Number(proposal.down_payment||0)!==0))throw Error('À vista exige uma parcela e entrada zero.');
 let dates=proposal.due_dates;if(typeof dates==='string')try{dates=JSON.parse(dates);}catch{throw Error('Cronograma inválido.');}
 if(dates!==undefined&&dates!==null){if(!Array.isArray(dates)||dates.length!==count)throw Error('Confira os vencimentos de todas as parcelas.');dates.forEach(dateParts);if(dates[0]!==proposal.first_due_date)throw Error('O primeiro vencimento deve coincidir com a primeira parcela.');}
 else {if(rule.frequency==='free')throw Error('Escolha os vencimentos das datas livres.');dates=Array.from({length:count},(_,i)=>installmentDueDate(proposal.first_due_date,i,rule.frequency,proposal));}
 for(let i=1;i<dates.length;i++)if(dates[i]<=dates[i-1])throw Error('Os vencimentos devem estar em ordem crescente, sem datas repetidas.');
 return dates;
}
export function frequencyDescription(s){const r=recurrence(s);return r.frequency==='custom'?'A cada '+r.count+' '+({days:'dia(s)',weeks:'semana(s)',months:'mês(es)'}[r.unit]):paymentFrequencyLabels[r.frequency];}
