package com.kebao.lessonpay;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 开机、应用升级、系统改时间之后，闹钟会被系统清空，这里重新登记一遍。
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null) return;
        String a = intent.getAction();
        if (a == null) return;
        if (Intent.ACTION_BOOT_COMPLETED.equals(a)
                || Intent.ACTION_TIME_CHANGED.equals(a)
                || Intent.ACTION_TIMEZONE_CHANGED.equals(a)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) {
            AlarmScheduler.reschedule(ctx);
            // 更新检查的闹钟同样会被系统清掉，一起补上
            UpdateCheckReceiver.reschedule(ctx);
        }
    }
}
