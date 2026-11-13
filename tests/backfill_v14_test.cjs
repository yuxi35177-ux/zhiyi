const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const tables=Object.fromEntries(['sessions','messages','summaries','statusCards','chunks','vectors','settings','assets'].map(x=>[x,new Map()]));
const Store={get:async(t,k)=>tables[t].get(k),put:async(t,x)=>tables[t].set(x.id||x.key,x),all:async t=>[...tables[t].values()],inSession:async(t,id)=>[...tables[t].values()].filter(x=>x.sessionId===id),orderedMessages:async id=>[...tables.messages.values()].filter(x=>x.sessionId===id).sort((a,b)=>a.ordinal-b.ordinal),getSetting:async(k,d)=>tables.settings.get(k)?.value??d,setSetting:async(k,v)=>tables.settings.set(k,{key:k,value:v})};
let attempts=0,limit=1000;
const window={};
window.NativeBridge={request(id,url,method,headers,payload){
  attempts++;
  const parsed=JSON.parse(payload);
  const data=parsed.messages[1].content;
  // Mock a local proxy which rejects large prompts with an upstream 502.
  if(data.length>limit)window.__nativeResponse(id,502,JSON.stringify({error:{message:'AI Studio unexpected EOF',code:'upstream_error'}}),null);
  else window.__nativeResponse(id,200,JSON.stringify({choices:[{message:{content:'已归档原文摘要：历史细节完整归档。<<ZHIYI_ARCHIVE_DONE_V19>>'}}]}),null);
}};
const ctx={Store,window,console,Date,Math,JSON,Promise,Uint8Array,Float32Array,Blob,setTimeout,clearTimeout,globalThis:null,crypto:require('crypto').webcrypto};ctx.globalThis=ctx;
vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'../web/engine.js'),'utf8')+';globalThis.Engine=Engine;',ctx);
(async()=>{
 const E=ctx.Engine;const sid='s';await Store.put('sessions',{id:sid,memory:{summaryEvery:50}});
 for(let i=1;i<=23;i++)await Store.put('messages',{id:'m'+i,sessionId:sid,role:i%2?'user':'assistant',ordinal:i,content:'书院往事与细节：'+('春天在书院发生的事件；').repeat(85)});
 const standard=await E.backfillPlan(sid);assert.equal(standard.segment.length,20);
 const small=await E.backfillPlan(sid,{maxMessages:8,maxSourceChars:6000});assert.ok(small.segment.length<=8 && small.segment.length>0);
 const config=await E.settings(); await E.saveSettings({...config,chat:{...config.chat,url:'http://127.0.0.1:2048/v1',model:'gemini-proxy'},summary:{url:'http://127.0.0.1:2048/v1',model:'gemini-proxy',maxTokens:204800}});
 let result;let firstFails=false;
 try{await E.summarize(sid,true,{backfill:true,maxMessages:8,maxSourceChars:6000,maxBlockChars:4500});}catch(e){firstFails=/502/.test(e.message)}
 assert.ok(firstFails,'Proxy should reject large initial summary prompt');
 assert.equal((await E.backfillPlan(sid)).covered,0,'Failed summaries are not marked covered');
 limit=3500;
 result=await E.summarize(sid,true,{backfill:true,maxMessages:2,maxSourceChars:2000,maxBlockChars:1700});
 assert.ok(result.summary,'Small batch should succeed');
 assert.ok(result.summary.sourceIds.length>=1);
 assert.equal(tables.summaries.size,1);
 const saved=tables.summaries.values().next().value;
 const next=await E.backfillPlan(sid,{maxMessages:2,maxSourceChars:2000});assert.ok(next.firstOrdinal>saved.endOrdinal);
 while((await E.backfillPlan(sid)).remaining){await E.summarize(sid,true,{backfill:true,maxMessages:2,maxSourceChars:2000,maxBlockChars:1700});}
 const plan=await E.backfillPlan(sid);assert.equal(plan.covered,23);assert.equal(plan.remaining,0);
 assert.equal((await Store.get('summaries',saved.id)).content,saved.content,'Old summary immutable');
 const app=fs.readFileSync(require('path').join(__dirname,'../web/app.js'),'utf8');
 assert.ok(app.includes('test-summary-model')&&app.includes('isTransientSummaryError')&&app.includes('archive-progress')===false);
 assert.ok(app.includes('backlog.covered/Math.max(1,backlog.total)')&&app.includes('profiles=[4800,2800,1600,950]'));
 assert.ok(attempts>3,'Simulated upstream requests occurred');
 console.log('PASS v1.4: 502 triggers small-batch fallbacks, correct progress, per-segment persistence, safe resume, no overwritten summaries');
})().catch(e=>{console.error(e);process.exitCode=1});
