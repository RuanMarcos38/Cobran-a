import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from '@e965/xlsx';
import {parseFile,parseReport,date,money} from '../bordero-parser.mjs';
import {extractBordero} from '../bordero-http.mjs';
function workbook(rows,type='xls'){
 const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet(rows),'Credor');
 return XLSX.write(w,{type:'buffer',bookType:type==='xls'?'biff8':'xlsx'});
}
const header=['Nome  Cliente','CNPJCPF Cliente','Identificação (Código) do Título','Data  Vencto','Valor  Aberto','Parcela','DDD','Telefone','Observações '];
const row=['Devedor teste','01234567890123','T-01','27/01/2026','9.495,45','01','47','999999999','Observação original'];
test('XLS and XLSX map reordered/normalized headers, document zeros, installments, exact money and phone',async()=>{
 for(const type of ['xls','xlsx']){const r=await parseFile(workbook([header,row],type),'bordero.'+type);assert.equal(r.count,1);assert.deepEqual(r.errors,[]);assert.equal(r.total,'9495.45');assert.equal(r.rows[0].external_ref,'T-01 / parcela 01');assert.equal(r.rows[0].debtor_document,'01234567890123');assert.equal(r.rows[0].debtor_phone,'5547999999999');assert.equal(r.rows[0].due_date,'2026-01-27');assert.equal(r.rows[0].notes,'Observação original');}
});
test('empty template, invalid records, unrecognized sheets and fake files cannot silently import',async()=>{
 assert.equal((await parseFile(workbook([header]),'blank.xls')).count,0);
 const invalid=await parseFile(workbook([header,[...row.slice(0,3),'31/02/2026',...row.slice(4)]]),'invalid.xls');assert.equal(invalid.errors.length,1);assert.equal(invalid.rows.length,0);
 await assert.rejects(()=>parseFile(Buffer.from('fake'),'fake.pdf'),/válido/);
 assert.throws(()=>extractBordero({name:'../file.xls',base64:'dGVzdA=='}),/Arquivo inválido/);
});
test('PDF report excludes subtotals and reconciles count and final amount',()=>{
 const text='CREDOR TESTE\nT-1 1247 DEVEDOR TESTE 27/01/2026 9.495,45\nTotal.: 1.247,00 9.495,45\nT-2 1247 DEVEDOR TESTE 02/02/2026 36.469,29\n2.494,00 45.964,74\nQtd. Registros: 2';
 const r=parseReport(text);assert.equal(r.rows.length,2);assert.deepEqual(r.errors,[]);assert.equal(r.rows[0].debtor_document,null);assert.equal(r.rows[0].debtor_code,'1247');
 assert.ok(parseReport(text.replace('45.964,74','45.964,75')).errors.length);
 assert.ok(parseReport(text.replace('Registros: 2','Registros: 3')).errors.length);
 assert.throws(()=>parseReport('scanned image'),/OCR/);
});
test('money/date never round an invalid amount or roll over an invalid date',()=>{
 assert.equal(money('180.507,76'),'180507.76');assert.equal(date(46049),'2026-01-27');
 for(const n of ['9.49,5','-1','1,001',1.001,'NaN'])assert.throws(()=>money(n));
 for(const s of ['31/02/2026','2026-13-01','1900-02-29'])assert.throws(()=>date(s));
});
