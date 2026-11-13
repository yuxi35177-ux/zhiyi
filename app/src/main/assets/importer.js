/* Two offline import paths: 聊天备份 ZIP/JSON and 聊天备份 SQLite-in-ZIP.
   Preview first; no private source conversation data is uploaded anywhere. */
const Importer=(()=>{
const stamp=(t)=>{if(!t)return new Date().toISOString();if(typeof t==='string')return t;return new Date(t<1e12?t*1000:t).toISOString();};
const partText=p=>{if(!p||typeof p!=='object')return '';if(p.type==='text')return typeof p.text==='string'?p.text:'';if(p.type==='tool')return `[工具调用 ${p.toolName||''}]`;if(p.type==='image')return '[图片]';return '';};
function nodeVariant(item){const parts=Array.isArray(item?.parts)?item.parts:[];return {id:item?.id||null,role:['user','assistant','system','tool'].includes(item?.role)?item.role:'assistant',content:parts.map(partText).filter(Boolean).join('\n'),timestamp:stamp(item?.createdAt),reasoning:parts.filter(x=>x.type==='reasoning').map(x=>x.reasoning||'').join('\n'),rawParts:parts,attachments:parts.filter(x=>x.type==='image').map(x=>({name:'图片',type:'image/*',sourceUrl:x.url||'',source:{...x}}))};}
function fromNode(node,sessionId,index){const variants=(node.messages||[]).map(nodeVariant);const selectedIndex=Math.min(Math.max(0,Number(node.select_index)||0),variants.length-1);const selected=variants[selectedIndex];if(!selected)return null;return {id:`${sessionId}:node:${node.id}`,sessionId,ordinal:index+1,role:selected.role,content:selected.content,timestamp:selected.timestamp,reasoning:selected.reasoning,rawParts:selected.rawParts,raw:{id:selected.id,annotations:node.messages[selectedIndex]?.annotations,usage:node.messages[selectedIndex]?.usage,translation:node.messages[selectedIndex]?.translation,modelId:node.messages[selectedIndex]?.modelId,alternatives:node.messages.length>1?node.messages:undefined},attachments:selected.attachments,sourceId:selected.id,branchVariants:variants.length>1?variants:[],branchIndex:selectedIndex,sourceNodeIndex:node.node_index};} 
function parseChatboxV3File(text){
 // Official 聊天备份 portable v3 ZIPs store independent session/message/thread
 // records in sessions/<id>.jsonl, with parent and active-child links.
 const records=[];
 for(const line of String(text).split(/\r?\n/)){
  if(!line.trim())continue;
  const record=JSON.parse(line);
  if(['session','thread','message'].includes(record?.type))records.push(record);
 }
 return Engine.chatboxV3ToSession(records);
}
async function prepare(file,progress=()=>{}){
 if(!file)throw Error('请选择备份文件');let archive=null;
 if(/\.zip$/i.test(file.name)){progress('解压并识别 ZIP…');archive=await JSZip.loadAsync(file,{checkCRC32:false});
  const v3Files=Object.values(archive.files).filter(f=>!f.dir&&/^sessions\/[^/]+\.jsonl$/i.test(f.name));
  if(v3Files.length){const sessions=[];
   for(let i=0;i<v3Files.length;i++){
    const obj=parseChatboxV3File(await v3Files[i].async('string'));
    if(obj){sessions.push({id:String(obj.id),name:obj.name||'未命名会话',count:obj.messages?.length||0,branchCount:Object.keys(obj.messageForksHash||{}).length,pinned:Engine.sourcePin(obj),path:v3Files[i].name,updatedAt:obj.updatedAt});}
    if(i%8===0)progress(`识别新版 聊天备份 备份 ${i+1}/${v3Files.length}`);
   }
   if(!sessions.length)throw Error('聊天备份 备份中没有有效会话记录');
   return {type:'chatbox-v3',fileName:file.name,archive,sessions};
  }
  const sql=archive.file('rikka_hub.db');
  if(sql){progress('读取 聊天备份 SQLite 数据库目录…');const binary=await sql.async('uint8array');const reader=new SQLiteReader.Reader(binary);const sessions=[];await reader.table('ConversationEntity',row=>{sessions.push({id:String(row.id),name:row.title||'未命名会话',createdAt:stamp(row.create_at),updatedAt:stamp(row.update_at),pinned:Engine.sourcePin(row),raw:row});});sessions.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));if(!sessions.length)throw Error('聊天备份 数据库无会话');return {type:'rikkahub',fileName:file.name,archive,reader,sessions};}
  const sources=Object.values(archive.files).filter(f=>!f.dir&&/sessions\/[^/]+\/session\.json$/i.test(f.name));if(sources.length){const sessions=[];for(let i=0;i<sources.length;i++){const o=JSON.parse(await sources[i].async('string'));if(Array.isArray(o.messages))sessions.push({id:o.id||sources[i].name.split('/')[1],name:o.name||o.threadName||'未命名会话',count:o.messages.length,branchCount:Object.keys(o.messageForksHash||{}).length,pinned:Engine.sourcePin(o),createdAt:o.createdAt||null,updatedAt:o.updatedAt||null,path:sources[i].name});if(i%8===0)progress(`识别 聊天备份 会话 ${i+1}/${sources.length}`);}return {type:'chatbox',fileName:file.name,archive,sessions};}
  const first=Object.values(archive.files).find(f=>!f.dir&&/\.json$/i.test(f.name)&&!/manifest\.json$/i.test(f.name));if(!first)throw Error('ZIP 不包含 聊天备份 会话或 聊天备份 数据库');const obj=JSON.parse(await first.async('string'));const sessions=Engine.resolveSessionObjects(obj).map((s,i)=>({id:s.value.id||String(i),name:s.value.name||s.value.title||'未命名会话',count:s.value.messages?.length||0,branchCount:Object.keys(s.value.messageForksHash||{}).length,raw:s}));if(!sessions.length)throw Error('ZIP 中未发现可导入会话');return {type:'chatbox-json',fileName:file.name,sessions};
 }
 if(/\.json$/i.test(file.name)){progress('识别 聊天备份 JSON 备份…');const obj=JSON.parse(await file.text());const sessions=Engine.resolveSessionObjects(obj).map((s,i)=>({id:s.value.id||String(i),name:s.value.name||s.value.title||'未命名会话',count:s.value.messages.length,branchCount:Object.keys(s.value.messageForksHash||{}).length,raw:s}));if(!sessions.length)throw Error('JSON 中找不到会话');return {type:'chatbox-json',fileName:file.name,sessions};}
 throw Error('仅支持 .zip 或 .json 备份');
}
async function importSelected(prepared,selection,progress=()=>{}){
 if(!prepared)throw Error('没有待导入的文件');const ids=new Set(selection);const chosen=prepared.sessions.filter(s=>ids.has(s.id));if(!chosen.length)throw Error('请至少选择一个会话');
 if(prepared.type==='rikkahub'){
  const selected=new Map(chosen.map(x=>[x.id,x]));const per=new Map(chosen.map(x=>[x.id,[]]));progress('检索 聊天备份 会话节点…');let rows=0;
  await prepared.reader.table('message_node',row=>{if(!per.has(row.conversation_id))return;let msgs=[];try{msgs=JSON.parse(row.messages||'[]')}catch{};per.get(row.conversation_id).push({id:row.id,node_index:Number(row.node_index)||0,select_index:Number(row.select_index)||0,messages:msgs});rows++;if(rows%500===0)progress(`读取已选会话消息节点 ${rows}`);});
  let added=0,skipped=0,messages=0;for(let i=0;i<chosen.length;i++){
   const entry=chosen[i];const id='rikkahub:'+entry.id;const nodes=per.get(entry.id).sort((a,b)=>a.node_index-b.node_index);const existing=await Store.get('sessions',id);if(existing&&existing.importedOriginalCount>=nodes.length){skipped++;progress(`跳过已有记录 ${i+1}/${chosen.length}`);continue;}
   const converted=nodes.map((n,idx)=>fromNode(n,id,idx)).filter(Boolean);const start=existing?.importedOriginalCount||0;const fresh=converted.slice(start);if(fresh.length){await Store.putMany('messages',fresh,60);await Store.putMany('chunks',fresh.map(Engine.chunkFor).filter(Boolean),60);messages+=fresh.length;}
   const source=entry.raw;const session={id,name:entry.name,createdAt:entry.createdAt,updatedAt:entry.updatedAt,source:'rikkahub',importSourceId:entry.id,importedOriginalCount:converted.length,messageCount:Math.max(existing?.messageCount||0,converted.length),systemPrompt:source.custom_system_prompt||'',rawSettings:{config:source.config,assistant_id:source.assistant_id,folder_id:source.folder_id},importedAt:new Date().toISOString(),pinned:existing?.pinPreferenceModified?existing.pinned:Engine.sourcePin(source),pinnedAt:existing?.pinPreferenceModified?existing.pinnedAt:(source.pinned_at||source.pinnedAt||((Engine.sourcePin(source))?entry.updatedAt:null)),lastMessageAt:converted.map(m=>Engine.sourceTime(m.timestamp)).filter(Boolean).sort().at(-1)||entry.updatedAt};await Store.put('sessions',{...existing,...session});added++;progress(`已导入 ${i+1}/${chosen.length} 个 聊天备份 会话`);
  }
  // Only small, relative, non-executable media are included. Keep original ZIP separately as ultimate backup.
  let assets=0;for(const file of Object.values(prepared.archive.files)){if(!file.dir&&/^upload\/[\w.\/-]+\.(png|jpe?g|webp|gif)$/i.test(file.name)&&file._data?.uncompressedSize<=15*1024*1024){await Store.put('assets',{id:'rikka:'+file.name,filename:file.name,bytes:await file.async('uint8array')});assets++;}}
  return {source:'聊天备份',added,skipped,messages,assets};
 }
 let items;if(prepared.type==='chatbox'||prepared.type==='chatbox-v3'){
  items=[];for(let i=0;i<chosen.length;i++){const x=chosen[i];const text=await prepared.archive.file(x.path).async('string');const obj=prepared.type==='chatbox-v3'?parseChatboxV3File(text):JSON.parse(text);if(!obj)continue;items.push({value:obj,path:x.path});progress(`读取 聊天备份 ${i+1}/${chosen.length}`);}
 }else items=chosen.map(x=>x.raw);
 const result=await Engine.importSessions(items,(n,total,message)=>progress(message));let assets=0;
 if(prepared.archive){for(const file of Object.values(prepared.archive.files)){if(!file.dir&&/^(resources|attachments)\//.test(file.name)&&file._data?.uncompressedSize<=15*1024*1024){await Store.put('assets',{id:file.name,filename:file.name,bytes:await file.async('uint8array')});assets++;}}}
 return {...result,source:'聊天备份',assets};
}
return {prepare,importSelected,fromNode};
})();
