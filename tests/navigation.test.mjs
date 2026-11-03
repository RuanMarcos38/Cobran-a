import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {navigation,navigationGroups,navigationLocation,routeHash,parseRoute} from '../web/navigation.mjs';
const source=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
const exportedArray=(file,name)=>vm.runInNewContext(readFileSync(new URL('../web/'+file,import.meta.url),'utf8').match(new RegExp('export const '+name+'=(\\[[^;]+\\]);'))[1]);
const financeSections=exportedArray('finance.mjs','financeSections'),pricingSections=exportedArray('pricing.mjs','pricingSections');
const modules=vm.runInNewContext('('+source.match(/const modules=([^;]+);/)[1]+')',{financeSections,pricingSections});
const permission=source.slice(source.indexOf('function visibleSections('),source.indexOf('\nconst tabs='));
const key=(m,s)=>m+'|'+s;
test('every existing route is represented once, including retained aliases',()=>{
 const represented=navigation.flatMap(g=>g.items.flatMap(i=>[[i.module,i.section],...i.aliases]));
 assert.equal(new Set(represented.map(([m,s])=>key(m,s))).size,represented.length);
 assert.deepEqual(represented.map(([m,s])=>key(m,s)).sort(),Object.entries(modules).flatMap(([m,sections])=>sections.map(s=>key(m,s))).sort());
 for(const [m,s] of represented){assert.ok(modules[m].includes(s));assert.ok(navigationLocation(m,s).label);}
 assert.equal(navigationGroups(()=>true).length,7);
});
test('new navigation preserves the existing role and client permission matrix',()=>{
 for(const role of ['admin','master','supervisor','collector','finance','creditor','commercial','commercial_manager'])for(const enabled of [true,false]){
  const profile={role,can_manage_users:enabled,client_access:{processes:enabled,history:enabled,documents:enabled,receipts:enabled,reports:enabled,export:enabled}};
  const context={state:{profile},modules,financeSections,pricingSections,canManageUsers:()=>['admin','master'].includes(role)||(role==='supervisor'&&enabled),clientAllowed:k=>role!=='creditor'||profile.client_access[k]===true};
  vm.createContext(context);vm.runInContext(permission,context);
  const allowed=(m,s)=>context.visibleSections(m).includes(s),groups=navigationGroups(allowed);
  for(const g of groups){assert.ok(g.items.length);for(const i of g.items)assert.equal(allowed(i.module,i.section),true,role+': '+key(i.module,i.section));}
  for(const g of navigation)for(const i of g.items){const candidates=[[i.module,i.section],...i.aliases];assert.equal(groups.some(x=>x.items.some(y=>y.label===i.label)),candidates.some(([m,s])=>allowed(m,s)),role+': '+i.label);}
 }
});
test('deep links retain legacy routes, accents and malformed URL safety',()=>{
 for(const g of navigation)for(const i of g.items)for(const [module,section] of [[i.module,i.section],...i.aliases])assert.deepEqual(parseRoute(routeHash(module,section)),{module,section});
 for(const hash of ['', '#/', '#/%ZZ/test','#/one/two/three'])assert.equal(parseRoute(hash),null);
 assert.equal(navigationLocation('Processo','Processo').label,navigationLocation('Processo','Cobrança').label);
});
