const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),path=require('path');
const root=path.resolve(__dirname,'../web');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const engine=fs.readFileSync(path.join(root,'engine.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'styles.css'),'utf8');
function extractBetween(src,start,end){const a=src.indexOf(start),b=src.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,`${start} -> ${end}`);return src.slice(a,b);}
const sortSrc=extractBetween(app,'function dateMillis(', 'async function refreshSessions()');
const box=vm.createContext({Date,Number,String,Math,Intl});
vm.runInContext(sortSrc,box);
const sessions=[
 {id:'importLate',source:'chatbox',name:'最后导入但内容较早',createdAt:'2026-10-01',updatedAt:'2026-11-07',lastMessageAt:'2026-05-01'},
 {id:'newer',source:'rikka',name:'晚些消息',createdAt:'2026-10-01',updatedAt:'2026-11-01',lastMessageAt:'2026-10-12'},
 {id:'pinnedOld',source:'chatbox',name:'置顶较早',createdAt:'2026-08-01',updatedAt:'2026-10-01',lastMessageAt:'2026-04-15',pinned:true,pinnedAt:'2026-11-05'},
 {id:'pinnedNew',source:'chatbox',name:'最近置顶',createdAt:'2026-10-01',updatedAt:'2026-10-01',lastMessageAt:'2026-03-15',pinned:true,pinnedAt:'2026-11-06'}
];
sessions.sort((a,b)=>box.compareSessions(a,b));
assert.equal(sessions.map(x=>x.id).join(','),'pinnedNew,pinnedOld,newer,importLate');
assert.equal(box.dateMillis('2026-10-01T00:00:00Z'),Date.parse('2026-10-01T00:00:00Z'));
const profiles=[{id:'s1',name:'A',type:'chat',url:'http://localhost:11434/v1',key:'',model:'a'},{id:'s2',name:'B',type:'chat',url:'https://example.com/v1',key:'key',model:'b'},{id:'e1',type:'embedding',model:'embed'}];
const chatFn=extractBetween(engine,'function chatProfileForSession(', 'async function reply(');
const ctx=vm.createContext({Object});vm.runInContext(chatFn,ctx);
const settings={modelProfiles:profiles,chat:{url:'http://localhost:11434/v1',model:'a'},generation:{temperature:.7,maxTokens:2048}};
const one=ctx.chatProfileForSession(settings,{id:'one',chatModelId:'s2',generation:{maxTokens:3000}});
const other=ctx.chatProfileForSession(settings,{id:'two'});
assert.equal(one.model,'b');assert.equal(one.url,'https://example.com/v1');assert.equal(one.maxTokens,3000);
assert.equal(other.model,'a');assert.equal(settings.chat.model,'a','global model untouched');
assert.ok(app.includes('id="chatModelSwitch"'));
assert.ok(app.includes("getElementById('avatar-picker')")); // index owns hidden picker
assert.ok(html.includes('id="avatar-picker"'));
assert.ok(!app.includes("case 'choose-avatar'")); // action is pick-avatar
assert.ok(app.includes("case 'pick-avatar'"));
assert.ok(app.includes('data-action="toggle-pin"'));
assert.ok(app.includes('session?.userAvatarData||config.userAvatarData'));
assert.ok(app.includes('data-action="backfill-summary"')&&app.includes('data-action="repair-old-summaries"'));
assert.ok(app.includes('生成新总结（未归档导入记录）'));
assert.ok(css.includes('.minimal-compose')&&css.includes('.chat-model-switch')&&css.includes('.role-identity'));
for(const name of ['app.js','engine.js','index.html','styles.css']){
 assert.equal(fs.readFileSync(path.join(root,name),'utf8'),fs.readFileSync(path.join(__dirname,'../app/src/main/assets',name),'utf8'),`${name} web/APK assets mismatch`);
}
console.log('PASS v2.1: pinned/time order, independent chat model switch, persistent local user/role portraits, minimal composer, both summary modes');
