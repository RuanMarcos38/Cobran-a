
import {brl} from './money.mjs';

export function collectionHero(login=false){
 return `<section class="collection-hero${login?' collection-hero-login':''}" aria-label="Gestão de cobrança">
  <img src="https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&amp;fit=crop&amp;w=1800&amp;q=85" alt="" referrerpolicy="no-referrer" fetchpriority="high">
  <div class="collection-hero-copy"><span>Recuperação de crédito</span>
   <h2>Gestão profissional para <em>cobrança</em>, acordos e carteira em aberto</h2>
   <p>Credores, devedores, títulos, contatos, negociações, recebimentos e repasses em uma plataforma.</p>
   ${login?'':`<div class="collection-hero-actions"><a href="#/Processo/Cobran%C3%A7a">Abrir cobranças</a><a href="#/Relat%C3%B3rios/Painel%20gerencial">Ver relatórios</a></div>`}
  </div></section>`;
}

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
 const status=new Map(),collectors=new Map(),aging=new Map(),months=new Map(),creditors=new Set(),debtors=new Set();
 for(const label of agingLabels)aging.set(label,{label,titles:0,balance:0});
 const recent=[];
 let titles=0,balance=0,original=0,missingOriginal=0,overdue=0,negotiating=0,broken=0;
 for(const row of rows){
  const bucket=agingBucket(row,asOf);
  if(filters.debtor_id&&row.debtor_id!==filters.debtor_id||filters.aging&&filters.aging!==bucket)continue;
  const amount=cents(row.current_amount);
  titles++;balance+=amount;
  if(row.original_amount==null)missingOriginal++;else original+=cents(row.original_amount);
  if(['Em negociação','Acordo formalizado','Aguardando pagamento','Parcialmente pago','Acordo descumprido'].includes(row.app_status)&&recent.length<10)recent.push(row);
  if(row.creditor_id)creditors.add(row.creditor_id);
  if(row.debtor_id)debtors.add(row.debtor_id);
  if(row.app_status==='Em negociação')negotiating++;
  if(row.app_status==='Acordo descumprido')broken++;
  if(bucket!==agingLabels[0]&&bucket!==agingLabels[5])overdue+=amount;
  add(status,row.app_status||'Sem situação',amount);
  add(collectors,row.collector_name||'Sem cobrador',amount);
  add(aging,bucket,amount);
  const month=dateOnly(row.created_at).slice(0,7);
  if(/^\d{4}-\d{2}$/.test(month))add(months,month,amount);
 }
 return {titles,balance,original:missingOriginal?null:original,recent,overdue,negotiating,broken,creditors:creditors.size,debtors:debtors.size,
  status:[...status.values()].sort((a,b)=>b.titles-a.titles),aging:[...aging.values()],
  collectors:[...collectors.values()].sort((a,b)=>b.titles-a.titles),
  months:[...months.values()].sort((a,b)=>a.label.localeCompare(b.label)).slice(-12).map(row=>({...row,label:row.label.slice(5)+'/'+row.label.slice(0,4)}))};
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

const metricPaths={
 wallet:'M3 6h17v13H3z M3 6l13-3v3 M20 10h-5v5h5',
 balance:'M4 5h16v14H4z M7 10h10 M7 14h6',
 chart:'M4 19h16 M6 16v-4 M12 16V8 M18 16V4',
 agreement:'M6 3h9l3 3v15H6z M9 10h6 M9 14h6 M9 17h4'
};
function metricIcon(name){
 return '<span class="executive-metric-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+metricPaths[name]+'"/></svg></span>';
}
function portfolioChart(months){
 const rows=months.slice(-6);
 if(!rows.length)return '<section class="panel corporate-dashboard-panel"><h3>Evolução da carteira</h3><p>Nenhum título no recorte selecionado.</p></section>';
 const max=Math.max(1,...rows.map(row=>row.titles));
 const points=rows.map((row,index)=>[rows.length===1?300:35+index*530/(rows.length-1),125-row.titles*95/max]);
 const line=points.map(point=>point.join(',')).join(' ');
 return '<section class="panel corporate-dashboard-panel executive-chart"><h3>Evolução da carteira</h3><p>Títulos por mês de cadastro</p>'+
  '<svg viewBox="0 0 600 155" role="img" aria-label="'+esc(rows.map(row=>row.label+': '+row.titles+' títulos').join(', '))+'">'+
  [30,62,94,125].map(y=>'<path class="executive-gridline" d="M35 '+y+'H565"/>').join('')+
  '<polygon points="'+points[0][0]+',125 '+line+' '+points.at(-1)[0]+',125"/><polyline points="'+line+'"/>'+
  points.map(([x,y],index)=>'<circle cx="'+x+'" cy="'+y+'" r="4"><title>'+esc(rows[index].label+': '+rows[index].titles+' títulos')+'</title></circle><text x="'+x+'" y="147" text-anchor="middle">'+esc(rows[index].label)+'</text>').join('')+'</svg></section>';
}
function recentNegotiations(rows,lookups){
 const columns=['Título','Credor','Devedor','Saldo atualizado','Situação','Responsável'];
 const creditors=new Map((lookups.creditors||[]).map(row=>[row.id,row.name]));
 const debtors=new Map((lookups.debtors||[]).map(row=>[row.id,row.name]));
 return '<section class="panel corporate-dashboard-panel executive-recent"><h3>Negociações recentes</h3>'+
  (rows.length?'<p>Últimos títulos cadastrados em negociação ou com acordo</p><div class="table-wrap"><table><thead><tr>'+
   columns.map(label=>'<th scope="col">'+label+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+
    [row.external_ref,row.creditor_name||creditors.get(row.creditor_id),row.debtor_name||debtors.get(row.debtor_id),
    brl(row.current_amount),row.app_status,row.collector_name].map((value,index)=>'<td>'+(index===4?'<span class="executive-status">'+esc(value)+'</span>':esc(value??'—'))+'</td>').join('')+
   '</tr>').join('')+'</tbody></table></div>':'<p>Nenhum título em negociação ou com acordo no recorte selecionado.</p>')+'</section>';
}

export function renderCollectionDashboard({target,data,financial,filters,lookups,guard,apply}){
 const debtors=(lookups.debtors||[]).filter(row=>!filters.creditor_id||row.creditor_id===filters.creditor_id);
 const titleOptions=debtors.map(row=>({id:row.id,name:row.name+' · '+((lookups.creditors||[]).find(c=>c.id===row.creditor_id)?.name||'')+' · '+row.id.slice(-6)}));
 const scopes=['Abertos','Todos','Encerrados','Suspensos'];
 const metrics=[
  ['Carteira total',data.original==null?'—':amounts(data.original),'wallet','Valor original dos títulos no recorte'],
  ['Saldo atualizado',amounts(data.balance),'balance','Saldo dos títulos no recorte'],
  ['Total recuperado',financial?.recovered==null?'—':brl(financial.recovered),'chart','Recebimentos no período do relatório financeiro'],
  ['Acordos ativos',financial?.agreements==null?'—':financial.agreements,'agreement','Conforme relatório financeiro']
 ];
 const financialDetails=[['fees','Honorários gerados'],['remittances','Valores a repassar']]
  .filter(([key])=>financial?.[key]!=null);
 const titleStatus=['Em cobrança','Em negociação','Acordo formalizado','Aguardando pagamento'];
 const stages=titleStatus.map(label=>({label,titles:data.status?.find(row=>row.label===label)?.titles??0}));
 const problem=data.tooLarge?'O recorte contém mais de 2.000 títulos. Selecione uma carteira ou um período menor.':
  data.changed?'A carteira mudou durante a consulta. Aplique os filtros novamente.':'';
 const activeFilters=Object.entries(filters).some(([key,value])=>value&&(key!=='scope'||value!=='Abertos'));
 target.innerHTML='<div class="corporate-dashboard executive-dashboard">'+
  '<div class="executive-photo"><img src="https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&amp;fit=crop&amp;w=1600&amp;q=85" alt="" referrerpolicy="no-referrer"></div>'+
  '<details class="panel executive-filter"'+(activeFilters||problem?' open':'')+'><summary>Filtrar painel</summary><form class="corporate-dashboard-filters">'+
  select('creditor_id','Carteira / credor',lookups.creditors||[],filters.creditor_id)+select('debtor_id','Devedor',titleOptions,filters.debtor_id)+
  select('assigned_to','Cobrador',lookups.users||[],filters.assigned_to)+select('status','Situação',options(statuses),filters.status)+
  input('start','Cadastro a partir de',filters.start,'date')+input('end','Cadastro até',filters.end,'date')+
  '<details'+(['aging','process','commercial','carrier','scope'].some(key=>filters[key])?' open':'')+'><summary>Mais filtros</summary><div>'+
  select('aging','Faixa de atraso',options(agingLabels),filters.aging)+input('process','Título / processo',filters.process)+
  input('commercial','Comercial',filters.commercial)+input('carrier','Portador',filters.carrier)+
  '<label>Processos<select name="scope">'+scopes.map(s=>'<option'+(s===(filters.scope||'Abertos')?' selected':'')+'>'+s+'</option>').join('')+'</select></label></div></details>'+
  '<div class="corporate-filter-actions"><button class="primary" type="submit">Aplicar filtros</button><button type="button" data-clear>Limpar filtros</button></div></form>'+'</details>'+
  (problem?'<p class="notice" role="status">'+esc(problem)+'</p>':
   '<div class="metrics executive-metrics">'+metrics.map(([label,value,icon,description])=>'<article class="metric executive-metric">'+
    metricIcon(icon)+'<div><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(description)+'</small></div></article>').join('')+'</div>'+
   '<div class="executive-charts">'+portfolioChart(data.months)+breakdown('Etapas de cobrança',stages,'titles',String)+'</div>'+
   recentNegotiations(data.recent,lookups)+
   '<details class="panel executive-details"><summary>Detalhamento da carteira</summary><div class="corporate-dashboard-grid">'+
   breakdown('Saldo por faixa de atraso',data.aging,'balance',amounts)+breakdown('Títulos por situação',data.status,'titles',String)+
   breakdown('Títulos por cobrador',data.collectors,'titles',String)+'</div>'+
   (financialDetails.length?'<dl class="executive-financial">'+financialDetails.map(([key,label])=>
    '<div><dt>'+esc(label)+'</dt><dd>'+esc(brl(financial[key]))+'</dd></div>').join('')+'</dl>':'')+'</details>')+'</div>';
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
