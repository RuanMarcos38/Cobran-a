// Visual ordering only. Never reorder the source quote, database rows or payment IDs.
export function sortTitleRows(rows,direction='asc'){
 if(direction!=='asc'&&direction!=='desc')throw Error('Ordem de vencimento inválida.');
 const sign=direction==='asc'?1:-1;
 return [...rows].sort((a,b)=>{
  const dueA=String(a.due_date??''),dueB=String(b.due_date??'');
  // ISO calendar dates sort chronologically as strings; blanks are always last.
  if(!dueA&&!dueB)return String(a.id).localeCompare(String(b.id));
  if(!dueA)return 1;
  if(!dueB)return -1;
  const dateComparison=dueA.localeCompare(dueB);
  if(dateComparison)return sign*dateComparison;
  return String(a.id).localeCompare(String(b.id));
 });
}
