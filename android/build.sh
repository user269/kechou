#!/usr/bin/env bash
# ============================================================
# 课酬 Android 安装包构建脚本
# 依赖：JDK 17 + Android SDK（platforms/android-34、build-tools/34.0.0）
# 用法：bash build.sh
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

# ---------- 路径 ----------
SDK_POSIX="${ANDROID_SDK_ROOT:-/c/Users/555/AppData/Local/Temp/android-sdk}"
SDK_WIN="$(cygpath -m "$SDK_POSIX" 2>/dev/null || echo "$SDK_POSIX")"
JDK_POSIX="${JAVA_HOME:-/c/Program Files/Java/jdk-17}"
JDK_WIN="$(cygpath -m "$JDK_POSIX" 2>/dev/null || echo "$JDK_POSIX")"

BT_POSIX="$SDK_POSIX/build-tools/34.0.0"
BT_WIN="$SDK_WIN/build-tools/34.0.0"
PLATFORM_WIN="$SDK_WIN/platforms/android-34/android.jar"

APP="app/src/main"
OUT="build"
KS="keystore.jks"
# 签名密码不写进仓库：优先读环境变量，其次读本地 android/.keystore-pass
KS_PASS="${KS_PASS:-$(cat .keystore-pass 2>/dev/null || true)}"
VERSION_NAME="1.0.13"
VERSION_CODE="14"
APK_NAME="课酬-${VERSION_NAME}.apk"

# ---------- 前置检查 ----------
[ -f "$PLATFORM_WIN" ] || { echo "缺少 android.jar：$PLATFORM_WIN"; exit 1; }
[ -f "$BT_POSIX/aapt2.exe" ] || { echo "缺少 build-tools/34.0.0"; exit 1; }
[ -n "$KS_PASS" ] || { echo "缺少签名密码：把密码写入 android/.keystore-pass，或设置 KS_PASS 环境变量"; exit 1; }

echo "==> 1/8 同步网页资源"
mkdir -p "$APP/assets"
for f in index.html styles.css app.js icon.svg icon-192.png icon-512.png manifest.json; do
  cp "../$f" "$APP/assets/$f"
done

echo "==> 2/8 清理产物"
rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex"

echo "==> 3/8 编译资源 (aapt2 compile)"
"$BT_POSIX/aapt2.exe" compile --dir "$APP/res" -o "$OUT/res.zip"

echo "==> 4/8 链接资源与清单 (aapt2 link)"
"$BT_POSIX/aapt2.exe" link \
  -o "$OUT/base.apk" \
  -I "$PLATFORM_WIN" \
  --manifest "$APP/AndroidManifest.xml" \
  --java "$OUT/gen" \
  -A "$APP/assets" \
  --min-sdk-version 23 \
  --target-sdk-version 34 \
  --version-code "$VERSION_CODE" \
  --version-name "$VERSION_NAME" \
  "$OUT/res.zip"

echo "==> 5/8 编译 Java 源码 (javac)"
# core-lambda-stubs.jar 让 javac 在 android.jar 作为 bootclasspath 时仍能编译 lambda
"$JDK_POSIX/bin/javac.exe" -encoding UTF-8 -source 8 -target 8 -nowarn \
  -bootclasspath "$PLATFORM_WIN" \
  -classpath "$PLATFORM_WIN;$BT_WIN/core-lambda-stubs.jar" \
  -d "$OUT/classes" \
  "$OUT/gen/com/kebao/lessonpay/R.java" \
  $APP/java/com/kebao/lessonpay/*.java

echo "==> 6/8 转换为 dex (d8)"
find "$OUT/classes" -name "*.class" > "$OUT/classlist.txt"
"$JDK_POSIX/bin/java.exe" -cp "$BT_WIN/lib/d8.jar" com.android.tools.r8.D8 \
  --lib "$PLATFORM_WIN" \
  --min-api 23 \
  --output "$OUT/dex" \
  @"$OUT/classlist.txt"

( cd "$OUT/dex" && "$JDK_POSIX/bin/jar.exe" uf "../base.apk" classes.dex )

echo "==> 7/8 对齐 (zipalign)"
"$BT_POSIX/zipalign.exe" -f -p 4 "$OUT/base.apk" "$OUT/aligned.apk"

echo "==> 8/8 签名 (apksigner)"
if [ ! -f "$KS" ]; then
  echo "    生成签名证书 $KS"
  "$JDK_POSIX/bin/keytool.exe" -genkeypair -v \
    -keystore "$KS" \
    -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -alias kebao -keyalg RSA -keysize 2048 -validity 10950 \
    -dname "CN=Kebao, OU=Mobile, O=Kebao, L=Beijing, ST=Beijing, C=CN" >/dev/null 2>&1
fi

"$JDK_POSIX/bin/java.exe" -jar "$BT_WIN/lib/apksigner.jar" sign \
  --ks "$KS" --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --out "$OUT/$APK_NAME" "$OUT/aligned.apk"

"$JDK_POSIX/bin/java.exe" -jar "$BT_WIN/lib/apksigner.jar" verify "$OUT/$APK_NAME"

echo
echo "构建完成：$PWD/$OUT/$APK_NAME"
ls -lh "$OUT/$APK_NAME"
