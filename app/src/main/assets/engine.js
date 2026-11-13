/* Importer, independent chronological summary archive, local/remote vector retrieval, and OpenAI-compatible chat. */
const Engine=(()=>{
const now=()=>new Date().toISOString();const uuid=()=>globalThis.crypto?.randomUUID?.()||('id-'+Date.now()+'-'+Math.random().toString(36).slice(2));
const defaults={theme:'system',fontSize:1,modelProfiles:[],activeModels:{chat:'',summary:'',embedding:''},chat:{url:'http://127.0.0.1:11434/v1',key:'',model:'',temperature:.7,topP:1,stream:false,thinkingEnabled:true,maxTokens:2048},summary:{url:'',key:'',model:'',temperature:.2,maxTokens:1500},embedding:{enabled:false,url:'',key:'',model:'',batchSize:12},summaryEvery:50,backfillBatchSize:20,summaryNeutralMode:true,userAvatarData:'',notebookEnabled:true,notebookAIExtract:true,notebookPrompt:null,statusPanelEnabled:false,statusPanelNames:'',statusPrompt:'当用户要求生成或更新状态栏时，严格按照用户指定的名称、栏目与格式输出；不擅自增加待办事项、记事本等固定栏目。只依据当前对话及可核实的历史内容填充状态，不编造。',markdownEnabled:true,collapseCode:true,autoTitle:false,spellcheckEnabled:false,injectMeta:true,longPasteAsFile:true,contextCount:100,maxContextChars:28000,contextTokenLimit:16000,generation:{temperature:.7,topP:1,maxTokens:2048,stream:false,thinkingEnabled:true},messageLayout:'both-left',maxRecallChars:12000,recallCount:8,summaryCount:4,crossSession:false,keywordPriority:true,eventLinking:true,timelineRetrieval:true,eventWindow:2,summaryPrompt:'你是严谨的长期记忆整理器。仅依据给定原文提取真实发生的事实，不臆造。按【重大事件】【人物及关系变化】【重要约定与承诺】【世界观/角色稳定设定】【悬而未决事项】【时间顺序】六栏整理，尽可能保留细节、人名、数值、地点、情绪转折。出现冲突时写明冲突与来源，不能把猜测视为事实。',systemPrompt:'你是用户的 AI 助手。需要回忆旧事时，优先依据提供的已验证原文和历史总结回答；若没有证据，请说明不确定。切勿将摘要误当作全部原文。'};
let cfg=null;const locks=new Set();
function applyModels(next){
 const all=Array.isArray(next.modelProfiles)?next.modelProfiles:[];
 const roles={chat:'chat',summary:'chat',embedding:'embedding'};
 next.activeModels={chat:'',summary:'',embedding:'',...(next.activeModels||{})};
 for(const [role,kind] of Object.entries(roles)){
  next[role]={...defaults[role],...(next[role]||{})};
  const preset=all.find(p=>p.id===next.activeModels[role]&&p.type===kind);
  if(preset){
   next[role]={...next[role],url:preset.url,key:preset.key||'',model:preset.model};
   if(role==='embedding')next.embedding.enabled=true;
   if(kind==='chat'){
    next[role].temperature=Number(preset.temperature??next[role].temperature);
    next[role].maxTokens=Number(preset.maxTokens??next[role].maxTokens);next[role].topP=Number(preset.topP??next[role].topP??1);next[role].stream=!!(preset.stream??next[role].stream);next[role].thinkingEnabled=!!(preset.thinkingEnabled??next[role].thinkingEnabled);
   }
  } else if(next.activeModels[role]) next.activeModels[role]='';
 }
 return next;
}
async function settings(){
 if(cfg)return cfg;
 cfg={...defaults,...(await Store.getSetting('config',{}))};
 if(!cfg.notebookPrompt&&typeof Notebook!=='undefined')cfg.notebookPrompt=Notebook.prompt;
 // The old UI used three separate endpoint forms. Move already-configured endpoints
 // into independently managed profiles before removing those duplicate forms.
 if(!cfg._legacyProfilesMigrated){
   cfg.modelProfiles=Array.isArray(cfg.modelProfiles)?cfg.modelProfiles:[];
   cfg.activeModels={chat:'',summary:'',embedding:'',...(cfg.activeModels||{})};
   for(const kind of ['chat','summary','embedding']){
     const old=cfg[kind]||{};
     if(!old.url||!old.model||cfg.activeModels[kind])continue;
     const type=kind==='embedding'?'embedding':'chat';
     let candidate=cfg.modelProfiles.find(p=>p.type===type&&p.url===old.url&&p.model===old.model&&p.key===old.key);
     if(!candidate){candidate={id:'legacy-'+kind,name:kind==='embedding'?'旧版向量模型':kind==='summary'?'旧版总结模型':'旧版聊天模型',type,source:/127\.0\.0\.1|localhost|192\.168\.|10\.\d+\./.test(old.url)?'local':'cloud',url:old.url,key:old.key||'',model:old.model,maxTokens:old.maxTokens,temperature:old.temperature,topP:old.topP,stream:old.stream,thinkingEnabled:old.thinkingEnabled};cfg.modelProfiles.push(candidate);}
     cfg.activeModels[kind]=candidate.id;
   }
   cfg._legacyProfilesMigrated=true;
   await Store.setSetting('config',cfg);
 }
 return applyModels(cfg);
}
async function saveSettings(next){cfg=applyModels(next);await Store.setSetting('config',cfg);return cfg;}

function safeText(contentParts){if(typeof contentParts==='string')return contentParts;if(!Array.isArray(contentParts))return '';return contentParts.map(x=>{if(typeof x==='string')return x;if(!x||typeof x!=='object')return '';if(typeof x.text==='string')return x.text;if(x.type==='text'&&typeof x.content==='string')return x.content;if(x.type==='image')return '[图片]';if(x.type==='file')return '[文件]';return ''}).filter(Boolean).join('\n');}
function extractText(m){if(typeof m?.content==='string')return m.content;if(Array.isArray(m?.content))return m.content.map(p=>p?.text||'').join('\n');if(m?.contentParts)return safeText(m.contentParts);if(typeof m?.text==='string')return m.text;return '';} 
function validRole(role){if(['user','assistant','system','tool'].includes(role))return role;return role==='ai'?'assistant':'user';}
function sourcePin(src){
 const keys=['pinned','isPinned','is_pinned','isTop','is_top','isSticky','sticky','pin','isPin','starred'];
 for(const group of [src,src?.settings,src?.meta])for(const key of keys)if(group&&Object.prototype.hasOwnProperty.call(group,key)){
   const v=group[key];if(v===true||v===1||v==='1'||v==='true')return true;
   if(v===false||v===0||v==='0'||v==='false')return false;
 }
 return false;
}
function sourceTime(value){if(value===null||value===undefined||value==='')return null;const v=typeof value==='number'?value:/^\d{10,13}$/.test(String(value))?Number(value):Date.parse(value);return Number.isFinite(v)&&v>0?new Date(v<1e11?v*1000:v).toISOString():null;}
function toSessionShape(src,id,name){const created=sourceTime(src?.createdAt||src?.createAt||src?.create_at),updated=sourceTime(src?.updatedAt||src?.updateAt||src?.update_at);return {id,name:name||src?.name||src?.title||'导入的会话',systemPrompt:src?.systemPrompt||'',source:src?.source||'chatbox',importSourceId:src?.id||id,rawSettings:src?.settings||{},messageCount:0,createdAt:created||now(),updatedAt:updated||created||now(),pinned:sourcePin(src),pinnedAt:sourcePin(src)?(sourceTime(src?.pinnedAt||src?.pinAt)||updated||created):null,importedAt:now()};}
function rawMessageVariants(m){
 const choices=[m?.branchVariants,m?.versions,m?.alternatives,m?.branches,m?.node?.messages,m?.messageVersions].find(x=>Array.isArray(x)&&x.length>1);
 return choices?choices.map(v=>({id:v?.id||null,role:validRole(v?.role||m.role),content:extractText(v),timestamp:sourceTime(v?.createdAt||v?.timestamp)||null,reasoning:typeof v?.reasoning==='string'?v.reasoning:'',rawParts:v?.parts||v?.contentParts||null,attachments:v?.files||[]})):[];
}

function normalizeMessage(m,sessionId,n){
 const variants=rawMessageVariants(m),selected=Math.min(Math.max(0,Number(m?.selectedIndex??m?.select_index??m?.branchIndex??0)||0),Math.max(0,variants.length-1));
 const current=variants[selected];return {id:`${sessionId}:source:${m?.id||n}`,sessionId,ordinal:n+1,role:current?.role||validRole(m?.role),content:current?.content??extractText(m),timestamp:current?.timestamp||sourceTime(m?.timestamp||m?.createdAt)||now(),rawParts:current?.rawParts||m?.contentParts||null,reasoning:current?.reasoning||(m?.contentParts||[]).filter(x=>x?.type==='reasoning').map(x=>x.text||'').join('\n'),raw:{...m,contentParts:undefined},sourceId:m?.id||null,attachments:(m?.files||[]).map(f=>({name:f?.name||f?.filename||'原始附件',type:f?.type||'file',source:f})),branchVariants:variants,branchIndex:variants.length>1?selected:0,branchLinks:m?.parentId||m?.parent_id||m?.children||null};}


/* 聊天备份 exports store regenerated replies as *session-level* forks, not
   as alternatives on a message. Retain the source graph and project the
   selected tail (including its descendants) as a coherent conversation. */
function chatboxForkProject(source,selectedIndices={}){
 const forks=source?.messageForksHash||{};
 const entries=Object.entries(forks).filter(([,f])=>Array.isArray(f?.lists)&&f.lists.length>1);
 if(!entries.length)return {messages:Array.isArray(source?.messages)?source.messages:[],forkCount:0};
 const activeTails=new Map();
 const containers=[source.messages||[],...(source.threads||[]).map(t=>t.messages||[]),...entries.flatMap(([,f])=>f.lists.map(x=>x.messages||[]))];
 for(const list of containers){for(let i=0;i<list.length;i++){
  const id=String(list[i]?.id||'');if(forks[id]&&!activeTails.has(id)){
   let start=i+1;while(list[start]?.isSummary)start++;
   activeTails.set(id,list.slice(start));
  }
 }}
 function firstMessage(list){return (list||[]).find(x=>x&&!x.isSummary)||null;}
 let count=0;
 function visit(list,seen=new Set(),depth=0){
  if(depth>80||count>100000)return [];
  const out=[];
  for(let i=0;i<list.length;i++){
   const m=list[i];if(!m||typeof m!=='object')continue;
   out.push(m);count++;
   const pivot=String(m.id||'');const fork=forks[pivot];
   if(!fork||!Array.isArray(fork.lists)||fork.lists.length<2||seen.has(pivot))continue;
   const original=Math.min(fork.lists.length-1,Math.max(0,Number(fork.position)||0));
   const selected=Math.min(fork.lists.length-1,Math.max(0,Number(selectedIndices[pivot]??original)||0));
   let following=i+1;while(list[following]?.isSummary){out.push(list[following]);following++;}
   const currentTail=list.slice(following);
   const activeTail=activeTails.get(pivot)||currentTail;
   const nextTail=selected===original?activeTail:(fork.lists[selected]?.messages||[]);
   const expanded=visit(nextTail,new Set([...seen,pivot]),depth+1);
   const variants=fork.lists.map((option,j)=>{
    const first=firstMessage(j===original?activeTail:option.messages);
    return {id:first?.id||option?.id||null,role:validRole(first?.role||'assistant'),content:first?extractText(first):'（空分支）',timestamp:sourceTime(first?.timestamp||first?.createdAt)||null,reasoning:first?.reasoningContent||'',rawParts:first?.contentParts||null,attachments:first?.files||[]};
   });
   let representative=expanded.find(x=>!x.isSummary)||null;
   if(!representative){representative={id:'empty-fork:'+pivot+':'+selected,role:'assistant',content:'（此分支暂无回复）',timestamp:m.timestamp||m.createdAt,importPlaceholder:true};expanded.push(representative);}
   // Never change the source object's message; the graph is reusable on every switch.
   const idx=expanded.indexOf(representative);expanded[idx]={...representative,_chatboxFork:{pivot,selected,variants}};
   out.push(...expanded);
   return out;
  }
  return out;
 }
 return {messages:visit(source.messages||[]),forkCount:entries.length};
}
function chatboxV3ToSession(records){
 const header=records.find(r=>r?.type==='session')?.session;if(!header)return null;
 const rows=records.filter(r=>r?.type==='message'&&r.message).map(r=>r.message);
 const threads=records.filter(r=>r?.type==='thread'&&r.thread).map(r=>r.thread);
 const active=header.activeThreadId||threads.find(t=>t.threadOrder===-1)?.threadId||rows[0]?.threadId;
 const included=rows.filter(r=>r.threadId===active);
 const byId=new Map(included.map(r=>[String(r.messageId),r]));
 const children=new Map();for(const row of included){const parent=String(row.parentMessageId||'');if(!children.has(parent))children.set(parent,[]);children.get(parent).push(row);}
 for(const arr of children.values())arr.sort((a,b)=>(Number(a.siblingOrder)||0)-(Number(b.siblingOrder)||0));
 function pathFrom(id){const out=[],visited=new Set();let cur=byId.get(String(id));while(cur&&!visited.has(cur.messageId)&&out.length<100000){visited.add(cur.messageId);out.push({...cur.message,id:cur.messageId,createdAt:cur.message?.timestamp||cur.createdAt});const options=children.get(String(cur.messageId))||[];cur=byId.get(String(cur.activeChildId))||options[0]||null;}return out;}
 const thread=threads.find(t=>t.threadId===active);const rootId=thread?.rootMessageId||((children.get('')||[])[0]?.messageId);
 const messages=pathFrom(rootId);const forks={};
 for(const row of included){const options=children.get(String(row.messageId))||[];if(options.length<2)continue;
  const pos=Math.max(0,options.findIndex(c=>c.messageId===row.activeChildId));
  forks[row.messageId]={position:pos,createdAt:row.forkCreatedAt||row.createdAt||0,lists:options.map((child,i)=>({id:child.branchId||child.messageId,messages:i===pos?[]:pathFrom(child.messageId)}))};
 }
 const timestamps=messages.map(m=>sourceTime(m.createdAt||m.timestamp)).filter(Boolean);
 return {...header,messages,messageForksHash:forks,createdAt:sourceTime(records.find(r=>r.type==='session')?.meta?.createdAt)||timestamps[0]||null,updatedAt:timestamps.at(-1)||null,pinned:!!header.starred,source:'chatbox-v3'};
}
function normalizeChatboxForkRows(source,sessionId,selections={}){
 const projected=chatboxForkProject(source,selections);
 return {messages:projected.messages.map((m,i)=>{
  const result=normalizeMessage(m,sessionId,i);
  if(m._chatboxFork){result.branchPivot=m._chatboxFork.pivot;result.branchVariants=m._chatboxFork.variants;result.branchIndex=m._chatboxFork.selected;}
  if(m.importPlaceholder)result.importPlaceholder=true;
  return result;
 }),forkCount:projected.forkCount};
}
async function saveProjectedImportedMessages(sessionId,rows,{preserveEdits=true}={}){
 const previous=await Store.inSession('messages',sessionId),prefix=sessionId+':source:';
 const nextIds=new Set(rows.map(x=>x.id));
 const sourceRows=previous.filter(x=>x.id.startsWith(prefix));
 const oldById=new Map(sourceRows.map(x=>[x.id,x]));
 for(const old of sourceRows)if(!nextIds.has(old.id)){
  await Store.del('messages',old.id);await Store.del('chunks','chunk:'+old.id);
 }
 for(const row of rows){const previousRow=oldById.get(row.id);
  if(preserveEdits&&previousRow?.editedAt){row.content=previousRow.content;row.editedAt=previousRow.editedAt;row.editHistory=previousRow.editHistory;}
 }
 if(rows.length){await Store.putMany('messages',rows,60);await Store.putMany('chunks',rows.map(chunkFor).filter(Boolean),60);}
 return {oldCount:sourceRows.length,newCount:rows.length};
}
async function switchChatboxBranch(sessionId,pivot,target){
 const session=await Store.get('sessions',sessionId);const graph=session?.chatboxForkArchive;
 const fork=graph?.messageForksHash?.[pivot];if(!fork?.lists?.length)throw Error('找不到导入的 聊天备份 分支');
 if(!Number.isInteger(target)||target<0||target>=fork.lists.length)throw Error('分支编号超出范围');
 const locals=(await Store.inSession('messages',sessionId)).filter(m=>!m.id.startsWith(sessionId+':source:'));
 if(locals.length)throw Error('此会话已有本地续聊记录。为避免串线，请先备份或复制会话，再切换导入分支。');
 const selections={...(session.chatboxBranchSelections||{}),[pivot]:target};
 const projection=normalizeChatboxForkRows(graph,sessionId,selections);
 await saveProjectedImportedMessages(sessionId,projection.messages);
 session.chatboxBranchSelections=selections;session.messageCount=projection.messages.length;
 session.lastMessageAt=projection.messages.map(x=>sourceTime(x.timestamp)).filter(Boolean).sort().at(-1)||session.lastMessageAt;
 await Store.put('sessions',session);
 return {count:fork.lists.length,position:target,visible:projection.messages.length};
}

function chunkFor(m){if(!m.content||!m.content.trim()||m.role==='system')return null;return {id:`chunk:${m.id}`,sessionId:m.sessionId,messageId:m.id,ordinal:m.ordinal,text:m.content.slice(0,5500),kind:'message',role:m.role,timestamp:m.timestamp,localVec:hashedVec(m.content.slice(0,5500))};}
async function createSession(title='新聊天'){const id=uuid();const s={id,name:title,systemPrompt:'',source:'native',messageCount:0,createdAt:now(),updatedAt:now()};await Store.put('sessions',s);return s;}
async function appendMessage(sessionId,role,content,attachments=[]){const s=await Store.get('sessions',sessionId);if(!s)throw Error('没有这个对话');const ord=(s.messageCount||0)+1;const m={id:uuid(),sessionId,ordinal:ord,role,content,timestamp:now(),attachments};await Store.put('messages',m);const c=chunkFor(m);if(c)await Store.put('chunks',c);s.messageCount=ord;s.updatedAt=now();s.lastMessageAt=s.updatedAt;s.updatedLocally=true;await Store.put('sessions',s);return m;}
async function invalidateVectors(chunkId){for(const item of await Store.all('vectors'))if(item.chunkId===chunkId||String(item.id).startsWith(chunkId+'|'))await Store.del('vectors',item.id);}
async function editMessage(id,text){const m=await Store.get('messages',id);if(!m)throw Error('找不到消息');const next=String(text??'');if(!next.trim())throw Error('不能把消息修改为空；如需清空请删除此条');m.editHistory=[...(m.editHistory||[]),{content:m.content,editedAt:m.editedAt||now()}].slice(-20);m.content=next;m.editedAt=now();await Store.put('messages',m);const chunk=chunkFor(m);if(chunk)await Store.put('chunks',chunk);else await Store.del('chunks','chunk:'+id);await invalidateVectors('chunk:'+id);return m;}
async function deleteMessage(id){const m=await Store.get('messages',id);if(!m)throw Error('找不到消息');await Store.del('messages',id);await Store.del('chunks','chunk:'+id);await invalidateVectors('chunk:'+id);for(const card of await Store.inSession('statusCards',m.sessionId))if(card.messageId===id)await Store.del('statusCards',card.id);const sess=await Store.get('sessions',m.sessionId);if(sess){const latest=typeof Store.latestMessageTimestamp==='function'?await Store.latestMessageTimestamp(m.sessionId):0;sess.lastMessageAt=latest?new Date(latest).toISOString():null;sess.updatedAt=now();await Store.put('sessions',sess);}return true;}
async function importSessions(rawSessions,progress=()=>{}){
 let added=0,skipped=0,msgs=0,forks=0,repaired=0;
 for(let j=0;j<rawSessions.length;j++){
  const entry=rawSessions[j],original=entry.value||entry;
  const rawId=original?.id||entry.path||String(j);
  const id=(original.source==='rikka'?'rikka:':'chatbox:')+rawId;
  const old=await Store.get('sessions',id);
  const hasForks=!!Object.values(original.messageForksHash||{}).some(f=>Array.isArray(f?.lists)&&f.lists.length>1);
  const needsRepair=!!(old&&hasForks&&old.chatboxForkGraphVersion!==2);
  if(old&&old.importedOriginalCount>=((original.messages||[]).length)&&!needsRepair){
   if(!old.pinPreferenceModified&&sourcePin(original)&&!old.pinned){old.pinned=true;old.pinnedAt=sourceTime(original.pinnedAt||original.updatedAt)||null;await Store.put('sessions',old);}
   skipped++;progress(j+1,rawSessions.length,`跳过已导入：${old.name}`);continue;
  }
  const sourceSession=toSessionShape(original,id,entry.name||original.name),session={...sourceSession,...(old||{})};
  if(!old?.pinPreferenceModified){session.pinned=sourceSession.pinned;session.pinnedAt=sourceSession.pinnedAt;}
  if(!old?.updatedLocally)session.updatedAt=sourceSession.updatedAt;
  if(!session.systemPrompt)session.systemPrompt=(original.messages||[]).filter(m=>m.role==='system').map(extractText).filter(Boolean).join('\n\n').slice(0,50000);
  let arr,forkCount=0;
  if(hasForks){
   const projection=normalizeChatboxForkRows(original,id,old?.chatboxBranchSelections||{});
   arr=projection.messages;forkCount=projection.forkCount;
   session.chatboxForkArchive={messages:original.messages,messageForksHash:original.messageForksHash,threads:original.threads||[]};
   session.chatboxForkGraphVersion=2;
   session.chatboxBranchSelections=old?.chatboxBranchSelections||{};
   await saveProjectedImportedMessages(id,arr);
   msgs+=arr.length;if(needsRepair)repaired++;
  }else{
   arr=(original?.messages||[]).map((m,i)=>normalizeMessage(m,id,i));
   const from=Math.max(0,old?.importedOriginalCount||0),newly=arr.slice(from);
   if(newly.length){await Store.putMany('messages',newly,100);await Store.putMany('chunks',newly.map(chunkFor).filter(Boolean),100);msgs+=newly.length;}
  }
  const legacy=arr.filter(m=>m.raw?.isSummary&&m.content).map(m=>({id:'legacy-summary:'+m.id,sessionId:id,createdAt:m.timestamp||now(),startOrdinal:1,endOrdinal:m.ordinal,messageCount:m.ordinal,content:m.content,sourceIds:[m.id],model:'聊天备份 原有总结',version:1,legacy:true,coverageUnknown:true}));
  if(legacy.length){await Store.putMany('summaries',legacy);await Store.putMany('chunks',legacy.map(m=>({id:'summary:'+m.id,kind:'summary',sessionId:id,ordinal:m.endOrdinal,text:m.content,summaryId:m.id,timestamp:m.createdAt})));}
  session.importedOriginalCount=(original.messages||[]).length;
  session.messageCount=Math.max(old?.messageCount||0,arr.length);
  session.rawSettings=original.settings||{};session.source=original.source||'chatbox';
  const messageDates=arr.map(x=>sourceTime(x.timestamp)).filter(Boolean).sort();
  if(messageDates.length&&!old?.updatedLocally)session.lastMessageAt=messageDates.at(-1);
  session.sortDateChecked=true;await Store.put('sessions',session);
  added++;forks+=forkCount;
  progress(j+1,rawSessions.length,`已导入 ${j+1}/${rawSessions.length} 个会话${forkCount?`，检测 ${forkCount} 处分支`:''}`);
 }
 return {added,skipped,messages:msgs,forks,repaired};
}

function resolveSessionObjects(container){if(!container||typeof container!=='object')throw Error('备份根节点不是 JSON 对象');const found=[];
if(Array.isArray(container)){container.forEach((s,i)=>{if(s&&Array.isArray(s.messages))found.push({value:s,path:String(i)});});return found;}
for(const [path,value] of Object.entries(container)){if(/sessions\/[^/]+\/session\.json$/i.test(path)&&value&&Array.isArray(value.messages))found.push({value,path});}
if(found.length)return found;
const alternate=container.sessions||container.conversations||container.data?.sessions||container.data?.conversations;
if(Array.isArray(alternate)){alternate.forEach((s,i)=>{if(Array.isArray(s?.messages))found.push({value:s,path:String(i)});});}
else if(alternate&&typeof alternate==='object')Object.entries(alternate).forEach(([path,s])=>{if(Array.isArray(s?.messages))found.push({value:s,path});});
if(!found.length && Array.isArray(container.messages))found.push({value:container,path:'single'});
return found;
}
async function importFile(file,progress=()=>{},selectedIds=null){if(!file)throw Error('没有选择文件');if(file.size>1.5e9)throw Error('文件过大，请分批导出');let sessions=[];let foundAssets=0;
if(/\.zip$/i.test(file.name)||file.type==='application/zip'){
progress(0,1,'解析 ZIP 文件…');const zip=await JSZip.loadAsync(file,{checkCRC32:false});const entries=Object.values(zip.files);if(entries.some(x=>/^rikka_hub\.db$/i.test(x.name)))throw Error('这是 聊天备份 SQLite 备份：请在 Android APK 中用原生导入功能读取；网页版暂不支持直接解析此格式。');if(entries.length>50000)throw Error('ZIP 文件项目数量异常');const sessionEntries=entries.filter(f=>!f.dir&&/sessions\/[^/]+\/session\.json$/i.test(f.name));
if(sessionEntries.length){for(let i=0;i<sessionEntries.length;i++){const f=sessionEntries[i];const obj=JSON.parse(await f.async('string'));if(Array.isArray(obj?.messages))sessions.push({value:obj,path:f.name});progress(i+1,sessionEntries.length,`正在解析 ZIP：${i+1}/${sessionEntries.length}`);}}
else{const candidate=entries.find(f=>!f.dir&&(/backup.*\.json$/i.test(f.name)||/manifest\.json$/i.test(f.name)))||entries.find(f=>!f.dir&&/\.json$/i.test(f.name));if(candidate){const src=JSON.parse(await candidate.async('string'));if(candidate.name.endsWith('manifest.json'))throw Error('ZIP 中只有清单，找不到 sessions 会话文件');sessions=resolveSessionObjects(src);}}
// Preserve smaller media resources separately without injecting them into chat messages.
const assets=entries.filter(f=>!f.dir&&/\/(resources|attachments)\//i.test(f.name));for(let i=0;i<assets.length;i++){const f=assets[i];const bytes=f._data?.uncompressedSize||0;if(bytes>20*1024*1024)continue;try{await Store.put('assets',{id:f.name,filename:f.name,bytes:await f.async('uint8array'),size:bytes});foundAssets++;}catch(e){console.warn('无法保存附件',f.name,e);}}
}else{progress(0,1,'解析 JSON 文件…');const src=JSON.parse(await file.text());sessions=resolveSessionObjects(src);}
if(!sessions.length)throw Error('无法识别会话格式。请提供 聊天备份 完整 ZIP/JSON 备份以增加适配。');const selected=selectedIds?new Set(selectedIds):null;const targets=selected?sessions.filter(x=>selected.has(String(x.value?.id||x.path))):sessions;const result=await importSessions(targets,progress);return {...result,assets:foundAssets,selectedCount:targets.length};}
async function previewImportFile(file,onProgress=()=>{}){
 if(!file)throw Error('请选择备份文件');
 let sessions=[];
 if(/\.zip$/i.test(file.name)||file.type==='application/zip'){
  const zip=await JSZip.loadAsync(file,{checkCRC32:false});
  if(zip.file('rikka_hub.db'))return {kind:'rikka',sessions:[],nativeRequired:true};
  const files=Object.values(zip.files).filter(f=>!f.dir&&/sessions\/[^/]+\/session\.json$/i.test(f.name));
  if(files.length){for(let i=0;i<files.length;i++){
    const obj=JSON.parse(await files[i].async('string'));
    if(Array.isArray(obj?.messages))sessions.push({id:String(obj.id||files[i].name),title:obj.name||obj.title||'未命名会话',count:obj.messages.length,source:'chatbox'});
    onProgress(i+1,files.length,'识别 聊天备份 会话 '+(i+1)+'/'+files.length);
  }}else{
    const f=Object.values(zip.files).find(x=>/backup.*\.json$/i.test(x.name));
    if(f) sessions=resolveSessionObjects(JSON.parse(await f.async('string'))).map(x=>({id:String(x.value.id||x.path),title:x.value.name||x.value.title||'未命名会话',count:x.value.messages?.length||0,source:'chatbox'}));
  }
 }else{
  sessions=resolveSessionObjects(JSON.parse(await file.text())).map(x=>({id:String(x.value.id||x.path),title:x.value.name||x.value.title||'未命名会话',count:x.value.messages?.length||0,source:'chatbox'}));
 }
 if(!sessions.length)throw Error('没有找到可导入的会话');
 return {kind:'chatbox',sessions};
}
function rikkaMessage(raw,sessionId){
 const parts=raw.parts||[];
 const content=parts.map(p=>p.type==='text'?p.text||'':p.type==='image'?'[图片]':p.type==='tool'?'[工具: '+(p.toolName||'工具')+']':'').filter(Boolean).join('\n');
 const reasoning=parts.filter(p=>p.type==='reasoning').map(p=>p.reasoning||'').join('\n');
 const ordinal=Number(raw.ordinal)||1;
 return {id:sessionId+':node:'+String(raw.nodeId||ordinal),sourceId:raw.id||null,sessionId,ordinal,
  role:validRole(raw.role),content,reasoning,timestamp:raw.createdAt||now(),
  rawParts:parts,raw:{...raw,parts:undefined},attachments:parts.filter(p=>p.type==='image').map(p=>({name:'聊天备份 图片',type:'image/jpeg',source:p.url||'',missingSource:true}))};
}
async function importRikkaBatch(batch){
 const raw=batch.session; if(!raw?.id)throw Error('聊天备份 会话 ID 缺失');
 const id='rikka:'+raw.id;
 let s=await Store.get('sessions',id);
 if(!s){s={id,name:raw.title||'聊天备份 会话',systemPrompt:raw.systemPrompt||'',source:'rikka',importSourceId:raw.id,
  messageCount:0,createdAt:raw.createdAt||now(),updatedAt:raw.updatedAt||now(),importedOriginalCount:0};}
 const records=(batch.messages||[]).map(m=>rikkaMessage(m,id));
 const existing=await Promise.all(records.map(m=>Store.get('messages',m.id)));
 const added=records.filter((m,i)=>!existing[i]);
 if(added.length){await Store.putMany('messages',added,80);await Store.putMany('chunks',added.map(chunkFor).filter(Boolean),80);}
 s.messageCount=Math.max(s.messageCount||0,...records.map(m=>m.ordinal),0);
 s.importedOriginalCount=Math.max(s.importedOriginalCount||0,...records.map(m=>m.ordinal),0);
 s.name=raw.title||s.name;
 s.updatedAt=raw.updatedAt||s.updatedAt||now();const latest=records.map(m=>sourceTime(m.timestamp)).filter(Boolean).sort().at(-1);if(latest&&!s.updatedLocally)s.lastMessageAt=latest;if(!s.pinPreferenceModified&&raw.pinned!==undefined){s.pinned=!!raw.pinned;s.pinnedAt=raw.pinnedAt||raw.updatedAt||s.pinnedAt||null;}
 await Store.put('sessions',s);
 return {id,added:added.length,total:records.length};
}
function tok(text){const s=String(text||'').toLowerCase();const ws=s.match(/[a-z0-9_]+|[\u3400-\u9fff]+/gu)||[];let out=[];for(const w of ws){if(/[\u3400-\u9fff]/.test(w)){for(let i=0;i<w.length;i++){if(i+1<w.length)out.push(w.slice(i,i+2));if(i+2<w.length)out.push(w.slice(i,i+3));}if(w.length===1)out.push(w);}else out.push(w);}return out.slice(0,10000);}
function hash32(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function hashedVec(text,dim=512){const vec=new Float32Array(dim);for(const word of tok(text)){const ix=hash32(word)%dim;vec[ix]+=1;}return norm(Array.from(vec));}
function norm(v){let q=0;for(const x of v)q+=x*x;const d=Math.sqrt(q)||1;return Array.from(v,x=>x/d);}
function cosine(a,b){if(!a?.length||!b?.length||a.length!==b.length)return 0;let v=0;for(let i=0;i<a.length;i++)v+=a[i]*b[i];return v;}
function lex(query,body){const q=tok(query),b=tok(body),bset=new Set(b);let matches=0;for(const x of new Set(q))if(bset.has(x))matches+=1;const phrase=String(body||'').toLowerCase().includes(String(query||'').toLowerCase())?1:0;return (matches/(new Set(q).size||1))*.8+phrase*.2;}
function endpoint(url,kind){
 let base=String(url||'').trim().replace(/\/+$/,'');
 if(!/^https?:\/\//i.test(base))throw Error('API 地址必须以 http:// 或 https:// 开头');
 base=base.replace(/\/(?:chat\/completions|embeddings|models)$/i,'');
 if(/\/api\/tags$/i.test(base))base=base.replace(/\/api\/tags$/i,'');
 if(kind!=='api/tags' && /:(?:11434|1234|8000|8080)(?:\/|$)/i.test(base)&&!/(?:\/v1|\/v1beta\/openai)$/i.test(base))base+='/v1';
 if(/^https:\/\/api\.openai\.com$/i.test(base))base+='/v1';
 // SiliconFlow requires /v1 for both GET /models and POST /embeddings.
 if(/^https?:\/\/api\.siliconflow\.cn$/i.test(base))base+='/v1';
 return base+'/'+kind;
}
let nextBridge=0;const awaiting=new Map(),activeStreams=new Map();
window.__nativeResponse=(id,status,body,error)=>{const h=awaiting.get(id);if(h){awaiting.delete(id);h.resolve({status,body,error});}};
window.__nativeStreamChunk=(id,chunk)=>activeStreams.get(id)?.onData(chunk);
window.__nativeStreamEnd=(id,status,error)=>{const h=activeStreams.get(id);if(h){activeStreams.delete(id);h.end(status,error);}};
async function apiRequest(url,key,path,method='POST',body=null){
 const full=endpoint(url,path),headers={};if(body!==null)headers['Content-Type']='application/json';if(key)headers.Authorization=`Bearer ${key}`;
 if(window.NativeBridge?.request){const id=++nextBridge;const pending=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{awaiting.delete(id);reject(Error('网络请求超时（180 秒）: '+full));},180000);awaiting.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);}});});window.NativeBridge.request(id,full,method,JSON.stringify(headers),body===null?'':JSON.stringify(body));const r=await pending;if(r.error)throw Error('网络连接失败 '+full+'：'+r.error);if(r.status<200||r.status>=300)throw Error(`HTTP ${r.status} (${full})：${String(r.body||'').slice(0,650)}`);try{return JSON.parse(r.body);}catch{throw Error('服务器返回的不是 JSON：'+String(r.body).slice(0,160));}}
 let resp;try{resp=await fetch(full,{method,headers,...(body!==null?{body:JSON.stringify(body)}:{})});}catch(e){throw Error('网络连接失败 '+full+'（局域网 / HTTPS / CORS）：'+e.message);}if(!resp.ok)throw Error(`HTTP ${resp.status} (${full})：${(await resp.text()).slice(0,650)}`);try{return await resp.json();}catch{throw Error('服务器返回内容不是 JSON：'+full);}
}
async function apiJson(url,key,path,body){return apiRequest(url,key,path,'POST',body);}
function parseStreamDelta(obj){const choice=obj?.choices?.[0],delta=choice?.delta||choice?.message||{};let content=delta.content;return typeof content==='string'?content:Array.isArray(content)?content.map(x=>x.text||'').join(''):'';}
async function streamingChat(url,key,body,onChunk=()=>{}){
 const full=endpoint(url,'chat/completions');let text='',remainder='',finished=false,usage=null;
 function onData(str){remainder+=str.replace(/\r\n/g,'\n');let split;while((split=remainder.indexOf('\n\n'))>=0){const event=remainder.slice(0,split);remainder=remainder.slice(split+2);for(const line of event.split('\n')){if(!line.startsWith('data:'))continue;const payload=line.slice(5).trim();if(payload==='[DONE]'){finished=true;continue;}try{const obj=JSON.parse(payload);if(obj?.usage)usage=normalizeTokenUsage(obj.usage);const part=parseStreamDelta(obj);if(part){text+=part;onChunk(text,part);}}catch{}}}}
 const headers={'Content-Type':'application/json'};if(key)headers.Authorization=`Bearer ${key}`;
 if(window.NativeBridge?.requestStream){const id=++nextBridge;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{activeStreams.delete(id);reject(Error('流式请求超时：'+full));},180000);activeStreams.set(id,{onData,end:(status,error)=>{clearTimeout(timer);if(error||status<200||status>=300)reject(Error('流式请求失败 '+full+'：'+(error||('HTTP '+status))));else{onData('\n\n');resolve();}}});window.NativeBridge.requestStream(id,full,JSON.stringify(headers),JSON.stringify({...body,stream:true}));});}
 else {const resp=await fetch(full,{method:'POST',headers,body:JSON.stringify({...body,stream:true})});if(!resp.ok)throw Error('HTTP '+resp.status+'：'+(await resp.text()).slice(0,550));const reader=resp.body?.getReader();if(!reader)throw Error('当前浏览器不支持流式读取');const decoder=new TextDecoder();for(;;){const {done,value}=await reader.read();if(done)break;onData(decoder.decode(value,{stream:true}));}onData('\n\n');}
 if(!text)throw Error('流式请求没有返回正文；请关闭流式输出测试该模型');return {text,usage};
}
function makeChatBody(conf,messages,extra={}){const body={model:conf.model,messages,stream:false};if(Number.isFinite(Number(conf.temperature)))body.temperature=Number(conf.temperature);if(Number.isFinite(Number(conf.topP)))body.top_p=Number(conf.topP);if(Number(conf.maxTokens)>0)body[conf.maxTokensField==='max_completion_tokens'?'max_completion_tokens':'max_tokens']=Math.trunc(Number(conf.maxTokens));
 // Ollama OpenAI-compatible endpoint supports think=false; other providers are not sent undocumented parameters.
 if(conf.thinkingEnabled===false && /:11434(?:\/|$)/i.test(conf.url||''))body.think=false;
 return {...body,...extra};}
function normalizeTokenUsage(u){
 if(!u||typeof u!=='object')return null;
 const integer=x=>Number.isFinite(Number(x))&&Number(x)>=0?Math.round(Number(x)):null;
 const input=integer(u.prompt_tokens??u.input_tokens),output=integer(u.completion_tokens??u.output_tokens);
 const total=integer(u.total_tokens)??(input!==null&&output!==null?input+output:null);
 if(input===null&&output===null&&total===null)return null;
 return {input,output,total,source:'api'};
}
function approximateTokens(inputMessages,outputText){
 // This is explicitly an estimate, NOT a billed count; exact tokenization is model-dependent.
 const estimate=text=>{
  const s=String(text||''),han=(s.match(/[\u3400-\u9fff]/g)||[]).length;
  return Math.max(1,Math.ceil(han*1.1+(s.length-han)/4));
 };
 const input=estimate((inputMessages||[]).map(x=>String(x.content||'')).join('\n'));
 const output=estimate(outputText);
 return {input,output,total:input+output,source:'estimate'};
}
async function completionDetailed(messages,profile={},onChunk=null){
 const c=await settings(),conf={...c.chat,...profile};
 if(!conf.model)throw Error('请先在模型配置中选择聊天模型，或点击拉取模型');
 const body=makeChatBody(conf,messages);
 if(conf.stream&&onChunk){
  const streamed=await streamingChat(conf.url,conf.key,body,onChunk);
  return {text:streamed.text,usage:streamed.usage||approximateTokens(messages,streamed.text),finishReason:null};
 }
 let data;
 try{data=await apiJson(conf.url,conf.key,'chat/completions',body);}
 catch(e){
  if(/(?:max_tokens|max_completion_tokens|temperature|top_p|think).*(?:unsupported|unknown|not permitted|unrecognized|extra_forbidden|invalid)|(?:unsupported|unknown|not permitted|unrecognized|extra_forbidden|invalid).*(?:max_tokens|max_completion_tokens|temperature|top_p|think)/i.test(e.message)){
   const minimal={model:conf.model,messages,stream:false};
   if(/max_tokens/.test(e.message))minimal.max_completion_tokens=Math.trunc(Number(conf.maxTokens)||512);
   data=await apiJson(conf.url,conf.key,'chat/completions',minimal);
  }else throw e;
 }
 const result=data?.choices?.[0]?.message?.content;
 const text=typeof result==='string'?result:Array.isArray(result)?result.map(x=>x.text||'').join(''):'';
 if(!text)throw Error('模型没有返回正文，可能只返回思考内容：'+JSON.stringify(data).slice(0,300));
 return {text,usage:normalizeTokenUsage(data?.usage)||approximateTokens(messages,text),finishReason:data?.choices?.[0]?.finish_reason||null};
}
async function completion(messages,profile={},onChunk=null){return (await completionDetailed(messages,profile,onChunk)).text;}
function isSiliconFlow(url){try{return new URL(String(url||'')).hostname.toLowerCase()==='api.siliconflow.cn';}catch{return false;}}
function looksLikeEmbedding(item){
 const info=typeof item==='string'?item:item||{};
 const subtype=String(info.sub_type||info.subType||info.category||info.type||'').toLowerCase();
 if(subtype.includes('embedding'))return true;
 if(subtype.includes('chat')||subtype.includes('image')||subtype.includes('audio')||subtype.includes('rerank'))return false;
 const id=typeof info==='string'?info:String(info.id||info.name||info.model||'');
 return /embed|bge[-/]|bce-embedding|gte[-/]|nomic|e5[-/]|jina-embeddings|voyage|mxbai|snowflake-arctic-embed/i.test(id);
}
async function listModels(conf){
 if(!conf?.url)throw Error('先填写 API 地址');
 const onlyEmbeddings=conf.type==='embedding';const silicon=isSiliconFlow(conf.url);
 const path=silicon&&onlyEmbeddings?'models?sub_type=embedding':'models';
 let data;
 try{data=await apiRequest(conf.url,conf.key,path,'GET');}
 catch(e){
  if(!/(?:11434|ollama)/i.test(conf.url))throw e;
  const root=conf.url.replace(/\/v1\/?$/,'');data=await apiRequest(root,conf.key,'api/tags','GET');
 }
 let items=Array.isArray(data?.data)?data.data:Array.isArray(data?.models)?data.models:[];
 // Use the provider subtype filter and verify locally, so chat models never
 // appear in the Embedding picker even if an endpoint ignores the query.
 if(onlyEmbeddings)items=items.filter(looksLikeEmbedding);
 return [...new Set(items.map(x=>typeof x==='string'?x:x.id||x.name||x.model).filter(Boolean))].sort();
}
async function testModel(conf){if(!conf?.model)throw Error('请先填写模型 ID 或从列表拉取');const t=Date.now();let result;
 if(conf.type==='embedding'){const data=await apiJson(conf.url,conf.key,'embeddings',{model:conf.model,input:'测试向量连接',encoding_format:'float'});const vector=data?.data?.[0]?.embedding;if(!Array.isArray(vector)||!vector.length)throw Error('未返回有效向量');result='Embedding 可用，维度 '+vector.length;}
 else {const data=await apiJson(conf.url,conf.key,'chat/completions',{model:conf.model,messages:[{role:'user',content:'请只回复：连接成功'}],stream:false});const text=data?.choices?.[0]?.message?.content;if(typeof text!=='string')throw Error('接口返回成功但消息正文为空');result='聊天可用：'+text.slice(0,65);}
 return {result,elapsed:Date.now()-t,endpoint:endpoint(conf.url,conf.type==='embedding'?'embeddings':'chat/completions')};}
async function embed(texts){const conf=(await settings()).embedding;if(!conf.enabled||!conf.model)return null;const body={model:conf.model,input:texts,encoding_format:'float'};const data=await apiJson(conf.url,conf.key,'embeddings',body);if(!Array.isArray(data?.data))throw Error('Embedding API 没有返回向量列表');return data.data.slice().sort((a,b)=>a.index-b.index).map(d=>norm(d.embedding));}
async function buildVectors(sessionId,onProgress=()=>{},onlyChunkIds=null){const conf=(await settings()).embedding;if(!conf.enabled||!conf.model)throw Error('请先开启并配置向量模型');const whole=await Store.inSession('chunks',sessionId);const chunks=onlyChunkIds?whole.filter(x=>onlyChunkIds.includes(x.id)):whole;const modelKey=conf.url+'|'+conf.model;let count=0;const size=Math.max(1,Math.min(32,Number(conf.batchSize||12)));
for(let i=0;i<chunks.length;i+=size){const slice=chunks.slice(i,i+size);const missing=[];for(const c of slice){if(!await Store.get('vectors',c.id+'|'+modelKey))missing.push(c);}if(missing.length){const all=await embed(missing.map(x=>x.text));if(all.length!==missing.length)throw Error('返回的向量数量和输入不一致');await Store.putMany('vectors',missing.map((c,j)=>({id:c.id+'|'+modelKey,chunkId:c.id,modelKey,vec:all[j]})));count+=missing.length;}onProgress(Math.min(i+slice.length,chunks.length),chunks.length);}
return count;}
// Four-layer long-term recall: exact keyword evidence, optional remote embedding,
// source-linked event neighborhoods, and chronological evidence. No generated facts.
const MEMORY_STOPWORDS=new Set(['我们','你们','他们','这个','那个','之前','以前','后来','现在','当时','那时','时候','事情','什么','怎么','怎么样','如何','哪里','那里','这里','记得','还记得','有没有','是否','是不是','知道','说过','聊过','一下','关于','一个','可以','告诉','曾经','发生','还是','已经','还有','这些','那些','当年','那天','那次','一次','当初','里面','相关','历史','内容','记录','帮我','请问','请你','我想','再说','那件','那段','哪次','真的','可能','就是','以及','如何','一下']);
function normalizeEvidence(text){return String(text||'').toLowerCase().normalize('NFKC');}
function queryAnchors(query){
 const normalized=normalizeEvidence(query).slice(0,240);
 // Strip conversational filler before deriving a few discriminative Chinese n-grams.
 const cleaned=normalized.replace(/你还记得|还记得|有没有|是不是|告诉我|帮我|我记得|你记得|聊过|说过|之前|以前|上次|那次|那天|当时|后来|怎么样|什么|哪里|知道|发生过|发生了|有关|关于|我想问|还在|那个|这个|我们|你们|他们|请问|请你|是否|了吗|了吗|的是|的事|吗|呢|吧|了|的|在|和|跟|与|有|过|是|我|你|它|他|她/g,' ');
 const seen=new Set();const out=[];
 const add=term=>{const a=term.trim();if(a.length<2||MEMORY_STOPWORDS.has(a)||seen.has(a))return;seen.add(a);out.push(a);};
 for(const raw of cleaned.match(/[\u3400-\u9fff]{2,}|[a-z0-9_]{3,}/gu)||[]){
  if(!/[\u3400-\u9fff]/u.test(raw)){add(raw);continue;}
  if(raw.length<=6)add(raw);
  if(raw.length>2)for(let i=0;i<=raw.length-3&&out.length<54;i++)add(raw.slice(i,i+3));
  for(let i=0;i<raw.length-1&&out.length<65;i++)add(raw.slice(i,i+2));
 }
 return out.slice(0,48);
}
function uniqueEventRows(rows){const seen=new Set();return rows.filter(x=>{const key=x.sessionId+'|'+x.ordinal+'|'+x.kind;if(seen.has(key))return false;seen.add(key);return true;});}
async function search(query,sessionId,limit=8,options={}){
 const c={...(await settings()),...((await Store.get('sessions',sessionId))?.memory||{})};
 const allChunks=c.crossSession?await Store.all('chunks'):await Store.inSession('chunks',sessionId);
 const sums=c.crossSession?await Store.all('summaries'):await Store.inSession('summaries',sessionId);
 const beforeOrdinal=Number(options.beforeOrdinal)||Infinity;
 const allowed=x=>x.sessionId!==sessionId||!(Number(x.ordinal)>=beforeOrdinal);
 const messageChunks=allChunks.filter(x=>x.kind!=='summary'&&allowed(x));
 const candidates=[...messageChunks.map(x=>({...x,kind:x.kind||'message'})),...sums.map(x=>({id:x.id,kind:'summary',sessionId:x.sessionId,ordinal:x.endOrdinal,text:x.content,timestamp:x.createdAt,startOrdinal:x.startOrdinal,endOrdinal:x.endOrdinal}))].filter(x=>x.text?.trim());
 if(!String(query||'').trim()||!candidates.length)return [];
 const q=normalizeEvidence(query).trim(),anchors=queryAnchors(query);
 const docCounts=new Map(anchors.map(a=>[a,0]));
 for(const row of candidates){const body=normalizeEvidence(row.text);for(const a of anchors)if(body.includes(a))docCounts.set(a,docCounts.get(a)+1);}
 const useful=anchors.filter(a=>docCounts.get(a)>0).map(a=>({key:a,idf:Math.log(2+candidates.length/(1+docCounts.get(a)))*(a.length>=3?1.15:1)}));
 const weightTotal=useful.reduce((n,a)=>n+a.idf,0)||1;
 const qhashed=hashedVec(query);let qRemote=null;const key=c.embedding.url+'|'+c.embedding.model;
 if(c.embedding.enabled&&c.embedding.model){try{qRemote=(await embed([query]))?.[0]||null;}catch(e){console.warn('Embedding 查询失败，回退到本地检索',e);}}
 const vectorLookup=qRemote?new Map((await Store.all('vectors')).filter(v=>v.modelKey===key).map(v=>[v.id,v])):null;
 const results=[];
 for(const item of candidates){
  const body=normalizeEvidence(item.text),matched=useful.filter(a=>body.includes(a.key));
  const anchorStrength=matched.reduce((n,a)=>n+a.idf,0)/weightTotal;
  const strongMatch=matched.length>0;
  const fullPhrase=q.length>=2&&q.length<=80&&body.includes(q);
  const lexical=lex(query,item.text),localSim=cosine(qhashed,item.localVec||hashedVec(item.text.slice(0,4500)));
  let semantic=0,hasEmbedding=false;
  if(qRemote){const v=vectorLookup.get((item.kind==='summary'?'summary:'+item.id:item.id)+'|'+key);if(v?.vec){semantic=cosine(qRemote,v.vec);hasEmbedding=true;}}
  const similarity=hasEmbedding?(semantic*.65+lexical*.23+localSim*.12):(lexical*.58+localSim*.42);
  const matchTier=fullPhrase?3:strongMatch?(matched.some(a=>a.key.length>=3)?2:1):0;
  // Semantic vectors can retrieve paraphrases; an actual keyword hit is never demoted beneath them.
  const score=Math.min(1,Math.max(0,similarity*.48+anchorStrength*.34+(fullPhrase?.18:strongMatch?.10:0)));
  if(matchTier>0||similarity>.13)results.push({...item,score,semantic:hasEmbedding?semantic:null,matchTier,matchType:fullPhrase?'精确原文':strongMatch?'关键词匹配':hasEmbedding?'向量语义':'本地语义',keywords:matched.map(x=>x.key).slice(0,6)});
 }
 results.sort((a,b)=>c.keywordPriority!==false&&b.matchTier!==a.matchTier?b.matchTier-a.matchTier:b.score-a.score||a.ordinal-b.ordinal);
 const cap=Math.max(1,Math.min(60,Number(limit)||8));let chosen=results.slice(0,cap);
 if(c.timelineRetrieval!==false&&chosen.length){
  // Keep the earliest and most recent occurrence of a distinctive keyword.
  // Otherwise hundreds of repeated recent mentions can bury the event's origin.
  const highTier=Math.max(...results.map(x=>x.matchTier));
  if(highTier>0){const matches=results.filter(x=>x.kind==='message'&&x.matchTier===highTier).sort((a,b)=>a.ordinal-b.ordinal);
   for(const anchor of [matches[0],matches.at(-1)])if(anchor&&!chosen.some(x=>x.id===anchor.id)){
    if(chosen.length>=cap)chosen.splice(chosen.length-1,1);
    chosen.push(anchor);
   }
  }
 }
 if(c.eventLinking!==false){
  const windowSize=Math.max(1,Math.min(4,Number(c.eventWindow)||2));
  const bySession=new Map();for(const m of messageChunks.filter(x=>x.kind==='message')){if(!bySession.has(m.sessionId))bySession.set(m.sessionId,[]);bySession.get(m.sessionId).push(m);}
  for(const hit of chosen){
   if(hit.kind==='summary')continue;
   const nearby=(bySession.get(hit.sessionId)||[]).filter(x=>x.id!==hit.id&&Math.abs(x.ordinal-hit.ordinal)<=windowSize).sort((a,b)=>a.ordinal-b.ordinal);
   hit.related=uniqueEventRows(nearby).map(x=>({id:x.id,kind:'message',sessionId:x.sessionId,ordinal:x.ordinal,text:x.text,timestamp:x.timestamp,relation:'事件前后文',sourceOrdinal:hit.ordinal}));
   hit.coveringSummaries=sums.filter(x=>x.sessionId===hit.sessionId&&x.startOrdinal<=hit.ordinal&&x.endOrdinal>=hit.ordinal).map(x=>x.id).slice(0,3);
  }
 }
 return chosen;
}
function buildHistoricalTimeline(results,budget){
 const rows=[];for(const hit of results.filter(x=>x.kind!=='summary')){
  for(const n of hit.related||[])rows.push({...n,sourceOrdinal:hit.ordinal,hit:false});
  rows.push({...hit,hit:true});
 }
 const unique=new Map();for(const row of rows){const key=row.sessionId+'|'+row.ordinal+'|'+row.kind;if(!unique.has(key)||row.hit)unique.set(key,row);}
 const ordered=[...unique.values()].sort((a,b)=>a.sessionId.localeCompare(b.sessionId)||a.ordinal-b.ordinal);
 const segments=[];let used=0;
 for(const row of ordered){const label=row.hit?(row.kind==='message'?'旧聊天原文':'历史事件记录'):'事件前后文';const term=row.hit&&row.keywords?.length?' · 关键词 '+row.keywords.slice(0,2).join('/') :'';
  const line=`【${label} 第${row.ordinal}条${term}】${String(row.text||'').slice(0,row.hit?950:430)}`;
  if(used+line.length>budget)continue;segments.push(line);used+=line.length+2;
 }
 return segments.join('\n\n');
}
async function assembleContext(sessionId){const s=await Store.get('sessions',sessionId);const c={...(await settings()),...(s?.memory||{}),...(s?.generation||{})};const messages=await Store.orderedMessages(sessionId);const recent=messages.filter(x=>x.role==='user'||x.role==='assistant').slice(-Math.max(1,Number(c.contextCount)||100));const last=[...recent].reverse().find(x=>x.role==='user')?.content||recent.at(-1)?.content||'';
 // Current context already contains these messages; recall only older evidence.
 const oldestRecentOrdinal=recent[0]?.ordinal||Infinity;
 const results=await search(last,sessionId,Number(c.recallCount)||8,{beforeOrdinal:oldestRecentOrdinal});
 const summaries=(await Store.inSession('summaries',sessionId)).sort((a,b)=>b.endOrdinal-a.endOrdinal);
 let uniqueSummaries=[];
 const addSum=x=>{if(x&&uniqueSummaries.length<Math.max(0,Number(c.summaryCount)||4)&&!uniqueSummaries.some(s=>s.id===x.id))uniqueSummaries.push(x);};
 // First include source-linked summaries; then relevant summaries; finally latest summaries.
 const sourceSummaries=new Set(results.flatMap(x=>x.coveringSummaries||[]));
 for(const sm of summaries)if(sourceSummaries.has(sm.id))addSum({id:sm.id,text:sm.content,startOrdinal:sm.startOrdinal,endOrdinal:sm.endOrdinal});
 for(const x of results.filter(x=>x.kind==='summary'))addSum(x);
 for(const sm of summaries)addSum({id:sm.id,text:sm.content,startOrdinal:sm.startOrdinal,endOrdinal:sm.endOrdinal});
 const memoryLimit=Math.max(1000,Math.min(100000,Number(c.maxRecallChars)||12000));
 const timeline=buildHistoricalTimeline(results,Math.floor(memoryLimit*.68));
 const summaryBudget=memoryLimit-timeline.length;
 const archived=[];let used=0;
 for(const x of uniqueSummaries){const room=Math.max(0,Math.min(2000,summaryBudget-used-80));if(room<70)break;const piece=`【历史总结 第${x.startOrdinal}—${x.endOrdinal}条】\n${String(x.text||'').slice(0,room)}`;if(piece.length+used>summaryBudget)break;archived.push(piece);used+=piece.length+2;}
 const memoryBlock=[timeline?'【历史事件时间线（按照原文顺序排列，含关联前后文）】\n'+timeline:'',...archived].filter(Boolean).join('\n\n').slice(0,memoryLimit);
let context=recent.map(x=>{const images=(x.attachments||[]).filter(a=>a.type?.startsWith('image/')&&a.dataUrl).slice(0,3);const fileText=(x.attachments||[]).filter(a=>typeof a.text==='string').map(a=>'【附加文本文件 '+(a.name||'文本')+'】\n'+a.text.slice(0,25000)).join('\n\n');const short=(String(x.content||'')+(fileText?'\n\n'+fileText:'')).slice(0,30000);return {role:x.role,content:images.length?[{type:'text',text:short||'请描述这些图片。'},...images.map(a=>({type:'image_url',image_url:{url:a.dataUrl}}))]:short};});const estimate=m=>typeof m.content==='string'?m.content.length:Math.min(3000,JSON.stringify(m.content).length);let length=context.reduce((sum,m)=>sum+estimate(m),0);const selectedTokenLimit=Math.min(1000000,Math.max(512,Number(c.contextTokenLimit)||16000));const savedCharBudget=Number(c.maxContextChars)||28000;const effectiveCharBudget=(savedCharBudget===28000&&selectedTokenLimit>16000)?4000000:savedCharBudget;const max=Math.max(1000,Math.min(4000000,effectiveCharBudget,selectedTokenLimit*3));while(context.length>1&&length>max){length-=estimate(context.shift());}
const head=[c.systemPrompt,s?.systemPrompt].filter(Boolean).join('\n\n');
 const cards=(await Store.inSession('statusCards',sessionId)).sort((a,b)=>(b.ordinal-a.ordinal)||(b.position-a.position));
 const recentCards=cards.slice(0,3).map(x=>`[${x.title}] ${x.content.slice(0,1200)}`).join('\n');
 const rule='【对话内自定义状态栏】只有当用户要求生成、增加或更新某个状态栏时，才在回复中生成状态栏。状态栏标题、数量、字段和内容完全由用户当次描述决定，不能限定为待办事项或记事本。每个状态栏务必使用以下成对标记：[status:用户要求的状态栏标题]状态栏内容（支持多行，每个字段一行）[/status]。正文可正常书写。每份状态栏都会在原消息位置显示成可展开的卡片并永久保留。不要随意捏造历史事实。';
 const notebookRule=c.notebookEnabled?'\n【记事本】每轮的累积记事本由客户端根据已保存原文自动生成独立折叠栏。你不要在聊天回复正文中重写、删改或复制记事本；若用户要求其他状态栏，它们由客户端放在记事本之前。':'';
 const meta=c.injectMeta?'【本轮元数据】模型：'+(c.chat.model||'未指定')+'；当前日期：'+new Date().toISOString()+'\n\n':'';const instructions=`${head}\n\n${meta}${rule}${notebookRule}\n\n【本会话最近的状态栏，供用户要求更新时参考】\n${recentCards||'无'}\n\n【长期记忆检索结果：精确关键词优先，按事件时间线核对原文、相邻事件与旧总结；引用消息编号，不要编造未提供的原文】\n${memoryBlock||'未找到相关历史记忆。'}`;
return {messages:[{role:'system',content:instructions},...context],results,summaryCount:summaries.length,contextSent:context.length};}
// Model-driven collapsible status panels; old versions remain stored with the reply.
// A generic status bar is NOT a todo or notebook. The user describes its content inside the chat.
function isStatusRequest(text){return /(?:状态栏|状态卡|状态面板|状态条|人物面板|角色面板)/i.test(String(text||''))&&/(?:生成|创建|设计|做|写|制作|设置|加|更新|修改|调整|重新|想要|需要|来个|一个)/i.test(String(text||''));}
function statusInstructions(config,request){
 const ask=isStatusRequest(request),automatic=!!config.statusPanelEnabled;
 if(!ask&&!automatic)return '';
 const labels=String(config.statusPanelNames||'').split(/[\n,，]/).map(v=>v.trim()).filter(Boolean).slice(0,12);
 return `\n\n【可折叠状态栏输出协议】\n${config.statusPrompt||''}\n${ask?'用户此轮要求一个自定义状态栏。优先按用户当前描述确定栏目，用户没说的不要自作主张。':''}${automatic&&labels.length?'若用户未指定栏目，可参考：'+labels.join('、'):''}\n在正常回复之后，使用如下可解析的原始文本格式附加状态栏：\n[status:状态栏标题]\n栏目一：值\n栏目二：值\n[/status]\n可以有多个状态栏。每个标题都由用户描述决定，不得固定为待办/记事本。不得用 HTML 或代码块代替方括号协议。状态栏中的信息必须来自聊天事实，未知内容写“未知”。若用户要求只有状态栏则不必输出普通正文。`; 
}
function parseStatusPanels(text){
 const cards=[];let clean=String(text||'').replace(/\[status:([^\]\n]{1,80})\]([\s\S]*?)\[\/status\]/gi,(all,title,body)=>{if(cards.length<20&&body.trim())cards.push({title:title.trim(),content:body.trim()});return '';});
 // Foldable HTML copied from user-provided prompts, rather than showing literal tags.
 // Matches independent simple details blocks; nested notebook is rendered by Notebook itself.
 clean=clean.replace(/(?:<p\b[^>]*>\s*)?<details\b[^>]*>\s*<summary\b[^>]*>([^<]{1,80})<\/summary>([\s\S]*?)<\/details>\s*(?:<\/p>)?/gi,(all,title,body)=>{
  const normalized=body.replace(/<\/?br\s*\/?>/gi,'\n').replace(/<\/?p\b[^>]*>/gi,'\n').trim();
  if(/<details\b/i.test(normalized))return all; // Leave nested content for the dedicated notebook renderer
  const plain=normalized.replace(/<[^>]*>/g,'').trim();
  if(cards.length<20&&plain)cards.push({title:title.trim(),content:plain});return '';
 });
 // Additional import-friendly syntax: ```statusbar {"title":"...","sections":{"key":"value"}} ```
 clean=clean.replace(/```(?:statusbar|status-card|状态栏)\s*\n?([\s\S]*?)```/gi,(block,inner)=>{
  try{const obj=JSON.parse(inner.trim());const items=Array.isArray(obj)?obj:[obj];let matched=false;for(const item of items){if(!item||typeof item!=='object'||cards.length>=20)continue;const fields=item.sections||item.fields||item.data;let body=typeof item.content==='string'?item.content:'';
   if(fields&&typeof fields==='object'){body=Object.entries(fields).map(([k,v])=>`${k}：${typeof v==='string'?v:Array.isArray(v)?v.join('、'):JSON.stringify(v)}`).join('\n');}
   if(body.trim()){cards.push({title:String(item.title||item.name||'自定义状态栏').slice(0,80),content:body.trim()});matched=true;}}
   return matched?'':block;
  }catch{return block;}
 });
 return {clean:clean.trim(),cards};
}
async function saveStatusCards(sessionId,messageId,ordinal,cards,manual=false){
 const records=cards.slice(0,20).map((x,i)=>({id:uuid(),sessionId,messageId,ordinal,title:x.title,content:x.content,createdAt:now(),manual,position:i}));
 if(records.length)await Store.putMany('statusCards',records);return records;
}
async function generateStatusCards(sessionId,description){
 const c=await settings();const history=await Store.orderedMessages(sessionId);if(!history.length)throw Error('请先进行聊天');
 if(!String(description||'').trim())throw Error('请描述要生成什么状态栏和包含哪些栏目');
 const ctx=await assembleContext(sessionId);const instructions=`只完成用户要求的自定义状态栏，不添加未请求的栏目，且只输出如下协议：[status:标题]栏目：内容[/status]。\n${c.statusPrompt||''}`;
 const profile={...c.chat,...Object.fromEntries(Object.entries(c.summary||{}).filter(([,v])=>v!==''&&v!=null))};
 const raw=await completion([{role:'system',content:instructions},...ctx.messages.slice(1),{role:'user',content:description}],profile);
 const parsed=parseStatusPanels(raw);if(!parsed.cards.length)throw Error('模型没有按状态栏协议输出，请尝试在对话中直接要求“用 [status:标题]…[/status] 格式生成”');
 const last=history.at(-1);return saveStatusCards(sessionId,last.id,last.ordinal,parsed.cards,true);
}
// Neutral archival instructions: a formatting aid, not a safety-policy bypass.
// The provider still receives the original source when requesting an AI summary;
// if that input is refused, stop and keep it uncovered instead of masking/retrying it.
const neutralArchiveRules='【中性事实归档】这是对既有虚构/现实聊天记录的文献式整理，不是角色扮演或继续剧情。仅记录人物、地点、时间、关系变化、重要约定、事件起因与结果。可能敏感的细节仅作非具体的高层概述，不引用刺激性台词、不复现相关情节或操作方法。若某处无法合规概括，标注“此处需要核对原文”及原消息编号。不得编造事实，也不得为了绕过上游审查修改原文。';
function classifySummaryFailure(error){
 const raw=String(error?.message||error||'');
 // Check policy-related content BEFORE HTTP status codes: a 502 proxy may wrap
 // an upstream prohibited_content response, which is not a transient outage.
 if(/AI Studio 拒绝当前输入|敏感词|内容审核|违反.*(?:安全|政策)|prohibited_content|prohibited[\s_-]*use|prompt could not be submitted|contains sensitive words|content[_\s-]*filter|safety[_\s-]*(?:block|violation)|blocked[_\s-]*prompt|policy[_\s-]*violation|violat(?:e|es|ed) (?:google['’]s )?.*policy/i.test(raw))return {kind:'policy',message:'模型上游因内容政策拒绝处理这段历史，原文未被删除、范围仍未归档。不会靠重试或改写请求绕过限制；可手动选择能够合规处理该内容的模型，或使用本地检索回看原文。'};
 if(/HTTP 401|unauthorized|invalid.api.key/i.test(raw))return {kind:'auth',message:'总结模型鉴权失败，请检查 API Key。'};
 if(/HTTP 403/i.test(raw))return {kind:'permission',message:'总结模型无访问权限，或被提供方拒绝。请检查账号及模型权限。'};
 if(/HTTP 400/i.test(raw))return {kind:'ambiguous',message:'总结请求被拒绝（HTTP 400）。可能是模型参数、模型权限或上游内容政策；请查看 AIS Proxy 同一时间的完整错误日志，确认原因后再处理。'};
 if(/HTTP 404|unknown model|model not found/i.test(raw))return {kind:'format',message:'请求格式或模型 ID 不兼容，请核对总结模型地址、模型名及 max_tokens 设置。'};
 if(/HTTP 50[234]|upstream_error|unexpected\s*EOF|timeout|超时|ECONNRESET|connection reset|socket hang up|服务暂时不可用/i.test(raw))return {kind:'transient',message:'模型服务临时异常或超时，可在未违反上游内容政策的前提下尝试缩小请求片段。'};
 return {kind:'other',message:raw.slice(0,420)};
}
// Complete-output protocol for summary models with small output-token limits.
// Never assume that a successful HTTP response means the model has finished.
const SUMMARY_COMPLETE_MARK='<<ZHIYI_ARCHIVE_DONE_V19>>';
function appendNonDuplicate(before,after){
 const prev=String(before||''),next=String(after||'').trim();if(!prev)return next;if(!next)return prev;
 if(prev.trimEnd().endsWith(next))return prev;
 let overlap=0;const max=Math.min(prev.length,next.length,400);
 for(let n=max;n>=14;n--){if(prev.slice(-n)===next.slice(0,n)){overlap=n;break;}}
 return prev.trimEnd()+(overlap?'':'\n')+next.slice(overlap);
}
function cutArchiveMarker(raw){return String(raw||'').replaceAll(SUMMARY_COMPLETE_MARK,'').trim();}
// One source slice is complete only when the finish marker is actually seen.
// A response with finish_reason="length" (or missing marker) must continue.
async function summarizeCompletePart(messages,profile,options={}){
 const conf={...profile,stream:false};
 const prompt=String(messages?.[0]?.content||'')+'\n【完结规则】逐条归档本次原文分片，不要省略末尾事件。仅在本片确实整理完毕时，在回复最后单独输出 '+SUMMARY_COMPLETE_MARK+'。如果字数达到模型上限，可以先停下，下一轮继续，不得提前输出完成标记。';
 const source=messages.slice(1).map(m=>String(m.content||'')).join('\n\n');
 let collected='',calls=0,reason='';
 const maxCalls=Math.max(2,Math.min(10,Number(options.maxContinuation)||7));
 for(let i=0;i<maxCalls;i++){
  const asking=i===0?
   [{role:'system',content:prompt},{role:'user',content:source}]:
   [{role:'system',content:prompt+'\n现在请继续上一次被截断的摘要，禁止重复已有条目，不要重新从头总结。'},
    {role:'user',content:'【仍需完整覆盖的本片原文】\n'+source+'\n\n【已完成摘要的末尾（仅用于定位接续点）】\n'+collected.slice(-2300)+'\n\n从中断处继续，不重复。写到原文分片结尾时，才输出 '+SUMMARY_COMPLETE_MARK}];
  const answer=await completionDetailed(asking,conf);
  calls++;reason=String(answer.finishReason||'');
  const raw=String(answer.text||'');
  const finish=raw.includes(SUMMARY_COMPLETE_MARK);
  const body=cutArchiveMarker(raw);
  if(!body&& !finish)throw Error('总结模型仅返回空内容，未完成归档片段');
  collected=appendNonDuplicate(collected,body);
  options.onProgress?.({continuation:calls,finishReason:reason,completed:finish});
  if(finish && collected.trim().length>=12)return {text:collected,steps:calls,verified:true};
  if(finish)throw Error('总结模型只输出完成标记，未提供足够的事实内容，不能归档');
 }
 throw Error('总结输出持续被截断（最后结束原因 '+(reason||'未提供')+'），已续写 '+calls+' 次仍没有完成标记；这段未归档，请缩小每次片段或更换输出额度更高的总结模型。');
}
function sourceBlocks(messages,blockChars){
 const limit=Math.max(650,Math.min(5000,Math.trunc(Number(blockChars)||1900)));
 const fragments=[];
 for(const msg of messages){const raw=String(msg.content||'');if(!raw){fragments.push('[第'+msg.ordinal+'条 '+msg.role+']（空白消息）');continue;}
  for(let n=0;n<raw.length;n+=limit){const index=Math.floor(n/limit)+1;fragments.push('[第'+msg.ordinal+'条 '+msg.role+' '+(msg.timestamp||'')+' 原文分片'+index+']\n'+raw.slice(n,n+limit));}
 }
 const blocks=[];let current='';const capacity=limit+180;
 for(const piece of fragments){if(current&&current.length+piece.length+2>capacity){blocks.push(current);current='';}current+=(current?'\n\n':'')+piece;}
 if(current)blocks.push(current);return blocks;
}
async function generateVerifiedSummary(messages,c,profile,options={}){
 const prompt=(options.customPrompt||c.summaryPrompt)+(c.summaryNeutralMode!==false?'\n'+neutralArchiveRules:'')+'\n每个事实尽量标注原文编号；优先保留人名、事件结果、约定及时间线，不得只写“同上”。';
 const blocks=sourceBlocks(messages,options.maxBlockChars||1900);
 const entries=[];let totalCalls=0;
 for(let i=0;i<blocks.length;i++){
  const part=await summarizeCompletePart([{role:'system',content:prompt},{role:'user',content:'当前需要完整归档的分片 '+(i+1)+'/'+blocks.length+'：\n'+blocks[i]}],profile,{maxContinuation:options.maxContinuation||7,onProgress:info=>options.onProgress?.({complete:i,total:blocks.length,part:i+1,continuation:info.continuation,completed:info.completed})});
  entries.push(part.text);totalCalls+=part.steps;
  options.onProgress?.({complete:i+1,total:blocks.length,part:i+1,continuation:part.steps,completed:true});
 }
 // Never slice the aggregate to fit another model request; preserving every
 // verified source-part is more important than a short, lossy overview.
 const content=entries.length===1?entries[0]:'【全部原文分片已完整校验 · '+entries.length+' 份】\n\n'+entries.map((p,i)=>'【分片'+(i+1)+'/'+entries.length+'】\n'+p).join('\n\n');
 return {content,blocks:blocks.length,totalCalls,completionVerified:true};
}
async function storeVerifiedSummary(record){
 const chunk={id:'summary:'+record.id,sessionId:record.sessionId,ordinal:record.endOrdinal,text:record.content,kind:'summary',summaryId:record.id,timestamp:record.createdAt};
 if(Store.putSummaryAtomic)await Store.putSummaryAtomic(record,chunk);
 else {await Store.put('summaries',record);await Store.put('chunks',chunk);}
}
async function summarizeRange(sessionId,startOrdinal,endOrdinal,customPrompt=''){
 if(locks.has(sessionId))throw Error('另一个总结/补全任务正在执行');locks.add(sessionId);
 try{const c=await settings(),messages=(await Store.orderedMessages(sessionId)).filter(x=>['user','assistant'].includes(x.role)&&x.ordinal>=startOrdinal&&x.ordinal<=endOrdinal);if(!messages.length)throw Error('所选原文范围没有消息');if(messages.length>500)throw Error('单次手动总结最多 500 条，请分段总结');
 const profile={...c.chat,...Object.fromEntries(Object.entries(c.summary||{}).filter(([,v])=>v!==''&&v!==null&&v!==undefined))};
 profile.maxTokens=Math.min(2400,Math.max(450,Number(profile.maxTokens)||1200));
 const verified=await generateVerifiedSummary(messages,c,profile,{customPrompt,maxBlockChars:1900});
 const item={id:uuid(),sessionId,createdAt:now(),startOrdinal:messages[0].ordinal,endOrdinal:messages.at(-1).ordinal,messageCount:messages.length,content:verified.content,sourceIds:messages.map(x=>x.id),model:profile.model,version:2,manual:true,completionVerified:true,verifiedParts:verified.blocks,continuationCalls:verified.totalCalls};
 await storeVerifiedSummary(item);return {summary:item};
 }finally{locks.delete(sessionId);}
}
function summaryNeedsReview(item){return !!item&&!item.completionVerified&&!item.coverageUnknown&&!item.legacy&&Number(item.endOrdinal)>=Number(item.startOrdinal);}
async function repairSummary(sessionId,summaryId,onProgress=()=>{}){
 if(locks.has(sessionId))throw Error('请先等待上一份总结完成，不能同时修复多份');locks.add(sessionId);
 try{const old=await Store.get('summaries',summaryId);if(!old||old.sessionId!==sessionId)throw Error('找不到当前会话的总结');
 if(!summaryNeedsReview(old))return {skipped:true,reason:'已校验完成，或无法确定原文范围'};
 const all=(await Store.orderedMessages(sessionId)).filter(m=>m.role==='user'||m.role==='assistant');
 const ids=new Set(old.sourceIds||[]);let source=all.filter(m=>ids.has(m.id));
 if(!source.length)source=all.filter(m=>m.ordinal>=old.startOrdinal&&m.ordinal<=old.endOrdinal);
 if(!source.length)throw Error('这份旧总结对应的原文已经不存在，不能凭空补写');
 const c=await settings(),profile={...c.chat,...Object.fromEntries(Object.entries(c.summary||{}).filter(([,v])=>v!==''&&v!==null&&v!==undefined))};
 profile.maxTokens=Math.min(2400,Math.max(450,Number(profile.maxTokens)||1200));
 const verified=await generateVerifiedSummary(source,c,profile,{maxBlockChars:1900,onProgress});
 // Previous text is permanently preserved inside this record for comparison.
 const revised={...old,content:verified.content,model:profile.model,version:Math.max(1,Number(old.version)||1)+1,completionVerified:true,verifiedParts:verified.blocks,continuationCalls:verified.totalCalls,checkedAt:now(),repairCount:(old.repairCount||0)+1,previousVersions:[...(old.previousVersions||[]),{content:old.content,model:old.model,archivedAt:old.createdAt,replacedAt:now()}]};
 await storeVerifiedSummary(revised);
 if(Store.all&&Store.del){for(const v of (await Store.all('vectors')).filter(v=>v.chunkId==='summary:'+revised.id))await Store.del('vectors',v.id);}
 return {summary:revised};
 }finally{locks.delete(sessionId);}
}
// The bottom model switch is a per-session override, not a global endpoint change.
// The summary and embedding profiles remain independent from chat selection.
function chatProfileForSession(config,session){
 const preset=(config.modelProfiles||[]).find(p=>p.id===session?.chatModelId&&p.type==='chat');
 const override=preset?{url:preset.url,key:preset.key||'',model:preset.model,temperature:preset.temperature??config.chat.temperature,topP:preset.topP??config.chat.topP,maxTokens:preset.maxTokens??config.chat.maxTokens,maxTokensField:preset.maxTokensField||'max_tokens',stream:preset.stream??false,thinkingEnabled:preset.thinkingEnabled??true}:{};
 return {...config.chat,...(config.generation||{}),...override,...(session?.generation||{})};
}
async function reply(sessionId,onChunk=null,options={}){
 const context=await assembleContext(sessionId);
 let regenTarget=null;
 if(options.regenerateTargetId){regenTarget=await Store.get('messages',options.regenerateTargetId);if(!regenTarget||regenTarget.sessionId!==sessionId||regenTarget.role!=='assistant')throw Error('只能重新生成当前会话的 AI 回复');
  const all=await Store.orderedMessages(sessionId);if(all.at(-1)?.id!==regenTarget.id)throw Error('为避免串线，只能重新回答最后一条 AI 消息；旧消息可切换已有分支');
  const at=context.messages.findLastIndex(x=>x.role==='assistant'&&x.content===regenTarget.content);if(at>=0)context.messages.splice(at,1);
 }

 const lastUser=(await Store.orderedMessages(sessionId)).filter(x=>x.role==='user').at(-1)?.content||'';
 context.messages[0].content+=statusInstructions(await settings(),lastUser);
 const sess=await Store.get('sessions',sessionId);const base=await settings();const conf=chatProfileForSession(base,sess);const generated=await completionDetailed(context.messages,conf,onChunk);let content=generated.text;if(conf.thinkingEnabled===false)content=content.replace(/<think>[\s\S]*?<\/think>/gi,'').trim();
 let parsed=parseStatusPanels(content);
 // Some chat models ignore formatting instructions. Try one structured follow-up only for explicit requests.
 if(isStatusRequest(lastUser)&&!parsed.cards.length){
  try{const retry=await completion([{role:'system',content:'把用户要求的状态栏整理成 [status:标题]内容[/status]；只输出状态栏，不要输出其他文字，不要固定栏目。'},{role:'user',content:'用户要求：'+lastUser+'\n模型原始回答：'+content}],conf);
   const second=parseStatusPanels(retry);if(second.cards.length)parsed={clean:parsed.clean,cards:second.cards};
  }catch(e){console.warn('状态栏格式重试失败',e);}
 }
 const outputText=parsed.clean||((parsed.cards.length)?'（已生成所需状态栏）':content);
 if(regenTarget){
  const oldVersion={id:regenTarget.sourceId||regenTarget.id,role:'assistant',content:regenTarget.content,timestamp:regenTarget.timestamp,reasoning:regenTarget.reasoning||'',rawParts:regenTarget.rawParts||null,attachments:regenTarget.attachments||[]};
  const variants=regenTarget.branchVariants?.length?regenTarget.branchVariants:[oldVersion];
  variants.push({id:null,role:'assistant',content:outputText,timestamp:now(),reasoning:'',rawParts:null,attachments:[]});
  regenTarget.branchVariants=variants;regenTarget.branchIndex=variants.length-1;regenTarget.content=outputText;regenTarget.tokenUsage=generated.usage;regenTarget.editedAt=now();
  await Store.put('messages',regenTarget);const chunk=chunkFor(regenTarget);if(chunk)await Store.put('chunks',chunk);await invalidateVectors('chunk:'+regenTarget.id);
  const sess=await Store.get('sessions',sessionId);if(sess){sess.lastMessageAt=now();sess.updatedAt=now();sess.updatedLocally=true;await Store.put('sessions',sess);}
  return {...regenTarget,notebookError:null,recalled:context.results,contextSent:context.contextSent,statusCards:parsed.cards.length};
 }
 const response=await appendMessage(sessionId,'assistant',outputText);
 response.tokenUsage=generated.usage;await Store.put('messages',response);
 await saveStatusCards(sessionId,response.id,response.ordinal,parsed.cards);
 let notebookError=null;if(typeof Notebook!=='undefined'){try{const lastUser=(await Store.orderedMessages(sessionId)).filter(m=>m.role==='user').at(-1);await Notebook.recordTurn(sessionId,lastUser,response);}catch(e){notebookError=e.message;console.warn('记事本本轮归档失败，主聊天记录仍已保留',e);}}
 return {...response,notebookError,recalled:context.results,contextSent:context.contextSent,statusCards:parsed.cards.length};
}
// Find uncovered older messages instead of looking only beyond the latest summary.
// Existing archive records are immutable; short trailing segments may be backfilled too.
async function backfillPlan(sessionId,options={}){
 const c={...(await settings()),...((await Store.get('sessions',sessionId))?.memory||{})};
 const messages=(await Store.orderedMessages(sessionId)).filter(m=>m.role==='user'||m.role==='assistant');
 // Manual range summaries also count as covered history; otherwise the
 // fresh-import action would duplicate a previously archived manual range.
 const archives=await Store.inSession('summaries',sessionId);
 const byId=new Set(),ranges=[];
 for(const sm of archives){
  if(Array.isArray(sm.sourceIds)&&sm.sourceIds.length)sm.sourceIds.forEach(id=>byId.add(id));
  else if(Number.isFinite(Number(sm.startOrdinal))&&Number.isFinite(Number(sm.endOrdinal)))ranges.push([Number(sm.startOrdinal),Number(sm.endOrdinal)]);
 }
 const covered=m=>byId.has(m.id)||ranges.some(([a,b])=>m.ordinal>=a&&m.ordinal<=b);
 let first=-1,segment=[];
 const desired=Number(options.maxMessages)||Number(c.backfillBatchSize)||20;
 const limit=Math.min(100,Math.max(1,Math.trunc(desired)));
 const charLimit=Number(options.maxSourceChars)>0?Math.max(1800,Number(options.maxSourceChars)):Infinity;let chars=0;
 for(let i=0;i<messages.length;i++){
  if(covered(messages[i])){if(first>=0)break;continue;}
  if(first>=0&&chars+String(messages[i].content||'').length>charLimit)break;
  if(first<0)first=i;
  segment.push(messages[i]);chars+=String(messages[i].content||'').length;
  if(segment.length>=limit)break;
 }
 const coveredCount=messages.filter(covered).length;
 return {segment,total:messages.length,covered:coveredCount,remaining:messages.length-coveredCount,need:limit,
  firstOrdinal:segment[0]?.ordinal||null,lastOrdinal:segment.at(-1)?.ordinal||null};
}
async function canSummarize(sessionId,force=false){const c={...(await settings()),...((await Store.get('sessions',sessionId))?.memory||{})};const messages=(await Store.orderedMessages(sessionId)).filter(x=>x.role==='user'||x.role==='assistant');const sums=(await Store.inSession('summaries',sessionId)).filter(x=>!x.manual).sort((a,b)=>a.endOrdinal-b.endOrdinal);const last=sums.at(-1)?.endOrdinal||0;const pending=messages.filter(m=>m.ordinal>last);return {pending,last,need:Math.max(1,Number(c.summaryEvery)||50),ready:force?pending.length>0:pending.length>=Math.max(1,Number(c.summaryEvery)||50),sums};}
async function summarize(sessionId,force=false,options={}){if(locks.has(sessionId))return {skipped:true,reason:'另一个总结任务正在执行'};locks.add(sessionId);try{const c={...(await settings()),...((await Store.get('sessions',sessionId))?.memory||{})};const item=await canSummarize(sessionId,force);const backfill=options?.backfill?await backfillPlan(sessionId,options):null;if(!backfill&&!item.ready)return {skipped:true,reason:`距离下次总结还差 ${Math.max(0,item.need-item.pending.length)} 条`};if(backfill&&!backfill.segment.length)return {skipped:true,reason:'这段对话的历史消息已经全部归档'};const segment=backfill?backfill.segment:item.pending.slice(0,item.need);const lastSummary=backfill?item.sums.filter(x=>x.endOrdinal<segment[0].ordinal).at(-1):item.sums.at(-1);const previous=lastSummary?`\n上次累计状态（只用于延续情节，不得修改旧总结）：\n${lastSummary.content.slice(0,options.backfill?500:3800)}`:'';const summaryProfile={...c.chat,...Object.fromEntries(Object.entries(c.summary||{}).filter(([k,v])=>v!==''&&v!==null&&v!==undefined))};
// Output limit is provider-dependent. Never mark a batch archived until ALL
// fragments have completed and the provider has emitted the completion marker.
summaryProfile.maxTokens=Math.min(2400,Math.max(450,Number(summaryProfile.maxTokens)||1200));
const complete=await generateVerifiedSummary(segment,c,summaryProfile,{maxBlockChars:options.backfill?Math.min(2200,Math.max(800,Number(options.maxBlockChars)||1900)):1900,onProgress:options.onProgress});
const rec={id:uuid(),sessionId,createdAt:now(),startOrdinal:segment[0].ordinal,endOrdinal:segment.at(-1).ordinal,messageCount:segment.length,content:complete.content,sourceIds:segment.map(x=>x.id),model:summaryProfile.model,version:2,completionVerified:true,verifiedParts:complete.blocks,continuationCalls:complete.totalCalls};
await storeVerifiedSummary(rec);return {summary:rec};
}finally{locks.delete(sessionId);}}
async function autoSummarize(sessionId,notify=()=>{}){try{const check=await canSummarize(sessionId);if(check.ready){const result=await summarize(sessionId);if(result.summary)notify(`新增总结已存档：第 ${result.summary.startOrdinal}～${result.summary.endOrdinal} 条`);}return true;}catch(e){notify('自动总结未完成：'+e.message);return false;}}
async function exportArchive(){const zip=new JSZip();const sessions=await Store.all('sessions');const manifest={format:'recallchat-archive',formatVersion:1,exportedAt:now(),sessionCount:sessions.length};zip.file('manifest.json',JSON.stringify(manifest,null,2));for(const s of sessions){const msgs=await Store.orderedMessages(s.id);const sums=await Store.inSession('summaries',s.id);zip.file('sessions/'+encodeURIComponent(s.id)+'/session.json',JSON.stringify({session:s,messages:msgs,summaries:sums,statusCards:await Store.inSession('statusCards',s.id),notebookEntries:await Store.inSession('notebookEntries',s.id),notebookVolumes:await Store.inSession('notebookVolumes',s.id)}));}
const resources=await Store.all('assets');for(const a of resources){if(a.bytes)zip.file('resources/'+encodeURIComponent(a.id),a.bytes);}const current=await settings();const safeCfg=JSON.parse(JSON.stringify(current));for(const category of ['chat','summary','embedding']){if(safeCfg[category])safeCfg[category].key='';}for(const profile of safeCfg.modelProfiles||[]){profile.key='';}zip.file('settings.json',JSON.stringify(safeCfg));return zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:5}});}
async function restoreOwnArchive(file,onProgress=()=>{}){const zip=await JSZip.loadAsync(file);const arr=Object.values(zip.files).filter(x=>/sessions\/[^/]+\/session\.json$/.test(x.name));const settingsFile=zip.file('settings.json');if(settingsFile){const saved=JSON.parse(await settingsFile.async('string'));const current=await settings();for(const category of ['chat','summary','embedding']){if(saved[category])saved[category].key=current[category]?.key||'';}for(const profile of saved.modelProfiles||[]){profile.key=(current.modelProfiles||[]).find(x=>x.id===profile.id)?.key||'';}await saveSettings({...current,...saved});}const assets=Object.values(zip.files).filter(x=>!x.dir&&x.name.startsWith('resources/'));for(const a of assets){const id=decodeURIComponent(a.name.slice('resources/'.length));const bytes=await a.async('uint8array');await Store.put('assets',{id,filename:id,bytes,size:bytes.length});}let total=0;for(let i=0;i<arr.length;i++){const b=JSON.parse(await arr[i].async('string'));if(!b?.session?.id||!Array.isArray(b.messages))continue;await Store.put('sessions',b.session);await Store.putMany('messages',b.messages);await Store.putMany('summaries',b.summaries||[]);await Store.putMany('statusCards',b.statusCards||[]);await Store.putMany('notebookEntries',b.notebookEntries||[]);await Store.putMany('notebookVolumes',b.notebookVolumes||[]);await Store.putMany('chunks',b.messages.map(chunkFor).filter(Boolean));for(const x of (b.notebookEntries||[]))await Store.put('chunks',{id:'chunk:'+x.id,sessionId:x.sessionId,ordinal:x.userOrdinal,text:x.text,kind:'notebookEvent',messageId:x.sourceUserId,timestamp:x.createdAt,localVec:hashedVec(x.text)});for(const x of (b.notebookVolumes||[]).filter(x=>x.status==='complete'))await Store.put('chunks',{id:'chunk:'+x.id,sessionId:x.sessionId,ordinal:x.sourceOrdinals?.at(-1)||0,text:x.summary,kind:'notebookVolume',timestamp:x.updatedAt,localVec:hashedVec(x.summary)});total++;onProgress(i+1,arr.length,`恢复 ${i+1}/${arr.length}`);}return total;}
return {sourcePin,sourceTime,rawMessageVariants,chatboxForkProject,chatboxV3ToSession,normalizeChatboxForkRows,switchChatboxBranch,settings,saveSettings,listModels,testModel,endpoint,makeChatBody,editMessage,deleteMessage,complete:completion,createSession,appendMessage,importFile,previewImportFile,importRikkaBatch,parseStatusPanels,isStatusRequest,saveStatusCards,generateStatusCards,summarizeRange,repairSummary,summaryNeedsReview,summarizeCompletePart,backfillPlan,classifySummaryFailure,resolveSessionObjects,importSessions,search,assembleContext,reply,summarize,autoSummarize,canSummarize,buildVectors,exportArchive,restoreOwnArchive,chunkFor,hashedVec,cosine,tok,queryAnchors,buildHistoricalTimeline,uuid,now};})();
