import test from 'node:test';
import assert from 'node:assert/strict';
import {watchNegotiationQuote} from '../web/negotiation-refresh.mjs';
test('automatic quote refresh applies authoritative new days and balances and preserves proposal inputs',async()=>{
 let next,shown={as_of:'2026-10-20',days:145,total:'100'},proposal={installments:'3',entry:'25'},accepted=true;
 const stop=watchNegotiationQuote({active:()=>true,visible:()=>true,load:async()=>({as_of:'2026-10-21',days:146,total:'101'}),apply:q=>{shown=q;accepted=false;},failed:()=>assert.fail(),schedule:fn=>(next=fn,1),cancel:()=>{}});
 await next();assert.equal(shown.days,146);assert.equal(shown.as_of,'2026-10-21');assert.equal(shown.total,'101');assert.deepEqual(proposal,{installments:'3',entry:'25'});assert.equal(accepted,false);stop();
});
test('hidden dialogs skip requests, failures retry, and focus rechecks without parallel requests',async()=>{
 let next,visible=false,calls=0,errors=0,applied=0,resolve;
 const events=new EventTarget();const stop=watchNegotiationQuote({active:()=>true,visible:()=>visible,load:async()=>{calls++;if(calls===1)throw Error('Offline');return new Promise(r=>resolve=r);},apply:()=>applied++,failed:()=>errors++,events:[[events,'focus']],schedule:fn=>(next=fn,1),cancel:()=>{}});
 await next();assert.equal(calls,0);visible=true;await next();assert.equal(errors,1);
 const running=next();events.dispatchEvent(new Event('focus'));assert.equal(calls,2);resolve({days:2});await running;assert.equal(applied,1);stop();
});
test('closing the dialog removes listeners and discards a late server response',async()=>{
 let next,resolve,applied=0;const events=new EventTarget();const stop=watchNegotiationQuote({active:()=>true,visible:()=>true,load:()=>new Promise(r=>resolve=r),apply:()=>applied++,failed:()=>assert.fail(),events:[[events,'focus']],schedule:fn=>(next=fn,1),cancel:()=>{}});
 const running=next();stop();resolve({days:999});await running;events.dispatchEvent(new Event('focus'));assert.equal(applied,0);
});
