export function watchWhatsappConnection({active,status,connected,waiting,schedule=setTimeout,cancel=clearTimeout,now=Date.now,interval=3500,timeout=300000}){
 let stopped=false,timer,started=now();
 const stop=()=>{stopped=true;cancel(timer);};
 async function poll(){
  if(stopped||!active())return stop();
  if(now()-started>=timeout){waiting('Tempo de espera encerrado. Feche esta janela e verifique a conexão novamente.');return stop();}
  let result;try{result=await status();}catch{if(!stopped&&active())waiting('Tentando confirmar a conexão…');}
  if(stopped||!active())return stop();
  if(result?.ready===true&&result.state==='open'){stop();await connected();return;}
  timer=schedule(poll,interval);
 }
 timer=schedule(poll,interval);return stop;
}
