package com.kebao.lessonpay;

import android.app.Activity;
import android.content.Context;
import android.util.Log;

import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;
import com.google.android.gms.ads.appopen.AppOpenAd;

/**
 * AdMob 开屏广告（App Open）。
 *
 * 几条必须守住的规矩，都是平台的硬要求：
 *   1. 初始化是异步的，初始化没回来就 load，填充率永远是 0
 *   2. 不能在冷启动的一瞬间弹——要等界面真的画出来（这里挂在首页 onPageFinished 之后）
 *   3. 同一个用户 4 小时内最多一次，所以只在冷启动展示，从后台回来不弹
 *   4. 没装 Google Play 服务的设备会持续加载失败，这时必须静默跳过，不能影响正常使用
 *
 * 关于可用性：AdMob 依赖 GMS。国内销售的手机多数没有 GMS，也访问不到
 * googleads.g.doubleclick.net，结果是永远拿不到广告——这里所有失败路径都只记日志，
 * 用户不会看到任何报错，App 照常用。
 */
final class Ads {

    private static final String TAG = "KebaoAds";

    /** 这个构建是否内置了广告 SDK；无广告构建里是 false，前端据此隐藏相关入口 */
    static final boolean SUPPORTED = true;

    static final String APP_ID = "ca-app-pub-4703913003378934~4670206775";
    static final String UNIT_SPLASH = "ca-app-pub-4703913003378934/8982867205";

    /** 冷启动才展示；从后台切回来不算，避免打扰 */
    private static boolean coldStart = true;

    private static volatile boolean initialized = false;
    private static volatile boolean initFailed = false;

    private static AppOpenAd openAd;
    private static volatile boolean loading = false;
    private static long loadedAt = 0;
    private static boolean shownThisSession = false;

    /** 过期时间：AdMob 建议开屏广告缓存不超过 4 小时 */
    private static final long MAX_AGE_MS = 4 * 60 * 60 * 1000L;

    private Ads() { }

    /** 冷启动时调用一次。失败只记日志，绝不抛给调用方 */
    static void init(Context ctx) {
        if (initialized || initFailed) return;
        ensureWorkManager(ctx);
        try {
            MobileAds.initialize(ctx, status -> {
                initialized = true;
                Log.i(TAG, "MobileAds 初始化完成");
                preload(ctx);
            });
        } catch (Throwable t) {
            // 没有 GMS、被裁剪过的系统、类找不到——都走这里
            initFailed = true;
            Log.w(TAG, "MobileAds 不可用：" + describe(t));
        }
    }

    /**
     * AdMob 内部会用 WorkManager 做些后台任务。它原本靠 androidx.startup 的
     * ContentProvider 自动初始化，而那个 Provider 已经被我们剔除了（见
     * tools/merge-manifests.py），所以在这里补一次。
     *
     * 放在这里而不是 Application 里，是为了让「无广告」的构建根本不出现这个依赖。
     */
    private static void ensureWorkManager(Context ctx) {
        try {
            androidx.work.WorkManager.initialize(
                    ctx, new androidx.work.Configuration.Builder().build());
            Log.i(TAG, "WorkManager 已初始化");
        } catch (Throwable t) {
            // 重复初始化抛 IllegalStateException，忽略即可；真起不来只是少一条后台任务
            Log.w(TAG, "WorkManager 初始化失败：" + describe(t));
        }
    }

    /** 预加载；重复调用会被挡掉 */
    static void preload(Context ctx) {
        if (!initialized || loading || openAd != null || shownThisSession) return;
        loading = true;
        try {
            AppOpenAd.load(ctx, UNIT_SPLASH, new AdRequest.Builder().build(),
                    new AppOpenAd.AppOpenAdLoadCallback() {
                        @Override
                        public void onAdLoaded(AppOpenAd ad) {
                            loading = false;
                            openAd = ad;
                            loadedAt = System.currentTimeMillis();
                            Log.i(TAG, "开屏广告就绪");
                        }

                        @Override
                        public void onAdFailedToLoad(LoadAdError err) {
                            loading = false;
                            // 国内设备通常就是这里：No fill / 无 GMS
                            Log.w(TAG, "开屏广告加载失败：" + (err == null ? "unknown" : err.getMessage()));
                        }
                    });
        } catch (Throwable t) {
            loading = false;
            Log.w(TAG, "开屏广告请求异常：" + describe(t));
        }
    }

    /**
     * 界面画好之后调用。有货就展示，没有就什么都不做。
     * @return 是否真的展示了
     */
    static boolean showIfReady(Activity act) {
        if (act == null || shownThisSession || !coldStart) return false;
        if (openAd == null) return false;
        if (System.currentTimeMillis() - loadedAt > MAX_AGE_MS) {
            openAd = null;          // 放太久了，丢掉重新来
            preload(act);
            return false;
        }

        try {
            final AppOpenAd ad = openAd;
            ad.setFullScreenContentCallback(new com.google.android.gms.ads.FullScreenContentCallback() {
                @Override
                public void onAdDismissedFullScreenContent() {
                    openAd = null;
                    Log.i(TAG, "开屏广告已关闭");
                }

                @Override
                public void onAdFailedToShowFullScreenContent(com.google.android.gms.ads.AdError err) {
                    openAd = null;
                    Log.w(TAG, "开屏广告展示失败：" + (err == null ? "unknown" : err.getMessage()));
                }
            });
            ad.show(act);
            shownThisSession = true;
            coldStart = false;
            return true;
        } catch (Throwable t) {
            Log.w(TAG, "开屏广告展示异常：" + describe(t));
            return false;
        }
    }

    /** 从后台回到前台：只预加载，不展示（4 小时一次的限制） */
    static void onResumeWarm(Context ctx) {
        if (!coldStart) preload(ctx);
    }

    static void onLeaveForeground() {
        coldStart = false;
    }

    static String status() {
        return "{\"ready\":" + (openAd != null)
                + ",\"init\":" + initialized
                + ",\"failed\":" + initFailed
                + ",\"shown\":" + shownThisSession + "}";
    }

    private static String describe(Throwable t) {
        String m = t.getMessage();
        return (m == null || m.isEmpty()) ? t.getClass().getSimpleName() : m;
    }
}
