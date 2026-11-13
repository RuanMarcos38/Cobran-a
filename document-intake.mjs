import {createHash} from 'node:crypto';

// Draft extraction only. No record, debtor or financial title is ever created here.
const MAX_BYTES=5*1024*1024;
const digits=v=>String(v??'').replace(/\D/g,'');
export function validateDocumentUpload(file) {
  if (!file || typeof file.name!=='string' || !/^[\wÀ-ÿ .()-]{1,160}\.(?:png|jpe?g|pdf)$/i.test(file.name)) throw Error('Nome ou extensão inválida');
  if(typeof file.base64!=='string'||file.base64.length>6990508||file.base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64))throw Error('Conteúdo inválido');
  const bytes=Buffer.from(file.base64,'base64');if(!bytes.length||bytes.length>MAX_BYTES)throw Error('Arquivo maior que 5 MB');
  const ext=file.name.toLowerCase().split('.').at(-1);
  const png=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
  const jpeg=bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex'))&&bytes.subarray(-2).equals(Buffer.from('ffd9','hex'));
  const pdf=bytes.subarray(0,5).toString('ascii')==='%PDF-'&&bytes.includes(Buffer.from('%%EOF'));
  if(!((ext==='png'&&png)||(['jpg','jpeg'].includes(ext)&&jpeg)||(ext==='pdf'&&pdf)))throw Error('Conteúdo não corresponde ao tipo de arquivo permitido');
  // PDF or raster processing must run in a sandboxed worker with resource limits.
  if(png){const w=bytes.readUInt32BE(16),h=bytes.readUInt32BE(20);if(!w||!h||w*h>25000000)throw Error('Imagem excede a resolução permitida');}
  return {bytes,kind:pdf?'pdf':'image',sha256:createHash('sha256').update(bytes).digest('hex')};
}
const isoDate=(day,month,year)=>{
 const y=Number(year),m=Number(month),d=Number(day);
 if(y<1900||y>2100||m<1||m>12)return null;
 const dt=new Date(Date.UTC(y,m-1,d));
 return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d?dt.toISOString().slice(0,10):null;
};
const money=value=>{
 const v=String(value||'').trim().replace(/\s/g,'');
 if(!/^\d{1,3}(?:\.\d{3})*,\d{2}$|^\d+,\d{2}$/.test(v))return null;
 const normalized=v.replace(/\./g,'').replace(',','.');
 const cents=Math.round(Number(normalized)*100);
 return cents>0&&Number.isSafeInteger(cents)?(cents/100).toFixed(2):null;
};
const field=(text,regex)=>text.match(regex)?.[1]?.trim()||null;
export function interpretDocumentText(text,kind){
 if(!['cheque','devedor'].includes(kind))throw Error('Tipo de documento inválido');
 if(typeof text!=='string'||text.length>50000)throw Error('Texto OCR inválido');
 const clean=text.normalize('NFKC').replace(/[\u200b-\u200f]/g,'');
 // OCR is uncertain: never treat these fields as verified bank information.
 if(kind==='cheque'){
  const values=[...clean.matchAll(/(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/g)].map(m=>money(m[1])).filter(Boolean);
  // Cheques brasileiros frequentemente mostram somente o valor inteiro, como R$ 7.970.\n  for(const m of clean.matchAll(/R\$\s*(\d{1,3}(?:\.\d{3})+)(?![,\d])/g))values.push(m[1].replace(/\./g,'')+'.00');
  const dateCandidates=[...clean.matchAll(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})\b/g)].map(m=>isoDate(m[1],m[2],m[3])).filter(Boolean);
  return {kind,status:'review_required',original_text:clean,amount_candidates:[...new Set(values)],
    date_candidates:[...new Set(dateCandidates)],cheque_number:field(clean,/cheque\s*(?:n[ºo.]*)?\s*[:#-]?\s*(\d{5,10})/i),
    return_reasons:[...new Set([...clean.matchAll(/motivo\s*[:\s]+(\d{2})/gi)].map(m=>m[1]))],
    fields_to_confirm:['credor','devedor','número do cheque','valor','data do cheque','vencimento para cobrança','motivo de devolução'],
    warnings:['Datas de apresentação/devolução não são automaticamente o vencimento da dívida.','Confirme o cheque frente e verso e verifique eventual duplicidade.']};
 }
 const document=field(clean,/(?:CPF\s*\/\s*CNPJ|CNPJ|CPF)\s*[:\-]?\s*([\d.\/-]{11,18})/i);
 const email=field(clean,/\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i);
 return {kind,status:'review_required',original_text:clean,
   name:field(clean,/(?:Cliente|Razão Social|Nome)\s*[:\-]\s*([^\n\r]+)/i),
   document:document&&[11,14].includes(digits(document).length)?digits(document):null,
   email,phone:field(clean,/(?:Telefone|Celular)\s*[:\-]\s*([+()\d .-]{8,22})/i),
   address:field(clean,/(?:Endereço)\s*[:\-]\s*([^\n\r]+)/i),
   city:field(clean,/(?:Cidade)\s*[:\-]\s*([^\n\r]+)/i),
   warnings:['Revise CPF/CNPJ, nome, endereço e contato antes de criar ou vincular ao cadastro existente.']};
}
