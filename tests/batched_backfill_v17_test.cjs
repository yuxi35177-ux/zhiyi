const fs=require('fs'), vm=require('vm'), assert=require('node:assert/strict');
const path=require('path');
const tables=Object.fromEntries(['sessions','messages','summaries','statusCards','chunks','vectors','settings','assets'].map(t=>[t,new Map()]));
const Store={get:async(t,k)=>tables[t].get(k),put:async(t,x)=>tables[t].set(x.id||x.key,x),all:async t=>[...tables[t].values()],inSession:async(t,id)=>[...tables[t].values()].filter(x=>x.sessionId===id),orderedMessages:async id=>[...tables.messages.values()].filter(x=>x.sessionId===id).sort((a,b)=>a.ordinal-b.ordinal),getSetting:async(k,d)=>tables.settings.get(k)?.value??d,setSetting:async(k,v)=>tables.settings.set(k,{key:k,value:v})};
let attempts=0,rejectAbove=Infinity;
const window={};window.NativeBridge={request(id,url,method,headers,payload){
  attempts++;
  const parsed=JSON.parse(payload);const text=parsed.messages[1].content;
  if(text.length>rejectAbove){window.__nativeResponse(id,502,JSON.stringify({error:{message:'AI Studio unexpected EOF',code:'upstream_error'}}),null);return;}
  window.__nativeResponse(id,200,JSON.stringify({choices:[{message:{content:'事件时间线与人物变化；档案存档成功<<ZHIYI_ARCHIVE_DONE_V19>>'}}]}),null);
}};
const ctx={Store,window,console,Date,Math,JSON,Promise,Uint8Array,Float32Array,Blob,crypto:require('crypto').webcrypto,setTimeout,clearTimeout};ctx.globalThis=ctx;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../web/engine.js'),'utf8')+';globalThis.Engine=Engine;',ctx);
(async()=>{
 const E=ctx.Engine;
 const config=await E.settings();await E.saveSettings({...config,chat:{...config.chat,url:'http://127.0.0.1:2048/v1',model:'test-proxy'},summary:{url:'http://127.0.0.1:2048/v1',model:'test-proxy',maxTokens:1200}});
 for(const batchSize of [20,50,100]){
  const sid='test-'+batchSize;await Store.put('sessions',{id:sid,memory:{backfillBatchSize:batchSize,summaryEvery:50}});
  for(let i=1;i<=223;i++)await Store.put('messages',{id:sid+':'+i,sessionId:sid,role:i%2?'user':'assistant',ordinal:i,content:'书院、人物关系和事件进展：第'+i+'条。'});
  let plan=await E.backfillPlan(sid);assert.equal(plan.segment.length,batchSize);
  let totalArchives=0,callbacks=0;
  while((plan=await E.backfillPlan(sid)).remaining>0){
   const r=await E.summarize(sid,true,{backfill:true,maxMessages:batchSize,maxBlockChars:4800,onProgress:()=>callbacks++});
   assert.ok(r.summary&&r.summary.sourceIds.length>=1&&r.summary.sourceIds.length<=batchSize);
   totalArchives++;
  }
  assert.equal(totalArchives,Math.ceil(223/batchSize));
  assert.equal((await E.backfillPlan(sid)).covered,223);
  assert.equal((await Store.inSession('summaries',sid)).length,totalArchives);
  assert.ok(callbacks>=totalArchives);
  const ids=(await Store.inSession('summaries',sid)).flatMap(s=>s.sourceIds);
  assert.equal(new Set(ids).size,223,'never merge or skip original coverage');
 }
 // Force the proxy to refuse a large chunk. On failure NO partial summaries should be committed.
 const sid='failed';await Store.put('sessions',{id:sid,memory:{backfillBatchSize:20}});
 for(let i=1;i<=20;i++)await Store.put('messages',{id:'failed-'+i,sessionId:sid,role:'user',ordinal:i,content:'长内容'.repeat(450)});
 rejectAbove=1000;
 await assert.rejects(E.summarize(sid,true,{backfill:true,maxMessages:20,maxBlockChars:4800}),/502/);
 assert.equal((await Store.inSession('summaries',sid)).length,0);
 rejectAbove=Infinity;
 const fine=await E.summarize(sid,true,{backfill:true,maxMessages:20,maxBlockChars:950});
 assert.equal(fine.summary.messageCount,20);
 assert.equal((await Store.inSession('summaries',sid)).length,1);
 const original=fine.summary.content;
 assert.equal((await E.backfillPlan(sid)).remaining,0);
 assert.equal((await Store.get('summaries',fine.summary.id)).content,original);
 const ui=fs.readFileSync(path.join(__dirname,'../web/app.js'),'utf8');
 assert.ok(ui.includes('groupedArchiveMarkers')&&ui.includes('id="backfillBatchSize"'));
 assert.ok(ui.includes('maxBlockChars}));')&&ui.includes('maxMessages:batchSize'));
 console.log('PASS v1.7: 223 messages -> 12/5/3 immutable archives at 20/50/100, gapless coverage, adaptive slicing, error atomicity, no summary overwrite. Calls:',attempts);
})().catch(e=>{console.error(e);process.exitCode=1;});
