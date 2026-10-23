import nodemailer from 'nodemailer';
import {decrypt} from './email.mjs';
import {validateMailConfig} from './attendance.mjs';
const transport=c=>nodemailer.createTransport({host:c.smtpHost,port:465,secure:true,auth:{user:c.address,pass:c.password},tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},logger:false,debug:false,connectionTimeout:15000,socketTimeout:30000});
// Preflight precedes the durable claim; after claiming, every failure is uncertain.
export async function dispatchProspect(rpc,env=process.env,{createTransport=transport,decode=decrypt}={}){
 const account=await rpc({operation:'sender'});
 const cfg=validateMailConfig(JSON.parse(decode(account.cipher,account.tenant_id+':attendance:'+account.id,env)),env);
 if(cfg.address!==account.address)throw Error('Conta comercial inconsistente');
 const smtp=createTransport(cfg);
 try{
  await smtp.verify();
  const {lead,reason}=await rpc({operation:'claim'});
  if(!lead)return {status:'idle',reason};
  try{
   if(!/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(lead.email)||/[\r\n]/.test(lead.assunto))throw Error('Contato inválido');
   const result=await smtp.sendMail({from:cfg.address,replyTo:cfg.address,to:lead.email,subject:lead.assunto,text:lead.mensagem,messageId:'<prospect-'+lead.attempt_id+'@'+cfg.address.split('@')[1]+'>'});
   if(!result.accepted?.some(x=>String(x).toLowerCase()===lead.email.toLowerCase())||result.rejected?.length||!result.messageId)throw Error('SMTP não confirmou o destinatário');
   await rpc({operation:'finish',attempt_id:lead.attempt_id,status:'accepted',provider_id:result.messageId});
   return {status:'accepted',id:lead.id,email:lead.email,attempt_id:lead.attempt_id,provider_id:result.messageId};
  }catch{
   await rpc({operation:'finish',attempt_id:lead.attempt_id,status:'unknown'}).catch(()=>{});
   return {status:'review',id:lead.id,attempt_id:lead.attempt_id};
  }
 }finally{smtp.close();}
}
