import {brl} from './money.mjs';
export const collectionScripts=[['cordial','Primeiro contato cordial'],['statement','Demonstrativo atualizado'],['proposal','Proposta de negociação'],['followup','Retomada do contato']];
export function collectionScript(kind,{debtor,creditor,quote,simulation,sender='Equipe de cobrança'}){
 const name=debtor?.name?.trim();if(!name)throw Error('Identifique o devedor antes de gerar o e-mail.');
 if(['statement','proposal'].includes(kind)&&!quote)throw Error('Abra a negociação para incluir valores conferidos.');
 if(kind==='proposal'&&!simulation)throw Error('Corrija a simulação antes de gerar a proposta.');
 const summary=quote?`\n\nDemonstrativo atualizado em ${quote.as_of.split('-').reverse().join('/')}:\nPrincipal: ${brl(quote.principal)}\nJuros: ${brl(quote.interest)}\nMulta: ${brl(quote.fine)}\nHonorários: ${brl(quote.fees||0)}\nSaldo: ${brl(quote.total)}`:'';
 const reference=creditor?.name?` referente a ${creditor.name}`:'';
 const texts={cordial:`Olá, ${name}.\n\nEntramos em contato para conversar sobre a regularização dos títulos${reference}. Podemos verificar as condições de pagamento mais adequadas para você?`,statement:`Olá, ${name}.\n\nSegue o demonstrativo dos títulos${reference}, atualizado conforme as condições cadastradas do contrato.${summary}\n\nSe identificar alguma divergência ou pagamento já realizado, responda este e-mail para conferirmos.`,proposal:`Olá, ${name}.\n\nPreparamos uma proposta para os títulos${reference}.${summary}`+(simulation?`\n\nDesconto proposto: ${brl(simulation.discount)}\nTotal da proposta: ${brl(simulation.total)}\n`+simulation.schedule.map(p=>`${p.label}: ${brl(p.amount)} em ${p.due_date.split('-').reverse().join('/')}`).join('\n'):'')+`\n\nA proposta depende da conferência do saldo e do seu aceite. Responda este e-mail para avaliar as condições.`,followup:`Olá, ${name}.\n\nGostaríamos de retomar a conversa sobre os títulos${reference}. Estamos à disposição para esclarecer os valores e avaliar uma possibilidade de negociação. Se já regularizou, envie a informação para conferência.`};
 if(!texts[kind])throw Error('Escolha um modelo de cobrança válido.');
 return {subject:`${kind==='proposal'?'Proposta de negociação':'Atendimento de cobrança'} — ${name}`,content:texts[kind]+`\n\nAtenciosamente,\n${sender}`};
}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function collectionComposer(container,{api,guard,notify,context,beforeSend=async()=>{}}){
 container.innerHTML=`<details class="collection-email"><summary>E-mail de cobrança</summary><p>Escolha uma variação, confira o destinatário e revise o texto antes de enviar.</p><div class="negotiation-inputs"><label>Caixa postal<select data-collection-account><option value="">Carregar contas autorizadas</option></select></label><label>Destinatário<input type="text" inputmode="email" data-collection-to value="${esc(context().debtor.email||'')}" maxlength="250"></label><label>Modelo<select data-collection-model>${collectionScripts.map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}</select></label><button type="button" data-collection-generate>Gerar texto</button></div><label>Assunto<input data-collection-subject maxlength="250"></label><label>Mensagem<textarea data-collection-content rows="10" maxlength="100000"></textarea></label><p data-collection-status role="status"></p><button type="button" data-collection-send>Enviar e-mail revisado</button></details>`;
 const el=s=>container.querySelector(s),status=el('[data-collection-status]');let accounts=[],loaded=false,sending=false,pending,generatedContext;
 const contextKey=()=>JSON.stringify([context().quote?.snapshot,context().quote?.as_of,context().simulation]);
 el('details').addEventListener('toggle',()=>{if(!el('details').open||loaded)return;loaded=true;guard(async()=>{try{const r=await api.attendance('accounts');accounts=r.accounts.filter(a=>a.channel==='email'&&a.sector==='collections');el('[data-collection-account]').innerHTML=accounts.map(a=>`<option value="${esc(a.id)}">${esc(a.address)}</option>`).join('')||'<option value="">Nenhuma caixa autorizada</option>';if(!accounts.length)status.textContent='Configure uma caixa de cobrança autorizada para enviar.';}catch(e){loaded=false;throw e;}});});
 el('[data-collection-generate]').onclick=()=>guard(async()=>{const generated=collectionScript(el('[data-collection-model]').value,context());el('[data-collection-subject]').value=generated.subject;el('[data-collection-content]').value=generated.content;generatedContext=contextKey();status.textContent='Texto gerado. Confira o destinatário e os valores; nada foi enviado.';});
 el('[data-collection-send]').onclick=()=>guard(async()=>{
  if(sending)return;
  const account=accounts.find(a=>a.id===el('[data-collection-account]').value),address=el('[data-collection-to]').value.trim().toLowerCase(),subject=el('[data-collection-subject]').value.trim(),content=el('[data-collection-content]').value.trim();
  if(!account||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)||!address||!subject||!content)throw Error('Selecione a caixa e preencha destinatário, assunto e mensagem.');
  const signature=JSON.stringify([account.id,address,subject,content]);
  if(pending)throw Error('Este envio já foi solicitado. Confira o histórico de e-mail antes de tentar novamente.');
  if(generatedContext&&generatedContext!==contextKey())throw Error('A proposta foi alterada. Gere o texto novamente e confira os valores antes de enviar.');
  await beforeSend();
  sending=true;el('[data-collection-send]').disabled=true;
  try{const t=await api.attendance('thread_open',{account_id:account.id,address,name:context().debtor.name});pending={nonce:crypto.randomUUID(),signature};const prepared=await api.attendance('message_prepare',{thread_id:t.id,nonce:pending.nonce,subject,content,note:false});await api.server('attend_send',{account_id:account.id,thread_id:t.id,message_id:prepared.id});status.textContent='E-mail aceito pelo provedor. Consulte o envio e as respostas no E-mail de atendimento.';notify('E-mail aceito pelo provedor.');}
  catch(e){status.textContent=pending?'Envio sem confirmação nesta tela. Confira o histórico antes de reenviar.':e.message;throw e;}
  finally{sending=false;el('[data-collection-send]').disabled=!!pending;}
 });
}
