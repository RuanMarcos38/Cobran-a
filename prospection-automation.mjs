import {resolveMx} from 'node:dns/promises';
import {decrypt} from './email.mjs';
import {validateMailConfig,readInbox} from './attendance.mjs';

export function classifyReply(message){
 const text=String(message||'').split(/\n\s*(?:Em .+ escreveu:|On .+wrote:|De:|From:|>)/i)[0].slice(0,3000).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
 if(/\b(remov[ae]|descadastr|nao (?:tenho|temos|ha) interesse|nao (?:quero|desejo)|nao (?:me |nos )?contat|pare de enviar|unsubscribe|opt.?out)/.test(text))return 'optout';
 if(/\b(nao|sem interesse|talvez|automatic[ao]|ausente|ferias|out of office|delivery failure|mailer-daemon)\b/.test(text))return 'review';
 return /\b(tenho interesse|temos interesse|pode(?:m)? (?:me |nos )?(?:ligar|contatar|enviar|mandar|apresentar)|vamos (?:conversar|agendar|marcar)|gostaria (?:de saber|de conhecer|de agendar)|quero (?:saber|conhecer|agendar))\b/.test(text)?'positive':'review';
}
export const normalizePhone=value=>{let n=String(value||'').replace(/\D/g,'');if(n.length===10||n.length===11)n='55'+n;return /^[1-9][0-9]{11,14}$/.test(n)?n:null;};
export async function checkDomain(email,lookup=resolveMx){
 const domain=String(email).split('@')[1];if(!domain)return false;
 let timer;try{return (await Promise.race([lookup(domain),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('DNS timeout')),3000);})])).some(x=>typeof x.exchange==='string'&&x.exchange!=='.'&&x.exchange.length>0);}catch{return false;}finally{clearTimeout(timer);}
}
// Only bounded, deterministic bookkeeping is permitted for inbound content.
// An exact known sender AND a reference to our stored SMTP message are required.
export async function automateProspects(rpc,env=process.env,{lookup=resolveMx,decode=decrypt,inbox=cfg=>readInbox(cfg,undefined,{inboxOnly:true}),fetcher=fetch}={}){
 const c=await rpc({operation:'automation_context'});if(!c.enabled)return {enabled:false};
 let domains=0,replies=0,whatsapp=0;
 for(const lead of c.candidates||[]){
  const valid=await checkDomain(lead.email,lookup);
  await rpc({operation:'email_check',id:lead.id,email:lead.email,valid});domains++;
 }
 const sender=c.sender;
 if(sender&&(c.contacted||[]).length){
  try{
   const cfg=validateMailConfig(JSON.parse(decode(sender.cipher,sender.tenant_id+':attendance:'+sender.id,env)),env);
   for(const m of await inbox(cfg)){
    if(m.from_me||m.mail_trashed||m.auto_submitted||!m.mail_message_id)continue;
    const refs=[m.in_reply_to,...(m.references||[])].filter(Boolean);
    const lead=c.contacted.find(l=>l.email===m.address&&refs.includes(l.provider_id));if(!lead)continue;
    await rpc({operation:'reply',id:lead.id,email:m.address,provider_id:m.mail_message_id,in_reply_to:lead.provider_id,classification:classifyReply(m.content),content:String(m.content).slice(0,5000)});replies++;
   }
  }catch{await rpc({operation:'automation_status',channel:'email',status:'unavailable'});}
 }
 const wa=c.whatsapp,lead=(c.phones||[])[0];
 if(wa&&lead){
  try{
   const cfg=JSON.parse(decode(wa.cipher,wa.aad,env));
   const origin=String(env.EVOLUTION_ALLOWED_ORIGIN||'').replace(/\/$/,'');
   if(!origin||cfg.url.replace(/\/$/,'')!==origin||new URL(origin).protocol!=='https:')throw Error('Origin');
   const number=normalizePhone(lead.phone);if(!number)throw Error('Number');
   const r=await fetcher(origin+'/chat/whatsappNumbers/'+encodeURIComponent(cfg.instance),{method:'POST',headers:{apikey:cfg.apikey,'Content-Type':'application/json'},body:JSON.stringify({numbers:[number]}),redirect:'error',signal:AbortSignal.timeout(20000)});
   if(!r.ok)throw Error('Provider');const rows=await r.json();
   const found=Array.isArray(rows)?rows.find(x=>normalizePhone(x.number||x.jid?.split('@')[0])===number):null;
   if(!found||typeof found.exists!=='boolean')throw Error('Evidence');
   await rpc({operation:'whatsapp_check',id:lead.id,number,exists:found.exists});whatsapp++;
  }catch{await rpc({operation:'automation_status',channel:'whatsapp',status:'unavailable'});}
 }
 await rpc({operation:'auto_approve'});
 return {enabled:true,domains,replies,whatsapp};
}
