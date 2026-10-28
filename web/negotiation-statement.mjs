import {cents,decimal,brl} from './money.mjs';
const components=[['principal','Capital'],['interest','Juros'],['fine','Multa'],['fees','Honorários'],['other','Outros encargos']];
const sum=values=>values.reduce((n,v)=>n+v,0n);
const percentage=(discount,base)=>base?decimal((discount*10000n+base/2n)/base):'0.00';
export function recordedMatches(recorded,simulation){
 if(recorded.total!==undefined&&cents(recorded.total)!==cents(simulation.total))return false;
 return !recorded.schedule||(recorded.schedule.length===simulation.schedule.length&&recorded.schedule.every((p,i)=>cents(p.amount)===cents(simulation.schedule[i].amount)&&p.due_date===simulation.schedule[i].due_date));
}
export async function statementQuote(rpc,payload){
 const quote=await rpc('quote',payload);
 if(!Object.keys(payload.rate_overrides||{}).length)return quote;
 const original=await rpc('quote',{...payload,rate_overrides:{}});
 if(original.as_of!==quote.as_of||cents(original.total)!==cents(quote.contract_total))throw Error('Saldo contratual alterado durante a conferência. Recalcule os valores.');
 const originals=new Map((original.items||[]).map(i=>[i.id,i.quote]));
 return {...quote,items:quote.items?.map(i=>{const baseline=originals.get(i.id);if(!baseline)throw Error('Título ausente na conferência contratual.');return {...i,quote:{...i.quote,contract_quote:baseline}};})};
}
// Same cumulative rounding used by joint_negotiation for title totals.
export function allocate(total,weights){
 const base=sum(weights);if(base===0n){if(total!==0n)throw Error('Base de rateio indisponível.');return weights.map(()=>0n);}
 let cumulative=0n,previous=0n;
 return weights.map(w=>{cumulative+=w;const next=(cumulative*total+base/2n)/base;const own=next-previous;previous=next;return own;});
}
function amounts(q){
 const values=components.slice(0,4).map(([key])=>cents(q[key]||0));
 const other=cents(q.total)-sum(values);if(other<0n)throw Error('Componentes da cotação não conciliados.');
 return [...values,other];
}
export function financialStatement(quote,s){
 const items=quote.items||[{id:'single',reference:'Título',quote}];
 const totals=allocate(cents(s.total),items.map(i=>cents(i.quote.total)));
 const titles=items.map((item,index)=>{
  const q=item.quote,original=q.contract_quote||q;
  if(q.rate_overrides&&!q.contract_quote)throw Error('Composição contratual pendente de conferência.');
  const before=amounts(original),current=amounts(q),after=allocate(totals[index],current);
  return {id:item.id,reference:item.reference,original,quote:q,total:decimal(totals[index]),rows:components.map(([key,label],i)=>({key,label,before:decimal(before[i]),after:decimal(after[i]),discount:decimal(before[i]-after[i]),percent:percentage(before[i]-after[i],before[i])}))};
 });
 const rows=components.map(([key,label],i)=>{
  const before=sum(titles.map(t=>cents(t.rows[i].before))),after=sum(titles.map(t=>cents(t.rows[i].after)));
  if(after>before)throw Error('Componente negociado superior à cotação contratual.');
  return {key,label,before:decimal(before),after:decimal(after),discount:decimal(before-after),percent:percentage(before-after,before)};
 });
 const before=sum(rows.map(r=>cents(r.before))),after=sum(rows.map(r=>cents(r.after)));
 if(after!==cents(s.total)||sum(s.schedule.map(p=>cents(p.amount)))!==after)throw Error('Proposta e parcelas não conciliadas.');
 const discount=before-after;
 return {rows,titles,before:decimal(before),total:decimal(after),discount:decimal(discount),percent:before?decimal((discount*10000n+before/2n)/before):'0.00'};
}
export const statementNote='Desconto total sobre a dívida contratual atualizada; percentuais por componente sobre seu valor contratual. O desconto geral é rateado proporcionalmente por título e componente, com arredondamento cumulativo em centavos, apenas para apresentação. Reduções de taxas utilizam as cotações oficiais. Encargos adicionais de parcelamento: não aplicável no simulador atual.';
export function statementText(f){return f.rows.map(r=>`${r.label}: ${brl(r.before)} → ${brl(r.after)} · desconto ${brl(r.discount)}`).join('\n')+`\nDesconto total: ${brl(f.discount)} (${f.percent}% de ${brl(f.before)})\n${statementNote}`;}
