package com.kebao.lessonpay;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * 把网页算好的提醒计划落到系统闹钟上。
 * 网页只负责「什么时候、提醒什么」，这里负责在 App 未运行时也能准时弹出。
 */
public final class AlarmScheduler {

    static final String PREF = "kebao_reminders";
    static final String KEY_PAYLOAD = "payload";
    private static final int MAX_ALARMS = 120;

    private AlarmScheduler() { }

    /** 用新的提醒计划替换旧的，并立即重新调度。 */
    public static void sync(Context ctx, String json) {
        if (json == null) json = "[]";
        String old = prefs(ctx).getString(KEY_PAYLOAD, "[]");
        cancelAll(ctx, old);
        prefs(ctx).edit().putString(KEY_PAYLOAD, json).apply();
        reschedule(ctx);
    }

    /** 按已保存的计划重新登记闹钟（开机、改时间、升级后调用）。 */
    public static void reschedule(Context ctx) {
        String json = prefs(ctx).getString(KEY_PAYLOAD, "[]");
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;

        List<JSONObject> items = new ArrayList<>();
        try {
            JSONArray arr = new JSONArray(json);
            long now = System.currentTimeMillis();
            for (int i = 0; i < arr.length() && items.size() < MAX_ALARMS; i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                if (o.optLong("at", 0L) <= now + 1000L) continue;
                items.add(o);
            }
        } catch (Exception e) {
            return;
        }

        for (JSONObject o : items) {
            long at = o.optLong("at");
            String id = o.optString("id", String.valueOf(at));
            String title = o.optString("title", "上课提醒");
            String body = o.optString("body", "");

            PendingIntent pi = pending(ctx, id, title, body, PendingIntent.FLAG_UPDATE_CURRENT);
            try {
                if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) {
                    // 未获得精确闹钟授权时退化为省电模式允许的近似闹钟
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                } else if (Build.VERSION.SDK_INT >= 23) {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                } else {
                    am.setExact(AlarmManager.RTC_WAKEUP, at, pi);
                }
            } catch (SecurityException ignored) {
                try { am.set(AlarmManager.RTC_WAKEUP, at, pi); } catch (Exception ignored2) { }
            }
        }
    }

    private static void cancelAll(Context ctx, String json) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        try {
            JSONArray arr = new JSONArray(json);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                String id = o.optString("id", String.valueOf(o.optLong("at")));
                PendingIntent pi = pending(ctx, id, "", "",
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_NO_CREATE);
                if (pi != null) {
                    am.cancel(pi);
                    pi.cancel();
                }
            }
        } catch (Exception ignored) { }
    }

    private static PendingIntent pending(Context ctx, String id, String title, String body, int baseFlags) {
        Intent it = new Intent(ctx, ReminderReceiver.class)
                .setAction(ReminderReceiver.ACTION)
                .setData(Uri.parse("kebao://remind/" + id))
                .putExtra("title", title)
                .putExtra("body", body)
                .putExtra("rid", id);

        int flags = baseFlags;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(ctx, id.hashCode() & 0x7fefffff, it, flags);
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE);
    }
}
