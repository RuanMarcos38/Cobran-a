import {brl} from './money.mjs';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toBase64=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Não foi possível ler o arquivo'));reader.readAsDataURL(file);});
export function openBordero({api,creditor_id,guard,onImported}){
 document.querySelector('dialog')?.remove();const dialog=document.createElement('dialog');
 dialog.innerHTML=`<form><div class="modal-head"><h2>Importar borderô da carteira</h2><button type="button" data-close aria-label="Fechar">×</button></div><div class="form-grid"><label>Arquivo XLS, XLSX ou PDF (até 5 MB)<input name="file" type="file" accept=".xls,.xlsx,.pdf" required></label><label>Contrato que autoriza os encargos (se aplicável)<input name="contract" maxlength="200"></label></div><p>Confira os títulos, o credor e o total antes de confirmar. A importação não dispara cobranças.</p><div data-preview aria-live="polite"></div><div class="modal-actions"><button type="button" data-close>Cancelar</button><button type="submit" class="primary">Ler e conferir arquivo</button></div></form>`;
 document.body.append(dialog);dialog.showModal();const form=dialog.querySelector('form'),button=form.querySelector('[type=submit]'),file=form.elements.file,pane=dialog.querySelector('[data-preview]');let preview=null,busy=false;
 dialog.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{if(!busy)dialog.close();});
 dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
 file.onchange=()=>{preview=null;pane.innerHTML='';button.textContent='Ler e conferir arquivo';};
 form.onsubmit=e=>{e.preventDefault();if(busy)return;guard(async()=>{
  busy=true;button.disabled=true;file.disabled=true;
  try{
   if(!preview){
    const selected=file.files[0];if(!selected||selected.size>5*1024*1024)throw Error('Selecione um arquivo de até 5 MB.');
    const result=await api.server('bordero_preview',{creditor_id,file:{name:selected.name,base64:await toBase64(selected)}});
    pane.innerHTML=`<h3>${esc(result.creditor.name)}</h3><p><strong>${esc(result.count)} títulos · ${brl(result.total)}</strong></p>${result.warnings.map(w=>`<p>${esc(w)}</p>`).join('')}${result.errors.length?`<p role="alert">A importação está bloqueada. Corrija as linhas abaixo e selecione o arquivo novamente.</p><ul>${result.errors.map(r=>`<li>${esc(r.source)}: ${esc(r.error)}</li>`).join('')}</ul>`:''}<div class="table-wrap"><table><thead><tr><th>Origem</th><th>Título</th><th>Devedor</th><th>CPF/CNPJ ou código</th><th>Vencimento</th><th>Em aberto</th><th>Observações</th></tr></thead><tbody>${result.rows.map(r=>`<tr><td>${esc(r.source)}</td><td>${esc(r.external_ref)}</td><td>${esc(r.debtor_name)}</td><td>${esc(r.debtor_document||'Código '+r.debtor_code)}</td><td>${esc(r.due_date.split('-').reverse().join('/'))}</td><td>${brl(r.original_amount)}</td><td>${esc(r.notes)}</td></tr>`).join('')}</tbody></table></div><details><summary>Conferir todos os campos reconhecidos</summary>${result.rows.map(r=>`<p><strong>${esc(r.external_ref)}</strong></p><dl>${Object.entries(r).filter(([k,v])=>k!=='raw'&&v!==null&&v!=='').map(([k,v])=>`<dt>${esc(labels[k]||k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`).join('')}</details>`;
    if(result.count&&!result.errors.length){preview=result;button.textContent='Confirmar importação';}else button.textContent='Ler e conferir arquivo';
   }else{
    const result=await api.rpc('bordero_import',{creditor_id,file_name:preview.file_name,file_hash:preview.file_hash,rows:preview.rows,contract_ref:form.elements.contract.value.trim()});
    preview=null;form.querySelector('.form-grid').hidden=true;button.hidden=true;
    pane.innerHTML=`<p role="status"><strong>Importação concluída:</strong> ${esc(result.created)} títulos criados e ${esc(result.duplicates)} já existentes, sem duplicar ou alterar saldos.</p>`;
    await onImported();
   }
  }finally{busy=false;button.disabled=false;file.disabled=false;}
 });};
}
const labels={creditor_name:'Credor',creditor_document:'CNPJ do credor',debtor_name:'Devedor',debtor_document:'CPF/CNPJ',debtor_code:'Código do devedor',external_ref:'Título',installment:'Parcela',due_date:'Vencimento',issued_at:'Emissão',original_amount:'Valor em aberto',protest_amount:'Valor de protesto (informativo)',debtor_phone:'Telefone completo',debtor_email:'E-mail',address:'Endereço',district:'Bairro',city:'Cidade',state:'UF',zip:'CEP',ddd:'DDD',phone:'Telefone informado',species:'Espécie',notes:'Observações',series_nf:'Série NF',representative:'Representante',representative_phone:'Contato do representante',source:'Origem'};

export function borderoDetails(process){
 const m=process?.metadata;if(!m?.file_bordero)return '';const values=m.original_fields||{};
 return `<details><summary>Dados do borderô importado</summary><div class="detail-grid">${Object.entries(values).filter(([k,v])=>labels[k]&&v!==null&&v!=='').map(([k,v])=>`<div><small>${esc(labels[k])}</small><strong>${esc(v)}</strong></div>`).join('')}</div></details>`;
}
