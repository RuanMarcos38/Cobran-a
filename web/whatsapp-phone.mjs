export function validateContactPhone(value){
 const number=String(value||'').replace(/\D/g,'');
 if(!/^[1-9][0-9]{11,14}$/.test(number))throw Error('Telefone incompleto. Informe código do país, DDD e número completo.');
 return number;
}
