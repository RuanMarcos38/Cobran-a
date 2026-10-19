const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const textField=(name,label,value='',required=false,type='text')=>\`<label>\${esc(label)}<input name="\${esc(name)}" type="\${esc(type)}" value="\${esc(value)}" maxlength="250" \${required?'required':''}></label>\`;
const select=(name,label,items,value)=>\`<label>\${esc(label)}<select name="\${esc(name)}" required>\${items.map(item=>\`<option value="\${esc(item.id)}" \${String(value)===String(item.id)?'selected':''}>\${esc(item.name)}</option>\`).join('')}</select></label>\`;
const actions=(id,label)=>\`<button type="button" data-bank-action="\${esc(id)}">\${esc(label)}</button>\`;
const providers=[['manual','Cadastro/boletos existentes (sem integração automática)'],['inter','Banco Inter'],['itau','Itaú'],['bradesco','Bradesco'],['bb','Banco do Brasil'],['sicoob','Sicoob'],['sicredi','Sicredi'],['santander','Santander'],['caixa','Caixa Econômica'],['outro','Outro banco (adaptador pendente)']].map(([id,name])=>({id,name}));
const environments=[{id:'homologation',name:'Homologação / testes'},{id:'production',name:'Produção — sujeito a homologação bancária'}];

export async function renderCompanyBank(section,{api,modal,guard,notify},target){
 const admin=['admin','master'].includes((await api.rpc('profile')).role);
 const rerender=()=>renderCompanyBank(section,{api,modal,guard,notify},target);
 const on=(id,fn)=>target.querySelector('[data-bank-action="'+id+'"]')?.addEventListener('click',()=>guard(fn));
 const company=await api.rpc('company_get');
 if(section==='Minha empresa'){
  target.innerHTML=\`<div class="toolbar">\${admin?actions('edit-company','Editar dados da minha empresa'):''}\${actions('refresh','Atualizar')}</div>
  <div class="panel"><h3>\${esc(company.legal_name)}</h3><p>Cadastro da empresa que utiliza o sistema. Estas informações são isoladas das demais empresas, credores e devedores.</p>
   <dl class="company-details">
   \${[['Razão social',company.legal_name],['Nome fantasia',company.trade_name],['CNPJ',company.cnpj],['E-mail',company.email],['Telefone',company.phone],['Contato',company.contact_name],['Endereço',[company.street,company.street_number,company.district,company.city,company.state,company.zip_code].filter(Boolean).join(', ')]].map(([k,v])=>\`<div><dt>\${esc(k)}</dt><dd>\${esc(v||'Não informado')}</dd></div>\`).join('')}
   </dl><p>A empresa usuária possui cadastro e configurações bancárias próprios; os credores são cadastrados separadamente.</p></div>\`;
  on('refresh',rerender);
  on('edit-company',()=>modal('Dados cadastrais da empresa',
   textField('legal_name','Razão social',company.legal_name,true)+textField('trade_name','Nome fantasia',company.trade_name)+
   textField('cnpj','CNPJ da empresa',company.cnpj,true)+textField('state_registration','Inscrição estadual',company.state_registration)+
   textField('email','E-mail comercial',company.email,false,'email')+textField('phone','Telefone',company.phone)+
   textField('contact_name','Responsável',company.contact_name)+textField('zip_code','CEP',company.zip_code)+
   textField('street','Rua / avenida',company.street)+textField('street_number','Número',company.street_number)+
   textField('district','Bairro',company.district)+textField('city','Cidade',company.city)+textField('state','UF',company.state),
   async values=>{await api.rpc('company_save',values);notify('Cadastro da empresa atualizado com auditoria.');}));
  return;
 }
 const data=await api.rpc('bank_list');
 const accounts=data.accounts||[],integrations=data.integrations||[];
 target.innerHTML=\`<div class="toolbar">\${admin?actions('new-account','Cadastrar conta bancária')+actions('new-integration','Configurar integração bancária'):''}\${actions('refresh','Atualizar')}</div>
  <div class="panel"><h3>Contas e integração de boletos da empresa</h3>
   <p>Cadastre a conta bancária da própria empresa, informe convênio, carteira e dados de integração. A preparação não cria nem registra boletos automaticamente. É necessária aprovação e homologação do banco antes da emissão real.</p>
   <h3>Contas cadastradas</h3>
   <div class="table-wrap"><table><thead><tr><th>Conta</th><th>Banco</th><th>Agência / conta</th></tr></thead><tbody>
   \${accounts.map(x=>\`<tr><td>\${esc(x.name)}</td><td>\${esc(x.bank)}</td><td>\${esc(x.account_ref)}</td></tr>\`).join('')||'<tr><td colspan="3">Cadastre a primeira conta na seção Conciliação bancária ou aqui.</td></tr>'}</tbody></table></div>
   <h3>Configurações da API bancária</h3>
   <div class="table-wrap"><table><thead><tr><th>Banco</th><th>Ambiente</th><th>Convênio</th><th>Credenciais</th><th>Situação</th><th>Ações</th></tr></thead><tbody>
   \${integrations.map(b=>\`<tr><td>\${esc(b.bank_name)} (\${esc(b.bank_code)})</td><td>\${esc(b.environment)}</td><td>\${esc(b.agreement||'—')}</td><td>\${b.credential_configured?'Armazenadas com criptografia':'Não informadas'}</td><td>\${esc(b.connection_status==='approved'?'Homologado':b.connection_status==='configured'?'Credenciais cadastradas; homologação pendente':'Aguardando homologação')}</td><td>\${admin?actions('edit:'+b.id,'Editar')+(b.provider!=='manual'&&b.provider!=='outro'?actions('credential:'+b.id,'Credenciais')+actions('test:'+b.id,'Verificar prontidão'):''):''}</td></tr>\`).join('')||'<tr><td colspan="6">Nenhuma integração bancária configurada.</td></tr>'}</tbody></table></div>
   <p role="note"><strong>Proteção:</strong> nenhuma emissão bancária, liquidação ou baixa será executada por esta tela sem integração homologada. Nenhuma chave bancária fica exposta no navegador após salvar.</p>
  </div>\`;
 const bankForm=bank=>{if(!accounts.length)throw Error('Cadastre primeiro uma conta bancária.');
 const fields=select('account_id','Conta bancária',[{id:'',name:'Selecione'},...accounts.map(x=>({id:x.id,name:x.name+' · '+x.bank+' · '+x.account_ref}))],bank?.account_id||'')+
  select('provider','Banco / provedor',providers,bank?.provider||'manual')+
  select('environment','Ambiente',environments,bank?.environment||'homologation')+
  textField('bank_code','Código COMPE do banco (3 dígitos)',bank?.bank_code||'',true)+
  textField('bank_name','Nome do banco',bank?.bank_name||'',true)+
  textField('agency','Agência',bank?.agency||'')+
  textField('account_number','Conta bancária com dígito',bank?.account_number||'')+
  textField('beneficiary_document','CNPJ titular/beneficiário',bank?.beneficiary_document||company.cnpj,true)+
  textField('agreement','Convênio / código beneficiário',bank?.agreement||'')+
  textField('wallet','Carteira / modalidade de cobrança',bank?.wallet||'')+
  textField('pix_key','Chave PIX (quando aplicável)',bank?.pix_key||'')+
  '<p>Salvar prepara as configurações; a emissão real só será liberada após aprovação/homologação do banco. Alterações desativam a integração anterior para evitar uso de parâmetros antigos.</p>';
 modal('Configurar banco e boletos',fields,async values=>{await api.rpc('bank_save',values);notify('Banco cadastrado. Integração aguarda homologação.');});};
 on('refresh',rerender);
 on('new-account',()=>modal('Conta bancária da empresa',
   textField('name','Descrição da conta (ex.: recebimentos)', '',true)+
   textField('bank','Nome do banco','',true)+
   textField('account_ref','Agência / conta','',true),
   async data=>{await api.rpc('fin_bank',{operation:'account',...data});notify('Conta cadastrada para conciliação financeira.');}));
 on('new-integration',()=>bankForm(null));
 for(const b of integrations){
  on('edit:'+b.id,()=>bankForm(b));
  on('credential:'+b.id,()=>modal('Credenciais seguras — '+b.bank_name,
   '<p>Use exclusivamente as credenciais concedidas pelo banco titular do CNPJ. Nenhuma informação sensível será exibida depois do envio.</p>'+
   textField('client_id','Client ID','',true)+
   '<label>Client Secret<input name="client_secret" type="password" required autocomplete="new-password" maxlength="4096"></label>'+
   '<label>API Key (se houver)<input name="api_key" type="password" autocomplete="off" maxlength="4096"></label>',
   async values=>{await api.server('bank_configure',{...values,bank_id:b.id});notify('Credenciais protegidas. A homologação da API ainda é necessária.');}));
  on('test:'+b.id,async()=>{const result=await api.server('bank_connection_test',{bank_id:b.id});notify(result.message||'Integração bancária ainda pendente.');});
 }
}