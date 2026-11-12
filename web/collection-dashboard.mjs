
import {brl} from './money.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const dateOnly=value=>String(value??'').slice(0,10);
const dateMillis=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)?Date.parse(value+'T00:00:00Z'):NaN;
const businessDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const cents=value=>Math.round(Number(value??0)*100);
const agingLabels=['A vencer','1–30 dias','31–60 dias','61–90 dias','Acima de 90 dias','Sem vencimento disponível'];
const statuses=['Novo','Em análise','Aguardando contato','Em cobrança','Em negociação','Acordo formalizado','Aguardando pagamento','Parcialmente pago','Quitado','Acordo descumprido','Suspenso','Devolvido ao cliente','Encerrado'];
function agingBucket(row,asOf){
 const due=dateMillis(dateOnly(row.due_date));
 if(!Number.isFinite(due))return agingLabels[5];
 const days=(dateMillis(asOf)-due)/86400000;
 return agingLabels[days<=0?0:days<=30?1:days<=60?2:days<=90?3:4];
}
function add(group,key,amount){
 const totals=group.get(key)??{label:key,titles:0,balance:0};
 totals.titles++;totals.balance+=amount;group.set(key,totals);
}
export function summarizeCollection(rows,filters={},asOf=businessDate()){
 const status=new Map(),collectors=new Map(),aging=new Map(),creditors=new Set(),debtors=new Set();
 for(const label of agingLabels)aging.set(label,{label,titles:0,balance:0});
 let titles=0,balance=0,overdue=0,negotiating=0,broken=0;
 for(const row of rows){
  const bucket=agingBucket(row,asOf);
  if(filters.debtor_id&&row.debtor_id!==filters.debtor_id||filters.aging&&filters.aging!==bucket)continue;
  const amount=cents(row.current_amount);
  titles++;balance+=amount;
  if(row.creditor_id)creditors.add(row.creditor_id);
  if(row.debtor_id)debtors.add(row.debtor_id);
  if(row.app_status==='Em negociação')negotiating++;
  if(row.app_status==='Acordo descumprido')broken++;
  if(bucket!==agingLabels[0]&&bucket!==agingLabels[5])overdue+=amount;
  add(status,row.app_status||'Sem situação',amount);
  add(collectors,row.collector_name||'Sem cobrador',amount);
  add(aging,bucket,amount);
 }
 return {titles,balance,overdue,negotiating,broken,creditors:creditors.size,debtors:debtors.size,
  status:[...status.values()].sort((a,b)=>b.titles-a.titles),aging:[...aging.values()],
  collectors:[...collectors.values()].sort((a,b)=>b.titles-a.titles)};
}
export async function loadCollectionDashboard(api,filters={}){
 const {debtor_id,aging,...requestFilters}=filters;
 const selected={creditor_id:requestFilters.creditor_id,assigned_to:requestFilters.assigned_to,status:requestFilters.status,
  start:requestFilters.start,end:requestFilters.end,process:requestFilters.process,commercial:requestFilters.commercial,carrier:requestFilters.carrier,
  scope:requestFilters.scope||'Abertos'};
 const fetchPage=page=>api.rpc('processes',{filters:selected,page,sort:'created_at',direction:'desc'});
 const first=await fetchPage(1);
 const pages=Math.ceil(first.count/25);
 if(pages>80)return {tooLarge:true};
 const rows=new Map(first.rows.map(row=>[row.id,row]));
 for(let page=2;page<=pages;page+=5){
  const batch=await Promise.all(Array.from({length:Math.min(5,pages-page+1)},(_,index)=>fetchPage(page+index)));
  for(const result of batch)for(const row of result.rows)rows.set(row.id,row);
 }
 if(rows.size!==first.count)return {changed:true};
 return summarizeCollection([...rows.values()],{debtor_id,aging});
}
const amounts=value=>brl(value/100);
const select=(name,label,options,value)=>'<label>'+esc(label)+'<select name="'+name+'"><option value="">Todos</option>'+options.map(option=>
 '<option value="'+esc(option.id)+'"'+(option.id===value?' selected':'')+'>'+esc(option.name)+'</option>').join('')+'</select></label>';
const input=(name,label,value,type='text')=>'<label>'+esc(label)+'<input type="'+type+'" name="'+name+'" value="'+esc(value)+'"></label>';
const options=values=>values.map(name=>({id:name,name}));
function breakdown(title,rows,field,format){
 const max=Math.max(1,...rows.map(row=>row[field]));
 return '<section class="panel corporate-dashboard-panel"><h3>'+esc(title)+'</h3>'+
  (rows.length?'<ul class="corporate-bars">'+rows.map(row=>'<li><div><span>'+esc(row.label)+'</span><strong>'+esc(format(row[field]))+
  '</strong></div><meter min="0" max="'+max+'" value="'+Math.max(0,row[field])+'" aria-label="'+esc(row.label)+'"></meter></li>').join('')+'</ul>':
  '<p>Nenhum título no recorte selecionado.</p>')+'</section>';
}
export function renderCollectionDashboard({target,data,financial,filters,lookups,guard,apply}){
 const debtors=(lookups.debtors||[]).filter(row=>!filters.creditor_id||row.creditor_id===filters.creditor_id);
 const titleOptions=debtors.map(row=>({id:row.id,name:row.name+' · '+((lookups.creditors||[]).find(c=>c.id===row.creditor_id)?.name||'')+' · '+row.id.slice(-6)}));
 const scopes=['Abertos','Todos','Encerrados','Suspensos'];
 const metrics=data.tooLarge||data.changed?[]:[
  ['Saldo dos títulos',amounts(data.balance)],['Saldo vencido',amounts(data.overdue)],['Títulos',data.titles],['Devedores',data.debtors],
  ['Credores',data.creditors],['Títulos em negociação',data.negotiating],['Títulos com acordo descumprido',data.broken]];
 const financialLabels=[['recovered','Valor recuperado'],['fees','Honorários gerados'],['remittances','Valores a repassar']];
 const financialMetrics=financialLabels.filter(([key])=>financial?.[key]!=null);
 const financialSection=financialMetrics.length?'<section class="panel corporate-dashboard-panel"><h3>Resultado financeiro do período</h3>'+
  '<p>Os indicadores financeiros usam apenas o período e as permissões do relatório financeiro.</p><div class="metrics">'+financialMetrics.map(([key,label])=>
  '<article class="metric"><span>'+esc(label)+'</span><strong>'+esc(brl(financial[key]))+'</strong></article>').join('')+'</div></section>':'';
 target.innerHTML='<div class="corporate-dashboard"><form class="panel corporate-dashboard-filters">'+
  select('creditor_id','Carteira / credor',lookups.creditors||[],filters.creditor_id)+select('debtor_id','Devedor',titleOptions,filters.debtor_id)+
  select('assigned_to','Cobrador',lookups.users||[],filters.assigned_to)+select('status','Situação',options(statuses),filters.status)+
  input('start','Cadastro a partir de',filters.start,'date')+input('end','Cadastro até',filters.end,'date')+
  '<details'+(['aging','process','commercial','carrier','scope'].some(key=>filters[key])?' open':'')+'><summary>Mais filtros</summary><div>'+
  select('aging','Faixa de atraso',options(agingLabels),filters.aging)+input('process','Título / processo',filters.process)+
  input('commercial','Comercial',filters.commercial)+input('carrier','Portador',filters.carrier)+
  '<label>Processos<select name="scope">'+scopes.map(s=>'<option'+(s===(filters.scope||'Abertos')?' selected':'')+'>'+s+'</option>').join('')+'</select></label></div></details>'+
  '<div class="corporate-filter-actions"><button class="primary" type="submit">Aplicar filtros</button><button type="button" data-clear>Limpar filtros</button></div></form>'+
  (data.tooLarge?'<p class="notice" role="status">O recorte contém mais de 2.000 títulos. Selecione uma carteira ou um período menor para calcular os indicadores.</p>':
   data.changed?'<p class="notice" role="status">A carteira mudou durante a consulta. Aplique os filtros novamente para atualizar o painel.</p>':
   '<div class="metrics">'+metrics.map(([label,value])=>'<article class="metric"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></article>').join('')+'</div>'+
   '<div class="corporate-dashboard-grid">'+breakdown('Saldo por faixa de atraso',data.aging,'balance',amounts)+
   breakdown('Títulos por situação',data.status,'titles',String)+breakdown('Títulos por cobrador',data.collectors,'titles',String)+'</div>')+financialSection+'</div>';
 const form=target.querySelector('form');
 form.elements.creditor_id.onchange=()=>{
  const creditor=form.elements.creditor_id.value;
  const previous=form.elements.debtor_id.value;
  for(const option of form.elements.debtor_id.options){
   const debtor=(lookups.debtors||[]).find(row=>row.id===option.value);
   option.hidden=Boolean(creditor&&debtor&&debtor.creditor_id!==creditor);
  }
  if(previous&&form.elements.debtor_id.selectedOptions[0]?.hidden)form.elements.debtor_id.value='';
 };
 form.onsubmit=event=>{event.preventDefault();guard(async()=>{
  const selected=Object.fromEntries(new FormData(form));
  if(selected.start&&selected.end&&selected.start>selected.end)throw Error('A data inicial deve ser anterior à data final.');
  await apply(selected);
 });};
 target.querySelector('[data-clear]').onclick=()=>guard(()=>apply({}));
}
