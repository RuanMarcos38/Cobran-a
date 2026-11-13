import {test} from 'node:test';import assert from 'node:assert/strict';
import {connectionFor,connectionStatus,sendEvolution,handleWhatsapp} from '../evolution.mjs';
const c={url:'https://evolution.example.invalid',instance:'company A',apikey:'private-test'};
test('Evolution credentials stay server-side and are bound to one company',async()=>{
 const env={WHATSAPP_CONNECTIONS_JSON:JSON.stringify({tenantA:c})};assert.equal(connectionFor(env,'tenantB'),null);assert.equal(connectionFor(env,'tenantA').instance,c.instance);assert.deepEqual(await connectionStatus(null),{ready:false,state:'not_configured'});
 assert.throws(()=>connectionFor({WHATSAPP_CONNECTIONS_JSON:'bad'},'tenantA'));assert.throws(()=>connectionFor({WHATSAPP_CONNECTIONS_JSON:JSON.stringify({tenantA:{...c,url:'https://user:password@host/'}})},'tenantA'));
 const result=await handleWhatsapp('whatsapp_status',{},async()=>({role:'commercial',tenant_id:'tenantB'}),env);assert.equal(result.ready,false);assert.equal(JSON.stringify(result).includes('private-test'),false);
 await assert.rejects(()=>handleWhatsapp('whatsapp_send',{},async()=>({role:'commercial',tenant_id:'tenantB'}),env),/pendente/);await assert.rejects(()=>handleWhatsapp('whatsapp_status',{},async()=>({role:'collector',tenant_id:'tenantA'}),env),/autorizado/);
});
test('Evolution sends verified text, emoji, document and audio and requires provider acknowledgement',async()=>{
 const calls=[];const fetcher=async(url,options)=>{calls.push({url,options,body:options.body&&JSON.parse(options.body)});return {ok:true,json:async()=>({key:{id:'confirmed-id'}})};};
 assert.equal((await sendEvolution(c,{phone:'+55 (11) 99999-0000',content:'Olá 😀'},fetcher)).provider_id,'confirmed-id');assert.equal(calls[0].body.text,'Olá 😀');assert.ok(calls[0].url.endsWith('/message/sendText/company%20A'));
 for(const mime of ['application/pdf','audio/webm','image/png'])await sendEvolution(c,{phone:'5511999990000',content:'Arquivo',attachment:{name:'arquivo',mime,base64:'dGVzdA=='}},fetcher);
 assert.deepEqual(calls.slice(1).map(c=>c.body.mediatype),['document','audio','image']);assert.ok(calls.slice(1).every(c=>c.url.includes('/message/sendMedia/')));
 assert.equal(calls[0].options.headers.apikey,'private-test');assert.equal(calls[0].options.redirect,'error');
 await assert.rejects(()=>sendEvolution(c,{phone:'11999990000',content:'Teste'},fetcher),/código do país/);
 await assert.rejects(()=>sendEvolution(c,{phone:'5511999990000',content:'Teste'},async()=>({ok:true,json:async()=>({})})),/não confirmou/);
 await assert.rejects(()=>sendEvolution(c,{phone:'5511999990000',content:'Teste'},async()=>({ok:false,json:async()=>({secret:'do not disclose'})})),/rejeitou/);
});
