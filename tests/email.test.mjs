import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderEmail,encrypt,decrypt,handleEmail,digest} from '../email.mjs';
const env={EMAIL_ENCRYPTION_KEY:'12'.repeat(32)};
const context=()=>({profile:{role:'admin',tenant_name:'Assessoria Teste',tenant_id:'tenant1'},process:{id:'debt1',due_date:'2026-01-01',external_ref:'T001',status:'open',app_status:'Em cobrança'},debtor:{email:'debtor@example.invalid',name:'Pessoa Teste',active:true},creditor:{name:'Credora Teste',active:true},amount:'100.50',as_of:'2026-10-19',snapshot:{value:1}});
test('modelos identificam as empresas e impedem cobrança bloqueada',()=>{
 const c=context();const m=renderEmail(c,{template:'primeiro_contato'});assert.match(m.text,/Assessoria Teste/);assert.match(m.text,/Credora Teste/);assert.match(m.text,/100,50/);assert.equal(m.to,'debtor@example.invalid');
 c.process.app_status='Quitado';assert.throws(()=>renderEmail(c,{template:'primeiro_contato'}),/bloqueada/);
 c.process.app_status='Em cobrança';c.debtor.email='a@example.com,b@example.com';assert.throws(()=>renderEmail(c,{template:'primeiro_contato'}),/email/);
});
test('ajuizamento exige aprovação e perfil administrativo',()=>{
 const c=context();assert.throws(()=>renderEmail(c,{template:'ajuizamento_aprovado',deadline:'2099-01-01'}),/aprovação/);
 c.profile.role='collector';assert.throws(()=>renderEmail(c,{template:'ajuizamento_aprovado',approval:'Dra. Teste, parecer 123',deadline:'2099-01-01'}),/aprovação/);
 c.profile.role='admin';assert.equal(renderEmail(c,{template:'ajuizamento_aprovado',approval:'Dra. Teste, parecer 123',deadline:'2099-01-01'}).legal,true);
});
test('senha criptografada fica vinculada à empresa e à chave do servidor',()=>{
 const value=encrypt('secret-test','tenant1',env);assert.equal(decrypt(value,'tenant1',env),'secret-test');assert.throws(()=>decrypt(value,'tenant2',env));assert.throws(()=>decrypt(value,'tenant1',{EMAIL_ENCRYPTION_KEY:'34'.repeat(32)}));assert.ok(!value.includes('secret-test'));
});
test('configuração verifica SMTP antes de persistir e não retorna senha',async()=>{
 const calls=[];const rpc=async(kind,action,payload)=>{calls.push(action);if(kind==='app')return context().profile;return {ok:true};};
 const result=await handleEmail('email_configure',{password:'secret-test'},rpc,env,()=>({verify:async()=>{},close(){}}));assert.equal(result.configured,true);assert.deepEqual(calls,['profile','config_save']);assert.ok(!JSON.stringify(result).includes('secret-test'));
 await assert.rejects(()=>handleEmail('email_configure',{password:'secret-test'},rpc,env,()=>({verify:async()=>{throw Error('secret-test');},close(){}})),/autenticar/);
 await assert.rejects(()=>handleEmail('email_configure',{password:'secret-test'},rpc,env,()=>({verify:async()=>{throw Object.assign(Error('secret-test'),{code:'EAUTH',responseCode:535});},close(){}})),/recusou o login/);
 await assert.rejects(()=>handleEmail('email_configure',{password:'secret-test'},rpc,env,()=>({verify:async()=>{throw Object.assign(Error('secret-test'),{code:'ETIMEDOUT'});},close(){}})),/Falha de conexão: ETIMEDOUT/);
});
test('envio só ocorre após claim; falha fica incerta',async()=>{
 const c=context(),message=renderEmail(c,{template:'primeiro_contato'}),calls=[];
 const rpc=async(kind,action,payload)=>{calls.push(action);if(action==='profile')return c.profile;if(action==='config')return {cipher:encrypt('secret-test','tenant1',env)};if(action==='draft')return {message,hash:digest(message)};if(action==='context')return c;if(action==='claim')return {id:'dispatch1',claim:'claim1'};if(action==='finish')assert.equal(payload.status,'incerto');return {};};
 await assert.rejects(()=>handleEmail('email_send',{id:'debt1',preview_id:'dispatch1',confirm:true},rpc,env,()=>({sendMail:async()=>{calls.push('smtp');throw Error('failure');},close(){}})),/sem confirmação/);
 assert.ok(calls.indexOf('claim')<calls.indexOf('smtp'));assert.equal(calls.at(-1),'finish');
});
