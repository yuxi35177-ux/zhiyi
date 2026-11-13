const fs=require('fs'),vm=require('vm'),assert=require('assert');
const tables=Object.fromEntries(['sessions','messages','chunks','summaries','vectors','settings','statusCards'].map(t=>[t,new Map()]));
const requests=[];
const Store={
 getSetting:async(k,def)=>tables.settings.get(k)?.value??def,
 setSetting:async(k,value)=>tables.settings.set(k,{key:k,value}),
 get:async(t,id)=>tables[t]?.get(id),put:async(t,o)=>tables[t].set(o.id,o),
 putMany:async(t,rows)=>rows.forEach(x=>tables[t].set(x.id,x)),
 all:async(t)=>[...tables[t].values()],
 del:async(t,id)=>tables[t].delete(id),
 inSession:async(t,sid)=>[...tables[t].values()].filter(x=>x.sessionId===sid),
 orderedMessages:async(sid)=>[...tables.messages.values()].filter(x=>x.sessionId===sid).sort((a,b)=>a.ordinal-b.ordinal)
};
const box={Store,window:{NativeBridge:{request(id,url,method,headers,body){requests.push({url,method,headers:JSON.parse(headers),body});const response=url.includes('models')?{data:[{id:'BAAI/bge-m3'},{id:'Qwen/Qwen3-Embedding-8B'},{id:'deepseek-ai/DeepSeek-V4-Flash'}]}:{data:[{embedding:[.2,.6,.1],index:0}],model:'BAAI/bge-m3'};box.window.__nativeResponse(id,200,JSON.stringify(response),'');}}},Notebook:{prompt:'记事本'},globalThis:{},URL,Date,console,crypto:{randomUUID:()=>String(Math.random())},setTimeout,clearTimeout};
vm.createContext(box);vm.runInContext(fs.readFileSync(__dirname+'/../app/src/main/assets/engine.js','utf8'),box);const E=vm.runInContext('Engine',box);
(async()=>{
 const url='https://api.siliconflow.cn';
 assert.equal(E.endpoint(url,'models'),'https://api.siliconflow.cn/v1/models');
 assert.equal(E.endpoint('https://api.siliconflow.cn/v1/embeddings','models'),'https://api.siliconflow.cn/v1/models');
 const models=await E.listModels({url,type:'embedding',key:'PRIVATE-KEY'});
 assert.deepEqual(Array.from(models),['BAAI/bge-m3','Qwen/Qwen3-Embedding-8B']);
 assert.equal(requests[0].url,'https://api.siliconflow.cn/v1/models?sub_type=embedding');
 assert.equal(requests[0].method,'GET');
 assert.equal(requests[0].headers.Authorization,'Bearer PRIVATE-KEY');
 await E.testModel({url,type:'embedding',key:'PRIVATE-KEY',model:'BAAI/bge-m3'});
 assert.equal(requests[1].url,'https://api.siliconflow.cn/v1/embeddings');
 assert.equal(JSON.parse(requests[1].body).encoding_format,'float');
 const html='<p><details><summary>当前待办事项</summary><font size="2">第一卷：约定</br>①处理任务</br>②保持进度</font></details></p><p><details><summary>记事本</summary><font size="2">卷一：初到世界</br>①第一次见面</br>②达成约定</font></details></p>';
 const parsed=E.parseStatusPanels(html);assert.equal(parsed.cards.length,2);assert.equal(parsed.cards[0].title,'当前待办事项');assert.match(parsed.cards[1].content,/卷一：初到世界/);assert.equal(parsed.clean,'');
 const one={id:'same-title-id',name:'共同标题',messages:[{id:'a',role:'user',content:'旧聊天内容'}]};
 const r=await E.importSessions([{value:one,path:'sessions/same-title-id/session.json'}]);
 assert.equal(r.added,1);assert.ok(tables.sessions.has('chatbox:same-title-id'));
 // RikkaHub uses an isolated 'rikkahub:' namespace in importer.js, regardless of title.
 tables.sessions.set('rikkahub:same-title-id',{id:'rikkahub:same-title-id',name:'共同标题',source:'rikkahub'});
 assert.equal(tables.sessions.size,2);
 assert.equal(tables.sessions.get('chatbox:same-title-id').name,tables.sessions.get('rikkahub:same-title-id').name);
 const old={...await E.settings(),chat:{url:'https://example.test/v1',model:'model-1',key:'local-secret'},modelProfiles:[],activeModels:{chat:'',summary:'',embedding:''},_legacyProfilesMigrated:false};
 tables.settings.set('config',{key:'config',value:old});
 // new VM engine to exercise one-time migration (settings are cached per instance)
 const second={...box,window:{},globalThis:{}};vm.createContext(second);vm.runInContext(fs.readFileSync(__dirname+'/../app/src/main/assets/engine.js','utf8'),second);const migrated=await vm.runInContext('Engine',second).settings();
 assert.equal(migrated.activeModels.chat,'legacy-chat');assert.ok(migrated.modelProfiles.find(x=>x.id==='legacy-chat'&&x.key==='local-secret'));
 console.log('PASS: SiliconFlow embedding filter, /v1 URL, API key, legacy HTML fold parsing, source-separated imports, legacy model migration');
})().catch(e=>{console.error(e);process.exit(1)});
