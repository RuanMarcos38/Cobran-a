// Expand the existing DOM in place so unsaved forms and selections survive.
const expandIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>';
const restoreIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3v5H3m18 0h-5V3M3 16h5v5m8 0v-5h5"/></svg>';

export function installWindowControls(root=document){
 const enhanced=new WeakSet();
 function enhance(target,header,label){
  if(enhanced.has(target))return;
  enhanced.add(target);
  const button=document.createElement('button');
  button.type='button';button.className='window-toggle';
  let expanded=false;
  function setExpanded(value){
   expanded=value;target.classList.toggle('window-maximized',value);
   const text=`${value?'Restaurar':'Maximizar'} ${label}`;
   button.title=text;button.setAttribute('aria-label',text);
   button.setAttribute('aria-pressed',String(value));
   button.innerHTML=value?restoreIcon:expandIcon;
  }
  setExpanded(false);
  button.addEventListener('click',()=>setExpanded(!expanded));
  if(target.tagName==='DIALOG'){
   const close=header.querySelector('[data-cancel],[data-close]');
   header.insertBefore(button,close||null);
   target.addEventListener('cancel',event=>{if(expanded){event.preventDefault();setExpanded(false);button.focus();}});
   target.addEventListener('close',()=>setExpanded(false));
  }else header.append(button);
 }
 function scan(){
  root.querySelectorAll('.app-main').forEach(main=>{
   const heading=main.querySelector('.page-heading');
   if(heading)enhance(main,heading,'tela');
  });
  root.querySelectorAll('dialog').forEach(dialog=>{
   const header=dialog.querySelector('.modal-head');
   if(header)enhance(dialog,header,'janela');
  });
 }
 scan();
 const observer=new MutationObserver(scan);
 observer.observe(root.body||root,{subtree:true,childList:true});
 return observer;
}
