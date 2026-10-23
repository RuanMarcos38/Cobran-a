import test from 'node:test';
import assert from 'node:assert/strict';
import {prospectMarkup} from '../web/prospection.mjs';
test('commercial dashboard escapes untrusted sheet and mail content',()=>{
 const html=prospectMarkup({summary:{total:1},rows:[{id:'safe',company:'<script>alert(1)</script>',email:'x@example.invalid',status:'reported',source:{segmento:'<img src=x onerror=alert(1)>'}}]});
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.match(html,/&lt;script&gt;/);assert.match(html,/registro da planilha/);assert.match(html,/servidor aceitou/);
});
test('approval and configuration controls respect capabilities',()=>{
 const lead={id:'a',status:'pending',source:{},company:'Teste'};
 assert.ok(!prospectMarkup({rows:[lead]}).includes('data-prospect-approve='));
 assert.ok(prospectMarkup({manager:true,rows:[lead]}).includes('data-prospect-approve='));
 assert.ok(!prospectMarkup({manager:true,rows:[lead]}).includes('data-prospect-action="configure"'));
 assert.ok(prospectMarkup({admin:true,rows:[]}).includes('data-prospect-action="configure"'));
});
