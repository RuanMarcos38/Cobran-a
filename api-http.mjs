import {handleBank} from './bank.mjs';
import {parseBorderoCsv} from './bordero-csv.mjs';
import {handleChannel} from './whatsapp.mjs';
import {issueBooking} from './booking.mjs';
import {handleWhatsapp} from './evolution.mjs';
import {handleEmail} from './email.mjs';
import {readFile} from 'node:fs/promises';
const limits=new Map();
export async function handleApi(req,res,env=process.env){
 const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/api/'))return false;
 res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Authorization,Content-Type,X-Integration-Key');res.setHeader('Access-Control-Allow-Methods','POST,GET,OPTIONS');
 const send=(code,body)=>{res.writeHead(code);res.end(JSON.stringify(body));};
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return true;}
 if(url.pathname==='/api/openapi.json'&&req.method==='GET'){res.end(await readFile(new URL('./openapi.json',import.meta.url),'utf8'));return true;}
 if(req.method!=='POST'||!/^\/api\/v1\/[a-z_]+$/.test(url.pathname)){send(404,{error:'Endpoint não encontrado'});return true;}
 const ip=req.socket.remoteAddress||'unknown',now=Date.now(),limit=limits.get(ip);if(limit&&limit.until>now&&limit.count>=120){send(429,{error:'Limite de requisições atingido. Aguarde um minuto.'});return true;}limits.set(ip,{until:limit&&limit.until>now?limit.until:now+60000,count:limit&&limit.until>now?limit.count+1:1});if(limits.size>10000)for(const[k,v]of limits)if(v.until<now)limits.delete(k);
 if(!env.SUPABASE_URL||!env.SUPABASE_PUBLISHABLE_KEY){send(503,{error:'Backend indisponível'});return true;}
 let body;try{let size=0,parts=[];for await(const chunk of req){size+=chunk.length;if(size>(url.pathname==='/api/v1/bordero_preview'?7*1024*1024:1024*1024)){send(413,{error:url.pathname==='/api/v1/bordero_preview'?'Arquivo CSV limitado a 5 MB':'Envio limitado a 1 MB'});return true;}parts.push(chunk);}body=JSON.parse(Buffer.concat(parts).toString('utf8'));if(!body||Array.isArray(body)||typeof body!=='object')throw Error();}catch{send(400,{error:'JSON inválido'});return true;}
 const operation=url.pathname.split('/').at(-1),bordero=['borderos','erp_sync','commercial_schedule','prospect_booking'].includes(operation);const authorization=req.headers.authorization;
 if(bordero&&!req.headers['x-integration-key']){send(401,{error:'Informe X-Integration-Key'});return true;}
 if(!bordero&&operation!=='public_booking'&&!/^Bearer [A-Za-z0-9._-]+$/.test(authorization||'')){send(401,{error:'Autenticação Bearer obrigatória'});return true;}
 if(operation==='bordero_preview'){
  try{
   const f=body.file;
   if(!f||typeof f.name!=='string'||!/^[-\w\s.()À-ÿ]{1,200}\.csv$/i.test(f.name)||typeof f.base64!=='string'||f.base64.length>6990508||f.base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(f.base64))throw Error('CSV inválido ou maior que 5 MB');
   const cred=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/cobranca_app',{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({action:'bordero_context',payload:{creditor_id:body.creditor_id}}),signal:AbortSignal.timeout(20000)});
   const creditor=await cred.json();
   if(!cred.ok){send(cred.status,{error:creditor.message||'Não autorizado para a carteira'});return true;}
   const bytes=Buffer.from(f.base64,'base64');
   send(200,{data:{...parseBorderoCsv(bytes,f.name),creditor}});
  }catch(e){send(400,{error:e.message});}return true;
 }
 if(['booking_link','prospect_booking','public_booking'].includes(operation)){
  const rpc=async(name,args)=>{const upstream=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json',...(operation==='booking_link'?{Authorization:authorization}:{})},body:JSON.stringify(args),signal:AbortSignal.timeout(20000)});const data=await upstream.json();if(!upstream.ok){const error=Error(data.message||'Solicitação rejeitada');error.status=data.code==='40001'?409:data.code==='28000'?401:400;throw error;}return data;};
  try{const data=operation==='public_booking'?await rpc('cobranca_booking_public',{token:body.token,payload:{operation:body.operation,start:body.start,contact_name:body.contact_name}}):await issueBooking(body,rpc,env,operation==='prospect_booking'?req.headers['x-integration-key']:null);send(200,{data});}catch(error){send(error.status||400,{error:error.message});}return true;
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
 try{const upstream=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/'+(operation==='commercial_schedule'?'cobranca_schedule':operation==='erp_sync'?'cobranca_erp_sync':bordero?'cobranca_bordero':'cobranca_app'),{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json',...(bordero?{}:{Authorization:authorization})},body:JSON.stringify(bordero?{token:req.headers['x-integration-key'],payload:body}:{action:operation,payload:body}),signal:AbortSignal.timeout(20000)});const data=await upstream.json();send(upstream.ok?200:operation==='commercial_schedule'&&data.code==='28000'?401:operation==='commercial_schedule'&&data.code==='40001'?409:upstream.status,{...(upstream.ok?{data}:{error:data.message||'Solicitação rejeitada'})});}catch{send(502,{error:'Não foi possível acessar o backend'});}return true;
}
