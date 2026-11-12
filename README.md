# 课酬 · 教师课时费计算

一款给**中学教师**用的课时费记账工具。课表排一次，之后每节课自动按分钟折算课时费，月底直接出账单。

纯前端实现（HTML + CSS + 原生 JS），无框架、无后端、无广告，所有数据存在本机。同一份代码既能当网页用（PWA 可添加到桌面），也能打包成安卓 APK。

---

## 功能

**计费**

- 课程类型自由定义：正课、自习、晚自习、辅导各设单价，按「元/节」「元/小时」「元/分钟」计价
- 三种计费公式：按节数、按时长、按时长 × 班级系数
- 班级系数：按班级名关键词自动上浮（如「实验班 ×1.2」），也可逐班单独设
- 金额一律四舍五入到分，时长按分钟精确折算（70 分钟 × ¥36/小时 = ¥42.00，不出小数）
- 延长课（拖堂）单独记时长，按指定类型单价另算

**课表**

- 作息时间表驱动：设好每节起止时间，新建课程自动带上时长
- 单双周排课：同一时段可分别挂单周课与双周课，网格里上下两行、各用各的颜色
- 总课表（标准周模板）：一次铺到整个学期，之后按周微调
- 快捷调课：两节课互换，或单节改时间、改教室、改类型
- 调休规则：如「双周周日返校补周五下午」，自动把课挪到指定日期
- 法定节假日：内置 2026–2027 年放假与补班安排，可联网同步、逐条改日期/名称/半天放学时刻；铺课表自动跳过假期，补班日可指定按哪个星期的课表上课
- 周日开学、跨零点晚自习都支持
- 课表文本导入导出：一段纯文本即可换机、分享、备份

**提醒与数据**

- 课前提醒（可设提前几分钟）+ 每日小结，走系统通知，重启手机后仍然有效
- 导出 JSON 备份，可自选保存位置；导入即恢复
- 一键清理示例课表，或整体重置

**更新**

- 内置自动更新：资源包热更新（只换界面，重启即生效）+ 整包更新（唤起安装器）双通道

---

## 目录结构

```
.
├── index.html          # 单页骨架，内联 SVG 图标集
├── styles.css          # 全部样式
├── app.js              # 全部逻辑（约 4600 行）
├── manifest.json       # PWA 清单
├── sw.js               # Service Worker，离线缓存
├── icon.svg            # 图标源文件
├── icon-192.png        # PWA 图标
├── icon-512.png
├── release.sh          # 发版脚本：打资源包 / 整包，生成 update.json
├── publish.sh          # 把产物传到 GitHub Release（需 token）
├── update.json         # 更新清单，客户端从 raw 直链读这个文件
├── dist/               # 发版产物（zip/apk 传 Release，不进仓库）
└── android/
    ├── build.sh        # 一键构建 APK（aapt2 → javac → d8 → zipalign → apksigner）
    ├── keystore.jks    # 签名证书（不提交）
    ├── .keystore-pass  # 签名密码（不提交）
    ├── tools/          # 图标 SVG 源文件
    └── app/src/main/
        ├── AndroidManifest.xml
        ├── assets/     # 由 build.sh 从根目录同步过来的网页资源
        ├── java/com/kebao/lessonpay/
        │   ├── MainActivity.java     # WebView 壳，拦截 https://kebao.local/
        │   ├── WebBridge.java        # JS 桥：存文件、通知、更新
        │   ├── Updater.java          # 拉清单、下载解压、安装、回滚
        │   ├── ApkProvider.java      # content:// 提供安装包给系统安装器
        │   ├── AlarmScheduler.java   # 精确闹钟排程
        │   ├── Notifier.java         # 通知渠道
        │   ├── ReminderReceiver.java # 提醒触发
        │   └── BootReceiver.java     # 开机重排提醒
        └── res/
```

---

## 本地运行

不需要任何依赖，直接用浏览器打开 `index.html` 即可。想用完整 PWA 能力（离线缓存、桌面图标）就起个静态服务：

```bash
python -m http.server 8080
# 打开 http://localhost:8080
```

首次打开会带一份示例课表，用来演示各种计费情形。真实使用前在「我的 → 重置为示例数据」旁边点「清理课表」，或选择只清掉示例课。

---

## 构建 APK

**依赖**

- JDK 17
- Android SDK：`platforms/android-34`、`build-tools/34.0.0`

**步骤**

```bash
# 指定 SDK 与 JDK（也可以直接改 android/build.sh 顶部的默认值）
export ANDROID_SDK_ROOT=/path/to/android-sdk
export JAVA_HOME=/path/to/jdk-17

# 首次构建会提示缺少密码文件
printf 'your-keystore-password' > android/.keystore-pass

bash android/build.sh
```

产物在 `android/build/课酬-<版本>.apk`，已 zipalign 并签名，可直接安装。

签名证书 `android/keystore.jks` 与密码文件都不进仓库。**证书一旦更换，老版本就无法覆盖安装**，务必备份，建议私密保存（或使用 GitHub Secrets 在 CI 中注入）。

版本号在两处，需同时修改：

- `android/build.sh` 的 `VERSION_NAME` / `VERSION_CODE`
- `android/app/src/main/AndroidManifest.xml` 的 `android:versionName` / `android:versionCode`

> aapt2 的 `--version-code` 参数会被清单里的值覆盖，所以以清单为准，两边保持一致最省事。

---

## 发版与自动更新

更新走「清单 + 两条通道」：

```
update.json（仓库根目录，raw 直链）
        │  客户端读取，比较 versionCode 与 web.build
        ├── versionCode 更新 → 下载 APK → content:// 交给安装器
        └── web.build 更新   → 下载 zip → 解压到私有目录 → 重载页面
```

整包优先：新整包里已经带了最新前端，不必再下一份资源包。

**只改了界面（index.html / styles.css / app.js）**

```bash
bash release.sh web        # 生成 dist/www-N.zip，web.build 自动 +1
```

把 `dist/www-N.zip` 上传到 Release，标签用脚本提示的 `web-N`；仓库根目录的 `update.json` 会自动更新，提交即可。

**改了原生代码**

```bash
bash release.sh apk        # 打包并更新 versionCode/versionName，web.build 归零
```

上传 `dist/kebao-<版本>.apk` 到标签 `v<版本>`，同样提交根目录的 `update.json`。

**用脚本自动发布**（省掉网页上手动拖文件）

```bash
echo ghp_xxxxxxxxxxxxxxxx > .gh-token    # 只需一次，token 需带 repo 写权限
bash publish.sh apk                       # 建 v<版本> 发布并上传 APK
bash publish.sh web                       # 建 web-<build> 发布并上传资源包
```

`.gh-token` 已在 `.gitignore` 里，不会被提交。也可以改用 `GITHUB_TOKEN` 环境变量。

**更新源地址**（三处必须一致）

- `app.js` 的 `UPDATE_MANIFEST`
- `android/.../Updater.java` 的 `MANIFEST_URL`
- `release.sh` 的 `GH_OWNER` / `GH_REPO`（默认已是本仓库）

**关于安卓的限制**：系统不允许应用静默安装，除 root、设备管理员或系统签名外，任何应用都只能唤起安装器让用户点一下「安装」。所以这里的自动更新是「自动检查 + 自动下载 + 一键安装」，最后那一步点不掉。热更新则无需安装，用户完全无感。

---

## 数据与隐私

- 所有数据存在浏览器 localStorage / WebView 本地存储，不上传任何服务器
- 无账号、无埋点、无广告
- 唯一的网络请求是更新检查（仅在你手动点检查，或启动后自动检查时），只读取 `update.json`
- 换机请用「导出备份」生成 JSON，再到新机「从备份恢复」

---

## 已知限制

- 卸载应用会连同数据一起清除，卸载前先导出备份
- 热更新只能替换前端资源，原生能力（通知、文件、安装）的改动必须发整包
- 课表按「学期周数 + 首周单双周」推算，学期设置改错会导致整学期的单双周错位
