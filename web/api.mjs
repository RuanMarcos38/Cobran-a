export let config;
let session=null;
export async function init(){config=await fetch('/config').then(r=>r.json());session=JSON.parse(sessionStorage.getItem('cobranca_session')||'null');}
export const authenticated=()=>!!session;
export const user=()=>session?.user;
async function request(route,options={}){
  if(!config.url||!config.key)throw Error('Conexão com banco pendente. Configure SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY.');
  const r=await fetch(config.url+route,{...options,headers:{apikey:config.key,'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session.access_token}:{}),...options.headers}});
  const data=await r.json().catch(()=>null);
  if(!r.ok){if(r.status===401){session=null;sessionStorage.removeItem('cobranca_session');}throw Error(data?.message||data?.msg||data?.error_description||'Não foi possível concluir a operação.');}return data;
}
export async function login(email,password){session=await request('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})});sessionStorage.setItem('cobranca_session',JSON.stringify(session));}
export async function signUp(email,password){return request('/auth/v1/signup',{method:'POST',body:JSON.stringify({email,password})});}
export async function claimAdmin(){return request('/rest/v1/rpc/cobranca_claim_admin',{method:'POST',body:'{}'});}
export async function logout(){try{await request('/auth/v1/logout',{method:'POST'});}finally{session=null;sessionStorage.removeItem('cobranca_session');}}
export async function rpc(action,payload={}){
  if(session&&session.expires_at<Date.now()/1000+60){session=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:session.refresh_token})});sessionStorage.setItem('cobranca_session',JSON.stringify(session));}
  return request('/rest/v1/rpc/cobranca_app',{method:'POST',body:JSON.stringify({action,payload})});
}
