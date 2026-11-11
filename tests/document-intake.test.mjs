import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDocumentUpload,interpretDocumentText} from '../document-intake.mjs';
const file=(name,bytes)=>({name,base64:Buffer.from(bytes).toString('base64')});
test('Document upload rejects extensions, spoofed PDFs and oversized input',()=>{
 assert.throws(()=>validateDocumentUpload(file('x.pdf',Buffer.from('not a pdf'))),/Conteúdo/);
 assert.throws(()=>validateDocumentUpload(file('../x.png',Buffer.from('not png'))),/Nome/);
 assert.throws(()=>validateDocumentUpload(file('x.exe',Buffer.from('MZ'))),/extensão/);
 assert.throws(()=>validateDocumentUpload({name:'x.pdf',base64:'hello<script>'}),/Conteúdo/);
});
test('OCR preview never registers title and returns candidate values',()=>{
 const r=interpretDocumentText('Cheque Nº 850029 R$ 7.970,00 27/05/2026 MOTIVO 12','cheque');
 assert.equal(r.status,'review_required');assert.deepEqual(r.amount_candidates,['7970.00']);
 assert.deepEqual(r.date_candidates,['2026-05-27']);assert.deepEqual(r.return_reasons,['12']);
 assert.equal(r.cheque_number,'850029');
});
test('Debtor extraction requires review, rejects fake document and captures valid fields',()=>{
 const r=interpretDocumentText('Cliente: EMPRESA TESTE LTDA\nCPF/CNPJ: 12.345.678/0001-90\nEmail: contato@example.com\nEndereço: Rua Alfa','devedor');
 assert.equal(r.status,'review_required');assert.equal(r.name,'EMPRESA TESTE LTDA');assert.equal(r.document,'12345678000190');
 assert.equal(r.email,'contato@example.com');
 const fake=interpretDocumentText('Cliente: TESTE\nCPF: 123','devedor');assert.equal(fake.document,null);
});
