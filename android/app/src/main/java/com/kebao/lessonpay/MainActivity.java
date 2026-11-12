package com.kebao.lessonpay;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * 课酬 · 单 Activity WebView 壳。
 *
 * 网页资源全部放在 assets/www 下，通过拦截 https://kebao.local/ 请求虚拟加载，
 * 这样页面处于稳定的 https 源上，localStorage 与各类 Web API 行为与浏览器一致。
 */
public class MainActivity extends Activity {

    public static final String HOST = "kebao.local";
    /** 从「有新版本」通知点进来时带的标记，进页面后自动打开更新面板。 */
    public static final String EXTRA_OPEN_UPDATE = "kebao.openUpdate";
    private static final int REQ_FILE = 0x1001;
    private static final int REQ_NOTIFY = 0x1002;
    /** 页面底色，与 styles.css 里的 --bg 保持一致。 */
    private static final int APP_BG = 0xFFF4F6FB;

    private WebView web;
    private WebBridge bridge;
    private ValueCallback<Uri[]> fileCallback;
    private long lastBackAt = 0L;
    private OnBackInvokedCallback backCallback;
    private FrameLayout rootView;
    private boolean pendingOpenUpdate = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        CrashLog.install(this);
        CrashLog.resetSteps(this);
        CrashLog.step(this, "onCreate(" + Build.VERSION.SDK_INT + ")");

        setupWindow();
        registerBackCallback();
        CrashLog.step(this, "窗口与返回键就绪");

        // 后台更新检查的闹钟：只有快到期时才重排，不会每次冷启动都重置
        try {
            UpdateCheckReceiver.ensureScheduled(this);
        } catch (Throwable ignored) { }

        pendingOpenUpdate = getIntent() != null
                && getIntent().getBooleanExtra(EXTRA_OPEN_UPDATE, false);

        // 上次换资源中途被杀掉的话，先把备份还原，避免加载到半截目录
        Updater.recover(this);

        FrameLayout root = new FrameLayout(this);
        rootView = root;
        root.setBackgroundColor(APP_BG);

        try {
            web = new WebView(this);
            web.setLayoutParams(new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            web.setBackgroundColor(APP_BG);
            configureWebView(web);
            root.addView(web);
        } catch (Throwable e) {
            // 系统 WebView 组件异常时，把原因直接画在屏幕上，别静默退出
            web = null;
            CrashLog.step(this, "WebView 创建失败：" + e);
            root.addView(errorView("网页组件没能启动", e));
        }
        setContentView(root);
        CrashLog.step(this, web == null ? "WebView 不可用" : "WebView 已创建");

        applyInsets(root);

        if (web != null) {
            loadIndex();
            CrashLog.step(this, "页面已交给 WebView");
        }

        Notifier.ensureChannel(this);
        MaybeAskNotifyPermission();

        CrashLog.showIfAny(this);
    }

    /** 兜底页面：把异常堆栈画出来，用户截图就能反馈。 */
    private View errorView(String title, Throwable e) {
        java.io.StringWriter sw = new java.io.StringWriter();
        sw.write(title + "\n\n");
        e.printStackTrace(new java.io.PrintWriter(sw));
        android.widget.TextView tv = new android.widget.TextView(this);
        tv.setText(sw.toString());
        tv.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 12);
        tv.setTextIsSelectable(true);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        tv.setPadding(pad, pad, pad, pad);
        return tv;
    }

    /** 热更新目录，存在时优先于 assets 内置版本。 */
    private File webDir() {
        return new File(getFilesDir(), "www");
    }

    /**
     * 主文档直接注入，子资源（css/js/图片）走拦截。
     * 这样不依赖 WebView 对主框架请求的拦截行为，避免个别机型白屏；
     * baseUrl 保持 https 源，localStorage 与浏览器行为一致。
     * 优先读 app 私有目录里的热更新版本，没有则回落安装包内的 assets。
     */
    private void loadIndex() {
        try {
            String html = readWeb("index.html");
            web.loadDataWithBaseURL("https://" + HOST + "/", html, "text/html", "utf-8", null);
        } catch (IOException e) {
            web.loadUrl("https://" + HOST + "/index.html");
        }
    }

    /** 换完资源后重新从磁盘读一遍，确保新文件立刻生效。 */
    void reloadFromDisk() {
        WebView v = web;
        if (v == null) return;
        v.stopLoading();
        v.clearCache(true);
        loadIndex();
    }

    /** 渲染进程没了就换一个新的顶上，界面重新加载一次，数据都在 localStorage 里不丢。 */
    private void rebuildWeb() {
        try {
            WebView old = web;
            web = null;
            if (rootView != null && old != null) rootView.removeView(old);
            if (old != null) old.destroy();

            WebView fresh = new WebView(this);
            fresh.setLayoutParams(new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            fresh.setBackgroundColor(APP_BG);
            configureWebView(fresh);
            web = fresh;
            if (rootView != null) rootView.addView(fresh, 0);   // 压到底层，别盖住底部那条白
            CrashLog.step(this, "WebView 已重建");
            loadIndex();
        } catch (Throwable e) {
            CrashLog.step(this, "WebView 重建失败：" + e);
            if (rootView != null) rootView.addView(errorView("页面重启失败", e));
        }
    }

    private String readWeb(String name) throws IOException {
        File f = new File(webDir(), name);
        if (f.isFile()) {
            try {
                return readStream(new FileInputStream(f));
            } catch (IOException ignored) {
                // 热更新文件损坏时静默回落内置版本，不让用户看到白屏
            }
        }
        return readAsset(name);
    }

    private String readAsset(String name) throws IOException {
        return readStream(getAssets().open(name));
    }

    private String readStream(InputStream is) throws IOException {
        try (InputStream in = is) {
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return new String(bos.toByteArray(), java.nio.charset.StandardCharsets.UTF_8);
        }
    }

    private void setupWindow() {
        // 启动阶段每一步都单独兜底：新系统把哪个接口改坏了，都不该让应用直接闪退
        try {
            getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        } catch (Throwable ignored) { }

        if (Build.VERSION.SDK_INT >= 35) {
            // Android 15 起系统强制边到边，状态栏/导航栏的着色接口已停用：
            // 干脆不碰它们，只把图标设成深色，让位交给 applyInsets()。
            setLightSystemBars();
            return;
        }
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                getWindow().setStatusBarColor(APP_BG);
                getWindow().setNavigationBarColor(Color.WHITE);
            } catch (Throwable ignored) { }
            setLightSystemBars();
            return;
        }
        try {
            getWindow().setStatusBarColor(APP_BG);
            getWindow().setNavigationBarColor(Color.WHITE);
        } catch (Throwable ignored) { }
        try {
            int flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= 26) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            getWindow().getDecorView().setSystemUiVisibility(flags);
        } catch (Throwable ignored) { }
    }

    /** 浅色底配深色的系统栏图标。 */
    private void setLightSystemBars() {
        if (Build.VERSION.SDK_INT < 30) return;
        try {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c == null) return;
            int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                    | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            c.setSystemBarsAppearance(light, light);
        } catch (Throwable ignored) { }
    }

    /**
     * Android 15 起窗口铺满整屏，系统不再替我们让出系统栏，这里自己补：
     * 上边留出状态栏高度（露出 #F4F6FB，与页面顶栏同色），下边留出导航栏或键盘的高度，
     * 导航栏那块单独压一条白底，和页面底部标签栏接得上。
     * 更低的版本窗口本来就没铺满，保持原来的着色状态栏即可。
     */
    private void applyInsets(final FrameLayout root) {
        if (Build.VERSION.SDK_INT < 35) return;
        try {
            final View navBand = new View(this);
            navBand.setBackgroundColor(Color.WHITE);
            root.addView(navBand, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, 0, Gravity.BOTTOM));

            root.setOnApplyWindowInsetsListener((v, insets) -> {
                try {
                    WebView w = web;
                    if (w == null) return insets;
                    Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                    Insets ime = insets.getInsets(WindowInsets.Type.ime());
                    int bottom = Math.max(bars.bottom, ime.bottom);

                    FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) w.getLayoutParams();
                    if (lp.topMargin != bars.top || lp.bottomMargin != bottom) {
                        lp.topMargin = bars.top;
                        lp.bottomMargin = bottom;
                        w.setLayoutParams(lp);
                    }

                    FrameLayout.LayoutParams bp =
                            (FrameLayout.LayoutParams) navBand.getLayoutParams();
                    if (bp.height != bars.bottom) {
                        bp.height = bars.bottom;
                        navBand.setLayoutParams(bp);
                    }
                } catch (Throwable ignored) {
                    // 让位失败最多是画面贴边，不该把应用带崩
                }
                return insets;
            });
            root.requestApplyInsets();
        } catch (Throwable ignored) { }
    }

    private void configureWebView(WebView w) {
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);   // 备份恢复要读取用户选择的文件，必须保留
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);              // 忽略系统字体缩放，避免布局被撑破
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " KebaoApp/1.0");

        w.setOverScrollMode(View.OVER_SCROLL_NEVER);
        w.setVerticalScrollBarEnabled(false);
        w.setHorizontalScrollBarEnabled(false);

        bridge = new WebBridge(this);
        w.addJavascriptInterface(bridge, "KebaoNative");
        w.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (u == null || !HOST.equals(u.getHost())) return null;
                String path = u.getPath();
                if (path == null || path.isEmpty() || "/".equals(path)) path = "/index.html";
                return serveAsset(path);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (u != null && HOST.equals(u.getHost())) return false;
                // 外部链接交给系统浏览器，保持应用内始终是本站页面
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                // 页面就绪后再打开更新面板，否则 JS 还没跑起来
                if (!pendingOpenUpdate) return;
                pendingOpenUpdate = false;
                view.evaluateJavascript(
                        "window.__kebaoOpenUpdate&&window.__kebaoOpenUpdate()", null);
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // 渲染进程被系统回收（低内存、或新系统的内存限制）时，默认行为是整个应用崩掉。
                // 这里返回 true 表示自己处理：重建一个干净的 WebView 继续用。
                CrashLog.step(MainActivity.this, "WebView 渲染进程被回收");
                runOnUiThread(MainActivity.this::rebuildWeb);
                return true;
            }
        });

        w.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb,
                                             FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                try {
                    Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    // 不限定 MIME：部分手机的 json 文件类型识别为 octet-stream，
                    // 过滤太严会导致备份文件根本选不到。格式校验交给页面完成。
                    i.setType("*/*");
                    startActivityForResult(i, REQ_FILE);
                    return true;
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
            }
        });
    }

    /** 把网页资源当作虚拟站点的响应返回，私有目录优先、assets 兜底。 */
    private WebResourceResponse serveAsset(String path) {
        String clean = path.startsWith("/") ? path.substring(1) : path;
        int q = clean.indexOf('?');
        if (q >= 0) clean = clean.substring(0, q);
        if (clean.contains("..")) return plain(400, "bad request");

        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");

        File hot = new File(webDir(), clean);
        if (hot.isFile()) {
            try {
                return new WebResourceResponse(mimeOf(clean), "utf-8", 200, "OK",
                        headers, new FileInputStream(hot));
            } catch (IOException ignored) {
                // 读失败就走内置版本
            }
        }
        try {
            InputStream is = getAssets().open(clean);
            return new WebResourceResponse(mimeOf(clean), "utf-8", 200, "OK", headers, is);
        } catch (IOException e) {
            return plain(404, "not found");
        }
    }

    private WebResourceResponse plain(int code, String body) {
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-store");
        return new WebResourceResponse("text/plain", "utf-8", code, code == 200 ? "OK" : "Error",
                h, new ByteArrayInputStream(body.getBytes()));
    }

    private static String mimeOf(String name) {
        String n = name.toLowerCase();
        if (n.endsWith(".html") || n.endsWith(".htm")) return "text/html";
        if (n.endsWith(".css")) return "text/css";
        if (n.endsWith(".js")) return "application/javascript";
        if (n.endsWith(".json") || n.endsWith(".webmanifest")) return "application/json";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".webp")) return "image/webp";
        if (n.endsWith(".ico")) return "image/x-icon";
        if (n.endsWith(".woff")) return "font/woff";
        if (n.endsWith(".woff2")) return "font/woff2";
        if (n.endsWith(".ttf")) return "font/ttf";
        return "application/octet-stream";
    }

    private void MaybeAskNotifyPermission() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                == PackageManager.PERMISSION_GRANTED) return;
        requestPermissions(new String[] { "android.permission.POST_NOTIFICATIONS" }, REQ_NOTIFY);
    }

    /** 供原生桥回调页面脚本 */
    void evalJs(String js) {
        WebView v = web;
        if (v != null) v.evaluateJavascript(js, null);
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == WebBridge.REQ_SAVE_AS) {
            if (bridge != null) bridge.onSaveAsResult(res, data);
            return;
        }
        if (req == REQ_FILE) {
            if (fileCallback == null) return;
            Uri[] out = null;
            if (res == RESULT_OK && data != null) {
                Uri u = data.getData();
                if (u != null) out = new Uri[] { u };
            }
            fileCallback.onReceiveValue(out);
            fileCallback = null;
            return;
        }
        super.onActivityResult(req, res, data);
    }

    /**
     * targetSdk 36 起预测性返回默认开启，系统只认 OnBackInvokedCallback，
     * 老的 onBackPressed 不一定还会被调用，所以两个都挂上，按版本走。
     */
    private void registerBackCallback() {
        if (Build.VERSION.SDK_INT < 33) return;
        try {
            backCallback = this::handleBack;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        } catch (Throwable e) {
            // 注册失败就退回 onBackPressed()，不要因此闪退
            backCallback = null;
        }
    }

    /** 先问网页：面板开着就关面板；没得关才走「再按一次退出」。 */
    private void handleBack() {
        if (web == null) {
            finish();
            return;
        }
        web.evaluateJavascript(
                "!!(window.__kebaoBack && window.__kebaoBack())",
                value -> {
                    if ("true".equals(value)) return;
                    long now = System.currentTimeMillis();
                    if (now - lastBackAt < 2200) {
                        finish();
                    } else {
                        lastBackAt = now;
                        Toast.makeText(this, "再按一次返回键退出", Toast.LENGTH_SHORT).show();
                    }
                });
    }

    @Override
    public void onBackPressed() {
        handleBack();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        boolean openUpdate = intent != null
                && intent.getBooleanExtra(EXTRA_OPEN_UPDATE, false);
        if (openUpdate) {
            // 应用已经在运行：不重载页面，直接把更新面板调出来
            if (web != null) {
                web.evaluateJavascript(
                        "window.__kebaoOpenUpdate&&window.__kebaoOpenUpdate()", null);
            } else {
                pendingOpenUpdate = true;
            }
            return;
        }
        if (web != null) web.reload();
    }

    @Override
    protected void onDestroy() {
        if (backCallback != null && Build.VERSION.SDK_INT >= 33) {
            try {
                getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
            } catch (Throwable ignored) { }
            backCallback = null;
        }
        if (web != null) {
            web.setWebChromeClient(null);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
