import test from 'node:test';import assert from 'node:assert/strict';
import {cents,decimal,installments,csv,parseCsv} from '../web/money.mjs';
test('valores monetários exatos e separador brasileiro',()=>{assert.equal(cents('123,45'),12345n);assert.equal(decimal(cents('0.01')), '0.01');assert.equal(cents('999999999999.99'),99999999999999n);});
test('rejeita precisão excessiva, negativos e valores não finitos',()=>{for(const x of ['1.001','-1','Infinity','NaN','abc','1e5'])assert.throws(()=>cents(x));});
test('parcelas preservam cada centavo',()=>{assert.deepEqual(installments('100.00',3),['33.34','33.33','33.33']);for(let n=1;n<=120;n++){const parts=installments('1000.01',n);assert.equal(parts.reduce((s,x)=>s+cents(x),0n),100001n);}});
test('não aceita parcelas abaixo de um centavo',()=>{assert.throws(()=>installments('0.01',2));assert.throws(()=>installments('100',0));});
test('CSV protege fórmulas e escapa aspas e separadores',()=>{const value=csv([{name:'=CMD()',notes:'a;"b"'}]);assert.ok(value.includes("'=CMD()"));assert.ok(value.includes('a;""b""'));});
test('CSV aceita campos com delimitadores e quebras de linha',()=>{assert.deepEqual(parseCsv('name;document;notes\r\n"Empresa; A";123;"Linha 1\nLinha 2"'),[{name:'Empresa; A',document:'123',notes:'Linha 1\nLinha 2'}]);assert.throws(()=>parseCsv('name,document\n"Incompleto,123'));});
