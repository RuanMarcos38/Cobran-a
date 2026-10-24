import test from 'node:test';
import assert from 'node:assert/strict';
import {focusCommercialMail,takeCommercialMailFocus} from '../web/commercial-mail-focus.mjs';
import {prospectMarkup} from '../web/prospection.mjs';
test('commercial history targets sent mail once without persisting contact data',()=>{
 assert.equal(takeCommercialMailFocus(),undefined);
 focusCommercialMail({account_id:'box',email:'lead@example.invalid',provider_id:'<accepted@example.invalid>'});
 assert.deepEqual(takeCommercialMailFocus(),{folder:'sent',account_id:'box',email:'lead@example.invalid',provider_id:'<accepted@example.invalid>'});
 assert.equal(takeCommercialMailFocus(),undefined);
});
test('only actual SMTP acceptance offers a direct sent-message link',()=>{
 const html=prospectMarkup({summary:{accepted:1},policy:{used:2,daily_limit:90},rows:[{id:'confirmed',company:'Confirmed',status:'accepted',attempt_status:'accepted'},{id:'imported',company:'Imported',status:'reported'}]},{view:'history',status:''});
 assert.match(html,/data-prospect-mail="confirmed"/);assert.ok(!html.includes('data-prospect-mail="imported"'));assert.match(html,/2\/90/);assert.match(html,/25 por página/);
});
