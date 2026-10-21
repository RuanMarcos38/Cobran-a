import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMailConfig,safeEmailHtml,evolutionMessages,readInbox,handleAttendance} from '../attendance.mjs';
import {encrypt} from '../email.mjs';
test('email limits hosts and removes active content and tracking from received HTML',()=>{
 const c={address:'team@example.invalid',password:'example-test-password',imapHost:'imap.hostinger.com',smtpHost:'smtp.hostinger.com'};
 assert.equal(validateMailConfig(c,{}).imapPort,993);
 assert.throws(()=>validateMailConfig({...c,imapHost:'127.0.0.1'},{}));
 assert.throws(()=>validateMailConfig({...c,address:'victim@example.invalid\r\nBcc: other@example.invalid'},{}));
 const html=safeEmailHtml('<p onclick="alert(1)">Olá <strong>equipe</strong></p><script>alert(1)</script><img src="https://track.example.invalid/pixel"><iframe src="https://example.invalid"></iframe><a href="javascript:alert(1)">link</a>');
 assert.match(html,/<strong>equipe<\/strong>/);assert.doesNotMatch(html,/onclick|script|iframe|img|track\.example/);
});
test('provider records keep direction and isolate direct WhatsApp conversations',()=>{
 const rows=evolutionMessages({messages:{records:[{key:{id:'one',remoteJid:'5547999990000@s.whatsapp.net',fromMe:false},message:{conversation:'Resposta'}},{key:{id:'group',remoteJid:'111@g.us'},message:{conversation:'Grupo'}}]}});
 assert.equal(rows.length,1);assert.equal(rows[0].address,'5547999990000');assert.equal(rows[0].content,'Resposta');assert.equal(rows[0].from_me,false);
});
test('WhatsApp uses the phone alternate for LID conversations without treating a LID as a phone',()=>{
 const rows=evolutionMessages({messages:{records:[{key:{id:'lid-one',remoteJid:'123456789012345@lid',remoteJidAlt:'5547999990000@s.whatsapp.net',fromMe:false},message:{conversation:'Resposta LID'}},{key:{id:'unresolved',remoteJid:'998877665544332@lid'},message:{conversation:'Identidade sem telefone'}}]}});
 assert.equal(rows.length,1);assert.equal(rows[0].address,'5547999990000');assert.equal(rows[0].provider_ref,'123456789012345@lid');
});
test('IMAP reads without marking or deleting mail and retains original content and attachment metadata',async()=>{
 let released=false,loggedOut=false,readOnly=false;
 const raw=Buffer.from('From: Cliente <client@example.invalid>\r\nTo: team@example.invalid\r\nSubject: Resposta\r\nMessage-ID: <reply@example.invalid>\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Resposta <b>original</b></p><img src="https://tracking.example.invalid/1">');
 const client={mailbox:{exists:1,uidValidity:42},connect:async()=>{},logout:async()=>{loggedOut=true;},getMailboxLock:async(path,options)=>{assert.equal(path,'INBOX');readOnly=options.readOnly;return{release(){released=true;}};},async *fetch(range){assert.equal(range,'1:1');yield{uid:7,size:raw.length,source:raw};}};
 const rows=await readInbox({},()=>client);assert.equal(rows.length,1);assert.equal(rows[0].provider_id,'imap:42:7');assert.equal(rows[0].provider_ref,'<reply@example.invalid>');assert.match(rows[0].html,/<b>original<\/b>/);assert.doesNotMatch(rows[0].html,/tracking/);assert.ok(released&&loggedOut&&readOnly);
});
test('WhatsApp sends once and records uncertain outcomes without automatic retry',async()=>{
 const env={EMAIL_ENCRYPTION_KEY:'ab'.repeat(32)};const profile={tenant_id:'tenant',role:'collector'};
 const account={id:'account',channel:'whatsapp',cipher:encrypt(JSON.stringify({url:'https://provider.example.invalid',apikey:'test-only',instance:'dedicated-test'}),'tenant:attendance:account',env)};
 let calls=0,finished;const rpc=async(kind,action)=>{if(action==='profile')return profile;if(action==='account_secret')return account;if(action==='thread_messages')return{thread:{account_id:'account',address:'5547999990000'}};if(action==='message_claim')return{account,thread:{address:'5547999990000'},message:{content:'Teste',attachments:[]}};if(action==='message_finish'){finished=true;return{};}throw Error(action);};
 const original=globalThis.fetch;try{globalThis.fetch=async(url)=>{if(url.includes('/connectionState/'))return{ok:true,json:async()=>({instance:{state:'open'}})};calls++;throw Error('timeout');};await assert.rejects(()=>handleAttendance('attend_send',{thread_id:'thread',message_id:'message'},rpc,env),/Envio sem confirmação/);assert.equal(calls,1);assert.equal(finished,true);}finally{globalThis.fetch=original;}
});

test('invalid recipients and disconnected instances do not claim or send a message',async()=>{
 const env={EMAIL_ENCRYPTION_KEY:'ab'.repeat(32)},profile={tenant_id:'tenant',role:'collector'};
 const account={id:'account',channel:'whatsapp',cipher:encrypt(JSON.stringify({url:'https://provider.example.invalid',apikey:'test-only',instance:'dedicated-test'}),'tenant:attendance:account',env)};
 let phone='55479993714',claimed=0,sent=0;
 const rpc=async(kind,action)=>{if(action==='profile')return profile;if(action==='account_secret')return account;if(action==='thread_messages')return{thread:{account_id:'account',address:phone}};if(action==='message_claim')claimed++;throw Error('Unexpected mutation');};
 const original=globalThis.fetch;try{globalThis.fetch=async()=>{sent++;return{ok:true,json:async()=>({instance:{state:'close'}})};};
  await assert.rejects(()=>handleAttendance('attend_send',{account_id:'account',thread_id:'thread'},rpc,env),/Telefone incompleto/);assert.equal(sent,0);assert.equal(claimed,0);
  phone='5547999371478';await assert.rejects(()=>handleAttendance('attend_send',{account_id:'account',thread_id:'thread'},rpc,env),/desconectado/);assert.equal(sent,1);assert.equal(claimed,0);
 }finally{globalThis.fetch=original;}
});
