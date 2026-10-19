import {randomBytes,createHmac} from 'node:crypto';
export const bookingOrigin='https://financeiro.rrestrategiaperformance.com.br';
export async function issueBooking(body,rpc,env,token){
 let secret;
 if(token){if(typeof body.event_id!=='string'||!body.event_id||body.event_id.length>200)throw Error('Identificador do envio obrigatório.');if(!/^[a-f0-9]{64}$/i.test(env.EMAIL_ENCRYPTION_KEY||''))throw Error('Proteção do agendamento pendente.');secret=createHmac('sha256',Buffer.from(env.EMAIL_ENCRYPTION_KEY,'hex')).update(JSON.stringify([token,body.event_id,String(body.email||'').toLowerCase()])).digest('hex');}
 else secret=randomBytes(32).toString('hex');
 const data=await rpc(token?'cobranca_booking_prospect':'cobranca_booking_manage',token?{token,payload:{...body,public_token:secret}}:{payload:{id:body.id,public_token:secret}});
 return {...data,url:bookingOrigin+'/agendar?token='+secret,booking_url:bookingOrigin+'/agendar?token='+secret};
}
