import test from 'node:test';
import assert from 'node:assert/strict';
import {mailFolder,mailItems,filterMail} from '../web/mail-folders.mjs';
import {readInbox} from '../attendance.mjs';
import {imapMessageLocation,sentMailbox} from '../mail-imap.mjs';
test('email folders separate receipts, acknowledged sends, uncertain sends and internal notes',()=>{
 const t={id:'t',name:'Empresa São João',address:'cliente@example.invalid'};
 const messages=[{id:'in',direction:'inbound',status:'received',created_at:'2026-10-20T10:00:00Z',subject:'Retorno',content:'Resposta'},{id:'sent',direction:'outbound',status:'accepted',created_at:'2026-10-20T11:00:00Z',subject:'Negociação',content:'Contato cordial'},{id:'uncertain',direction:'outbound',status:'unknown',created_at:'2026-10-20T12:00:00Z'},{id:'note',direction:'note',status:'registered',created_at:'2026-10-20T13:00:00Z'}];
 const rows=mailItems([{thread:t,messages}]);
 assert.equal(rows[0].id,'note');assert.deepEqual(filterMail(rows,'inbox').map(m=>m.id),['in']);assert.deepEqual(filterMail(rows,'sent','são joão').map(m=>m.id),['sent']);assert.equal(filterMail(rows,'sent','retorno').length,0);
 assert.equal(mailFolder(messages[2]),'pending');assert.equal(mailFolder({direction:'outbound',status:'sending'}),'pending');assert.equal(mailFolder({direction:'outbound',status:'registered'}),'pending');assert.equal(mailFolder({direction:'outbound',status:'received'}),'sent');assert.equal(mailFolder(messages[3]),'notes');
});
test('IMAP sync reads Inbox and discovered Sent read-only, deduplicates by Message-ID and resolves attachments',async()=>{
 let current,releases=0,logout=false;const locks=[];
 const raw=(from,to,id)=>Buffer.from(`From: ${from}\r\nTo: ${to}\r\nSubject: Amigável\r\nMessage-ID: <${id}@example.invalid>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nContato sem valores.`);
 const client={mailbox:{exists:1,uidValidity:42},connect:async()=>{},list:async()=>[{path:'INBOX'},{path:'INBOX.Enviados',specialUse:'\\Sent'}],logout:async()=>{logout=true;},getMailboxLock:async(path,options)=>{current=path;locks.push([path,options.readOnly]);return {release(){releases++;}};},async *fetch(){const source=current==='INBOX'?raw('Cliente <client@example.invalid>','team@example.invalid','reply'):raw('team@example.invalid','Cliente <client@example.invalid>','sent');yield {uid:7,size:source.length,source};}};
 const rows=await readInbox({},()=>client);assert.equal(rows.length,2);assert.deepEqual(locks,[['INBOX',true],['INBOX.Enviados',true]]);assert.equal(releases,2);assert.ok(logout);
 assert.equal(rows[0].from_me,false);assert.equal(rows[1].from_me,true);assert.equal(rows[1].address,'client@example.invalid');assert.equal(rows[1].provider_id,'<sent@example.invalid>');assert.deepEqual(imapMessageLocation(rows[1]),{path:'INBOX.Enviados',validity:'42',uid:'7'});assert.deepEqual(imapMessageLocation(rows[0]),{path:'INBOX',validity:'42',uid:'7'});assert.throws(()=>imapMessageLocation({provider_id:'invalid'}));assert.equal(sentMailbox([{path:'Sent'}]),'Sent');
});
