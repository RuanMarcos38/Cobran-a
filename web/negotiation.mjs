import {cents,decimal,installments,brl} from './money.mjs';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function dateParts(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))throw Error('Informe um vencimento válido.');const [y,m,d]=value.split('-').map(Number);if(y<1900||y>9999||m<1||m>12||d<1||d>new Date(Date.UTC(y,m,0)).getUTCDate())throw Error('Vencimento inválido.');return [y,m,d];}
export function monthlyDueDate(value,offset){const [y,m,d]=dateParts(value);const first=new Date(Date.UTC(y,m-1+offset,1));const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();return `${first.getUTCFullYear()}-${String(first.getUTCMonth()+1).padStart(2,'0')}-${String(Math.min(d,last)).padStart(2,'0')}`;}
export function simulateNegotiation(quote,proposal,limit=0){
 const base=cents(quote.total),rate=cents(proposal.discount_percent||'0'),maximum=cents(limit);
 if(base<=0n)throw Error('Este título não possui saldo para negociar.');
 if(rate>10000n||rate>maximum)throw Error('Desconto acima da sua alçada. Solicite aprovação do gestor.');
 const total=(base*(10000n-rate)+5000n)/10000n,entry=cents(proposal.down_payment||'0'),count=Number(proposal.installments);
 if(total<=0n||entry>=total)throw Error('A entrada deve ser menor que o valor negociado. Para pagamento à vista, use entrada zero e uma parcela.');
 const parts=installments(decimal(total-entry),count);dateParts(proposal.first_due_date);
 const schedule=[...(entry>0n?[{number:0,label:'Entrada',due_date:proposal.first_due_date,amount:decimal(entry)}]:[]),...parts.map((amount,i)=>({number:i+1,label:count===1&&entry===0n?'À vista':'Parcela '+(i+1),due_date:monthlyDueDate(proposal.first_due_date,i),amount}))];
 return {base:decimal(base),discount:decimal(base-total),total:decimal(total),entry:decimal(entry),remaining:decimal(total-entry),schedule};
}
export async function loadNegotiation(api,id){const detail=await api.rpc('detail',{id});detail.debtor=detail.debtor||await api.rpc('get',{entity:'debtors',id:detail.process.debtor_id});const quote=await api.rpc('quote',{id});return {detail,quote};}
export async function openNegotiation({api,modal,notify,guard,profile,refresh},id){
 if(!['admin','master','supervisor','collector','finance'].includes(profile.role))throw Error('Seu perfil não permite negociar títulos.');
 let {detail,quote}=await loadNegotiation(api,id);const process=detail.process,limit=profile.discount_limit||0;
 const blocked=()=>quote.configured===false?'Configure a regra do contrato antes de formalizar.':detail.agreements.some(a=>a.status==='active')?'Este título já tem acordo ativo. Consulte suas parcelas no processo.':['paid','uncollectible','cancelled','canceled'].includes(process.status)?'Título encerrado: formalização indisponível.':'';
 const input=(name,label,value,type='number',extra='')=>`<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${extra} required></label>`;
 let lastSimulation,proposalText='';
 const dialog=modal('Negociar / simular cobrança',`<section class="negotiation"><header><h3>${esc(detail.debtor.name)} · ${esc(process.external_ref)}</h3>${quote.items?'<details class="negotiation-titles"><summary>'+quote.items.length+' títulos incluídos — conferir</summary><table><tbody>'+quote.items.map(x=>'<tr><td>'+esc(x.reference)+'</td><td>'+brl(x.quote.total)+'</td></tr>').join('')+'</tbody></table></details>':''}<p>Credor: ${esc(detail.creditor.name)} · Atualização: ${esc(quote.as_of)}</p></header><div class="negotiation-balances"><div><small>Principal</small><strong>${brl(quote.principal)}</strong></div><div><small>Juros</small><strong>${brl(quote.interest)}</strong></div><div><small>Multa</small><strong>${brl(quote.fine)}</strong></div><div><small>Saldo atualizado</small><strong data-quote-total>${brl(quote.total)}</strong></div></div><p>Sua alçada de desconto: <strong>${esc(limit)}%</strong>. Simular não altera o título nem registra recebimento.</p><div class="toolbar"><button type="button" data-cash>À vista</button><button type="button" data-split>Parcelar</button><button type="button" data-copy>Copiar proposta</button></div><div class="negotiation-inputs">${input('discount_percent','Desconto (%)','0','number',`min="0" max="${esc(limit)}" step="0.01"`)}${input('down_payment','Entrada (R$)','0','number','min="0" step="0.01"')}${input('installments','Parcelas após a entrada','1','number','min="1" max="120" step="1"')}${input('first_due_date','Primeiro vencimento',today(),'date',`min="${today()}"`)}</div><p class="muted">Quando houver entrada, ela vence junto com a primeira parcela, conforme a regra atual do sistema. As demais parcelas são mensais.</p><div data-negotiation-result aria-live="polite"></div><p data-negotiation-error class="error" role="alert"></p><label>Motivo / aceite do cliente<textarea name="reason" maxlength="2000" placeholder="Registre a proposta aceita e como o cliente confirmou."></textarea></label><label class="negotiation-confirm"><input type="checkbox" name="accepted" value="yes"> O cliente aceitou as condições exibidas e autorizo formalizar este acordo.</label></section>`,async data=>{
  if(data.accepted!=='yes'||!data.reason?.trim())throw Error('Registre o aceite do cliente e confirme as condições antes de formalizar.');
  if(blocked())throw Error(blocked());const simulated=simulateNegotiation(quote,data,limit);
  if(data.first_due_date<today())throw Error('Escolha vencimento a partir de hoje.');
  const fresh=await api.rpc('quote',{id});
  if(cents(fresh.total)!==cents(quote.total)||fresh.as_of!==quote.as_of||fresh.snapshot!==quote.snapshot){quote=fresh;form.elements.accepted.checked=false;dialog.querySelector('[data-quote-total]').textContent=brl(quote.total);draw();throw Error('O saldo foi atualizado. Revise a nova simulação antes de confirmar.');}
  await api.rpc('agreement',{id,expected_snapshot:quote.snapshot,discount_percent:data.discount_percent,down_payment:data.down_payment,installments:data.installments,first_due_date:data.first_due_date,reason:data.reason});
  notify('Acordo formalizado: '+brl(simulated.total)+'. Parcelas registradas; nenhum recebimento foi lançado.');await refresh(id);
 });
 dialog.classList.add('negotiation-dialog');const form=dialog.querySelector('form'),submit=form.querySelector('[type=submit]'),result=dialog.querySelector('[data-negotiation-result]'),error=dialog.querySelector('[data-negotiation-error]');submit.textContent='Formalizar acordo';
 const values=()=>Object.fromEntries(new FormData(form));
 function draw(){
  try{
   const data=values();lastSimulation=simulateNegotiation(quote,data,limit);const s=lastSimulation;
   result.innerHTML=`<div class="negotiation-balances"><div><small>Desconto em reais</small><strong>${brl(s.discount)}</strong></div><div><small>Total negociado</small><strong>${brl(s.total)}</strong></div><div><small>Entrada</small><strong>${brl(s.entry)}</strong></div><div><small>Saldo parcelado</small><strong>${brl(s.remaining)}</strong></div></div><div class="table-wrap"><table><thead><tr><th>Pagamento</th><th>Vencimento</th><th>Valor</th></tr></thead><tbody>${s.schedule.map(p=>`<tr><td>${p.label}</td><td>${p.due_date.split('-').reverse().join('/')}</td><td>${brl(p.amount)}</td></tr>`).join('')}</tbody></table></div>`;
   error.textContent=blocked()||'';submit.disabled=!!blocked()||data.accepted!=='yes'||!data.reason?.trim()||data.first_due_date<today();
   proposalText=`Proposta de negociação\nDevedor: ${detail.debtor.name}\nCredor: ${detail.creditor.name}\nTítulo: ${process.external_ref}\nSaldo atualizado: ${brl(s.base)}\nDesconto: ${brl(s.discount)}\nTotal negociado: ${brl(s.total)}\n`+s.schedule.map(p=>`${p.label}: ${brl(p.amount)} em ${p.due_date.split('-').reverse().join('/')}`).join('\n')+'\nSimulação sujeita à confirmação do saldo e ao aceite do cliente.';
  }catch(e){lastSimulation=null;result.innerHTML='';error.textContent=e.message;submit.disabled=true;}
 }
 form.addEventListener('input',e=>{if(['discount_percent','down_payment','installments','first_due_date'].includes(e.target.name))form.elements.accepted.checked=false;draw();});
 dialog.querySelector('[data-cash]').onclick=()=>{form.elements.down_payment.value='0';form.elements.installments.value='1';form.elements.accepted.checked=false;draw();};
 dialog.querySelector('[data-split]').onclick=()=>{form.elements.installments.value='3';form.elements.accepted.checked=false;draw();};
 dialog.querySelector('[data-copy]').onclick=()=>guard(async()=>{if(!lastSimulation)throw Error('Corrija os dados da simulação.');await navigator.clipboard.writeText(proposalText);notify('Proposta copiada. Nenhuma mensagem foi enviada.');});
 draw();return dialog;
}

export async function openJointNegotiation(ctx,ids){
 const initial=await ctx.api.negotiate('quote',{ids});
 const detail=await ctx.api.rpc('detail',{id:ids[0]});detail.debtor=await ctx.api.rpc('get',{entity:'debtors',id:detail.process.debtor_id});detail.process={...detail.process,external_ref:ids.length+' títulos · proposta conjunta'};
 let first=true;const adapter={rpc:async(action,payload)=>{if(action==='detail')return detail;if(action==='quote'){if(first){first=false;return initial;}return ctx.api.negotiate('quote',{ids});}if(action==='agreement')return ctx.api.negotiate('formalize',{...payload,ids});return ctx.api.rpc(action,payload);}};
 return openNegotiation({...ctx,api:adapter},ids[0]);
}
