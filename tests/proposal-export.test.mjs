import test from 'node:test';
import assert from 'node:assert/strict';
import {proposalRows,proposalPdf,proposalXlsx,canExportProposal,authorizeProposalExport,downloadProposal} from '../web/proposal-export.mjs';
import {collectionScript} from '../web/collection-scripts.mjs';
const quote={as_of:'2026-03-02',due_date:'2026-01-01',principal:1000,interest:10,fine:20,fees:103,total:1133,days:30,terms:{interest_percent:1,mode:'monthly',fine_percent:2,fee_percent:10,fee_basis:'updated'}};
const detail={debtor:{name:'Empresa São João'},creditor:{name:'Credor'},process:{external_ref:'=1+1',due_date:'2026-01-01'}};
const simulation={discount:'0',total:'1133',entry:'0',schedule:[{label:'À vista',due_date:'2026-03-02',amount:'1133'}]};
test('financial reports require a fresh administrator profile and deny other roles before download',async()=>{
 for(const role of ['collector','supervisor','finance','commercial','client',undefined]){
  assert.equal(canExportProposal({role}),false);
  await assert.rejects(authorizeProposalExport({rpc:async action=>{assert.equal(action,'profile');return {role};}}),/administradores/);
  assert.throws(()=>downloadProposal(detail,quote,simulation,'pdf',{role}),/administradores/);
 }
 for(const role of ['admin','master'])assert.deepEqual(await authorizeProposalExport({rpc:async()=>({role})}),{role});
});
test('proposal exports preserve charges, dates and typed values without spreadsheet formulas',()=>{
 const rows=proposalRows(detail,quote,simulation),xlsx=proposalXlsx(rows),pdf=proposalPdf(rows);
 assert.equal(rows.find(r=>r[0]==='Honorários')[1],103);
 const xml=new TextDecoder().decode(xlsx);assert.match(xml,/t="inlineStr"><is><t xml:space="preserve">=1\+1/);assert.doesNotMatch(xml,/<f>/);assert.match(xml,/<v>1133<\/v>/);assert.equal(new DataView(xlsx.buffer).getUint32(0,true),0x04034b50);
 const text=new TextDecoder('latin1').decode(pdf);assert.match(text,/%PDF-1.4/);assert.match(text,/xref/);assert.match(text,/Honor/);assert.match(text,/SIMULA/);assert.match(text,/car.ncia: 30/);assert.doesNotMatch(text,/R\$ 30,00/);
});
test('branded reports retain individual charges, contract bases, discount and agreement status',()=>{
 const joint={...quote,items:[{reference:'REF-UM',quote},{reference:'REF-DOIS',quote}]};
 const rows=proposalRows(detail,joint,{...simulation,formalized:true,reference:'ACORDO-TESTE',reason:'Aceite local de teste',discount:'33',total:'1100'});
 const pdf=new TextDecoder('latin1').decode(proposalPdf(rows)),xlsx=new TextDecoder().decode(proposalXlsx(rows));
 for(const value of ['ESTRAT','PERFORMANCE','REF-UM','REF-DOIS','ACORDO-TESTE','1.100,00'])assert.ok(pdf.includes(value),value);
 assert.match(xlsx,/styles.xml/);assert.match(xlsx,/pane ySplit=/);assert.match(xlsx,/autoFilter ref=/);assert.match(xlsx,/numFmtId="164"/);assert.match(xlsx,/<v>103<\/v>/);assert.match(xlsx,/<v>33<\/v>/);assert.match(xlsx,/Saldo com encargos/);
 assert.equal(rows.find(r=>r[0]==='Juros')[1],10);assert.equal(rows.find(r=>r[0]==='Multa')[1],20);
});
test('collection variants identify debtor, keep proposal conditions and require verified financial context',()=>{
 for(const kind of ['cordial','statement','proposal','followup']){const message=collectionScript(kind,{...detail,quote,simulation});assert.match(message.content,/Empresa São João/);assert.match(message.subject,/Empresa São João/);}
 const message=collectionScript('proposal',{...detail,quote,simulation});assert.match(message.content,/Honorários: R\$/);assert.match(message.content,/seu aceite/);
 assert.throws(()=>collectionScript('proposal',detail));assert.throws(()=>collectionScript('statement',{debtor:{}}));assert.throws(()=>collectionScript('invalid',{...detail,quote,simulation}));
});
