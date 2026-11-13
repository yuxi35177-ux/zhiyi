const fs=require('fs');
const vm=require('vm');
const assert=require('assert');
const app=fs.readFileSync(__dirname+'/../app/src/main/assets/app.js','utf8');
const extract=(start,end)=>{const a=app.indexOf(start);const b=app.indexOf(end,a);assert(a>=0&&b>a,start+' not found');return app.slice(a,b);};
const context=vm.createContext({config:{markdownEnabled:true,collapseCode:false},esc:s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))});
vm.runInContext(extract('function renderBody(content){','function tokenDisplay(m){'),context);
vm.runInContext(extract('function renderImportedStatus(card){','function msgHtml(m,'),context);
const compact=s=>vm.runInContext('compactNotebookSpacing('+JSON.stringify(s)+')',context);
const view=card=>vm.runInContext('renderImportedStatus('+JSON.stringify(card)+')',context);
const specimen='一：师父与弟子\n\n1. 【凡】示例丙\n\n① 紧急交涉\n\n② 验证身份\n\n③ 见证\n\n④ 保守秘密\n\n二：先生与学生\n\n1. 【仙】某角色';
const formatted='一：师父与弟子\n1. 【凡】示例丙\n① 紧急交涉\n② 验证身份\n③ 见证\n④ 保守秘密\n\n二：先生与学生\n1. 【仙】某角色';
assert.strictEqual(compact(specimen),formatted);
assert.strictEqual(compact('一：师父与弟子<p>1. 【凡】示例丙</p><p></p><p>① 紧急交涉</p><br><br>② 验证身份\n\n二：先生与学生'),
  '一：师父与弟子\n1. 【凡】示例丙\n① 紧急交涉\n② 验证身份\n\n二：先生与学生');
for(const title of ['当前待办事项','记事本','任务清单','备忘录']){
 const rendered=view({title,content:specimen});
 assert(rendered.includes('一：师父与弟子<br>1.'),title+' must compact list content');
 assert(rendered.includes('④ 保守秘密<br><br>二：先生与学生'),title+' must leave one blank before next main heading');
 assert(!rendered.includes('示例丙<br><br>①'),title+' must remove redundant line breaks');
}
assert(view({title:'回忆',content:'第一段文本\n\n第二段文本'}).includes('第一段文本<br><br>第二段文本'),'ordinary narrative cards should not be compacted');
const r=view({title:'当前待办事项',content:'一：甲<br>①A<br><br>②B<p></p><p>二：乙</p>③C'});
assert(r.includes('①A<br>②B<br><br>二：乙<br>③C'), 'HTML br / p import artifacts must compact');
assert(app.includes('function isImportedNotebookLike(card)'));
console.log('PASS v1.6 imported Chatbox/RikkaHub TODO/notebook spacing; HTML paragraphs; main-heading separation; narrative preservation');
