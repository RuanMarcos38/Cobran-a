import {test} from 'node:test';import assert from 'node:assert/strict';
import {handleChannel} from '../whatsapp.mjs';import {encrypt} from '../email.mjs';import {issueBooking} from '../booking.mjs';
const env={EMAIL_ENCRYPTION_KEY:'12'.repeat(32),EVOLUTION_ALLOWED_ORIGIN:'https://evolution.example.invalid'};
test('QR e configuração verificam perfil e não retornam chave',async()=>{
 const profile={role:'admin',tenant_id:'tenant1'},c={url:env.EVOLUTION_ALLOWED_ORIGIN,apikey:'secret-key',instance:'company1'};
 const rpc=async(kind,action)=>action==='profile'?profile:action==='channel_get'?{cipher:encrypt(JSON.stringify(c),'tenant1:whatsapp',env)}:{};
 const result=await handleChannel('whatsapp_qr',{},rpc,env,async url=>({ok:true,json:async()=>url.includes('connectionState')?{instance:{state:'close'}}:{base64:'data:image/png;base64,aGVsbG8='}}));assert.equal(result.state,'qr');assert.ok(!JSON.stringify(result).includes('secret-key'));
 profile.role='commercial';await assert.rejects(()=>handleChannel('whatsapp_qr',{},rpc,env),/exclusiva/);
 profile.role='admin';await assert.rejects(()=>handleChannel('whatsapp_configure',{url:'http://127.0.0.1',apikey:'secret-key'},rpc,env),/autorizado/);
});
test('link n8n é estável para o mesmo evento e não inclui dados do prospecto na URL',async()=>{
 const rpc=async(name,args)=>({id:'booking1',expires_at:'2099-01-01'}),body={event_id:'campaign1:person1',email:'person@example.invalid',company:'Empresa'};
 const one=await issueBooking(body,rpc,env,'a'.repeat(64)),two=await issueBooking(body,rpc,env,'a'.repeat(64));assert.equal(one.url,two.url);assert.ok(!one.url.includes('person'));assert.match(one.url,/\/agendar\?token=[a-f0-9]{64}$/);
 await assert.rejects(()=>issueBooking({...body,event_id:''},rpc,env,'a'.repeat(64)),/Identificador/);
});
