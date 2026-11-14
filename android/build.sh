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
LIBS="libs"                    # 第三方库：*.jar / *.aar 丢这里即可（见 libs/README.md）
OUT="build"
KS="keystore.jks"
# 签名密码不写进仓库：优先读环境变量，其次读本地 android/.keystore-pass
KS_PASS="${KS_PASS:-$(cat .keystore-pass 2>/dev/null || true)}"
VERSION_NAME="1.3.0a"
VERSION_CODE="32"
TARGET_SDK="36"
COMPILE_SDK="37"
APK_NAME="课酬-${VERSION_NAME}.apk"

# ---------- 前置检查 ----------
[ -f "$PLATFORM_WIN" ] || { echo "缺少 android.jar（compileSdk $COMPILE_SDK）：$PLATFORM_WIN"; exit 1; }
[ -f "$BT_POSIX/aapt2.exe" ] || { echo "缺少 build-tools/37.0.0"; exit 1; }
[ -n "$KS_PASS" ] || { echo "缺少签名密码：把密码写入 android/.keystore-pass，或设置 KS_PASS 环境变量"; exit 1; }

echo "==> 1/11 同步网页资源"
mkdir -p "$APP/assets"
for f in index.html styles.css app.js icon.svg icon-192.png icon-512.png manifest.json; do
  cp "../$f" "$APP/assets/$f"
done

echo "==> 2/11 清理产物"
rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex"

echo "==> 3/11 收集第三方库（$LIBS/）"
# 手写构建链没有 Gradle 的依赖解析，这里把 libs 下的东西摊平：
#   *.jar          → 直接进 classpath，和项目代码一起转 dex
#   *.aar          → 解出 classes.jar / res / jni，分别并入对应阶段
# manifest 不做自动合并（真正的合并器很重），只把权限列出来提示，
# 需要声明的组件请手动加到 app/src/main/AndroidManifest.xml。
JARS="$OUT/libjars"
AAR_JNI="$OUT/aarjni"
mkdir -p "$JARS" "$AAR_JNI"

LIB_JARS=()
LIB_NAMES=()
MANIFEST_HINTS=()

if [ -d "$LIBS" ]; then
  for f in "$LIBS"/*.jar; do
    [ -f "$f" ] || continue
    cp "$f" "$JARS/"
    LIB_JARS+=("$(cygpath -m "$JARS/$(basename "$f")")")
    LIB_NAMES+=("$(basename "$f")")
  done

  for a in "$LIBS"/*.aar; do
    [ -f "$a" ] || continue
    name="$(basename "$a" .aar)"
    d="$OUT/aar/$name"
    rm -rf "$d"; mkdir -p "$d"
    unzip -q -o "$a" -d "$d"

    if [ -f "$d/classes.jar" ]; then
      # 空 jar 会让编译期通过、运行期 NoClassDefFoundError，这里提前拦下
      ncls="$(unzip -l "$d/classes.jar" 2>/dev/null | grep -c '\.class$' || true)"
      if [ "${ncls:-0}" -eq 0 ]; then
        echo "    警告：$name.aar 的 classes.jar 里没有 class（AAR 可能打包不全，或依赖在别处）"
      fi
      cp "$d/classes.jar" "$JARS/$name.jar"
      LIB_JARS+=("$(cygpath -m "$JARS/$name.jar")")
      LIB_NAMES+=("$name.aar（${ncls:-0} 个类）")
    fi
    if [ -d "$d/jni" ]; then
      for abi in $(ls "$d/jni" 2>/dev/null); do
        mkdir -p "$AAR_JNI/$abi"
        cp "$d/jni/$abi"/*.so "$AAR_JNI/$abi/" 2>/dev/null || true
      done
    fi
    if [ -f "$d/AndroidManifest.xml" ]; then
      # AAR 里的 manifest 是源码 XML，直接抠出权限名
      perms="$(grep -o 'android:name="android\.permission\.[^"]*"' "$d/AndroidManifest.xml" 2>/dev/null         | sed 's/.*android\.permission\.//; s/"$//' | sort -u | tr '\n' ' ' || true)"
      [ -n "$perms" ] && MANIFEST_HINTS+=("$name 需要权限：$perms")
      if grep -qE '<(activity|service|receiver|provider)' "$d/AndroidManifest.xml" 2>/dev/null; then
        MANIFEST_HINTS+=("$name 声明了组件（Activity/Service/Receiver/Provider），需要手动加到主清单")
      fi
    fi
  done
fi

if [ ${#LIB_NAMES[@]} -gt 0 ]; then
  echo "    已引入：${LIB_NAMES[*]}"
else
  echo "    没有第三方库（$LIBS/ 为空，属于正常）"
fi
for h in "${MANIFEST_HINTS[@]:-}"; do
  [ -n "$h" ] && echo "    提醒：$h"
done

echo "==> 4/11 编译资源 (aapt2 compile)"
"$BT_POSIX/aapt2.exe" compile --dir "$APP/res" -o "$OUT/res.zip"
RES_ARGS=("$OUT/res.zip")
# 每个 AAR 的 res 单独编译，link 时一起传。
# 不能直接 cp 到一个目录：多个库都有 values-de/values.xml 这类同名文件，
# 覆盖会丢掉其他库的翻译；而且 AAR 里的文件是只读的，覆盖还会失败。
RES_N=0
for d in "$OUT"/aar/*/; do
  [ -d "$d/res" ] || continue
  RES_N=$((RES_N+1))
  if "$BT_POSIX/aapt2.exe" compile --dir "$d/res" -o "$OUT/aar-res-$RES_N.zip" 2>"$OUT/aar-res-$RES_N.log"; then
    RES_ARGS+=("$OUT/aar-res-$RES_N.zip")
  else
    echo "    警告：$(basename "$d") 的资源编译失败（已跳过）"
    head -3 "$OUT/aar-res-$RES_N.log" | sed 's/^/      /'
  fi
done
[ "$RES_N" -gt 0 ] && echo "    已编译 $RES_N 个 AAR 的资源"

echo "==> 5/11 合并清单 (AAR 的权限与组件)"
# Gradle 有 manifest merger，手写链没有。少了这一步，SDK 的 Activity/Provider
# 不会被注册，运行时才报 ActivityNotFound，很难查。
MANIFEST_TO_USE="$APP/AndroidManifest.xml"
if [ -n "$(ls -A "$OUT/aar" 2>/dev/null)" ]; then
  python tools/merge-manifests.py "$APP/AndroidManifest.xml" "$OUT/aar" "$OUT/AndroidManifest.xml" \
    || { echo "    清单合并失败"; exit 1; }
  MANIFEST_TO_USE="$OUT/AndroidManifest.xml"
else
  echo "    没有 AAR，跳过"
fi

echo "==> 6/11 链接资源与清单 (aapt2 link)"
"$BT_POSIX/aapt2.exe" link \
  -o "$OUT/base.apk" \
  -I "$PLATFORM_WIN" \
  --manifest "$MANIFEST_TO_USE" \
  --java "$OUT/gen" \
  -A "$APP/assets" \
  --min-sdk-version 23 \
  --target-sdk-version "$TARGET_SDK" \
  --version-code "$VERSION_CODE" \
  --version-name "$VERSION_NAME" \
  "${RES_ARGS[@]}"

echo "==> 7/11 编译 Java 源码 (javac)"
# core-lambda-stubs.jar 让 javac 在 android.jar 作为 bootclasspath 时仍能编译 lambda
CP="$PLATFORM_WIN;$BT_WIN/core-lambda-stubs.jar"
for j in "${LIB_JARS[@]:-}"; do
  [ -n "$j" ] && CP="$CP;$j"
done
# 按目录递归收源码：以后拆包、加子目录都不用改脚本
find "$APP/java" -name '*.java' > "$OUT/srclist.txt"
"$JDK_POSIX/bin/javac.exe" -encoding UTF-8 -source 8 -target 8 -nowarn \
  -bootclasspath "$PLATFORM_WIN" \
  -classpath "$CP" \
  -d "$OUT/classes" \
  "$OUT/gen/com/kebao/lessonpay/R.java" \
  @"$OUT/srclist.txt"

echo "==> 8/11 转换为 dex (d8)"
find "$OUT/classes" -name "*.class" > "$OUT/classlist.txt"
# 第三方 jar 和项目 class 一起转：d8 接受 jar 作为输入，产出一份 classes.dex
"$JDK_POSIX/bin/java.exe" -cp "$BT_WIN/lib/d8.jar" com.android.tools.r8.D8 \
  --lib "$PLATFORM_WIN" \
  --min-api 23 \
  --output "$OUT/dex" \
  @"$OUT/classlist.txt" \
  "${LIB_JARS[@]:-}"

# 方法数超过 64K 时 d8 会拆出 classes2.dex、classes3.dex…，必须全部打进去，
# 少打一个就是运行时 NoClassDefFoundError。min-api 23 下多 dex 是系统原生支持的，
# 不需要 MultiDexApplication。
DEX_COUNT=$(ls "$OUT/dex"/classes*.dex 2>/dev/null | wc -l | tr -d ' ')
echo "    生成 $DEX_COUNT 个 dex"
( cd "$OUT/dex" && "$JDK_POSIX/bin/jar.exe" uf "../base.apk" $(ls classes*.dex) )

echo "==> 9/11 打包原生库"
# 手写的构建链没有 Gradle 的 jniLibs 插件，这里自己把 .so 塞进 lib/<abi>/。
# 两点必须遵守，否则 Android 15 起（尤其 16KB 页设备）装得上但加载失败：
#   1) 必须以「不压缩」方式存储（清单里 extractNativeLibs=false，运行时直接 mmap）
#   2) 随后的 zipalign -P 16 会把这些未压缩的 .so 对齐到 16KB 边界
python - "$JNI" "$AAR_JNI" "$OUT/base.apk" <<'PY'
import os, sys, zipfile

apk = sys.argv[-1]
sources = sys.argv[1:-1]
libs = []
seen = set()
for src in sources:
    if not os.path.isdir(src):
        continue
    for abi in sorted(os.listdir(src)):
        d = os.path.join(src, abi)
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if not f.endswith('.so'):
                continue
            arc = 'lib/%s/%s' % (abi, f)
            if arc in seen:          # jniLibs 优先，AAR 里的同名文件不覆盖
                continue
            seen.add(arc)
            libs.append((abi, f, os.path.join(d, f)))

if not libs:
    print('    没有原生库，跳过（空目录也算合规）')
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

echo "==> 10/11 对齐 (zipalign，原生库按 16KB 页对齐)"
# -P 16 表示把未压缩的 .so 对齐到 16KB 边界（16KB 页设备的硬要求），
# 注意 -P 不能和 -p 同时用，所以这里不再传 -p。
# zipalign 给未压缩条目插对齐填充时，会对自己制造的中间态刷 "header mismatch"。
# 产物随后由 `zipalign -c` 和 zip 结构校验兜底，所以这里只保留真正有用的报错。
ZLOG="$OUT/zipalign.log"
if ! "$BT_POSIX/zipalign.exe" -f -P 16 4 "$OUT/base.apk" "$OUT/aligned.apk" 2>"$ZLOG"; then
  grep -v "header mismatch" "$ZLOG" | grep -v '^[[:space:]]*$' || true
  echo "    zipalign 失败"
  exit 1
fi
if grep -qv "header mismatch" "$ZLOG" 2>/dev/null; then
  grep -v "header mismatch" "$ZLOG" | grep -v '^[[:space:]]*$' | sed 's/^/    /' || true
fi

echo "==> 11/11 签名 (apksigner)"
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
