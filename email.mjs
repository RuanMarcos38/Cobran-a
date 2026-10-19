import nodemailer from 'nodemailer';
import {createCipheriv,createDecipheriv,randomBytes,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
export const sender='cobranca@rrestrategiaperformance.com.br';
const catalog=JSON.parse(await readFile(new URL('./templates/email-cobranca.json',import.meta.url),'utf8')).modelos;
const roles=['admin','master','supervisor','collector','finance'];
const admins=['admin','master'];
function key(env){if(!/^[a-f0-9]{64}$/i.test(env.EMAIL_ENCRYPTION_KEY||''))throw Error('Proteção da configuração de email pendente no servidor.');return Buffer.from(env.EMAIL_ENCRYPTION_KEY,'hex');}
export function encrypt(password,tenant,env){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(env),iv);cipher.setAAD(Buffer.from(tenant));const data=Buffer.concat([cipher.update(password,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),data].map(x=>x.toString('base64')).join('.');}
export function decrypt(value,tenant,env){const [iv,tag,data]=value.split('.').map(x=>Buffer.from(x,'base64'));const cipher=createDecipheriv('aes-256-gcm',key(env),iv);cipher.setAAD(Buffer.from(tenant));cipher.setAuthTag(tag);return Buffer.concat([cipher.update(data),cipher.final()]).toString('utf8');}
function transport(password){return nodemailer.createTransport({host:'smtp.hostinger.com',port:465,secure:true,auth:{user:sender,pass:password},tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000,logger:false,debug:false});}
export function renderEmail(context,options){
 const m=catalog.find(x=>x.id===options.template);if(!m)throw Error('Modelo inválido.');
 if(m.exige_aprovacao_juridica&&(!admins.includes(context.profile.role)||String(options.approval||'').trim().length<10))throw Error('O ajuizamento exige aprovação registrada por um administrador, com identificação do responsável jurídico.');
 const d=context.process,b=context.debtor,c=context.creditor;
 if(!d||!b||!c||!c.name||!context.profile.tenant_name)throw Error('Complete a identificação das empresas e do devedor.');
 if(!b.active||!c.active||b.opt_out||b.dispute_status==='open'||d.human_required||b.human_required||['paid','cancelled','canceled','disputed','uncollectible','legal_review'].includes(d.status)||['Quitado','Suspenso','Devolvido ao cliente','Encerrado'].includes(d.app_status)||!(Number(context.amount)>0))throw Error('Cobrança bloqueada: confira a situação do título e do devedor.');
 const address=String(b.email||'').trim();if(!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(address))throw Error('Cadastre um único email válido do devedor.');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const fmt=v=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(v||''))throw Error('Data inválida.');const [y,mo,da]=v.split('-');return da+'/'+mo+'/'+y;};
 const values={nome_devedor:b.name,empresa_cobradora:context.profile.tenant_name,empresa_credora:c.name,referencia:d.external_ref||d.contract_ref||d.id,vencimento:fmt(d.due_date),data_atualizacao:fmt(context.as_of),valor_atualizado:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(context.amount)};
 if(m.campos_obrigatorios.includes('prazo_resposta')){const value=String(options.deadline||'');fmt(value);if(!Number.isFinite(Date.parse(value))||value<today)throw Error('Informe um prazo de resposta válido, a partir de hoje.');values.prazo_resposta=fmt(value);}
 const fill=s=>s.replace(/\{(\w+)\}/g,(_,k)=>{if(!values[k])throw Error('Campo obrigatório ausente: '+k);return values[k];});
 const subject=fill(m.assunto);if(/[\r\n]/.test(subject))throw Error('Referência inválida no assunto.');
 return {to:address,subject,text:fill(m.corpo),from:sender,template:m.id,approval:m.exige_aprovacao_juridica?String(options.approval).trim():'',deadline:options.deadline||'',legal:m.exige_aprovacao_juridica};
}
export const digest=message=>createHash('sha256').update(JSON.stringify(message)).digest('hex');
export async function handleEmail(operation,body,rpc,env=process.env,makeTransport=transport){
 const profile=await rpc('app','profile',{});if(!roles.includes(profile.role))throw Error('Seu perfil não permite enviar cobranças.');
 if(operation==='email_status'){
  const cfg=await rpc('email','config',{});return {from:sender,configured:!!cfg.cipher,protected:/^[a-f0-9]{64}$/i.test(env.EMAIL_ENCRYPTION_KEY||''),can_configure:admins.includes(profile.role),models:catalog.filter(m=>!m.exige_aprovacao_juridica||admins.includes(profile.role)).map(m=>({id:m.id,name:m.nome,legal:m.exige_aprovacao_juridica,deadline:m.campos_obrigatorios.includes('prazo_resposta')}))};
 }
 if(operation==='email_configure'){
  if(!admins.includes(profile.role))throw Error('Somente administradores podem configurar o remetente.');
  if(typeof body.password!=='string'||!body.password||body.password.length>1000)throw Error('Informe a senha da caixa de cobrança.');
  const cipher=encrypt(body.password,profile.tenant_id,env),client=makeTransport(body.password);
  try{await client.verify();}catch{throw Error('Não foi possível autenticar na Hostinger. Confira a senha da caixa postal.');}finally{client.close();}
  await rpc('email','config_save',{cipher});return {configured:true,from:sender};
 }
 if(operation==='email_preview'){
  const context=await rpc('email','context',{id:body.id});const message=renderEmail(context,body);
  const result=await rpc('email','prepare',{id:body.id,snapshot:context.snapshot,message,hash:digest(message)});return {...result,message};
 }
 if(operation==='email_history')return rpc('email','history',{id:body.id});
 if(operation!=='email_send'||body.confirm!==true)throw Error('Confirme a revisão da mensagem antes do envio.');
 const cfg=await rpc('email','config',{});if(!cfg.cipher)throw Error('Configure a caixa postal antes de enviar.');
 let password;try{password=decrypt(cfg.cipher,profile.tenant_id,env);}catch{throw Error('Configuração protegida indisponível. Peça ao administrador para configurar novamente.');}
 const draft=await rpc('email','draft',{id:body.id,preview_id:body.preview_id});
 const context=await rpc('email','context',{id:body.id});const expected=renderEmail(context,draft.message);
 if(digest(expected)!==draft.hash)throw Error('Dados alterados. Gere uma nova prévia.');
 const claim=await rpc('email','claim',{id:body.id,preview_id:body.preview_id,hash:digest(expected)});
 const client=makeTransport(password);let result;
 try{
  result=await client.sendMail({from:{name:context.profile.tenant_name,address:sender},replyTo:sender,to:expected.to,subject:expected.subject,text:expected.text,messageId:'<'+claim.id+'@rrestrategiaperformance.com.br>'});
  if(!result.accepted?.length)throw Error('not accepted');
 }catch{
  await rpc('email','finish',{id:body.id,preview_id:body.preview_id,claim:claim.claim,status:'incerto'}).catch(()=>{});
  throw Error('Envio sem confirmação. Confira a caixa postal antes de tentar novamente. Não houve repetição automática.');
 }finally{client.close();}
 try{await rpc('email','finish',{id:body.id,preview_id:body.preview_id,claim:claim.claim,status:'aceito_smtp'});}catch{throw Error('Servidor SMTP aceitou a mensagem, mas o histórico ficou pendente. Não reenvie; confira a caixa postal.');}
 return {status:'aceito_smtp',message:'Mensagem aceita pela Hostinger. Acompanhe respostas e devoluções na caixa postal.'};
}
