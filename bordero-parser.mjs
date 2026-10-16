import * as XLSX from '@e965/xlsx';
import {createHash} from 'node:crypto';

const key=s=>String(s??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases={
 creditor_document:['CNPJ Empresa Credora'],creditor_name:['Razão Social Empresa Credora'],
 debtor_document:['CNPJCPF Cliente','CPF/CNPJ','Documento devedor'],debtor_name:['Nome Cliente','Razão do Cliente','Devedor'],
 address:['Endereço Cobrança','Endereço'],district:['Bairro'],city:['Cidade'],state:['UF'],zip:['CEP'],ddd:['DDD'],phone:['Telefone'],
 species:['Especie do Título'],external_ref:['Identificação (Código) do Título','Núm. Título','Número do título'],installment:['Parcela'],
 issued_at:['Data emissão'],due_date:['Data Vencto','Vencimento'],original_amount:['Valor Aberto','Vlr. Aberto'],
 protest_amount:['Valor do protesto'],notes:['Observações','Obs. Título'],debtor_code:['Cód. Identificador Devedor','Cód. Cliente'],
 representative:['Nome do Representante que efetuou a venda'],representative_phone:['DDD e Fone para contato com o ReprMiesentante'],
 debtor_email:['E-mail devedor','Email'],
};
const fields=new Map(Object.entries(aliases).flatMap(([k,v])=>[k,...v].map(s=>[key(s),k])));
export function money(value){
 let s=String(value??'').trim().replace(/^R\$\s*/,'');
 if(typeof value==='number'){if(!Number.isFinite(value)||Math.abs(value*100-Math.round(value*100))>0.001)throw Error('Valor monetário inválido');s=value.toFixed(2);}
 else if(s.includes(',')){if(!/^(?:\d{1,3}(?:\.\d{3})*|\d+),\d{1,2}$/.test(s))throw Error('Valor monetário inválido');s=s.replace(/\./g,'').replace(',','.');}
 if(!/^\d+(?:\.\d{1,2})?$/.test(s))throw Error('Valor monetário inválido');
 const [a,b='']=s.split('.');const cents=BigInt(a)*100n+BigInt(b.padEnd(2,'0'));
 if(cents>99999999999999n)throw Error('Valor excede o limite');return `${cents/100n}.${String(cents%100n).padStart(2,'0')}`;
}
export function date(value){
 if(value===null||value===undefined||value==='')return null;
 let s=String(value).trim();
 if(typeof value==='number'){const d=XLSX.SSF.parse_date_code(value);if(!d)throw Error('Data inválida');s=`${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;}
 if(/^\d{2}\/\d{2}\/\d{4}$/.test(s))s=s.split('/').reverse().join('-');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number(s.slice(0,4))<1900||new Date(s+'T12:00:00Z').toISOString().slice(0,10)!==s)throw Error('Data inválida');return s;
}
function normalize(raw,source){
 const r=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,typeof v==='string'?v.trim():v]));
 if(!r.debtor_name||!r.external_ref||!r.due_date||r.original_amount===undefined||r.original_amount==='')throw Error('Nome, título, vencimento e valor são obrigatórios');
 const original_amount=money(r.original_amount);if(original_amount==='0.00')throw Error('Valor deve ser maior que zero');
 if(!r.debtor_document&&!r.debtor_code)throw Error('Informe CPF/CNPJ ou código do devedor');
 const phone=String(r.phone??'').replace(/\D/g,'');const ddd=String(r.ddd??'').replace(/\D/g,'');
 const full=phone.length<=9?ddd+phone:phone;
 if(full&&!/^(?:55)?\d{10,11}$/.test(full))throw Error('DDD/telefone inválido');
 const doc=String(r.debtor_document??'').replace(/\D/g,'');if(r.debtor_document&&![11,14].includes(doc.length))throw Error('CPF/CNPJ deve ter 11 ou 14 dígitos');
 if(r.debtor_email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.debtor_email))throw Error('E-mail inválido');
 const installment=String(r.installment??'');const external=String(r.external_ref)+(installment?' / parcela '+installment:'');
 if(external.length>200||String(r.debtor_name).length>250)throw Error('Nome ou título excede o limite');
 return {...r,source,external_ref:external,debtor_document:doc||null,debtor_phone:full?(full.length<12?'55'+full:full):null,
  due_date:date(r.due_date),issued_at:date(r.issued_at),original_amount,protest_amount:r.protest_amount==null||r.protest_amount===''?null:money(r.protest_amount),
  debtor_email:r.debtor_email||null,raw};
}
export function parseWorkbook(bytes){
 const book=XLSX.read(bytes,{type:'buffer',cellDates:false,sheetRows:5002,cellFormula:false,cellHTML:false,cellStyles:false});
 const rows=[],errors=[];let recognized=false;
 for(const name of book.SheetNames){
  const sheet=book.Sheets[name];if(!sheet['!ref'])continue;
  const range=XLSX.utils.decode_range(sheet['!fullref']||sheet['!ref']);
  if(Object.keys(sheet).every(k=>k.startsWith('!')))continue;
  if(range.e.r>5000||range.e.c>100)throw Error('Planilha limitada a 5.000 linhas e 101 colunas');
  const matrix=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true});let header=-1,mapping;
  for(let i=0;i<Math.min(matrix.length,30);i++){
   const mapped=matrix[i].map(h=>fields.get(key(h)));
   if(['debtor_name','external_ref','due_date','original_amount'].every(f=>mapped.includes(f))){header=i;mapping=mapped;break;}
  }
  if(header<0){errors.push({source:name,error:'Cabeçalho não reconhecido nesta aba'});continue;}recognized=true;
  const defined=mapping.filter(Boolean);if(new Set(defined).size!==defined.length)throw Error('Colunas duplicadas no cabeçalho');
  for(let i=header+1;i<matrix.length;i++){
   if(matrix[i].every(v=>v===''))continue;
   const raw=Object.fromEntries(mapping.flatMap((f,j)=>f?[[f,matrix[i][j]??'']]:[]));
   try{rows.push(normalize(raw,`${name}:${i+1}`));}catch(e){errors.push({source:`${name}:${i+1}`,error:e.message});}
  }
 }
 if(!recognized)throw Error('Nenhuma aba contém o cabeçalho do borderô');
 return {rows,errors,warnings:rows.length?[]:['A planilha contém somente o modelo; não há títulos preenchidos.']};
}
export function parseReport(text){
 const rows=[],errors=[];let expectedCount,expectedTotal,seriesIndex;
 const lines=text.split(/\r?\n/);const creditor_name=lines.map(s=>s.trim()).find(s=>s&&!/^Pagina:|^Página:|^Baixa por|^Vencimento:/i.test(s))||'';
 const pattern=/^\s*(\S+)\s+(\d+)\s+(.+?)\s+(\d{2}\/\d{2}\/\d{4})\s+([\d.]+,\d{2})(?:\s+(.*))?$/;
 for(let i=0;i<lines.length;i++){
  const line=lines[i];if(line.includes('Série NF'))seriesIndex=Math.max(0,line.indexOf('Série NF')-8);const count=line.match(/Qtd\.\s*Registros:\s*(\d+)/i);if(count)expectedCount=Number(count[1]);
  if(/^\s*[\d.]+,\d{2}\s+[\d.]+,\d{2}\s*$/.test(line))expectedTotal=money(line.trim().split(/\s+/).at(-1));
  const m=(seriesIndex===undefined?line:line.slice(0,seriesIndex)).match(pattern);
  if(m){try{rows.push(normalize({creditor_name,external_ref:m[1],debtor_code:m[2],debtor_name:m[3],due_date:m[4],original_amount:m[5],notes:m[6]||'',series_nf:seriesIndex===undefined?'':line.slice(seriesIndex).trim()},`PDF:${i+1}`));}catch(e){errors.push({source:`PDF:${i+1}`,error:e.message});}}
  else if(/\d{2}\/\d{2}\/\d{4}/.test(line)&&/[\d.]+,\d{2}/.test(line))errors.push({source:`PDF:${i+1}`,error:'Linha de título não reconhecida'});
 }
 if(!rows.length)throw Error('PDF sem títulos reconhecíveis. PDFs digitalizados precisam de OCR; envie a planilha ou um PDF com texto.');
 if(expectedCount===undefined||expectedTotal===undefined)errors.push({source:'PDF',error:'Relatório sem quantidade e total geral para conferência'});
 if(expectedCount!==undefined&&expectedCount!==rows.length)errors.push({source:'PDF',error:`Quantidade informada: ${expectedCount}; extraída: ${rows.length}`});
 if(expectedTotal!==undefined&&sum(rows)!==expectedTotal)errors.push({source:'PDF',error:`Total informado: ${expectedTotal}; extraído: ${sum(rows)}`});
 return {rows,errors,warnings:['O PDF não informa CPF/CNPJ, telefone ou e-mail. O vínculo usa o código do devedor no credor selecionado.'],expectedCount,expectedTotal};
}
export function sum(rows){const cents=rows.reduce((n,r)=>n+BigInt(r.original_amount.replace('.','')),0n);return `${cents/100n}.${String(cents%100n).padStart(2,'0')}`;}
export async function parseFile(bytes,name){
 if(!bytes.length||bytes.length>5*1024*1024)throw Error('Arquivo limitado a 5 MB');
 let result;
 if(/\.pdf$/i.test(name)&&bytes.subarray(0,5).toString()==='%PDF-'){
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false,disableFontFace:true});
  try{const doc=await task.promise;if(doc.numPages>100)throw Error('PDF limitado a 100 páginas');let text='';
   for(let n=1;n<=doc.numPages;n++){const page=await doc.getPage(n);const content=await page.getTextContent();const lines=new Map();for(const item of content.items){if(!item.str?.trim())continue;const y=Math.round(item.transform[5]);if(!lines.has(y))lines.set(y,[]);lines.get(y).push(item);}for(const [,items] of [...lines].sort((a,b)=>b[0]-a[0])){let line='';for(const item of items.sort((a,b)=>a.transform[4]-b.transform[4]))line=line.padEnd(Math.max(line.length+1,Math.round(item.transform[4]*2)),' ')+item.str;text+=line+'\n';}if(text.length>2000000)throw Error('PDF excede o limite de texto');}result=parseReport(text);
  }finally{await task.destroy();}
 }else if(/\.xls[x]?$/i.test(name)&&['d0cf11e0a1b11ae1','504b0304'].some(sig=>bytes.subarray(0,sig.length/2).toString('hex')===sig))result=parseWorkbook(bytes);
 else throw Error('Envie um arquivo XLS, XLSX ou PDF válido');
 if(result.rows.length>1000)throw Error('Borderô limitado a 1.000 títulos por arquivo');
 return {...result,total:sum(result.rows),count:result.rows.length,file_name:name,file_hash:createHash('sha256').update(bytes).digest('hex')};
}
