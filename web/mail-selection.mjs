// Selection never follows the operator into another account, folder or search.
export function createMailSelection(){
 let scope='',visible=new Set(),selected=new Set();
 return {
  view(key,ids){if(key!==scope){scope=key;selected.clear();}visible=new Set(ids);selected=new Set([...selected].filter(id=>visible.has(id)));},
  toggle(id,checked){if(!visible.has(id))return;if(checked)selected.add(id);else selected.delete(id);},
  all(checked){selected=checked?new Set(visible):new Set();},
  clear(){selected.clear();},
  has(id){return selected.has(id);},
  get count(){return selected.size;},
  get total(){return visible.size;},
  get checked(){return visible.size>0&&selected.size===visible.size;},
  get partial(){return selected.size>0&&selected.size<visible.size;},
  items(messages){return messages.filter(m=>visible.has(m.id)&&selected.has(m.id)).map(m=>({id:m.id,thread_id:m.thread.id}));}
 };
}
