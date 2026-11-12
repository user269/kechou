# jniLibs · 原生库放置处

把 `.so` 按 ABI 放进对应目录，`bash build.sh` 会自动打进 APK 的 `lib/<abi>/`：

```
jniLibs/
  arm64-v8a/libfoo.so
  armeabi-v7a/libfoo.so
```

## 三条硬要求

1. **必须 16KB 页对齐**（Android 15 起，16KB 页设备上加载失败的典型原因）。
   自己编译时加链接参数：

   ```bash
   clang -shared -fPIC -Wl,-z,max-page-size=16384 -o libfoo.so foo.c
   ```

   拿到的第三方 .so 如果 `p_align` 只有 0x1000，只能找厂商要 16KB 版本 ——
   构建脚本会直接拦下来，不会悄悄打出装得上但跑不起来的包。

2. **不要手动压缩**。构建脚本以 STORED（不压缩）写入，配合清单里的
   `android:extractNativeLibs="false"`，运行时直接从 APK 里 mmap。

3. **ABI 要和 minSdk 匹配**。本项目 minSdk 23，主流机型是 `arm64-v8a`；
   只放 `arm64-v8a` 时 32 位老机器会在加载处 `UnsatisfiedLinkError`，
   要么补 `armeabi-v7a`，要么在 Java 侧判断 `Build.SUPPORTED_ABIS` 后再调用。

## 校验

`build.sh` 最后一步会跑 `tools/check-16k.py`，逐项检查：

- `lib/**/*.so` 是否为 STORED
- 在包内的偏移是否 16KB 对齐（`zipalign -c -P 16`）
- ELF 的 `PT_LOAD` 段 `p_align` 是否 ≥ 16384

任何一项不过，构建直接失败。
