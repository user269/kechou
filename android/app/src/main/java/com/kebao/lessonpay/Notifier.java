package com.kebao.lessonpay;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** 通知渠道与通知下发。 */
public final class Notifier {

    public static final String CHANNEL_ID = "lesson_reminder";
    public static final String CHANNEL_NAME = "上课提醒";
    /** 版本更新走单独渠道，用户只嫌更新吵时可以单独关掉，不影响上课提醒。 */
    public static final String UPDATE_CHANNEL_ID = "app_update";
    public static final String UPDATE_CHANNEL_NAME = "版本更新";

    private Notifier() { }

    public static void ensureChannel(Context ctx) {
        ensureChannel(ctx, CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH,
                "课前提醒与每日课时小结", true);
        ensureChannel(ctx, UPDATE_CHANNEL_ID, UPDATE_CHANNEL_NAME, NotificationManager.IMPORTANCE_DEFAULT,
                "发现新版本时提示一次，点开即可更新", false);
    }

    private static void ensureChannel(Context ctx, String id, String name, int importance,
                                      String desc, boolean vibrate) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm =
                (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (nm.getNotificationChannel(id) != null) return;

        NotificationChannel ch = new NotificationChannel(id, name, importance);
        ch.setDescription(desc);
        ch.enableLights(true);
        ch.enableVibration(vibrate);
        ch.setShowBadge(true);
        nm.createNotificationChannel(ch);
    }

    /**
     * 有新版本的通知。点击回到应用，MainActivity 看到 EXTRA_OPEN_UPDATE 就直接打开更新面板。
     */
    public static void notifyUpdate(Context ctx, String versionName) {
        ensureChannel(ctx);
        NotificationManager nm =
                (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        open.putExtra(MainActivity.EXTRA_OPEN_UPDATE, true);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) piFlags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(ctx, 0x5B02, open, piFlags);

        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(ctx, UPDATE_CHANNEL_ID)
                : new Notification.Builder(ctx);
        b.setContentTitle("课酬有新版本 " + versionName)
                .setContentText("点这里看更新内容，一分钟装好")
                .setSmallIcon(R.drawable.ic_stat_lesson)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setWhen(System.currentTimeMillis())
                .setShowWhen(true);
        try {
            nm.notify(0x5B02, b.build());
        } catch (SecurityException ignored) {
            // 通知权限被关掉了
        }
    }

    public static void show(Context ctx, String title, String body, int id) {
        ensureChannel(ctx);
        NotificationManager nm =
                (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) piFlags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(ctx, id, open, piFlags);

        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(ctx, CHANNEL_ID)
                : new Notification.Builder(ctx);

        b.setContentTitle(title == null ? "课酬" : title)
                .setContentText(body == null ? "" : body)
                .setSmallIcon(R.drawable.ic_stat_lesson)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setWhen(System.currentTimeMillis())
                .setShowWhen(true);

        if (Build.VERSION.SDK_INT >= 21) {
            b.setPriority(Notification.PRIORITY_HIGH);
            b.setDefaults(Notification.DEFAULT_VIBRATE);
        }
        if (body != null && body.length() > 40) {
            b.setStyle(new Notification.BigTextStyle().bigText(body));
        }

        try {
            nm.notify(id, b.build());
        } catch (SecurityException ignored) {
            // 用户关闭了通知权限
        }
    }
}
