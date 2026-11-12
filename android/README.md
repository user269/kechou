# 课酬 · Android 安装包工程

教师课时费管理 App 的原生外壳工程。界面仍然是 `../` 下的 `index.html + styles.css + app.js`，
这里只补上 Android 端缺的那一层：系统通知、闹钟、文件保存、返回键、状态栏。

## 产物

```
build/课酬-<版本>.apk    约 350 KB，已签名，可直接安装
```

## 安装到手机

1. 把 `build/课酬-<版本>.apk` 传到手机（微信文件传输助手 / 数据线 / 网盘均可）。
2. 在手机上点开安装，首次会提示「未知来源应用」——在弹窗里允许一次即可。
3. 首次启动时系统会询问通知权限，**务必允许**，否则课前提醒不会弹出。

支持 Android 6.0 及以上（minSdk 23），targetSdk 36，compileSdk 37，已适配到 Android 16。

## 原生层做了什么

网页本身已经能算课时费，但浏览器里有几件事做不到。这个壳把它们补上了：

| 能力 | 浏览器版 | 安装包版 |
|---|---|---|
| 课前提醒 | 页面开着才生效，切后台就停 | 提前交给系统闹钟，**App 划掉、熄屏也照常提醒** |
| 通知 | 依赖浏览器通知授权 | 原生通知渠道，高优先级横幅 + 震动 |
| 导出备份 | 浏览器下载，手机上常被拦 | 直接写入手机「下载」目录 |
| 返回键 | — | 先关弹层 → 再回首页 → 都没有才退出（双击确认） |
| 存储 | localStorage | localStorage，域名固定为 `https://kebao.local`，不会被清 |
| 更新 | 无 | 检查 → 下载 → 装资源包或整包，见下文 |
| 更新提醒 | 无 | 后台每 6 小时查一次，有新版本发通知，点通知直达更新页 |
| 页面崩溃 | 刷新即可 | 存储不动，自动重开页面，不整应用退出 |

### 系统栏是怎么让位的

targetSdk 35 起，Android 15 会强制应用「边到边」显示：`setStatusBarColor()` 之类的接口失效，
窗口直接铺满整屏，系统不再替应用让出状态栏。所以 `MainActivity.setupWindow()` 从 API 30 起
自己调 `setDecorFitsSystemWindows(false)` 主动边到边，再用 `applyInsets()` 按 insets 给 WebView
加 `topMargin`（状态栏高）和 `bottomMargin`（导航栏或键盘高）：状态栏那一块露出 `#F4F6FB`
与页面顶栏同色，导航栏那一块单独压一条白色，和底部标签栏接得上。
Android 10 及以下窗口本来就没铺满，保持原来的着色状态栏即可。

targetSdk 36 起预测性返回默认开启，系统只调 `OnBackInvokedCallback`，老的 `onBackPressed()`
不一定还会被调用。`registerBackCallback()` 在 API 33+ 注册回调、低版本仍走 `onBackPressed()`，
两条路都汇到 `handleBack()`：先问网页有没有面板要关，再走「双击退出」。

### 提醒是怎么排的

网页在每次数据变化后（新增课程、调课、改作息、改提醒时间）会把未来 15 天的提醒计划算好，
通过 `KebaoNative.syncReminders(json)` 交给原生层，原生层用 `AlarmManager.setExactAndAllowWhileIdle`
逐条登记，最多 120 条。开机、系统改时间、应用升级后 `BootReceiver` 会自动重新登记一遍。

`USE_EXACT_ALARM` 权限让 Android 13+ 默认授予精确闹钟能力，不需要用户手动去系统设置里开。
如果某些定制系统仍拦截，App 内「我的 → 提醒设置 → 准点提醒」会给出跳转入口。

### 原生库与 16KB 页

工程目前**没有**原生库（纯 Java + WebView），但打包链已经按「随时能放 .so」来搭：

- `app/src/main/jniLibs/<abi>/*.so` 会在 `build.sh` 第 7 步被打进 `lib/<abi>/`，
  以 **STORED（不压缩）** 方式写入；清单里 `android:extractNativeLibs="false"`，
  运行时直接从 APK mmap，不往数据目录解压。
- `zipalign -P 16 4` 把未压缩的 `.so` 对齐到 **16KB** 边界（16KB 页设备的硬要求）。
  注意 `-P` 和 `-p` 不能同时用，所以这里不再传 `-p`。
- 构建最后跑 `tools/check-16k.py`，逐项检查：是否 STORED、包内偏移是否 16KB 对齐、
  ELF 的 `PT_LOAD` 段 `p_align` 是否 ≥ 16384。任何一项不过，构建直接失败——
  避免打出「能装、一加载就崩」的包。

自己编 .so 时要带 `-Wl,-z,max-page-size=16384`；拿来的第三方 .so 如果 `p_align` 只有 4096，
只能找厂商换 16KB 版本。详见 `jniLibs/README.md`。

### 后台更新通知

应用不常开，更新提示交给系统闹钟：`UpdateCheckReceiver` 每 **6 小时**醒一次，并发拉
`Updater.FALLBACK_MANIFESTS` 里的几个清单，取 `versionCode` 最大的那份跟本机比；
比本机大且这个版本还没提醒过，就往「版本更新」渠道发一条通知。

- 用 `setAndAllowWhileIdle` + 每次醒来重排下一次，而不是 `setInexactRepeating`（后者在 Doze 下几乎不触发）；
  读失败 1 小时后再试，正常则 6 小时。
- `BootReceiver` 在开机 / 升级 / 改时间后一起重排（更新检查和上课提醒的闹钟都会被系统清掉）。
- 点通知 → `MainActivity` 带 `EXTRA_OPEN_UPDATE` → 页面 `onPageFinished` 后调
  `window.__kebaoOpenUpdate()`，直接打开更新面板并静默检查一次。
- 同一版本只提醒一次（`kebao_update_check.notifiedCode`），不重复打扰。

## 重新构建

需要 JDK 17 + Android SDK（`platforms/android-37.0`、`build-tools/37.0.0`）。
本机 SDK 在临时目录，换机器时改 `build.sh` 顶部的 `ANDROID_SDK_ROOT` 即可。

```bash
bash build.sh
```

脚本会依次做：同步网页资源 → `aapt2 compile` → `aapt2 link` → `javac` → `d8` → `zipalign` → `apksigner`。
全流程不依赖 Gradle，秒级出包。

> 改界面请改上级目录的 `app.js / styles.css / index.html`，构建时会自动同步到 `assets/`，
> 不要直接改 `assets/` 里的副本，否则下次构建会被覆盖。

签名证书 `keystore.jks` 与口令文件 `.keystore-pass` 都**不进仓库**（见根目录 `.gitignore`）。
构建时脚本从 `android/.keystore-pass` 读取口令，也可以用环境变量覆盖：

```bash
printf 'your-password' > android/.keystore-pass   # 首次准备，别提交
# 或
KS_PASS=your-password bash android/build.sh
```

**换证书会导致已安装的旧版本无法覆盖升级**，务必备份 `keystore.jks` 与口令；
要发布到应用商店则需另建正式证书，或用 GitHub Secrets 在 CI 中注入。

## 工程结构

```
android/
├── build.sh                          一键构建脚本
├── keystore.jks                      签名证书
├── app/src/main/
│   ├── AndroidManifest.xml           权限、Activity、三个 Receiver
│   ├── assets/                       网页资源（构建时从上级同步）
│   ├── jniLibs/                      原生库放置处（见该目录 README）
│   ├── res/                          图标、主题、字符串
│   └── java/com/kebao/lessonpay/
│       ├── App.java                  Application，最早装上崩溃记录
│       ├── MainActivity.java         WebView 壳、资源拦截、返回键、状态栏、渲染进程重建
│       ├── WebBridge.java            暴露给网页的原生接口
│       ├── Updater.java              拉更新清单、下载解压、装 APK、失败回滚
│       ├── UpdateCheckReceiver.java  后台每 6 小时查新版本并发通知
│       ├── ApkProvider.java          content:// 把安装包交给系统安装器
│       ├── AlarmScheduler.java       提醒计划 → 系统闹钟
│       ├── ReminderReceiver.java     闹钟到点发通知
│       ├── BootReceiver.java         开机/改时间后重新排期
│       ├── CrashLog.java             闪退堆栈落盘 + 下次启动弹窗
│       └── Notifier.java             通知渠道与下发
└── tools/
    ├── check-16k.py                  16KB 页合规校验
    └── *.svg / *.png                 图标源文件
```

## 网页与原生怎么对接

原生层通过 `window.KebaoNative` 暴露方法，`app.js` 里的 `IS_NATIVE` 分支负责调用：

```js
KebaoNative.hasNotifyPermission()      // 是否已授权通知
KebaoNative.requestNotifyPermission()  // 请求通知权限
KebaoNative.notifyNow(title, body)     // 立即弹通知
KebaoNative.syncReminders(json)        // 同步未来 15 天提醒计划
KebaoNative.saveFile(name, content, mime)  // 保存到下载目录，返回 null 表示成功
KebaoNative.canScheduleExact()         // 精确闹钟是否可用
KebaoNative.openExactAlarmSettings()   // 跳转系统授权页

// 更新相关
KebaoNative.appInfo()                  // 版本号、资源号、是否有安装权限
KebaoNative.updateCheck()              // 拉清单，结果回调 window.__onUpdateCheck
KebaoNative.updateDownloadWeb(url)     // 下载并解压资源包，进度回调 __onUpdateProgress
KebaoNative.updateDownloadApk(url)     // 下载整包
KebaoNative.updateInstall()            // 唤起系统安装器
KebaoNative.resetWebUpdate()           // 放弃热更新，退回安装包内置资源
KebaoNative.reloadPage()               // 重载页面（热更后生效）
```

在普通浏览器里 `KebaoNative` 不存在，`IS_NATIVE` 为 `false`，全部逻辑自动退回 Web 实现，
所以同一份 `app.js` 既是网页版也是安装包版。

## 排查

**打开是白屏** —— 多半是 WebView 版本过旧。在系统设置里更新「Android System WebView」后重试。

**收不到提醒** —— 依次检查：系统设置里本应用的通知权限、「电池 → 应用启动管理」是否限制了后台、
以及「我的 → 提醒设置」里准点提醒是否显示为已开启。

**数据丢了** —— 数据存在应用私有目录，卸载 App 会一起清除。换机前用「我的 → 导出备份」存一份
JSON，新机装好后用「从备份恢复」导回。

## 自动更新

界面资源从 `assets/` 剥离了出来。启动时先看应用私有目录 `filesDir/www/` 有没有热更新过的版本：
有就用它，没有才回落 `assets/`。所以改界面不必重装整包。

```
update.json（仓库根目录，raw 直链）
   ├── versionCode 变大 → 下载 APK → ApkProvider 转 content:// → 系统安装器
   └── web.build 变大   → 下载 zip → 解压到 filesDir/www → 重载页面
```

换资源的动作是原子的：先解到 `www.new`，确认 `index.html` 在里面，再把旧目录改名 `.bak`、
新的顶上；失败自动还原，App 启动时还会跑一次 `Updater.recover()` 兜底，不会停在半截状态。

两个限制必须知道：

- 系统**不允许静默安装**，除 root / 设备管理员 / 系统签名外，只能唤起安装器让用户点「安装」。
  所以整包更新是「自动检查 + 自动下载 + 一键安装」，最后一步点不掉；资源包更新则完全无感。
- 热更新只能换前端资源。通知、权限、文件这些原生逻辑有改动时，必须发整包。

发版流程见根目录 `README.md`。
