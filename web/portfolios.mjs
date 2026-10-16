import {openBordero} from './borderos.mjs';
import {brl} from './money.mjs';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function renderPortfolios({api,guard,navigate,profile},target){
 const l=await api.rpc('lookups',{});let seq=0;
 target.innerHTML=`<div class=toolbar><label>Carteira do credor<select aria-label="Carteira do credor"><option value="">Selecione um credor</option>${l.creditors.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label></div><div class=panel><p>Cada processo pertence a um credor. Escolha uma carteira para consultar seus processos; os dados respeitam as permissões do seu perfil e da sua empresa.</p><div data-portfolio><p>${l.creditors.length?'Selecione uma carteira acima.':'Cadastre o credor em Cadastro › Credores / Clientes para começar.'}</p></div></div>`;
 const select=target.querySelector('select'),pane=target.querySelector('[data-portfolio]');
 const refresh=document.createElement('button');refresh.dataset.portfolioRefresh='';refresh.textContent='Atualizar carteira';target.querySelector('.toolbar').append(refresh);refresh.onclick=()=>select.value?select.onchange():guard(()=>renderPortfolios({api,guard,navigate,profile},target));
 if(['admin','master','supervisor'].includes(profile?.role)){
  const upload=document.createElement('button');upload.textContent='Importar borderô XLS / PDF';upload.onclick=()=>guard(async()=>{if(!select.value)throw Error('Selecione a carteira do credor antes de importar.');openBordero({api,creditor_id:select.value,guard,onImported:async()=>{await select.onchange();}});});target.querySelector('.toolbar').append(upload);
 }
 select.onchange=()=>guard(async()=>{const id=select.value,n=++seq;if(!id){pane.innerHTML='<p>Selecione uma carteira acima.</p>';return;}const d=await api.rpc('processes',{filters:{creditor_id:id,scope:'Todos'},page:1,sort:'created_at',direction:'desc'});if(n!==seq||!pane.isConnected)return;pane.innerHTML=`<h3>${esc(l.creditors.find(c=>c.id===id).name)}</h3><div class=metrics><div class=metric><span>Processos na carteira</span><strong>${esc(d.count)}</strong></div><div class=metric><span>Saldo da carteira</span><strong>${brl(d.total)}</strong></div></div><button data-open-wallet>Consultar processos desta carteira</button>`;pane.querySelector('button').onclick=()=>guard(()=>navigate('Processo','Cobrança',{creditor_id:id,scope:'Todos'}));});
}
