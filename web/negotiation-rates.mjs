// Only the latest manual edit may update the proposal displayed to the user.
export function createRateRecalculation({load,apply,pending,failed,schedule=setTimeout,cancel=clearTimeout,delay=350}){
 let generation=0,timer,stopped=false;
 const invalidate=()=>{cancel(timer);generation++;if(!stopped)pending(true);return generation;};
 async function run(ticket){
  try{const quote=await load();if(stopped||ticket!==generation)return;pending(false);apply(quote);}
  catch(error){if(stopped||ticket!==generation)return;pending(false);failed(error);}
 }
 return {
  get revision(){return generation;},
  queue(){if(stopped)return;const ticket=invalidate();timer=schedule(()=>run(ticket),delay);},
  recalculate(){if(stopped)return;return run(invalidate());},
  invalidate,
  stop(){stopped=true;generation++;cancel(timer);}
 };
}
