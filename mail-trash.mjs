import {imapMessageLocation,sentMailbox,trashMailbox} from './mail-imap.mjs';
const address=x=>String(x||'').trim().toLowerCase();
export function verifyMailContact(envelope,account,contact){
 const own=address(account),other=address(contact),from=(envelope?.from||[]).map(x=>address(x.address)),to=[...(envelope?.to||[]),...(envelope?.cc||[])].map(x=>address(x.address));
 if(!(from.includes(other)||(from.includes(own)&&to.includes(other))))throw Error('O e-mail não corresponde ao contato autorizado. Sincronize novamente.');
}
// A mutation is never retried. UIDPLUS prevents expunging unrelated messages.
export async function mutateMailbox(config,createImap,message,thread,operation,before){
 if(message.direction==='note'||message.mail_state?.local_only){await before();return {location:null,local_only:true};}
 const client=createImap(config);let lock;
 try{
  await client.connect();const folders=await client.list();let trash=trashMailbox(folders);const sent=sentMailbox(folders);
  if(!trash&&operation==='trash'){await client.mailboxCreate('Trash');trash='Trash';}
  if(!trash)throw Error('Pasta de lixeira indisponível na caixa postal.');
  if(!client.capabilities?.has('UIDPLUS')||(operation!=='purge'&&!client.capabilities?.has('MOVE')))throw Error('O servidor não confirmou suporte à exclusão segura por UID.');
  let location;try{location=imapMessageLocation(message);}catch{
   if(message.direction!=='outbound')throw Error('Sincronize o e-mail antes de excluir.');
   const id=message.provider_id;if(!sent||!id||!String(id).startsWith('<')){await before();return {location:null,local_only:true};}
   lock=await client.getMailboxLock(sent);const ids=await client.search({header:{'Message-ID':id}},{uid:true});
   if(!ids?.length){lock.release();lock=null;await before();return {location:null,local_only:true};}
   location={path:sent,uid:String(ids.at(-1)),validity:String(client.mailbox.uidValidity)};lock.release();lock=null;
  }
  if(operation!=='trash'&&location.path!==trash)throw Error('A mensagem não está na lixeira do servidor. Sincronize novamente.');
  lock=await client.getMailboxLock(location.path);
  if(String(client.mailbox.uidValidity)!==location.validity)throw Error('A caixa postal mudou. Sincronize antes de excluir.');
  const item=await client.fetchOne(location.uid,{envelope:true},{uid:true});
  if(!item){if(operation==='purge'){await before();return {location};}throw Error('E-mail não encontrado na pasta. Sincronize novamente.');}
  verifyMailContact(item.envelope,config.address,thread.address);
  const expected=message.mail_state?.message_id||[message.provider_id,message.provider_ref].find(x=>typeof x==='string'&&x.startsWith('<'));
  if(expected&&item.envelope?.messageId!==expected)throw Error('A identidade do e-mail mudou. Sincronize novamente.');
  await before();
  if(operation==='purge'){if(!await client.messageDelete(location.uid,{uid:true}))throw Error('Exclusão sem confirmação.');return {location};}
  const target=operation==='trash'?trash:(message.mail_state?.original_path==='INBOX'?'INBOX':message.direction==='outbound'&&sent?sent:'INBOX');
  const result=await client.messageMove(location.uid,target,{uid:true}),uid=result?.uidMap?.get(Number(location.uid));
  if(!uid||!result.uidValidity)throw Error('Movimentação sem confirmação de UID.');
  return {location:{path:target,uid:String(uid),validity:String(result.uidValidity)},original_path:location.path};
 }finally{lock?.release();await client.logout().catch(()=>{});}
}
export async function handleMailMutation(body,account,cfg,rpc,createImap){
 const operation=body.operation;
 if(!['trash','restore','purge'].includes(operation)||account.channel!=='email')throw Error('Operação de e-mail inválida.');
 if(operation==='purge'&&body.confirmed!==true)throw Error('Confirme a exclusão permanente.');
 const detail=await rpc('attend','thread_messages',{thread_id:body.thread_id});
 if(detail.thread.account_id!==account.id)throw Error('Mensagem não pertence a esta conta.');
 const message=detail.messages.find(m=>m.id===body.message_id);if(!message)throw Error('Mensagem não encontrada.');
 const nonce=crypto.randomUUID();let claimed=false;
 const payload={account_id:account.id,thread_id:detail.thread.id,message_id:message.id,nonce,operation};
 try{
  const result=await mutateMailbox(cfg,createImap,message,detail.thread,operation,async()=>{await rpc('attend','mail_action_begin',payload);claimed=true;});
  return await rpc('attend','mail_action_finish',{...payload,...result});
 }catch(e){if(claimed){await rpc('attend','mail_action_finish',{...payload,uncertain:true}).catch(()=>{});throw Error('Operação sem confirmação. Sincronize antes de tentar novamente. Não houve repetição automática.');}throw e;}
}
