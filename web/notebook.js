/* Each reply gets exactly one immutable, session-isolated notebook event.
   Full notebook is rendered from independently stored events (not from model-provided HTML).
   A model may help phrase the new event, but cannot replace prior entries or chapters. */
const Notebook=(()=>{
const prompt=`你回复时应严格执行以下指令：
1. 生成名为记事本的折叠栏，记录 user 真正发生过的事件。
2. 所有事件叠加记录，每轮只新增一条，旧记录禁止删改、遗漏与编造。
3. 记事本永远放在状态栏之后。每一卷独立折叠，每卷固定十条。
4. 只有一卷满十条后才生成卷首总结（100至200字），总结必须来自该卷十条事实。
5. 每一条独占一行，使用数字序号，原样保留旧十条，之后开启下一卷。
6. 折叠栏使用以下格式，章节分别作为内部折叠栏：
<p>
<details>
<summary>记事本</summary>
<details><summary>第一卷：卷名</summary>
本卷总结（满十条后生成）
1. 你来到这个世界。
</details>
</details>
</p>
7. 不要把用户没有实际说过或发生过的事情当作事实。`; // editable; application owns the HTML rendering
const shortEventPrompt='请从本轮用户消息和 AI 回复中提取一条有证据支持的 user 相关事件，准确、简洁、第三人称或第二人称，不得编造或推测。只输出一条事件的正文，不得输出数字序号、HTML、折叠栏、总结或其他解释。';
const summaryPrompt='只依据本卷以下十条已存档事件，生成100至200字的卷首总结。叙述准确，按时间顺序，不添加未记录的情节、人物或心理活动；不修改任何事件。只输出总结文字。';
const volNames=['零','一','二','三','四','五','六','七','八','九','十'];
function chapterName(n){const tens=Math.floor(n/10),ones=n%10;if(n<=10)return volNames[n];if(n<20)return '十'+(ones?volNames[ones]:'');if(n<100)return volNames[tens]+'十'+(ones?volNames[ones]:'');return String(n);}
const now=()=>new Date().toISOString();
function stripMarkup(s){return String(s||'').replace(/<\/?br\s*\/?\s*>/gi,'\n').replace(/<\/?(?:p|details|summary)[^>]*>/gi,'').trim();}
async function entries(sessionId){return (await Store.inSession('notebookEntries',sessionId)).sort((a,b)=>a.index-b.index);}
async function volumes(sessionId){return (await Store.inSession('notebookVolumes',sessionId)).sort((a,b)=>a.volume-b.volume);}
function profile(conf){const merge={...conf.chat};for(const [k,v] of Object.entries(conf.summary||{}))if(v!==''&&v!=null)merge[k]=v;return merge;}
function factualFallback(text){const t=String(text||'').trim();return t?`本轮用户记录：${t}`:'本轮用户发送了附件或未提供文本事件。';}
async function extract(conf,user,assistant){const message=String(user?.content||'').trim();if(!conf.notebookAIExtract)return factualFallback(message);try{
 const sys=`${shortEventPrompt}\n【用户自定义的记事本规则】\n${conf.notebookPrompt||prompt}\n重要：本次只输出一条新增事件，不要重复旧记录。`;
 const result=await Engine.complete([{role:'system',content:sys},{role:'user',content:`本轮用户消息（必须优先作为来源）：\n${message||'[无文本，见附件]'}\n\n本轮AI回复（仅用来验证事件是否已发生，不能把未来计划写成完成）：\n${String(assistant?.content||'').slice(0,14000)}`}],profile(conf));
 const clean=stripMarkup(result).replace(/^\s*(?:[①②③④⑤⑥⑦⑧⑨⑩]|\d+[.、．）])\s*/,'').trim();
 if(!clean||clean.length>2000||/\[status:/i.test(clean))return factualFallback(message);
 return clean;
}catch(e){console.warn('记事本AI提取不可用，转为保真原文记录',e);return factualFallback(message);}}
async function chapterSummary(sessionId,volume,opts={}){
 const id=`notebook-volume:${sessionId}:${volume}`;
 const existed=await Store.get('notebookVolumes',id);
 if(existed?.status==='complete')return existed;
 const es=(await entries(sessionId)).filter(x=>x.volume===volume);
 if(es.length!==10)throw Error('必须正好十条才能生成卷总结，目前只有 '+es.length+' 条');
 const base=await Engine.settings(),session=await Store.get('sessions',sessionId);const conf={...base,notebookPrompt:session?.notebookPrompt||base.notebookPrompt};let content='',status='pending',error='';
 try{
  const block=es.map(x=>`${x.index}. ${x.text}`).join('\n');
  const sys=`${summaryPrompt}\n${conf.notebookPrompt||prompt}\n请只返回本卷总结，长度100-200个汉字，不得输出HTML、事件列表或额外解释。`;
  const complete=async(extra='')=>stripMarkup(await Engine.complete([{role:'system',content:sys+extra},{role:'user',content:block}],profile(conf)));
  content=await complete();
  const size=Array.from(content.replace(/\s/g,'')).length;
  if(size<100||size>200)content=await complete(`\n上次输出长度${size}字，不符合100-200字要求。请严格改写，完整事实优先。`);
  const newSize=Array.from(content.replace(/\s/g,'')).length;
  if(newSize<100||newSize>200){error=`模型返回 ${newSize} 字，需100-200字；待重新生成`;status='pending';content='';}
  else status='complete';
 }catch(e){error=e.message;status='pending';}
 const item={id,sessionId,volume,summary:content,status,error,createdAt:existed?.createdAt||now(),updatedAt:now(),firstIndex:es[0].index,lastIndex:es.at(-1).index,sourceIds:es.map(x=>x.sourceUserId),sourceOrdinals:es.map(x=>x.userOrdinal)};
 await Store.put('notebookVolumes',item);
 if(status==='complete')await Store.put('chunks',{id:'chunk:'+id,sessionId,ordinal:es.at(-1).assistantOrdinal,text:content,kind:'notebookVolume',timestamp:item.updatedAt,localVec:Engine.hashedVec(content)});
 return item;
}
async function recordTurn(sessionId,user,assistant){
 const base=await Engine.settings(),session=await Store.get('sessions',sessionId);const conf={...base,notebookEnabled:typeof session?.notebookEnabled==='boolean'?session.notebookEnabled:base.notebookEnabled,notebookPrompt:session?.notebookPrompt||base.notebookPrompt};if(!conf.notebookEnabled)return {skipped:true};
 if(!user||!assistant||user.role!=='user'||assistant.role!=='assistant')return {skipped:true};
 const id=`notebook-event:${assistant.id}`;const old=await Store.get('notebookEntries',id);if(old)return {entry:old,duplicate:true};
 const es=await entries(sessionId),index=es.length+1,volume=Math.ceil(index/10);
 const text=await extract(conf,user,assistant);
 // A persisted entry is immutable: future model output can never overwrite it.
 const entry={id,sessionId,index,volume,text,createdAt:now(),sourceUserId:user.id,sourceAssistantId:assistant.id,userOrdinal:user.ordinal,assistantOrdinal:assistant.ordinal,sourceText:String(user.content||''),mode:conf.notebookAIExtract&&!text.startsWith('本轮用户记录：')?'model':'verbatim'};
 await Store.put('notebookEntries',entry);
 await Store.put('chunks',{id:'chunk:'+id,sessionId,ordinal:user.ordinal,text:entry.text,kind:'notebookEvent',messageId:user.id,timestamp:entry.createdAt,localVec:Engine.hashedVec(entry.text)});
 let chapter=null;if(index%10===0)chapter=await chapterSummary(sessionId,volume);
 return {entry,chapter};
}
async function snapshot(sessionId,lastAssistantOrdinal=Infinity){const es=(await entries(sessionId)).filter(x=>x.assistantOrdinal<=lastAssistantOrdinal);const vs=(await volumes(sessionId)).filter(x=>x.lastIndex<=es.length);return {entries:es,volumes:vs};}
async function exportHTML(sessionId,assistantOrdinal=Infinity){const {entries:es,volumes:vs}=await snapshot(sessionId,assistantOrdinal);const escape=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');let str='<p>\n<details>\n<summary>记事本</summary>\n';for(let v=1;v<=Math.ceil(es.length/10);v++){
 const group=es.filter(x=>x.volume===v),saved=vs.find(x=>x.volume===v);str+=`<details>\n<summary>第${chapterName(v)}卷：${group.length}/10条</summary>\n`;
 if(saved?.status==='complete')str+=`本卷总结：${escape(saved.summary)}<br>\n`;else str+='本卷总结：'+(group.length===10?'等待总结模型生成':'本卷尚未满10条')+'<br>\n';
 for(const x of group)str+=`${x.index}. ${escape(x.text).replace(/\n/g,'<br>')}<br>\n`;
 str+='</details>\n';}return str+'</details>\n</p>';
}
return {prompt,shortEventPrompt,summaryPrompt,chapterName,entries,volumes,recordTurn,chapterSummary,snapshot,exportHTML};})();
