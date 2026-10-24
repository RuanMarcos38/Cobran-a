// Code node: Confirmar status para a planilha. Only confirmed SMTP records are exported.
const result=$json.data;
if(!result||!['accepted','idle','review'].includes(result.status))throw new Error('Resultado da ferramenta não reconhecido. Nenhum reenvio automático.');
const updates=Array.isArray(result.sheet_updates)?result.sheet_updates:result.status==='accepted'?[result]:[];
const originals=$('Ler fila de aprovados').all().map(i=>i.json);
return updates.map(sent=>{
 if(sent.status!=='accepted'||!sent.provider_id||!sent.attempt_id||!sent.email)throw new Error('Falta confirmação do envio na ferramenta.');
 const original=originals.find(r=>String(r.email||'').trim().toLowerCase()===sent.email.toLowerCase());
 if(!original)return null;
 return {json:{email:original.email,status_email:'ENVIADO',situacao:sent.suppressed?'OPTOUT':sent.responded?'RESPONDEU':'CONTATADO',data_contato:sent.finished_at||new Date().toISOString(),tentativas:1}};
}).filter(Boolean);
