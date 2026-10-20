import test from 'node:test';import assert from 'node:assert/strict';
import {whatsappPhone,chatPreview} from '../web/whatsapp-workspace.mjs';
test('WhatsApp account labels preserve numbers and previews distinguish internal notes from sent messages',()=>{
 assert.equal(whatsappPhone('5547997504083'),'+55 (47) 99750-4083');assert.equal(whatsappPhone('554799230547'),'+55 (47) 9923-0547');
 assert.equal(chatPreview(null,'5547997504083'),'5547997504083');assert.equal(chatPreview({direction:'note',content:'Aguardar\n retorno'}),'Nota interna: Aguardar retorno');assert.equal(chatPreview({direction:'outbound',content:'Olá'}),'Você: Olá');assert.equal(chatPreview({direction:'inbound',content:'Bom dia'}),'Bom dia');
 assert.ok(chatPreview({direction:'inbound',content:'x'.repeat(1000)}).length<=120);
});
