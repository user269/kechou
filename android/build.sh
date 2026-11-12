#!/usr/bin/env bash
# ============================================================
# 课酬 Android 安装包构建脚本
# 依赖：JDK 17 + Android SDK（platforms/android-37.0、build-tools/37.0.0）
# 用法：bash build.sh
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

# ---------- 路径 ----------
SDK_POSIX="${ANDROID_SDK_ROOT:-/c/Users/555/android-sdk}"
SDK_WIN="$(cygpath -m "$SDK_POSIX" 2>/dev/null || echo "$SDK_POSIX")"
JDK_POSIX="${JAVA_HOME:-/c/Program Files/Java/jdk-17}"
JDK_WIN="$(cygpath -m "$JDK_POSIX" 2>/dev/null || echo "$JDK_POSIX")"

BT_POSIX="$SDK_POSIX/build-tools/37.0.0"
BT_WIN="$SDK_WIN/build-tools/37.0.0"
PLATFORM_WIN="$SDK_WIN/platforms/android-37.0/android.jar"

APP="app/src/main"
JNI="$APP/jniLibs"
OUT="build"
KS="keystore.jks"
# 签名密码不写进仓库：优先读环境变量，其次读本地 android/.keystore-pass
KS_PASS="${KS_PASS:-$(cat .keystore-pass 2>/dev/null || true)}"
VERSION_NAME="1.0.19"
VERSION_CODE="20"
TARGET_SDK="36"
COMPILE_SDK="37"
APK_NAME="课酬-${VERSION_NAME}.apk"

# ---------- 前置检查 ----------
[ -f "$PLATFORM_WIN" ] || { echo "缺少 android.jar（compileSdk $COMPILE_SDK）：$PLATFORM_WIN"; exit 1; }
[ -f "$BT_POSIX/aapt2.exe" ] || { echo "缺少 build-tools/37.0.0"; exit 1; }
[ -n "$KS_PASS" ] || { echo "缺少签名密码：把密码写入 android/.keystore-pass，或设置 KS_PASS 环境变量"; exit 1; }

echo "==> 1/8 同步网页资源"
mkdir -p "$APP/assets"
for f in index.html styles.css app.js icon.svg icon-192.png icon-512.png manifest.json; do
  cp "../$f" "$APP/assets/$f"
done

echo "==> 2/8 清理产物"
rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex"

echo "==> 3/9 编译资源 (aapt2 compile)"
"$BT_POSIX/aapt2.exe" compile --dir "$APP/res" -o "$OUT/res.zip"

echo "==> 4/9 链接资源与清单 (aapt2 link)"
"$BT_POSIX/aapt2.exe" link \
  -o "$OUT/base.apk" \
  -I "$PLATFORM_WIN" \
  --manifest "$APP/AndroidManifest.xml" \
  --java "$OUT/gen" \
  -A "$APP/assets" \
  --min-sdk-version 23 \
  --target-sdk-version "$TARGET_SDK" \
  --version-code "$VERSION_CODE" \
  --version-name "$VERSION_NAME" \
  "$OUT/res.zip"

echo "==> 5/9 编译 Java 源码 (javac)"
# core-lambda-stubs.jar 让 javac 在 android.jar 作为 bootclasspath 时仍能编译 lambda
"$JDK_POSIX/bin/javac.exe" -encoding UTF-8 -source 8 -target 8 -nowarn \
  -bootclasspath "$PLATFORM_WIN" \
  -classpath "$PLATFORM_WIN;$BT_WIN/core-lambda-stubs.jar" \
  -d "$OUT/classes" \
  "$OUT/gen/com/kebao/lessonpay/R.java" \
  $APP/java/com/kebao/lessonpay/*.java

echo "==> 6/9 转换为 dex (d8)"
find "$OUT/classes" -name "*.class" > "$OUT/classlist.txt"
"$JDK_POSIX/bin/java.exe" -cp "$BT_WIN/lib/d8.jar" com.android.tools.r8.D8 \
  --lib "$PLATFORM_WIN" \
  --min-api 23 \
  --output "$OUT/dex" \
  @"$OUT/classlist.txt"

( cd "$OUT/dex" && "$JDK_POSIX/bin/jar.exe" uf "../base.apk" classes.dex )

echo "==> 7/9 打包原生库 (${JNI##*/})"
# 手写的构建链没有 Gradle 的 jniLibs 插件，这里自己把 .so 塞进 lib/<abi>/。
# 两点必须遵守，否则 Android 15 起（尤其 16KB 页设备）装得上但加载失败：
#   1) 必须以「不压缩」方式存储（清单里 extractNativeLibs=false，运行时直接 mmap）
#   2) 随后的 zipalign -P 16 会把这些未压缩的 .so 对齐到 16KB 边界
python - "$JNI" "$OUT/base.apk" <<'PY'
import os, sys, zipfile

src, apk = sys.argv[1], sys.argv[2]
libs = []
if os.path.isdir(src):
    for abi in sorted(os.listdir(src)):
        d = os.path.join(src, abi)
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if f.endswith('.so'):
                libs.append((abi, f, os.path.join(d, f)))

if not libs:
    print('    没有 jniLibs，跳过（空目录也算合规）')
    raise SystemExit(0)

with zipfile.ZipFile(apk, 'a', zipfile.ZIP_DEFLATED) as z:
    for abi, name, path in libs:
        arc = 'lib/%s/%s' % (abi, name)
        zi = zipfile.ZipInfo(arc)
        zi.compress_type = zipfile.ZIP_STORED          # 不压缩，才能被对齐
        zi.external_attr = 0o644 << 16
        with open(path, 'rb') as fh:
            z.writestr(zi, fh.read())
        print('    + %s (%d KB)' % (arc, os.path.getsize(path) // 1024))
PY

echo "==> 8/9 对齐 (zipalign，原生库按 16KB 页对齐)"
# -P 16 表示把未压缩的 .so 对齐到 16KB 边界（16KB 页设备的硬要求），
# 注意 -P 不能和 -p 同时用，所以这里不再传 -p。
"$BT_POSIX/zipalign.exe" -f -P 16 4 "$OUT/base.apk" "$OUT/aligned.apk"

echo "==> 9/9 签名 (apksigner)"
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
echo "==> 校验 16KB 页兼容性"
python tools/check-16k.py "$OUT/$APK_NAME" --zipalign "$BT_POSIX/zipalign.exe"

echo
echo "构建完成：$PWD/$OUT/$APK_NAME"
ls -lh "$OUT/$APK_NAME"
