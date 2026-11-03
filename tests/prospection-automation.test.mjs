import test from 'node:test';import assert from 'node:assert/strict';
import {classifyReply,normalizePhone,checkDomain,automateProspects} from '../prospection-automation.mjs';
test('positive intent excludes refusals, quoted content and automated answers',()=>{
 assert.equal(classifyReply('Tenho interesse, vamos agendar uma conversa.'),'positive');
 for(const s of ['Não tenho interesse','Talvez, vamos agendar','Estou ausente. Tenho interesse','Sem interesse','Olá\n> Tenho interesse','Não quero receber estes emails'])assert.notEqual(classifyReply(s),'positive');
 assert.equal(classifyReply('Remova meu contato'),'optout');
});
test('MX check rejects null MX, errors and malformed contacts',async()=>{
 assert.equal(await checkDomain('a@example.invalid',async()=>[{exchange:'mx.example.invalid'}]),true);
 assert.equal(await checkDomain('a@example.invalid',async()=>[{exchange:'.'}]),false);
 assert.equal(await checkDomain('a@example.invalid',async()=>{throw Error();}),false);
 assert.equal(normalizePhone('(47) 99999-0000'),'5547999990000');assert.equal(normalizePhone('123'),null);
});
test('only exact known sender and our outbound reference can create a response event',async()=>{
 const calls=[];const context={enabled:true,candidates:[],contacted:[{id:'lead',email:'lead@example.invalid',provider_id:'<our-message>'}],sender:{id:'account',tenant_id:'tenant',cipher:'protected'}};
 const rpc=async p=>{calls.push(p);return p.operation==='automation_context'?context:{};};
 const msg={mail_message_id:'<reply>',address:'lead@example.invalid',in_reply_to:'<our-message>',content:'Tenho interesse'};
 await automateProspects(rpc,{}, {decode:()=>JSON.stringify({address:'sales@example.invalid',password:'fixture',smtpHost:'smtp.hostinger.com',imapHost:'imap.hostinger.com'}),inbox:async()=>[msg,{...msg,address:'unknown@example.invalid'},{...msg,in_reply_to:'<other>'},{...msg,from_me:true},{...msg,mail_trashed:true},{...msg,auto_submitted:true}]});
 assert.equal(calls.filter(x=>x.operation==='reply').length,1);assert.equal(calls.find(x=>x.operation==='reply').classification,'positive');
});
test('disabled automation makes no provider calls or approvals',async()=>{
 const calls=[];await automateProspects(async p=>{calls.push(p);return {enabled:false};});assert.deepEqual(calls,[{operation:'automation_context'}]);
});
