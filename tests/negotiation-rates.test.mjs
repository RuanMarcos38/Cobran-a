import test from 'node:test';
import assert from 'node:assert/strict';
import {createRateRecalculation} from '../web/negotiation-rates.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('rapid edits cannot be overwritten by an older server response',async()=>{
 const first=deferred(),second=deferred(),applied=[],busy=[],errors=[];let calls=0;
 const c=createRateRecalculation({load:()=>++calls===1?first.promise:second.promise,apply:q=>applied.push(q),pending:b=>busy.push(b),failed:e=>errors.push(e)});
 const a=c.recalculate(),b=c.recalculate();second.resolve({total:'90.00'});await b;first.resolve({total:'100.00'});await a;
 assert.deepEqual(applied,[{total:'90.00'}]);assert.deepEqual(busy,[true,true,false]);assert.deepEqual(errors,[]);
});
test('an invalid edit cancels the pending calculation and suppresses in-flight results',async()=>{
 const request=deferred(),applied=[];let timer,cancelled=0;
 const c=createRateRecalculation({load:()=>request.promise,apply:q=>applied.push(q),pending:()=>{},failed:()=>{},schedule:f=>{timer=f;return 1;},cancel:()=>cancelled++});
 c.queue();const running=timer();c.invalidate();request.resolve({total:'50.00'});await running;assert.deepEqual(applied,[]);assert.ok(cancelled>0);
});
test('manual retry after a server failure can produce a valid result',async()=>{
 const applied=[],errors=[];let calls=0;
 const c=createRateRecalculation({load:async()=>{if(++calls===1)throw Error('Conexão indisponível');return {total:'80.00'};},apply:q=>applied.push(q),pending:()=>{},failed:e=>errors.push(e.message)});
 await c.recalculate();await c.recalculate();assert.deepEqual(errors,['Conexão indisponível']);assert.deepEqual(applied,[{total:'80.00'}]);
});
test('closing the dialog prevents late responses from changing its result',async()=>{
 const request=deferred(),applied=[];
 const c=createRateRecalculation({load:()=>request.promise,apply:q=>applied.push(q),pending:()=>{},failed:()=>{throw Error('Closed dialog');}});
 const done=c.recalculate();c.stop();request.resolve({total:'25.00'});await done;assert.deepEqual(applied,[]);
});
