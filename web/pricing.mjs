import {openFinancialEngine} from './financial-engine.mjs';
import {brl,csv,parseCsv} from './money.mjs';
export const pricingSections=['Precificação e Honorários','Simulador financeiro','Fechamento mensal','Resultado da Cobrança'];
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const bands=['1 a 30 dias','31 a 90 dias','91 a 180 dias','181 a 365 dias','Acima de 365 dias'];
export function feeBaseForBand(rates,band){if(!Number.isInteger(Number(band))||Number(band)<0||Number(band)>5)throw Error('Faixa de atraso inválida');if(Number(band)===0)return 0;const rate=Number(rates?.[Number(band)-1]);if(!Number.isFinite(rate)||rate<0||rate>100)throw Error('Taxa contratual inválida');return rate;}
const volumes=['Até 99','100 a 499','500 a 1.999','2.000 a 4.999','5.000 ou mais'];
const input=(name,label,value='',type='text')=>`<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" required ${type==='number'?'min="0" step="0.01"':''}></label>`;
const select=(name,label,items)=>`<label>${esc(label)}<select name="${name}" required>${items.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></label>`;
const table=(rows,columns)=>`<div class="table-wrap"><table><thead><tr>${columns.map(([k,l])=>`<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${columns.map(([k,l,money])=>`<td>${esc(money?brl(r[k]):r[k])}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${columns.length}">Nenhum registro encontrado.</td></tr>`}</tbody></table></div>`;
const metrics=r=>`<div class="metrics">${[['recovered','Recuperação'],['fees','Honorários'],['management_topup','Complemento de gestão'],['billing','Total faturável'],['creditor_economic_net','Líquido econômico do credor']].map(([k,l])=>`<div class="metric"><span>${l}</span><strong>${brl(r[k])}</strong></div>`).join('')}</div>`;
const exportRows=(rows,name)=>{const url=URL.createObjectURL(new Blob([csv(rows)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
function showReport(modal,title,r){modal(title,`<p>${r.projection?'PROJEÇÃO COMERCIAL — não representa recebimentos e não emite cobrança.':'Apuração sobre recebimentos confirmados. Não emite nota fiscal nem movimenta dinheiro.'}</p>${metrics(r)}<p>Desconto: ${esc(r.discount)} pontos percentuais · Mínimo: ${brl(r.minimum)} · ${r.weighted_rate!==undefined?'Comissão média: '+esc(r.weighted_rate)+'%':''}</p>${r.fees_to_invoice!==undefined?`<p>Pagamentos ao credor: ${brl(r.fees_to_invoice)} de honorários a faturar. Honorários retidos pela assessoria: ${brl(r.retained_fees)}. Repasse de valores recebidos pela assessoria: ${brl(r.agency_remittance)}.</p>`:''}${r.cost!==undefined?`<p>Custos: ${brl(r.cost)} · Margem de contribuição estimada: ${brl(r.contribution)}</p>`:''}${table(r.rows||[],r.projection?[['band','Faixa'],['rate','Taxa (%)'],['recovered','Recuperação',true],['fee','Honorários',true]]:[['receipt_id','Recebimento'],['kind','Evento'],['original_period','Competência de origem'],['recipient','Pago a'],['rate','Taxa (%)'],['amount','Valor',true],['fee','Honorários',true]])}<div class="toolbar"><button type="button" data-fee-export>Exportar Excel / CSV</button><button type="button" data-fee-print>PDF / imprimir</button></div>`,null);const dialog=document.querySelector('dialog');dialog.querySelector('[data-fee-export]').onclick=()=>exportRows(r.rows||[],'honorarios');dialog.querySelector('[data-fee-print]').onclick=()=>window.print();}
export async function renderPricing(section,{api,guard,modal,notify,profile},target){
 const [data,lookups]=await Promise.all([api.rpc('pricing_list'),api.rpc('lookups')]);
 const contracts=data.contracts.map(c=>({id:c.id,name:`${c.creditor_name} · ${c.contract_ref} · v${c.version} · ${c.model}`}));
 
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date()),period=today.slice(0,7)+'-01';
 const on=(id,fn)=>target.querySelector(`[data-fee="${id}"]`)?.addEventListener('click',()=>guard(fn));
 if(section==='Precificação e Honorários'){
  target.innerHTML=`<div class="toolbar">${data.can_configure?'<button data-fee="new" class="primary">Novo contrato / versão</button>':''}<button data-fee="refresh">Atualizar</button><button data-fee="engine">Motor financeiro / auditoria</button></div><div class="panel"><p>Taxas comerciais por contrato. A classificação usa o vencimento original e a data de entrada; o volume é congelado por competência. Títulos anteriores com recebimentos mantêm os honorários históricos.</p>${table(data.contracts,[['creditor_name','Credor'],['contract_ref','Contrato'],['version','Versão'],['model','Modelo'],['starts_on','Início'],['ends_on','Término'],['volume_discount','Desconto por volume'],['titles','Títulos classificados']])}${data.contracts.map(c=>`<div class="toolbar"><span>${esc(c.creditor_name)} · ${esc(c.contract_ref)} · v${c.version} · Taxas: ${esc(c.rates.join(' / '))}%</span>${data.can_configure?`<button data-fee="version:${esc(c.id)}">Criar versão / editar taxas</button><button data-fee="enroll:${esc(c.id)}">Conferir taxas dos títulos</button><button data-fee="import:${esc(c.id)}">Importar carteira CSV</button>`:''}</div>`).join('')}</div>`;
  on('engine',()=>openFinancialEngine({api,guard,modal,notify,profile}));
  on('refresh',()=>renderPricing(section,{api,guard,modal,notify,profile},target));

  const configured=(c)=>({overdue:(c?.terms?.overdue_cutoffs||[30,90,180,365]).map(Number),volume:(c?.terms?.volume_cutoffs||[100,500,2000,5000]).map(Number),discount:c?(c.terms?.volume_discounts||[0,1,2,3,c.corporate_discount??4]).map(Number):['','','','',''],floor:c?Number(c.terms?.minimum_fee_rate??8):''});
  const nint=(name,label,value,max)=>`<label>${esc(label)}<input name="${name}" type="number" min="1" max="${max}" step="1" value="${esc(value)}" required></label>`;
  const editContract=(base=null)=>{
   const set=configured(base),rates=base?.rates||['','','','',''],minimums=base?.minimums||['','','','',''];
   const volumeLabels=set.volume.map((cut,i)=>i===0?`Até ${cut-1}`: `${set.volume[i-1]} a ${cut-1}`).concat(`${set.volume[3]} ou mais`);
   const ageLabels=set.overdue.map((cut,i)=>i===0?`1 a ${cut} dias`: `${set.overdue[i-1]+1} a ${cut} dias`).concat(`Acima de ${set.overdue[3]} dias`);
   const dialog=modal(base?'Nova versão das condições de '+base.creditor_name:'Condições financeiras do contrato',
     `<p>Todas as taxas, limites, descontos e valores podem ser configurados por contrato. Salvar cria uma <strong>nova versão</strong>; não recalcula títulos classificados, recebimentos, snapshots ou fechamentos anteriores. Alterações com competências congeladas somente terão vigência futura.</p>
     ${select('creditor_id','Credor',lookups.creditors)}
     ${input('contract_ref','Referência exata do contrato nos títulos',base?.contract_ref||'')}
     ${select('model','Modelo',[{id:'A',name:'A — Comissão por êxito'},{id:'B',name:'B — Gestão recorrente'}])}
     ${input('starts_on','Início de vigência desta versão',today,'date')}
     ${input('ends_on','Término da vigência',base?.ends_on||new Date(Date.parse(today+'T12:00:00Z')+89*86400000).toISOString().slice(0,10),'date')}
     ${select('volume_discount','Aplicar desconto por volume',[{id:'true',name:'Sim'},{id:'false',name:'Não'}])}
     ${select('snapshot_policy','Política de volume',[{id:'first_financial_operation',name:'Congelar na primeira operação financeira'},{id:'explicit_month_start',name:'Exigir snapshot explícito no início da competência'}])}
     <h3>Limites de atraso — editáveis (dias)</h3>
     <p>Defina 4 limites crescentes. São formadas 5 faixas; a última aplica-se acima do 4º limite.</p>
     ${set.overdue.map((v,i)=>nint('age_limit_'+i,'Limite superior da faixa '+(i+1)+' (dias)',v,36500)).join('')}
     <h3>Taxa percentual de honorários por faixa</h3>
     ${ageLabels.map((l,i)=>input('rate_'+i,'Taxa-base '+l+' (%)',rates[i],'number')).join('')}
     ${input('minimum_fee_rate','Piso percentual de honorários (%)',set.floor,'number')}
     <h3>Faixas de volume de devedores — editáveis</h3>
     <p>Defina 4 inícios crescentes de volume. A primeira faixa é inferior ao 1º limite.</p>
     ${set.volume.map((v,i)=>nint('volume_limit_'+i,'Início da faixa '+(i+2)+' (devedores)',v,100000000)).join('')}
     <h3>Desconto por faixa de volume — pontos percentuais</h3>
     ${volumeLabels.map((l,i)=>input('volume_discount_'+i,'Desconto '+l+' (p.p.)',set.discount[i],'number')).join('')}
     <h3>Mínimo mensal de gestão por faixa — R$</h3>
     ${volumeLabels.map((l,i)=>input('minimum_'+i,'Mínimo '+l,minimums[i],'number')).join('')}
     ${select('recipient','Recebimentos pagos a',[{id:'creditor',name:'Diretamente ao credor — honorários a faturar'},{id:'agency',name:'Assessoria — retenção e repasse'}])}
     ${nint('post_end_days','Dias após encerramento para comissão',base?.terms?.post_end_days??0,3650).replace('min="1"','min="0"')}
     ${input('payment_terms','Condições de pagamento',base?.terms?.payment_terms||'')}
     ${input('commercial_owner','Responsável comercial',base?.terms?.commercial_owner||'')}
     ${input('finance_owner','Responsável financeiro',base?.terms?.finance_owner||'')}
     ${nint('closing_day','Dia de conferência mensal',base?.terms?.closing_day??5,31)}`,
     async d=>{
       const age=Array.from({length:4},(_,i)=>Number(d['age_limit_'+i])),volume=Array.from({length:4},(_,i)=>Number(d['volume_limit_'+i]));
       const discounts=Array.from({length:5},(_,i)=>Number(d['volume_discount_'+i]));
       const rateValues=Array.from({length:5},(_,i)=>Number(d['rate_'+i]));
       const amounts=Array.from({length:5},(_,i)=>Number(d['minimum_'+i]));
       const floor=Number(d.minimum_fee_rate);
       const ascending=list=>list.every((v,i)=>Number.isSafeInteger(v)&&v>0&&(i===0||v>list[i-1]));
       const percent=v=>Number.isFinite(v)&&v>=0&&v<=100&&Math.abs(v*100-Math.round(v*100))<1e-7;
       if(!ascending(age)||!ascending(volume))throw Error('Os limites de atraso e volume devem ser inteiros, positivos e crescentes.');
       if(!rateValues.every(percent)||!discounts.every(percent)||!percent(floor))throw Error('Informe taxas e descontos de 0 a 100%, com duas casas decimais.');
       if(!amounts.every(v=>Number.isFinite(v)&&v>=0&&v<=999999999.99&&Math.abs(v*100-Math.round(v*100))<1e-7))throw Error('Mínimos inválidos: informe valores monetários não negativos.');
       if(d.starts_on>d.ends_on)throw Error('O início da vigência deve ser anterior ou igual ao término.');
       await api.rpc('pricing_contract',{creditor_id:d.creditor_id,contract_ref:d.contract_ref,model:d.model,starts_on:d.starts_on,ends_on:d.ends_on,volume_discount:d.volume_discount==='true',corporate_discount:discounts[4],rates:rateValues,minimums:amounts,terms:{snapshot_policy:d.snapshot_policy,recipient:d.recipient,post_end_days:d.post_end_days,payment_terms:d.payment_terms,commercial_owner:d.commercial_owner,finance_owner:d.finance_owner,closing_day:d.closing_day,overdue_cutoffs:age,volume_cutoffs:volume,volume_discounts:discounts,minimum_fee_rate:floor}});
     });
   if(base){
     for(const [name,value] of Object.entries({creditor_id:base.creditor_id,model:base.model,volume_discount:String(base.volume_discount),snapshot_policy:base.terms?.snapshot_policy||'first_financial_operation',recipient:base.terms?.recipient||'creditor'})){
       const control=dialog.querySelector('[name="'+name+'"]');if(control)control.value=value;
     }
   }else{
     dialog.querySelector('[name=volume_discount]').value='false';
     dialog.querySelector('[name=snapshot_policy]').value='first_financial_operation';
     dialog.querySelector('[name=recipient]').value='creditor';
   }
  };
  on('new',()=>editContract());
  for(const c of data.contracts)on('version:'+c.id,()=>editContract(c));
  for(const c of data.contracts)on('import:'+c.id,()=>{const dialog=modal('Importar carteira — prévia',input('batch_id','Identificador único do lote')+'<p>CSV UTF-8: external_ref,debtor_name,debtor_document,original_amount,due_date; opcional entry_date. Datas AAAA-MM-DD e valores decimais com ponto. Cada referência é um título; CPF/CNPJ repetido pode ter títulos diferentes. Até 500 títulos por lote.</p><label>Arquivo<input name="portfolio_file" type="file" accept=".csv,text/csv" required></label>',async d=>{const file=dialog.querySelector('[name=portfolio_file]').files[0];if(!file||file.size>1048576)throw Error('Selecione um CSV de até 1 MB.');const items=parseCsv(await file.text(),['external_ref','debtor_name','debtor_document','original_amount','due_date']);const args={contract_id:c.id,batch_id:d.batch_id,items};const preview=await api.rpc('pricing_import',args);modal('Conferir importação',`<p>${preview.count} títulos · ${preview.errors} pendências. ${preview.duplicate?'Lote já importado.':''}</p>${table(preview.rows,[['line','Linha'],['external_ref','Título'],['due_date','Vencimento'],['reference_date','Entrada'],['band','Faixa'],['duplicate','Duplicado'],['status','Situação'],['error','Pendência']])}`,preview.errors||preview.duplicate?null:()=>api.rpc('pricing_import',{...args,operation:'confirm'}));});});
  for(const c of data.contracts)on('enroll:'+c.id,async()=>{const preview=await api.rpc('pricing_enroll',{contract_id:c.id});const cuts=configured(c).overdue;const ageNames=cuts.map((v,i)=>i===0?`1 a ${v} dias`:`${cuts[i-1]+1} a ${v} dias`).concat(`Acima de ${cuts[3]} dias`);const rows=preview.rows.map(r=>({...r,band_label:Number(r.band)===0?'Não vencido':ageNames[Number(r.band)-1]||'Pendente',base_rate:feeBaseForBand(c.rates,r.band)}));modal('Prévia de taxas escalonadas por título',`<p>Os títulos serão enquadrados pelo vencimento original na data de entrada. Taxas-base do contrato: ${esc(c.rates.join(' / '))}% para as cinco faixas de atraso configuradas na versão deste contrato. Sobre o efetivamente recebido, o banco aplica ainda o desconto por volume da competência e o piso contratado. Esta prévia não lança honorários nem juros do devedor.</p><p>Somente títulos sem recebimentos e sem classificação poderão ser vinculados. Confira a referência contratual antes de confirmar.</p>${table(rows,[['external_ref','Título'],['due_date','Vencimento original'],['reference_date','Entrada'],['band_label','Faixa de atraso'],['base_rate','Taxa-base (%)'],['already_classified','Já classificado'],['historical_payments','Tem recebimentos']])}${input('reason','Motivo da vinculação')}`,d=>api.rpc('pricing_enroll',{contract_id:c.id,operation:'confirm',reason:d.reason}));});return;
 }
 if(section==='Simulador financeiro'){
  target.innerHTML=`<div class="toolbar"><button data-fee="simulate" class="primary">Simular e salvar cenário</button><button data-fee="refresh">Atualizar</button></div><div class="panel"><p>Projeções calculadas no backend. A distribuição em reais pelas cinco faixas define o valor total da carteira. A simulação não gera recebimentos ou cobrança.</p>${table(data.scenarios.map(x=>({name:x.name,created_at:x.created_at,...x.result})),[['name','Cenário'],['created_at','Data'],['recovered','Recuperação projetada',true],['fees','Honorários projetados',true],['billing','Faturamento projetado',true]])}${data.scenarios.map(s=>`<button data-fee="scenario:${esc(s.id)}">${esc(s.name)} · demonstrativo</button>`).join('')}</div>`;
  on('refresh',()=>renderPricing(section,{api,guard,modal,notify,profile},target));
  for(const s of data.scenarios)on('scenario:'+s.id,()=>showReport(modal,'Simulação — '+s.name,s.result));
  on('simulate',()=>modal('Simulação comercial',input('name','Nome do cenário')+select('creditor_id','Credor',lookups.creditors)+select('contract_id','Tabela contratual',[{id:'',name:'Tabela inicial'},...contracts])+select('model','Modelo',[{id:'A',name:'A — Êxito'},{id:'B',name:'B — Recorrente'}])+input('debtors','Devedores únicos','1','number')+input('titles','Quantidade de títulos','1','number')+bands.map((l,i)=>input('band_'+i,'Valor da carteira — '+l,'0','number')).join('')+input('recovery_percent','Recuperação hipotética (%)','20','number')+input('cost','Custos operacionais estimados','0','number'),async d=>{const result=await api.rpc('pricing_simulate',{...d,bands:bands.map((_,i)=>d['band_'+i]),save:true});notify('Cenário salvo. Abra o demonstrativo na lista.');}));return;
 }
 if(section==='Fechamento mensal'){
  target.innerHTML=`<form data-fee-form class="filters">${select('contract_id','Contrato / versão',contracts)}${input('period','Competência (primeiro dia)',period,'date')}</form><div class="toolbar">${data.can_close?'<button data-fee="snapshot">Congelar volume</button>':''}<button data-fee="refresh">Atualizar</button><button data-fee="statement">Demonstrativo</button>${data.can_close?'<button data-fee="draft">Apurar preliminar</button><button data-fee="approve">Aprovar e fechar</button><button data-fee="bill">Registrar fatura aprovada</button>':''}</div><div class="panel"><p>Fuso America/Sao_Paulo. O mínimo é compensável: total = maior entre comissões e mínimo. O complemento é devido pelo credor. Aprovação não emite nota fiscal, cobrança bancária ou transferência. Estornos após o fechamento geram ajustes na próxima competência aberta.</p>${table(data.closings.map(c=>({...c,...c.statement})),[['contract_ref','Contrato'],['period','Competência'],['status','Situação'],['fees','Comissões',true],['management_topup','Complemento',true],['billing','Faturável',true]])}</div>`;
  on('refresh',()=>renderPricing(section,{api,guard,modal,notify,profile},target));
  const form=()=>Object.fromEntries(new FormData(target.querySelector('form')));
  on('bill',()=>{const d=form();modal('Registrar fatura comercial da assessoria','<p>Cria uma fatura e contas a receber no financeiro existente, para o valor do fechamento aprovado. Não emite nota fiscal, boleto ou transferência. Confira as condições do contrato antes de salvar.</p>'+input('due_date','Vencimento',period,'date')+input('reason','Referência da autorização de faturamento'),x=>api.rpc('pricing_bill',{...d,...x}));});
  on('snapshot',async()=>{const v=await api.rpc('pricing_snapshot',form());notify(`Volume congelado: ${v.debtors} devedores; desconto ${v.discount} p.p.; mínimo ${brl(v.minimum)}.`);});
  on('statement',async()=>showReport(modal,'Prestação de contas',await api.rpc('pricing_statement',form())));
  on('draft',async()=>showReport(modal,'Fechamento preliminar',await api.rpc('pricing_close',{...form(),operation:'draft'})));
  on('approve',async()=>{const d=form();const statement=await api.rpc('pricing_statement',d);modal('Conferir e fechar competência',`<p>Contrato ${esc(statement.contract_ref)} · competência ${esc(d.period)}. Os valores aprovados ficarão congelados.</p>${metrics(statement)}${input('reason','Motivo / referência da conferência')}`,x=>api.rpc('pricing_close',{...d,operation:'approve',reason:x.reason}));});return;
 }
 if(section==='Resultado da Cobrança'){
  target.innerHTML=`<form data-fee-form class="filters">${select('creditor_id','Credor',[{id:'',name:'Todos'},...lookups.creditors])}${select('contract_id','Contrato',[{id:'',name:'Todos'},...contracts])}${select('assigned_to','Operador',[{id:'',name:'Todos'},...lookups.users])}${input('period','Competência (primeiro dia)',period,'date')}</form><div class="toolbar"><button data-fee="refresh">Consultar</button><button data-fee="export">Exportar Excel / CSV</button><button data-fee="print">PDF / imprimir</button></div><div data-fee-dashboard></div>`;
  let latest=[];
  const refresh=async()=>{const r=await api.rpc('pricing_dashboard',Object.fromEntries(new FormData(target.querySelector('form'))));r.billing_pending=(Number(r.billing)-Number(r.agency_received)).toFixed(2);r.recovery_percentage=Number(r.portfolio)?(r.rows.reduce((sum,x)=>sum+Number(x.recovered),0)/Number(r.portfolio)*100).toFixed(2)+'%':'0%';latest=r.rows;target.querySelector('[data-fee-dashboard]').innerHTML=`<div class="panel"><div class="metrics">${[['portfolio','Carteira administrada',true],['open_balance','Saldo em aberto',true],['titles','Títulos'],['debtors','Devedores com CPF/CNPJ válido'],['pending_classification','Títulos sem classificação'],['recovery_percentage','Recuperação no período / carteira'],['negotiated','Valor negociado',true],['billing','Faturamento registrado',true],['agency_fees_received','Comissões recebidas em faturas',true],['agency_received','Faturas recebidas',true],['billing_pending','Faturamento pendente',true]].map(([k,l,money])=>`<div class="metric"><span>${l}</span><strong>${esc(money?brl(r[k]):r[k])}</strong></div>`).join('')}</div><p>Honorários abaixo correspondem aos contratos do módulo. Títulos legados permanecem nos relatórios anteriores até sua vinculação. Faturamento e baixas de faturas são totais do contrato, sem rateio por operador. Pagamentos diretos ao credor geram honorários a faturar.</p>${table(r.rows,[['creditor_name','Credor'],['period','Competência'],['recovered','Recuperado',true],['fees','Comissão gerada',true],['fees_to_invoice','A faturar ao credor',true],['retained_fees','Retido pela assessoria',true]])}<h3>Recuperação por faixa</h3>${table(r.bands,[['band','Faixa'],['recovered','Recuperado',true],['fees','Comissões',true]])}<h3>Evolução mensal</h3>${table(r.evolution,[['period','Competência'],['recovered','Recuperado',true],['fees','Comissões',true]])}<h3>Fechamentos</h3>${table(r.closings.map(x=>({...x,...x.statement})),[['contract_ref','Contrato'],['status','Situação'],['management_topup','Complemento',true],['billing','Total faturável',true]])}</div>`;};
  on('refresh',refresh);on('export',()=>exportRows(latest,'resultado-cobranca'));on('print',()=>window.print());await refresh();
 }
}
