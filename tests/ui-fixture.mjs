// Local-only UI fixture. Never loaded by the production server or Docker image.
import http from 'node:http';import path from 'node:path';import {readFile} from 'node:fs/promises';import {fileURLToPath} from 'node:url';import {handleApi} from '../api-http.mjs';
export async function serveUiFixture(db,admin){
 const root=path.resolve(fileURLToPath(new URL('../web/',import.meta.url))),port=8866,base='http://127.0.0.1:'+port;
 const env={SUPABASE_URL:base,SUPABASE_PUBLISHABLE_KEY:'fixture-public',EMAIL_ENCRYPTION_KEY:'12'.repeat(32),EVOLUTION_ALLOWED_ORIGIN:'https://evolution.example.invalid'};
 const read=async req=>{const parts=[];for await(const c of req)parts.push(c);return JSON.parse(Buffer.concat(parts).toString()||'{}');};
 const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,base),send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  if(url.pathname==='/config')return send(200,{url:base,key:'fixture-public',name:'VALIDAÇÃO LOCAL · dados fictícios'});
  if(url.pathname==='/health')return send(200,{status:'ok'});
  if(url.pathname==='/auth/v1/token')return send(200,{access_token:'fixture-token',refresh_token:'fixture-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:admin,email:'admin@example.invalid'}});
  if(url.pathname==='/auth/v1/logout')return send(200,{});
  if(url.pathname.startsWith('/rest/v1/rpc/')){
   const name=url.pathname.split('/').at(-1),body=await read(req);if(!['cobranca_app','cobranca_improvements','cobranca_booking_manage','cobranca_booking_prospect','cobranca_booking_public','cobranca_email'].includes(name))return send(404,{});
   try{const result=await db.transaction(async tx=>{await tx.exec(req.headers.authorization?`set local role authenticated;set local test.uid='${admin}'`:'set local role anon');const keys=Object.keys(body),sql='select public.'+name+'('+keys.map((_,i)=>'$'+(i+1)).join(',')+') as result';return (await tx.query(sql,keys.map(k=>typeof body[k]==='object'?JSON.stringify(body[k]):body[k]))).rows[0].result;});return send(200,result);}catch(error){return send(400,{message:error.message,code:error.code});}
  }
  if(url.pathname.startsWith('/api/')){await handleApi(req,res,env);return;}
  const target=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname==='/agendar'?'/agendar.html':url.pathname));if(!target.startsWith(root+path.sep))return send(403,{});
  const data=await readFile(target);res.setHeader('Content-Type',target.endsWith('.mjs')?'text/javascript; charset=utf-8':target.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(data);
 }catch(error){res.writeHead(500);res.end('Fixture error');}});
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));console.log('UI fixture pronta: '+base+' · login fictício admin@example.invalid / qualquer senha de teste com 12 caracteres.');
}

