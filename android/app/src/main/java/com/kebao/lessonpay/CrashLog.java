package com.kebao.lessonpay;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.os.Build;
import android.text.method.ScrollingMovementMethod;
import android.util.TypedValue;
import android.widget.TextView;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 闪退取证。
 *
 * 这个应用没法在用户手机上连 adb，所以闪退只能靠「下次启动时把上次的堆栈显示出来」：
 * 启动过程的每一步打一条面包屑，崩溃时连堆栈一起写进私有目录，
 * 下次进来弹窗展示（可选中、可复制），用户截个图就能定位到具体那一行。
 */
public final class CrashLog {

    private static final String CRASH_FILE = "last-crash.txt";
    private static final String STEP_FILE = "last-steps.txt";
    private static final long MAX_STEP_BYTES = 8000;

    private static boolean installed = false;

    private CrashLog() { }

    /** 在 onCreate 最前面调用，之后任何线程的未捕获异常都会被记下来。 */
    static void install(Context ctx) {
        if (installed) return;
        installed = true;
        final Context app = ctx.getApplicationContext();
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((t, e) -> {
            try {
                save(app, e);
            } catch (Throwable ignored) {
                // 记不下来也只能继续走系统默认流程
            }
            if (prev != null) prev.uncaughtException(t, e);
        });
    }

    /** 每次启动清空上一条启动留下的步骤，崩溃时文件里就是这次的经历。 */
    static void resetSteps(Context ctx) {
        try {
            //noinspection ResultOfMethodCallIgnored
            new File(ctx.getFilesDir(), STEP_FILE).delete();
        } catch (Throwable ignored) { }
    }

    /** 记一条启动步骤。故意用追加写，崩溃时最后一行就是断点。 */
    static void step(Context ctx, String what) {
        try {
            File f = new File(ctx.getFilesDir(), STEP_FILE);
            if (f.length() > MAX_STEP_BYTES) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
            String line = new SimpleDateFormat("HH:mm:ss", Locale.CHINA).format(new Date())
                    + " · " + what + "\n";
            try (FileOutputStream out = new FileOutputStream(f, true)) {
                out.write(line.getBytes("UTF-8"));
            }
        } catch (Throwable ignored) { }
    }

    private static void save(Context ctx, Throwable e) {
        StringWriter sw = new StringWriter();
        sw.write("时间 " + new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.CHINA)
                .format(new Date()) + "\n");
        sw.write("机型 " + Build.MANUFACTURER + " " + Build.MODEL
                + " · Android " + Build.VERSION.RELEASE
                + "（API " + Build.VERSION.SDK_INT + "）\n");
        sw.write("版本 " + versionName(ctx) + "\n");
        String steps = readFile(new File(ctx.getFilesDir(), STEP_FILE));
        if (steps != null && !steps.trim().isEmpty()) {
            sw.write("\n启动步骤：\n" + steps);
        }
        sw.write("\n堆栈：\n");
        PrintWriter pw = new PrintWriter(sw);
        e.printStackTrace(pw);
        pw.flush();
        String text = sw.toString();

        dump(new File(ctx.getFilesDir(), CRASH_FILE), text);
        // 外部私有目录再放一份：连电脑或用文件管理器能直接翻到，不依赖弹窗
        File ext = ctx.getExternalFilesDir(null);
        if (ext != null) dump(new File(ext, CRASH_FILE), text);
    }

    private static void dump(File f, String text) {
        try {
            File parent = f.getParentFile();
            if (parent != null && !parent.exists()) //noinspection ResultOfMethodCallIgnored
                parent.mkdirs();
            try (FileOutputStream out = new FileOutputStream(f)) {
                out.write(text.getBytes("UTF-8"));
            }
        } catch (Throwable ignored) { }
    }

    private static String readFile(File f) {
        try {
            if (!f.isFile()) return null;
            try (FileInputStream in = new FileInputStream(f)) {
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[4096];
                int n;
                while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
                return new String(bos.toByteArray(), "UTF-8");
            }
        } catch (Throwable e) {
            return null;
        }
    }

    private static String versionName(Context ctx) {
        try {
            return ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0).versionName;
        } catch (Throwable e) {
            return "未知";
        }
    }

    /** 上次若崩过，把原因显示出来；用户点「知道了」后清掉，下次崩溃才会再出现。 */
    static void showIfAny(final Activity a) {
        final String text = readFile(new File(a.getFilesDir(), CRASH_FILE));
        if (text == null || text.trim().isEmpty()) return;
        try {
            TextView tv = new TextView(a);
            tv.setText(text);
            tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
            tv.setTextIsSelectable(true);
            tv.setMovementMethod(new ScrollingMovementMethod());
            int pad = (int) (16 * a.getResources().getDisplayMetrics().density);
            tv.setPadding(pad, pad / 2, pad, pad / 2);

            new AlertDialog.Builder(a)
                    .setTitle("上次启动出错了")
                    .setView(tv)
                    .setPositiveButton("复制", (d, w) -> {
                        try {
                            ClipboardManager cm =
                                    (ClipboardManager) a.getSystemService(Context.CLIPBOARD_SERVICE);
                            if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("崩溃信息", text));
                            Toast.makeText(a, "已复制，可以发给开发者", Toast.LENGTH_SHORT).show();
                        } catch (Throwable ignored) { }
                    })
                    .setNegativeButton("知道了", (d, w) -> clear(a))
                    .show();
        } catch (Throwable ignored) { }
    }

    private static void clear(Activity a) {
        try {
            //noinspection ResultOfMethodCallIgnored
            new File(a.getFilesDir(), CRASH_FILE).delete();
            File ext = a.getExternalFilesDir(null);
            if (ext != null) //noinspection ResultOfMethodCallIgnored
                new File(ext, CRASH_FILE).delete();
        } catch (Throwable ignored) { }
    }
}
