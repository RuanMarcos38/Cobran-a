import {handleAttendance} from './attendance.mjs';
import {dispatchProspect} from './prospection-mail.mjs';
import {automateProspects} from './prospection-automation.mjs';
import {handleBank} from './bank.mjs';
import {parseBorderoCsv} from './bordero-csv.mjs';
import {reviewDocumentUpload} from './ocr-engine.mjs';
import {handleChannel} from './whatsapp.mjs';
import {issueBooking} from './booking.mjs';
import {handleWhatsapp} from './evolution.mjs';
import {handleEmail} from './email.mjs';
import {readFile} from 'node:fs/promises';
const limits=new Map();
const ocrLimits=new Map();
export async function handleApi(req,res,env=process.env){
 const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/api/'))return false;
 res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Authorization,Content-Type,X-Integration-Key');res.setHeader('Access-Control-Allow-Methods','POST,GET,OPTIONS');
 const send=(code,body)=>{res.writeHead(code);res.end(JSON.stringify(body));};
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return true;}
 if(url.pathname==='/api/openapi.json'&&req.method==='GET'){res.end(await readFile(new URL('./openapi.json',import.meta.url),'utf8'));return true;}
 if(req.method!=='POST'||!/^\/api\/v1\/[a-z_]+$/.test(url.pathname)){send(404,{error:'Endpoint não encontrado'});return true;}
 const ip=req.socket.remoteAddress||'unknown',now=Date.now(),limit=limits.get(ip);if(limit&&limit.until>now&&limit.count>=120){send(429,{error:'Limite de requisições atingido. Aguarde um minuto.'});return true;}limits.set(ip,{until:limit&&limit.until>now?limit.until:now+60000,count:limit&&limit.until>now?limit.count+1:1});if(limits.size>10000)for(const[k,v]of limits)if(v.until<now)limits.delete(k);
 if(!env.SUPABASE_URL||!env.SUPABASE_PUBLISHABLE_KEY){send(503,{error:'Backend indisponível'});return true;}
 let body;try{let size=0,parts=[];for await(const chunk of req){size+=chunk.length;if(size>(['/api/v1/bordero_preview','/api/v1/document_ocr'].includes(url.pathname)?7*1024*1024:1024*1024)){send(413,{error:url.pathname==='/api/v1/bordero_preview'?'Arquivo CSV limitado a 5 MB':'Envio limitado a 1 MB'});return true;}parts.push(chunk);}body=JSON.parse(Buffer.concat(parts).toString('utf8'));if(!body||Array.isArray(body)||typeof body!=='object')throw Error();}catch{send(400,{error:'JSON inválido'});return true;}
 const operation=url.pathname.split('/').at(-1),bordero=['borderos','erp_sync','commercial_schedule','prospect_booking','commercial_prospection','contact_events'].includes(operation);const authorization=req.headers.authorization;
 if(bordero&&!req.headers['x-integration-key']){send(401,{error:'Informe X-Integration-Key'});return true;}
 if(!bordero&&operation!=='public_booking'&&!/^Bearer [A-Za-z0-9._-]+$/.test(authorization||'')){send(401,{error:'Autenticação Bearer obrigatória'});return true;}
 if(operation==='commercial_prospection'){
  try{
   if(body.operation&&!['health','mirror','dispatch'].includes(body.operation)){send(400,{error:'Operação reservada ao servidor'});return true;}
   if(body.operation==='dispatch'){
    const rpc=async payload=>{const r=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/cobranca_prospect_sync',{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({token:req.headers['x-integration-key'],payload}),signal:AbortSignal.timeout(20000)});const d=await r.json();if(!r.ok)throw Error('Fila comercial indisponível');return d;};
    // Failures in DNS, IMAP or WhatsApp automation must not prevent a safe SMTP claim.
    let automation,delivery,sheet_updates;
    const warnings=[];
    try{automation=await automateProspects(rpc,env);}
    catch(e){automation={enabled:false,status:'unavailable'};warnings.push('automation_unavailable');console.error(JSON.stringify({event:'prospection_automation_failed',category:e.name||'Error'}));}
    try{delivery=await dispatchProspect(rpc,env);}
    catch(e){delivery={status:'unavailable'};warnings.push('smtp_preflight_or_queue_unavailable');console.error(JSON.stringify({event:'prospection_dispatch_failed',category:e.name||'Error'}));}
    try{sheet_updates=await rpc({operation:'sheet_updates'});}
    catch(e){sheet_updates=[];warnings.push('sheet_updates_unavailable');console.error(JSON.stringify({event:'prospection_sheet_updates_failed',category:e.name||'Error'}));}
    send(200,{data:{...delivery,automation,sheet_updates,warnings}});return true;
   }
   const upstream=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/cobranca_prospect_sync',{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({token:req.headers['x-integration-key'],payload:body}),signal:AbortSignal.timeout(20000)});
   const result=await upstream.json();send(upstream.ok?200:result.code==='28000'?401:400,upstream.ok?{data:result}:{error:'Integração comercial rejeitada. Confira a chave, a planilha e o resultado informado.'});
  }catch{send(502,{error:'Não foi possível confirmar a operação comercial. Confira o painel antes de repetir um envio.'});}return true;
 }
 if(operation==='document_ocr'){
  const key=ip, previous=ocrLimits.get(key),current=Date.now();
  const entry=previous&&previous.until>current?previous:{until:current+60000,count:0};
  if(++entry.count>5){send(429,{error:'Limite de OCR por minuto excedido.'});return true;}
  ocrLimits.set(key,entry);
  if(ocrLimits.size>5000)for(const [k,v] of ocrLimits)if(v.until<current)ocrLimits.delete(k);
  try{
   const f=body.file,kind=body.kind;
   if(!['cheque','devedor'].includes(kind)||!body.creditor_id||!f)throw Error('Informe documento, tipo e carteira do credor.');
   const upstream=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/cobranca_app',{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({action:'profile',payload:{}}),signal:AbortSignal.timeout(15000)});
   const profile=await upstream.json();
   if(!upstream.ok||!['admin','master','supervisor'].includes(profile.role)){send(403,{error:'Somente perfis de gestão podem importar documentos.'});return true;}
   const cred=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/cobranca_app',{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({action:'bordero_context',payload:{creditor_id:body.creditor_id}}),signal:AbortSignal.timeout(15000)});
   if(!cred.ok){send(403,{error:'Carteira não autorizada.'});return true;}
   const creditor=await cred.json();
   const result=await reviewDocumentUpload(f,kind);
   send(200,{data:{...result,creditor:{id:creditor.id,name:creditor.name}}});
  }catch(e){send(400,{error:e.message});}
  return true;
 }
 if(operation==='bordero_preview'){
  try{
   const f=body.file;
   if(!f||typeof f.name!=='string'||!/^[-\w\s.()À-ÿ]{1,200}\.csv$/i.test(f.name)||typeof f.base64!=='string'||f.base64.length>6990508||f.base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(f.base64))throw Error('CSV inválido ou maior que 5 MB');
   const cred=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/cobranca_app',{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({action:'bordero_context',payload:{creditor_id:body.creditor_id}}),signal:AbortSignal.timeout(20000)});
   const creditor=await cred.json();
   if(!cred.ok){send(cred.status,{error:creditor.message||'Não autorizado para a carteira'});return true;}
   const bytes=Buffer.from(f.base64,'base64');
   send(200,{data:{...parseBorderoCsv(bytes,f.name,creditor),creditor}});
  }catch(e){send(400,{error:e.message});}return true;
 }
 if(['booking_link','prospect_booking','public_booking'].includes(operation)){
  const rpc=async(name,args)=>{const upstream=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json',...(operation==='booking_link'?{Authorization:authorization}:{})},body:JSON.stringify(args),signal:AbortSignal.timeout(20000)});const data=await upstream.json();if(!upstream.ok){const error=Error(data.message||'Solicitação rejeitada');error.status=data.code==='40001'?409:data.code==='28000'?401:400;throw error;}return data;};
  try{const data=operation==='public_booking'?await rpc('cobranca_booking_public',{token:body.token,payload:{operation:body.operation,start:body.start,contact_name:body.contact_name}}):await issueBooking(body,rpc,env,operation==='prospect_booking'?req.headers['x-integration-key']:null);send(200,{data});}catch(error){send(error.status||400,{error:error.message});}return true;
 }
 if(operation.startsWith('attend_')){
 const rpc=async(kind,action,payload)=>{const name=kind==='attend'?'cobranca_attendance':kind==='email'?'cobranca_email':kind==='improve'?'cobranca_improvements':'cobranca_app';const r=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({action,payload}),signal:AbortSignal.timeout(20000)});const data=await r.json();if(!r.ok){const error=Error(data.message||'Atendimento não autorizado');error.code=/^[A-Z0-9]{5}$/.test(data.code||'')?data.code:'RPC';error.stage=action;throw error;}return data;};
 if(operation==='attend_bordero_first_email'){
 try{
  const {accounts}=await rpc('attend','accounts',{});
  const mail=accounts.filter(x=>x.channel==='email'&&x.sector==='collections'&&x.active!==false);
  if(mail.length!==1){send(409,{error:'É necessária uma conta ativa de e-mail de cobrança.'});return true;}
  const [account]=mail;
  await rpc('attend','account_secret',{account_id:account.id});
  const contacts=await rpc('app','reserve_bordero_first_email',{batch_id:body.batch_id});
  let accepted=0,unconfirmed=0;
  for(const contact of contacts){
   try{
    const thread=await rpc('attend','thread_open',{account_id:account.id,address:contact.email,name:contact.name});
    const message=await rpc('attend','message_prepare',{thread_id:thread.id,nonce:contact.debtor_id,subject:'Contato da R&R Estratégia & Performance',content:'Olá! Somos da R&R Estratégia & Performance. Entramos em contato em nome de '+contact.creditor_name+' sobre uma pendência. Você tem interesse em conversar sobre um acordo amigável? Responda a este e-mail para falar com nossa equipe. Se este contato não for o responsável, por favor nos avise.',note:false});
    await handleAttendance('attend_send',{account_id:account.id,thread_id:thread.id,message_id:message.id},rpc,env);
    accepted++;
   }catch{unconfirmed++;}
  }
  send(200,{data:{accepted,unconfirmed}});
 }catch{send(400,{error:'Não foi possível confirmar o primeiro contato. Consulte o atendimento.'});}
 return true;
 }
 try{send(200,{data:await handleAttendance(operation,body,rpc,env)});}catch(error){console.error(JSON.stringify({event:'attendance_failure',operation,stage:error.stage||'provider',code:error.code||error.name||'Error'}));send(400,{error:error.public?error.message:'Não foi possível concluir. Confira a conexão e as permissões da conta de atendimento.'});}return true;
 }
 if(['email_status','email_configure','email_preview','email_send','email_history'].includes(operation)){
  const rpc=async(kind,action,payload)=>{const r=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/'+(kind==='email'?'cobranca_email':'cobranca_app'),{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({action,payload}),signal:AbortSignal.timeout(20000)});const d=await r.json();if(!r.ok)throw Error(d.message||'Acesso não autorizado');return d;};
  try{send(200,{data:await handleEmail(operation,body,rpc,env)});}catch(e){send(400,{error:e.message});}return true;
 }
 if(['bank_configure','bank_connection_test'].includes(operation)){
  const rpc=async(action,payload)=>{const response=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/cobranca_app',{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({action,payload}),signal:AbortSignal.timeout(20000)});const result=await response.json();if(!response.ok)throw Error(result.message||'Sem autorização bancária');return result;};
  try{send(200,{data:await handleBank(operation,body,rpc,env)});}catch(error){send(400,{error:error.message});}
  return true;
 }
 if(['whatsapp_status','whatsapp_send','whatsapp_configure','whatsapp_qr'].includes(operation)){
  const rpc=async(kind,action,payload)=>{const r=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/'+(kind==='improve'?'cobranca_improvements':'cobranca_app'),{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({action,payload}),signal:AbortSignal.timeout(20000)});const d=await r.json();if(!r.ok)throw Error(d.message||'Acesso não autorizado');return d;};
  try{send(200,{data:await handleChannel(operation,body,rpc,env)});}catch(e){send(400,{error:e.message});}return true;
 }
 try{const upstream=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/'+(operation==='commercial_schedule'?'cobranca_schedule':operation==='erp_sync'?'cobranca_erp_sync':operation==='contact_events'?'cobranca_contact_event':bordero?'cobranca_bordero':'cobranca_app'),{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json',...(bordero?{}:{Authorization:authorization})},body:JSON.stringify(bordero?{token:req.headers['x-integration-key'],payload:body}:{action:operation,payload:body}),signal:AbortSignal.timeout(20000)});const data=await upstream.json();send(upstream.ok?200:(operation==='commercial_schedule'||operation==='contact_events')&&data.code==='28000'?401:operation==='commercial_schedule'&&data.code==='40001'?409:upstream.status,{...(upstream.ok?{data}:{error:data.message||'Solicitação rejeitada'})});}catch{send(502,{error:'Não foi possível acessar o backend'});}return true;
}
