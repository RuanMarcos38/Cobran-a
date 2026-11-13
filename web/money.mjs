export function cents(value){
  const s=String(value).trim().replace(',','.');
  if(!/^\d+(\.\d{1,2})?$/.test(s))throw Error('Valor inválido: use até duas casas decimais.');
  const [a,b='']=s.split('.');const n=BigInt(a)*100n+BigInt(b.padEnd(2,'0'));
  if(n>99999999999999n)throw Error('Valor excede o limite.');return n;
}
export function decimal(n){return `${n/100n}.${String(n%100n).padStart(2,'0')}`;}
export function installments(total,count){
  if(!Number.isInteger(count)||count<1||count>120)throw Error('Quantidade inválida.');
  const t=cents(total),c=BigInt(count);if(t<c)throw Error('Parcela inferior a um centavo.');
  return Array.from({length:count},(_,i)=>decimal(t/c+(BigInt(i)<t%c?1n:0n)));
}
export const brl=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value||0));
export function csv(rows){
  if(!rows.length)return '';
  const keys=Object.keys(rows[0]);const cell=x=>'"'+String(x??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
  return '\uFEFF'+[keys,...rows.map(r=>keys.map(k=>r[k]))].map(r=>r.map(cell).join(';')).join('\r\n');
}
export function parseCsv(text,requiredHeaders=['name','document']){
  const rows=[];let row=[],cell='',quoted=false;
  text=text.replace(/^\uFEFF/,'');
  const delimiter=text.split(/\r?\n/)[0].includes(';')?';':',';
  for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(ch===delimiter&&!quoted){row.push(cell);cell='';}else if(ch==='\n'&&!quoted){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}else cell+=ch;}
  if(quoted)throw Error('CSV com aspas não fechadas.');if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}
  const headers=rows.shift()?.map(x=>x.trim());if(!headers||requiredHeaders.some(h=>!headers.includes(h)))throw Error('Cabeçalhos obrigatórios: '+requiredHeaders.join(',')+'.');
  return rows.filter(r=>r.some(Boolean)).map(r=>{if(r.length!==headers.length)throw Error('Quantidade de colunas inválida.');return Object.fromEntries(headers.map((h,i)=>[h,r[i]]));});
}
