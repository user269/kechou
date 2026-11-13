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
| 多设备同步 | 手动导文件 | 同一 WiFi 直传，或导出同步包；按记录合并 |

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

### 局域网同步是怎么走的

两台手机在同一个 WiFi 下直接换数据，**不经过任何服务器**，也不上传任何东西。

协议只有三个端点，故意做得极简——这东西只在一个局域网里跑几秒钟：

| 请求 | 作用 |
|---|---|
| `GET /snapshot` | 把本机当前的同步包给对方 |
| `POST /apply` | 收下对方推来的包，放进内存待合并 |
| `GET /ping` | 探活（调试用） |

流程：先 `lanStart()` 起一个 `ServerSocket`（端口交给系统挑，避免撞车），
再用 UDP 广播 `KEBAO_WHO` 到 `45877` 找同伴，对方回 `KEBAO_HERE|<机型>|<端口>`。
找到之后点一下，客户端先拉 `snapshot`、再推 `apply`——**一次往返两边都齐了**，不用二次握手。
对方收到的包放在内存，网页每 1.2 秒来取一次（`lanInbox`），拿到就合并。

**两个必须处理、不处理就"看着像坏"的地方**：

- **必须持有 `MulticastLock`**。Android 的 WiFi 驱动默认在**硬件层**丢弃广播和多播包来省电，
  没这个锁的话，小米/OPPO/vivo 等机型永远扫不到对方——socket 开着、代码没错、结果就是空列表。
  权限是 `CHANGE_WIFI_MULTICAST_STATE`（普通权限，不用运行时申请），`onStop` 时随服务一起释放。
- **别在桥接方法里阻塞**。`@JavascriptInterface` 的方法都跑在 WebView 的同一个桥上线程，
  在里面 `sleep(2600)` 等广播、或者同步等 HTTP 响应，网页的所有原生调用会一起卡住，
  表现就是"点一下按钮整个页面顿住"。现在扫描和同步都改成：**立即返回 + 后台线程干活 + 前台轮询结果**。

几个实际会踩的点：

- **明文 HTTP 在 Android 9+ 默认被拦**。清单里开了 `android:usesCleartextTraffic="true"`，
  否则 `http://192.168.x.x` 直接抛 `CleartextNotPermitted`。
- **广播地址不一定都能用**。除了 `255.255.255.255`，还往 `/24` 算出来的子网广播发一份，
  有些路由器只转其中一种。
- **自己的广播会被自己收到**。UDP 广播会绕回来，按本机 IP 过滤掉，否则会把自己当同伴。
- **IPv6、流量卡、VPN 接口要跳过**。取地址时只认 `Inet4Address` + `isSiteLocalAddress()`，
  并且排除 `rmnet`、`tun`、`p2p` 这些接口命名。
- **局域网权限**：Android 16 起本地网络访问是 *opt-in*（默认仍开放），Android 17 才强制、
  且只针对 targetSdk 37+。当前 targetSdk 36 不受影响，但清单里已经先声明了
  `NEARBY_WIFI_DEVICES`，以后升版本不用回头改。
- **用流量或没 WiFi 时直接拒绝启动**，而不是让用户对着一个永远空着的列表猜。

传输层之外，**合并逻辑完全在网页侧**（`mergeSyncPacket`），原生只负责搬字节。
所以「怎么传」和「怎么合」是分开的：以后加蓝牙、加网盘，不用碰合并代码。

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

## 广告位（只搭了架子，没有接任何广告）

代码里有广告位，但**没有接入任何广告平台**——接穿山甲/优量汇需要：开发者账号、
AppID（穿山甲是 5 开头的 7 位）、广告位 ID，以及平台对应用的审核（一般要软著/备案）。
这些只能由你去申请。

现在完成的是「位置 + 让位 + 开关」，等 ID 到手，替换 `AdHost.createBanner()` 即可。

### 放在哪

只放**浏览型页面**：

| 位置 | 说明 |
|---|---|
| 课时费页 | 看统计时有停留，不打断操作 |
| 我的页 | 低频浏览 |

**课表页和所有录入表单一律不放**——那是用户真正在干活的地方，插广告等于赶人。
开屏和插屏也没做：这个 App 打开就要看课表，插屏会直接毁掉"快"的体感。

### 怎么出现

- banner 固定在**底部标签栏之下、系统导航栏之上**，页面整体上移让位，不遮挡任何按钮
- 进入页面后延迟 1.5 秒再请求（`settings.ads.delay`），不拖慢首屏
- 切走页面立刻收起
- `settings.ads.enabled` 默认 **false**；没接 SDK 也没开预览时，**一次原生调用都不会发生**

### 预览

「我的 → 广告位预览」会在底部显示一个占位块，看清位置和高度（56dp，标准 320×50 加内边距）。
接上真实 SDK 后这个入口会自动消失。

### 真要上线时必须改的地方

`app.js` 有两处写着"无广告"，开了广告就不能再这么说：

- 帮助 →「数据存在哪里？换手机怎么迁移？」（`不上传、不收集、无广告`）
- 关于页（`也不上传、不收集、无广告`）

另外广告 SDK 会采集设备标识，隐私说明要改成"接入广告后，广告 SDK 会收集设备信息用于投放"，
并在首次启动时给出可拒绝的选项（穿山甲有合规要求：`TTAdSdk.init` 只初始化，
`TTAdSdk.start` 必须在用户同意隐私政策之后调用）。

## 引入第三方库

把 `*.jar` / `*.aar` 丢进 `android/libs/` 就行，构建脚本自动处理，**不用改任何命令**。

| 文件 | 处理方式 |
|---|---|
| `*.jar` | 进 `javac` 的 classpath，和项目代码一起交给 `d8` 转成 dex |
| `*.aar` | 解出 `classes.jar`（同上）、`res/` 合并进资源、`jni/<abi>/*.so` 打进 `lib/<abi>/` |

第 3 步会打印这批引入了什么；AAR 里的权限和组件声明也会列出来，
但 **manifest 不做自动合并**——需要声明的 Activity/Service 得手动加到主清单。

### 三个边界（都是踩过的）

1. **AAR 不传递依赖**。它依赖的 `androidx.*`、`okhttp` 之类要自己把 jar 也放进来，
   否则编译期能看到的类，运行期会 `NoClassDefFoundError`。
2. **空的 `classes.jar` 会被警告**。AAR 打包不完整时 class 可能是空的，
   不检查就会"构建通过、运行就崩"。
3. **带 `.so` 的库要过 16KB 页校验**。`p_align < 16384` 会直接构建失败——这是故意的，
   免得打出"装得上、一加载就崩"的包。

### 这条链路是真的验证过

不是写完就交：用一个合成的 jar（含 `probe.Probe`）和一个合成 aar（含 `classes.jar`、
`res/values/strings.xml`、`jni/arm64-v8a/libprobeui.so`、两个权限声明）跑了一次完整构建，

- dex 里能搜到两个库的字符串 → classpath 与 d8 生效
- `aapt2 dump resources` 能看到 aar 里的 `probe_aar_marker` → 资源合并生效
- `.so` 落在 `lib/arm64-v8a/`，文件偏移 409600（= 16384 × 25）→ 16KB 对齐生效
- 构建输出打印 `probeui 需要权限：CAMERA VIBRATE`

验证用的探针已删除，`libs/` 目录保持为空。

### 现在为什么是空的

不是因为不支持，而是没有非它不可的库：HTTP 服务/客户端自己写了（只三个端点，引框架更重）、
JSON 用系统自带 `org.json`、zip/deflate 为 xlsx 解析自己实现了（零依赖）。
真正值得接的是推送 SDK、支付 SDK、OCR 这类——放进来即可。

## 重新构建

需要 JDK 17 + Android SDK（`platforms/android-37.0`、`build-tools/37.0.0`）。
本机 SDK 在临时目录，换机器时改 `build.sh` 顶部的 `ANDROID_SDK_ROOT` 即可。

```bash
bash build.sh
```

脚本会依次做：同步网页资源 → 收集第三方库 → `aapt2 compile` → `aapt2 link` → `javac` → `d8`
→ 打包原生库 → `zipalign` → `apksigner`。全流程不依赖 Gradle，秒级出包。

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
├── libs/                             第三方 jar / aar 放这里（见该目录 README）
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
│       ├── LanSync.java              局域网直传：HTTP 服务 + UDP 发现 + 多播锁
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
