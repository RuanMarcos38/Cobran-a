export let config;
export async function agreementStatement(id){await rpc('profile');return request('/rest/v1/rpc/cobranca_agreement_statement',{method:'POST',body:JSON.stringify({payload:{id}})});}
let session=null;let sessionEpoch=0;
export async function init(){config=await fetch('/config').then(r=>r.json());try{session=JSON.parse(sessionStorage.getItem('cobranca_session')||'null');}catch{session=null;sessionStorage.removeItem('cobranca_session');}}
export const authenticated=()=>!!session;
export const user=()=>session?.user;
async function request(route,options={}){
  if(!config.url||!config.key)throw Error('Conexão com banco pendente. Configure SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY.');
  const epoch=sessionEpoch;const r=await fetch(config.url+route,{...options,headers:{apikey:config.key,'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session.access_token}:{}),...options.headers}});
  const data=await r.json().catch(()=>null);
  if(epoch!==sessionEpoch)throw Error('A sessão foi alterada. Entre novamente.');
  if(!r.ok){if(r.status===401){session=null;sessionStorage.removeItem('cobranca_session');}throw Error(data?.message||data?.msg||data?.error_description||'Não foi possível concluir a operação.');}return data;
}
export async function login(email,password){++sessionEpoch;session=await request('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})});sessionStorage.setItem('cobranca_session',JSON.stringify(session));}
export async function signUp(email,password){return request('/auth/v1/signup',{method:'POST',body:JSON.stringify({email,password})});}
export async function membership(operation,payload={}){return request('/rest/v1/rpc/cobranca_membership',{method:'POST',body:JSON.stringify({operation,payload})});}
export async function claimAdmin(){return request('/rest/v1/rpc/cobranca_claim_admin',{method:'POST',body:'{}'});}
export async function logout(){++sessionEpoch;try{await request('/auth/v1/logout',{method:'POST'});}finally{session=null;sessionStorage.removeItem('cobranca_session');}}
export async function rpc(action,payload={}){
  if(session&&session.expires_at<Date.now()/1000+60){session=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:session.refresh_token})});sessionStorage.setItem('cobranca_session',JSON.stringify(session));}
  return request('/rest/v1/rpc/cobranca_app',{method:'POST',body:JSON.stringify({action,payload})});
}

export async function server(operation,payload={}){
 await rpc('profile');const epoch=sessionEpoch;
 const r=await fetch('/api/v1/'+operation,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify(payload)});const data=await r.json();
 if(epoch!==sessionEpoch)throw Error('A sessão foi alterada. Entre novamente.');if(!r.ok)throw Error(data.error||'Operação rejeitada');return data.data;
}

export async function improve(action,payload={}){await rpc('profile');return request('/rest/v1/rpc/cobranca_improvements',{method:'POST',body:JSON.stringify({action,payload})});}
export async function changePassword(password){await rpc('profile');return request('/auth/v1/user',{method:'PUT',body:JSON.stringify({password})});}

export async function attendance(action,payload={}){await rpc('profile');return request('/rest/v1/rpc/cobranca_attendance',{method:'POST',body:JSON.stringify({action,payload})});}
export async function mailQuery(payload={}){await rpc('profile');return request('/rest/v1/rpc/cobranca_mail_query',{method:'POST',body:JSON.stringify({payload})});}
export async function prospect(action,payload={}){await rpc('profile');return request('/rest/v1/rpc/cobranca_prospect',{method:'POST',body:JSON.stringify({action,payload})});}
export async function debtorContext(ids){await rpc('profile');return request('/rest/v1/rpc/cobranca_debtor_context',{method:'POST',body:JSON.stringify({payload:{ids}})});}

export async function negotiate(action,payload={}){await rpc('profile');return request('/rest/v1/rpc/cobranca_negotiate',{method:'POST',body:JSON.stringify({action,payload})});}
