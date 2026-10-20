// Folder membership follows recorded direction and transport acknowledgement, never the contact name.
export const mailFolders={inbox:'Caixa de entrada',sent:'Enviados',pending:'Pendentes',notes:'Notas internas'};
export function mailFolder(message){
 if(message.direction==='note')return 'notes';
 if(message.direction==='inbound')return 'inbox';
 if(message.direction==='outbound'&&['accepted','received'].includes(message.status))return 'sent';
 return 'pending';
}
export function mailItems(details){
 return details.flatMap(d=>d.messages.map(m=>({...m,thread:d.thread,folder:mailFolder(m)}))).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)||String(a.id).localeCompare(String(b.id)));
}
export function filterMail(items,folder,search=''){
 const q=search.trim().toLocaleLowerCase('pt-BR');
 return items.filter(m=>m.folder===folder&&(!q||[m.subject,m.content,m.thread.name,m.thread.address].join(' ').toLocaleLowerCase('pt-BR').includes(q)));
}
