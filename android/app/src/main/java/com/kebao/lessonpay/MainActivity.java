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
    private static final int REQ_FILE = 0x1001;
    private static final int REQ_NOTIFY = 0x1002;

    private WebView web;
    private WebBridge bridge;
    private ValueCallback<Uri[]> fileCallback;
    private long lastBackAt = 0L;
    private OnBackInvokedCallback backCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setupWindow();
        registerBackCallback();

        // 上次换资源中途被杀掉的话，先把备份还原，避免加载到半截目录
        Updater.recover(this);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#F4F6FB"));

        web = new WebView(this);
        web.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.setBackgroundColor(Color.parseColor("#F4F6FB"));
        configureWebView(web);
        root.addView(web);
        setContentView(root);

        applyInsets(root);

        loadIndex();

        Notifier.ensureChannel(this);
        MaybeAskNotifyPermission();
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
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

        if (Build.VERSION.SDK_INT >= 30) {
            // Android 11 起统一按「边到边」处理，系统栏透明：
            // targetSdk 35 以上系统本来就会强制边到边（statusBarColor 等接口失效），
            // 与其等它被动生效，不如自己显式铺满再按 insets 让位，视觉在 11~16 上一致。
            getWindow().setDecorFitsSystemWindows(false);
            getWindow().setStatusBarColor(Color.TRANSPARENT);
            getWindow().setNavigationBarColor(Color.TRANSPARENT);
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);

            // 底色是浅色，状态栏与导航栏图标用深色
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                c.setSystemBarsAppearance(light, light);
            }
        } else {
            getWindow().setStatusBarColor(Color.parseColor("#F4F6FB"));
            getWindow().setNavigationBarColor(Color.parseColor("#FFFFFF"));
            int flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= 26) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            getWindow().getDecorView().setSystemUiVisibility(flags);
        }
    }

    /**
     * 边到边之后系统不再替我们让出系统栏，这里自己补：
     * 上边留出状态栏高度（露出 #F4F6FB，与页面顶栏同色），下边留出导航栏/键盘的高度，
     * 导航栏那块单独压一条白底，和页面底部标签栏接得上。
     * Android 10 及以下窗口本来就没铺满，不需要处理。
     */
    private void applyInsets(final FrameLayout root) {
        if (Build.VERSION.SDK_INT < 30) return;

        final View navBand = new View(this);
        navBand.setBackgroundColor(Color.WHITE);
        root.addView(navBand, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, Gravity.BOTTOM));

        root.setOnApplyWindowInsetsListener((v, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
            Insets ime = insets.getInsets(WindowInsets.Type.ime());
            int bottom = Math.max(bars.bottom, ime.bottom);

            FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) web.getLayoutParams();
            if (lp.topMargin != bars.top || lp.bottomMargin != bottom) {
                lp.topMargin = bars.top;
                lp.bottomMargin = bottom;
                web.setLayoutParams(lp);
            }

            FrameLayout.LayoutParams bp = (FrameLayout.LayoutParams) navBand.getLayoutParams();
            if (bp.height != bars.bottom) {
                bp.height = bars.bottom;
                navBand.setLayoutParams(bp);
            }
            return insets;
        });
        root.requestApplyInsets();
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
        backCallback = this::handleBack;
        getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
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
        if (web != null) web.reload();
    }

    @Override
    protected void onDestroy() {
        if (backCallback != null && Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
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
