import {mkdtemp,writeFile,readdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {validateDocumentUpload,interpretDocumentText} from './document-intake.mjs';

const exec=promisify(execFile);
let running=0;
const command=async(binary,args,options={})=>{
  try {return await exec(binary,args,{timeout:15000,maxBuffer:500000,env:{PATH:process.env.PATH,LANG:'C.UTF-8',OMP_THREAD_LIMIT:'1'},...options});}
  catch(e){if(e.code==='ENOENT')throw Error('OCR indisponível neste servidor; confira a instalação do Tesseract e Poppler.');
    if(e.killed||e.code==='ETIMEDOUT')throw Error('Leitura excedeu o tempo máximo; envie um arquivo menor.');
    throw Error('Não foi possível processar o documento com segurança.');}
};

export async function reviewDocumentUpload(file,kind){
  if(!['cheque','devedor'].includes(kind))throw Error('Tipo de documento inválido');
  if(running>=2)throw Error('Limite de leituras simultâneas. Tente novamente.');
  const validated=validateDocumentUpload(file);
  let directory;
  running++;
  try {
    directory=await mkdtemp(path.join(tmpdir(),'cobranca-ocr-'));
    const ext=validated.kind==='pdf'?'.pdf':file.name.toLowerCase().endsWith('.png')?'.png':'.jpg';
    const original=path.join(directory,'documento'+ext);
    await writeFile(original,validated.bytes,{mode:0o600,flag:'wx'});
    let pictures=[original];
    if(validated.kind==='pdf'){
      const {stdout}=await command('pdfinfo',[original]);
      const pages=Number(stdout.match(/^Pages:\s*(\d+)/m)?.[1]);
      if(!Number.isInteger(pages)||pages<1||pages>3)throw Error('PDF limitado a três páginas para reconhecimento seguro.');
      await command('pdftoppm',['-f','1','-l',String(pages),'-scale-to','2000','-png',original,path.join(directory,'pagina')]);
      pictures=(await readdir(directory)).filter(name=>/^pagina-\d+\.png$/.test(name)).sort().map(name=>path.join(directory,name));
      if(pictures.length!==pages)throw Error('Não foi possível converter todas as páginas do PDF.');
    }
    const extracted=[];
    for(const picture of pictures){
      const modes=kind==='devedor'?['4']:['3','11'];
      for(const mode of modes){
       const {stdout}=await command('tesseract',[picture,'stdout','-l','por+eng','--psm',mode],{maxBuffer:250000});
       extracted.push(stdout.slice(0,20000));
      }
    }
    const rawText=extracted.join('\n').slice(0,50000);
    if(!rawText.trim())throw Error('Documento sem texto reconhecível. Use outra imagem ou faça o preenchimento manual.');
    const draft=interpretDocumentText(rawText,kind);
    // No PDF or image contents are returned or persisted. Hash is for audit of operator review only.
    const {original_text,...safeDraft}=draft;
    return {...safeDraft,ocr_text:rawText,sha256:validated.sha256,pages:pictures.length,review_required:true};
  } finally {
    running--;
    if(directory)await rm(directory,{recursive:true,force:true}).catch(()=>{});
  }
}
