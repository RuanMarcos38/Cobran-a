import test from 'node:test';import assert from 'node:assert/strict';
import {dispatchProspect} from '../prospection-mail.mjs';
const fixture={id:'account',tenant_id:'tenant',cipher:'encrypted',address:'sales@example.invalid'};
const lead={id:'lead',email:'client@example.invalid',assunto:'Contato',mensagem:'Mensagem técnica',attempt_id:'attempt'};
function setup({verifyError=false,sendError=false,accepted=true,finishError=false,idle=false}={}){
 const calls=[];let sends=0,closes=0;
 const rpc=async p=>{calls.push(p);if(p.operation==='sender')return fixture;if(p.operation==='claim')return idle?{lead:null,reason:'paused'}:{lead};if(finishError&&p.status==='accepted')throw Error('database timeout');return {saved:true};};
 const dependencies={decode:(_c,aad)=>{assert.equal(aad,'tenant:attendance:account');return JSON.stringify({address:fixture.address,password:'fixture-password',smtpHost:'smtp.hostinger.com',imapHost:'imap.hostinger.com'});},createTransport:()=>({verify:async()=>{if(verifyError)throw Error('authentication');},sendMail:async mail=>{sends++;assert.equal(mail.to,lead.email);assert.equal(mail.from,fixture.address);assert.match(mail.messageId,/prospect-attempt/);if(sendError)throw Error('connection reset');return {accepted:accepted?[lead.email]:[],rejected:[],messageId:'<smtp-confirmed@example.invalid>'};},close:()=>closes++})};
 return {rpc,dependencies,calls,get sends(){return sends;},get closes(){return closes;}};
}
test('commercial SMTP uses configured account and records evidence only after acceptance',async()=>{const x=setup();assert.equal((await dispatchProspect(x.rpc,{},x.dependencies)).status,'accepted');assert.equal(x.sends,1);assert.equal(x.closes,1);assert.deepEqual(x.calls.map(c=>c.operation),['sender','claim','finish']);assert.equal(x.calls.at(-1).provider_id,'<smtp-confirmed@example.invalid>');});
test('failed preflight never reserves or sends a lead',async()=>{const x=setup({verifyError:true});await assert.rejects(()=>dispatchProspect(x.rpc,{},x.dependencies));assert.deepEqual(x.calls.map(c=>c.operation),['sender']);assert.equal(x.sends,0);assert.equal(x.closes,1);});
test('paused or empty queue does not send',async()=>{const x=setup({idle:true});assert.equal((await dispatchProspect(x.rpc,{},x.dependencies)).status,'idle');assert.equal(x.sends,0);});
for(const scenario of [{sendError:true},{accepted:false},{finishError:true}])test('SMTP or persistence uncertainty is held without retry '+JSON.stringify(scenario),async()=>{const x=setup(scenario);assert.equal((await dispatchProspect(x.rpc,{},x.dependencies)).status,'review');assert.equal(x.sends,1);assert.equal(x.calls.at(-1).status,'unknown');});
