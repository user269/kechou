# 第三方库放这里

把 `*.jar` 或 `*.aar` 直接丢进这个目录，构建时会自动处理，不用改任何脚本。

## 会发生什么

| 文件类型 | 处理方式 |
|---|---|
| `xxx.jar` | 直接进 javac classpath，并和项目代码一起用 d8 转成 dex |
| `xxx.aar` | 解出 `classes.jar` → 进 classpath；`res/` → 合并进资源；`jni/<abi>/*.so` → 打进 `lib/<abi>/` |

构建输出会列出这次引入了哪些库。AAR 里若有权限或组件声明，会打印提醒——**manifest 不做自动合并**，
需要的话手动加到 `app/src/main/AndroidManifest.xml`。

## 要注意的

1. **AAR 不传递依赖**。如果这个 SDK 还依赖别的库（`androidx.*`、`okhttp` 等），
   要自己把那些 jar 也放进来，否则编译期或运行期会报 `NoClassDefFoundError`。
2. **纯 Java 的库最省事**。带 `.so` 的库会被 16KB 页校验，`p_align < 16384` 会直接构建失败（这是故意的，
   免得打出"能装、一加载就崩"的包）。
3. **别放同一个库的多个版本**，会出现重复类。

## 它现在还是空的

不是因为不支持，而是目前没有非它不可的库：

- HTTP 服务/客户端 → 自己写了（`LanSync.java`，只用了三个端点，引入框架反而更重）
- JSON → Android 自带的 `org.json`
- zip / deflate → 自己实现了（`app.js` 里的 `inflateRaw`，为了 xlsx 解析，零依赖）
- 推送、统计、崩溃上报 → 需要厂商账号，接了才有意义

真需要的场景：接微信/支付宝 SDK、推送 SDK、OCR、音视频解码这类，放进来就能用。
