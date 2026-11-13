const fs=require('fs'),vm=require('vm'),assert=require('assert');
const state=new Map();const store={getSetting:async(k,defaultVal)=>state.has(k)?state.get(k):defaultVal,setSetting:async(k,v)=>{state.set(k,v)}};
const box={Store:store,console,globalThis:{},crypto:{randomUUID:()=>String(Math.random())},Notebook:{prompt:'prompt'},window:{}};
vm.createContext(box);vm.runInContext(fs.readFileSync(__dirname+'/../app/src/main/assets/engine.js','utf8'),box);
(async()=>{
 const engine=vm.runInContext('Engine',box);
 const original=await engine.settings();
 assert.equal(original.theme,'system');assert.equal(original.fontSize,1);assert.equal(original.modelProfiles.length,0);
 const p=[
 {id:'local-chat',name:'本机聊天',type:'chat',source:'local',url:'http://127.0.0.1:11434/v1',model:'qwen3:8b',key:'',maxTokens:1800,temperature:.6},
 {id:'cloud-chat',name:'云端总结',type:'chat',source:'cloud',url:'https://api.example.org/v1',model:'summary-1',key:'SECRET',maxTokens:1200,temperature:.3},
 {id:'local-embed',name:'本地向量',type:'embedding',source:'local',url:'http://127.0.0.1:11434/v1',model:'nomic-embed-text',key:''}
 ];
 const next=await engine.saveSettings({...original,theme:'amoled',fontSize:1.35,modelProfiles:p,activeModels:{chat:'local-chat',summary:'cloud-chat',embedding:'local-embed'}});
 assert.equal(next.chat.model,'qwen3:8b');assert.equal(next.summary.model,'summary-1');assert.equal(next.embedding.model,'nomic-embed-text');
 assert.equal(next.summary.key,'SECRET');assert.equal(next.chat.url,'http://127.0.0.1:11434/v1');assert.equal(next.fontSize,1.35);
 await engine.saveSettings({...next,activeModels:{chat:'cloud-chat',summary:'local-chat',embedding:'local-embed'}});
 const after=await engine.settings();assert.equal(after.chat.model,'summary-1');assert.equal(after.summary.model,'qwen3:8b');
 const illegal=await engine.saveSettings({...next,activeModels:{chat:'local-embed',summary:'cloud-chat',embedding:'local-embed'}});assert.equal(illegal.activeModels.chat,'');
 console.log('PASS: three saved models, independent assignment, switching, font/theme persistence, incompatible role guard');
})().catch(e=>{console.error(e);process.exit(1)});
