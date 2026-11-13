import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleBank} from '../bank.mjs';
import {decrypt} from '../email.mjs';

const tenant='a1111111-2222-4333-8444-555555555555',bank_id='b1111111-2222-4333-8444-555555555555';
const env={EMAIL_ENCRYPTION_KEY:'54'.repeat(32)};
test('bank configuration encrypts credentials for this tenant and never returns API keys',async()=>{
 let cipher,called=[];
 const rpc=async(action,payload)=>{
  called.push(action);
  if(action==='profile')return {tenant_id:tenant,role:'admin'};
  if(action==='bank_secret_get')return {provider:'inter',environment:'homologation',id:bank_id,cipher:cipher||null};
  if(action==='bank_secret_save'){cipher=payload.cipher;return {configured:true};}
  throw Error('Unexpected action');
 };
 const result=await handleBank('bank_configure',{bank_id,client_id:'client-test-abc',client_secret:'secret-test-strong-value',api_key:'key-test'},rpc,env);
 assert.deepEqual(result,{configured:true,status:'configured',ready_for_issuance:false,requires_homologation:true});
 assert.equal(JSON.stringify(result).includes('secret-test'),false);
 assert.equal(cipher.includes('secret-test'),false);
 const secret=JSON.parse(decrypt(cipher,tenant+':bank:'+bank_id,env));
 assert.equal(secret.client_secret,'secret-test-strong-value');
 assert.equal((await handleBank('bank_connection_test',{bank_id},rpc,env)).connected,false);
 assert.deepEqual(called,['profile','bank_secret_get','bank_secret_save','profile','bank_secret_get']);
});
test('no secret read for nonadmins, invalid ids, unsupported providers',async()=>{
 const rpc=async(action)=>action==='profile'?{role:'finance',tenant_id:tenant}:{provider:'manual'};
 await assert.rejects(()=>handleBank('bank_configure',{bank_id},rpc,env),/administrador/);
 const admin=async action=>action==='profile'?{role:'admin',tenant_id:tenant}:{provider:'manual'};
 await assert.rejects(()=>handleBank('bank_configure',{bank_id:'invalid'},admin,env),/Identificador/);
 await assert.rejects(()=>handleBank('bank_configure',{bank_id,client_id:'client',client_secret:'very-long-secret'},admin,env),/não aceita/);
 await assert.rejects(()=>handleBank('bank_configure',{bank_id,client_id:'client',client_secret:'tiny'},admin,env),/válidos/);
});