package com.kebao.lessonpay;

import android.app.Application;
import android.content.Context;

/**
 * 应用入口。只做两件事：尽早装崩溃记录、显式初始化第三方库。
 *
 * 为什么不靠第三方库自己声明的 ContentProvider 初始化：
 * 那种 Provider 在 attachBaseContext 之后、onCreate 之前由系统实例化，
 * 里面抛异常就是「打开就闪退」，而崩溃弹窗是在 Activity 里弹的，根本没机会出现。
 * 这些 Provider 已经从合并清单里剔除（见 tools/merge-manifests.py），
 * 初始化改在这里做，全部包 try/catch，失败只降级不闪退。
 */
public class App extends Application {

    private static boolean safeMode = false;

    @Override
    protected void attachBaseContext(Context base) {
        super.attachBaseContext(base);
        // 崩溃记录要尽可能早：ContentProvider 崩的时候 Activity 还没起来
        try {
            CrashLog.install(this);
        } catch (Throwable ignored) {
            // 崩溃记录本身不能成为崩溃原因
        }
        try {
            safeMode = BootGuard.begin(this);
        } catch (Throwable ignored) {
            safeMode = false;
        }
        CrashLog.step(this, "attachBaseContext" + (safeMode ? "（安全模式）" : ""));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        CrashLog.step(this, "Application.onCreate");
        if (safeMode) {
            CrashLog.step(this, "安全模式：跳过第三方初始化");
            return;
        }
        // 第三方库的初始化都在 Ads.init（MainActivity 里调用），
        // 这样无广告的构建里不会有任何 GMS 依赖
    }

    /** 安全模式：上一次启动没走到界面，这次不碰任何第三方库 */
    static boolean inSafeMode() {
        return safeMode;
    }

}
