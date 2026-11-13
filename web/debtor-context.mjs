const text=x=>typeof x==='string'||typeof x==='number'?String(x).trim().slice(0,1500):'';
const esc=x=>text(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const unique=values=>[...new Set(values.map(text).filter(Boolean))];
export function debtorPhones(d={}){
 const extra=Array.isArray(d.phones)?d.phones.flatMap(p=>typeof p==='object'&&p?[p.number,p.phone,p.numero]:[p]):[d.phones];
 const seen=new Set();return unique([d.phone,d.phone2,d.mobile,d.contact_phone,d.whatsapp,...extra]).filter(p=>{const key=p.replace(/\D/g,'')||p.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;});
}
export function debtorAddress(d={}){
 const a=d.address&&typeof d.address==='object'&&!Array.isArray(d.address)?d.address:{};
 const get=(key,...aliases)=>text(a[key])||aliases.map(k=>text(a[k])).find(Boolean)||text(d[key]);
 const street=text(d.address)||get('street','logradouro');
 const number=get('number','numero'),complement=get('complement','complemento'),district=get('district','neighborhood','bairro'),city=get('city','cidade'),state=get('state','uf'),zip=get('zip_code','zip','postal_code','cep');
 const cityState=city&&state&&!new RegExp('(?:^|[\\s/,-])'+state.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$','i').test(city)?city+' / '+state:city||state;
 return unique([unique([street,number,complement]).join(', '),district,cityState,zip?'CEP '+zip:'']).join(' · ');
}
export function debtorContextMarkup(result={},status='ready'){
 const title='<div class="debtor-context-title"><strong>Dados do devedor</strong></div>';
 if(status==='loading')return '<section class="debtor-context">'+title+'<p>Carregando os dados dos títulos selecionados…</p></section>';
 if(status==='error')return '<section class="debtor-context">'+title+'<p role="status">Não foi possível consultar os dados. Atualize a consulta ou selecione o título novamente.</p></section>';
 if(!result.selection_count)return '<section class="debtor-context">'+title+'<p>Selecione um título para visualizar nome, CPF/CNPJ, telefones, e-mail e endereço.</p></section>';
 if(result.debtor_count!==1||!result.debtor)return '<section class="debtor-context">'+title+'<p>'+esc(result.debtor_count)+' devedores nos títulos selecionados. Selecione títulos de um único devedor para visualizar os contatos.</p></section>';
 const d=result.debtor,phones=debtorPhones(d),address=debtorAddress(d);
 return '<section class="debtor-context" aria-label="Dados do devedor selecionado"><div class="debtor-context-title"><strong>Dados do devedor</strong><span>'+esc(result.selection_count)+' título(s) deste devedor</span></div><dl class="debtor-contact-grid">'+[
  ['Nome / razão social',esc(d.name)||'Não informado','identity'],['CPF/CNPJ',esc(d.document)||'Não informado','document'],['Telefones de contato',phones.map(esc).join('<br>')||'Não informado','phones'],['E-mail',esc(d.email)||'Não informado','email'],['Endereço completo',esc(address)||'Não informado','address']
 ].map(([label,value,cls])=>'<div class="debtor-contact-'+cls+'"><dt>'+label+'</dt><dd>'+value+'</dd></div>').join('')+'</dl></section>';
}
// Coalesces checkbox changes and discards responses from an older selection.
export function createDebtorContextLoader(read,render,{delay=120,schedule=setTimeout,cancel=clearTimeout}={}){
 let timer,sequence=0;
 return {update(ids){const current=++sequence;cancel(timer);const selection=[...new Set(ids)];if(!selection.length){render({},'ready');return;}render({},'loading');timer=schedule(async()=>{try{const result=await read(selection);if(current===sequence)render(result,'ready');}catch{if(current===sequence)render({},'error');}},delay);},clear(){sequence++;cancel(timer);}};
}
