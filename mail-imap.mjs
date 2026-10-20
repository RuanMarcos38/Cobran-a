import {simpleParser} from 'mailparser';
export function sentMailbox(folders){
 return folders.find(f=>f.specialUse==='\\Sent')?.path||folders.find(f=>/^(sent|sent items|sent messages|enviados|inbox\.sent)$/i.test(f.path))?.path;
}
export function imapMessageLocation(message){
 const inbox=String(message.provider_id).match(/^imap:(\d+):(\d+)$/);
 if(inbox)return {path:'INBOX',validity:inbox[1],uid:inbox[2]};
 const sent=String(message.provider_ref||message.provider_id).match(/^imap-sent:([A-Za-z0-9_-]+):(\d+):(\d+)$/);
 if(!sent)throw Error('Identificador do e-mail inválido.');
 const path=Buffer.from(sent[1],'base64url').toString('utf8');
 if(!path||path.length>200||/[\x00-\x1f]/.test(path))throw Error('Pasta de e-mail inválida.');
 return {path,validity:sent[2],uid:sent[3]};
}
export async function readMailboxes(config,createImap,sanitize){
 const client=createImap(config),messages=[];
 try{
  await client.connect();
  const sent=client.list?sentMailbox(await client.list()):undefined;
  for(const path of ['INBOX',...(sent&&sent!=='INBOX'?[sent]:[])]){
   const outgoing=path!=='INBOX',lock=await client.getMailboxLock(path,{readOnly:true});
   try{
    const count=client.mailbox.exists;if(!count)continue;
    for await(const item of client.fetch(Math.max(1,count-49)+':'+count,{envelope:true,source:true,size:true})){
     if(!item.source||item.size>5242880||item.source.length>5242880)continue;
     const parsed=await simpleParser(item.source,{skipHtmlToText:false,skipTextToHtml:true,skipImageLinks:true});
     const contact=(outgoing?parsed.to:parsed.from)?.value?.[0];if(!contact?.address)continue;
     const locator=outgoing?'imap-sent:'+Buffer.from(path).toString('base64url')+':'+client.mailbox.uidValidity+':'+item.uid:'imap:'+client.mailbox.uidValidity+':'+item.uid;
     const messageId=typeof parsed.messageId==='string'&&parsed.messageId.length<=500?parsed.messageId:null;
     messages.push({provider_id:outgoing?(messageId||locator):locator,provider_ref:outgoing?locator:messageId,address:contact.address.toLowerCase(),name:contact.name||contact.address,subject:String(parsed.subject||'Sem assunto').slice(0,250),content:String(parsed.text||'[E-mail sem texto disponível]').slice(0,100000),html:sanitize(parsed.html),created_at:parsed.date?.toISOString()||new Date().toISOString(),attachments:(parsed.attachments||[]).slice(0,20).map((a,index)=>({index,name:a.filename||'anexo',mime:a.contentType,size:a.size})),from_me:outgoing});
    }
   }finally{lock.release();}
  }
 }finally{await client.logout().catch(()=>{});}
 return messages;
}
