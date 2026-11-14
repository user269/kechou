package com.kebao.lessonpay;

import android.app.Application;

/**
 * 应用入口。
 *
 * 在这里（而不是 Activity 里）先装上崩溃记录：如果闪退发生在启动阶段更早的位置
 * （Application 自身、ContentProvider 初始化、主题加载），Activity 的 onCreate 根本来不及执行，
 * 只有提前装上才能把这类崩溃也留下来。
 */
public class App extends Application {

    /**
     * 在 attachBaseContext 里就装好：ContentProvider（比如 androidx.startup 那套）
     * 的初始化发生在 onCreate 之前，崩在那里的话 onCreate 根本来不及执行，
     * 日志就丢了。为了能拿到启动期的崩溃，只能更早。
     */
    @Override
    protected void attachBaseContext(android.content.Context base) {
        super.attachBaseContext(base);
        try {
            CrashLog.install(this);
        } catch (Throwable ignored) {
            // 崩溃记录本身不能成为崩溃原因
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
    }
}
