/* Private GitHub scheduled backup. This module never reads back stored auth secrets. */
const BackupUI = (() => {
  const native=()=>window.NativeBridge && typeof window.NativeBridge.backupStatus==='function';
  let dirty=false, snapshotting=false, timer=null;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function status(){try{return native()?JSON.parse(window.NativeBridge.backupStatus()):{native:false}}catch(e){return {native:false,error:String(e)}}}
  function date(n){return n?new Date(n).toLocaleString('zh-CN'):'暂无'}
  function card(){const s=status();if(!s.native)return `<div class="card"><h3>GitHub 私有仓库定时备份</h3><p>仅安卓版支持自动后台上传。浏览器预览不启用。</p></div>`;
    return `<div class="card"><h3>GitHub 私有仓库 · 加密定时备份</h3>
    <p>只有你开启后才上传到指定<strong>私有</strong>仓库。自动保留多个历史版本，不上传 GitHub Token / 聊天 API 密钥。ZIP 先用专属密码 AES-256-GCM 加密，再分片上传。每个备份保留完整会话、原文、记事本与独立旧总结。</p>
    <label class="switchlabel">启用定时 GitHub 备份<input id="gitEnabled" type="checkbox" class="toggle" ${s.enabled?'checked':''}></label>
    <label class="label">GitHub 用户名</label><input class="field" id="gitOwner" value="${esc(s.owner||'')}" placeholder="例如 your-user">
    <label class="label">私有仓库名</label><input class="field" id="gitRepo" value="${esc(s.repo||'')}" placeholder="例如 zhiyi-private-backup">
    <label class="label">分支</label><input class="field" id="gitBranch" value="${esc(s.branch||'main')}">
    <label class="label">备份保存目录</label><input class="field" id="gitFolder" value="${esc(s.folder||'zhiyi-backups')}">
    <label class="label">定时备份间隔</label><select class="field" id="gitHours">${[[1,'每 1 小时'],[6,'每 6 小时'],[12,'每 12 小时'],[24,'每天'],[72,'每 3 天'],[168,'每周']].map(([n,label])=>`<option value="${n}" ${s.hours===n?'selected':''}>${label}</option>`).join('')}</select>
    <label class="switchlabel">只允许 Wi-Fi / 非计费网络上传<input id="gitWifi" type="checkbox" class="toggle" ${s.wifiOnly?'checked':''}></label>
    <label class="label">GitHub Fine-grained Token ${s.hasToken?'（已保存，留空不变）':''}</label><input class="field" id="gitToken" type="password" autocomplete="off" placeholder="仅在手机中填写，仓库 Contents: Read and write">
    <label class="label">备份加密密码 ${s.hasPassphrase?'（已保存，留空不变）':''}</label><input class="field" id="gitPassphrase" type="password" autocomplete="off" placeholder="至少 12 字符；恢复到其他设备需要此密码">
    <div class="btnrow"><button class="action" data-action="github-save">保存备份设置</button><button class="action secondary" data-action="github-now">立即生成并上传</button><button class="minor" data-action="github-refresh">刷新状态</button></div>
    <div class="status"><strong>最近快照：</strong>${date(s.lastSnapshot)} · ${s.snapshotBytes?Math.ceil(s.snapshotBytes/1024)+' KB':'未生成'}<br>
      <strong>最近上传：</strong>${date(s.lastUpload)}<br><strong>进度：</strong>${esc(s.detail||'等待操作')}<br>
      ${s.lastPath?`<strong>GitHub 目录：</strong>${esc(s.lastPath)}<br>`:''}
      ${s.lastError?`<span class="warning">上次错误：${esc(s.lastError)}</span>`:''}
    </div>
    <p class="smalltext muted">定时任务由安卓系统调度，省电/后台限制可能延迟执行。聊天数据变化后，应用在前台自动生成新的加密快照；后台任务上传最近一份完成的快照。首次开启后请点击“立即生成并上传”验证配置。建议创建仅用于备份的私有仓库，别将个人聊天上传到公开仓库。</p>
    <p class="smalltext muted">完整备份可能很大，会分成多个 4MB 分片与 manifest.json；恢复到新设备需要完整分片及你的加密密码。请妥善保管密码，忘记密码就无法恢复加密备份。</p></div>`;
  }
  const val=(id, fallback='')=>document.getElementById(id)?.value??fallback;
  const checked=id=>!!document.getElementById(id)?.checked;
  function save(){
    if(!native())return '当前环境不支持 Android 后台备份';
    const data={enabled:checked('gitEnabled'),owner:val('gitOwner').trim(),repo:val('gitRepo').trim(),branch:val('gitBranch','main').trim(),folder:val('gitFolder','zhiyi-backups').trim(),hours:Number(val('gitHours','24')),wifiOnly:checked('gitWifi'),token:val('gitToken'),passphrase:val('gitPassphrase')};
    const result=window.NativeBridge.backupSaveConfig(JSON.stringify(data));
    for(const id of ['gitToken','gitPassphrase']){const el=document.getElementById(id);if(el)el.value='';}
    return result;
  }
  function toBase64(bytes){let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);}
  async function snapshot(upload=true){
    if(!native())throw Error('仅本地 Android 应用支持');
    if(snapshotting)throw Error('已有快照生成中');
    snapshotting=true;
    try{
      const blob=await Engine.exportArchive();
      const begin=window.NativeBridge.backupBeginSnapshot();
      if(begin!=='OK')throw Error(begin);
      for(let i=0;i<blob.size;i+=98304){
        const arr=new Uint8Array(await blob.slice(i,i+98304).arrayBuffer());
        const outcome=window.NativeBridge.backupAppendSnapshot(toBase64(arr));
        if(outcome!=='OK')throw Error(outcome);
        if(i%1048576<98304)await new Promise(r=>setTimeout(r,0));
      }
      const done=window.NativeBridge.backupFinishSnapshot(upload);
      if(done!=='OK')throw Error(done);
      dirty=false;
      return `加密快照已保存${upload?'，GitHub 上传已启动':''}（${Math.ceil(blob.size/1024)} KB）`;
    }finally{snapshotting=false;}
  }
  function noteChange(){
    const s=status();if(!s.enabled||!s.hasToken||!s.hasPassphrase)return;
    dirty=true;if(timer)clearTimeout(timer);
    timer=setTimeout(()=>snapshot(false).catch(e=>console.warn('GitHub 自动快照失败',e)),90000);
  }
  function init(){
    window.addEventListener('recall-data-updated',noteChange);
    setInterval(()=>{if(dirty&&!snapshotting)snapshot(false).catch(console.warn);},10*60*1000);
  }
  return {status,card,save,snapshot,init};
})();
