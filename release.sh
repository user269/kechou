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
MANIFEST="$DIST/update.json"
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
    }
    save()

    print('资源包已生成：%s（%s）' % (path, kb(size)))
    print()
    print('上传：')
    print('  gh release create %s %s --title "资源 %s" --notes "界面与文案更新"' % (tag, path, build))
    print()
    print('清单 %s 里的 web 段已更新，把 dist/update.json 一并提交到仓库根目录。' % manifest_path)

elif mode == 'apk':
    vname = vcode = None
    for line in open(os.path.join('android', 'build.sh'), encoding='utf-8'):
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
    data['apk'] = {
        'url': '%s/%s/%s' % (base, tag, name),
        'size': size,
    }
    # 新整包里的前端就是最新的，资源号归零，避免刚装上就提示要热更
    data['web'] = {'build': 0, 'url': '', 'size': 0, 'notes': []}
    save()

    print('整包已就绪：%s（%s · versionCode %d）' % (dst, kb(size), vcode))
    print()
    print('上传：')
    print('  gh release create %s %s --title "课酬 %s" --notes "见更新记录"' % (tag, dst, vname))
    print()
    print('清单 %s 里的 versionCode/versionName/apk 段已更新。' % manifest_path)

print()
print('清单预览：')
print(open(manifest_path, encoding='utf-8').read())
PY
