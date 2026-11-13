package com.kebao.lessonpay;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Vibrator;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** 暴露给网页的原生能力。方法名与 app.js 中的 NATIVE 分支一一对应。 */
public class WebBridge {

    /** 「保存到」请求码，Activity 用它把结果分发回来 */
    public static final int REQ_SAVE_AS = 0x2003;

    private final Activity act;
    private Updater updater;

    private String pendingName = "课酬备份.json";
    private String pendingContent = "";
    private String pendingMime = "application/json";

    WebBridge(Activity a) {
        this.act = a;
    }

    @JavascriptInterface
    public String platform() {
        return "android";
    }

    @JavascriptInterface
    public String version() {
        try {
            return act.getPackageManager()
                    .getPackageInfo(act.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "1.0.0";
        }
    }

    /** 立即弹一条系统通知。 */
    @JavascriptInterface
    public void notifyNow(String title, String body) {
        final int id = (int) (System.currentTimeMillis() % 100000);
        act.runOnUiThread(() -> Notifier.show(act, title, body, id));
    }

    /**
     * 同步未来的提醒计划。json 形如：
     * [{"at":1794200000000,"id":"l1@08:45","title":"5 分钟后上课","body":"高三1班 · 正课"}]
     */
    @JavascriptInterface
    public void syncReminders(String json) {
        try {
            // 简单校验，避免脏数据写入
            new JSONArray(json == null ? "[]" : json);
        } catch (Exception e) {
            return;
        }
        act.runOnUiThread(() -> AlarmScheduler.sync(act, json));
    }

    @JavascriptInterface
    public String syncRemindersEcho(String json) {
        try {
            JSONArray a = new JSONArray(json == null ? "[]" : json);
            int n = 0;
            long now = System.currentTimeMillis();
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o != null && o.optLong("at", 0) > now) n++;
            }
            return String.valueOf(n);
        } catch (Exception e) {
            return "0";
        }
    }

    @JavascriptInterface
    public boolean hasNotifyPermission() {
        if (Build.VERSION.SDK_INT < 33) return true;
        return act.checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    @JavascriptInterface
    public void requestNotifyPermission() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (hasNotifyPermission()) return;
        act.runOnUiThread(() -> act.requestPermissions(
                new String[] { "android.permission.POST_NOTIFICATIONS" }, 0x1002));
    }

    @JavascriptInterface
    public boolean canScheduleExact() {
        if (Build.VERSION.SDK_INT < 31) return true;
        android.app.AlarmManager am =
                (android.app.AlarmManager) act.getSystemService(Context.ALARM_SERVICE);
        return am != null && am.canScheduleExactAlarms();
    }

    /** 打开系统的精确闹钟授权页，用户授权后提醒才能准点。 */
    @JavascriptInterface
    public void openExactAlarmSettings() {
        if (Build.VERSION.SDK_INT < 31) return;
        try {
            Intent i = new Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
            i.setData(Uri.parse("package:" + act.getPackageName()));
            act.startActivity(i);
        } catch (Exception e) {
            try {
                act.startActivity(new Intent(android.provider.Settings.ACTION_SETTINGS));
            } catch (Exception ignored) { }
        }
    }

    /**
     * 弹出系统「保存到」界面，让用户自己选目录和文件名（SAF）。
     * 结果通过 window.__onSaveAsResult(ok, msg) 回传页面。
     */
    @JavascriptInterface
    public void saveFileAs(String fileName, String content, String mime) {
        pendingName = (fileName == null || fileName.trim().isEmpty()) ? "课酬备份.json" : fileName.trim();
        pendingContent = content == null ? "" : content;
        pendingMime = (mime == null || mime.trim().isEmpty()) ? "application/octet-stream" : mime.trim();

        act.runOnUiThread(() -> {
            try {
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType(pendingMime);
                i.putExtra(Intent.EXTRA_TITLE, pendingName);
                act.startActivityForResult(i, REQ_SAVE_AS);
            } catch (Throwable e) {
                // 个别机型没有文档选择器，退回默认下载目录
                String err = saveFile(pendingName, pendingContent, pendingMime);
                notifySaveResult(err == null, err == null ? pendingName : err);
            }
        });
    }

    /** 用户选完保存位置后由 Activity 回调进来。 */
    void onSaveAsResult(int resultCode, Intent data) {
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            pendingContent = "";
            notifySaveResult(false, "canceled");
            return;
        }
        String err = null;
        try (OutputStream os = act.getContentResolver().openOutputStream(data.getData())) {
            if (os == null) {
                err = "无法写入所选位置";
            } else {
                os.write(pendingContent.getBytes(StandardCharsets.UTF_8));
                os.flush();
            }
        } catch (Throwable e) {
            err = e.getClass().getSimpleName() + ": " + e.getMessage();
        }
        pendingContent = "";
        notifySaveResult(err == null, err == null ? pendingName : err);
    }

    private void notifySaveResult(boolean success, String msg) {
        String safe = String.valueOf(msg == null ? "" : msg)
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", " ")
                .replace("\r", " ");
        String js = "window.__onSaveAsResult&&window.__onSaveAsResult("
                + (success ? "true" : "false") + ",\"" + safe + "\")";
        if (act instanceof MainActivity) {
            ((MainActivity) act).evalJs(js);
        } else {
            act.runOnUiThread(() -> Toast.makeText(act,
                    success ? "已保存" : "保存失败：" + msg, Toast.LENGTH_SHORT).show());
        }
    }

    /**
     * 保存文本文件到「下载」目录（没有文件选择器时的兜底）。
     * 返回 null 表示成功，否则返回错误说明。
     */
    @JavascriptInterface
    public String saveFile(String fileName, String content, String mime) {
        String name = (fileName == null || fileName.trim().isEmpty()) ? "课酬备份.json" : fileName;
        String type = (mime == null || mime.trim().isEmpty()) ? "application/json" : mime;
        byte[] data = (content == null ? "" : content).getBytes(StandardCharsets.UTF_8);
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Downloads.DISPLAY_NAME, name);
                cv.put(MediaStore.Downloads.MIME_TYPE, type);
                cv.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri uri = act.getContentResolver()
                        .insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (uri == null) return "无法创建文件";
                try (OutputStream os = act.getContentResolver().openOutputStream(uri)) {
                    if (os == null) return "无法写入文件";
                    os.write(data);
                    os.flush();
                }
                cv.clear();
                cv.put(MediaStore.Downloads.IS_PENDING, 0);
                act.getContentResolver().update(uri, cv, null, null);
            } else {
                File dir = Environment.getExternalStoragePublicDirectory(
                        Environment.DIRECTORY_DOWNLOADS);
                if (!dir.exists() && !dir.mkdirs()) {
                    dir = act.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS);
                }
                File f = new File(dir, name);
                try (FileOutputStream fos = new FileOutputStream(f)) {
                    fos.write(data);
                    fos.flush();
                }
            }
            return null;
        } catch (Throwable e) {
            // 低版本系统上 MediaStore.Downloads 不可用等异常统一兜底
            return e.getClass().getSimpleName() + ": " + e.getMessage();
        }
    }

    @JavascriptInterface
    public void vibrate(int ms) {
        try {
            Vibrator v = (Vibrator) act.getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) v.vibrate(Math.max(10, Math.min(ms, 400)));
        } catch (Exception ignored) { }
    }

    @JavascriptInterface
    public void toast(String msg) {
        act.runOnUiThread(() -> Toast.makeText(act, msg, Toast.LENGTH_SHORT).show());
    }

    @JavascriptInterface
    public String appLabel() {
        return act.getString(R.string.app_name);
    }

    // ---------------- 更新 ----------------

    private Updater updater() {
        if (updater == null) updater = new Updater(act);
        return updater;
    }

    /** 安装包版本、原生资源号，页面据此决定是热更还是换整包。 */
    @JavascriptInterface
    public String appInfo() {
        String name = "0";
        int code = 0;
        try {
            android.content.pm.PackageInfo pi = act.getPackageManager()
                    .getPackageInfo(act.getPackageName(), 0);
            name = pi.versionName == null ? "0" : pi.versionName.replace("\"", "");
            if (Build.VERSION.SDK_INT >= 28) {
                code = (int) pi.getLongVersionCode();
            } else {
                code = pi.versionCode;
            }
        } catch (Throwable ignored) { }
        return "{\"versionName\":\"" + name + "\",\"versionCode\":" + code
                + ",\"webBuild\":" + updater().webBuild()
                + ",\"canInstall\":" + updater().canInstall() + "}";
    }

    /**
     * 拉更新清单，结果走 window.__onUpdateCheck(json, err, source)。
     * urlsJson 是候选地址的 JSON 数组，国内 raw 常被污染，要能挨个试。
     */
    @JavascriptInterface
    public void updateCheck(String urlsJson) {
        updater().check(urlsJson);
    }

    /** 下载前端资源包并启用，第二个参数是清单里的 build 号。 */
    @JavascriptInterface
    public void updateDownloadWeb(String urlsJson, int build) {
        updater().downloadWeb(urlsJson, build);
    }

    /** 下载整包，完成后调 updateInstall()。urlsJson 同样是候选数组。 */
    @JavascriptInterface
    public void updateDownloadApk(String urlsJson, String versionName) {
        updater().downloadApk(urlsJson, versionName);
    }

    /** 唤起系统安装器。返回 need-permission 时页面应引导去授权。 */
    @JavascriptInterface
    public String updateInstall() {
        Updater u = updater();
        if (!u.installPending()) {
            return u.canInstall() ? "no-file" : "need-permission";
        }
        return "ok";
    }

    @JavascriptInterface
    public boolean canInstallPackages() {
        return updater().canInstall();
    }

    @JavascriptInterface
    public void openInstallSettings() {
        updater().openInstallSettings();
    }

    @JavascriptInterface
    public int webBuild() {
        return updater().webBuild();
    }

    /** 丢掉热更新，回到安装包内置版本并重载。 */
    @JavascriptInterface
    public void resetWebUpdate() {
        updater().resetWeb();
    }

    /* ---------- 局域网同步：同一个 WiFi 下直接换数据，不经过服务器 ---------- */

    @JavascriptInterface
    public String lanStart() {
        return LanSync.start(act);
    }

    @JavascriptInterface
    public void lanStop() {
        LanSync.stop();
    }

    @JavascriptInterface
    public void lanPublish(String json) {
        LanSync.publish(json);
    }

    /** 发起扫描后立刻返回，结果用 lanScanResult() 轮询 */
    @JavascriptInterface
    public String lanScanStart(int timeoutMs) {
        return LanSync.scanStart(timeoutMs);
    }

    @JavascriptInterface
    public String lanScanResult() {
        return LanSync.scanResult();
    }

    /** 发起同步后立刻返回，结果用 lanSyncPoll() 轮询 */
    @JavascriptInterface
    public String lanSyncStart(String ip, int port, String code, String packet) {
        return LanSync.syncStart(ip, port, code, packet);
    }

    @JavascriptInterface
    public String lanSyncPoll() {
        return LanSync.syncPoll();
    }

    @JavascriptInterface
    public String lanInbox() {
        return LanSync.inbox();
    }

    /** 机型名，同步时用来区分是哪台手机 */
    @JavascriptInterface
    public String deviceName() {
        return LanSync.deviceName();
    }

    @JavascriptInterface
    public void reloadPage() {
        act.runOnUiThread(() -> {
            if (act instanceof MainActivity) ((MainActivity) act).reloadFromDisk();
        });
    }
}
