package com.kebao.lessonpay;

import android.app.Activity;
import android.content.Context;

/**
 * 无广告构建用的空实现。
 *
 * 打包时如果传了 `WITH_ADS=0`，构建脚本会用这个文件替换同名的 Ads.java，
 * 并且完全不引入 AdMob 的 54 个依赖（APK 从 5.6MB 回到 400KB 左右）。
 *
 * 方法签名必须和正式版一致——MainActivity 三处调用点不改。
 */
final class Ads {

    /** 无广告构建：前端据此隐藏「广告位预览」入口 */
    static final boolean SUPPORTED = false;

    private Ads() { }

    static void init(Context ctx) { }

    static void preload(Context ctx) { }

    static boolean showIfReady(Activity act) {
        return false;
    }

    static void onResumeWarm(Context ctx) { }

    static void onLeaveForeground() { }

    static String status() {
        return "{\"ready\":false,\"init\":false,\"failed\":false,\"shown\":false}";
    }
}
