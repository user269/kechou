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

    @Override
    public void onCreate() {
        super.onCreate();
        CrashLog.install(this);
    }
}
