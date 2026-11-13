const fs=require('fs'),vm=require('vm'),assert=require('assert');
const tables=Object.fromEntries(['settings','sessions','messages','chunks','vectors','statusCards'].map(t=>[t,new Map()]));
const calls=[];
const store={
 getSetting:async(k,def)=>tables.settings.get(k)?.value??def,
 setSetting:async(k,value)=>{tables.settings.set(k,{key:k,value})},
 get:async(t,k)=>tables[t].get(k),
 put:async(t,obj)=>tables[t].set(obj.id,obj),
 del:async(t,k)=>tables[t].delete(k),
 all:async(t)=>[...tables[t].values()],
 inSession:async(t,id)=>[...tables[t].values()].filter(x=>x.sessionId===id),
 orderedMessages:async(id)=>[...tables.messages.values()].filter(x=>x.sessionId===id).sort((a,b)=>a.ordinal-b.ordinal),
 putMany:async(t,rows)=>rows.forEach(x=>tables[t].set(x.id,x))
};
const ctx={Store:store,console,globalThis:{},crypto:{randomUUID:()=>String(Math.random())},Notebook:{prompt:'memo'},setTimeout,clearTimeout,Date,URL,window:{NativeBridge:{
 request(id,url,method,headers,body){calls.push({url,method,headers,body});let payload;const isModel=url.endsWith('/models'),isTags=url.endsWith('/api/tags'),isEmbed=url.endsWith('/embeddings');if(isModel)payload={data:[{id:'qwen3:8b'},{id:'nomic-embed-text'}]};else if(isTags)payload={models:[{name:'qwen3:8b'}]};else if(isEmbed)payload={data:[{index:0,embedding:[.5,.5]}]};else payload={choices:[{message:{content:'连接成功'}}]};ctx.window.__nativeResponse(id,200,JSON.stringify(payload),'');},
 requestStream(id,url,headers,body){calls.push({url,method:'POST-stream',headers,body});setTimeout(()=>{ctx.window.__nativeStreamChunk(id,'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n');ctx.window.__nativeStreamChunk(id,'data: {"choices":[{"delta":{"content":"，世界"}}]}\n\n');ctx.window.__nativeStreamEnd(id,200,'');},0)}
}}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(__dirname+'/../app/src/main/assets/engine.js','utf8'),ctx);const engine=vm.runInContext('Engine',ctx);
(async()=>{
 assert.equal(engine.endpoint('http://127.0.0.1:11434','models'),'http://127.0.0.1:11434/v1/models');
 assert.equal(engine.endpoint('http://127.0.0.1:11434/v1/chat/completions','models'),'http://127.0.0.1:11434/v1/models');
 assert.equal(engine.endpoint('http://127.0.0.1:11434','api/tags'),'http://127.0.0.1:11434/api/tags');
 const conf={type:'chat',url:'http://127.0.0.1:11434/v1',model:'qwen3:8b',key:''};
 const list=await engine.listModels(conf);assert.equal(list.length,2);assert.equal(calls.at(-1).method,'GET');
 const test=await engine.testModel(conf);assert.match(test.result,/连接成功/);assert.equal(calls.at(-1).method,'POST');
 const emb=await engine.testModel({...conf,type:'embedding',model:'nomic-embed-text'});assert.match(emb.result,/维度 2/);
 const body=engine.makeChatBody({...conf,temperature:.45,topP:.91,maxTokens:560,thinkingEnabled:false},[{role:'user',content:'hi'}]);
 assert.equal(body.top_p,.91);assert.equal(body.max_tokens,560);assert.equal(body.think,false);
 const cfg=await engine.settings();await engine.saveSettings({...cfg,chat:{...cfg.chat,...conf,stream:true}});
 let streamPart='';const answer=await engine.complete([{role:'user',content:'hello'}],{...conf,stream:true},x=>streamPart=x);
 assert.equal(answer,'你好，世界');assert.equal(streamPart,'你好，世界');
 await store.put('sessions',{id:'s1',name:'session',messageCount:1});
 await store.put('messages',{id:'m1',sessionId:'s1',ordinal:1,role:'user',content:'旧内容',timestamp:'2026-11-04T00:00:00Z'});
 await store.put('chunks',{id:'chunk:m1',sessionId:'s1',messageId:'m1',kind:'message',ordinal:1,text:'旧内容'});
 await store.put('vectors',{id:'chunk:m1|vec1',chunkId:'chunk:m1',vec:[1,0]});
 await engine.editMessage('m1','编辑后内容');assert.equal((await store.get('messages','m1')).content,'编辑后内容');assert.equal((await store.get('vectors','chunk:m1|vec1')),undefined);
 await store.put('statusCards',{id:'c1',messageId:'m1',sessionId:'s1',title:'状态栏'});
 await engine.deleteMessage('m1');assert.equal(await store.get('messages','m1'),undefined);assert.equal(await store.get('statusCards','c1'),undefined);
 console.log('PASS: native GET models, chat/embedding test, stream, top_p/think controls, message edit/delete/index invalidation');
})().catch(e=>{console.error(e);process.exit(1)});
