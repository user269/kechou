package com.kebao.lessonpay;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Build;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * 后台更新检查（不打开应用也能提示有新版本）。
 *
 * App 平时不常开，更新提示只能交给系统闹钟：每 6 小时醒一次，并发拉几个镜像上的
 * update.json，取 versionCode 最大的那份跟本机比，比本机大就发一条通知。
 * 点通知进来时 MainActivity 会带上标记，自动打开更新面板。
 *
 * 用 setAndAllowWhileIdle + 每次醒来重排下一次，而不是 setInexactRepeating：
 * 后者在 Doze 下会被一路推迟到几乎不触发，前者反而更可靠（代价是时间点不精确，
 * 对「几小时内的版本提示」无所谓）。
 */
public class UpdateCheckReceiver extends BroadcastReceiver {

    static final String ACTION = "com.kebao.lessonpay.CHECK_UPDATE";
    private static final String PREF = "kebao_update_check";
    private static final String KEY_NEXT_AT = "nextAt";
    private static final String KEY_NOTIFIED_CODE = "notifiedCode";
    private static final String KEY_LAST_OK = "lastOkAt";

    /** 正常节奏：6 小时。 */
    private static final long INTERVAL = 6L * 60 * 60 * 1000;
    /** 没网/接口挂了：1 小时后再试，别等到 6 小时。 */
    private static final long RETRY = 60L * 60 * 1000;
    private static final int TIMEOUT = 5000;
    private static final int MAX_MANIFEST = 256 * 1024;
    private static final int REQ = 0x5B01;

    /** 应用启动时调一次：只有快到期才重排，避免每次冷启动都把计时重置。 */
    static void ensureScheduled(Context ctx) {
        long next = prefs(ctx).getLong(KEY_NEXT_AT, 0L);
        if (next <= 0L || System.currentTimeMillis() >= next) schedule(ctx, INTERVAL);
    }

    /** 开机、升级、改时间之后也要把它排上。 */
    static void reschedule(Context ctx) {
        schedule(ctx, INTERVAL);
    }

    private static void schedule(Context ctx, long delay) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        long at = System.currentTimeMillis() + delay;
        try {
            if (Build.VERSION.SDK_INT >= 23) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(ctx));
            } else {
                am.set(AlarmManager.RTC_WAKEUP, at, pending(ctx));
            }
        } catch (Throwable e) {
            return;
        }
        prefs(ctx).edit().putLong(KEY_NEXT_AT, at).apply();
    }

    private static PendingIntent pending(Context ctx) {
        Intent i = new Intent(ctx, UpdateCheckReceiver.class).setAction(ACTION);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(ctx, REQ, i, flags);
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        final Context app = ctx.getApplicationContext();
        final PendingResult result = goAsync();
        new Thread(() -> {
            boolean ok = false;
            try {
                ok = check(app);
            } catch (Throwable ignored) {
                // 后台任务出什么错都不该影响用户
            } finally {
                schedule(app, ok ? INTERVAL : RETRY);
                try {
                    result.finish();
                } catch (Throwable ignored) { }
            }
        }, "kebao-update-check").start();
    }

    /** 返回 true 表示清单读到了（不代表有新版本）；false 表示网络/格式失败，要早点重试。 */
    private static boolean check(Context ctx) {
        String body = fetchBest();
        if (body == null) return false;

        int remote;
        String name;
        try {
            JSONObject o = new JSONObject(body);
            remote = o.optInt("versionCode", 0);
            name = o.optString("versionName", "");
        } catch (Throwable e) {
            return false;
        }
        if (remote <= 0) return false;

        prefs(ctx).edit().putLong(KEY_LAST_OK, System.currentTimeMillis()).apply();

        long local = localCode(ctx);
        if (local <= 0 || remote <= local) return true;

        // 同一个版本只提醒一次，别每小时都弹
        if (prefs(ctx).getInt(KEY_NOTIFIED_CODE, 0) >= remote) return true;
        prefs(ctx).edit().putInt(KEY_NOTIFIED_CODE, remote).apply();

        Notifier.notifyUpdate(ctx, name.isEmpty() ? ("v" + remote) : name);
        return true;
    }

    /** 并发拉所有候选清单，取 versionCode 最大的那份。 */
    private static String fetchBest() {
        String[] urls = Updater.FALLBACK_MANIFESTS;
        final List<String> list = new ArrayList<>();
        for (String u : urls) {
            if (u != null && !u.trim().isEmpty()) list.add(u.trim());
        }
        final int n = list.size();
        if (n == 0) return null;

        final String[] bodies = new String[n];
        final CountDownLatch latch = new CountDownLatch(n);
        for (int i = 0; i < n; i++) {
            final int idx = i;
            final String url = list.get(i);
            new Thread(() -> {
                try {
                    String t = get(url);
                    if (t != null && !t.trim().isEmpty()) {
                        new JSONObject(t);          // 先确认是 JSON，避免把错误页当清单
                        bodies[idx] = t;
                    }
                } catch (Throwable ignored) {
                } finally {
                    latch.countDown();
                }
            }).start();
        }
        try {
            latch.await(6, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }

        String best = null;
        int bestCode = -1;
        for (int i = 0; i < n; i++) {
            if (bodies[i] == null) continue;
            try {
                int vc = new JSONObject(bodies[i]).optInt("versionCode", 0);
                if (vc > bestCode) {
                    bestCode = vc;
                    best = bodies[i];
                }
            } catch (Throwable ignored) { }
        }
        return best;
    }

    private static String get(String urlStr) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(urlStr).openConnection();
            c.setConnectTimeout(TIMEOUT);
            c.setReadTimeout(TIMEOUT);
            c.setInstanceFollowRedirects(true);
            c.setRequestProperty("User-Agent", "KebaoUpdater/1.0 (Android)");
            c.setRequestProperty("Accept", "*/*");
            c.setRequestProperty("Cache-Control", "no-cache");
            if (c.getResponseCode() != 200) return null;
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int m;
                int cap = 0;
                while ((m = in.read(buf)) > 0) {
                    cap += m;
                    if (cap > MAX_MANIFEST) return null;
                    bos.write(buf, 0, m);
                }
                return new String(bos.toByteArray(), "UTF-8");
            }
        } catch (Throwable e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static long localCode(Context ctx) {
        try {
            PackageInfo p = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            if (Build.VERSION.SDK_INT >= 28) return p.getLongVersionCode();
            return p.versionCode;
        } catch (Throwable e) {
            return 0L;
        }
    }
}
