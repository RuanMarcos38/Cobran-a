const key='cobranca_theme';
let preference;
try { preference=localStorage.getItem(key); } catch {}
export function applyTheme(theme=preference || (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')) {
 document.documentElement.dataset.theme=theme;
 document.documentElement.style.colorScheme=theme;
 document.querySelectorAll('[data-theme-toggle]').forEach(button=>{button.textContent=theme==='dark'?'☀ Claro':'☾ Escuro';button.setAttribute('aria-label',theme==='dark'?'Usar tema claro':'Usar tema escuro');button.onclick=()=>{preference=document.documentElement.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem(key,preference);}catch{}applyTheme(preference);};});
}
applyTheme();
