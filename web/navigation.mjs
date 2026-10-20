// Presentation only. Legacy module/section pairs continue to own routing and authorization.
const item=(module,section,label=section,icon='file',aliases=[])=>({module,section,label,icon,aliases});
export const navigation=[
 {label:'Negociação',icon:'file',items:[
  item('Processo','Cobrança','Cobranças e acordos','file',[['Processo','Processo']]),
  item('Processo','WhatsApp da cobrança'),item('Atendimento','Central de atendimento','E-mail de atendimento'),item('Processo','Agenda da cobrança','Agenda de cobrança','calendar')]},
 {label:'Relatórios',icon:'chart',items:[
  item('Relatórios','Painel gerencial'),item('Relatórios','Financeiro','Recebimentos, honorários e repasses','money',[['Financeiro','Recebimentos'],['Processo','Consulta de Recebimentos'],['Financeiro','Honorários e Repasses']]),
  ...['Títulos Cadastrados','Títulos Captados','Processos do Cliente — Totais','Histórico do Processo','E-mail de Clientes','Clientes Inativos','Análise Gerencial'].map(s=>item('Relatórios',s)),
  item('Financeiro','Resultado da Cobrança'),item('Financeiro','Histórico dos clientes','Histórico financeiro dos clientes')]},
 {label:'Configurações',icon:'gear',items:[item('Cadastro','Usuários','Usuários e permissões','user'),item('Cadastro','Regras de comissão'),item('Cadastro','Integrações / API'),item('Comercial','Integração n8n'),item('Financeiro','Integrações ERP'),item('Financeiro','Integração bancária / Boletos')]},
 {label:'Carteiras e Borderôs',icon:'folder',items:[item('Processo','Carteiras de credores','Carteiras e importação de borderôs'),item('Cadastro','Distribuição automática')]},
 {label:'Cadastros',icon:'user',items:['Minha empresa','Credores / Clientes','Devedores','Cadastros auxiliares'].map(s=>item('Cadastro',s))},
 {label:'Financeiro',icon:'money',items:['Despesas','Contas a pagar','Contas a receber','Faturamento','Crédito','Conciliação bancária','Precificação e Honorários','Simulador financeiro','Fechamento mensal'].map(s=>item('Financeiro',s)).concat(item('Comercial','Comissões comerciais'))},
 {label:'Comercial',icon:'user',items:[item('Comercial','Prospecção'),item('Comercial','Funil / Kanban'),item('Comercial','Atendimento','WhatsApp comercial'),item('Comercial','E-mail comercial'),item('Comercial','Agendamentos','Agenda comercial','calendar')]}
];
export function navigationGroups(allowed){return navigation.map(g=>({...g,items:g.items.flatMap(i=>{const route=[[i.module,i.section],...i.aliases].find(([m,s])=>allowed(m,s));return route?[{...i,module:route[0],section:route[1]}]:[];})})).filter(g=>g.items.length);}
export function navigationLocation(module,section){for(const g of navigation)for(const i of g.items)if([[i.module,i.section],...i.aliases].some(([m,s])=>m===module&&s===section))return {group:g.label,label:i.label};return {group:module,label:section};}
export const routeHash=(module,section)=>'#/'+encodeURIComponent(module)+'/'+encodeURIComponent(section);
export function parseRoute(hash){try{const p=hash.replace(/^#\//,'').split('/');return hash.startsWith('#/')&&p.length===2?{module:decodeURIComponent(p[0]),section:decodeURIComponent(p[1])}:null;}catch{return null;}}
