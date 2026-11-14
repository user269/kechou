#!/usr/bin/env bash
# ============================================================
# 课酬 · 发布脚本
#   bash release.sh web          打包前端资源包，build 号自动 +1
#   bash release.sh apk          打包整包，versionCode/Name 取自 build.sh
#
# 产出都在 dist/ 下，按提示上传到 GitHub Release 即可。
# 仓库地址用环境变量覆盖：
#   GH_OWNER=你的用户名 GH_REPO=仓库名 bash release.sh web
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

GH_OWNER="${GH_OWNER:-user269}"
GH_REPO="${GH_REPO:-kechou}"
BASE="https://github.com/$GH_OWNER/$GH_REPO/releases/download"
DIST="dist"
MANIFEST="update.json"   # 固定放仓库根目录，客户端从 raw 直链读这一份
WEB_FILES="index.html styles.css app.js icon.svg icon-192.png icon-512.png manifest.json"

MODE="${1:-web}"
case "$MODE" in
  web|apk) ;;
  *) echo "用法：bash release.sh [web|apk]"; exit 1 ;;
esac

mkdir -p "$DIST"

python - "$MODE" "$DIST" "$MANIFEST" "$BASE" "$WEB_FILES" "$GH_OWNER" "$GH_REPO" <<'PY'
import json, os, re, shutil, sys, zipfile

mode, dist, manifest_path, base, web_files, owner, repo = sys.argv[1:8]
web_files = web_files.split()

data = {}
if os.path.isfile(manifest_path):
    with open(manifest_path, encoding='utf-8') as f:
        data = json.load(f)

data.setdefault('versionCode', 0)
data.setdefault('versionName', '0.0.0')
data.setdefault('notes', [])
data.setdefault('apk', {'url': '', 'size': 0})
data.setdefault('web', {'build': 0, 'url': '', 'size': 0, 'notes': []})

def save():
    import time
    data['updated'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')

def kb(n):
    return '%.0f KB' % (n / 1024.0)

if mode == 'web':
    build = int(data['web'].get('build') or 0) + 1
    name = 'www-%d.zip' % build
    path = os.path.join(dist, name)

    missing = [f for f in web_files if not os.path.isfile(f)]
    if missing:
        print('缺少文件：' + '、'.join(missing))
        sys.exit(1)

    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in web_files:
            z.write(f, f)

    size = os.path.getsize(path)
    tag = 'web-%d' % build
    data['web'] = {
        'build': build,
        'name': '资源 %d' % build,
        'url': '%s/%s/%s' % (base, tag, name),
        'size': size,
        'notes': data['web'].get('notes') or data['notes'],
        'mirrors': [
            'https://ghfast.top/%s/%s/%s' % (base, tag, name),
        ],
    }
    save()

    print('资源包已生成：%s（%s）' % (path, kb(size)))
    print()
    print('上传：')
    print('  gh release create %s %s --title "资源 %s" --notes "界面与文案更新"' % (tag, path, build))
    print()
    print('清单 %s 的 web 段已更新，把它一起提交到 main 分支即可。' % manifest_path)

elif mode == 'apk':
    vname = vcode = None
    # 优先读构建产物里记下的实际版本：两条版本线共用一份 build.sh，
    # 变量可能来自环境变量覆盖，直接解析源码会读错
    vfile = os.path.join('android', 'build', 'version.txt')
    if os.path.isfile(vfile):
        parts = open(vfile, encoding='utf-8').read().split()
        if len(parts) >= 2:
            vname, vcode = parts[0], int(parts[1])
    for line in ([] if vname else open(os.path.join('android', 'build.sh'), encoding='utf-8')):
        m = re.match(r'\s*VERSION_NAME="([^"]+)"', line)
        if m:
            vname = m.group(1)
        m = re.match(r'\s*VERSION_CODE="([^"]+)"', line)
        if m:
            vcode = int(m.group(1))
    if not vname or vcode is None:
        print('没从 android/build.sh 读到版本号')
        sys.exit(1)

    src = os.path.join('android', 'build', '课酬-%s.apk' % vname)
    if not os.path.isfile(src):
        print('没找到安装包：' + src)
        print('先执行 bash android/build.sh')
        sys.exit(1)

    name = 'kebao-%s.apk' % vname
    dst = os.path.join(dist, name)
    shutil.copyfile(src, dst)
    size = os.path.getsize(dst)
    tag = 'v%s' % vname

    data['versionCode'] = vcode
    data['versionName'] = vname
    # 镜像顺序即客户端的尝试顺序：jsDelivr 走仓库文件（CDN），
    # 后面两个是 GitHub 反代，最后才是 release 原始直链（国内常被卡）
    # 镜像顺序即客户端的尝试顺序。jsDelivr 不能用：它对 apk 这类文件会
    # 301 重定向回 raw.githubusercontent.com，而那个域名在国内本来就打不开，
    # 等于白等一次超时。直接上两个 GitHub 反代，最后才是 release 原始直链。
    data['apk'] = {
        'url': '%s/%s/%s' % (base, tag, name),
        'size': size,
        'mirrors': [
            'https://ghfast.top/%s/%s/%s' % (base, tag, name),
            'https://gh-proxy.com/%s/%s/%s' % (base, tag, name),
            'https://ghproxy.net/%s/%s/%s' % (base, tag, name),
        ],
    }
    # 顺手把安装包放进仓库，jsDelivr 才有文件可发
    apkdir = os.path.join('apk')
    os.makedirs(apkdir, exist_ok=True)
    shutil.copyfile(dst, os.path.join(apkdir, name))
    print('已放入仓库目录：apk/%s（供 jsDelivr 镜像使用，记得一起提交）' % name)
    # 新整包里的前端就是最新的，资源号归零，避免刚装上就提示要热更
    data['web'] = {'build': 0, 'url': '', 'size': 0, 'notes': []}
    save()

    print('整包已就绪：%s（%s · versionCode %d）' % (dst, kb(size), vcode))
    print()
    print('上传：')
    print('  gh release create %s %s --title "课酬 %s" --notes "见更新记录"' % (tag, dst, vname))
    print()
    print('清单 %s 的 versionCode/versionName/apk 段已更新，记得提交。' % manifest_path)

print()
print('清单预览：')
print(open(manifest_path, encoding='utf-8').read())
PY

# jsDelivr 的分支地址会缓存 12 小时，发布后立刻清一次，减少节点还在吐旧清单的窗口。
# 客户端已经改成「并发取版本号最大」，即使这里没清干净也不会误判成「已是最新」。
for p in update.json holidays.json; do
  if curl -s -m 20 "https://purge.jsdelivr.net/gh/${GH_OWNER}/${GH_REPO}@main/${p}" >/dev/null 2>&1; then
    echo "已请求清除 jsDelivr 缓存：${p}"
  fi
done
