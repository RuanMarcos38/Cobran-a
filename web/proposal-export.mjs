import {statementNote} from './negotiation-statement.mjs';
import {frequencyDescription} from './financial-calendar.mjs';
import {brl} from './money.mjs';
const xml=s=>String(s??'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c])).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
const date=s=>String(s||'').split('-').reverse().join('/');
export function proposalRows(detail,quote,s){
 const items=quote.items||[{reference:detail.process.external_ref,quote:{...quote,due_date:detail.process.due_date}}];
 return [
  [s.formalized?'ACORDO FORMALIZADO':'PROPOSTA DE NEGOCIAÇÃO — SIMULAÇÃO'],['Devedor',detail.debtor.name],['Credor',detail.creditor.name],['Atualização',date(quote.as_of)],['Periodicidade das parcelas',frequencyDescription(s)],['Situação',s.formalized?'Acordo registrado no sistema; não comprova pagamento.':'Sujeita à conferência do saldo e aceite; não comprova pagamento.'],
  ['Principal',Number(quote.principal)],['Juros',Number(quote.interest)],['Multa',Number(quote.fine)],['Honorários',Number(quote.fees||0)],['Saldo atualizado',Number(quote.total)],['Desconto',Number(s.discount)],['Total negociado',Number(s.total)],['Entrada',Number(s.entry)],[],
  ['Título','Vencimento','Dias após carência','Principal','Juros','Multa','Honorários','Saldo','Juros (%)','Periodicidade','Multa (%)','Honorários (%)','Base honorários'],
  ...items.map(({reference,quote:q})=>[reference,date(q.due_date),q.days||0,Number(q.principal),Number(q.interest),Number(q.fine),Number(q.fees||0),Number(q.total),Number(q.terms?.interest_percent||0),({monthly:'Mensal / 30 dias',daily:'Diário',none:'Sem juros'}[q.terms?.mode]||'Sem juros'),Number(q.terms?.fine_percent||0),Number(q.terms?.fee_percent||0),q.terms?.fee_basis==='updated'?'Saldo com encargos':'Principal']),[],
  ...(s.statement?[["DEMONSTRATIVO FINANCEIRO"],['Composição',s.statement.contractUnavailable?'Saldo registrado antes do desconto geral':'Dívida atualizada','Proposta negociada','Desconto','% sobre componente original'],...s.statement.rows.map(r=>[r.label,Number(r.before),Number(r.after),Number(r.discount),r.percent+'%']),['Total',Number(s.statement.before),Number(s.statement.total),Number(s.statement.discount),s.statement.percent+'%'],['Critério do demonstrativo',s.statement.note||statementNote],['Desconto total (%)',s.statement.percent+'% de '+brl(s.statement.before)],...s.statement.titles.flatMap(t=>[["Título negociado",t.reference],...t.rows.map(r=>[t.reference+' · '+r.label,Number(r.before),Number(r.after),Number(r.discount),r.percent+'%'])])]:[]),
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
// Report presentation only: amounts and contract terms come from the approved quote.
const brand={navy:'0C1C32',blue:'1669BA',ink:'142B46',pale:'F1F4F8',line:'D9E2ED'};
function reportData(rows){
 const head=rows.findIndex(r=>r[0]==='Título'),pay=rows.findIndex(r=>r[0]==='Pagamento');
 return {memory:rows[0][0]==='MEMÓRIA DO CÁLCULO FINANCEIRO',get:key=>rows.find(r=>r[0]===key)?.[1]??'',title:rows[0][0],items:rows.slice(head+1,pay).filter(r=>r.length===13),payments:rows.slice(pay+1).filter(r=>r.length===3),statement:rows.slice(head+1,pay).filter(r=>r.length===5),statementTitles:rows.slice(head+1,pay).filter(r=>r[0]==='Título negociado').map(r=>r[1])};
}
export function proposalXlsx(rows){
 const d=reportData(rows),out=[],merges=[];
 const add=(values,style=0,height=22)=>{out.push({values,style,height});return out.length;};
 const wide=(text,style=0,height=24)=>{const n=add([text],style,height);merges.push(`A${n}:M${n}`);};
 wide('RR  |  ESTRATÉGIA & PERFORMANCE',1,38);
 wide(d.title,2,30);wide('Assessoria de cobrança empresarial • rrestrategiaperformance.com.br',3);
 for(const key of ['Devedor','Credor','Atualização','Situação'])wide(`${key}: ${d.get(key)}`,0,key==='Situação'?32:24);
 wide('01  COMPOSIÇÃO DO DÉBITO — VALORES EM REAIS',2,28);
 for(const key of ['Principal','Juros','Multa','Honorários','Saldo atualizado','Desconto','Total negociado','Entrada']){
  if(d.memory&&['Desconto','Entrada'].includes(key))continue;
  const n=add([d.memory&&key==='Total negociado'?'Saldo apurado':key,Number(d.get(key))],['Saldo atualizado','Total negociado'].includes(key)?5:4,25);merges.push(`C${n}:M${n}`);
 }
 wide(d.memory?'Memória do saldo contratual. Não representa proposta ou acordo. Recebimentos já considerados pelo motor.':'Encargos simulados antes do desconto geral. O demonstrativo abaixo apresenta as reduções e o rateio de apresentação.',3,30);
 wide('02  DETALHAMENTO DOS TÍTULOS E CONDIÇÕES CONTRATUAIS',2,28);
 const header=add(['Título','Vencimento','Dias após carência','Principal (R$)','Juros (R$)','Multa (R$)','Honorários (R$)','Saldo (R$)','Juros (%)','Periodicidade','Multa (%)','Honorários (%)','Base honorários'],1,38);
 for(const row of d.items)add(row,6,30);
 const last=out.length;
 add(['TOTAL','','',Number(d.get('Principal')),Number(d.get('Juros')),Number(d.get('Multa')),Number(d.get('Honorários')),Number(d.get('Saldo atualizado'))],5,28);
 wide('Base “Saldo com encargos”: principal + juros + multa. Dias apresentados já consideram a carência contratual.',3,30);
 if(d.statement.length){
  wide(d.memory?'COMPOSIÇÃO DO SALDO APURADO':'DEMONSTRATIVO FINANCEIRO — ANTES E DEPOIS',2,28);
  for(const row of d.statement)add(d.memory?[row[0],row[1]]:row,4,28);
  wide(d.get('Desconto total (%)'),3,26);wide(d.get('Critério do demonstrativo')||statementNote,3,60);
  for(const title of d.statementTitles)wide('Título negociado: '+title,0,28);
 }
 wide(d.memory?'03  RECEBIMENTOS REGISTRADOS':'03  CONDIÇÕES DE PAGAMENTO',2,28);wide('Periodicidade das parcelas: '+d.get('Periodicidade das parcelas'),0,26);
 add(d.memory?['Recebimento','Data do recebimento','Valor (R$)']:['Pagamento','Vencimento','Valor (R$)'],1,28);
 for(const row of d.payments)add(row,7,24);
 add([d.memory?'Saldo apurado':'Total negociado','',Number(d.get('Total negociado'))],5,28);
 for(const key of ['Referência do acordo','Registro de aceite'])if(d.get(key))wide(`${key}: ${d.get(key)}`,0,38);
 wide(d.get('Situação'),3,30);
 const col=n=>String.fromCharCode(65+n);
 const sheet=`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="${header}" topLeftCell="A${header+1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${[30,23,21,20,20,20,22,20,16,25,16,20,28].map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${out.map((r,i)=>`<row r="${i+1}" ht="${r.height}" customHeight="1">${r.values.map((v,j)=>{let s=r.style;if(typeof v==='number')s=r.style===6?(j>=3&&j<=7?8:9):r.style===5?10:8;return `<c r="${col(j)}${i+1}" s="${s}" t="${typeof v==='number'?'n':'inlineStr'}">${typeof v==='number'?`<v>${v}</v>`:`<is><t xml:space="preserve">${xml(v)}</t></is>`}</c>`;}).join('')}</row>`).join('')}</sheetData><autoFilter ref="A${header}:M${last}"/><mergeCells count="${merges.length}">${merges.map(r=>`<mergeCell ref="${r}"/>`).join('')}</mergeCells><printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;LRR Estratégia &amp; Performance&amp;RPágina &amp;P de &amp;N</oddFooter></headerFooter></worksheet>`;
 const font=(bold,color,size=11)=>`<font><sz val="${size}"/><color rgb="FF${color}"/><name val="Arial"/>${bold?'<b/>':''}</font>`;
 const xf=(fontId,fillId,numFmtId=0,right=false)=>`<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" horizontal="${right?'right':'left'}" wrapText="1"/></xf>`;
 const styles=`<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;R$&quot; #,##0.00;[Red]-&quot;R$&quot; #,##0.00"/></numFmts><fonts count="5">${font(false,brand.ink)}${font(true,'FFFFFF',12)}${font(true,brand.blue,12)}${font(false,'52677F',10)}${font(true,brand.ink)}</fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${[brand.navy,brand.pale,'E2EEFA'].map(c=>`<fill><patternFill patternType="solid"><fgColor rgb="FF${c}"/><bgColor indexed="64"/></patternFill></fill>`).join('')}</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="11">${xf(0,0)}${xf(1,2)}${xf(2,3)}${xf(3,0)}${xf(0,0)}${xf(4,4)}${xf(0,3)}${xf(0,0)}${xf(0,3,164,true)}${xf(0,3,0,true)}${xf(4,4,164,true)}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
 return zip([
 ['[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
 ['_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
 ['xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Negociação" sheetId="1" r:id="rId1"/></sheets></workbook>'],
 ['xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],['xl/worksheets/sheet1.xml',sheet],['xl/styles.xml',styles]]);
}
export function proposalPdf(rows){
 const d=reportData(rows),pages=[];let commands=[],y=0;
 const rgb=h=>h.match(/../g).map(v=>(parseInt(v,16)/255).toFixed(3)).join(' ');
 const esc=s=>String(s).replace(/[—–]/g,'-').replace(/•/g,'|').replace(/\u00a0/g,' ').replace(/[^\x20-\xff]/g,'?').replace(/[\\()]/g,'\\$&');
 const text=(s,x,top,size=10,bold=false,color=brand.ink)=>commands.push(`BT /F${bold?2:1} ${size} Tf ${rgb(color)} rg 1 0 0 1 ${x} ${842-top} Tm (${esc(s)}) Tj ET`);
 const box=(x,top,w,h,color)=>commands.push(`${rgb(color)} rg ${x} ${842-top-h} ${w} ${h} re f`);
 const right=(s,x,top,size=10,bold=false)=>text(s,x-String(s).length*size*.53,top,size,bold);
 const wrap=(s,max)=>{const words=String(s).split(/\s+/),lines=[];let line='';for(const word of words){if((line+' '+word).trim().length>max&&line){lines.push(line);line='';}for(let p=0;p<word.length;p+=max){const part=word.slice(p,p+max);if(p){lines.push(line);line='';}line+=(line?' ':'')+part;}}if(line)lines.push(line);return lines;};
 const newPage=()=>{if(commands.length)pages.push(commands);commands=[];box(0,0,595,92,brand.navy);box(34,27,47,38,brand.blue);text('RR',42,54,24,true,'FFFFFF');text('ESTRATÉGIA & PERFORMANCE',95,42,15,true,'FFFFFF');text('ASSESSORIA DE COBRANÇA EMPRESARIAL',96,61,8,false,'C2CCDA');y=121;};
 const need=h=>{if(y+h>778)newPage();};
 const paragraph=(s,size=10,color=brand.ink)=>{for(const line of wrap(s,Math.floor(96*10/size))){need(16);text(line,36,y,size,false,color);y+=15;}};
 const section=s=>{need(46);y+=10;box(34,y-15,527,27,brand.pale);text(s,44,y+3,11,true,brand.blue);y+=32;};
 newPage();text(d.title,36,y,16,true);y+=22;text(`Atualização do débito: ${d.get('Atualização')}`,36,y,10,false,'52677F');y+=28;
 paragraph(`Devedor: ${d.get('Devedor')}`,11);y+=5;paragraph(`Credor: ${d.get('Credor')}`,11);
 section('01  COMPOSIÇÃO DO DÉBITO');
 for(const [i,key] of ['Principal','Juros','Multa','Honorários'].entries()){const x=36+(i%2)*269;if(i%2===0)need(66);box(x,y-4,257,57,brand.pale);text(key,x+12,y+13,10);text(brl(d.get(key)),x+12,y+36,17,true);if(i%2)y+=67;}
 for(const key of (d.memory?['Saldo atualizado']:['Saldo atualizado','Desconto','Entrada'])){text(key,44,y+12,11);right(brl(d.get(key)),549,y+12,11,true);y+=26;}
 box(36,y,523,43,brand.navy);text(d.memory?'SALDO APURADO':'TOTAL NEGOCIADO',48,y+26,12,true,'FFFFFF');const amount=brl(d.get('Total negociado'));text(amount,547-amount.length*9,y+27,17,true,'FFFFFF');y+=61;
 paragraph(d.memory?'Memória do saldo contratual. Não representa proposta ou acordo.':'Encargos simulados antes do desconto geral. Confira as reduções no demonstrativo abaixo.',9,'52677F');
 section('02  MEMÓRIA DOS TÍTULOS');
 paragraph('Valores em reais. Cada título apresenta os encargos e os parâmetros contratuais utilizados.',9,'52677F');y+=6;
 for(const r of d.items){const titleLines=wrap(`Título: ${r[0]}`,79),termLines=wrap(`Juros: ${r[8]}% (${r[9]}) | Multa: ${r[10]}% | Honorários: ${r[11]}% sobre ${r[12]}`,100);need(95+titleLines.length*13+termLines.length*12);
  box(36,y-9,523,20+titleLines.length*13,brand.pale);for(const l of titleLines){text(l,44,y+5,10,true);y+=13;}y+=15;
  text(`Vencimento: ${r[1]} | Dias após carência: ${r[2]}`,44,y,9,false,'52677F');y+=22;
  const labels=['Principal','Juros','Multa','Honorários','Saldo atualizado'],positions=[44,151,245,339,444];
  labels.forEach((l,i)=>{text(l,positions[i],y,8,false,'52677F');text(brl(r[i+3]),positions[i],y+17,10,true);});y+=35;
  for(const l of termLines){text(l,44,y,8);y+=12;}y+=17;
 }
 paragraph('Honorários sobre saldo com encargos = principal + juros + multa. Os dias informados já consideram a carência contratual.',9,'52677F');
 if(d.statement.length){
  section(d.memory?'COMPOSIÇÃO DO SALDO APURADO':'DEMONSTRATIVO FINANCEIRO — ANTES E DEPOIS');
  for(const row of d.statement){
   if(typeof row[1]!=='number'){paragraph(d.memory?'Composição | Valor registrado':'Composição | Dívida atualizada | Proposta negociada | Desconto',9);continue;}
   paragraph(d.memory?row[0]+': '+brl(row[1]):row[0]+': '+brl(row[1])+' | '+brl(row[2])+' | '+brl(row[3])+' ('+row[4]+')',10);
  }
  if(!d.memory)paragraph('Desconto total: '+d.get('Desconto total (%)'),9);paragraph(d.get('Critério do demonstrativo')||statementNote,9);
  for(const title of d.statementTitles)paragraph('Título negociado: '+title,9);
 }
 // Keep short schedules together instead of leaving a few installments on a new page.
 need(Math.min(630,120+d.payments.length*26));section(d.memory?'03  RECEBIMENTOS REGISTRADOS':'03  CONDIÇÕES DE PAGAMENTO');text('Periodicidade: '+d.get('Periodicidade das parcelas'),44,y+2,10);y+=22;
 const paymentHeader=()=>{box(36,y-12,523,25,brand.pale);text(d.memory?'Recebimento':'Pagamento',44,y+4,10,true);text(d.memory?'Recebido em':'Vencimento',308,y+4,10,true);text('Valor (R$)',455,y+4,10,true);y+=30;};paymentHeader();
 for(const [i,p] of d.payments.entries()){if(y+30>778){newPage();section(d.memory?'RECEBIMENTOS — CONTINUAÇÃO':'CONDIÇÕES DE PAGAMENTO — CONTINUAÇÃO');paymentHeader();}if(i%2===0)box(36,y-12,523,25,'F8FAFC');text(p[0],44,y+4,10);text(p[1],308,y+4,10);right(brl(p[2]),549,y+4,10,true);y+=26;}
 need(48);text(d.memory?'Saldo apurado':'Total negociado',44,y+10,11,true);right(brl(d.get('Total negociado')),549,y+10,11,true);y+=38;
 for(const key of ['Referência do acordo','Registro de aceite'])if(d.get(key))paragraph(`${key}: ${d.get(key)}`,9);
 paragraph(d.get('Situação'),9,'52677F');pages.push(commands);
 const objects=['','<< /Type /Catalog /Pages 2 0 R >>','','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'],ids=[];
 pages.forEach((c,i)=>{const page=objects.length,content=page+1;ids.push(page);objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${content} 0 R >>`);const footer=`BT /F1 8 Tf ${rgb('52677F')} rg 1 0 0 1 36 28 Tm (rrestrategiaperformance.com.br) Tj 1 0 0 1 469 28 Tm (P${esc('á')}gina ${i+1} de ${pages.length}) Tj ET`;const stream=c.join('\n')+'\n'+footer;objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);});
 objects[2]=`<< /Type /Pages /Kids [${ids.map(p=>p+' 0 R').join(' ')}] /Count ${ids.length} >>`;
 let pdf='%PDF-1.4\n',offsets=[0];for(let i=1;i<objects.length;i++){offsets.push(pdf.length);pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}const start=pdf.length;pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;return Uint8Array.from(pdf,c=>c.charCodeAt(0));
}

export const canExportProposal=profile=>['admin','master'].includes(profile?.role);
export async function authorizeProposalExport(api){
 const profile=await api.rpc('profile');
 if(!canExportProposal(profile))throw Error('Somente administradores podem exportar este relatório.');
 return profile;
}
export function downloadProposal(detail,quote,s,format,profile){
 if(!canExportProposal(profile))throw Error('Somente administradores podem exportar este relatório.');
 const rows=proposalRows(detail,quote,s),bytes=format==='pdf'?proposalPdf(rows):proposalXlsx(rows),url=URL.createObjectURL(new Blob([bytes],{type:format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
 const a=document.createElement('a');a.href=url;a.download='negociacao-'+quote.as_of+'.'+format;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
