const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function configureEmail({api,modal,notify}){
 const status=await api.server('email_status');if(!status.can_configure)throw Error('Somente administradores podem configurar o email.');
 if(!status.protected)throw Error('A proteção da senha precisa ser configurada no servidor antes de continuar.');
 const d=modal('Configurar email de cobrança',`<p>Remetente e resposta: <strong>${esc(status.from)}</strong></p><p>Hostinger · smtp.hostinger.com · porta 465 · conexão segura.</p><p>Informe a senha da caixa postal de cobrança. O sistema testa a autenticação sem enviar email e guarda a senha criptografada. Não informe a senha do hPanel.</p><label>Senha da caixa postal<input name="password" type="password" autocomplete="off" required maxlength="1000"></label><p>${status.configured?'Já existe uma configuração. Salvar substituirá apenas a senha de envio desta empresa.':'Envio aguardando configuração.'}</p>`,async data=>{await api.server('email_configure',{password:data.password});d.querySelector('[name=password]').value='';notify('Hostinger autenticada. Remetente de cobrança configurado.');});
 d.querySelector('[type=submit]').textContent='Testar e salvar';
}
export async function openEmail(id,{api,modal,notify,guard,refresh}){
 const status=await api.server('email_status');
 if(!status.configured){if(status.can_configure){await configureEmail({api,modal,notify});return;}throw Error('Peça ao administrador para configurar o email de cobrança.');}
 const d=modal('Enviar cobrança por email',`<p>Remetente: <strong>${esc(status.from)}</strong></p><label>Modelo<select name="template">${status.models.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select></label><label data-email-deadline hidden>Prazo de resposta<input type="date" name="deadline"></label><label data-email-approval hidden>Responsável jurídico e referência da aprovação de ajuizamento<textarea name="approval" maxlength="1000" rows="3"></textarea></label><p data-email-legal hidden>A mensagem informa uma decisão real de ajuizamento. Registre a aprovação do responsável jurídico antes de usá-la.</p><p>A mensagem será preenchida com o nome do devedor, empresa credora, referência, vencimento e saldo atualizado. Você verá o conteúdo antes de enviar.</p>`,async data=>{
  const preview=await api.server('email_preview',{id,...data});const m=preview.message;
  const p=modal('Revisar cobrança antes do envio',`<p><strong>De:</strong> ${esc(m.from)}<br><strong>Para:</strong> ${esc(m.to)}</p><h3>${esc(m.subject)}</h3><pre class="email-preview">${esc(m.text)}</pre>${m.legal?`<p>Autorização registrada: ${esc(m.approval)}</p>`:''}<label><input name="confirmed" type="checkbox" required> Conferi o destinatário, o saldo, o conteúdo e a autorização aplicável.</label><p>Aceitação pelo servidor não comprova entrega ou leitura. Respostas e devoluções devem ser acompanhadas na caixa postal.</p>`,async data=>{if(data.confirmed!=='on')throw Error('Confirme a revisão.');const result=await api.server('email_send',{id,preview_id:preview.preview_id,confirm:true});notify(result.message);await refresh();});
  p.querySelector('[type=submit]').textContent='Confirmar e enviar cobrança';
 });
 d.querySelector('[type=submit]').textContent='Gerar prévia';
 const update=()=>{const m=status.models.find(m=>m.id===d.querySelector('[name=template]').value);d.querySelector('[data-email-deadline]').hidden=!m.deadline;d.querySelector('[name=deadline]').required=m.deadline;d.querySelector('[data-email-approval]').hidden=!m.legal;d.querySelector('[data-email-legal]').hidden=!m.legal;d.querySelector('[name=approval]').required=m.legal;};
 d.querySelector('[name=template]').onchange=update;update();
}
export async function emailHistory(id,{api,modal}){
 const data=await api.server('email_history',{id});modal('Histórico de emails do processo','<p>Aceito pelo SMTP: servidor aceitou a mensagem. Incerto ou enviando: conferir a caixa antes de repetir.</p>'+data.rows.map(r=>`<article><strong>${esc(r.subject)}</strong><p>${esc(r.recipient)} · ${esc(r.status)} · ${esc(r.created_at)}</p></article>`).join('')||'<p>Nenhum envio registrado.</p>',null);
}
