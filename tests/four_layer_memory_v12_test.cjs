const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');
const tables={sessions:new Map(),messages:new Map(),summaries:new Map(),statusCards:new Map(),chunks:new Map(),vectors:new Map(),settings:new Map(),assets:new Map()};
const Store={
 get:async(t,k)=>tables[t].get(k),all:async t=>[...tables[t].values()],
 put:async(t,x)=>tables[t].set(x.id||x.key,x),
 del:async(t,k)=>tables[t].delete(k),
 inSession:async(t,id)=>[...tables[t].values()].filter(x=>x.sessionId===id),
 orderedMessages:async id=>[...tables.messages.values()].filter(x=>x.sessionId===id).sort((a,b)=>a.ordinal-b.ordinal),
 putMany:async(t,arr)=>arr.forEach(x=>tables[t].set(x.id,x)),
 getSetting:async(k,f)=>tables.settings.get(k)?.value??f,setSetting:async(k,v)=>tables.settings.set(k,{key:k,value:v})
};
const ctx={Store,window:{},console,Date,Math,JSON,Promise,Uint8Array,Float32Array,Blob,setTimeout,clearTimeout,globalThis:null,crypto:require('crypto').webcrypto};ctx.globalThis=ctx;
let embedRequests=0;
ctx.fetch=async(url,opts)=>{if(url.endsWith('/embeddings')){embedRequests++;return {ok:true,json:async()=>({data:[{index:0,embedding:[1,0,0]}]})}}throw Error('unexpected external API '+url);};
vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'../web/engine.js'),'utf8')+';globalThis.Engine=Engine;',ctx);
const E=ctx.Engine;
(async()=>{
const session='local-book',other='foreign-story';
await Store.put('sessions',{id:session,name:'古代书院',messageCount:350});
await Store.put('sessions',{id:other,name:'古代书院',messageCount:8});
for(let i=1;i<=350;i++){
 let content=`第${i}条，聊日常生活。`;
 if(i===2)content='先生邀请大家去山间的书院，约定明日再见。';
 if(i===3)content='到达竹林门口，书生们正在点灯，师兄拿了卷轴。';
 if(i===4)content='书院里发生了重要事件：阿澈和阿轻订下两年后的约定。';
 if(i===5)content='师兄见证了约定，还把它写进册子。';
 if(i===6)content='当天傍晚，大家离开竹林回府。';
 if(i===150)content='再次来书院讲述旧日约定，不过没有改变最初的内容。';
 if(i===200)content='你还记得书院吗？';
 if(i===350)content='你还记得书院那次约定吗？';
 const m={id:'book-'+i,sessionId:session,role:i===350?'user':i%2?'user':'assistant',content,ordinal:i,timestamp:`2026-10-${String(Math.min(28,1+Math.floor(i/18))).padStart(2,'0')}T12:00:00Z`};
 await Store.put('messages',m);const c=E.chunkFor(m);await Store.put('chunks',c);
}
const unrelated={id:'foreign-4',sessionId:other,role:'user',ordinal:4,content:'书院里有人在烧书。'};
await Store.put('messages',unrelated);await Store.put('chunks',E.chunkFor(unrelated));
for(let from=1;from<=350;from+=50)await Store.put('summaries',{id:'sum-'+from,sessionId:session,startOrdinal:from,endOrdinal:from+49,content:from===1?'关于书院最初的约定：阿澈和阿轻两年后见面。':'阶段总结 '+from,createdAt:'2026-10-01T00:00:00Z'});
let settings=await E.settings();settings.contextCount=100;settings.recallCount=8;settings.keywordPriority=true;settings.eventLinking=true;settings.timelineRetrieval=true;settings.eventWindow=2;settings.embedding={enabled:false,url:'',model:''};await E.saveSettings(settings);
const hits=await E.search('书院',session,8);
assert(hits.some(x=>x.ordinal===4&&x.kind==='message'),'第 4 条精确匹配应返回');
assert(hits[0].matchTier>0,'应优先精确词汇');
const first=hits.find(x=>x.ordinal===4);assert(first.related.some(x=>x.ordinal===3),'第 3 条前文关联');assert(first.related.some(x=>x.ordinal===5),'第 5 条后文关联');
assert(!hits.some(x=>x.sessionId===other),'默认不跨会话');
const question=await E.search('你还记得书院那次约定吗？',session,8,{beforeOrdinal:251});
assert(question.some(x=>x.ordinal===4),'口语问句也找到旧事件');
assert(question.every(x=>x.kind==='summary'||x.ordinal<251),'不召回已经包含的最近消息');
const prompt=await E.assembleContext(session);
assert.equal(prompt.contextSent,100,'最近消息仍限制 100 条');
assert(prompt.messages[0].content.includes('第4条'),'能向模型提供第 4 条原文');
assert(prompt.messages[0].content.includes('第3条')&&prompt.messages[0].content.includes('第5条'),'能携带历史事件的前后消息');
assert(prompt.messages[0].content.includes('历史总结 第1—50条'),'可关联覆盖该事件的早期总结');
assert(prompt.messages[0].content.indexOf('第3条')<prompt.messages[0].content.indexOf('第4条'),'事件按时间线排列');
assert(!prompt.results.some(x=>x.kind==='message'&&x.ordinal>=251),'第 350 条时，100 条上下文内的消息不算旧记忆');
// Real vector rankings cannot demote an exact match below a semantic-only match.
settings=await E.settings();settings.embedding={enabled:true,url:'https://api.siliconflow.cn/v1',key:'test-private',model:'BAAI/bge-m3',batchSize:12};await E.saveSettings(settings);
await Store.put('vectors',{id:'chunk:book-4|https://api.siliconflow.cn/v1|BAAI/bge-m3',chunkId:'chunk:book-4',modelKey:'https://api.siliconflow.cn/v1|BAAI/bge-m3',vec:[0.2,0.98,0]});
await Store.put('vectors',{id:'chunk:book-25|https://api.siliconflow.cn/v1|BAAI/bge-m3',chunkId:'chunk:book-25',modelKey:'https://api.siliconflow.cn/v1|BAAI/bge-m3',vec:[1,0,0]});
const withEmbedding=await E.search('书院',session,8);
assert(embedRequests>0,'向量接口应正常查询');
assert(withEmbedding.some(x=>x.ordinal===4),'即使语义相似度低，精确命中第 4 条仍保留');
// Disable event linking per session and verify settings override global.
const s=await Store.get('sessions',session);s.memory={eventLinking:false};await Store.put('sessions',s);
const notLinked=await E.search('书院',session,8);assert(!notLinked.find(x=>x.ordinal===4).related,'会话单独关闭事件关联生效');
console.log('PASS four-layer recall: #4 after 350 messages, 100-window cap, keyword priority, neighboring event, early summary, timeline, session isolation, SiliconFlow vector, per-session settings');
})().catch(e=>{console.error(e);process.exitCode=1});
