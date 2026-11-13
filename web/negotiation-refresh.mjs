// Refresh authoritative quotes without replacing the user's proposal form.
export function watchNegotiationQuote({active,visible,load,apply,failed,events=[],schedule=setTimeout,cancel=clearTimeout,interval=60000}){
 let timer,busy=false,stopped=false;
 const stop=()=>{stopped=true;cancel(timer);for(const [target,event] of events)target.removeEventListener(event,tick);};
 async function tick(){
  if(stopped||busy)return;
  cancel(timer);
  if(!active())return stop();
  if(visible()){
   busy=true;
   try{const quote=await load();if(!stopped&&active())await apply(quote);}
   catch(error){if(!stopped&&active())failed(error);}
   finally{busy=false;}
  }
  if(!stopped)timer=schedule(tick,interval);
 }
 for(const [target,event] of events)target.addEventListener(event,tick);
 timer=schedule(tick,interval);return stop;
}
