
import test from 'node:test';
import assert from 'node:assert/strict';
import {whatsappPresentation} from '../web/whatsapp-connection.mjs';
import {feeBaseForBand} from '../web/pricing.mjs';
import {handleChannel} from '../whatsapp.mjs';
import {encrypt} from '../email.mjs';

test('WhatsApp conectado remove opção de novo QR e mostra status de conexão',()=>{
 const ready=whatsappPresentation({ready:true,state:'open',can_configure:true,configured:true});
 assert.equal(ready.connected,true);assert.equal(ready.showConnect,false);
 const disconnected=whatsappPresentation({ready:false,state:'close',can_configure:true,configured:true});
 assert.equal(disconnected.showConnect,true);
 const limited=whatsappPresentation({ready:false,state:'close',can_configure:false,configured:true});
 assert.equal(limited.showConnect,false);
 assert.equal(whatsappPresentation({ready:true,state:'connecting',can_configure:true}).connected,false);
});
test('Evolution consulta estado real por instância e não expõe segredos ao browser',async()=>{
 const env={EMAIL_ENCRYPTION_KEY:'12'.repeat(32),EVOLUTION_ALLOWED_ORIGIN:'https://evolution.example.invalid'};
 const profile={role:'admin',tenant_id:'tenantA'};
 const encrypted=encrypt(JSON.stringify({url:env.EVOLUTION_ALLOWED_ORIGIN,apikey:'secret-api-key',instance:'tenant-instance'}),'tenantA:whatsapp',env);
 const rpc=async(kind,action)=>action==='profile'?profile:action==='channel_get'?{cipher:encrypted}:{};
 let consulted='';
 const result=await handleChannel('whatsapp_status',{},rpc,env,async(url,options)=>{consulted=url;return {ok:true,json:async()=>({instance:{state:'open'}})};});
 assert.equal(result.ready,true);
 assert.equal(result.state,'open');
 assert.equal(result.configured,true);
 assert.equal(result.can_configure,true);
 assert.equal(consulted.includes('tenant-instance'),true);
 assert.equal(JSON.stringify(result).includes('secret-api-key'),false);
});
test('taxas escalonadas por idade mantém 0 para não vencido e faixas distintas',()=>{
 const rates=[10,15,20,25,30];
 for(const [band,expectation] of [[0,0],[1,10],[2,15],[3,20],[4,25],[5,30]])assert.equal(feeBaseForBand(rates,band),expectation);
 assert.equal(feeBaseForBand([12,17,22,27,32],4),27);
 assert.throws(()=>feeBaseForBand(rates,6),/Faixa/);
 assert.throws(()=>feeBaseForBand([10],5),/Taxa/);
});
