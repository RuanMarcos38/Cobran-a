import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBorderoCsv} from '../bordero-csv.mjs';

const header=['CNPJ Empresa Credora','Razão Social Empresa Credora','CNPJCPF Cliente','Nome  Cliente','Endereço   Cobrança','Bairro','Cidade','UF','CEP','DDD','Telefone','Especie do Título','Identificação (Código) do Título','Parcela','Data emissão','Data  Vencto','Valor  Aberto','Valor do protesto','Observações ','Cód. Identificador Devedor','Nome do Representante que efetuou a venda','DDD e Fone para contato com o ReprMiesentante','E-mail devedor','E-mail devedor'];
function row(due='27/01/2026',ref='T-001',amount='R$ 9.495,45'){
 return ['EMPRESA TESTE LTDA','29.037.742.0001/73','04.583.507/0001-76','CLIENTE TESTE LTDA','RUA EXEMPLO 100','CENTRO','JOINVILLE','SC','89200-000','47','99999-8888','NF',ref,'','',due,amount,'','RENEGOCIAÇÃO','1234','','','teste@example.com','financeiro@example.com'];
}
function file(lines,charset='utf8'){return Buffer.from(lines.map(r=>r.join(';')).join('\r\n'),charset);}

test('CSV com cabeçalho brasileiro, Windows-1252, separador ponto e vírgula, CNPJ invertido e emails duplicados',()=>{
 const parsed=parseBorderoCsv(file([header,row()],'latin1'),'ELISATEX.csv');
 assert.equal(parsed.count,1);
 assert.equal(parsed.total,'9495.45');
 assert.equal(parsed.rows[0].creditor_document,'29.037.742.0001/73');
 assert.equal(parsed.rows[0].creditor_name,'EMPRESA TESTE LTDA');
 assert.equal(parsed.rows[0].debtor_document,'04583507000176');
 assert.equal(parsed.rows[0].due_date,'2026-01-27');
 assert.equal(parsed.rows[0].debtor_phone,'5547999998888');
 assert.equal(parsed.rows[0].debtor_email,'teste@example.com');
 assert.equal(parsed.rows[0].raw['E-mail devedor (24)'],'financeiro@example.com');
 assert.equal(parsed.needs_confirmation,false);
 assert.deepEqual(parsed.errors,[]);
 assert.match(parsed.warnings.join(' '),/invertidos/);
 assert.match(parsed.warnings.join(' '),/Windows-1252/);
});
test('identificação repetida com vencimentos diferentes exige confirmação e não gera IDs colidentes',()=>{
 const parsed=parseBorderoCsv(file([header,row('27/01/2026'),row('27/02/2026'),row('27/03/2026')]),'modelo.csv');
 assert.equal(parsed.count,3);
 assert.equal(parsed.total,'28486.35');
 assert.equal(parsed.needs_confirmation,true);
 assert.equal(new Set(parsed.rows.map(x=>x.external_ref)).size,3);
 assert.ok(parsed.rows.every(x=>x.repeated_title));
});
test('títulos repetidos no mesmo vencimento, valor inválido e datas inválidas são bloqueados',()=>{
 const parsed=parseBorderoCsv(file([header,row(),row(),row('31/02/2026','T-002'),row('27/01/2026','T-003','9.495,456')]),'modelo.csv');
 assert.equal(parsed.count,2);
 assert.equal(parsed.errors.length,3);
 assert.match(parsed.errors.map(x=>x.error).join(' '),/repetido/);
});
test('rejeita arquivos não CSV, cabeçalho não reconhecido, aspas quebradas e datas impossíveis',()=>{
 assert.throws(()=>parseBorderoCsv(Buffer.from('abc'),'a.pdf'),/CSV inválido/);
 assert.throws(()=>parseBorderoCsv(Buffer.from('name;document\nx;y'),'a.csv'),/Cabeçalho/);
 assert.throws(()=>parseBorderoCsv(Buffer.from('"valor não fechado'),'a.csv'),/Aspas/);
});
