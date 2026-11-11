package com.kebao.lessonpay;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 闹钟到点后弹出通知。 */
public class ReminderReceiver extends BroadcastReceiver {

    public static final String ACTION = "com.kebao.lessonpay.REMIND";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null || !ACTION.equals(intent.getAction())) return;
        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");
        String rid = intent.getStringExtra("rid");

        int id = rid == null ? (int) (System.currentTimeMillis() % 100000)
                : (rid.hashCode() & 0x7fefffff);
        Notifier.show(ctx, title == null ? "上课提醒" : title, body == null ? "" : body, id);
    }
}
