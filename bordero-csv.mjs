import {createHash} from 'node:crypto';

const canonical=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases={
  creditor_document:['CNPJ Empresa Credora'],
  creditor_name:['Razão Social Empresa Credora'],
  debtor_document:['CNPJCPF Cliente','CPF/CNPJ','Documento devedor'],
  debtor_name:['Nome Cliente','Razão do Cliente','Devedor'],
  address:['Endereço Cobrança','Endereço'],district:['Bairro'],city:['Cidade'],state:['UF'],zip:['CEP'],
  ddd:['DDD'],phone:['Telefone'],species:['Especie do Título'],
  external_ref:['Identificação (Código) do Título','Número do título','Núm. Título'],
  installment:['Parcela'],issued_at:['Data emissão'],due_date:['Data Vencto','Vencimento'],
  original_amount:['Valor Aberto','Vlr. Aberto'],protest_amount:['Valor do protesto'],
  notes:['Observações','Obs. Título'],debtor_code:['Cód. Identificador Devedor','Cód. Cliente'],
  representative:['Nome do Representante que efetuou a venda'],
  representative_phone:['DDD e Fone para contato com o ReprMiesentante'],
  debtor_email:['E-mail devedor','Email']
};
const fields=new Map(Object.entries(aliases).flatMap(([name,values])=>[name,...values].map(label=>[canonical(label),name])));

function decode(bytes){
  try{return {text:new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,''),encoding:'UTF-8'};}
  catch{return {text:new TextDecoder('windows-1252').decode(bytes).replace(/^\uFEFF/,''),encoding:'Windows-1252'};}
}
function csvRows(text,delimiter){
  const rows=[];let line=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){
      if(quoted&&text[i+1]==='"'){cell+='"';i++;}
      else if(!quoted&&!cell.length)quoted=true;
      else if(quoted)quoted=false;
      else throw Error('Aspas inválidas no arquivo CSV');
    }else if(c===delimiter&&!quoted){line.push(cell.trim());cell='';}
    else if((c==='\r'||c==='\n')&&!quoted){
      if(c==='\r'&&text[i+1]==='\n')i++;
      line.push(cell.trim());if(line.some(Boolean))rows.push(line);line=[];cell='';
    }else cell+=c;
  }
  if(quoted)throw Error('Aspas não fechadas no arquivo CSV');
  if(cell||line.length){line.push(cell.trim());if(line.some(Boolean))rows.push(line);}
  return rows;
}
function money(value){
  const s=String(value??'').trim().replace(/^R\$\s*/i,'');
  if(!s)throw Error('Valor obrigatório');
  const normalized=s.includes(',')?s.replace(/\./g,'').replace(',','.'):s;
  if(!/^(?:\d+)(?:\.\d{1,2})?$/.test(normalized))throw Error('Valor monetário inválido');
  const [a,b='']=normalized.split('.');
  const cents=BigInt(a)*100n+BigInt(b.padEnd(2,'0'));
  if(cents===0n||cents>99999999999999n)throw Error('Valor deve ser positivo e dentro do limite');
  return (cents/100n).toString()+'.'+String(cents%100n).padStart(2,'0');
}
function date(value){
  if(!String(value??'').trim())return null;
  let s=String(value).trim();
  if(/^\d{2}\/\d{2}\/\d{4}$/.test(s))s=s.split('/').reverse().join('-');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number(s.slice(0,4))<1900||!Number.isFinite(Date.parse(s+'T12:00:00Z'))||new Date(s+'T12:00:00Z').toISOString().slice(0,10)!==s)throw Error('Data inválida');
  return s;
}
const digits=x=>String(x??'').replace(/\D/g,'');
function normalize(values,source,headers){
  const raw={};const r={};
  headers.forEach((header,i)=>{
    const field=fields.get(canonical(header));
    const value=String(values[i]??'').trim();
    raw[raw[header]===undefined?header:header+' ('+(i+1)+')']=value;
    if(field==='debtor_email'){if(!r.debtor_email&&value)r.debtor_email=value;}
    else if(field)r[field]=value;
  });
  // Some actual ERP exports put the company name under the CNPJ heading and the CNPJ under the Razão heading.
  const reversed=!digits(r.creditor_document).match(/^\d{14}$/)&&/^\d{14}$/.test(digits(r.creditor_name));
  if(reversed)[r.creditor_document,r.creditor_name]=[r.creditor_name,r.creditor_document];
  const doc=digits(r.debtor_document);
  if(!r.debtor_name||!r.external_ref||!r.due_date||!r.original_amount)throw Error('Nome, título, vencimento e valor são obrigatórios');
  if(!doc&&!r.debtor_code)throw Error('CPF/CNPJ ou código do devedor obrigatório');
  if(doc&&![11,14].includes(doc.length))throw Error('CPF/CNPJ do devedor inválido');
  if(r.creditor_document&&digits(r.creditor_document).length!==14)throw Error('CNPJ do credor inválido');
  if(r.debtor_email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.debtor_email))throw Error('E-mail inválido');
  const phone=digits(r.phone),ddd=digits(r.ddd);
  const full=phone.length<=9?ddd+phone:phone;
  if(full&&!/^(?:55)?\d{10,11}$/.test(full))throw Error('DDD/telefone inválido');
  const installment=r.installment?' / parcela '+r.installment:'';
  const external_ref=r.external_ref+installment;
  if(external_ref.length>200||r.debtor_name.length>250)throw Error('Nome ou identificação de título excede o limite');
  return {...r,source,external_ref,debtor_document:doc||null,debtor_phone:full?(full.startsWith('55')&&full.length>=12?full:'55'+full):null,debtor_email:r.debtor_email||null,due_date:date(r.due_date),issued_at:date(r.issued_at),original_amount:money(r.original_amount),protest_amount:r.protest_amount?money(r.protest_amount):null,raw,creditor_columns_swapped:reversed};
}
export function parseBorderoCsv(bytes,name){
  if(!/\.csv$/i.test(name)||!bytes.length||bytes.length>5*1024*1024)throw Error('Arquivo CSV inválido ou maior que 5 MB');
  const {text,encoding}=decode(bytes);
  const first=text.split(/\r?\n/,1)[0]||'';
  const delimiter=(first.match(/;/g)||[]).length>=(first.match(/,/g)||[]).length?';':',';
  const matrix=csvRows(text,delimiter);
  if(matrix.length>5001)throw Error('Limite de 5.000 linhas por arquivo');
  let start=-1,mapping;
  for(let i=0;i<Math.min(30,matrix.length);i++){
    const found=matrix[i].map(label=>fields.get(canonical(label)));
    if(['debtor_name','external_ref','due_date','original_amount'].every(key=>found.includes(key))){start=i;mapping=matrix[i];break;}
  }
  if(start<0)throw Error('Cabeçalho do borderô não reconhecido. Confira Nome Cliente, Identificação do Título, Data Vencto e Valor Aberto');
  const rows=[],errors=[],warnings=[];
  const mapped=new Map();
  mapping.forEach((header,index)=>{
    const field=fields.get(canonical(header));
    if(!field)warnings.push('Coluna não reconhecida '+(index+1)+': '+header+'. Valor preservado nos campos originais.');
    else {
      if(mapped.has(field)&&field!=='debtor_email')errors.push({source:'CSV:'+String(start+1),error:'Colunas duplicadas para '+field+': '+mapped.get(field)+' e '+header+'. Revise o mapeamento antes de importar.'});
      mapped.set(field,header);
    }
  });
  if(encoding!=='UTF-8')warnings.push('Codificação '+encoding+' reconhecida automaticamente.');
  if(mapping.filter(h=>canonical(h)==='emaildevedor').length>1)warnings.push('Colunas de e-mail repetidas preservadas; usado o primeiro e-mail preenchido.');
  for(let i=start+1;i<matrix.length;i++){
    const values=matrix[i];if(!values.some(Boolean))continue;
    if(values.length!==mapping.length){errors.push({source:'CSV:'+String(i+1),error:'Quantidade de colunas diferente do cabeçalho'});continue;}
    try{const r=normalize(values,'CSV:'+String(i+1),mapping);if(r.creditor_columns_swapped&&!warnings.includes('CNPJ e razão social do credor invertidos no arquivo; colunas corrigidas.'))warnings.push('CNPJ e razão social do credor invertidos no arquivo; colunas corrigidas.');delete r.creditor_columns_swapped;rows.push(r);}
    catch(e){errors.push({source:'CSV:'+String(i+1),error:e.message});}
  }
  const seen=new Map();for(const r of rows){const group=seen.get(r.external_ref)||[];group.push(r);seen.set(r.external_ref,group);}
  let needs_confirmation=false;
  for(const [ref,group] of seen)if(group.length>1){
    needs_confirmation=true;
    const keys=new Set();
    for(const r of group){
      const suffix=' / venc. '+r.due_date;
      if(keys.has(r.due_date)){errors.push({source:r.source,error:'Título '+ref+' repetido com mesmo vencimento; revise antes de importar'});continue;}
      keys.add(r.due_date);
      r.external_ref=ref+suffix;
      r.repeated_title=true;
      if(r.external_ref.length>200)errors.push({source:r.source,error:'Identificação de título longa demais'});
    }
  }
  if(needs_confirmation)warnings.push('O mesmo identificador aparece com diferentes vencimentos. Pode representar renegociação do MESMO débito. Confirme expressamente se devem ser criados títulos separados, para evitar cobrança duplicada.');
  if(rows.length>1000)throw Error('Máximo de 1.000 títulos por arquivo');
  const sum=rows.reduce((n,r)=>n+BigInt(r.original_amount.replace('.','')),0n);
  const total=(sum/100n).toString()+'.'+String(sum%100n).padStart(2,'0');
  return {rows,errors,warnings,count:rows.length,total,file_name:name,file_hash:createHash('sha256').update(bytes).digest('hex'),needs_confirmation};
}
