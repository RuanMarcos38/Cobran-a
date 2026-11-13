import {brl} from './money.mjs';
import {financialStatement,statementNote} from './negotiation-statement.mjs';
import {authorizeProposalExport,canExportProposal,downloadProposal} from './proposal-export.mjs';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function recoveredStatement(data){
 if(data.components_missing)return null;
 const f=financialStatement(data.quote,data.simulation);
 if(data.original_missing){f.contractUnavailable=true;f.note='Acordo histórico: a composição contratual anterior à redução das taxas não foi preservada. O comparativo utiliza exclusivamente a cotação gravada antes do desconto geral; reduções anteriores não são reconstruídas. O rateio por componente é apenas de apresentação.';}
 return f;
}
export async function openAgreementStatement({api,modal,guard,profile},id){
 const data=await api.agreementStatement(id),s=data.simulation,f=recoveredStatement(data);s.statement=f;
 const table=rows=>'<div class="table-wrap"><table><thead><tr><th>Composição</th><th>'+esc(f?.contractUnavailable?'Saldo registrado antes do desconto geral':'Dívida contratual registrada')+'</th><th>Acordo formalizado</th><th>Desconto</th></tr></thead><tbody>'+rows.map(r=>'<tr><th>'+esc(r.label)+'</th><td>'+brl(r.before)+'</td><td>'+brl(r.after)+'</td><td>'+brl(r.discount)+'</td></tr>').join('')+'</tbody></table></div>';
 const html='<section class="negotiation"><h3>Acordo formalizado · '+esc(s.reference)+'</h3><p>Credor: '+esc(data.detail.creditor.name)+' · Devedor: '+esc(data.detail.debtor.name)+'</p><p>Data-base registrada: '+esc(data.quote.as_of)+' · Situação: '+esc(data.status)+'</p>'+(f?table([...f.rows,{label:'Total',before:f.before,after:f.total,discount:f.discount}])+'<p>'+esc(f.note||statementNote)+'</p>'+f.titles.map(t=>'<details><summary>'+esc(t.reference)+' · '+brl(t.total)+'</summary>'+table(t.rows)+'</details>').join(''):'<p>O acordo antigo não possui memória financeira suficiente para reconstruir seus componentes. Os totais e vencimentos abaixo são os efetivamente gravados.</p>')+'<p>Total a pagar: <strong>'+brl(s.total)+'</strong> · Entrada: '+brl(s.entry)+' · Saldo parcelado: '+brl(s.remaining)+'</p><div class="table-wrap"><table><thead><tr><th>Pagamento</th><th>Vencimento</th><th>Valor gravado</th></tr></thead><tbody>'+s.schedule.map(p=>'<tr><td>'+esc(p.label)+'</td><td>'+esc(p.due_date)+'</td><td>'+brl(p.amount)+'</td></tr>').join('')+'</tbody></table></div>'+(f&&canExportProposal(profile)?'<div class="toolbar"><button type="button" data-recorded-pdf>Baixar PDF</button><button type="button" data-recorded-xlsx>Baixar Excel</button></div>':'')+'</section>';
 const dialog=modal('Demonstrativo do acordo gravado',html,null);dialog.classList.add('negotiation-dialog');
 if(f&&canExportProposal(profile))for(const format of ['pdf','xlsx'])dialog.querySelector('[data-recorded-'+format+']').onclick=()=>guard(async()=>{const authorized=await authorizeProposalExport(api);const fresh=await api.agreementStatement(id);fresh.simulation.statement=recoveredStatement(fresh);if(!fresh.simulation.statement)throw Error('Memória financeira indisponível. Reabra o demonstrativo.');downloadProposal(fresh.detail,fresh.quote,fresh.simulation,format,authorized);});
 return dialog;
}
