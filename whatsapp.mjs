import {encrypt,decrypt} from './email.mjs';
import {connectionFor,handleWhatsapp} from './evolution.mjs';
function validateOrigin(value,env){let url;try{url=new URL(value);}catch{throw Error('Endereço da Evolution inválido.');}const allowed=String(env.EVOLUTION_ALLOWED_ORIGIN||'').replace(/\/$/,'');if(url.origin!==allowed||url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Utilize o endereço Evolution autorizado no servidor.');return url.origin;}
async function provider(c,path,body,fetcher=fetch){const r=await fetcher(c.url+path,{method:body?'POST':'GET',headers:{apikey:c.apikey,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok){const error=Error(r.status===401||r.status===403?'A Evolution recusou a chave de API.':'Não foi possível concluir a conexão com a Evolution.');error.status=r.status;throw error;}return r.json();}
export async function handleChannel(operation,body,rpc,env=process.env,fetcher=fetch){
 const profile=await rpc('app','profile',{});if(!['admin','master','commercial','commercial_manager'].includes(profile.role))throw Error('Atendimento não autorizado.');
 const admin=['admin','master'].includes(profile.role),aad=profile.tenant_id+':whatsapp';
 let c=connectionFor(env,profile.tenant_id);
 const saved=await rpc('improve','channel_get',{});if(saved.cipher){try{c=JSON.parse(decrypt(saved.cipher,aad,env));}catch{throw Error('Configuração do WhatsApp indisponível. Peça ao administrador para configurar novamente.');}}
 if(operation==='whatsapp_configure'){
  if(!admin)throw Error('Configuração exclusiva do administrador.');
  const url=validateOrigin(body.url,env);if(typeof body.apikey!=='string'||body.apikey.length<8||body.apikey.length>2000)throw Error('Informe a chave de API da Evolution.');
  c={url,apikey:body.apikey,instance:'cobranca-'+profile.tenant_id.replace(/-/g,'')};
  try{await provider(c,'/instance/connectionState/'+c.instance,null,fetcher);}catch(error){if(error.status!==404)throw error;await provider(c,'/instance/create',{instanceName:c.instance,qrcode:false,integration:'WHATSAPP-BAILEYS'},fetcher);}
  await rpc('improve','channel_save',{cipher:encrypt(JSON.stringify(c),aad,env)});
  return {configured:true,instance:c.instance};
 }
 if(operation==='whatsapp_qr'){
  if(!admin)throw Error('Conexão do WhatsApp exclusiva do administrador.');if(!c)throw Error('Configure a Evolution API antes de gerar o QR code.');
  const state=await provider(c,'/instance/connectionState/'+encodeURIComponent(c.instance),null,fetcher);
  if(state?.instance?.state==='open')return {ready:true,state:'open'};
  const result=await provider(c,'/instance/connect/'+encodeURIComponent(c.instance),null,fetcher);
  const raw=result?.base64||result?.qrcode?.base64||'';if(typeof raw!=='string'||raw.length>1500000||!/^data:image\/png;base64,[A-Za-z0-9+/=\r\n]+$/.test(raw))return {ready:false,state:'connecting',message:'QR ainda em preparação. Clique em Atualizar QR em alguns segundos.'};
  return {ready:false,state:'qr',base64:raw.slice(raw.indexOf(',')+1)};
 }
 const override=c?{...env,WHATSAPP_CONNECTIONS_JSON:JSON.stringify({[profile.tenant_id]:c})}:env;
 const result=await handleWhatsapp(operation,body,(action,payload)=>rpc('app',action,payload),override,fetcher);
 return operation==='whatsapp_status'?{...result,can_configure:admin,origin:env.EVOLUTION_ALLOWED_ORIGIN||c?.url||'',configured:!!c}:result;
}
