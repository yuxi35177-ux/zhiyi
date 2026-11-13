/* 知忆 responsive UI. No external resources or accounts are needed to browse archives. */
const UI=(()=>{
const root=document.getElementById('app');const picker=document.getElementById('import-picker'),attachPicker=document.getElementById('attach-picker'),avatarPicker=document.getElementById('avatar-picker'),roleAvatarBatchPicker=document.getElementById('role-avatar-batch-picker');
let activeRoleName='AI',avatarUploadTarget=null,avatarBatchTarget=null,avatarBatchMessage='';let config,sessionId=null,allSessions=[],page='chat',drawer=false,dialog='',busy=false,showLimit=100,pendingAttachments=[],searchQuery='',searchResults=[],lastRecall=[],statusMessage='',backfillStatus='',importProgress=0,progressMax=0,drafts=new Map(),importCandidate=null,importSessionList=[],importKind='',lastResponseStats=null;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const attName=a=>(a?.name||a?.filename||'文件');const icons={chat:'◈',memory:'◉',prompts:'✦',settings:'⚙'};
function toast(text){const el=document.getElementById('toast');el.textContent=text;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),4600);}
function humanTime(t){if(!t)return '';try{const d=new Date(typeof t==='number'&&t<1e12?t*1000:t);if(isNaN(d.getTime()))return '';return d.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});}catch{return '';}}
function theme(){
 const deviceDark=window.matchMedia?.('(prefers-color-scheme: dark)').matches||false;
 const mode=config.theme||'system';
 document.body.classList.toggle('dark',mode==='dark'||mode==='amoled'||(mode==='system'&&deviceDark));
 document.body.classList.toggle('amoled',mode==='amoled');
 const scale=Math.max(.8,Math.min(1.6,Number(config.fontSize)||1));
 document.documentElement.style.setProperty('--font-scale',String(scale));
 const meta=document.querySelector('meta[name="theme-color"]');
 if(meta)meta.setAttribute('content',document.body.classList.contains('dark')?'#101511':'#f6f8f5');
}
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{if(config?.theme==='system')theme();});
// Imported sessions were previously sorted by their ZIP import time, which is
// unrelated to the chronology of the conversation. Migrate a last-message date
// once, without rewriting the original messages or changing the import source.
function dateMillis(value){if(value==null||value==='')return 0;const v=typeof value==='number'?value:/^\d{10,13}$/.test(String(value))?Number(value):Date.parse(value);const n=Number(v);return Number.isFinite(n)&&n>0?(n<1e11?n*1000:n):0;}
function sessionActivity(s){return dateMillis(s.lastMessageAt)||dateMillis(s.createdAt)||dateMillis(s.updatedAt)||0;}
function compareSessions(a,b){
 // Pinned conversations are always first; within the unpinned group, ONLY the
 // most recent real conversation message determines position.
 if(!!a.pinned!==!!b.pinned)return a.pinned?-1:1;
 if(a.pinned&&b.pinned){const pinGap=dateMillis(b.pinnedAt)-dateMillis(a.pinnedAt);if(pinGap)return pinGap;}
 return sessionActivity(b)-sessionActivity(a)||String(a.name||'').localeCompare(String(b.name||''),'zh-CN');
}
async function refreshSessions(){
 allSessions=await Store.all('sessions');
 for(const s of allSessions){
  // One-time migration of existing local/imported chats. Older builds used the
  // import timestamp or last ordinal, which can disagree with message dates.
  if(s.sortDateVersion!==25){
   const stamp=await Store.latestMessageTimestamp(s.id);
   s.lastMessageAt=stamp?new Date(stamp).toISOString():null;
   s.sortDateChecked=true;s.sortDateVersion=25;await Store.put('sessions',s);
  }
 }
 allSessions.sort(compareSessions);
 if(!allSessions.some(x=>x.id===sessionId))sessionId=allSessions[0]?.id||null;
}
async function start(){await Store.open();config=await Engine.settings();theme();await refreshSessions();if(!allSessions.length){const s=await Engine.createSession();allSessions=[s];sessionId=s.id;}await render();BackupUI.init();if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});}
function safeAvatar(value){const v=String(value||'');return /^data:image\/(?:jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(v)&&v.length<850000?v:'';}
function avatarHtml(value,label,cls=''){const src=safeAvatar(value);return src?`<img class="portrait ${cls}" alt="${esc(label||'头像')}" src="${src}">`:`<span class="portrait portrait-placeholder ${cls}" aria-label="${esc(label||'头像')}">${esc([...String(label||'人')][0])}</span>`;}
function modelForChat(session){const profiles=(config.modelProfiles||[]).filter(x=>x.type==='chat');return profiles.find(x=>x.id===session?.chatModelId)||profiles.find(x=>x.id===config.activeModels?.chat)||null;}
function chatModelSelect(session){const choices=(config.modelProfiles||[]).filter(x=>x.type==='chat');const own=choices.some(x=>x.id===session?.chatModelId)?session.chatModelId:'';const defaultName=modelForChat({})?.name||config.chat?.model||'未配置模型';return `<label class="sr-only" for="chatModelSwitch">当前会话聊天模型</label><select class="chat-model-switch" id="chatModelSwitch" aria-label="切换当前对话模型" ${busy?'disabled':''}><option value="" ${!own?'selected':''}>默认 · ${esc(defaultName)}</option>${choices.map(m=>`<option value="${esc(m.id)}" ${own===m.id?'selected':''}>${esc(m.name||m.model)}</option>`).join('')}</select>`;}
async function imageDataForAvatar(file){
 if(!file?.type?.startsWith('image/'))throw Error('请选择图片文件');
 if(file.size>8*1024*1024)throw Error('头像图片不得超过 8 MB');
 const url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('读取头像失败'));reader.readAsDataURL(file);});
 const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('无法解析此图片'));img.src=url;});
 const scale=Math.min(1,384/Math.max(image.width,image.height));const c=document.createElement('canvas');c.width=Math.max(1,Math.round(image.width*scale));c.height=Math.max(1,Math.round(image.height*scale));const ctx=c.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(image,0,0,c.width,c.height);
 const data=c.toDataURL('image/jpeg',.83);if(!safeAvatar(data))throw Error('头像编码异常');return data;
}
function head(title,subtitle=''){return `<header class="top compact-top"><button class="iconbtn" data-action="${page==='chat'?'drawer':'back'}" title="${page==='chat'?'会话列表':'返回'}">${page==='chat'?'☰':'‹'}</button><div class="topmeta"><strong>${esc(title)}</strong><small>${esc(subtitle)}</small></div>${page==='chat'?`<button class="iconbtn" data-action="summary-panel" title="全部历史总结">▤</button><button class="iconbtn" data-action="plus-menu" title="添加、提示词、状态栏、设置">＋</button>`:`<button class="iconbtn" data-action="plus-menu" title="功能菜单">＋</button>`}</header>`;}
function toolbar(){return ''; }
function drawerHtml(){if(!drawer)return '';return `<div class="side-shade" data-action="drawer"></div><aside class="sidebar"><div class="sidehead"><strong>知忆 · 会话</strong><button class="iconbtn" data-action="drawer">×</button></div><div class="drawer-shortcuts"><button class="action" data-action="new-chat">＋ 新建聊天</button><button class="action secondary" data-action="go-memory">生成新总结</button><button class="minor" data-action="bulk-role-avatar">批量角色头像</button></div><div class="session-sort-hint">置顶优先 · 其他对话按最后消息时间从新到旧排序</div><div class="sessionlist">${allSessions.map(s=>`<div class="sessionrow ${s.id===sessionId?'active':''}" data-session-row="${esc(s.id)}">${avatarHtml(s.characterAvatarData,s.characterName||s.name,'session-portrait')}<button class="sessionmain" data-action="select-session" data-session="${esc(s.id)}"><strong>${s.pinned?'<span class="pinned-label">置顶</span>':''}${esc(s.name)}</strong><small>${esc(s.source==='rikka'||s.source==='rikkahub'?'聊天备份':s.source==='chatbox'?'聊天备份':'知忆本地')} · ${esc(s.messageCount||0)} 条 · ${esc(humanTime(s.lastMessageAt||s.updatedAt))}</small></button><button class="session-pin" data-action="toggle-pin" data-session="${esc(s.id)}" title="${s.pinned?'取消置顶':'置顶对话'}" aria-label="${s.pinned?'取消置顶':'置顶对话'}">${s.pinned?'★':'☆'}</button><button class="minor" data-action="edit-role" data-session="${esc(s.id)}" title="编辑角色/会话">编辑</button></div>`).join('')}</div><div class="sidebarfoot"><button class="minor" data-action="go" data-page="memory">长期记忆</button><button class="minor" data-action="go" data-page="settings">设置 / 导入</button></div></aside>`;}
const notFound='<div class="empty"><div class="hero">◈</div><h2>记忆，从这里开始</h2><p>聊天记录永久保留，自动总结另存一份。你也可以导入 聊天工具 的 ZIP 备份。</p><button class="action" data-action="import">导入 聊天备份 记录</button></div>';
function renderBody(content){
 const raw=String(content||'');
 if(!config.markdownEnabled)return esc(raw);
 return raw.split(/(```[\s\S]*?```)/g).map(block=>{
  if(block.startsWith('```')){
   const code=block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '');
   return config.collapseCode?`<details class="codefold"><summary>代码块 · 点击展开</summary><pre><code>${esc(code)}</code></pre></details>`:`<pre><code>${esc(code)}</code></pre>`;
  }
  return esc(block).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\n/g,'<br>');
 }).join('');
}
function statusText(v){return renderBody(String(v||'').replace(/<\/?br\s*\/?>/gi,'\n'));}
// Historical 聊天备份 status-card data often contains original <p>/<br>
// tags AND real blank lines. Normalize the *displayed copy* only. Never write
// back to messages, imported status cards, notebook entries, or exported files.
function compactNotebookSpacing(value){
 const str=String(value??'')
  .replace(/&(?:nbsp|#160|#xA0);/gi,' ')
  .replace(/&lt;br\s*\/?\s*&gt;/gi,'\n')
  .replace(/<\/?br\b[^>]*>/gi,'\n')
  .replace(/<\/(?:p|div|li)\s*>/gi,'\n')
  .replace(/<(?:p|div|li)\b[^>]*>/gi,'\n')
  .replace(/\r\n?/g,'\n');
 const lines=str.split('\n');
 // Top-level numbered sections, not subitems such as "1." or "①".
 const major=/^\s*(?:(?:#{1,6}\s*)|(?:\*\*\s*))?(?:[一二三四五六七八九十百零两]{1,6}\s*[：:、．.]|第[一二三四五六七八九十百零两\d]{1,6}\s*(?:章|节|卷|部分)\s*[：:、．.]?)/u;
 const result=[];
 for(const original of lines){
  const line=original.replace(/[\t\u00a0 ]+$/g,'').trim();
  if(!line)continue; // Flatten redundant paragraphs within the same section.
  if(result.length&&major.test(line))result.push(''); // One blank before a new major heading.
  result.push(line);
 }
 return result.join('\n');
}
function isImportedNotebookLike(card){
 const title=String(card?.title||'');
 const content=String(card?.content||'');
 if(/(?:记事本|待办事项|任务清单|备忘录|事项清单|故事档案)/.test(title))return true;
 return /(?:^|\n)\s*[一二三四五六七八九十]{1,4}[：:、．.]/u.test(content) && /(?:^|\n)\s*(?:\d+[.、．]|[①②③④⑤⑥⑦⑧⑨⑩])/u.test(content);
}
function notebookStatusText(value){const clean=compactNotebookSpacing(value);return config.markdownEnabled?renderBody(clean):esc(clean).replace(/\n/g,'<br>');}
function tokenDisplay(m){
 const u=m.tokenUsage||m.raw?.usage||null;if(!u)return '';
 const n=v=>Number.isFinite(Number(v))&&Number(v)>=0?Math.round(Number(v)):null;
 const input=n(u.input??u.prompt_tokens??u.input_tokens),output=n(u.output??u.completion_tokens??u.output_tokens);
 const sum=n(u.total??u.total_tokens)??((input!==null&&output!==null)?input+output:null);
 if(sum===null&&input===null&&output===null)return '';
 const quality=u.source==='estimate'?'约 / 估算':u.source==='api'?'API 用量':'Token 用量';
 return `<span class="token-usage" title="${esc(u.source==='estimate'?'接口未提供精确用量，这是按发送内容与回复内容粗略估算的 Token。':'模型接口返回的 Token 用量。')}">${esc(quality)}：${input===null?'':`输入 ${input} · `}${output===null?'':`输出 ${output} · `}合计 ${sum===null?'—':sum} Token</span>`;
}
function notepadRender(entries,volumes,embedded=true){
 const complete=volumes.filter(x=>x.status==='complete').length;
 if(!entries.length)return '<div class="card muted">本会话尚未生成记事本记录。开启记事本后，每个新回复都会存一条事件。</div>';
 const chapterCount=Math.ceil(entries.length/10);
 const chapters=Array.from({length:chapterCount},(_,i)=>{
  const n=i+1,group=entries.filter(e=>e.volume===n),v=volumes.find(x=>x.volume===n),title=`第${Notebook.chapterName(n)}卷`;
  const summary=v?.status==='complete'?`<div class="notebook-summary"><strong>本卷总结（${Array.from(v.summary).length} 字）</strong><div>${notebookStatusText(v.summary)}</div></div>`:`<div class="notebook-summary muted">${group.length===10?'本卷已满，卷总结待生成，可手动重试':'本卷未满十条，满卷后自动生成100至200字的卷首总结'}</div>`;
  return `<details class="notebook-chapter" ${n===chapterCount&&embedded?'open':''}><summary>${title}：${group.length}/10条 · ${v?.status==='complete'?'已归档总结':'总结待生成'}</summary>${summary}${group.map(e=>`<div class="notebook-line"><span>${e.index}.</span><div>${notebookStatusText(e.text)}<div><button class="minor" data-action="jump-note" data-ord="${e.userOrdinal}">查看原文 #${e.userOrdinal}</button></div></div></div>`).join('')}${group.length===10&&v?.status!=='complete'?`<div class="btnrow"><button class="minor" data-action="retry-notebook-volume" data-volume="${n}">重新生成本卷总结</button></div>`:''}</details>`;
 }).join('');
 return `<details class="notebook-root" ${embedded?'':'open'}><summary><span class="status-diamond">◈</span><strong>记事本</strong><span class="muted smalltext">累计 ${entries.length} 条 · ${chapterCount} 卷 · 已完成 ${complete} 份卷总结</span></summary><div class="notebook-content">${chapters}</div></details>`;
}
function renderImportedStatus(card){
 const raw=String(card.content||'');
 if(!/记事本/.test(card.title)||!/(?:第[一二三四五六七八九十\d]+卷|卷[一二三四五六七八九十\d]+)[：:]/.test(raw))return isImportedNotebookLike(card)?notebookStatusText(raw):statusText(raw);
 const labels=/(?:第[一二三四五六七八九十\d]+卷|卷[一二三四五六七八九十\d]+)[：:][^\n]*/g;
 const matches=[...raw.matchAll(labels)];if(!matches.length)return statusText(raw);
 const intro=raw.slice(0,matches[0].index).trim();
 return (intro?`<div class="notebook-summary">${notebookStatusText(intro)}</div>`:'')+matches.map((m,i)=>{
  const text=raw.slice(m.index,(matches[i+1]?.index??raw.length)).trim();
  const line=text.split('\n');
  return `<details class="notebook-chapter imported-volume"><summary>${esc(line[0])}</summary><div class="notebook-content">${notebookStatusText(line.slice(1).join('\n'))}</div></details>`;
 }).join('');
}
function messageVariants(m){
 if(Array.isArray(m.branchVariants)&&m.branchVariants.length>1)return m.branchVariants;
 const older=m.raw?.alternatives;
 if(!Array.isArray(older)||older.length<2)return [];
 return older.map(v=>{const parts=Array.isArray(v?.parts)?v.parts:[];
  return {id:v?.id||null,role:v?.role||m.role,content:parts.map(x=>x.type==='text'?x.text||'':x.type==='image'?'[图片]':x.type==='tool'?'[工具调用]':'').filter(Boolean).join('\n'),reasoning:parts.filter(x=>x.type==='reasoning').map(x=>x.reasoning||'').join('\n'),timestamp:v?.createdAt||m.timestamp,rawParts:parts,attachments:parts.filter(x=>x.type==='image').map(x=>({name:'图片',type:'image/*',sourceUrl:x.url||'',source:{...x}}))};
 });
}
function activeBranchIndex(m,variants){if(!variants.length)return 0;if(Number.isInteger(m.branchIndex)&&m.branchVariants?.length)return Math.min(Math.max(0,m.branchIndex),variants.length-1);const idx=variants.findIndex(v=>v.content===m.content);return idx>=0?idx:0;}
function msgHtml(m,cards=[],notebookSlot='',session=null){
 const legacy=(m.role==='assistant'&&!cards.length)?Engine.parseStatusPanels(m.content||''):null;
 const messageText=legacy?legacy.clean:m.content;
 const displayCards=legacy?[...cards,...legacy.cards]:cards;
 const hasImages=(m.attachments||[]).filter(x=>x.type?.startsWith('image/')&&x.dataUrl);
 const sRole=m.role==='assistant'?activeRoleName:m.role==='user'?'我':m.role==='system'?'系统':m.role;
 const variants=messageVariants(m),selected=activeBranchIndex(m,variants);
 const branchControls=variants.length>1?`<div class="branch-controls" aria-label="消息回复版本"><button data-action="switch-message-branch" data-id="${esc(m.id)}" data-step="-1" ${selected===0?'disabled':''} title="上一版本">‹</button><span>${selected+1} / ${variants.length}</span><button data-action="switch-message-branch" data-id="${esc(m.id)}" data-step="1" ${selected===variants.length-1?'disabled':''} title="下一版本">›</button></div>`:'';
 const body=`${messageText?renderBody(messageText):''}${displayCards.map(card=>`<details class="status-card"><summary><span class="status-diamond">◈</span><strong>${esc(card.title)}</strong><span class="status-chevron">展开</span></summary><div class="status-card-text">${renderImportedStatus(card)}</div></details>`).join('')}${notebookSlot}${m.reasoning&&config.generation?.thinkingEnabled!==false?`<details style="margin-top:9px"><summary class="muted smalltext">思考内容（点击展开）</summary><p>${esc(m.reasoning)}</p></details>`:''}${(m.attachments||[]).filter(a=>!a.dataUrl).map(a=>`<div class="smalltext muted">📎 ${esc(a.name)}</div>`).join('')}${hasImages.map(a=>`<img alt="${esc(a.name)}" src="${esc(a.dataUrl)}">`).join('')}`;
 return `<div class="msg ${m.role==='user'?'user':''}" data-message="${esc(m.id)}" id="msg-${esc(m.ordinal)}"><div class="message-layout"><div class="message-avatar-column">${avatarHtml(m.role==='assistant'?session?.characterAvatarData:m.role==='user'?(session?.userAvatarData||config.userAvatarData):'',sRole,'message-portrait')}</div><div class="message-main"><div class="msgrole"><span>${esc(sRole)} · #${esc(m.ordinal)}${m.editedAt?' · 已编辑':''}</span></div><div class="bubble">${body}</div><div class="message-footer"><div class="message-actions">${m.role==='assistant'?`<button data-action="regenerate-message" data-id="${esc(m.id)}" aria-label="重新回答" title="重新回答">↻</button>`:''}<button data-action="edit-message" data-id="${esc(m.id)}" aria-label="编辑" title="编辑">✎</button><button data-action="copy-message" data-id="${esc(m.id)}" aria-label="复制" title="复制">▣</button><button data-action="message-menu" data-id="${esc(m.id)}" aria-label="更多操作" title="更多操作">⋮</button></div>${branchControls}</div><div class="msgtime">${esc(humanTime(m.timestamp))}${m.role==='assistant'?tokenDisplay(m):''}</div></div></div></div>`;
}

function summaryMarker(s){return `<div class="card summary" id="sum-${esc(s.id)}"><div class="cardrow"><span class="tag">${s.completionVerified?'已完成校验':'旧档案待校验'} · 第 ${esc(s.startOrdinal)}—${esc(s.endOrdinal)} 条</span><button class="minor" data-action="summary-detail" data-id="${esc(s.id)}">阅读全文 →</button></div><p style="white-space:pre-wrap;max-height:75px;overflow:hidden">${esc(s.content.slice(0,230))}</p><small class="muted">${esc(humanTime(s.createdAt))} · 历史总结独立保存</small></div>`;}
async function chatHtml(){const s=await Store.get('sessions',sessionId);activeRoleName=s?.characterName||'AI';if(!drafts.has(sessionId))drafts.set(sessionId,await Store.getSetting('draft:'+sessionId,''));const [messages,sums,cards,noteEntries,noteVolumes]=await Promise.all([Store.orderedMessages(sessionId),Store.inSession('summaries',sessionId),Store.inSession('statusCards',sessionId),Notebook.entries(sessionId),Notebook.volumes(sessionId)]);const byMessage=new Map();for(const card of cards){if(!byMessage.has(card.messageId))byMessage.set(card.messageId,[]);byMessage.get(card.messageId).push(card);}for(const entries of byMessage.values())entries.sort((a,b)=>a.position-b.position);sums.sort((a,b)=>a.endOrdinal-b.endOrdinal);const visible=messages.slice(-showLimit);const first=visible[0]?.ordinal??0;let seq=[],used=new Set();const notedOrdinals=new Set(noteEntries.map(x=>x.assistantOrdinal));const latestNoteOrdinal=noteEntries.at(-1)?.assistantOrdinal;
for(const m of visible){const noteSlot=m.role==='assistant'&&notedOrdinals.has(m.ordinal)?(m.ordinal===latestNoteOrdinal?notepadRender(noteEntries,noteVolumes,true):`<details class="notebook-root"><summary data-action="notebook-snapshot" data-ord="${m.ordinal}"><span class="status-diamond">◈</span><strong>记事本</strong><span class="muted smalltext">点击查看截至本轮完整分卷</span></summary></details>`):'';seq.push(msgHtml(m,byMessage.get(m.id)||[],noteSlot,s));for(const sm of sums){if(sm.endOrdinal===m.ordinal){seq.push(summaryMarker(sm));used.add(sm.id);}}}
const body=seq.length?`<div class="chat ${config.messageLayout==='split'?'split-layout':'left-layout'}">${messages.length>showLimit?`<div style="text-align:center"><button class="pill" data-action="more">加载更早 100 条（共 ${messages.length} 条）</button></div>`:''}${seq.join('')}${busy?`<div id="liveResponse" class="live-response" aria-live="polite">模型生成中…</div>`:''}</div>`:notFound;
const effective={...config.chat,...(config.generation||{}),...(s?.generation||{})};const tagline=`${esc(modelForChat(s)?.model||effective.model||'未配置模型')} · 上下文 ${s?.generation?.contextCount||config.contextCount} 条`;
return {s,html:`${head(s?.name||'新聊天',tagline)}<main class="content" id="scroller">${body}</main><div class="compose minimal-compose"><div class="composebox"><div class="inputrow"><textarea id="composer" rows="1" spellcheck="${!!config.spellcheckEnabled}" placeholder="输入消息与 AI 聊天…" ${busy?'disabled':''}>${esc(drafts.get(sessionId)||'')}</textarea></div>${pendingAttachments.length?`<div class="compose-attachments">附件 ${pendingAttachments.length} 个 · ${pendingAttachments.map(attName).map(esc).join('、')} <button class="minor" data-action="clear-attachments">清除</button></div>`:''}<div class="compose-footer"><button class="compose-icon" data-action="plus-menu" title="附件、提示词及更多功能" aria-label="更多功能">＋</button><button class="compose-icon" data-action="expand-composer" title="展开编辑输入框" aria-label="放大输入框">⤢</button>${chatModelSelect(s)}<button class="compose-icon" data-action="quick-params" title="生成参数" aria-label="生成参数">⚙</button><button class="compose-send" data-action="send" title="发送消息" aria-label="${busy?'生成中':'发送'}" ${busy?'disabled':''}>${busy?'···':'↑'}</button></div></div></div>`};}
function groupedArchiveMarkers(summaries,groupSize=5){
 const blocks=[];
 for(let i=0;i<summaries.length;i+=groupSize){
  const slice=summaries.slice(i,i+groupSize);
  const start=Math.min(...slice.map(s=>Number(s.startOrdinal)||0));
  const end=Math.max(...slice.map(s=>Number(s.endOrdinal)||0));
  blocks.push(`<details class="archive-cluster"><summary>第 ${start}—${end} 条 · ${slice.length} 份独立总结（展开查看）</summary><div class="archive-cluster-items">${slice.map(summaryMarker).join('')}</div></details>`);
 }
 return blocks.join('');
}
async function memoryHtml(){const s=await Store.get('sessions',sessionId);const summaries=(await Store.inSession('summaries',sessionId)).sort((a,b)=>b.endOrdinal-a.endOrdinal);const backlog=await Engine.backfillPlan(sessionId);const pending=backlog.remaining;const batchSize=[20,50,100].includes(Number(s?.memory?.backfillBatchSize))?Number(s.memory.backfillBatchSize):20;
const coveredPercent=Math.round(backlog.covered/Math.max(1,backlog.total)*100);
const needsRepair=summaries.filter(Engine.summaryNeedsReview).length;
const diagnostic=backfillStatus||(pending?`还有 ${pending} 条历史消息没有生成过总结。点击上方「生成新总结」即可从最早的缺口继续。`:'当前会话的历史消息均已归档。若有旧档案内容被截断，可以单独使用下方的「修复已有总结」。');
return `${head('记忆中心',s?.name||'')}${toolbar()}<main class="content memory-page"><section class="section"><h1 class="pagehead">长期记忆</h1><div class="card archive-card">
<div class="archive-summary-row"><div><strong>当前会话 · 总结档案</strong><div class="smalltext muted">历史总结独立保留，不受上下文条数限制</div></div><span class="tag">${summaries.length} 份</span></div>
<div class="archive-counts"><span>已归档 <b>${backlog.covered}</b> / ${backlog.total} 条</span><span>待补 <b>${pending}</b> 条</span></div>
<div class="progress memory-progress" role="progressbar" aria-valuenow="${coveredPercent}" aria-valuemin="0" aria-valuemax="100" aria-label="总结归档进度"><div style="width:${coveredPercent}%"></div></div>
<div class="backfill-size-row"><label for="backfillBatchSize">每份总结包含</label><select id="backfillBatchSize" class="field" aria-label="每批归档消息数量"><option value="20" ${batchSize===20?'selected':''}>20 条 · 稳妥</option><option value="50" ${batchSize===50?'selected':''}>50 条 · 少量档案</option><option value="100" ${batchSize===100?'selected':''}>100 条 · 长历史</option></select><span class="smalltext muted">超长内容会分片处理，但合并保存为一份总结</span></div>
<label class="switchlabel smalltext" style="margin:12px 0 4px">中性事实归档提示词（默认开启，仅整理事件、人物与时间，不保证上游接受全部原文）<input id="summaryNeutralMode" type="checkbox" class="toggle" ${config.summaryNeutralMode!==false?'checked':''}></label>
<div class="summary-workflow-grid"><div class="summary-workflow new-archive-workflow"><div class="summary-workflow-heading"><span class="summary-workflow-label">① 新总结 · 未归档导入历史</span><span class="tag">待总结 ${pending} 条</span></div><p class="smalltext muted">只整理尚未总结的 聊天备份 原文；按每份 ${batchSize} 条逐批生成，不修改已有档案。</p><button class="action summary-main-action" data-action="backfill-summary" ${busy||!pending?'disabled':''}>${busy?'正在生成新总结…':pending?'生成新总结 · 从未归档位置继续':'已全部总结完成'}</button></div>
<div class="summary-workflow repair-archive-workflow"><div class="summary-workflow-heading"><span class="summary-workflow-label">② 修复已有总结 · 截断补全</span><span class="tag">待校验 ${needsRepair} 份</span></div><p class="smalltext muted">对已经生成、但可能被截断的旧档案重新核验；修复前的内容继续保留，不会生成重复档案。</p><button class="action secondary summary-main-action" data-action="repair-old-summaries" ${busy||!needsRepair?'disabled':''}>${busy?'处理中…':needsRepair?'修复已有总结（'+needsRepair+' 份）':'没有待校验的旧总结'}</button></div></div>
<div class="archive-actions"><button class="action secondary" data-action="manual-summary-dialog">手动选择总结范围</button><button class="minor archive-model-test" data-action="test-summary-model">测试总结模型</button></div>
<details class="archive-help"><summary>新总结与旧总结修复有什么区别？</summary><p>「生成新总结」只归档还没总结的导入记录：可以选择每份 20／50／100 条，长原文分片发送，确认整份完整后保存，不覆盖已有档案。HTTP 502/503/504 或上游 EOF 时自动缩小请求片段。</p><p>旧总结的旧版归档无法凭文本确定是否完整，提供逐份重生成并验证的修复功能；每一份确认完成后才进入下一份，旧文本作为版本备份保留。若 AI Studio 返回 prohibited_content，属于内容政策拒绝，不是普通的 502/格式/密钥故障。系统会停在未归档范围，不自动缩片重试。你可以自行选择支持合规归档的模型；原文仍可从四层本地历史检索找回。</p></details>
<div class="archive-status" id="backfillStatus" role="status" aria-live="polite">${esc(diagnostic)}</div></div>
<div class="sectiontitle">四层历史检索 · 精确关键词 / 向量 / 事件关联 / 时间线</div><div class="searchbox"><input id="memorySearch" class="field" placeholder="例如：我们上次说过的约定？" value="${esc(searchQuery)}"><div class="btnrow"><button class="action" data-action="search">搜索聊天与历史总结</button><button class="action secondary" data-action="build-vectors">构建语义向量索引</button></div><div id="search-status" class="status">${esc(statusMessage)}</div></div><div id="search-results">${searchResults.map(r=>`<div class="card result" data-action="jump-result" data-session="${esc(r.sessionId)}" data-ord="${esc(r.ordinal)}"><div class="cardrow"><strong>${r.kind==='summary'?'历史总结':'聊天原文'} · ${esc(r.ordinal||'?')} 条</strong><span class="tag">${esc(r.matchType||"语义相关")} · ${(r.score*100).toFixed(0)}%</span></div><div class="snippet">${esc(r.text.slice(0,400))}</div>${(r.related||[]).length?`<details class="memory-related" onclick="event.stopPropagation()"><summary>关联事件 · 前后 ${(r.related||[]).length} 条（按时间顺序）</summary>${r.related.map(e=>`<div class="smalltext" style="padding:5px 0">第 ${esc(e.ordinal)} 条：${esc(e.text.slice(0,180))}</div>`).join('')}</details>`:''}<small class="muted">${esc(r.sessionId===sessionId?'当前会话':'其他会话')} · 点击跳转原文</small></div>`).join('')}</div>
<div class="sectiontitle">历史总结 · 每 5 份折叠一组，原文和旧档案均保留</div>${summaries.length?groupedArchiveMarkers(summaries):'<div class="card muted">本会话还没有总结。可以先导入历史聊天，然后点击上方的「生成新总结」。</div>'}</section></main>`;}
async function promptsHtml(){const s=await Store.get('sessions',sessionId);return `${head('提示词管理','全局提示词、会话人设、总结提示词分别保存')}${toolbar()}<main class="content"><section class="section"><h1 class="pagehead">提示词</h1><div class="card"><h3>当前会话 · 专属角色提示词</h3><p>仅当前对话有效，切换会话不会串人设。</p><textarea class="field" id="sessionPrompt" style="min-height:190px" placeholder="在这里填写人物设定 / 世界观 / 对话规则">${esc(s?.systemPrompt||'')}</textarea><div class="btnrow"><button class="action" data-action="save-session-prompt">保存到当前会话</button></div></div><div class="card"><h3>全局聊天系统提示词</h3><p>每条会话都可使用。它与角色专属提示词、检索到的旧记忆分开管理。</p><textarea class="field" id="globalPrompt" style="min-height:150px">${esc(config.systemPrompt)}</textarea><div class="btnrow"><button class="action secondary" data-action="save-global-prompt">保存全局提示词</button></div></div><div class="card"><h3>独立自动总结提示词</h3><p>每次生成新总结时使用；旧总结不受模板变更影响。</p><textarea class="field" id="summaryPrompt" style="min-height:180px">${esc(config.summaryPrompt)}</textarea><div class="btnrow"><button class="action secondary" data-action="save-summary-prompt">保存总结提示词</button></div></div><div class="card"><h3>记事本 · 内置提示词（可自行修改）</h3><p>每轮只记一条，每十条封卷，满卷生成100至200字总结。旧十条与旧卷总结一经存档不可覆盖；生成失败时保留内容并可重试。折叠栏在普通状态栏后。</p><textarea class="field" id="notebookPrompt" style="min-height:270px">${esc(config.notebookPrompt||Notebook.prompt)}</textarea><div class="btnrow"><button class="action secondary" data-action="save-notebook-prompt">保存全局记事本提示词</button><button class="minor" data-action="notebook-panel">打开记事本</button></div><div class="rowline"></div><h3>当前会话 · 记事本独立设置</h3><p>允许每个角色使用不同的记事本规则；留空则跟随全局。不会改动其他会话和已存档的卷。</p><label class="label">本会话记事本开关</label><select id="sessionNotebookMode" class="field"><option value="inherit" ${typeof s?.notebookEnabled==='boolean'?'':'selected'}>跟随全局</option><option value="on" ${s?.notebookEnabled===true?'selected':''}>仅本会话启用</option><option value="off" ${s?.notebookEnabled===false?'selected':''}>仅本会话停用</option></select><label class="label">本会话提示词（可留空）</label><textarea class="field" id="sessionNotebookPrompt" style="min-height:150px" placeholder="留空则使用上方的全局记事本提示词">${esc(s?.notebookPrompt||'')}</textarea><div class="btnrow"><button class="action secondary" data-action="save-session-notebook">保存本会话记事本设置</button></div></div><div class="card"><h3>对话中生成自定义状态栏</h3><p>不用在设置中固定“待办事项”或“记事本”。直接聊天说：“生成一个角色状态栏，包含心情、地点、关系”，AI 会生成任意名称、任意字段的折叠卡片，存放在对应回复处。旧卡片会随聊天永久保存。</p><p class="muted smalltext">支持同时生成多个状态栏。点击输入区的 ◈ 可快速填写需求。</p></div><div class="card"><h3>提示词模板库</h3><p>在不同会话里复用模板；模板不会自动覆盖原有角色设定。</p>${(config.templates||[]).map((p,i)=>`<div class="cardrow" style="padding:10px 0;border-bottom:1px solid var(--line)"><div class="grow"><strong>${esc(p.name)}</strong><p>${esc(p.content.slice(0,75))}</p></div><button class="minor" data-action="apply-template" data-index="${i}">应用</button><button class="minor" data-action="delete-template" data-index="${i}">删除</button></div>`).join('')}<div class="btnrow"><button class="action secondary" data-action="add-template">＋ 新模板</button></div></div></section></main>`;}
const box=(title,desc,body)=>`<div class="card"><h3>${title}</h3>${desc?`<p>${desc}</p>`:''}${body}</div>`;
function field(label,id,value,kind='text',hint=''){return `<label class="label" for="${id}">${label}</label><input class="field" type="${kind}" id="${id}" value="${esc(value??'')}" placeholder="${esc(hint)}" ${kind==='password'?'autocomplete="off"':''}>`}
function endpointForm(kind,label){
 const c=config[kind],selected=(config.activeModels||{})[kind],preset=(config.modelProfiles||[]).find(p=>p.id===selected);
 if(preset)return box(label,`已使用已保存模型「${esc(preset.name)}」，在上方模型列表中编辑它的接口与密钥。`, `<div class="model-metadata"><span class="tag">${preset.source==='local'?'本地模型':'云端模型'}</span><strong>${esc(preset.model)}</strong><small>${esc(preset.url)}</small></div>${kind==='embedding'?`<label class="switchlabel">启用 Embedding 语义检索 <input id="embeddingEnabled" type="checkbox" class="toggle" ${c.enabled?'checked':''}></label>`:''}`);
 return box(label,'不选择已保存模型时，可在这里填写专属的兼容接口。',`${field('API Base URL',kind+'Url',c.url,'text','http://127.0.0.1:11434/v1')}${field('API Key（仅保存在本机）',kind+'Key',c.key,'password','本地服务可留空')}${field('模型 ID',kind+'Model',c.model,'text',kind==='embedding'?'nomic-embed-text':'自定义模型名')}${kind==='embedding'?`<label class="switchlabel">启用真实 Embedding 语义检索<input id="embeddingEnabled" type="checkbox" class="toggle" ${c.enabled?'checked':''}></label>`:''}${kind!=='embedding'?field('最大输出 Token',kind+'MaxTokens',c.maxTokens,'number'):''}`);
}
function modelRoleSelect(role,title,kind){
 const active=(config.activeModels||{})[role]||'';
 const entries=(config.modelProfiles||[]).filter(p=>p.type===kind);
 return `<label class="label" for="modelFor-${role}">${title}</label><select class="field" id="modelFor-${role}"><option value="">${role==='summary'?'跟随聊天模型':role==='embedding'?'关闭向量 API（仍可关键词检索）':'不选择模型'}</option>${entries.map(p=>`<option value="${esc(p.id)}" ${active===p.id?'selected':''}>${esc(p.name)} · ${esc(p.model)}${p.source==='local'?' · 本地':''}</option>`).join('')}</select>`;
}
function modelManager(){const profiles=config.modelProfiles||[];return box('多个模型 · 保存与独立分工','每个模型都有独立地址、模型 ID 与密钥；可以保存多个本地 Ollama / LM Studio / OpenAI 兼容服务，也能保存多个向量模型。',
 `<div class="btnrow"><button class="action secondary" data-action="new-chat-model">＋ 新增聊天模型</button><button class="action secondary" data-action="new-embedding-model">＋ 新增向量模型</button></div>${profiles.length?`<div class="model-profile-list">${profiles.map(p=>`<div class="model-profile"><div class="grow"><strong>${esc(p.name)}</strong><div class="model-tags"><span class="tag">${p.type==='embedding'?'向量 Embedding':'聊天 / 总结'}</span><span class="tag">${p.source==='local'?'本地 / 局域网':'云端'}</span></div><small>${esc(p.model)}</small><small>${esc(p.url)}</small></div><button class="minor" data-action="edit-model-profile" data-id="${esc(p.id)}">编辑</button><button class="minor" data-action="delete-model-profile" data-id="${esc(p.id)}">删除</button></div>`).join('')}</div>`:'<p class="muted smalltext">还没有保存的模型，先点击新增模型。</p>'}<div class="rowline"></div><h3>分别分配模型</h3>${modelRoleSelect('chat','日常聊天模型','chat')}${modelRoleSelect('summary','自动总结 / 记事本模型','chat')}${modelRoleSelect('embedding','向量 Embedding 模型','embedding')}<p class="warning">切换模型后，原聊天与旧总结不会被删除。更换 Embedding 模型时，需要在「长期记忆」中为新模型重新构建向量索引。</p>`);
}
async function settingsHtml(){return `${head('设置','系统适配、本地模型、自动总结、数据管理')}${toolbar()}<main class="content"><section class="section"><h1 class="pagehead">设置</h1><div class="sectiontitle">通用设置</div>${box('颜色模式和界面','日间 / 夜间 / 跟随系统；支持全局字体缩放。',`<label class="label">颜色模式</label><select id="theme" class="field"><option value="system" ${config.theme==='system'?'selected':''}>跟随系统</option><option value="light" ${config.theme==='light'?'selected':''}>日间</option><option value="dark" ${config.theme==='dark'?'selected':''}>夜间</option><option value="amoled" ${config.theme==='amoled'?'selected':''}>AMOLED 纯黑</option></select><label class="label" for="fontSize">全局字体大小 <output id="fontSizeValue">${Math.round((config.fontSize||1)*100)}%</output></label><input class="font-slider" id="fontSize" type="range" min="0.8" max="1.6" step="0.05" value="${esc(config.fontSize)}"><div class="font-preview">字体预览：知忆会记得过去的聊天与重要约定。</div>`)}<div class="sectiontitle">个人头像</div>${box('本机用户头像','默认用于你发送的消息；某个会话可以在角色编辑里单独指定。图片压缩保存到本机，不会自动发送给 AI。',`<div class="avatar-editor-row"><div class="avatar-preview" id="global-user-avatar-preview">${avatarHtml(config.userAvatarData,'我')}</div><div><button class="action secondary" data-action="pick-avatar" data-target="global-user">从手机选择用户头像</button><button class="minor" data-action="remove-avatar" data-target="global-user">清除默认头像</button></div></div>`)}<div class="sectiontitle">角色头像批量管理</div>${box('一次设置所有角色头像','从手机选择图片，按角色分配给所有会话；默认跳过已有头像，避免覆盖之前的设置。',`<div class="btnrow"><button class="action secondary" data-action="bulk-role-avatar">批量设置角色头像</button></div><p class="smalltext muted">支持一张图片应用全部角色，或者一次选多张图片，按「角色名.jpg」自动匹配角色。原有用户头像不受影响。</p>`)}<div class="sectiontitle">聊天显示与辅助功能</div>${box('消息位置','默认双方都在左边，也能改成左右分栏。',`<label class="label">消息排列方式</label><select class="field" id="messageLayout"><option value="both-left" ${config.messageLayout!=='split'?'selected':''}>用户和 AI 都在左边（默认）</option><option value="split" ${config.messageLayout==='split'?'selected':''}>AI 左边、用户右边</option></select>`)}${box('常规功能开关','可按你的截图自选开启。部分高级功能仍需后续接入对应渲染/Agent 组件。',`<label class="switchlabel">自动折叠代码块<input id="collapseCode" type="checkbox" class="toggle" ${config.collapseCode?'checked':''}></label><label class="switchlabel">自动生成聊天标题（取首次消息）<input id="autoTitle" type="checkbox" class="toggle" ${config.autoTitle?'checked':''}></label><label class="switchlabel">Markdown 基础渲染<input id="markdownEnabled" type="checkbox" class="toggle" ${config.markdownEnabled?'checked':''}></label><label class="switchlabel">输入框拼写检查<input id="spellcheckEnabled" type="checkbox" class="toggle" ${config.spellcheckEnabled?'checked':''}></label><label class="switchlabel">粘贴超长文本自动作为文件附件<input id="longPasteAsFile" type="checkbox" class="toggle" ${config.longPasteAsFile?'checked':''}></label><label class="switchlabel">注入模型名和日期元数据<input id="injectMeta" type="checkbox" class="toggle" ${config.injectMeta?'checked':''}></label><p class="muted smalltext">LaTeX、Mermaid、Artifacts 和 Agent 步骤确认需相应执行环境，暂不提供无效开关。</p>`)}<div class="sectiontitle">聊天与长期记忆</div>${box('自动总结 · 永久归档','按消息数生成全新的独立总结，保留所有旧总结；不使用覆盖式上下文压缩。',`${field('每多少条用户/AI 消息自动总结','summaryEvery',config.summaryEvery,'number')}${field('发送给聊天模型的最近消息条数','contextCount',config.contextCount,'number')}${field('最近消息最大字符预算','maxContextChars',config.maxContextChars,'number')}${field('默认上下文最大 Token（上限 1000000）','contextTokenLimit',config.contextTokenLimit||16000,'number')}${field('每次召回多少条历史原文','recallCount',config.recallCount,'number')}<label class="switchlabel">精确关键词优先<input id="keywordPriority" type="checkbox" class="toggle" ${config.keywordPriority!==false?'checked':''}></label><label class="switchlabel">关联历史事件前后文<input id="eventLinking" type="checkbox" class="toggle" ${config.eventLinking!==false?'checked':''}></label><label class="switchlabel">历史时间线召回（兼顾最早和最近的关键词事件）<input id="timelineRetrieval" type="checkbox" class="toggle" ${config.timelineRetrieval!==false?'checked':''}></label>${field('事件关联：前后各几条消息（1—4）','eventWindow',config.eventWindow||2,'number')}<label class="switchlabel">检索其他会话的记忆（默认关闭，防止串人设）<input id="crossSession" type="checkbox" class="toggle" ${config.crossSession?'checked':''}></label><label class="switchlabel">当前会话每轮自动追加一条记事本<input id="notebookEnabled" type="checkbox" class="toggle" ${config.notebookEnabled?'checked':''}></label><label class="switchlabel">用独立总结模型提取一条事件（失败保留用户原文）<input id="notebookAIExtract" type="checkbox" class="toggle" ${config.notebookAIExtract?'checked':''}></label><p class="smalltext muted">每卷固定十条，满卷自动生成100至200字总结；每卷独立折叠，旧卷内容不会被下次更新覆盖。</p>`)}<div class="sectiontitle">模型与服务</div>${modelManager()}
${box('本地模型使用说明','Android 手机上的本机 API 例如 http://127.0.0.1:11434/v1；电脑上的 Ollama 请使用电脑局域网 IP。若直接用浏览器而非 APK，模型服务可能需要允许跨域 CORS。','<p class="warning">离线词组向量+关键词检索无需 API；要进行真正的语义 Embedding，需要在上面填写兼容的 Embedding 服务并生成索引。</p>')}
<div class="sectiontitle">数据设置</div>${box('聊天备份 ZIP 导入','旧版与新版可同时安装。请先在旧版「设置 → 数据设置」导出「知忆全部聊天与总结」ZIP，然后在本版点击「恢复知忆备份」导入；两种其他应用 ZIP 也支持预览及选定导入。',`<div class="btnrow"><button class="action" data-action="import">导入两种聊天备份 ZIP / JSON</button><button class="action secondary" data-action="restore">恢复知忆备份</button><button class="action secondary" data-action="export">备份知忆全部聊天与总结为 ZIP</button></div><div class="status" id="importStatus">${esc(statusMessage)}</div><div class="progress" style="margin:10px 0"><div id="importProgressBar" style="width:${progressMax?Math.round(importProgress/progressMax*100):0}%"></div></div>`)}
${box('当前会话','重命名或删除会话。删除本应用中的数据不会删除 聊天备份 原文件。',`<div class="btnrow"><button class="action secondary" data-action="rename-chat">重命名当前会话</button><button class="action danger" data-action="delete-chat">删除当前会话</button></div>`)}
<div class="sectiontitle">GitHub 私有仓库定时备份</div>${BackupUI.card()}<div class="sectiontitle">扩展功能规划</div>${box('后续模块','MCP、Agent Skills、语音识别与合成、文件 OCR、多模态模型、搜索服务、复杂人设世界书注入、定时总结（按时间）、其他系统任务，尚未在本版实现。','<p class="smalltext">本版已经可以聊天、迁移记录、保存旧总结、混合检索和接入兼容模型。未完成的扩展不会提供虚假的启用按钮。</p>')}
<div class="btnrow"><button class="action" data-action="save-settings">保存所有设置</button></div></section></main>`;}
async function render(opts={}){const lastScroll=document.getElementById('scroller')?.scrollTop||0;let view;if(page==='chat')view=await chatHtml();else if(page==='memory')view={html:await memoryHtml()};else if(page==='prompts')view={html:await promptsHtml()};else view={html:await settingsHtml()};root.innerHTML=view.html+drawerHtml()+(dialog?await dialogHtml():'');theme();if(page==='chat'){const sc=document.getElementById('scroller');if(sc)sc.scrollTop=opts.keepScroll?lastScroll:sc.scrollHeight;} }
async function dialogHtml(){const s=await Store.get('sessions',sessionId);

if(dialog==='bulk-role-avatar'){const sessions=await Store.all('sessions'),already=sessions.filter(x=>!!x.characterAvatarData).length;return `<div class="dialog-shade" data-action="close-dialog"><div class="dialog" data-dialog="true"><div class="dialoghead"><h2>批量设置角色头像</h2><button class="iconbtn" data-action="close-dialog">×</button></div><p class="smalltext muted">全部 ${sessions.length} 个会话，已有角色头像 ${already} 个。只保存在手机本地，不改变「知忆」应用图标。</p><label class="switchlabel">覆盖已经设置的角色头像<input id="bulkAvatarOverwrite" type="checkbox" class="toggle"></label><div class="btnrow"><button class="action" data-action="pick-avatar-batch" data-mode="same">选一张图应用全部角色</button><button class="action secondary" data-action="pick-avatar-batch" data-mode="named">多选图片，按角色名匹配</button></div><p class="smalltext muted">分别设置时，请把图片命名为角色名，例如「示例甲.jpg」「示例乙.png」。同名角色的多个会话会同步，未匹配的角色保持原样。重名或冲突文件会跳过。</p><p class="smalltext" id="avatarBatchStatus">${esc(avatarBatchMessage)}</p><div class="btnrow"><button class="minor" data-action="close-dialog">完成</button></div></div></div>`;}
if(dialog==='plus-menu')return `<div class="dialog-shade" data-action="close-dialog"><div class="dialog menu-dialog" data-dialog="true"><div class="dialoghead"><h2>＋ 功能</h2><button class="iconbtn" data-action="close-dialog">×</button></div><div class="menu-grid">${[['attach','照片 / 上传文件'],['prompt-dialog','对话系统提示词'],['go-prompts','提示词与模板'],['status-request','生成状态栏'],['summary-panel','历史总结'],['start-new-history-summary','生成新总结（未归档导入记录）'],['manual-summary-dialog','手动总结'],['notebook-panel','记事本'],['memory-settings','长期记忆设置'],['go-memory','记忆搜索'],['quick-params','生成参数'],['go-settings','模型、API 与备份'],['new-chat','新建会话'],['edit-role-active','编辑角色与会话'],['bulk-role-avatar','批量设置角色头像']].map(x=>`<button class="menu-choice" data-action="${x[0]}">${x[1]}</button>`).join('')}</div></div></div>`;
if(dialog==='expanded-composer')return `<div class="dialog-shade" data-action="close-dialog"><div class="dialog expanded-dialog" data-dialog="true"><div class="dialoghead"><h2>编辑消息</h2><button class="iconbtn" data-action="close-dialog">×</button></div><textarea class="field" id="expandedText" style="height:63dvh;resize:vertical" placeholder="输入长文本…">${esc(drafts.get(sessionId)||'')}</textarea><div class="btnrow"><button class="action" data-action="apply-expanded">完成并返回</button><button class="action secondary" data-action="close-dialog">取消</button></div></div></div>`;
if(dialog==='quick-params'){const gen={...config.generation,...(s?.generation||{})};return `<div class="dialog-shade" data-action="close-dialog"><div class="dialog" data-dialog="true"><div class="dialoghead"><h2>当前会话 · 生成参数</h2><button class="iconbtn" data-action="close-dialog">×</button></div><p class="muted">独立于其他会话设置。</p>${field('最近上下文消息条数','quickContextCount',gen.contextCount||config.contextCount,'number')}${field('上下文最大 Token（最高 1,000,000；实际取决于模型）','quickContextTokens',gen.contextTokenLimit||config.contextTokenLimit||16000,'number')}${field('Temperature 温度（0～2）','quickTemperature',gen.temperature??.7,'number')}${field('Top-P（0～1）','quickTopP',gen.topP??1,'number')}${field('最大输出 Token','quickMaxTokens',gen.maxTokens||2048,'number')}<label class="switchlabel">流式输出<input id="quickStream" type="checkbox" class="toggle" ${gen.stream?'checked':''}></label><label class="switchlabel">启用模型思考<input id="quickThinking" type="checkbox" class="toggle" ${gen.thinkingEnabled!==false?'checked':''}></label><p class="muted smalltext">关闭思考时，对兼容 Ollama 的本地模型发送关闭参数；其他服务无法保证禁用内部推理，但不会显示返回的思考内容。</p><div class="btnrow"><button class="action" data-action="save-quick-params">保存当前会话参数</button></div></div></div>`;}
if(dialog==='memory-settings'){const mem={...config,...(s?.memory||{})};return `<div class="dialog-shade" data-action="close-dialog"><div class="dialog" data-dialog="true"><div class="dialoghead"><h2>当前会话 · 长期记忆</h2><button class="iconbtn" data-action="close-dialog">×</button></div><p class="muted">历史总结不覆盖，旧消息随时可检索。以下设置仅对当前会话生效。</p>${field('每多少条消息自动总结','memorySummaryEvery',mem.summaryEvery||50,'number')}<label class="label">补齐旧记录每份总结多少条</label><select id="memoryBackfillBatchSize" class="field"><option value="20" ${Number(mem.backfillBatchSize||20)===20?'selected':''}>20 条</option><option value="50" ${Number(mem.backfillBatchSize)===50?'selected':''}>50 条</option><option value="100" ${Number(mem.backfillBatchSize)===100?'selected':''}>100 条</option></select>${field('每次召回旧原文条数','memoryRecallCount',mem.recallCount||8,'number')}${field('记忆最大字符预算','memoryRecallChars',mem.maxRecallChars||12000,'number')}<label class="switchlabel">关键词精确匹配优先<input id="memoryKeywordPriority" type="checkbox" class="toggle" ${mem.keywordPriority!==false?'checked':''}></label><label class="switchlabel">关联旧消息前后事件<input id="memoryEventLinking" type="checkbox" class="toggle" ${mem.eventLinking!==false?'checked':''}></label><label class="switchlabel">追溯最早发生的相关事件<input id="memoryTimelineRetrieval" type="checkbox" class="toggle" ${mem.timelineRetrieval!==false?'checked':''}></label>${field('事件前后文各读取几条（1—4）','memoryEventWindow',mem.eventWindow||2,'number')}<label class="switchlabel">允许跨会话检索<input id="memoryCrossSession" type="checkbox" class="toggle" ${mem.crossSession?'checked':''}></label><label class="switchlabel">本会话自动生成记事本<input id="memoryNotebook" type="checkbox" class="toggle" ${s?.notebookEnabled!==false?'checked':''}></label><div class="btnrow"><button class="action" data-action="save-memory-settings">保存本会话记忆设置</button><button class="action secondary" data-action="go-memory">查看旧总结</button></div></div></div>`;}
if(dialog.startsWith('role-editor:')){const sid=dialog.slice('role-editor:'.length),record=await Store.get('sessions',sid);return `<div class="dialog-shade" data-action="close-dialog"><div class="dialog" data-dialog="true"><div class="dialoghead"><h2>编辑角色 / 会话</h2><button class="iconbtn" data-action="close-dialog">×</button></div>${field('会话标题','editSessionTitle',record?.name||'')}${field('角色名称','editCharacterName',record?.characterName||'AI')}<div class="avatar-editor-row"><div class="avatar-preview" id="role-avatar-preview">${avatarHtml(record?.characterAvatarData,record?.characterName||'角色')}</div><div><strong>角色头像</strong><div class="smalltext muted">从手机相册选择，仅当前会话使用</div><button class="minor" data-action="pick-avatar" data-target="role" data-session="${esc(sid)}">上传本地图片</button><button class="minor" data-action="remove-avatar" data-target="role" data-session="${esc(sid)}">清除</button></div></div><div class="avatar-editor-row"><div class="avatar-preview" id="session-user-avatar-preview">${avatarHtml(record?.userAvatarData||config.userAvatarData,'我')}</div><div><strong>本会话用户头像</strong><div class="smalltext muted">不影响其他会话，可跟随全局用户头像</div><button class="minor" data-action="pick-avatar" data-target="session-user" data-session="${esc(sid)}">上传本地图片</button><button class="minor" data-action="remove-avatar" data-target="session-user" data-session="${esc(sid)}">恢复默认</button></div></div><label class="label">角色设定与系统提示词</label><textarea class="field" id="editRolePrompt" style="min-height:220px">${esc(record?.systemPrompt||'')}</textarea><div class="btnrow"><button class="action" data-action="save-role-editor" data-session="${esc(sid)}">保存修改</button><button class="action danger" data-action="delete-session" data-session="${esc(sid)}">删除整个会话</button></div></div></div>`;}
if(dialog.startsWith('session-menu:')){const sid=dialog.slice('session-menu:'.length),record=await Store.get('sessions',sid);return `<div class="dialog-shade" data-action="close-dialog"><div class="dialog menu-dialog" data-dialog="true"><div class="dialoghead"><h2>${esc(record?.name||'会话')}</h2><button class="iconbtn" data-action="close-dialog">×</button></div><p class="muted smalltext">长按聊天列表可管理这条对话，不影响其他记录。</p><div class="menu-grid"><button class="menu-choice" data-action="toggle-pin" data-session="${esc(sid)}">${record?.pinned?'取消置顶':'置顶对话'}</button><button class="menu-choice" data-action="edit-role" data-session="${esc(sid)}">编辑会话</button><button class="menu-choice danger-text" data-action="delete-session" data-session="${esc(sid)}">删除对话…</button><button class="menu-choice" data-action="close-dialog">取消</button></div></div></div>`;}
if(dialog.startsWith('message-menu:')){const msg=await Store.get('messages',dialog.slice('message-menu:'.length));return `<div class="dialog-shade" data-action="close-dialog"><div class="dialog menu-dialog" data-dialog="true"><div class="dialoghead"><h2>第 ${esc(msg?.ordinal||'?')} 条消息</h2><button class="iconbtn" data-action="close-dialog">×</button></div><p class="muted smalltext">${esc(String(msg?.content||'').slice(0,90))}</p><div class="menu-grid">${msg?.role==='assistant'?`<button class="menu-choice" data-action="regenerate-message" data-id="${esc(msg?.id||'')}">↻ 重新回答</button>`:''}<button class="menu-choice" data-action="edit-message" data-id="${esc(msg?.id||'')}">✎ 编辑</button><button class="menu-choice" data-action="copy-message" data-id="${esc(msg?.id||'')}">▣ 复制</button><button class="menu-choice" data-action="quote-message" data-id="${esc(msg?.id||'')}">❝ 引用</button><button class="menu-choice danger-text" data-action="delete-message" data-id="${esc(msg?.id||'')}">删除消息…</button></div></div></div>`;}

if(dialog.startsWith('message-edit:')){const msg=await Store.get('messages',dialog.slice('message-edit:'.length));return `<div class="dialog-shade" data-action="close-dialog"><div class="dialog" data-dialog="true"><div class="dialoghead"><h2>修改第 ${esc(msg?.ordinal||'?')} 条消息</h2><button class="iconbtn" data-action="close-dialog">×</button></div><textarea class="field" id="editedMessageText" style="min-height:240px">${esc(msg?.content||'')}</textarea><p class="muted smalltext">原有总结和记事本会保留，不会暗中篡改；搜索索引会更新。</p><div class="btnrow"><button class="action" data-action="save-message-edit" data-id="${esc(msg?.id||'')}">保存编辑</button><button class="action secondary" data-action="close-dialog">取消</button></div></div></div>`;}

if(dialog.startsWith('model-profile:')){
 const id=dialog.slice('model-profile:'.length);const p=(config.modelProfiles||[]).find(x=>x.id===id)||(id==='new-chat'?{id:'',name:'',type:'chat',source:'local',url:'http://127.0.0.1:11434/v1',key:'',model:'',temperature:.7,maxTokens:2048}:{id:'',name:'',type:'embedding',source:'cloud',url:'https://api.siliconflow.cn/v1',key:'',model:'BAAI/bge-m3',temperature:.7,maxTokens:2048});
 return `<div class="dialog-shade" data-action="close-dialog"><div class="dialog" data-dialog="true"><div class="dialoghead"><h2>${p.id?'编辑':'新增'}独立模型</h2><button class="iconbtn" data-action="close-dialog">×</button></div><p class="muted">本地模型的 URL 可用 http://127.0.0.1:端口/v1（手机本机服务）或 http://局域网IP:端口/v1。每个配置独立保存。</p>
 ${field('配置名称','profileName',p.name,'text','例如：家用 Ollama / 云端模型')}
 <label class="label">模型用途</label><select class="field" id="profileType"><option value="chat" ${p.type==='chat'?'selected':''}>聊天 / 总结模型</option><option value="embedding" ${p.type==='embedding'?'selected':''}>向量 Embedding</option></select>
 <label class="label">服务位置</label><select class="field" id="profileSource"><option value="local" ${p.source==='local'?'selected':''}>本地 / 局域网</option><option value="cloud" ${p.source==='cloud'?'selected':''}>在线云端</option></select>
 ${field('API Base URL','profileUrl',p.url,'text','http://127.0.0.1:11434/v1')}
 ${field('模型 ID','profileModel',p.model,'text','例如 qwen3 / nomic-embed-text')}
 ${field('API Key（保存于手机，不写入 GitHub 备份）','profileKey',p.key,'password','本地模型可留空')}
 ${field('最大输出 Token（仅聊天/总结）','profileMaxTokens',p.maxTokens||2048,'number')}<label class="label">Token 参数类型</label><select class="field" id="profileMaxTokensField"><option value="max_tokens" ${(p.maxTokensField||'max_tokens')==='max_tokens'?'selected':''}>max_tokens（常规）</option><option value="max_completion_tokens" ${p.maxTokensField==='max_completion_tokens'?'selected':''}>max_completion_tokens（部分推理模型）</option></select>
 ${field('Temperature（仅聊天/总结）','profileTemperature',p.temperature??.7,'number')}${field('Top-P','profileTopP',p.topP??1,'number')}<label class="switchlabel">流式生成<input id="profileStream" type="checkbox" ${p.stream?'checked':''}></label><label class="switchlabel">启用思考<input id="profileThinking" type="checkbox" ${p.thinkingEnabled!==false?'checked':''}></label>
 <div class="btnrow"><button class="action secondary" data-action="use-siliconflow">硅基流动地址</button><button class="action secondary" data-action="pull-models">按用途拉取模型</button><button class="action secondary" data-action="test-model">测试连接</button></div><div class="status" id="modelProbeResult" style="white-space:pre-wrap"></div><div class="btnrow"><button class="action" data-action="save-model-profile" data-id="${esc(p.id)}">保存此模型</button><button class="action secondary" data-action="close-dialog">取消</button></div></div></div>`;
}
if(dialog==='prompt')return `<div class="dialog-shade" data-action="close-dialog"><div class="dialog" data-dialog="true"><div class="dialoghead"><h2>对话系统提示词</h2><button class="iconbtn" data-action="close-dialog">×</button></div><p class="muted">此设置仅对当前会话生效。</p><textarea class="field" id="dialogPrompt" style="min-height:250px">${esc(s?.systemPrompt||'')}</textarea><div class="btnrow"><button class="action" data-action="save-dialog-prompt">保存</button></div></div></div>`;
if(dialog==='summary-list'){const sums=(await Store.inSession('summaries',sessionId)).sort((a,b)=>b.endOrdinal-a.endOrdinal);return `<div class="dialog-shade" data-action="close-dialog"><div class="dialog" data-dialog="true"><div class="dialoghead"><h2>当前对话 · ${sums.length} 份历史总结</h2><button class="iconbtn" data-action="close-dialog">×</button></div><p class="muted">旧总结永久存档，点击可查看全文并回溯原文。</p>${sums.length?sums.map(sm=>`<div class="card summary"><div class="cardrow"><strong>第 ${sm.startOrdinal}—${sm.endOrdinal} 条</strong><button class="minor" data-action="summary-detail" data-id="${esc(sm.id)}">查看 →</button></div><p style="white-space:pre-wrap;max-height:100px;overflow:hidden">${esc(sm.content.slice(0,250))}</p></div>`).join(''):'<p class="muted">还没有历史总结。</p>'}<button class="action secondary" data-action="open-memory">进入记忆中心</button></div></div>`;}
if(dialog.startsWith('summary:')){const x=await Store.get('summaries',dialog.slice(8));return `<div class="dialog-shade" data-action="close-dialog"><div class="dialog" data-dialog="true"><div class="dialoghead"><h2>历史总结 · 永久存档</h2><button class="iconbtn" data-action="close-dialog">×</button></div><span class="tag">原文 第 ${x?.startOrdinal}—${x?.endOrdinal} 条</span><p class="muted">${esc(humanTime(x?.createdAt))} · 模型 ${esc(x?.model)}</p><div class="card summary"><div class="summarytext" style="max-height:55vh">${esc(x?.content)}</div></div>${x?.previousVersions?.length?`<details class="card"><summary>查看修复前的旧总结（${x.previousVersions.length} 版，完整保留）</summary>${x.previousVersions.map((v,i)=>`<div class="summarytext" style="max-height:35vh;overflow:auto">旧版 ${i+1}：${esc(v.content)}</div>`).join('')}</details>`:''}<div class="btnrow">${Engine.summaryNeedsReview(x)?`<button class="action secondary" data-action="repair-single-summary" data-id="${esc(x.id)}">补全并校验本份总结</button>`:''}<button class="action" data-action="jump-summary" data-start="${x?.startOrdinal}" data-session="${esc(x?.sessionId)}">跳转至对应原文</button><button class="action secondary" data-action="close-dialog">关闭</button></div></div></div>`;}
if(dialog==='notebook-panel'||dialog.startsWith('notebook-snapshot:')){
 const until=dialog.startsWith('notebook-snapshot:')?Number(dialog.slice(18)):Infinity;
 const snap=await Notebook.snapshot(sessionId,until);
 return `<div class="dialog-shade" data-action="close-dialog"><div class="dialog" data-dialog="true"><div class="dialoghead"><h2>当前对话 · 永久记事本</h2><button class="iconbtn" data-action="close-dialog">×</button></div><p class="muted">每轮一条，每十条一卷。点击独立卷可展开。卷首是100至200字总结，历史记录原样保留。</p>${notepadRender(snap.entries,snap.volumes,false)}<div class="btnrow"><button class="action secondary" data-action="copy-notebook-html">复制完整 HTML 折叠格式</button><button class="minor" data-action="close-dialog">关闭</button></div></div></div>`;
}
if(dialog==='manual-range'){
 const rows=(await Store.orderedMessages(sessionId)).filter(x=>['user','assistant'].includes(x.role));
 const max=rows.at(-1)?.ordinal||0;const min=Math.max(1,max-49);
 return `<div class="dialog-shade" data-action="close-dialog"><div class="dialog" data-dialog="true"><div class="dialoghead"><h2>手动总结 · 独立归档</h2><button class="iconbtn" data-action="close-dialog">×</button></div><p class="muted">可选择任何旧消息范围，即使这段曾总结过，也会新增一份总结，不覆盖旧档案。</p><div class="range-row">${field('起始消息编号','rangeStart',min,'number')}${field('结束消息编号','rangeEnd',max,'number')}</div><div class="btnrow"><button class="action" data-action="confirm-summary-range">总结选中范围</button><button class="action secondary" data-action="manual-summary">仅总结未归档的新增消息</button></div></div></div>`;
}
if(dialog==='import-preview')return `<div class="dialog-shade" data-action="close-dialog"><div class="dialog import-dialog" data-dialog="true"><div class="dialoghead"><h2>${importKind==='rikka'?'聊天备份':'聊天备份'} · 选择导入</h2><button class="iconbtn" data-action="close-dialog">×</button></div><p class="muted">共识别 ${importSessionList.length} 个会话。仅导入勾选会话，保留原始备份。不同来源和不同会话的记忆独立存放。</p><div class="btnrow"><button class="minor" data-action="import-select-all">全部选择</button><button class="minor" data-action="import-select-none">全部取消</button></div><div class="import-list">${importSessionList.map((x,i)=>`<label class="import-item"><input type="checkbox" class="import-check" value="${esc(x.id)}" checked><span><strong>${esc(x.title||'未命名会话')}</strong><small>${esc(x.count??x.nodeCount??'?')} 条记录${x.branchCount?' · '+esc(x.branchCount)+' 处分支':''}</small></span></label>`).join('')}</div><div class="btnrow"><button class="action" data-action="import-selected">导入已选会话</button><button class="action secondary" data-action="close-dialog">取消</button></div></div></div>`;
if(dialog==='status-request')return `<div class="dialog-shade" data-action="close-dialog"><div class="dialog" data-dialog="true"><div class="dialoghead"><h2>生成任意状态栏</h2><button class="iconbtn" data-action="close-dialog">×</button></div><p class="muted">在对话里描述状态栏的名称、栏目、风格和需要保留的信息。不限制为任何固定类别。</p><textarea class="field" id="statusRequestText" style="min-height:170px" placeholder="例如：请给我生成一个角色状态栏，包含人物心情、当前地点、关系变化和下一步行动，使用简洁的折叠卡片。">请根据目前的对话生成一个角色状态栏，包括当前场景、人物关系与重要变化。</textarea><div class="btnrow"><button class="action" data-action="insert-status-request">插入输入框</button><button class="action secondary" data-action="close-dialog">取消</button></div></div></div>`;
if(dialog==='template')return `<div class="dialog-shade" data-action="close-dialog"><div class="dialog" data-dialog="true"><div class="dialoghead"><h2>新增提示词模板</h2><button class="iconbtn" data-action="close-dialog">×</button></div>${field('模板名称','templateName','')}<label class="label">模板内容</label><textarea class="field" id="templateText" style="min-height:200px"></textarea><div class="btnrow"><button class="action" data-action="save-template">保存模板</button></div></div></div>`;
return '';}
async function saveAll(){
 const value=(id,fallback='')=>document.getElementById(id)?.value??fallback;
 const integer=(id,min,max,d)=>Math.min(max,Math.max(min,parseInt(value(id,d),10)||d));
 config={...config,theme:value('theme',config.theme),fontSize:Math.max(.8,Math.min(1.6,parseFloat(value('fontSize',1))||1)),summaryEvery:integer('summaryEvery',5,1000,50),messageLayout:value('messageLayout',config.messageLayout||'both-left'),collapseCode:!!document.getElementById('collapseCode')?.checked,autoTitle:!!document.getElementById('autoTitle')?.checked,markdownEnabled:!!document.getElementById('markdownEnabled')?.checked,spellcheckEnabled:!!document.getElementById('spellcheckEnabled')?.checked,injectMeta:!!document.getElementById('injectMeta')?.checked,longPasteAsFile:!!document.getElementById('longPasteAsFile')?.checked,contextCount:integer('contextCount',1,100000,100),maxContextChars:integer('maxContextChars',3000,4000000,28000),contextTokenLimit:integer('contextTokenLimit',512,1000000,16000),recallCount:integer('recallCount',1,30,8),keywordPriority:!!document.getElementById('keywordPriority')?.checked,eventLinking:!!document.getElementById('eventLinking')?.checked,timelineRetrieval:!!document.getElementById('timelineRetrieval')?.checked,eventWindow:integer('eventWindow',1,4,2),crossSession:document.getElementById('crossSession').checked,notebookEnabled:!!document.getElementById('notebookEnabled')?.checked,notebookAIExtract:!!document.getElementById('notebookAIExtract')?.checked};
 config.activeModels={chat:value('modelFor-chat'),summary:value('modelFor-summary'),embedding:value('modelFor-embedding')};
 // All model editing now happens in the single named model-profile manager.
 // Keep legacy settings intact for migration, without re-saving hidden duplicate forms.
 config.embedding.enabled=!!config.activeModels.embedding;
 config=await Engine.saveSettings(config);theme();toast('界面和独立模型分工已保存在手机');await render({keepScroll:true});
}
function updateProgress(n,total,text){importProgress=n;progressMax=total;statusMessage=text;const label=document.getElementById('importStatus')||document.getElementById('search-status');if(label)label.textContent=text;const bar=document.getElementById('importProgressBar');if(bar)bar.style.width=(total?Math.round(n/total*100):0)+'%';}
async function doImport(file,own=false,selectedIds=null){if(!file&&!own&&importCandidate?.sourceFile)file=importCandidate.sourceFile;if(!file)return;page='settings';drawer=false;dialog='';await render();try{updateProgress(0,1,`准备导入：${file.name}`);let result;if(own){result=await Engine.restoreOwnArchive(file,(n,t,x)=>updateProgress(n,t,x));statusMessage=`恢复完成：${result} 个会话`;}else{if(!importCandidate||importCandidate.fileName!==file.name)importCandidate=await Importer.prepare(file,x=>updateProgress(0,1,x));const ids=selectedIds||importCandidate.sessions.map(x=>x.id);result=await Importer.importSelected(importCandidate,ids,x=>updateProgress(0,1,x));statusMessage=`${result.source} 导入完成：新增 ${result.added} 个会话、${result.messages} 条消息、${result.assets||0} 项资源；跳过 ${result.skipped} 个会话；检测到 ${result.forks||0} 处分支，修复旧导入 ${result.repaired||0} 个。`;}await refreshSessions();await render();toast(statusMessage);}catch(e){statusMessage='导入失败：'+e.message;updateProgress(0,1,statusMessage);toast(statusMessage);}}
async function previewImport(file){if(!file)return;page='settings';drawer=false;dialog='';await render();try{updateProgress(0,1,'正在识别 ZIP / JSON 备份会话…');importCandidate=await Importer.prepare(file,x=>updateProgress(0,1,x));importCandidate.sourceFile=file;importKind=importCandidate.type==='rikkahub'?'rikka':'chatbox';importSessionList=importCandidate.sessions.map(x=>({...x,title:x.name||x.title}));dialog='import-preview';await render();}catch(e){toast('备份预览失败：'+e.message);updateProgress(0,1,e.message);}}
async function download(blob,filename){if(window.NativeBridge?.beginExport){window.NativeBridge.beginExport(filename,'application/zip');const part=64000;for(let offset=0;offset<blob.size;offset+=part){const bytes=new Uint8Array(await blob.slice(offset,offset+part).arrayBuffer());let bin='';for(let i=0;i<bytes.length;i+=8192)bin+=String.fromCharCode(...bytes.slice(i,i+8192));window.NativeBridge.appendExport(btoa(bin));}window.NativeBridge.finishExport();return;}const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
async function send(){if(busy)return;const input=document.getElementById('composer');let text=(input?.value||'').trim();if(!text&&!pendingAttachments.length)return;const atts=pendingAttachments;pendingAttachments=[];drafts.set(sessionId,'');await Store.setSetting('draft:'+sessionId,'');busy=true;const justSent=await Engine.appendMessage(sessionId,'user',text,atts);if(config.autoTitle){const sess=await Store.get('sessions',sessionId);if(sess?.name==='新聊天'){sess.name=text.replace(/\s+/g,' ').slice(0,22)||'新聊天';await Store.put('sessions',sess);}}await render();try{const result=await Engine.reply(sessionId,text=>{const live=document.getElementById('liveResponse');if(live){live.textContent=text.slice(-18000);live.scrollIntoView({block:'end'});}});lastRecall=result.recalled;if(result.notebookError)toast('本轮聊天已保存，但记事本归档失败：'+result.notebookError);if(config.embedding.enabled&&config.embedding.model){Engine.buildVectors(sessionId,()=>{},['chunk:'+justSent.id,'chunk:'+result.id]).catch(e=>console.warn('增量向量索引失败',e));}await refreshSessions();await render();if(lastRecall.length)toast(`已检索 ${lastRecall.length} 条相关旧记录`);Engine.autoSummarize(sessionId,toast).then(async()=>{if(page==='chat')await render();}).catch(console.warn);}catch(e){busy=false;toast('发送失败：'+e.message);await refreshSessions();await render();return;}busy=false;await render();}
async function manualSummary(force=true){if(busy){toast('当前有聊天任务执行中');return;}busy=true;toast('正在使用总结模型生成独立历史总结…');try{const r=await Engine.summarize(sessionId,force);toast(r.summary?`总结已永久保存：第${r.summary.startOrdinal}—${r.summary.endOrdinal}条`:r.reason||'无需总结');}catch(e){toast('总结失败：'+e.message);}finally{busy=false;await render();}}
function isTransientSummaryError(error){return Engine.classifySummaryFailure(error).kind==='transient';}
function friendlySummaryError(error){return Engine.classifySummaryFailure(error).message;}

async function testSummaryModel(){
 if(busy){toast('请先结束当前生成任务');return;}
 const c=await Engine.settings();const conf=c.summary?.model?c.summary:c.chat;
 if(!conf?.url||!conf?.model){backfillStatus='没有配置总结模型。请先到设置 → 多个模型中指定总结模型。';await render();return;}
 busy=true;backfillStatus='正在测试总结模型 '+conf.model+'（短消息测试）…';await render();
 try{const result=await Engine.testModel({...conf,type:'chat'});backfillStatus=`总结模型连接成功（${result.elapsed}ms）：${result.result}。注意：长文本仍可能引发上游 502。`;}
 catch(e){backfillStatus='总结模型测试失败：'+friendlySummaryError(e);}
 finally{busy=false;await render();}
}
async function backfill(){
 if(busy){toast('已有生成任务在执行');return;}
 const targetSession=sessionId;busy=true;let done=0,initial=0,skipped=0;
 const say=text=>{backfillStatus=text;const el=document.getElementById('backfillStatus');if(el)el.textContent=text;};
 try{
  const plan=await Engine.backfillPlan(targetSession);initial=plan.remaining;
  if(!initial){say('当前会话没有未总结的历史消息，已有总结不需要重新生成。');return;}
  const c=await Engine.settings();const model=c.summary?.model?c.summary:c.chat;
  if(!model?.model||!model?.url){say('无法开始：未配置总结模型。请先到设置 → 多个模型中指定并测试总结模型。');return;}
  const btn=document.querySelector('[data-action="backfill-summary"]');if(btn){btn.disabled=true;btn.textContent='生成新总结中…';}
  // One archived summary covers the chosen 20/50/100 messages. Split long
  // source into separate API calls, then combine as ONE immutable archive.
  // On upstream 502/EOF retry with smaller request bodies, not tiny archives.
  const batchSize=[20,50,100].includes(Number((await Store.get('sessions',targetSession))?.memory?.backfillBatchSize))?Number((await Store.get('sessions',targetSession)).memory.backfillBatchSize):20;
  const profiles=[4800,2800,1600,950].map(maxBlockChars=>({maxMessages:batchSize,maxBlockChars}));
  for(let i=0;i<400;i++){
   const remaining=await Engine.backfillPlan(targetSession);
   if(!remaining.remaining)break;
   let saved=false;
   for(let j=0;j<profiles.length;j++){
    const size=profiles[j];const next=await Engine.backfillPlan(targetSession,size);
    say(`正在归档第 ${next.firstOrdinal}—${next.lastOrdinal} 条（每份最多 ${batchSize} 条）· 已完成 ${initial-remaining.remaining}/${initial} 条${j?' · 上游异常，缩小请求片段重试':''}`);
    try{
     const result=await Engine.summarize(targetSession,true,{backfill:true,...size,onProgress:({complete,total,continuation,part,completed})=>say(`总结第 ${next.firstOrdinal}—${next.lastOrdinal} 条 · 文本片段 ${complete}/${total} 已确认${!completed&&continuation?' · 正在续写第 '+part+' 片（第 '+continuation+' 次）':''} · 已归档 ${initial-remaining.remaining}/${initial} 条。当前这份未完成前不进入下一份。`)});
     if(!result.summary)throw Error(result.reason||'未生成总结');
     done++;saved=true;break;
    }catch(e){if(!isTransientSummaryError(e)||j===profiles.length-1)throw e;}
   }
   if(!saved)break;
  }
  const rest=await Engine.backfillPlan(targetSession);
  say(rest.remaining===0?`新总结完成：新增 ${done} 份独立档案，已有总结没有修改。`:`已生成 ${done} 份新总结，仍有 ${rest.remaining} 条未总结历史。再次点击「生成新总结」即可续跑。`);
 }catch(e){const rest=await Engine.backfillPlan(targetSession);say(`已保存 ${done} 份，仍有 ${rest.remaining} 条待补。已暂停（第 ${rest.firstOrdinal||'?'}—${rest.lastOrdinal||'?'} 条）：${friendlySummaryError(e)} ${Engine.classifySummaryFailure(e).kind==='policy'?'请先在设置中自行选择合适的总结模型；不要反复点击重发。':'下次点击从未归档的位置继续。'}`);}
 finally{busy=false;await render();}
}
async function repairOldSummaries(oneId=''){
 if(busy){toast('已有总结/生成任务在进行');return;}
 const targetSession=sessionId;busy=true;let completed=0,attempted=0;
 const say=text=>{backfillStatus=text;const el=document.getElementById('backfillStatus');if(el)el.textContent=text;};
 try{
  const all=(await Store.inSession('summaries',targetSession)).filter(Engine.summaryNeedsReview).sort((a,b)=>Number(a.startOrdinal)-Number(b.startOrdinal));
  const tasks=oneId?all.filter(s=>s.id===oneId):all;
  if(!tasks.length){say('没有待校验的旧总结；已完成校验的档案不会重复生成。');return;}
  for(let i=0;i<tasks.length;i++){
   const cur=tasks[i];attempted=i+1;
   say(`正在补全旧总结 ${attempted}/${tasks.length} · 第 ${cur.startOrdinal}—${cur.endOrdinal} 条。必须完成这一份才能继续下一份…`);
   const fixed=await Engine.repairSummary(targetSession,cur.id,({complete,total,continuation,part})=>say(`修复 ${attempted}/${tasks.length} · 第 ${cur.startOrdinal}—${cur.endOrdinal} 条 · 原文片段 ${complete}/${total}${continuation?' · 续写第 '+continuation+' 轮':''}`));
   if(fixed.summary)completed++;
  }
  say(`旧总结校验完成：成功补全 ${completed} 份，原文和所有修复前文本均保留。`);
 }catch(e){say(`已完整补全 ${completed} 份，当前第 ${attempted} 份未通过校验，任务暂停，不能跳过继续下一份。错误：${friendlySummaryError(e)}；原档案保持不变。`);}
 finally{busy=false;dialog='';await render();}
}
async function doSearch(){searchQuery=document.getElementById('memorySearch')?.value?.trim()||'';if(!searchQuery){toast('请输入要检索的历史内容');return;}updateProgress(0,1,'正在检索历史原文、旧总结和向量索引…');try{searchResults=await Engine.search(searchQuery,sessionId,15);statusMessage=`找到 ${searchResults.length} 条线索（精确关键词优先，关联前后事件；向量模型未配置时使用本地语义）`;await render();}catch(e){toast('搜索失败：'+e.message);}}
async function buildIndex(){if(busy)return;busy=true;updateProgress(0,1,'构建语义向量索引中…');try{const count=await Engine.buildVectors(sessionId,(n,total)=>updateProgress(n,total,`向量索引 ${n}/${total}`));toast(`完成：新增 ${count} 条语义向量`);}catch(e){toast('索引失败：'+e.message);}finally{busy=false;await render();}}
async function jump(session,ordinal){page='chat';sessionId=session;showLimit=Number.MAX_SAFE_INTEGER;drawer=false;dialog='';await render();const el=document.getElementById('msg-'+ordinal);if(el){el.scrollIntoView({block:'center'});el.classList.add('jumpmark');setTimeout(()=>el.classList.remove('jumpmark'),3500);}else toast('已切换到对应会话，但该条原文未能定位');}
async function handleClick(ev){const element=ev.target.closest('[data-action]');if(!element)return;if(element.classList.contains('dialog-shade')&&ev.target.closest('[data-dialog]'))return;const a=element.dataset.action;const id=element.dataset.id;const idx=Number(element.dataset.index);try{
switch(a){
case 'plus-menu':dialog='plus-menu';await render();break;
case 'go-prompts':page='prompts';dialog='';await render();break;
case 'go-memory':page='memory';drawer=false;dialog='';await render();break;
case 'start-new-history-summary':page='memory';drawer=false;dialog='';await render();await backfill();break;
case 'go-settings':page='settings';drawer=false;dialog='';await render();break;
case 'quick-params':dialog='quick-params';await render();break;
case 'memory-settings':dialog='memory-settings';await render();break;
case 'expand-composer':{const el=document.getElementById('composer');if(el)drafts.set(sessionId,el.value);dialog='expanded-composer';await render();break;}
case 'apply-expanded':{drafts.set(sessionId,document.getElementById('expandedText')?.value||'');dialog='';await render();document.getElementById('composer')?.focus();break;}
case 'save-quick-params':{const sess=await Store.get('sessions',sessionId);const num=(id,defaultValue)=>Number(document.getElementById(id)?.value??defaultValue);sess.generation={...(sess.generation||{}),contextCount:Math.max(1,Math.min(100000,Math.floor(num('quickContextCount',100)))),contextTokenLimit:Math.max(512,Math.min(1000000,Math.floor(num('quickContextTokens',16000)))),temperature:Math.max(0,Math.min(2,num('quickTemperature',.7))),topP:Math.max(0,Math.min(1,num('quickTopP',1))),maxTokens:Math.max(32,Math.min(64000,Math.floor(num('quickMaxTokens',2048)))),stream:!!document.getElementById('quickStream')?.checked,thinkingEnabled:!!document.getElementById('quickThinking')?.checked};await Store.put('sessions',sess);dialog='';await render();toast('当前会话生成参数已保存');break;}
case 'save-memory-settings':{const sess=await Store.get('sessions',sessionId);sess.memory={...(sess.memory||{}),summaryEvery:Math.max(5,Math.min(1000,parseInt(document.getElementById('memorySummaryEvery')?.value)||50)),backfillBatchSize:[20,50,100].includes(Number(document.getElementById('memoryBackfillBatchSize')?.value))?Number(document.getElementById('memoryBackfillBatchSize')?.value):20,recallCount:Math.max(1,Math.min(30,parseInt(document.getElementById('memoryRecallCount')?.value)||8)),maxRecallChars:Math.max(1000,Math.min(100000,parseInt(document.getElementById('memoryRecallChars')?.value)||12000)),keywordPriority:!!document.getElementById('memoryKeywordPriority')?.checked,eventLinking:!!document.getElementById('memoryEventLinking')?.checked,timelineRetrieval:!!document.getElementById('memoryTimelineRetrieval')?.checked,eventWindow:Math.max(1,Math.min(4,parseInt(document.getElementById('memoryEventWindow')?.value)||2)),crossSession:!!document.getElementById('memoryCrossSession')?.checked};sess.notebookEnabled=!!document.getElementById('memoryNotebook')?.checked;await Store.put('sessions',sess);dialog='';await render();toast('当前会话记忆规则已保存');break;}
case 'bulk-role-avatar':{avatarBatchMessage='';drawer=false;dialog='bulk-role-avatar';await render({keepScroll:true});break;}
case 'pick-avatar-batch':{const mode=element.dataset.mode,overwrite=!!document.getElementById('bulkAvatarOverwrite')?.checked;if(!roleAvatarBatchPicker){toast('批量图片选择器不可用');break;}avatarBatchTarget={mode,overwrite};roleAvatarBatchPicker.multiple=mode==='named';roleAvatarBatchPicker.click();break;}
case 'open-session-menu':dialog='session-menu:'+element.dataset.session;await render({keepScroll:true});break;
case 'toggle-pin':{const sess=await Store.get('sessions',element.dataset.session);if(!sess)break;sess.pinned=!sess.pinned;sess.pinnedAt=sess.pinned?new Date().toISOString():null;sess.pinPreferenceModified=true;await Store.put('sessions',sess);await refreshSessions();dialog='';await render({keepScroll:true});toast(sess.pinned?'会话已置顶':'已取消置顶');break;}
case 'pick-avatar':{avatarUploadTarget={type:element.dataset.target,sessionId:element.dataset.session||sessionId};if(!avatarPicker){toast('本地头像选择器不可用');break;}avatarPicker.click();break;}
case 'remove-avatar':{const kind=element.dataset.target,sid=element.dataset.session||sessionId;if(kind==='global-user'){config.userAvatarData='';config=await Engine.saveSettings(config);const preview=document.getElementById('global-user-avatar-preview');if(preview)preview.innerHTML=avatarHtml('','我');}else{const sess=await Store.get('sessions',sid);if(!sess)break;const key=kind==='role'?'characterAvatarData':'userAvatarData';sess[key]='';await Store.put('sessions',sess);const preview=document.getElementById(kind==='role'?'role-avatar-preview':'session-user-avatar-preview');if(preview)preview.innerHTML=avatarHtml(kind==='role'?'':config.userAvatarData,kind==='role'?sess.characterName:'我');}toast('头像设置已更新');break;}
case 'edit-role-active':dialog='role-editor:'+sessionId;await render();break;
case 'edit-role':dialog='role-editor:'+element.dataset.session;drawer=false;await render();break;
case 'save-role-editor':{const sess=await Store.get('sessions',element.dataset.session);if(!sess)break;sess.name=document.getElementById('editSessionTitle').value.trim()||sess.name;sess.characterName=document.getElementById('editCharacterName').value.trim()||'AI';sess.systemPrompt=document.getElementById('editRolePrompt').value;await Store.put('sessions',sess);await refreshSessions();dialog='';await render();toast('角色资料已保存');break;}
case 'delete-session':{const sid=element.dataset.session;if(!confirm('永久删除这个会话和所有消息、总结？请先备份重要内容。'))break;await Store.deleteSession(sid);if(sessionId===sid)sessionId=null;await refreshSessions();if(!allSessions.length){const sess=await Engine.createSession();sessionId=sess.id;await refreshSessions();}dialog='';drawer=false;page='chat';await render();toast('会话已删除');break;}
case 'message-menu':dialog='message-menu:'+id;await render({keepScroll:true});break;
case 'edit-message':dialog='message-edit:'+id;await render();break;
case 'save-message-edit':{const text=document.getElementById('editedMessageText')?.value||'';await Engine.editMessage(id,text);dialog='';await render();toast('消息已修改，原始总结仍保留');break;}
case 'switch-message-branch':{const m=await Store.get('messages',id);if(!m)break;const versions=messageVariants(m);if(versions.length<2)break;const next=activeBranchIndex(m,versions)+Number(element.dataset.step||0);if(next<0||next>=versions.length)break;if(m.branchPivot){try{await Engine.switchChatboxBranch(m.sessionId,m.branchPivot,next);dialog='';await render({keepScroll:true});toast('已切换到第 '+(next+1)+' / '+versions.length+' 个分支（含后续消息）');}catch(e){toast(e.message);}break;}const v=versions[next];m.branchVariants=versions;m.branchIndex=next;m.content=v.content||'';m.role=v.role||m.role;m.reasoning=v.reasoning||'';m.rawParts=v.rawParts||null;m.attachments=v.attachments||[];m.tokenUsage=v.tokenUsage||m.tokenUsage;m.timestamp=v.timestamp||m.timestamp;await Store.put('messages',m);const chunk=Engine.chunkFor(m);if(chunk)await Store.put('chunks',chunk);else await Store.del('chunks','chunk:'+m.id);dialog='';await render({keepScroll:true});toast('已切换到第 '+(next+1)+' / '+versions.length+' 个分支');break;}
case 'copy-message':{const msg=await Store.get('messages',id);if(!msg)break;try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(msg.content||'');else{const t=document.createElement('textarea');t.value=msg.content||'';document.body.appendChild(t);t.select();if(!document.execCommand('copy'))throw Error('复制失败');t.remove();}toast('已复制消息');}catch(e){toast('复制失败：'+e.message);}dialog='';await render({keepScroll:true});break;}
case 'quote-message':{const msg=await Store.get('messages',id);if(!msg)break;const quoted=String(msg.content||'').slice(0,3000).split('\n').map(line=>'> '+line).join('\n');drafts.set(sessionId,((drafts.get(sessionId)||'')+'\n'+quoted+'\n\n').trimStart());dialog='';await render({keepScroll:true});document.getElementById('composer')?.focus();toast('已引用到输入框');break;}
case 'regenerate-message':{if(busy){toast('请先完成当前生成');break;}const m=await Store.get('messages',id);if(!m||m.role!=='assistant')break;const msgs=await Store.orderedMessages(m.sessionId);if(msgs.at(-1)?.id!==m.id){toast('只能重新生成末条 AI 回复；历史消息可切换已有分支');break;}if(!confirm('重新生成最后一条 AI 回复？原回复将保留为可切换分支。'))break;dialog='';busy=true;await render({keepScroll:true});try{const res=await Engine.reply(m.sessionId,null,{regenerateTargetId:m.id});await refreshSessions();toast('已保留原回复，现有 '+(res.branchVariants?.length||2)+' 个分支');}catch(e){toast('重新回答失败：'+e.message);}finally{busy=false;await render({keepScroll:true});}break;}
case 'delete-message':{if(!confirm('删除此条消息？对应原文索引将清除，历史总结保留。'))break;await Engine.deleteMessage(id);dialog='';await render();toast('已删除单条消息');break;}
case 'pull-models':{const url=document.getElementById('profileUrl')?.value||'',key=document.getElementById('profileKey')?.value||'',type=document.getElementById('profileType')?.value||'embedding';const output=document.getElementById('modelProbeResult');output.textContent=type==='embedding'?'正在拉取 Embedding 向量模型…':'正在拉取聊天模型…';try{const list=await Engine.listModels({url,key,type});output.innerHTML=list.length?'<div class="model-results">'+list.slice(0,200).map(m=>`<button class="minor model-result" data-action="choose-model" data-model="${esc(m)}">${esc(m)}</button>`).join('')+'</div>':(type==='embedding'?'没有返回匹配的向量模型。请确认服务商是否支持 Embedding，也可手动填写模型 ID。':'服务器已响应，但没有返回模型列表。请手动输入模型 ID。');}catch(e){output.textContent='拉取失败：'+e.message;}break;}
case 'choose-model':document.getElementById('profileModel').value=element.dataset.model;toast('已选择模型：'+element.dataset.model);break;
case 'test-model':{const output=document.getElementById('modelProbeResult');output.textContent='正在测试实际模型请求…';const p={url:document.getElementById('profileUrl').value,key:document.getElementById('profileKey').value,model:document.getElementById('profileModel').value,type:document.getElementById('profileType').value};try{const r=await Engine.testModel(p);output.textContent='✔ '+r.result+' · 耗时 '+r.elapsed+' ms · '+r.endpoint;}catch(e){output.textContent='测试失败：'+e.message;}break;}
case 'drawer':drawer=!drawer;await render();break;case 'back':page='chat';dialog='';await render();break;case 'go':page=element.dataset.page;drawer=false;dialog='';searchResults=[];await render();break;case 'new-chat':{const s=await Engine.createSession();sessionId=s.id;drawer=false;dialog='';page='chat';showLimit=100;await refreshSessions();await render();break;}
case 'select-session':sessionId=element.dataset.session;showLimit=100;drawer=false;page='chat';dialog='';await render();break;
case 'chat-model-shortcut':dialog='model-profile:new-chat';await render();break;
case 'more':showLimit+=100;await render({keepScroll:true});break;
case 'send':await send();break;case 'status-request':dialog='status-request';await render();break;case 'insert-status-request':{const text=document.getElementById('statusRequestText')?.value?.trim();if(!text){toast('请输入状态栏描述');break;}drafts.set(sessionId,((drafts.get(sessionId)||'')+'\n'+text).trim());dialog='';await render();document.getElementById('composer')?.focus();break;}
case 'attach':dialog='';attachPicker.click();break;
case 'clear-attachments':pendingAttachments=[];await render();break;
case 'prompt-dialog':dialog='prompt';await render();break;
case 'summary-panel':dialog='summary-list';await render();break;
case 'notebook-panel':dialog='notebook-panel';await render();break;
case 'notebook-snapshot':dialog='notebook-snapshot:'+element.dataset.ord;await render();break;
case 'jump-note':await jump(sessionId,Number(element.dataset.ord));break;
case 'retry-notebook-volume':{const vol=Number(element.dataset.volume);toast('正在尝试为第'+vol+'卷生成100至200字的卷总结…');const r=await Notebook.chapterSummary(sessionId,vol);await render();toast(r.status==='complete'?'卷总结已归档，旧内容未修改':'总结仍待生成：'+r.error);break;}
case 'copy-notebook-html':{const currentEnd=dialog.startsWith('notebook-snapshot:')?Number(dialog.slice(18)):Infinity;const content=await Notebook.exportHTML(sessionId,currentEnd);if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(content);toast('已复制包含全部章节的记事本HTML');}else{const input=document.createElement('textarea');input.value=content;document.body.appendChild(input);input.select();const copied=document.execCommand('copy');input.remove();toast(copied?'已复制记事本HTML':'设备不允许自动复制，请使用备份导出');}break;}
case 'open-memory':dialog='';page='memory';await render();break;
case 'summary-detail':dialog='summary:'+id;await render();break;
case 'close-dialog':dialog='';await render();break;
case 'jump-summary':await jump(element.dataset.session,Number(element.dataset.start));break;
case 'jump-result':await jump(element.dataset.session,Number(element.dataset.ord));break;
case 'save-dialog-prompt':{const s=await Store.get('sessions',sessionId);s.systemPrompt=document.getElementById('dialogPrompt').value;await Store.put('sessions',s);dialog='';await render();toast('已保存会话系统提示词');break;}
case 'save-session-prompt':{const s=await Store.get('sessions',sessionId);s.systemPrompt=document.getElementById('sessionPrompt').value;await Store.put('sessions',s);toast('会话人设已保存');break;}
case 'save-global-prompt':config.systemPrompt=document.getElementById('globalPrompt').value;await Engine.saveSettings(config);toast('全局提示词已保存');break;
case 'save-summary-prompt':config.summaryPrompt=document.getElementById('summaryPrompt').value;await Engine.saveSettings(config);toast('独立总结提示词已保存');break;
case 'save-notebook-prompt':config.notebookPrompt=document.getElementById('notebookPrompt').value;await Engine.saveSettings(config);toast('记事本内置提示词已保存，旧卷不受影响');break;
case 'save-session-notebook':{const s=await Store.get('sessions',sessionId);if(!s)break;const mode=document.getElementById('sessionNotebookMode').value;s.notebookEnabled=mode==='inherit'?undefined:mode==='on';s.notebookPrompt=document.getElementById('sessionNotebookPrompt').value;await Store.put('sessions',s);toast('当前会话的独立记事本规则已保存');break;}
case 'manual-summary-dialog':dialog='manual-range';await render();break;
case 'manual-summary':dialog='';await manualSummary(true);break;
case 'confirm-summary-range':{
 const start=Number(document.getElementById('rangeStart')?.value),end=Number(document.getElementById('rangeEnd')?.value);
 if(!(start>=1&&end>=start)){toast('消息范围有误');break;}
 dialog='';busy=true;await render();toast('正在生成指定范围的独立总结…');
 try{const r=await Engine.summarizeRange(sessionId,start,end);toast('手动总结已存档：第 '+r.summary.startOrdinal+'—'+r.summary.endOrdinal+' 条');}
 catch(e){toast('手动总结失败：'+e.message);}finally{busy=false;await render();}break;
}
case 'import-select-all':document.querySelectorAll('.import-check').forEach(el=>el.checked=true);break;
case 'import-select-none':document.querySelectorAll('.import-check').forEach(el=>el.checked=false);break;
case 'import-selected':{
 const ids=[...document.querySelectorAll('.import-check:checked')].map(el=>el.value);
 if(!ids.length){toast('至少选择一个会话');break;}
 await doImport(importCandidate.sourceFile||null,false,ids);
 break;
}case 'backfill-summary':await backfill();break;case 'repair-old-summaries':await repairOldSummaries();break;case 'repair-single-summary':await repairOldSummaries(id);break;case 'test-summary-model':await testSummaryModel();break;
case 'search':await doSearch();break;case 'build-vectors':await buildIndex();break;case 'save-settings':await saveAll();break;
case 'import':picker.dataset.own='';picker.click();break;
case 'restore':picker.dataset.own='yes';picker.click();break;
case 'new-model-profile':dialog='model-profile:new-embedding';await render();break;
case 'new-chat-model':dialog='model-profile:new-chat';await render();break;
case 'new-embedding-model':dialog='model-profile:new-embedding';await render();break;
case 'use-siliconflow':{const url=document.getElementById('profileUrl');if(url)url.value='https://api.siliconflow.cn/v1';document.getElementById('modelProbeResult').textContent='已填写官方 /v1 地址。向量模型请选择 Embedding 用途后拉取。';break;}
case 'edit-model-profile':dialog='model-profile:'+id;await render();break;
case 'save-model-profile':{
 const value=(key)=>String(document.getElementById(key)?.value||'').trim();
 const p={id:id||Engine.uuid(),name:value('profileName'),type:value('profileType'),source:value('profileSource'),url:value('profileUrl').replace(/\/+$/,''),model:value('profileModel'),key:document.getElementById('profileKey')?.value||'',maxTokens:Math.min(64000,Math.max(32,Number(value('profileMaxTokens'))||2048)),maxTokensField:value('profileMaxTokensField')||'max_tokens',temperature:Math.min(2,Math.max(0,Number(value('profileTemperature'))||.7)),topP:Math.min(1,Math.max(0,Number(value('profileTopP'))||1)),stream:!!document.getElementById('profileStream')?.checked,thinkingEnabled:!!document.getElementById('profileThinking')?.checked};
 if(!p.name||!p.url||!p.model){toast('请填写名称、API 地址和模型 ID');break;}
 if(!/^https?:\/\//i.test(p.url)){toast('API 地址需要以 http:// 或 https:// 开头');break;}
 const index=(config.modelProfiles||[]).findIndex(x=>x.id===p.id);
 if(index>=0)config.modelProfiles[index]=p;else config.modelProfiles=[...(config.modelProfiles||[]),p];
 config.activeModels=config.activeModels||{chat:'',summary:'',embedding:''};
 if(index<0&&p.type==='embedding'&&!config.activeModels.embedding)config.activeModels.embedding=p.id;
 if(index<0&&p.type==='chat'&&!config.activeModels.chat)config.activeModels.chat=p.id;
 if(config.activeModels.embedding)config.embedding.enabled=true;
 config=await Engine.saveSettings(config);dialog='';await render();toast('已保存模型「'+p.name+'」，可以为各项任务独立选择');break;
}
case 'delete-model-profile':{
 const p=(config.modelProfiles||[]).find(x=>x.id===id);if(!p||!confirm('删除模型配置「'+p.name+'」？旧聊天与历史总结不会丢失。'))break;
 config.modelProfiles=config.modelProfiles.filter(x=>x.id!==id);
 for(const kind of ['chat','summary','embedding'])if(config.activeModels?.[kind]===id)config.activeModels[kind]='';
 config=await Engine.saveSettings(config);await render();toast('已删除模型配置');break;
}
case 'github-save':{const msg=BackupUI.save();toast(msg);if(!msg.startsWith('ERROR:')){await render();}break;}
case 'github-now':{toast('正在生成本地加密快照…');BackupUI.snapshot(true).then(result=>{toast(result);render().catch(console.warn);}).catch(e=>toast('备份失败：'+e.message));break;}
case 'github-refresh':await render();break;
case 'export':{toast('正在生成 ZIP 备份…');const zip=await Engine.exportArchive();await download(zip,'recallchat-'+new Date().toISOString().slice(0,10)+'.zip');toast('备份文件已经生成');break;}
case 'add-template':dialog='template';await render();break;
case 'save-template':{const name=document.getElementById('templateName').value.trim();const content=document.getElementById('templateText').value.trim();if(!name||!content){toast('请填写模板名称和内容');break;}config.templates=[...(config.templates||[]),{name,content}];await Engine.saveSettings(config);dialog='';await render();toast('模板已保存');break;}
case 'apply-template':{const p=(config.templates||[])[idx];if(!p)break;const s=await Store.get('sessions',sessionId);s.systemPrompt=(s.systemPrompt||'')+'\n\n'+p.content;await Store.put('sessions',s);toast('已追加到当前会话专属提示词');await render();break;}
case 'delete-template':config.templates.splice(idx,1);await Engine.saveSettings(config);await render();break;
case 'rename-chat':{const s=await Store.get('sessions',sessionId);const name=prompt('新的聊天名称',s.name);if(name?.trim()){s.name=name.trim();await Store.put('sessions',s);await refreshSessions();await render();}break;}
case 'delete-chat':if(confirm('永久删除当前会话及其消息和总结？这不会删除原 聊天备份 备份文件。')){await Store.deleteSession(sessionId);await refreshSessions();if(!allSessions.length){const s=await Engine.createSession();sessionId=s.id;await refreshSessions();}page='chat';await render();}break;
}}
catch(e){console.error(e);toast('操作失败：'+e.message);}}
let longPress=null,longPressOpened=false,pressStart=null;
root.addEventListener('pointerdown',e=>{
 const row=e.target.closest('.msg[data-message]');
 const sessionRow=e.target.closest('.sessionrow[data-session-row]');
 if(!row&&!sessionRow)return;
 if(e.target.closest('button,textarea,a,summary,details')&&!e.target.closest('.sessionmain'))return;
 clearTimeout(longPress);longPressOpened=false;pressStart={x:e.clientX,y:e.clientY};
 longPress=setTimeout(()=>{longPressOpened=true;dialog=row?'message-menu:'+row.dataset.message:'session-menu:'+sessionRow.dataset.sessionRow;render({keepScroll:true}).catch(console.warn);},550);
});
for(const name of ['pointerup','pointercancel','pointerleave','pointermove'])root.addEventListener(name,e=>{
 if(name==='pointermove'&&pressStart&&Math.hypot(e.clientX-pressStart.x,e.clientY-pressStart.y)<11)return;
 clearTimeout(longPress);if(name!=='pointermove')pressStart=null;if(name==='pointerup'&&longPressOpened)setTimeout(()=>{longPressOpened=false;},0);
});
root.addEventListener('contextmenu',e=>{const row=e.target.closest('.msg[data-message]'),sess=e.target.closest('.sessionrow[data-session-row]');if(row||sess){e.preventDefault();dialog=row?'message-menu:'+row.dataset.message:'session-menu:'+sess.dataset.sessionRow;render({keepScroll:true}).catch(console.warn);}});
root.addEventListener('click',e=>{if(longPressOpened){e.preventDefault();longPressOpened=false;return;}handleClick(e);});
let draftTimer;
root.addEventListener('change',async ev=>{
 if(ev.target.id==='chatModelSwitch'){
  if(busy){toast('当前正在生成，请完成后再切换');return;}
  const newId=ev.target.value;
  if(newId&&!(config.modelProfiles||[]).some(x=>x.id===newId&&x.type==='chat')){toast('所选模型已被删除');return;}
  const sess=await Store.get('sessions',sessionId);if(!sess)return;
  const composer=document.getElementById('composer');if(composer)drafts.set(sessionId,composer.value);
  sess.chatModelId=newId;await Store.put('sessions',sess);await render({keepScroll:true});toast('当前会话已切换到 '+(modelForChat(sess)?.name||'默认聊天模型'));
 }
});
root.addEventListener('change',ev=>{
 if(ev.target.id==='theme'){config.theme=ev.target.value;theme();}
 if(ev.target.id==='summaryNeutralMode'){
  const enabled=!!ev.target.checked;
  Engine.saveSettings({...config,summaryNeutralMode:enabled}).then(next=>{
   config=next;backfillStatus=enabled?'已启用中性事实归档提示词。若上游拒绝原文，系统仍会暂停并保留数据。':'已关闭中性归档说明；模型内容政策仍由上游执行。';
  }).catch(err=>toast('保存失败：'+err.message));
 }
 if(ev.target.id==='backfillBatchSize'){
  const n=Number(ev.target.value);
  if(![20,50,100].includes(n))return;
  const activeSession=sessionId;
  Store.get('sessions',activeSession).then(async s=>{
   if(!s)return;
   s.memory={...(s.memory||{}),backfillBatchSize:n};
   await Store.put('sessions',s);
   backfillStatus=`已设置每份总结 ${n} 条。较长原文会分片处理但只建立一份档案；原有总结不变。`;
   if(activeSession===sessionId&&!busy)await render();
  }).catch(err=>toast('保存总结批次失败：'+err.message));
 }
});
root.addEventListener('input',ev=>{
 if(ev.target.id==='fontSize'){
  config.fontSize=Number(ev.target.value);
  const out=document.getElementById('fontSizeValue');if(out)out.textContent=Math.round(config.fontSize*100)+'%';
  theme();return;
 }
});
root.addEventListener('input',ev=>{if(ev.target.id==='composer'){drafts.set(sessionId,ev.target.value);clearTimeout(draftTimer);const id=sessionId,v=ev.target.value;draftTimer=setTimeout(()=>Store.setSetting('draft:'+id,v).catch(console.warn),350);}});
root.addEventListener('paste',async ev=>{if(ev.target.id!=='composer'||!config.longPasteAsFile)return;const pasted=ev.clipboardData?.getData('text/plain')||'';if(pasted.length<=12000)return;ev.preventDefault();const clipped=pasted.slice(0,500000);pendingAttachments.push({name:'粘贴长文本-'+new Date().toISOString().replace(/[:.]/g,'-')+'.txt',type:'text/plain',size:clipped.length,text:clipped});await render();toast(pasted.length>500000?'已作为附件保存前 50 万字，请分批粘贴其余部分':'长文本已作为独立文件附件保存');});
root.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&e.target.id==='composer'){e.preventDefault();send();}if(e.key==='Enter'&&e.target.id==='memorySearch'){e.preventDefault();doSearch();}});
picker.addEventListener('change',async e=>{const file=e.target.files?.[0];if(file){if(picker.dataset.own==='yes')await doImport(file,true);else await previewImport(file);}picker.value='';});
avatarPicker?.addEventListener('change',async ev=>{
 const target=avatarUploadTarget,file=ev.target.files?.[0];ev.target.value='';avatarUploadTarget=null;if(!file||!target)return;
 try{
  const data=await imageDataForAvatar(file);
  if(target.type==='global-user'){
   config.userAvatarData=data;config=await Engine.saveSettings(config);
   const el=document.getElementById('global-user-avatar-preview');if(el)el.innerHTML=avatarHtml(data,'我');
  }else{
   const sess=await Store.get('sessions',target.sessionId);if(!sess)throw Error('会话已不存在');
   const key=target.type==='role'?'characterAvatarData':'userAvatarData';sess[key]=data;await Store.put('sessions',sess);
   const preview=document.getElementById(target.type==='role'?'role-avatar-preview':'session-user-avatar-preview');if(preview)preview.innerHTML=avatarHtml(data,target.type==='role'?(sess.characterName||'角色'):'我');
  }
  toast('头像已保存到手机，聊天中会自动显示');
 }catch(e){toast('设置头像失败：'+e.message);}
});
roleAvatarBatchPicker?.addEventListener('change',async ev=>{
 const job=avatarBatchTarget,files=[...(ev.target.files||[])];ev.target.value='';avatarBatchTarget=null;if(!job||!files.length)return;
 try{
  if(job.mode==='same'&&files.length!==1)throw Error('统一头像模式请选择一张图片');
  if(files.length>100)throw Error('一次最多选择 100 张角色头像');
  const sessions=await Store.all('sessions');
  const plan=job.mode==='same'?AvatarBatch.planSameAvatar(sessions,job.overwrite):AvatarBatch.planNamedAvatars(sessions,files.map(f=>f.name),job.overwrite);
  const used=[...new Set(plan.assignments.map(a=>a.fileIndex))];const images=new Map();
  for(const index of used)images.set(index,await imageDataForAvatar(files[index]));
  let updated=0;
  for(const assignment of plan.assignments){const session=await Store.get('sessions',assignment.sessionId);if(!session||(!job.overwrite&&session.characterAvatarData))continue;session.characterAvatarData=images.get(assignment.fileIndex);await Store.put('sessions',session);updated++;}
  await refreshSessions();
  const skipped=plan.total-updated;
  avatarBatchMessage=`已更新 ${updated} 个会话，未修改 ${skipped} 个。${job.mode==='named'?`未匹配 ${plan.unmatched||0}，多图冲突 ${plan.ambiguous||0}。`:''}已设置的头像默认不会被覆盖。`;
  if(dialog==='bulk-role-avatar')await render({keepScroll:true});else await render({keepScroll:true});
  toast(avatarBatchMessage);
 }catch(error){avatarBatchMessage='批量头像失败：'+error.message;toast(avatarBatchMessage);if(dialog==='bulk-role-avatar')await render({keepScroll:true});}
});
attachPicker.addEventListener('change',async e=>{for(const file of [...e.target.files]){if(file.size>5*1024*1024){toast('单个附件暂限 5MB');continue;}let a={name:file.name,type:file.type,size:file.size};if(file.type.startsWith('image/')){a.dataUrl=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});}else a.text=(await file.text()).slice(0,16000);pendingAttachments.push(a);}await render();attachPicker.value='';});
window.addEventListener('keydown',async e=>{if(e.key==='Escape'){if(dialog){dialog='';await render();}else if(drawer){drawer=false;await render();}else if(page!=='chat'){page='chat';await render();}else{toast('已位于主聊天页');}}});
return {start,render,toast};})();
UI.start().catch(e=>{document.getElementById('app').innerHTML='<div class="empty"><h2>启动失败</h2><p>'+String(e.message).replace(/[<>]/g,'')+'</p></div>';console.error(e);});
