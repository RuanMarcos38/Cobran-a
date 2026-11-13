const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const option=(value,name)=>'<option value="'+esc(value)+'">'+esc(name)+'</option>';
const asBase64=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Falha na leitura do arquivo'));reader.readAsDataURL(file);});
const cleanDoc=value=>String(value||'').replace(/\D/g,'');
const normalizedName=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/\s+/g,' ');
const htmlField=(name,label,value='',type='text',required=true)=>'<label>'+esc(label)+'<input name="'+esc(name)+'" type="'+type+'" value="'+esc(value)+'" '+(required?'required':'')+'></label>';
const toAmount=value=>{const s=String(value||'').trim().replace(',','.');const n=Number(s);if(!/^\d+(?:\.\d{1,2})?$/.test(s)||!Number.isFinite(n)||n<=0||n>999999999999)throw Error('Valor inválido. Confira o valor em reais.');return n.toFixed(2);};
const toDate=value=>{const s=String(value||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||new Date(s+'T12:00:00Z').toISOString().slice(0,10)!==s)throw Error('Confira o vencimento no formato AAAA-MM-DD.');return s;};
export async function openDocumentImport({api,guard,onImported=async()=>{},mode='cheque'}){
 const lookups=await api.rpc('lookups',{});
 const creditors=lookups.creditors||[];
 if(!creditors.length)throw Error('Cadastre um credor antes de iniciar a importação.');
 if(!['cheque','devedor'].includes(mode))throw Error('Tipo de importação inválido.');
 document.querySelector('dialog')?.remove();
 const dialog=document.createElement('dialog');
 dialog.innerHTML='<form class="document-ocr-form"><div class="modal-head"><h2>'+(mode==='cheque'?'Importar cheque / dívida manual':'Cadastrar devedor com foto ou PDF')+'</h2><button type="button" data-cancel aria-label="Fechar">×</button></div><div class="form-grid"><label>Credor<select name="creditor_id" required>'+creditors.map(c=>option(c.id,c.name)).join('')+'</select></label><label>Arquivo (foto JPEG/PNG ou PDF, até 5 MB)<input name="file" type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"></label></div><p>Os campos são sugestões do OCR. Verifique os originais antes de confirmar. O arquivo não é arquivado automaticamente.</p><div data-message role="status"></div><div data-review></div><div class="modal-actions"><button type="button" data-cancel>Cancelar</button><button type="button" data-read>Reconhecer arquivo</button><button type="button" data-manual>Preencher manualmente</button><button class="primary" type="submit" data-save disabled>Confirmar e cadastrar</button></div></form>';
 document.body.append(dialog);dialog.showModal();
 const form=dialog.querySelector('form'),pane=dialog.querySelector('[data-review]'),status=dialog.querySelector('[data-message]'),save=dialog.querySelector('[data-save]'),read=dialog.querySelector('[data-read]'),manual=dialog.querySelector('[data-manual]');
 const creditor=form.elements.creditor_id;let reviewed=false,busy=false,draft=null,originalId='';let previewUrl=null;
 dialog.querySelectorAll('[data-cancel]').forEach(b=>b.onclick=()=>{if(!busy)dialog.close();});
 dialog.addEventListener('close',()=>{if(previewUrl)URL.revokeObjectURL(previewUrl);});
 dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
 function reset(){reviewed=false;draft=null;save.disabled=true;pane.innerHTML='';status.textContent='';if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}}
 form.elements.file.onchange=reset;creditor.onchange=reset;
 const changeField=(name,value)=>{const el=pane.querySelector('[name="'+name+'"]');if(el)el.value=value??'';};
 const reviewMarkup=async()=>{
  const selected=creditor.value;
  if(mode==='devedor'){
   pane.innerHTML='<h3>Prévia editável da ficha</h3><div class="form-grid">'+
    htmlField('name','Nome / razão social',draft?.name)+htmlField('document','CPF / CNPJ',draft?.document,'text',false)+
    htmlField('email','E-mail',draft?.email,'email',false)+htmlField('phone','Telefone',draft?.phone,'tel',false)+
    htmlField('address','Endereço',draft?.address,'text',false)+htmlField('city','Cidade/UF',draft?.city,'text',false)+
    '</div><p>Se houver cadastro existente com o mesmo documento ou nome, o sistema impedirá uma nova ficha. Confira antes de salvar.</p>';
  }else{
   const debtors=await api.rpc('export',{entity:'debtors',filters:{scope:'Todos'}});
   const debtorList=debtors.filter(d=>d.creditor_id===selected);
   if(!debtorList.length)throw Error('Cadastre ou importe primeiro o devedor desta carteira.');
   const amount=draft?.amount_candidates?.length===1?draft.amount_candidates[0]:'';
   const oneDate=draft?.date_candidates?.length===1?draft.date_candidates[0]:'';
   pane.innerHTML='<h3>Prévia editável do cheque</h3><p>Datas de apresentação e devolução não definem, por si só, o vencimento da cobrança.</p><div class="form-grid">'+
    '<label>Devedor<select name="debtor_id" required>'+debtorList.map(d=>option(d.id,d.name+(d.document?' — '+d.document:''))).join('')+'</select></label>'+
    htmlField('external_ref','Identificação única (ex.: CHEQUE-850029)',draft?.cheque_number?'CHEQUE-'+draft.cheque_number:'')+
    htmlField('original_amount','Valor em R$',amount,'number')+htmlField('due_date','Vencimento para cobrança',oneDate,'date')+
    htmlField('cheque_date','Data do cheque (informativa)',oneDate,'date',false)+
    htmlField('return_reason','Motivo da devolução (informativo)',draft?.return_reasons?.join(', '),'text',false)+
    htmlField('notes','Observações e conferência', '', 'text',false)+'</div>';
   const amountInput=pane.querySelector('[name=original_amount]');amountInput.step='0.01';amountInput.min='0.01';
  }
  const file=form.elements.file.files[0];
  if(file){
   if(previewUrl)URL.revokeObjectURL(previewUrl);
   previewUrl=URL.createObjectURL(file);
   const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Conferir arquivo original';details.append(summary);
   if(file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf')){const a=document.createElement('a');a.href=previewUrl;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Abrir PDF original para conferência';details.append(a);}
   else {const img=document.createElement('img');img.src=previewUrl;img.alt='Documento original enviado';img.style.maxWidth='100%';img.style.maxHeight='420px';img.style.objectFit='contain';details.append(img);}
   pane.prepend(details);
  }
  pane.insertAdjacentHTML('beforeend','<label><input type="checkbox" name="reviewed" required> Conferi os dados com o documento original e autorizo o cadastro sem cobrança automática.</label>');
  if(draft?.ocr_text){
   const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Texto bruto reconhecido (para conferência)';const pre=document.createElement('pre');pre.style.whiteSpace='pre-wrap';pre.textContent=draft.ocr_text;details.append(summary,pre);pane.append(details);
  }
  if(draft?.warnings?.length)for(const warning of draft.warnings){const p=document.createElement('p');p.textContent=warning;pane.append(p);}
  reviewed=true;save.disabled=false;
 };
 manual.onclick=()=>guard(async()=>{if(busy)return;draft=null;originalId='';await reviewMarkup();status.textContent='Preenchimento manual liberado. Confira e confirme todos os campos.';});
 read.onclick=()=>guard(async()=>{
  if(busy)return;busy=true;read.disabled=true;save.disabled=true;status.textContent='Conferindo documento…';
  try{
   const file=form.elements.file.files[0];
   if(file){
    if(file.size>5*1024*1024)throw Error('Arquivo acima do limite de 5 MB.');
    const c=creditor.value;draft=await api.server('document_ocr',{creditor_id:c,kind:mode,file:{name:file.name,base64:await asBase64(file)}});
    if(creditor.value!==c)throw Error('A carteira foi alterada. Refaça a leitura.');
    originalId=draft.sha256||'';
   }else{draft=null;originalId='';}
   await reviewMarkup();status.textContent=draft?'Reconhecimento concluído. Confira e ajuste os campos.':'Preenchimento manual liberado. Confira todos os campos.';
  }catch(e){reset();throw e;}finally{busy=false;read.disabled=false;}
 });
 form.onsubmit=e=>{e.preventDefault();guard(async()=>{
  if(busy||!reviewed)throw Error('Faça a conferência do documento.');
  if(!pane.querySelector('[name=reviewed]')?.checked)throw Error('Confirme a conferência do documento original.');
  busy=true;save.disabled=true;read.disabled=true;
  let attachmentWarning='';
  try{
   const data=Object.fromEntries(new FormData(form));
   const fields=Object.fromEntries(new FormData(pane));
   if(mode==='devedor'){
    const name=String(fields.name||'').trim();if(!name)throw Error('Nome obrigatório.');
    const doc=cleanDoc(fields.document);
    if(doc&&![11,14].includes(doc.length))throw Error('CPF/CNPJ inválido.');
    const all=await api.rpc('export',{entity:'debtors',filters:{scope:'Todos'}});
    const existing=all.find(x=>x.creditor_id===data.creditor_id&&((doc&&cleanDoc(x.document)===doc)||normalizedName(x.name)===normalizedName(name)));
    if(existing)throw Error('Devedor já cadastrado ('+existing.name+'). Abra e atualize o cadastro existente; não será criado duplicado.');
    await api.rpc('save',{entity:'debtors',creditor_id:data.creditor_id,name,document:doc,email:fields.email||'',phone:fields.phone||'',address:fields.address||'',city:fields.city||'',notes:originalId?'Importado mediante conferência — SHA256: '+originalId:''});
   }else{
    const amount=toAmount(fields.original_amount),due=toDate(fields.due_date),ref=String(fields.external_ref||'').trim();
    if(!ref||ref.length>200)throw Error('Informe a identificação do cheque.');
    if(!fields.debtor_id)throw Error('Selecione o devedor.');
    const creditorRecord=creditors.find(c=>c.id===data.creditor_id);
    const users=lookups.users||[];
    const operator=users.find(u=>u.id===api.user()?.id)||users[0];
    if(!operator)throw Error('Nenhum responsável habilitado para a cobrança.');
    const created=await api.rpc('new_process',{creditor_id:data.creditor_id,debtor_id:fields.debtor_id,external_ref:ref,original_amount:amount,due_date:due,assigned_to:operator.id,financial_mode:'none',interest_percent:0,fine_percent:0,grace_days:0,contract_ref:'',notes:[fields.notes,fields.cheque_date?'Data informativa do cheque: '+fields.cheque_date:'',fields.return_reason?'Motivo de devolução (conferido): '+fields.return_reason:'',originalId?'Conferido mediante OCR — SHA256: '+originalId:''].filter(Boolean).join(' | ')});
    const sourceFile=form.elements.file.files[0];
    if(sourceFile){
     try{
      const mime=sourceFile.name.toLowerCase().endsWith('.pdf')?'application/pdf':sourceFile.name.toLowerCase().endsWith('.png')?'image/png':'image/jpeg';
      await api.rpc('document',{id:created.id,name:sourceFile.name,mime,content:await asBase64(sourceFile)});
     }catch(error){attachmentWarning='Título criado, mas o anexo não foi salvo: '+error.message+'; evite repetir o lançamento e consulte o título cadastrado.';}
    }
   }
   status.textContent=attachmentWarning||'Cadastro concluído. Nenhuma mensagem de cobrança foi enviada.';
   save.hidden=true;read.hidden=true;pane.querySelectorAll('input,select').forEach(el=>el.disabled=true);
   await onImported();
  }finally{busy=false;save.disabled=false;read.disabled=false;}
 });};
}
