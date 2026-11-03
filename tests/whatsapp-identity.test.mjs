import test from 'node:test';
import assert from 'node:assert/strict';
import {evolutionMessages,evolutionContacts,contactThreads} from '../attendance.mjs';
import {watchWhatsappConnection} from '../web/whatsapp-pairing.mjs';
test('WhatsApp outgoing pushName never becomes recipient name; incoming sender and saved contacts resolve identities',()=>{
 const messages=evolutionMessages({records:[{key:{id:'out',remoteJid:'5547999990000@s.whatsapp.net',fromMe:true},pushName:'Você',message:{conversation:'Olá'}},{key:{id:'in',remoteJid:'5547999990000@s.whatsapp.net',fromMe:false},pushName:'Maria',message:{conversation:'Oi'}}]});
 assert.equal(messages[0].name,'5547999990000');assert.equal(messages[1].name,'Maria');
 const names=evolutionContacts([{remoteJid:'5547999990000@s.whatsapp.net',pushName:'Maria Silva'},{remoteJid:'111@g.us',pushName:'Grupo'},{remoteJid:'5547999991111@s.whatsapp.net',pushName:'Você'}]);
 const original=[{id:'one',address:'5547999990000',name:'Você',owner_id:'owner'},{id:'two',address:'5547999991111',name:'Você'}];
 const resolved=contactThreads(original,names);assert.equal(resolved[0].name,'Maria Silva');assert.equal(resolved[0].owner_id,'owner');assert.equal(resolved[1].name,'5547999991111');assert.equal(original[0].name,'Você');assert.equal(names.size,1);
});
test('QR watcher waits for confirmed open state then closes once and stops; cancellation ignores late response',async()=>{
 let pending,closed=0,cancelled=0,calls=0;const schedule=fn=>(pending=fn,1);const cancel=()=>cancelled++;
 const stop=watchWhatsappConnection({active:()=>true,status:async()=>++calls===1?{ready:false,state:'connecting'}:{ready:true,state:'open'},connected:async()=>closed++,waiting:()=>{},schedule,cancel});
 await pending();assert.equal(closed,0);await pending();assert.equal(closed,1);assert.ok(cancelled);stop();
 let resolve;watchWhatsappConnection({active:()=>true,status:()=>new Promise(r=>resolve=r),connected:async()=>closed++,waiting:()=>{},schedule,cancel});const poll=pending();
 // A separate watcher is cancelled while its request is pending.
 let queued,late;const halt=watchWhatsappConnection({active:()=>true,status:()=>new Promise(r=>late=r),connected:async()=>closed++,waiting:()=>{},schedule:fn=>(queued=fn,1),cancel});const flight=queued();halt();late({ready:true,state:'open'});await flight;assert.equal(closed,1);resolve({ready:false});await poll;
});
import {handleAttendance} from '../attendance.mjs';
import {encrypt} from '../email.mjs';
test('contact resolution returns only threads authorized by the database and keeps account isolation',async()=>{
 const env={EMAIL_ENCRYPTION_KEY:'ab'.repeat(32)};const account={id:'account',channel:'whatsapp',cipher:encrypt(JSON.stringify({url:'https://provider.example.invalid',apikey:'test',instance:'only-this-account'}),'tenant:attendance:account',env)};
 const rpc=async(kind,action,body)=>{if(action==='profile')return{tenant_id:'tenant',role:'collector'};if(action==='account_secret'){assert.equal(body.account_id,'account');return account;}if(action==='threads')return[{id:'allowed',address:'5547999990000',name:'Você',owner_id:'collector'}];throw Error(action);};
 const original=globalThis.fetch;try{globalThis.fetch=async(url,options)=>{assert.match(url,/only-this-account$/);assert.equal(options.method,'POST');return{ok:true,json:async()=>url.includes('findContacts')?[{remoteJid:'5547999990000@s.whatsapp.net',pushName:'Maria'},{remoteJid:'5547999992222@s.whatsapp.net',pushName:'Not authorized thread'}]:{records:[]}};};
 const rows=await handleAttendance('attend_threads',{account_id:'account'},rpc,env);assert.equal(rows.length,1);assert.equal(rows[0].id,'allowed');assert.equal(rows[0].name,'Maria');
 }finally{globalThis.fetch=original;}
});
