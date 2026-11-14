#!/usr/bin/env bash
# ============================================================
# 课酬 · GitHub Release 发布脚本
#   bash publish.sh apk     把当前版本安装包传到 tag v<版本>
#   bash publish.sh web     把资源包传到 tag web-<build>
#
# 需要一个有 repo 写权限的 token（二选一）：
#   echo ghp_xxxxxxxx > .gh-token     # 已被 .gitignore 忽略，不会提交
#   export GITHUB_TOKEN=ghp_xxxxxxxx
#
# 仓库地址自动从 git remote origin 读取，不用手改。
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-$(cat .gh-token 2>/dev/null || true)}}"
[ -n "$TOKEN" ] || { echo "缺少 token：写入 .gh-token 文件，或设置 GITHUB_TOKEN 环境变量"; exit 1; }

REMOTE="$(git remote get-url origin 2>/dev/null || true)"
[ -n "$REMOTE" ] || { echo "没有 git remote origin"; exit 1; }
REPO="$(printf '%s' "$REMOTE" | sed -E 's#^.*github\.com[:/]##; s#\.git$##')"
[ "$(printf '%s' "$REPO" | tr -cd '/' | wc -c)" -eq 1 ] || { echo "无法解析仓库地址：$REMOTE"; exit 1; }

MODE="${1:-apk}"
case "$MODE" in apk|web) ;; *) echo "用法：bash publish.sh [apk|web]"; exit 1 ;; esac

# 先把 tag 指到当前提交并推到远端。
# 否则 GitHub 收到 tag_name 时若远端没有该 tag，会把它建在当前 HEAD 上，
# 结果 release 挂着旧提交，jsDelivr 的 @<tag> 路径取不到安装包。
# 两条版本线各自一份清单：1.2 → update-1.2.json，其余 → update.json。
# MANIFEST 可以直接指定（同时发两条线时用得上，因为 version.txt 只记最后一次构建）
if [ -z "${MANIFEST:-}" ]; then
  MANIFEST="update.json"
  if [ -f android/build/version.txt ]; then
    LINE="$(cut -d' ' -f1 android/build/version.txt | cut -d. -f1,2)"
    if [ "${LINE:-}" = "1.2" ]; then MANIFEST="update-$LINE.json"; fi
  fi
fi
echo "清单：$MANIFEST"

VER="$(python -c "import json;print(json.load(open('$MANIFEST'))['versionName'])" 2>/dev/null || echo '')"
BUILD="$(python -c "import json;print((json.load(open('$MANIFEST')).get('web') or {}).get('build',0))" 2>/dev/null || echo 0)"
if [ "$MODE" = "apk" ]; then TAG="v$VER"; else TAG="web-$BUILD"; fi
if git rev-parse -q --verify HEAD >/dev/null 2>&1; then
  git tag -f "$TAG" >/dev/null 2>&1 || true
  if GIT_TERMINAL_PROMPT=0 timeout 60 git push -f origin "$TAG" >/dev/null 2>&1; then
    echo "tag $TAG 已推到远端"
  else
    echo "!! tag $TAG 推送失败（网络问题），jsDelivr 镜像可能取不到文件"
  fi
fi

GITHUB_TOKEN="$TOKEN" REPO="$REPO" MODE="$MODE" MANIFEST="$MANIFEST" python - <<'PY'
import json, os, sys, urllib.error, urllib.parse, urllib.request

TOKEN = os.environ['GITHUB_TOKEN']
OWNER, NAME = os.environ['REPO'].split('/')
MODE = os.environ['MODE']
API = 'https://api.github.com'

def call(path, method='GET', payload=None, ctype='application/json'):
    data = json.dumps(payload).encode('utf-8') if payload is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header('Authorization', 'Bearer ' + TOKEN)
    req.add_header('Accept', 'application/vnd.github+json')
    req.add_header('X-GitHub-Api-Version', '2022-11-28')
    if data is not None:
        req.add_header('Content-Type', ctype)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        detail = e.read().decode('utf-8', 'replace')
        if e.code == 422:
            return None                      # 已存在，交给调用方处理
        raise SystemExit('API 失败 %s %s\n%s' % (e.code, path, detail[:500]))

def upload(rid, path):
    fn = os.path.basename(path)
    for a in call('/repos/%s/%s/releases/%d/assets' % (OWNER, NAME, rid)) or []:
        if a['name'] == fn:
            print('  覆盖已有附件 ' + fn)
            call('/repos/%s/%s/releases/assets/%d' % (OWNER, NAME, a['id']), 'DELETE')
    size = os.path.getsize(path)
    url = 'https://uploads.github.com/repos/%s/%s/releases/%d/assets?name=%s' % (
        OWNER, NAME, rid, urllib.parse.quote(fn))
    req = urllib.request.Request(url, data=open(path, 'rb').read(), method='POST')
    req.add_header('Authorization', 'Bearer ' + TOKEN)
    req.add_header('Content-Type', 'application/octet-stream')
    req.add_header('Accept', 'application/vnd.github+json')
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            out = json.loads(r.read())
        print('  已上传 %s（%.0f KB）' % (out['name'], size / 1024.0))
    except urllib.error.HTTPError as e:
        raise SystemExit('上传失败 %s\n%s' % (e.code, e.read().decode('utf-8', 'replace')[:500]))

m = json.load(open(os.environ.get('MANIFEST', 'update.json'), encoding='utf-8'))

if MODE == 'apk':
    tag = 'v' + m['versionName']
    title = '课酬 ' + m['versionName']
    asset = os.path.join('dist', 'kebao-%s.apk' % m['versionName'])
    if not os.path.isfile(asset):
        raise SystemExit('缺少安装包：' + asset + '\n先执行 bash android/build.sh && bash release.sh apk')
else:
    build = int(m['web'].get('build') or 0)
    if build == 0:
        raise SystemExit('清单里 web.build 为 0，说明当前没有待发的资源包\n先执行 bash release.sh web')
    tag = 'web-%d' % build
    title = '界面资源 %d' % build
    asset = os.path.join('dist', 'www-%d.zip' % build)
    if not os.path.isfile(asset):
        raise SystemExit('缺少资源包：' + asset + '\n先执行 bash release.sh web')

body = '\n'.join('- ' + n for n in (m['notes'] or [])) or '见提交记录'
rel = call('/repos/%s/%s/releases' % (OWNER, NAME), 'POST', {
    'tag_name': tag, 'name': title, 'body': body,
    'draft': False, 'prerelease': False,
})
if rel is None:
    rel = call('/repos/%s/%s/releases/tags/%s' % (OWNER, NAME, tag))
    print('发布 %s 已存在，改为追加附件' % tag)
else:
    print('已创建发布 %s' % tag)

upload(rel['id'], asset)
print()
print('地址：%s' % rel['html_url'])
PY

echo
echo "提示：清单 $MANIFEST 已指向该地址，确认已提交到 main。"
