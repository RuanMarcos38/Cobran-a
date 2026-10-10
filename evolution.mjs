// Server-only Evolution API adapter. Never expose credentials to the browser.
export function connectionFor(env,tenant){
 let connections;try{connections=JSON.parse(env.WHATSAPP_CONNECTIONS_JSON||'{}');}catch{throw Error('Configuração WhatsApp inválida');}
 const c=Object.hasOwn(connections,tenant)?connections[tenant]:null;
 if(!c?.url||!c?.apikey||!c?.instance)return null;
 const url=new URL(c.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('Endereço Evolution inválido');
 return {...c,url:c.url.replace(/\/$/,'')};
}
async function call(c,path,body,fetcher=fetch){
 const r=await fetcher(c.url+path+'/'+encodeURIComponent(c.instance),{method:body?'POST':'GET',headers:{apikey:c.apikey,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
 const data=await r.json().catch(()=>null);if(!r.ok)throw Error('Evolution rejeitou a solicitação. Verifique a conexão no painel.');return data;
}
export async function connectionStatus(c,fetcher=fetch){if(!c)return {ready:false,state:'not_configured'};const data=await call(c,'/instance/connectionState',null,fetcher);return {ready:data?.instance?.state==='open',state:data?.instance?.state||'disconnected'};}
export async function sendEvolution(c,message,fetcher=fetch){
 const number=String(message.phone||'').replace(/\D/g,'');if(!/^[1-9][0-9]{11,14}$/.test(number))throw Error('Cadastre o telefone com código do país e DDD, por exemplo 55 + DDD + número.');
 const a=message.attachment;let endpoint,body;
 if(a){endpoint='/message/sendMedia';body={number,mediatype:a.mime.startsWith('image/')?'image':a.mime.startsWith('audio/')?'audio':'document',mimetype:a.mime,fileName:a.name,caption:message.content||'',media:a.base64.replace(/\s/g,'')};}
 else{endpoint='/message/sendText';body={number,text:message.content,linkPreview:false};}
 const data=await call(c,endpoint,body,fetcher);const id=data?.key?.id;if(typeof id!=='string'||!id)throw Error('O provedor não confirmou o envio. Verifique antes de tentar novamente.');return {provider_id:id,status:'accepted'};
}
export async function handleWhatsapp(operation,body,rpc,env){
 const profile=await rpc('profile',{});if(!['admin','master','commercial','commercial_manager'].includes(profile.role))throw Error('Atendimento não autorizado');
 const c=connectionFor(env,profile.tenant_id);const status=await connectionStatus(c);
 if(operation==='whatsapp_status')return status;
 if(!status.ready)throw Error('WhatsApp pendente. Conecte um número comercial à Evolution API.');
 const message=await rpc('chat_claim',{id:body.id,message_id:body.message_id});if(message.already)return {provider_id:message.provider_id,status:'accepted'};
 try{const result=await sendEvolution(c,message);await rpc('chat_delivery',{id:body.id,message_id:body.message_id,claim:message.claim,...result});return result;}
 catch(error){await rpc('chat_delivery',{id:body.id,message_id:body.message_id,claim:message.claim,status:'unknown'}).catch(()=>{});throw error;}
}
