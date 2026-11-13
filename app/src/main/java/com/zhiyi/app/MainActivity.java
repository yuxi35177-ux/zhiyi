package com.zhiyi.app;

import android.app.Activity;
import android.os.Bundle;
import android.content.res.Configuration;
import android.graphics.Color;
import android.view.View;
import android.content.Intent;
import android.net.Uri;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.ValueCallback;
import android.webkit.WebResourceRequest;
import android.graphics.Bitmap;
import android.util.Base64;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import org.json.JSONObject;

/** Offline UI + native HTTP bridge (avoids WebView file:// origin CORS limitations). */
public class MainActivity extends Activity {
    private WebView web;
    private ValueCallback<Uri[]> pendingFilePicker;
    private static final int PICK_FILE = 100, SAVE_FILE = 101;
    private final Object fileLock = new Object();
    private File currentExportFile;
    private FileOutputStream currentExportStream;
    private String exportMime = "application/zip";
    private String exportName = "zhiyi-backup.zip";

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        GitHubBackup.schedule(this);
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(true);
        web.getSettings().setDatabaseEnabled(true);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                return !"file".equalsIgnoreCase(req.getUrl().getScheme());
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFilePicker != null) pendingFilePicker.onReceiveValue(null);
                pendingFilePicker = callback;
                try {
                    Intent intent = params.createIntent();
                    startActivityForResult(intent, PICK_FILE);
                    return true;
                } catch (Exception e) { pendingFilePicker = null; return false; }
            }
        });
        web.addJavascriptInterface(new NativeBridge(), "NativeBridge");
        setContentView(web);
        web.loadUrl("file:///android_asset/index.html");
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_FILE && pendingFilePicker != null) {
            Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            pendingFilePicker.onReceiveValue(result);
            pendingFilePicker = null;
        } else if (requestCode == SAVE_FILE && resultCode == RESULT_OK && data != null && data.getData() != null) {
            final Uri target = data.getData();
            final File file;
            synchronized(fileLock) { file = currentExportFile; }
            if (file != null) new Thread(() -> {
                try (InputStream input = new FileInputStream(file); OutputStream output = getContentResolver().openOutputStream(target)) {
                    byte[] buf = new byte[65536]; int n;
                    while ((n = input.read(buf)) != -1) output.write(buf,0,n);
                } catch (Exception e) { android.util.Log.e("Zhiyi", "Export failed", e); }
            }).start();
        }
    }

    private boolean darkSystemMode(){
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    @Override public void onConfigurationChanged(Configuration config){
        super.onConfigurationChanged(config);
        if(web!=null){
            final boolean dark=darkSystemMode();
            web.evaluateJavascript("window.__nativeThemeChanged && window.__nativeThemeChanged("+dark+")", null);
        }
    }

    @Override public void onBackPressed() {
        if (web.canGoBack() && !"file:///android_asset/index.html".equals(web.getUrl())) web.goBack();
        else web.evaluateJavascript("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))", null);
    }

    public class NativeBridge {
        @JavascriptInterface public boolean isSystemDark(){return darkSystemMode();}
        @JavascriptInterface public void setBarsDark(boolean dark){
            runOnUiThread(()->{
                getWindow().setStatusBarColor(Color.parseColor(dark?"#101511":"#f6f8f5"));
                getWindow().setNavigationBarColor(Color.parseColor(dark?"#101511":"#f6f8f5"));
                int flags=web.getSystemUiVisibility();
                if(dark)flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                else flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                if(android.os.Build.VERSION.SDK_INT>=26){
                    if(dark)flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                    else flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                }
                web.setSystemUiVisibility(flags);
            });
        }
        @JavascriptInterface public String backupSaveConfig(String json){return GitHubBackup.saveConfig(MainActivity.this,json);}
        @JavascriptInterface public String backupStatus(){return GitHubBackup.status(MainActivity.this);}
        @JavascriptInterface public String backupBeginSnapshot(){return GitHubBackup.beginSnapshot(MainActivity.this);}
        @JavascriptInterface public String backupAppendSnapshot(String base64){return GitHubBackup.appendSnapshot(base64);}
        @JavascriptInterface public String backupFinishSnapshot(boolean uploadNow){return GitHubBackup.finishSnapshot(MainActivity.this,uploadNow);}
        @JavascriptInterface public String backupUploadNow(){return GitHubBackup.uploadNow(MainActivity.this);}
        @JavascriptInterface public void request(int id, String url, String method, String headersJson, String body) {
            new Thread(() -> {
                int status=0; String response=""; String error="";HttpURLConnection connection=null;
                try {
                    URL parsed = new URL(url);
                    String scheme = parsed.getProtocol();
                    if (!("http".equals(scheme)||"https".equals(scheme))) throw new IllegalArgumentException("Only HTTP(S) endpoints are allowed");
                    connection = (HttpURLConnection)parsed.openConnection();
                    connection.setRequestMethod(method);
                    connection.setConnectTimeout(25000);
                    connection.setReadTimeout(180000);
                    JSONObject headers=new JSONObject(headersJson);
                    Iterator<String> keys=headers.keys();
                    while(keys.hasNext()) {String k=keys.next();connection.setRequestProperty(k, headers.getString(k));}
                    if (!"GET".equalsIgnoreCase(method) && !"HEAD".equalsIgnoreCase(method)) {
                        connection.setDoOutput(true);
                        try(OutputStream out=connection.getOutputStream()) {out.write(body.getBytes(StandardCharsets.UTF_8));}
                    }
                    status=connection.getResponseCode();
                    InputStream stream=status>=400?connection.getErrorStream():connection.getInputStream();
                    if(stream!=null){try(InputStream in=stream){ByteArrayOutputStream collected=new ByteArrayOutputStream(); byte[] buffer=new byte[65536]; int nr; while((nr=in.read(buffer))!=-1)collected.write(buffer,0,nr);response=new String(collected.toByteArray(),StandardCharsets.UTF_8);}}
                } catch(Exception e) {error=String.valueOf(e.getMessage());}
                finally {if(connection!=null)connection.disconnect();}
                String js="window.__nativeResponse("+id+","+status+","+JSONObject.quote(response)+","+JSONObject.quote(error)+")";
                runOnUiThread(()->web.evaluateJavascript(js,null));
            }).start();
        }

        @JavascriptInterface public void requestStream(int id,String url,String headersJson,String body){
            new Thread(()->{
                HttpURLConnection c=null;int status=0;String error="";
                try{
                    URL parsed=new URL(url);
                    if(!("http".equals(parsed.getProtocol())||"https".equals(parsed.getProtocol())))throw new IllegalArgumentException("HTTPS/HTTP only");
                    c=(HttpURLConnection)parsed.openConnection();
                    c.setRequestMethod("POST");c.setConnectTimeout(25000);c.setReadTimeout(180000);
                    JSONObject headers=new JSONObject(headersJson);Iterator<String> ks=headers.keys();
                    while(ks.hasNext()){String k=ks.next();c.setRequestProperty(k,headers.getString(k));}
                    c.setRequestProperty("Accept","text/event-stream");c.setDoOutput(true);
                    try(OutputStream out=c.getOutputStream()){out.write(body.getBytes(StandardCharsets.UTF_8));}
                    status=c.getResponseCode();
                    if(status<200||status>=300){InputStream err=c.getErrorStream();
                        if(err!=null){ByteArrayOutputStream b=new ByteArrayOutputStream();byte[] buf=new byte[8192];int n;while((n=err.read(buf))>0&&b.size()<4096)b.write(buf,0,n);error=new String(b.toByteArray(),StandardCharsets.UTF_8);} }
                    else {try(BufferedReader reader=new BufferedReader(new InputStreamReader(c.getInputStream(),StandardCharsets.UTF_8))){
                        String line;StringBuilder batch=new StringBuilder();
                        while((line=reader.readLine())!=null){batch.append(line).append("\n");
                            if(line.isEmpty()||batch.length()>4096){String chunk=batch.toString();batch.setLength(0);runOnUiThread(()->web.evaluateJavascript("window.__nativeStreamChunk("+id+","+JSONObject.quote(chunk)+")",null));}}
                        if(batch.length()>0){String chunk=batch.toString();runOnUiThread(()->web.evaluateJavascript("window.__nativeStreamChunk("+id+","+JSONObject.quote(chunk)+")",null));}
                    }}
                }catch(Exception e){error=String.valueOf(e.getMessage());}finally{if(c!=null)c.disconnect();}
                final int code=status;final String problem=error;
                runOnUiThread(()->web.evaluateJavascript("window.__nativeStreamEnd("+id+","+code+","+JSONObject.quote(problem)+")",null));
            }).start();
        }
        @JavascriptInterface public void beginExport(String filename,String mime) {
            synchronized(fileLock) {
                try {
                    if(currentExportStream!=null)currentExportStream.close();
                    currentExportFile=File.createTempFile("recall-export-", ".zip",getCacheDir());
                    currentExportStream=new FileOutputStream(currentExportFile);
                    exportName=filename;exportMime=mime;
                }catch(Exception e){android.util.Log.e("Zhiyi","beginExport",e);}
            }
        }
        @JavascriptInterface public void appendExport(String b64) {
            synchronized(fileLock) {
                try {if(currentExportStream!=null)currentExportStream.write(Base64.decode(b64,Base64.DEFAULT));}
                catch(Exception e) {android.util.Log.e("Zhiyi","appendExport",e);}
            }
        }
        @JavascriptInterface public void finishExport() {
            synchronized(fileLock) {
                try {if(currentExportStream!=null)currentExportStream.close();currentExportStream=null;}
                catch(Exception e) {android.util.Log.e("Zhiyi","finishExport",e);}
            }
            runOnUiThread(()->{
                Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(exportMime);
                intent.putExtra(Intent.EXTRA_TITLE,exportName);
                startActivityForResult(intent,SAVE_FILE);
            });
        }
    }
}
