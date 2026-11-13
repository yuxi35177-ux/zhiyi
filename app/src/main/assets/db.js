/* Offline IndexedDB storage. Summaries are immutable records, never a rolling overwrite. */
const Store=(()=>{
const NAME='recallchat-local', VERSION=6;let database;
function request(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||new Error('数据库请求失败'));});}
async function open(){if(database)return database;database=await new Promise((resolve,reject)=>{const req=indexedDB.open(NAME,VERSION);req.onupgradeneeded=()=>{const d=req.result;function ensure(name,key='id'){return d.objectStoreNames.contains(name)?req.transaction.objectStore(name):d.createObjectStore(name,{keyPath:key});}
ensure('sessions');const messages=ensure('messages');if(!messages.indexNames.contains('sessionOrder'))messages.createIndex('sessionOrder',['sessionId','ordinal']);if(!messages.indexNames.contains('sessionId'))messages.createIndex('sessionId','sessionId');
const summaries=ensure('summaries');if(!summaries.indexNames.contains('sessionId'))summaries.createIndex('sessionId','sessionId');
const chunks=ensure('chunks');if(!chunks.indexNames.contains('sessionId'))chunks.createIndex('sessionId','sessionId');
const cards=ensure('statusCards');if(!cards.indexNames.contains('sessionId'))cards.createIndex('sessionId','sessionId');if(!cards.indexNames.contains('messageId'))cards.createIndex('messageId','messageId');const note=ensure('notebookEntries');if(!note.indexNames.contains('sessionId'))note.createIndex('sessionId','sessionId');const vol=ensure('notebookVolumes');if(!vol.indexNames.contains('sessionId'))vol.createIndex('sessionId','sessionId');ensure('vectors');ensure('settings','key');ensure('assets');
};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});return database;}
async function get(table,key){const d=await open();return request(d.transaction(table,'readonly').objectStore(table).get(key));}
async function all(table){const d=await open();return request(d.transaction(table,'readonly').objectStore(table).getAll());}
async function inSession(table,id){const d=await open();return request(d.transaction(table,'readonly').objectStore(table).index('sessionId').getAll(IDBKeyRange.only(id)));}
async function orderedMessages(id){const d=await open();return request(d.transaction('messages','readonly').objectStore('messages').index('sessionOrder').getAll(IDBKeyRange.bound([id,0],[id,Number.MAX_SAFE_INTEGER])));}
// Read the actual newest conversation message timestamp, not the last imported
// row or the date of an import/edit. Cursor iteration avoids loading full chats.
async function latestMessageTimestamp(id){
 const d=await open();const index=d.transaction('messages','readonly').objectStore('messages').index('sessionId');
 return new Promise((resolve,reject)=>{let latest=0;const request=index.openCursor(IDBKeyRange.only(id));
  request.onsuccess=()=>{const c=request.result;if(!c){resolve(latest);return;}
   const v=c.value?.timestamp;const raw=typeof v==='number'?v:/^\d{10,13}$/.test(String(v||''))?Number(v):Date.parse(v);
   if(Number.isFinite(raw)&&raw>0)latest=Math.max(latest,raw<1e11?raw*1000:raw);
   c.continue();};request.onerror=()=>reject(request.error||Error('读取会话最新时间失败'));
 });
}
async function lastMessage(id){const d=await open();const index=d.transaction('messages','readonly').objectStore('messages').index('sessionOrder');return new Promise((resolve,reject)=>{const cursor=index.openCursor(IDBKeyRange.bound([id,0],[id,Number.MAX_SAFE_INTEGER]),'prev');cursor.onsuccess=()=>resolve(cursor.result?.value||null);cursor.onerror=()=>reject(cursor.error||new Error('读取末条消息失败'));});}
async function put(table,item){const d=await open();const result=await request(d.transaction(table,'readwrite').objectStore(table).put(item));if(!(table==='settings'&&String(item.key).startsWith('draft:')))window.dispatchEvent(new Event('recall-data-updated'));return result;}
async function del(table,id){const d=await open();const result=await request(d.transaction(table,'readwrite').objectStore(table).delete(id));window.dispatchEvent(new Event('recall-data-updated'));return result;}
async function putMany(table,values,batch=120){const d=await open();for(let n=0;n<values.length;n+=batch){const arr=values.slice(n,n+batch);await new Promise((resolve,reject)=>{const tx=d.transaction(table,'readwrite');const store=tx.objectStore(table);arr.forEach(x=>store.put(x));tx.oncomplete=()=>{window.dispatchEvent(new Event('recall-data-updated'));resolve();};tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('存储已中止'));});}}
async function putSummaryAtomic(summary,chunk){const d=await open();await new Promise((resolve,reject)=>{const tx=d.transaction(['summaries','chunks'],'readwrite');tx.objectStore('summaries').put(summary);tx.objectStore('chunks').put(chunk);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('历史总结写入失败'));});window.dispatchEvent(new Event('recall-data-updated'));}
async function count(table){const d=await open();return request(d.transaction(table,'readonly').objectStore(table).count());}
async function deleteSession(id){const d=await open();const chunks=await inSession('chunks',id);const ids=new Set(chunks.map(x=>x.id));for(const v of await all('vectors'))if(ids.has(v.chunkId))await del('vectors',v.id);for(const table of ['messages','summaries','chunks','statusCards','notebookEntries','notebookVolumes']){const rows=await inSession(table,id);await new Promise((resolve,reject)=>{const tx=d.transaction(table,'readwrite');const store=tx.objectStore(table);rows.forEach(x=>store.delete(x.id));tx.oncomplete=()=>{window.dispatchEvent(new Event('recall-data-updated'));resolve();};tx.onerror=()=>reject(tx.error);});}await del('sessions',id);}
async function getSetting(key,fallback){const v=await get('settings',key);return v?v.value:fallback;}
async function setSetting(key,value){return put('settings',{key,value});}
return {open,get,all,inSession,orderedMessages,lastMessage,latestMessageTimestamp,put,del,putMany,putSummaryAtomic,count,deleteSession,getSetting,setSetting};})();
