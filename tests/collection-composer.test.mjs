import test from 'node:test';
import assert from 'node:assert/strict';
import {collectionComposer} from '../web/collection-scripts.mjs';

test('double click while checking the balance submits only one email',async()=>{
 const nodes=new Map(),events=new Map();
 const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{value:'',textContent:'',disabled:false,open:true,addEventListener:(name,fn)=>events.set(name,fn)});return nodes.get(selector);};
 const container={innerHTML:'',querySelector:node};
 let release,opened=0,prepared=0,sent=0;
 const gate=new Promise(resolve=>{release=resolve;});
 const api={attendance:async action=>{if(action==='accounts')return {accounts:[{id:'mail',channel:'email',sector:'collections',address:'sender@example.invalid'}]};if(action==='thread_open'){opened++;return {id:'thread'};}if(action==='message_prepare'){prepared++;return {id:'message'};}throw Error('Unexpected action');},server:async()=>{sent++;}};
 collectionComposer(container,{api,guard:fn=>fn(),notify:()=>{},context:()=>({debtor:{name:'Cliente fictício'}}),beforeSend:()=>gate});
 events.get('toggle')();await new Promise(resolve=>setImmediate(resolve));
 node('[data-collection-account]').value='mail';node('[data-collection-to]').value='recipient@example.invalid';node('[data-collection-subject]').value='Teste local';node('[data-collection-content]').value='Somente teste em memória.';
 const first=node('[data-collection-send]').onclick(),second=node('[data-collection-send]').onclick();
 assert.equal(node('[data-collection-send]').disabled,true);assert.equal(opened,0);
 release();await Promise.all([first,second]);
 assert.deepEqual([opened,prepared,sent],[1,1,1]);
 await assert.rejects(()=>node('[data-collection-send]').onclick(),/já foi solicitado/);
 assert.equal(sent,1);
});
