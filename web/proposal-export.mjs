import {brl} from './money.mjs';
const xml=s=>String(s??'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c])).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
const date=s=>String(s||'').split('-').reverse().join('/');
export function proposalRows(detail,quote,s){
 const items=quote.items||[{reference:detail.process.external_ref,quote:{...quote,due_date:detail.process.due_date}}];
 return [
  [s.formalized?'ACORDO FORMALIZADO':'PROPOSTA DE NEGOCIAÇÃO — SIMULAÇÃO'],['Devedor',detail.debtor.name],['Credor',detail.creditor.name],['Atualização',date(quote.as_of)],['Situação',s.formalized?'Acordo registrado no sistema; não comprova pagamento.':'Sujeita à conferência do saldo e aceite; não comprova pagamento.'],
  ['Principal',Number(quote.principal)],['Juros',Number(quote.interest)],['Multa',Number(quote.fine)],['Honorários',Number(quote.fees||0)],['Saldo atualizado',Number(quote.total)],['Desconto',Number(s.discount)],['Total negociado',Number(s.total)],['Entrada',Number(s.entry)],[],
  ['Título','Vencimento','Dias após carência','Principal','Juros','Multa','Honorários','Saldo','Juros (%)','Periodicidade','Multa (%)','Honorários (%)','Base honorários'],
  ...items.map(({reference,quote:q})=>[reference,date(q.due_date),q.days||0,Number(q.principal),Number(q.interest),Number(q.fine),Number(q.fees||0),Number(q.total),Number(q.terms?.interest_percent||0),({monthly:'Mensal / 30 dias',daily:'Diário',none:'Sem juros'}[q.terms?.mode]||'Sem juros'),Number(q.terms?.fine_percent||0),Number(q.terms?.fee_percent||0),q.terms?.fee_basis==='updated'?'Saldo com encargos':'Principal']),[],
  ['Pagamento','Vencimento','Valor'],...s.schedule.map(p=>[p.label,date(p.due_date),Number(p.amount)]),...(s.formalized?[[],['Referência do acordo',s.reference],['Registro de aceite',s.reason]]:[])
 ];
}
const encoder=new TextEncoder();
function zip(files){
 const chunks=[],central=[];let offset=0;
 const crc=bytes=>{let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;};
 const header=(size,values)=>{const b=new Uint8Array(size),v=new DataView(b.buffer);for(const [at,value,short] of values)short?v.setUint16(at,value,true):v.setUint32(at,value,true);return b;};
 for(const [path,content] of files){const name=encoder.encode(path),data=encoder.encode(content),checksum=crc(data);
  const local=header(30,[[0,0x04034b50],[4,20,1],[6,0x800,1],[14,checksum],[18,data.length],[22,data.length],[26,name.length,1]]);
  chunks.push(local,name,data);central.push(header(46,[[0,0x02014b50],[4,20,1],[6,20,1],[8,0x800,1],[16,checksum],[20,data.length],[24,data.length],[28,name.length,1],[42,offset]]),name);offset+=local.length+name.length+data.length;
 }
 const size=central.reduce((n,b)=>n+b.length,0);chunks.push(...central,header(22,[[0,0x06054b50],[8,files.length,1],[10,files.length,1],[12,size],[16,offset]]));
 const out=new Uint8Array(offset+size+22);let p=0;for(const b of chunks){out.set(b,p);p+=b.length;}return out;
}
export function proposalXlsx(rows){
 const column=n=>{let s='';for(++n;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
 const sheet='<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="13" width="24" customWidth="1"/></cols><sheetData>'+rows.map((row,i)=>`<row r="${i+1}">${row.map((v,j)=>Number.isFinite(v)?`<c r="${column(j)}${i+1}" t="n"><v>${v}</v></c>`:`<c r="${column(j)}${i+1}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`).join('')}</row>`).join('')+'</sheetData></worksheet>';
 return zip([
  ['[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
  ['_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
  ['xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Negociação" sheetId="1" r:id="rId1"/></sheets></workbook>'],
  ['xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],['xl/worksheets/sheet1.xml',sheet]
 ]);
}
export function proposalPdf(rows){
 const format=row=>{
  if(row.length===13){if(row[0]==='Título')return ['TÍTULOS INCLUÍDOS'];return [`Título: ${row[0]} | Vencimento: ${row[1]} | Dias após carência: ${row[2]}`,`Principal: ${brl(row[3])} | Juros: ${brl(row[4])} | Multa: ${brl(row[5])}`,`Honorários: ${brl(row[6])} | Saldo: ${brl(row[7])}`,`Juros: ${row[8]}% (${row[9]}) | Multa: ${row[10]}% | Honorários: ${row[11]}% sobre ${row[12]}`,''];}
  if(row[0]==='Pagamento')return ['CONDIÇÕES DE PAGAMENTO'];
  return [row.map((v,j)=>typeof v==='number'&&j>0?brl(v):v).join('  |  ')];
 };
 const lines=rows.flatMap(format).flatMap(text=>String(text).match(/.{1,94}(?:\s|$)|.{1,94}/g)||['']);
 const escape=s=>String(s).replace(/[—–]/g,'-').replace(/\u00a0/g,' ').replace(/[^\x20-\xff]/g,'?').replace(/[\\()]/g,'\\$&');
 const objects=['','<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
 const pages=[];
 for(let i=0;i<lines.length;i+=50){const page=objects.length,content=page+1;pages.push(page);objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${content} 0 R >>`);const stream='BT /F1 9 Tf 12 TL 30 810 Td '+lines.slice(i,i+50).map(l=>'('+escape(l)+') Tj T*').join('\n')+' ET';objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);}
 objects[2]=`<< /Type /Pages /Kids [${pages.map(p=>p+' 0 R').join(' ')}] /Count ${pages.length} >>`;
 let pdf='%PDF-1.4\n',offsets=[0];for(let i=1;i<objects.length;i++){offsets.push(pdf.length);pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}const start=pdf.length;pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;return Uint8Array.from(pdf,c=>c.charCodeAt(0));
}
export function downloadProposal(detail,quote,s,format){
 const rows=proposalRows(detail,quote,s),bytes=format==='pdf'?proposalPdf(rows):proposalXlsx(rows),url=URL.createObjectURL(new Blob([bytes],{type:format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
 const a=document.createElement('a');a.href=url;a.download='negociacao-'+quote.as_of+'.'+format;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
