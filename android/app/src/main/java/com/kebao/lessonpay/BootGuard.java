package com.kebao.lessonpay;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;

/**
 * 启动守护：判断要不要进入「安全模式」。
 *
 * 为什么需要这个：广告 SDK 这类第三方库会在启动链上注册回调、起后台线程，
 * 出问题时表现为「打开就闪退」，而且崩得比我们的崩溃弹窗还早。用户只能卸载，
 * 我们连堆栈都拿不到。
 *
 * 这里的规则很直接：每次启动记一次「尝试」，真的进到界面才算「成功」。
 * 连续两次没能进到界面，就认定是启动链上有东西坏了，下一次启动跳过第三方初始化
 * （广告、后台任务全部不碰），先保证能用。
 *
 * 换了新版本会重新给一次机会——很可能新包里已经修掉了。
 */
final class BootGuard {

    private static final String PREF = "kebao_boot";

    /** 本次进程是否处于安全模式（attachBaseContext 里算出来，全进程共用） */
    private static boolean safe = false;

    private BootGuard() { }

    /**
     * 在 Application.attachBaseContext 里调用。
     *
     * @return true 表示本次要进安全模式（跳过第三方初始化）
     */
    static boolean begin(Context ctx) {
        try {
            SharedPreferences sp = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE);
            int attempt = sp.getInt("attempt", 0) + 1;
            int ok = sp.getInt("ok", 0);
            int offRc = sp.getInt("adsOffRc", 0);
            int rc = versionCode(ctx);

            // 换了新版本就再试一次：新包可能已经修掉了问题
            if (offRc != 0 && offRc != rc) offRc = 0;

            // attempt 涨了但 ok 没跟上，说明上一次没走到界面。
            // 容忍一次偶发（比如系统杀进程），连续两次才认定有问题。
            if (offRc == 0 && attempt - ok >= 2) offRc = rc;

            sp.edit().putInt("attempt", attempt).putInt("adsOffRc", offRc).apply();
            safe = offRc != 0;
        } catch (Throwable t) {
            // 读不到偏好就当作正常启动，不能因为守护逻辑自己崩掉
            safe = false;
        }
        return safe;
    }

    /** 界面真的起来了才算这次启动成功。放在 MainActivity.onCreate 最前面。 */
    static void markLaunched(Context ctx) {
        try {
            SharedPreferences sp = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE);
            sp.edit().putInt("ok", sp.getInt("attempt", 1)).apply();
        } catch (Throwable ignored) { }
    }

    /** 广告是否已被自动关掉（安全模式下永久算关） */
    static boolean adsOff(Context ctx) {
        if (safe) return true;
        try {
            SharedPreferences sp = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE);
            int offRc = sp.getInt("adsOffRc", 0);
            return offRc != 0 && offRc == versionCode(ctx);
        } catch (Throwable t) {
            return false;
        }
    }

    /** 用户主动要求重新打开广告时用（比如排查完确认没问题） */
    static void clearAdsOff(Context ctx) {
        try {
            ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
                    .edit().putInt("adsOffRc", 0).apply();
            safe = false;
        } catch (Throwable ignored) { }
    }

    private static int versionCode(Context ctx) {
        try {
            PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            //noinspection deprecation
            return pi.versionCode;
        } catch (Throwable t) {
            return 0;
        }
    }
}
