import {encrypt,decrypt} from './email.mjs';

// Server-only bank credentials handler. The browser never receives stored credentials.
export async function handleBank(operation,body,rpc,env=process.env){
 const profile=await rpc('profile',{});
 if(!['admin','master'].includes(profile.role))throw Error('Somente o administrador pode configurar credenciais bancárias.');
 const uuid=String(body.bank_id||'');
 if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(uuid))throw Error('Identificador bancário inválido.');
 if(operation==='bank_configure'){
  const credentials=Object.fromEntries(['client_id','client_secret','api_key'].map(k=>[k,String(body[k]||'').trim()]));
  if(!credentials.client_id||!credentials.client_secret||Object.values(credentials).some(x=>x.length>4096)||credentials.client_id.length<3||credentials.client_secret.length<8)throw Error('Informe Client ID e Client Secret válidos do banco.');
  const settings=await rpc('bank_secret_get',{bank_id:uuid});
  if(settings.provider==='manual'||settings.provider==='outro')throw Error('O provedor escolhido não aceita configuração de API. Escolha o banco correspondente.');
  const cipher=encrypt(JSON.stringify(credentials),profile.tenant_id+':bank:'+uuid,env);
  const result=await rpc('bank_secret_save',{bank_id:uuid,cipher});
  return {configured:result.configured===true,status:'configured',ready_for_issuance:false,requires_homologation:true};
 }
 if(operation==='bank_connection_test'){
  const settings=await rpc('bank_secret_get',{bank_id:uuid});
  if(!settings.cipher)return {connected:false,configured:false,status:'missing_credentials',message:'Configure as credenciais do banco antes de homologar.'};
  try{const stored=JSON.parse(decrypt(settings.cipher,profile.tenant_id+':bank:'+uuid,env));
   if(!stored.client_id||!stored.client_secret)throw Error();
  }catch{throw Error('Não foi possível validar as credenciais armazenadas. Revise a proteção de segredos no servidor.');}
  // No arbitrary URL requests/SSRF or fake bank response. Provider-specific verified adapters are mandatory.
  return {connected:false,configured:true,status:'pending_homologation',message:'Credenciais armazenadas e protegidas. O teste bancário real e a emissão exigem o adaptador oficial e a homologação do banco contratado.'};
 }
 throw Error('Operação bancária não autorizada');
}
