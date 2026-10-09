import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(fileURLToPath(new URL('./web/',import.meta.url)));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self' https://*.supabase.co; style-src 'self'; img-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if(req.method!=='GET'){res.writeHead(405);return res.end();}
  if(req.url==='/config'){res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');return res.end(JSON.stringify({url:process.env.SUPABASE_URL||'',key:process.env.SUPABASE_PUBLISHABLE_KEY||'',name:process.env.APP_NAME||'Cobrança'}));}
  try{
    const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const target=path.resolve(root,'.'+(relative==='/'?'/index.html':relative));
    if(!target.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
    const data=await readFile(target);res.setHeader('Content-Type',types[path.extname(target)]||'application/octet-stream');res.end(data);
  }catch{res.writeHead(404);res.end('Não encontrado');}
});
server.listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log('Cobrança disponível em http://127.0.0.1:'+ (process.env.PORT||3000)));
