const target=document.querySelector('#booking-content');
const token=new URLSearchParams(location.search).get('token');
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'full',timeStyle:'short'}).format(new Date(value));
async function request(payload){const r=await fetch('/api/v1/public_booking',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,...payload})});const d=await r.json();if(!r.ok)throw Error(d.error||'Não foi possível consultar a agenda.');return d.data;}
async function render(){try{if(!/^[a-f0-9]{64}$/.test(token||''))throw Error('Link inválido. Solicite um novo link à equipe de atendimento.');const d=await request({operation:'slots'});if(d.booked){target.innerHTML=`<section class="panel"><h2>Agendamento ${d.status==='Cancelado'?'cancelado':'confirmado'}</h2><p>${esc(date(d.start))}</p><p>A equipe receberá o agendamento automaticamente. Para remarcar ou cancelar, responda ao email de atendimento.</p></section>`;return;}
 if(!d.slots.length){target.textContent='Não há horários disponíveis neste período. Responda ao email para combinar outra data.';return;}
 target.innerHTML=`<form class="panel"><label>Seu nome<input name="contact_name" required maxlength="250" autocomplete="name"></label><label>Horário da call<select name="start" required>${d.slots.map(s=>`<option value="${esc(s.start)}">${esc(date(s.start))}</option>`).join('')}</select></label><p>Ao confirmar, reservaremos este horário para a equipe conversar com você.</p><button class="primary" type="submit">Confirmar agendamento</button><p role="alert" data-booking-error></p></form>`;
 target.querySelector('form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{const values=Object.fromEntries(new FormData(e.target));await request({operation:'book',...values});await render();}catch(error){e.target.querySelector('[data-booking-error]').textContent=error.message;button.disabled=false;}};
 }catch(error){target.textContent=error.message;}}
render();
