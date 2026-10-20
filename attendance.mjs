import {readMailboxes,imapMessageLocation} from './mail-imap.mjs';
import {randomUUID} from 'node:crypto';
import nodemailer from 'nodemailer';
import {ImapFlow} from 'imapflow';
import {simpleParser} from 'mailparser';
import sanitizeHtml from 'sanitize-html';
import {encrypt,decrypt,sender} from './email.mjs';
import {sendEvolution} from './evolution.mjs';
const publicError=message=>Object.assign(Error(message),{public:true});
const administrators=['admin','master'];
export const safeEmailHtml=html=>sanitizeHtml(String(html||'').slice(0,100000),{allowedTags:['p','br','div','span','b','strong','i','em','u','ul','ol','li','table','thead','tbody','tr','th','td','h1','h2','h3','blockquote','hr','pre','a'],allowedAttributes:{a:['href','title'],td:['colspan','rowspan'],th:['colspan','rowspan']},allowedSchemes:['https','http','mailto'],allowProtocolRelative:false});
export function validateMailConfig(config,env){
 const hosts=new Set(['imap.hostinger.com','smtp.hostinger.com',...(env.MAIL_ALLOWED_HOSTS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean)]);
 if(!hosts.has(String(config.imapHost).toLowerCase())||!hosts.has(String(config.smtpHost).toLowerCase()))throw publicError('Servidor de e-mail não autorizado. Cadastre os hosts IMAP/SMTP no servidor antes de conectar outro provedor.');
 if(!/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(config.address)||/[\r\n]/.test(config.address)||!config.password||config.password.length>1000)throw publicError('Endereço ou senha da caixa postal inválidos.');
 return {...config,imapPort:993,smtpPort:465};
}
const imapClient=c=>new ImapFlow({host:c.imapHost,port:993,secure:true,auth:{user:c.address,pass:c.password},tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},logger:false,connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000});
const smtpClient=c=>nodemailer.createTransport({host:c.smtpHost,port:465,secure:true,auth:{user:c.address,pass:c.password},tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},logger:false,debug:false,connectionTimeout:15000,socketTimeout:30000});
async function evolution(c,path,body){
 const r=await fetch(c.url+path,{method:body?'POST':'GET',headers:{apikey:c.apikey,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw publicError('WhatsApp indisponível (HTTP '+r.status+').');return r.json();
}
export function evolutionMessages(data){
 const rows=(data?.messages?.records||data?.records||[]).map(x=>({...x,phoneJid:[x.key?.remoteJid,x.key?.remoteJidAlt].find(j=>typeof j==='string'&&j.endsWith('@s.whatsapp.net'))}));
 return rows.filter(x=>x.phoneJid&&x.key?.id).slice(0,100).map(x=>{
  const media=x.message?.imageMessage||x.message?.audioMessage||x.message?.documentMessage;
  return {provider_id:x.key.id,provider_ref:x.key.remoteJid,address:x.phoneJid.split('@')[0],name:x.pushName||x.phoneJid.split('@')[0],content:String(x.message?.conversation||x.message?.extendedTextMessage?.text||media?.caption||(media?'[Anexo recebido]':'[Mensagem não textual]')).slice(0,100000),attachments:media?[{index:0,name:media.fileName||(x.message.audioMessage?'audio.ogg':'anexo'),mime:media.mimetype||'application/octet-stream',size:Number(media.fileLength)||0,remote:true}]:[],created_at:new Date(Number(x.messageTimestamp)*1000||Date.now()).toISOString(),from_me:x.key.fromMe===true};
 });
}
export async function readInbox(c,createImap=imapClient){return readMailboxes(c,createImap,safeEmailHtml);}
export async function handleAttendance(operation,body,rpc,env=process.env){
 const profile=await rpc('app','profile',{});
 const aad=id=>profile.tenant_id+':attendance:'+id;
 if(operation==='attend_members'){
  if(!administrators.includes(profile.role))throw publicError('Administrador necessário.');
  const a=await rpc('attend','account_secret',{account_id:body.account_id});return rpc('attend','account_save',{...a,members:body.members});
 }
 if(operation==='attend_configure'){
  if(!administrators.includes(profile.role))throw publicError('Somente o administrador pode configurar contas.');
  if(!['commercial','collections'].includes(body.sector)||!['email','whatsapp'].includes(body.channel))throw publicError('Canal ou setor inválidos.');
  body={...body,address:body.channel==='email'?String(body.address||'').trim().toLowerCase():String(body.address||'').replace(/\D/g,'')};
  if(body.channel==='whatsapp'&&!/^[1-9][0-9]{11,14}$/.test(body.address))throw publicError('Informe código do país, DDD e número.');
  const id=randomUUID();let cfg;
  await rpc('attend','account_save',{id,name:body.name,sector:body.sector,channel:body.channel,address:body.address,members:body.members||[],cipher:'validation-placeholder-only',validate_only:true});
  if(body.channel==='email'){
   let password=body.password;
   if(body.reuse_existing===true&&body.address===sender){const saved=await rpc('email','config',{});if(!saved.cipher)throw publicError('A caixa existente ainda não foi configurada.');password=decrypt(saved.cipher,profile.tenant_id,env);}
   cfg=validateMailConfig({address:body.address,password,imapHost:body.imap_host||'imap.hostinger.com',smtpHost:body.smtp_host||'smtp.hostinger.com'},env);
   const smtp=smtpClient(cfg),imap=imapClient(cfg);
   try{await smtp.verify();await imap.connect();}catch{throw publicError('Não foi possível autenticar IMAP e SMTP. Confira a caixa e a senha. A configuração anterior foi preservada.');}finally{smtp.close();await imap.logout().catch(()=>{});}
  }else{
   let legacy;
   if(body.reuse_existing===true){const saved=await rpc('improve','channel_get',{});if(saved.cipher)legacy=JSON.parse(decrypt(saved.cipher,profile.tenant_id+':whatsapp',env));}
   const url=String(body.url||legacy?.url||env.EVOLUTION_ALLOWED_ORIGIN||'').replace(/\/$/,'');
   if(!env.EVOLUTION_ALLOWED_ORIGIN||url!==env.EVOLUTION_ALLOWED_ORIGIN.replace(/\/$/,'')||new URL(url).protocol!=='https:')throw publicError('Use o endereço autorizado da integração WhatsApp existente.');
   cfg={url,apikey:body.apikey||legacy?.apikey,instance:'cobranca-'+profile.tenant_id.replaceAll('-','')+'-'+id.replaceAll('-','').slice(0,12)};
   if(!cfg.apikey||cfg.apikey.length>2000)throw publicError('Configure a chave da integração WhatsApp.');
   // Dedicated instance per account: never changes another project or legacy session.
   await evolution(cfg,'/instance/create',{instanceName:cfg.instance,qrcode:false,integration:'WHATSAPP-BAILEYS'});
  }
  return rpc('attend','account_save',{id,name:body.name,sector:body.sector,channel:body.channel,address:body.address,members:body.members||[],cipher:encrypt(JSON.stringify(cfg),aad(id),env)});
 }
 let claimed;
 if(operation==='attend_send')claimed=await rpc('attend','message_claim',body);
 const account=claimed?.account||await rpc('attend','account_secret',{account_id:body.account_id});
 let cfg;try{cfg=JSON.parse(decrypt(account.cipher,aad(account.id),env));}catch{
  if(claimed)await rpc('attend','message_finish',{...body,status:'unknown'}).catch(()=>{});
  throw publicError('Configuração protegida indisponível. Peça ao administrador para revisar a conta.');
 }
 if(operation==='attend_status'){
  if(account.channel==='email')return {ready:true,state:'configured'};
  const status=await evolution(cfg,'/instance/connectionState/'+encodeURIComponent(cfg.instance));return {ready:status.instance?.state==='open',state:status.instance?.state||'unknown'};
 }
 if(operation==='attend_qr'){
  if(!administrators.includes(profile.role)||account.channel!=='whatsapp')throw publicError('Administrador necessário para conectar WhatsApp.');
  const q=await evolution(cfg,'/instance/connect/'+encodeURIComponent(cfg.instance));
  if(typeof q.base64!=='string'||q.base64.length>1500000||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(q.base64))throw publicError('QR Code indisponível. Verifique se o número já está conectado.');return {base64:q.base64};
 }
 if(operation==='attend_sync'){
  const messages=account.channel==='email'?await readInbox(cfg):evolutionMessages(await evolution(cfg,'/chat/findMessages/'+encodeURIComponent(cfg.instance),{where:{},page:1,offset:100}));
  for(let i=0;i<messages.length;i+=5)await rpc('attend','sync',{account_id:account.id,messages:messages.slice(i,i+5)});
  return {synced:messages.length};
 }
 if(operation==='attend_attachment'){
  const detail=await rpc('attend','thread_messages',{thread_id:body.thread_id});
  if(detail.thread.account_id!==account.id)throw publicError('Anexo não pertence a esta conta.');
  const message=detail.messages.find(m=>m.id===body.message_id);if(!message)throw publicError('Mensagem não encontrada.');
  if(account.channel==='whatsapp'){
   const file=await evolution(cfg,'/chat/getBase64FromMediaMessage/'+encodeURIComponent(cfg.instance),{message:{key:{id:message.provider_id,remoteJid:message.provider_ref||detail.thread.address+'@s.whatsapp.net',fromMe:message.direction==='outbound'}},convertToMp4:false});
   const base64=String(file.base64||'').replace(/^data:[^;]+;base64,/,'').replace(/\s/g,'');
   if(!base64||base64.length>6990508||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))throw publicError('Mídia indisponível ou maior que 5 MB.');
   return {base64,mime:file.mimetype||message.attachments?.[0]?.mime||'application/octet-stream',name:file.fileName||message.attachments?.[0]?.name||'anexo'};
  }
  const stored=message.attachments?.[Number(body.index)];if(stored?.base64)return {name:stored.name,mime:stored.mime,base64:stored.base64};
  let location;try{location=imapMessageLocation(message);}catch{throw publicError('Identificador do e-mail inválido.');}
  const client=imapClient(cfg);try{
   await client.connect();const lock=await client.getMailboxLock(location.path,{readOnly:true});try{
    if(String(client.mailbox.uidValidity)!==location.validity)throw publicError('Caixa postal alterada. Sincronize novamente.');
    const item=await client.fetchOne(location.uid,{source:true,size:true},{uid:true});if(!item||item.size>5242880||item.source.length>5242880)throw publicError('E-mail ausente ou maior que 5 MB.');
    const parsed=await simpleParser(item.source);const attachment=parsed.attachments[Number(body.index)];if(!attachment||attachment.size>5242880)throw publicError('Anexo indisponível.');
    return {name:attachment.filename||'anexo',mime:attachment.contentType,base64:attachment.content.toString('base64')};
   }finally{lock.release();}
  }finally{await client.logout().catch(()=>{});}
 }
 if(operation!=='attend_send'||!claimed)throw publicError('Operação inválida.');
 const {message,thread}=claimed;let provider_id;
 try{
  if(account.channel==='whatsapp'){
   const result=await sendEvolution(cfg,{phone:thread.address,content:message.content,attachment:message.attachments?.[0]});provider_id=result.provider_id;
  }else{
   if(!/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(thread.address)||/[\r\n]/.test(message.subject))throw publicError('Destinatário ou assunto inválido.');
   const client=smtpClient(cfg);
   try{const result=await client.sendMail({from:cfg.address,replyTo:cfg.address,to:thread.address,subject:message.subject||thread.subject||'Atendimento',text:message.content,...(claimed.reply_to&&!/[\r\n]/.test(claimed.reply_to)?{inReplyTo:claimed.reply_to,references:[claimed.reply_to]}:{}),attachments:(message.attachments||[]).filter(a=>a.base64).map(a=>({filename:a.name,content:Buffer.from(a.base64,'base64'),contentType:a.mime})),messageId:'<'+message.id+'@'+cfg.address.split('@')[1]+'>'});if(!result.accepted?.length)throw publicError('SMTP não confirmou');provider_id=result.messageId;}finally{client.close();}
  }
 }catch{
  await rpc('attend','message_finish',{...body,status:'unknown'}).catch(()=>{});
  throw publicError('Envio sem confirmação. Confira a conversa ou caixa postal antes de reenviar. Não houve repetição automática.');
 }
 await rpc('attend','message_finish',{...body,status:'accepted',provider_id});return {status:'accepted'};
}
