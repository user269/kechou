package com.kebao.lessonpay;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 更新器：负责拉清单、下载前端资源包、下载整包，以及唤起系统安装器。
 *
 * 设计上原生只做「网络 + 文件」，是否要更新、装哪个版本由页面里的 JS 判断，
 * 这样版本比较逻辑能跟着前端一起热更新，也能在浏览器里用同一套代码测试。
 *
 * 前端资源包解压到 filesDir/www，MainActivity 加载时优先读这个目录，
 * 所以热更新不需要重装 APK；出问题时删掉该目录即可回落到 assets 内置版本。
 */
public class Updater {

    /**
     * 更新清单地址。换成自己的仓库 raw 地址即可，例如：
     * https://raw.githubusercontent.com/你的用户名/仓库名/main/update.json
     */
    public static final String MANIFEST_URL =
            "https://raw.githubusercontent.com/user269/kechou/main/update.json";

    /**
     * 国内 raw.githubusercontent.com 常被 DNS 污染，解析到 0.0.0.0 直接连不上。
     * 所以清单地址永远是一串候选。实际顺序由页面传入（跟界面一起热更），这里只是兜底。
     *
     * 注意不要用 jsDelivr 的 @main：分支地址带 12 小时 CDN 缓存，
     * 新版本发布后它还会继续吐旧清单，导致客户端永远认为「已是最新」。
     */
    static final String[] FALLBACK_MANIFESTS = {
            MANIFEST_URL,
            "https://ghfast.top/https://raw.githubusercontent.com/user269/kechou/main/update.json",
            "https://gh-proxy.com/https://raw.githubusercontent.com/user269/kechou/main/update.json",
            "https://ghproxy.net/https://raw.githubusercontent.com/user269/kechou/main/update.json",
            "https://cdn.jsdelivr.net/gh/user269/kechou@latest/update.json",
    };

    private static final String PREFS = "kebao_update";
    private static final String KEY_WEB_BUILD = "webBuild";
    private static final int CONNECT_TIMEOUT = 10000;
    /** 清单很小，单个地址别等太久，否则五六个备用地址排下来要好几分钟。 */
    private static final int MANIFEST_CONNECT_TIMEOUT = 5000;
    private static final int READ_TIMEOUT = 30000;
    private static final int MAX_MANIFEST = 256 * 1024;

    private final Activity act;
    private volatile boolean busy = false;

    Updater(Activity a) {
        this.act = a;
    }

    // ---------------- 对外能力 ----------------

    /**
     * 拉取 update.json，结果原样交给页面，由 JS 比较版本。
     *
     * 所有候选地址**同时**发请求，谁报的版本号大就用谁，而不是「第一个连上就用」。
     * 原因是 CDN 缓存：某个源可能长期返回旧清单（jsDelivr 的分支地址就会缓存 12 小时），
     * 而它又常常比别人先返回，旧的「顺序尝试」逻辑一撞上它就会永远认为已是最新。
     * 并发取最大天然淘汰掉旧缓存源，代价只是多发几个几百字节的请求。
     */
    void check(final String urlsJson) {
        if (busy) return;
        busy = true;
        new Thread(() -> {
            final String[] urls = parseUrls(urlsJson);
            final java.util.List<String> list = new java.util.ArrayList<>();
            for (String u : urls) if (!isBlank(u)) list.add(u.trim());
            final int n = list.size();

            final String[] bodies = new String[n];
            final String[] errs = new String[n];
            final java.util.concurrent.CountDownLatch latch =
                    new java.util.concurrent.CountDownLatch(n);
            for (int i = 0; i < n; i++) {
                final int idx = i;
                final String u = list.get(i);
                new Thread(() -> {
                    try {
                        String t = httpGetText(u, MANIFEST_CONNECT_TIMEOUT);
                        if (t == null || t.trim().isEmpty()) throw new IOException("清单为空");
                        // 先确认是合法 JSON 对象，避免把 HTML 错误页塞给页面
                        new JSONObject(t);
                        bodies[idx] = t;
                    } catch (Throwable e) {
                        errs[idx] = describe(e);
                    } finally {
                        latch.countDown();
                    }
                }).start();
            }

            // 最慢也就等这么久；超时还没回来的地址直接忽略，用已拿到的结果
            boolean all = false;
            try {
                all = latch.await(10, java.util.concurrent.TimeUnit.SECONDS);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }

            String body = null;
            String source = null;
            String lastErr = null;
            int bestCode = -1;
            int bestBuild = -1;
            int okCount = 0;
            for (int i = 0; i < n; i++) {
                if (bodies[i] == null) {
                    if (errs[i] != null) lastErr = errs[i];
                    continue;
                }
                okCount++;
                int vc = 0;
                int wb = 0;
                try {
                    JSONObject o = new JSONObject(bodies[i]);
                    vc = o.optInt("versionCode", 0);
                    JSONObject w = o.optJSONObject("web");
                    wb = w == null ? 0 : w.optInt("build", 0);
                } catch (Throwable ignored) {
                    // 解析不了就按 0 算，等别的源
                }
                if (vc > bestCode || (vc == bestCode && wb > bestBuild)) {
                    bestCode = vc;
                    bestBuild = wb;
                    body = bodies[i];
                    source = list.get(i);
                }
            }

            final String b = body;
            final String src = source;
            String msg;
            if (okCount == 0) {
                msg = lastErr == null ? "无法连接更新服务器" : lastErr;
                if (n > 1) msg = msg + "（" + n + " 个地址都没通）";
                if (!all) msg = msg + "，部分地址超时";
            } else {
                msg = "清单读取失败";
            }
            final String e2 = msg;
            busy = false;
            post(() -> {
                if (b != null) {
                    emit("window.__onUpdateCheck&&window.__onUpdateCheck("
                            + JSONObject.quote(b) + ",null," + JSONObject.quote(src) + ")");
                } else {
                    emit("window.__onUpdateCheck&&window.__onUpdateCheck(null,"
                            + JSONObject.quote(e2) + ",'')");
                }
            });
        }).start();
    }

    /** 下载并启用新的前端资源包。build 为正整数，写入本地用于下次比较。 */
    void downloadWeb(final String urlsJson, final int build) {
        if (busy) return;
        final String[] urls = parseUrls(urlsJson);
        if (urls.length == 0) return;
        busy = true;
        new Thread(() -> {
            File zip = new File(act.getCacheDir(), "www-update.zip");
            String err = "没有可用的下载地址";
            try {
                // 逐个地址试，第一个下完整的就用
                int tried = 0;
                for (String u : urls) {
                    if (isBlank(u)) continue;
                    tried++;
                    try {
                        //noinspection ResultOfMethodCallIgnored
                        zip.delete();
                        httpDownload(u, zip, "web");
                        err = null;
                        break;
                    } catch (Throwable e) {
                        err = describe(e);
                    }
                }
                if (err != null) {
                    if (tried > 1) err = err + "（已试 " + tried + " 个地址）";
                } else {
                    File target = new File(act.getFilesDir(), "www.new");
                    unzipTo(zip, target);
                    swapWeb(target);
                    setWebBuild(build);
                }
            } catch (Throwable e) {
                err = describe(e);
            } finally {
                //noinspection ResultOfMethodCallIgnored
                zip.delete();
                busy = false;
            }
            final String e2 = err;
            post(() -> {
                if (e2 == null) {
                    emit("window.__onUpdateResult&&window.__onUpdateResult('web',true,'')");
                } else {
                    emit("window.__onUpdateResult&&window.__onUpdateResult('web',false,"
                            + JSONObject.quote(e2) + ")");
                }
            });
        }).start();
    }

    /** 下载整包到 filesDir/update，完成后由页面调用 installPending() 唤起安装器。 */
    void downloadApk(final String urlsJson, final String versionName) {
        if (busy) return;
        final String[] urls = parseUrls(urlsJson);
        if (urls.length == 0) return;
        busy = true;
        new Thread(() -> {
            String safeVer = isBlank(versionName) ? "latest" : versionName.replaceAll("[^0-9A-Za-z._-]", "");
            File dest = new File(ApkProvider.dirOf(act), "kebao-" + safeVer + ".apk");
            String err = "没有可用的下载地址";
            int tried = 0;
            for (String u : urls) {
                if (isBlank(u)) continue;
                tried++;
                try {
                    if (dest.exists()) //noinspection ResultOfMethodCallIgnored
                        dest.delete();
                    long size = httpDownload(u, dest, "apk");
                    if (size > 0 && dest.length() != size) throw new IOException("下载不完整");
                    // 至少校验是个 zip 结构的 APK，避免把错误页存成 apk
                    if (!looksLikeApk(dest)) throw new IOException("安装包校验失败");
                    err = null;
                    break;
                } catch (Throwable e) {
                    err = describe(e);
                    //noinspection ResultOfMethodCallIgnored
                    dest.delete();
                }
            }
            if (err != null && tried > 1) err = err + "（已试 " + tried + " 个地址）";
            busy = false;
            final String e2 = err;
            final String path = dest.getAbsolutePath();
            post(() -> {
                if (e2 == null) {
                    emit("window.__onUpdateResult&&window.__onUpdateResult('apk',true,"
                            + JSONObject.quote(path) + ")");
                } else {
                    emit("window.__onUpdateResult&&window.__onUpdateResult('apk',false,"
                            + JSONObject.quote(e2) + ")");
                }
            });
        }).start();
    }

    /** 唤起系统安装器。返回 false 表示缺少「安装未知应用」权限，页面据此引导。 */
    boolean installPending() {
        File dir = ApkProvider.dirOf(act);
        File[] all = dir.listFiles();
        if (all == null) return false;
        File apk = null;
        for (File f : all) {
            if (f.isFile() && f.getName().endsWith(".apk")
                    && (apk == null || f.lastModified() > apk.lastModified())) {
                apk = f;
            }
        }
        if (apk == null) return false;
        if (!canInstall()) return false;

        final File target = apk;
        post(() -> {
            try {
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(ApkProvider.uriFor(act, target),
                        "application/vnd.android.package-archive");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                act.startActivity(i);
            } catch (Throwable e) {
                emit("window.__onUpdateResult&&window.__onUpdateResult('install',false,"
                        + JSONObject.quote(describe(e)) + ")");
            }
        });
        return true;
    }

    boolean canInstall() {
        if (Build.VERSION.SDK_INT < 26) return true;
        try {
            return act.getPackageManager().canRequestPackageInstalls();
        } catch (Throwable e) {
            return false;
        }
    }

    void openInstallSettings() {
        post(() -> {
            try {
                if (Build.VERSION.SDK_INT >= 26) {
                    Intent i = new Intent(
                            android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:" + act.getPackageName()));
                    act.startActivity(i);
                } else {
                    act.startActivity(new Intent(android.provider.Settings.ACTION_SECURITY_SETTINGS));
                }
            } catch (Throwable e) {
                try {
                    act.startActivity(new Intent(android.provider.Settings.ACTION_SETTINGS));
                } catch (Throwable ignored) { }
            }
        });
    }

    /** 丢弃热更新，回到安装包里内置的版本。 */
    void resetWeb() {
        deleteTree(new File(act.getFilesDir(), "www"));
        deleteTree(new File(act.getFilesDir(), "www.bak"));
        deleteTree(new File(act.getFilesDir(), "www.new"));
        setWebBuild(0);
        post(() -> {
            if (act instanceof MainActivity) ((MainActivity) act).reloadFromDisk();
        });
    }

    int webBuild() {
        return prefs().getInt(KEY_WEB_BUILD, 0);
    }

    /** 上一次换版本时若中途退出，启动这里把备份还原，避免白屏。 */
    static void recover(Context ctx) {
        File dir = new File(ctx.getFilesDir(), "www");
        File bak = new File(ctx.getFilesDir(), "www.bak");
        if (!new File(dir, "index.html").isFile()) {
            deleteTree(dir);
            if (new File(bak, "index.html").isFile()) {
                //noinspection ResultOfMethodCallIgnored
                bak.renameTo(dir);
            }
        }
        deleteTree(new File(ctx.getFilesDir(), "www.new"));
        deleteTree(bak);
    }

    // ---------------- 内部实现 ----------------

    private SharedPreferences prefs() {
        return act.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private void setWebBuild(int v) {
        prefs().edit().putInt(KEY_WEB_BUILD, v).apply();
    }

    /** 先把旧的挪成 .bak，再把新的顶上去；任何一步失败都还原，保证首页始终能打开。 */
    private void swapWeb(File fresh) throws IOException {
        File dir = new File(act.getFilesDir(), "www");
        File bak = new File(act.getFilesDir(), "www.bak");
        deleteTree(bak);
        if (dir.exists() && !dir.renameTo(bak)) throw new IOException("无法备份旧资源");
        if (!fresh.renameTo(dir)) {
            if (bak.exists()) //noinspection ResultOfMethodCallIgnored
                bak.renameTo(dir);
            throw new IOException("无法启用新资源");
        }
        deleteTree(bak);
    }

    private void unzipTo(File zip, File out) throws IOException {
        deleteTree(out);
        if (!out.mkdirs()) throw new IOException("无法创建资源目录");
        String root = out.getCanonicalPath();
        try (ZipInputStream zis = new ZipInputStream(
                new BufferedInputStream(new FileInputStream(zip)))) {
            ZipEntry en;
            while ((en = zis.getNextEntry()) != null) {
                String name = en.getName().replace('\\', '/');
                if (name.startsWith("/") || name.contains("..")) continue;
                File f = new File(out, name);
                if (!f.getCanonicalPath().startsWith(root)) continue;
                if (en.isDirectory()) {
                    //noinspection ResultOfMethodCallIgnored
                    f.mkdirs();
                    continue;
                }
                File parent = f.getParentFile();
                if (parent != null && !parent.exists()) //noinspection ResultOfMethodCallIgnored
                    parent.mkdirs();
                try (FileOutputStream fos = new FileOutputStream(f)) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = zis.read(buf)) > 0) fos.write(buf, 0, n);
                }
            }
        }
        if (!new File(out, "index.html").isFile()) {
            deleteTree(out);
            throw new IOException("资源包缺少 index.html");
        }
    }

    /** 返回服务器声明的总长度，未知时为 -1。 */
    private long httpDownload(String urlStr, File dest, String kind) throws IOException {
        HttpURLConnection c = open(urlStr);
        long total = c.getContentLength();
        try (InputStream in = c.getInputStream();
             FileOutputStream out = new FileOutputStream(dest)) {
            byte[] buf = new byte[16384];
            int n;
            long got = 0;
            int lastPct = -1;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                got += n;
                if (total > 0) {
                    int pct = (int) (got * 100 / total);
                    if (pct != lastPct && pct % 4 == 0) {
                        lastPct = pct;
                        progress(kind, pct);
                    }
                }
            }
            out.flush();
        } finally {
            c.disconnect();
        }
        if (total > 0 && dest.length() != total) throw new IOException("下载被中断");
        return total;
    }

    /** 把页面传来的地址列表解析成数组；解析不了就退回内置候选。 */
    private static String[] parseUrls(String json) {
        if (!isBlank(json)) {
            String t = json.trim();
            if (t.startsWith("http")) return new String[]{t};
            try {
                org.json.JSONArray arr = new org.json.JSONArray(t);
                String[] out = new String[arr.length()];
                for (int i = 0; i < arr.length(); i++) out[i] = arr.optString(i, "").trim();
                if (out.length > 0) return out;
            } catch (Throwable ignored) {
                // 落到兜底列表
            }
        }
        return FALLBACK_MANIFESTS;
    }

    private String httpGetText(String urlStr, int connectMs) throws IOException {
        HttpURLConnection c = open(urlStr, connectMs);
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            int cap = 0;
            while ((n = in.read(buf)) > 0) {
                cap += n;
                if (cap > MAX_MANIFEST) throw new IOException("清单过大");
                bos.write(buf, 0, n);
            }
            return new String(bos.toByteArray(), "UTF-8");
        } finally {
            c.disconnect();
        }
    }

    private HttpURLConnection open(String urlStr, int connectMs) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(urlStr).openConnection();
        c.setConnectTimeout(connectMs);
        c.setReadTimeout(READ_TIMEOUT);
        c.setInstanceFollowRedirects(true);
        c.setRequestProperty("User-Agent", "KebaoUpdater/1.0 (Android)");
        c.setRequestProperty("Accept", "*/*");
        c.setRequestProperty("Cache-Control", "no-cache");
        int code = c.getResponseCode();
        if (code != 200) throw new IOException("HTTP " + code);
        return c;
    }

    private HttpURLConnection open(String urlStr) throws IOException {
        return open(urlStr, CONNECT_TIMEOUT);
    }

    private static boolean looksLikeApk(File f) {
        if (!f.isFile() || f.length() < 1024) return false;
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] head = new byte[2];
            return in.read(head) == 2 && head[0] == 'P' && head[1] == 'K';
        } catch (Throwable e) {
            return false;
        }
    }

    private void progress(String kind, int pct) {
        final String k = kind;
        final int p = pct;
        post(() -> emit("window.__onUpdateProgress&&window.__onUpdateProgress('"
                + k + "'," + p + ")"));
    }

    private void post(Runnable r) {
        try {
            act.runOnUiThread(r);
        } catch (Throwable ignored) { }
    }

    private void emit(String js) {
        if (act instanceof MainActivity) ((MainActivity) act).evalJs(js);
    }

    private static boolean isBlank(String s) {
        return s == null || s.trim().isEmpty();
    }

    static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    static String describe(Throwable e) {
        if (e == null) return "未知错误";
        String m = e.getMessage();
        String n = e.getClass().getSimpleName();
        if (e instanceof java.net.UnknownHostException) return "域名解析失败：找不到更新服务器";
        if (e instanceof java.net.ConnectException) return "连不上更新服务器（该地址可能已被拦截）";
        if (e instanceof java.net.SocketTimeoutException) return "连接超时";
        if (e instanceof java.net.SocketException) return "网络连接被中断";
        if (e instanceof javax.net.ssl.SSLException) return "证书校验失败";
        return isBlank(m) ? n : n + ": " + m;
    }
}
