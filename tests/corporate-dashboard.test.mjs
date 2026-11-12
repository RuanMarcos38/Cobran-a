import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadCollectionDashboard,summarizeCollection} from '../web/collection-dashboard.mjs';
import {navigationGroups,navigationLocation,routeHash,parseRoute} from '../web/navigation.mjs';

test('menu corporativo mantém a rota permitida e aliases',()=>{
 const groups=navigationGroups((m,s)=>m==='Processo'&&s==='Consulta de Recebimentos');
 assert.deepEqual(groups.flatMap(g=>g.items).map(i=>[i.module,i.section]),[['Processo','Consulta de Recebimentos']]);
 assert.equal(navigationLocation('Processo','Consulta de Recebimentos').group,'Financeiro e Prestação de Contas');
 assert.deepEqual(parseRoute(routeHash('Relatórios','Dashboard Geral')),{module:'Relatórios',section:'Dashboard Geral'});
});

test('indicadores separam devedores por ID e calculam faixas pelo vencimento',()=>{
 const rows=[
  {id:'t1',creditor_id:'c',debtor_id:'a',current_amount:'12.34',due_date:'2026-10-01',app_status:'Em negociação'},
  {id:'t2',creditor_id:'c',debtor_id:'b',current_amount:'15.67',due_date:'2026-11-13'},
  {id:'t3',creditor_id:'c',debtor_id:'a',current_amount:'2.00',app_status:'Acordo descumprido'}
 ];
 const summary=summarizeCollection(rows,{debtor_id:'a'},'2026-11-12');
 assert.equal(summary.balance,1434);
 assert.equal(summary.overdue,1234);
 assert.equal(summary.titles,2);
 assert.equal(summary.broken,1);
 assert.equal(summary.aging.find(r=>r.label==='31–60 dias').titles,1);
 assert.equal(summary.aging.find(r=>r.label==='Sem vencimento disponível').titles,1);
});

test('consulta respeita credor e cobrador e não totaliza uma página incompleta',async()=>{
 const calls=[];
 const result=await loadCollectionDashboard({rpc:async(action,params)=>{calls.push({action,params});return {count:26,rows:[{id:'t1'}]};}},{creditor_id:'c',assigned_to:'p',debtor_id:'d'});
 assert.deepEqual(result,{changed:true});
 assert.deepEqual(calls.map(c=>c.params.page),[1,2]);
 assert.ok(calls.every(c=>c.action==='processes'&&c.params.filters.creditor_id==='c'&&c.params.filters.assigned_to==='p'));
});
