/* Local-only avatar batching; no pictures are sent to an API or the network. */
const AvatarBatch=(()=>{
 const normalizeLabel=value=>String(value||'').normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\s\p{P}\p{S}]/gu,'');
 const fileRoleKey=filename=>{
  let name=String(filename||'').replace(/^.*[\\/]/,'').replace(/\.[^.]+$/,'').normalize('NFKC');
  name=name.replace(/^(?:头像|角色|人物)[\s_\-—·]*/u,'').replace(/[\s_\-—·]*(?:头像|角色|人物)$/u,'');
  return normalizeLabel(name);
 };
 const sessionKeys=session=>{
  const name=normalizeLabel(session.characterName);
  const title=normalizeLabel(session.name);
  const generic=new Set(['ai','assistant','默认助手','新聊天','未命名','聊天','newchat']);
  return [...new Set([name,title].filter(x=>x&&!generic.has(x)))];
 };
 const planSameAvatar=(sessions,overwrite=false)=>({assignments:(sessions||[]).filter(s=>s?.id&&(overwrite||!s.characterAvatarData)).map(s=>({sessionId:s.id,fileIndex:0})),total:(sessions||[]).length});
 const planNamedAvatars=(sessions,filenames,overwrite=false)=>{
  const byName=new Map();
  (filenames||[]).forEach((filename,i)=>{const key=fileRoleKey(filename);if(key){if(!byName.has(key))byName.set(key,[]);byName.get(key).push(i);}});
  const assignments=[];let ambiguous=0,unmatched=0,existing=0;
  for(const session of sessions||[]){
   if(!session?.id)continue;
   const options=[...new Set(sessionKeys(session).flatMap(k=>byName.get(k)||[]))];
   if(options.length>1){ambiguous++;continue;}
   if(!options.length){unmatched++;continue;}
   if(!overwrite&&session.characterAvatarData){existing++;continue;}
   assignments.push({sessionId:session.id,fileIndex:options[0]});
  }
  return {assignments,total:(sessions||[]).length,ambiguous,unmatched,existing};
 };
 return {normalizeLabel,fileRoleKey,sessionKeys,planSameAvatar,planNamedAvatars};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=AvatarBatch;
