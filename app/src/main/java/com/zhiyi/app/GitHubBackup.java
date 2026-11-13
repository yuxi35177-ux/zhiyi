package com.zhiyi.app;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.crypto.Cipher;
import javax.crypto.CipherOutputStream;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

/** GitHub private-repo encrypted ZIP backups. Data never goes to a public repository. */
public final class GitHubBackup {
    private static final String PREF = "zhiyi_private_git_backup_v1";
    private static final String KEY_ALIAS = "zhiyi_github_backup_secrets_v1";
    private static final int JOB_ID = 804621;
    private static final int CHUNK = 4 * 1024 * 1024;
    private static final AtomicBoolean UPLOADING = new AtomicBoolean(false);
    private static final Object WRITE_LOCK = new Object();
    private static CipherOutputStream snapshotStream;
    private static File snapshotTmp;
    private static final SecureRandom RNG = new SecureRandom();
    private GitHubBackup() {}

    private static SharedPreferences prefs(Context c) { return c.getApplicationContext().getSharedPreferences(PREF, Context.MODE_PRIVATE); }
    private static File snapshot(Context c) { return new File(c.getFilesDir(), "zhiyi-private-github-backup.zhim"); }
    private static void put(Context c, String key, String value) { prefs(c).edit().putString(key, value).apply(); }
    private static String get(Context c, String key, String def) { return prefs(c).getString(key, def); }
    private static String stamp(long time) { SimpleDateFormat f = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT); f.setTimeZone(TimeZone.getTimeZone("UTC")); return f.format(new Date(time)); }

    private static SecretKey deviceKey() throws Exception {
        KeyStore ks=KeyStore.getInstance("AndroidKeyStore"); ks.load(null);
        if(!ks.containsAlias(KEY_ALIAS)) {
            KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
            generator.generateKey();
        }
        return (SecretKey)ks.getKey(KEY_ALIAS,null);
    }
    private static String seal(String text) throws Exception {
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE,deviceKey());
        byte[] iv=cipher.getIV(), encrypted=cipher.doFinal(text.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(iv,Base64.NO_WRAP)+":"+Base64.encodeToString(encrypted,Base64.NO_WRAP);
    }
    private static String unseal(String value) throws Exception {
        if(value==null||!value.contains(":"))return "";
        String[] p=value.split(":",2);
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE,deviceKey(),new GCMParameterSpec(128,Base64.decode(p[0],Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(p[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);
    }
    private static String secret(Context c,String field) throws Exception {return unseal(get(c,field,""));}
    private static void saveSecret(Context c,String field,String secret) throws Exception {put(c,field,seal(secret));}

    /** A blank token/password field preserves its previous secure value. */
    public static synchronized String saveConfig(Context c,String json) {
        try {
            JSONObject j=new JSONObject(json);
            String owner=j.optString("owner","").trim(), repo=j.optString("repo","").trim();
            String branch=j.optString("branch","main").trim(), folder=j.optString("folder","zhiyi-backups").trim();
            int hours=j.optInt("hours",24); boolean enabled=j.optBoolean("enabled",false), wifi=j.optBoolean("wifiOnly",true);
            if(!owner.matches("[A-Za-z0-9-]{1,39}")||!repo.matches("[A-Za-z0-9._-]{1,100}"))throw new Exception("仓库用户和仓库名称格式不正确");
            if(!branch.matches("[A-Za-z0-9._/-]{1,120}")||branch.contains(".."))throw new Exception("分支格式不正确");
            if(!folder.matches("[A-Za-z0-9._/-]{1,90}")||folder.contains("..")||folder.startsWith("/")||folder.endsWith("/"))throw new Exception("备份目录格式不正确");
            if(hours!=1&&hours!=6&&hours!=12&&hours!=24&&hours!=72&&hours!=168) throw new Exception("无效的备份周期");
            String tokenInput=j.optString("token","").trim();
            String passInput=j.optString("passphrase","");
            if(!passInput.isEmpty()&&passInput.length()<12)throw new Exception("加密密码至少需要12个字符");
            if(enabled&&((tokenInput.isEmpty()&&secret(c,"token").isEmpty())||(passInput.isEmpty()&&secret(c,"passphrase").isEmpty())))
                throw new Exception("开启自动备份之前必须设置 GitHub Token 和加密密码");
            if(!tokenInput.isEmpty())saveSecret(c,"token",tokenInput);
            if(!passInput.isEmpty())saveSecret(c,"passphrase",passInput);
            SharedPreferences.Editor e=prefs(c).edit();
            e.putString("owner",owner).putString("repo",repo).putString("branch",branch).putString("folder",folder);
            e.putInt("hours",hours).putBoolean("enabled",enabled).putBoolean("wifiOnly",wifi).apply();
            schedule(c);
            return "设置已保存。备份将上传至私有仓库；安卓可能延后执行定时任务。";
        } catch (Exception ex) { return "ERROR: "+ex.getMessage(); }
    }
    public static void schedule(Context c) {
        JobScheduler scheduler=(JobScheduler)c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        scheduler.cancel(JOB_ID);
        SharedPreferences p=prefs(c);
        if(!p.getBoolean("enabled",false))return;
        int hrs=p.getInt("hours",24);
        long period=hrs*3600000L;
        JobInfo.Builder b=new JobInfo.Builder(JOB_ID,new ComponentName(c,GitHubBackupJob.class));
        b.setPeriodic(period).setPersisted(true).setRequiredNetworkType(p.getBoolean("wifiOnly",true)?JobInfo.NETWORK_TYPE_UNMETERED:JobInfo.NETWORK_TYPE_ANY);
        scheduler.schedule(b.build());
    }
    public static String status(Context c) {
        SharedPreferences p=prefs(c);
        JSONObject o=new JSONObject();
        try {
            o.put("native",true).put("owner",p.getString("owner","")).put("repo",p.getString("repo", ""));
            o.put("branch",p.getString("branch","main")).put("folder",p.getString("folder","zhiyi-backups"));
            o.put("hours",p.getInt("hours",24)).put("enabled",p.getBoolean("enabled",false)).put("wifiOnly",p.getBoolean("wifiOnly",true));
            o.put("hasToken",!get(c,"token","").isEmpty()).put("hasPassphrase",!get(c,"passphrase","").isEmpty());
            o.put("lastSnapshot",p.getLong("lastSnapshot",0)).put("lastUpload",p.getLong("lastUpload",0));
            o.put("lastPath",p.getString("lastPath", "")).put("lastError",p.getString("lastError", ""));
            o.put("uploading",UPLOADING.get()).put("snapshotBytes",snapshot(c).exists()?snapshot(c).length():0);
            o.put("detail",p.getString("detail", "尚未备份"));
        } catch (Exception ex) {return "{}";}
        return o.toString();
    }
    public static String beginSnapshot(Context c) {
        synchronized(WRITE_LOCK) {
            try {
                if(UPLOADING.get())throw new Exception("上一份快照正在上传，稍后再保存");
                if(snapshotStream!=null) {snapshotStream.close();snapshotStream=null;}
                String pass=secret(c,"passphrase");
                if(pass.isEmpty())throw new Exception("请先保存备份加密密码");
                byte[] salt=new byte[16],iv=new byte[12];RNG.nextBytes(salt);RNG.nextBytes(iv);
                SecretKeyFactory factory=SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
                PBEKeySpec spec=new PBEKeySpec(pass.toCharArray(),salt,180000,256);
                byte[] key=factory.generateSecret(spec).getEncoded();spec.clearPassword();
                Cipher enc=Cipher.getInstance("AES/GCM/NoPadding");enc.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,iv));
                java.util.Arrays.fill(key,(byte)0);
                snapshotTmp=new File(c.getFilesDir(),"zhiyi-private-github-backup.tmp");
                FileOutputStream stream=new FileOutputStream(snapshotTmp);
                stream.write("ZHIM1".getBytes(StandardCharsets.US_ASCII));stream.write(salt);stream.write(iv);
                snapshotStream=new CipherOutputStream(stream,enc);
                return "OK";
            } catch(Exception ex) {snapshotStream=null;return "ERROR: "+ex.getMessage();}
        }
    }
    public static String appendSnapshot(String base64) {
        synchronized(WRITE_LOCK) {
            try {if(snapshotStream==null)throw new Exception("未开始快照");snapshotStream.write(Base64.decode(base64,Base64.NO_WRAP));return "OK";}
            catch(Exception e){return "ERROR: "+e.getMessage();}
        }
    }
    public static String finishSnapshot(Context c,boolean uploadNow) {
        synchronized(WRITE_LOCK) {
            try {
                if(snapshotStream==null||snapshotTmp==null)throw new Exception("没有正在写入的快照");
                snapshotStream.close();snapshotStream=null;
                File destination=snapshot(c);
                if(!snapshotTmp.renameTo(destination)) {
                    try(InputStream in=new FileInputStream(snapshotTmp);OutputStream out=new FileOutputStream(destination)) {
                        byte[] buf=new byte[65536];int n;while((n=in.read(buf))>0)out.write(buf,0,n);
                    }
                    snapshotTmp.delete();
                }
                prefs(c).edit().putLong("lastSnapshot",System.currentTimeMillis()).putString("detail","新快照已加密保存在手机").apply();
                if(uploadNow) uploadNow(c);
                return "OK";
            }catch(Exception e){return "ERROR: "+e.getMessage();}
        }
    }
    public static String uploadNow(Context c) {
        if(!snapshot(c).exists())return "ERROR: 请先在应用内生成一次备份快照";
        if(!UPLOADING.compareAndSet(false,true))return "已在上传中";
        Context app=c.getApplicationContext();
        new Thread(()->{
            try {performUpload(app);}catch(Exception e){put(app,"lastError",e.getMessage());put(app,"detail","上传失败（下次可重试）");Log.w("ZhiyiBackup","Scheduled backup error: "+e.getClass().getSimpleName());}
            finally {UPLOADING.set(false);}
        },"ZhiyiGitHubUpload").start();
        return "已开始上传加密快照";
    }
    static boolean runScheduled(Context c) {
        if(!UPLOADING.compareAndSet(false,true)) return true;
        try {performUpload(c);return true;}
        catch(Exception e){put(c,"lastError",e.getMessage());put(c,"detail","定时备份失败，等待重试");return false;}
        finally{UPLOADING.set(false);}
    }
    private static String sha256(File f)throws Exception{
        MessageDigest m=MessageDigest.getInstance("SHA-256");
        try(FileInputStream in=new FileInputStream(f)) {byte[] buf=new byte[65536];int n;while((n=in.read(buf))>0)m.update(buf,0,n);}
        StringBuilder s=new StringBuilder();for(byte b:m.digest())s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();
    }
    private static String encode(String path)throws Exception {return java.net.URLEncoder.encode(path,"UTF-8").replace("+","%20");}
    private static JSONObject request(String method,String url,String token,JSONObject payload)throws Exception{
        HttpURLConnection conn=(HttpURLConnection)new URL(url).openConnection();
        try {
            conn.setRequestMethod(method);conn.setConnectTimeout(25000);conn.setReadTimeout(120000);
            conn.setRequestProperty("Authorization","Bearer "+token);
            conn.setRequestProperty("Accept","application/vnd.github+json");conn.setRequestProperty("X-GitHub-Api-Version","2022-11-28");
            if(payload!=null){conn.setDoOutput(true);conn.setRequestProperty("Content-Type","application/json; charset=utf-8");
                try(OutputStream out=conn.getOutputStream()){out.write(payload.toString().getBytes(StandardCharsets.UTF_8));}}
            int status=conn.getResponseCode();
            String text="";InputStream stream=status>=400?conn.getErrorStream():conn.getInputStream();
            if(stream!=null)try(InputStream in=stream) {ByteArrayOutputStream buffer=new ByteArrayOutputStream();byte[] buf=new byte[8192];int n;while((n=in.read(buf))>0)buffer.write(buf,0,n);text=new String(buffer.toByteArray(),StandardCharsets.UTF_8);}
            if(status<200||status>=300)throw new Exception("GitHub HTTP "+status+" "+text.substring(0,Math.min(300,text.length())).replaceAll("(?i)token[^,}]*","***"));
            return new JSONObject(text);
        }finally{conn.disconnect();}
    }
    private static void putFile(String api,String token,String branch,String path,String contents)throws Exception{
        String url=api+"/contents/"+encode(path).replace("%2F","/");
        JSONObject data=new JSONObject();data.put("message","Zhiyi private encrypted backup "+path);data.put("branch",branch);
        data.put("content",Base64.encodeToString(contents.getBytes(StandardCharsets.UTF_8),Base64.NO_WRAP));
        // No overwrite by default: each run uses a new directory; retry can re-use the existing path.
        try {request("PUT",url,token,data);}
        catch(Exception e){if(!e.getMessage().contains("HTTP 422"))throw e;
            JSONObject existing=request("GET",url+"?ref="+encode(branch),token,null);
            String sha=existing.optString("sha","");if(sha.isEmpty())throw e;
            data.put("sha",sha);request("PUT",url,token,data);
        }
    }
    private static void putBytes(String api,String token,String branch,String path,byte[] content,int length)throws Exception {
        String url=api+"/contents/"+encode(path).replace("%2F","/");
        JSONObject data=new JSONObject();data.put("message","Zhiyi encrypted backup chunk");data.put("branch",branch);
        data.put("content",Base64.encodeToString(content,0,length,Base64.NO_WRAP));
        try {request("PUT",url,token,data);}
        catch(Exception e){if(!e.getMessage().contains("HTTP 422"))throw e;
            JSONObject existing=request("GET",url+"?ref="+encode(branch),token,null);String sha=existing.optString("sha","");
            if(sha.isEmpty())throw e;data.put("sha",sha);request("PUT",url,token,data);
        }
    }
    private static int readChunk(InputStream in, byte[] buffer) throws Exception {
        int total=0;while(total<buffer.length){int n=in.read(buffer,total,buffer.length-total);if(n<0)break;if(n==0)break;total+=n;}
        return total==0?-1:total;
    }
    private static void performUpload(Context c)throws Exception{
        SharedPreferences p=prefs(c);
        if(!p.getBoolean("enabled",false)) return;
        File source=snapshot(c);if(!source.exists()||source.length()<50) return;
        String owner=p.getString("owner", ""),repo=p.getString("repo", ""),branch=p.getString("branch","main"),folder=p.getString("folder","zhiyi-backups");
        String token=secret(c,"token");if(token.isEmpty())throw new Exception("尚未配置 GitHub Token");
        String api="https://api.github.com/repos/"+owner+"/"+repo;
        JSONObject metadata=request("GET",api,token,null);
        if(!metadata.optBoolean("private",false))throw new Exception("安全限制：只允许上传到私有 GitHub 仓库");
        String hash=sha256(source), id="backup-"+stamp(p.getLong("lastSnapshot",System.currentTimeMillis()))+"-"+hash.substring(0,12);
        String directory=folder+"/"+id;
        if(hash.equals(p.getString("lastHash",""))) {put(c,"detail","没有新内容，上次加密备份仍然有效");return;}
        put(c,"detail","正在上传加密备份到私有仓库…");put(c,"lastError","");
        long total=source.length();int parts=(int)((total+CHUNK-1)/CHUNK);int i=0;
        try(FileInputStream in=new FileInputStream(source)){
            byte[] buffer=new byte[CHUNK];int n;
            while((n=readChunk(in,buffer))>0){
                i++;
                putBytes(api,token,branch,directory+"/part-"+String.format(Locale.ROOT,"%05d",i)+".bin",buffer,n);
                put(c,"detail","已上传分片 "+i+"/"+parts);
            }
        }
        JSONObject manifest=new JSONObject();
        manifest.put("type","zhiyi-encrypted-github-backup").put("version",1).put("createdUtc",stamp(System.currentTimeMillis()));
        manifest.put("size",total).put("sha256",hash).put("parts",parts).put("partBytes",CHUNK);
        manifest.put("encryption","AES-256-GCM + PBKDF2-HMAC-SHA256, 180000 iterations, header ZHIM1 + 16-byte salt + 12-byte IV");
        manifest.put("note","Encrypted full ZIP snapshot. Never contains GitHub authentication token or AI API keys.");
        putFile(api,token,branch,directory+"/manifest.json",manifest.toString(2));
        p.edit().putLong("lastUpload",System.currentTimeMillis()).putString("lastHash",hash).putString("lastPath",directory+"/manifest.json")
                .putString("lastError","").putString("detail","成功上传 "+parts+" 个加密分片").apply();
    }
}
