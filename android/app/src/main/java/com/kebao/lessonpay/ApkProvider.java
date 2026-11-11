package com.kebao.lessonpay;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * 极简的 FileProvider。
 *
 * 工程没有引入 androidx，因此手写一个只能读 filesDir/update 的提供者，
 * 供系统安装器以 content:// 方式读取下载好的 APK（Android 7+ 已禁止 file:// 直传）。
 * 只暴露单个目录、只允许只读，避免越权访问其他私有文件。
 */
public class ApkProvider extends ContentProvider {

    public static final String AUTHORITY = "com.kebao.lessonpay.files";

    /** 下载的安装包统一放在这里，Provider 与 Updater 共用。 */
    public static File dirOf(Context ctx) {
        File d = new File(ctx.getFilesDir(), "update");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    public static Uri uriFor(Context ctx, File f) {
        return new Uri.Builder()
                .scheme("content")
                .authority(AUTHORITY)
                .appendPath(f.getName())
                .build();
    }

    private File resolve(Uri uri) {
        String name = uri == null ? null : uri.getLastPathSegment();
        if (name == null || name.isEmpty()) return null;
        if (name.contains("/") || name.contains("\\") || name.contains("..")) return null;
        if (getContext() == null) return null;
        return new File(dirOf(getContext()), name);
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = resolve(uri);
        if (f == null || !f.isFile()) throw new FileNotFoundException(String.valueOf(uri));
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    /** 部分 ROM 的安装器会先查文件名和大小，缺了会直接提示"解析失败"。 */
    @Override
    public Cursor query(Uri uri, String[] projection, String selection,
                        String[] selectionArgs, String sortOrder) {
        File f = resolve(uri);
        if (f == null || !f.isFile()) return null;
        String[] cols = projection != null ? projection
                : new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE };
        MatrixCursor c = new MatrixCursor(cols, 1);
        Object[] row = new Object[cols.length];
        for (int i = 0; i < cols.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = f.getName();
            else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = f.length();
            else row[i] = null;
        }
        c.addRow(row);
        return c;
    }

    @Override
    public String getType(Uri uri) {
        return "application/vnd.android.package-archive";
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
