import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export const institutionalAsset=Object.freeze({asset:'rr-institutional-v1',name:'Institucional RR.pdf',mime:'application/pdf',size:354506,sha256:'b85c9d394271baaa90da6e5728068fae8b98fd818b4bc3a8efd5f20fb542f193'});
export const institutionalMailbox='contato@rrestrategiaperformance.com.br';
export async function loadInstitutionalAttachment(){
 const content=await readFile(new URL('./assets/Institucional RR.pdf',import.meta.url));
 if(content.length!==institutionalAsset.size||content.subarray(0,5).toString()!=='%PDF-'||createHash('sha256').update(content).digest('hex')!==institutionalAsset.sha256)throw Error('Anexo institucional indisponível ou alterado');
 return {...institutionalAsset,content};
}
