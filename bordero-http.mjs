import {Worker} from 'node:worker_threads';
let running=0;
export function extractBordero(file){
 if(running>=2)throw Error('Há arquivos em processamento. Aguarde e tente novamente.');
 if(!file||typeof file.name!=='string'||file.name.length>200||/[\x00-\x1f/\\]/.test(file.name)||typeof file.base64!=='string'||file.base64.length>6990508||(file.base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)))throw Error('Arquivo inválido ou maior que 5 MB');
 const bytes=Buffer.from(file.base64,'base64');
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./bordero-worker.mjs',import.meta.url),{workerData:{bytes,name:file.name},resourceLimits:{maxOldGenerationSizeMb:192}});running++;
  let done=false;const finish=(error,data)=>{if(done)return;done=true;clearTimeout(timer);running--;worker.terminate();if(error)reject(error);else resolve(data);};
  const timer=setTimeout(()=>finish(Error('Tempo de leitura excedido. Divida o arquivo.')),20000);
  worker.once('message',m=>finish(m.error?Error(m.error):null,m.data));worker.once('error',e=>finish(e));worker.once('exit',code=>{if(!done)finish(Error('Não foi possível ler o arquivo ('+code+')'));});
 });
}
