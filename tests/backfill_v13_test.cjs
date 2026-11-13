const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const tables=Object.fromEntries(['sessions','messages','summaries','statusCards','chunks','vectors','settings','assets'].map(x=>[x,new Map()]));
const Store={get:async(t,k)=>tables[t].get(k),put:async(t,x)=>tables[t].set(x.id||x.key,x),all:async t=>[...tables[t].values()],inSession:async(t,id)=>[...tables[t].values()].filter(x=>x.sessionId===id),orderedMessages:async id=>[...tables.messages.values()].filter(x=>x.sessionId===id).sort((a,b)=>a.ordinal-b.ordinal),getSetting:async(k,d)=>tables.settings.get(k)?.value??d,setSetting:async(k,v)=>tables.settings.set(k,{key:k,value:v})};
const ctx={Store,window:{},console,Date,Math,JSON,Promise,Uint8Array,Float32Array,Blob,setTimeout,clearTimeout,globalThis:null,crypto:require('crypto').webcrypto};ctx.globalThis=ctx;
vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'../web/engine.js'),'utf8')+';globalThis.Engine=Engine;',ctx);
(async()=>{
const E=ctx.Engine;await Store.put('sessions',{id:'s',memory:{summaryEvery:3}});
for(let i=1;i<=11;i++)await Store.put('messages',{id:'m'+i,sessionId:'s',role:i%2?'user':'assistant',ordinal:i,content:'测试'+i});
await Store.put('summaries',{id:'old',sessionId:'s',startOrdinal:4,endOrdinal:6,content:'已完成的原总结'});
let p=await E.backfillPlan('s');assert.equal(p.remaining,8);assert.equal(p.firstOrdinal,1);assert.equal(p.lastOrdinal,3);
await Store.put('summaries',{id:'part1',sessionId:'s',startOrdinal:1,endOrdinal:3,sourceIds:['m1','m2','m3'],content:'不覆盖'});
p=await E.backfillPlan('s');assert.equal(p.remaining,5);assert.equal(p.firstOrdinal,7);assert.equal(p.lastOrdinal,11);
await Store.put('summaries',{id:'part2',sessionId:'s',startOrdinal:7,endOrdinal:9,content:'不覆盖'});
p=await E.backfillPlan('s');assert.equal(p.remaining,2);assert.equal(p.firstOrdinal,10);assert.equal(p.lastOrdinal,11);
assert.equal(p.segment.length,2);assert.equal(tables.summaries.get('old').content,'已完成的原总结');
const app=fs.readFileSync(require('path').join(__dirname,'../web/app.js'),'utf8');assert(app.includes('data-action="backfill-summary"'));assert(app.includes('Engine.summarize(targetSession,true,{backfill:true,...size,onProgress:'));assert(app.includes('backfillStatus'));
console.log('PASS: backfill detects early gaps, middle gaps, trailing < batch, preserves archive and reports UI status');
})().catch(e=>{console.error(e);process.exitCode=1});
