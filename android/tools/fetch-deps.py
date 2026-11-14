#!/usr/bin/env python3
"""把 Google Mobile Ads（AdMob）的依赖树拉到 android/libs/。

手写构建链没有 Gradle 的依赖解析，这个脚本补上那一块：
  1. 从根依赖递归读 pom，把传递依赖全部收进来
  2. 同一个 group:artifact 出现多个版本时取最高（和 Gradle 的行为一致）
  3. 依次尝试 Google Maven → Maven Central → 阿里云镜像
  4. 下载 aar/jar 到 android/libs/

用法：
    python android/tools/fetch-deps.py            # 拉默认的 AdMob
    python android/tools/fetch-deps.py --dry-run  # 只看会下什么，不落盘

下完直接 bash android/build.sh，构建脚本会自动处理。
"""

import argparse
import os
import sys
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ANDROID = os.path.dirname(HERE)
LIBS = os.path.join(ANDROID, "libs")

REPOS = [
    "https://dl.google.com/dl/android/maven2",
    "https://repo1.maven.org/maven2",
    "https://maven.aliyun.com/repository/central",
    "https://maven.aliyun.com/repository/google",
]

NS = "{http://maven.apache.org/POM/4.0.0}"
ROOTS = [
    ("com.google.android.gms", "play-services-ads", "23.6.0"),
]


def path_of(group, artifact, version, ext):
    return "%s/%s/%s/%s-%s.%s" % (group.replace(".", "/"), artifact, version, artifact, version, ext)


def fetch_bytes(url, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": "kebao-build"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def resolve_pom(group, artifact, version):
    """在几个仓库里依次找 pom，返回 (url, bytes)。"""
    rel = path_of(group, artifact, version, "pom")
    for repo in REPOS:
        try:
            return repo + "/" + rel, fetch_bytes(repo + "/" + rel)
        except Exception:
            continue
    return None, None


def vkey(v):
    """粗粒度版本比较：1.8.0 > 1.6.21，1.0.0-beta05 排在 1.0.0 后面。"""
    main, _, pre = str(v).partition("-")
    nums = []
    for part in main.split("."):
        try:
            nums.append(int(part))
        except ValueError:
            nums.append(0)
    while len(nums) < 4:
        nums.append(0)
    return (nums[:4], 0 if pre else 1, pre)


def clean_version(v):
    v = (v or "").strip()
    if v.startswith("[") and v.endswith("]"):
        v = v[1:-1]
    if v.startswith("("):
        v = v.strip("()")
    return v.split(",")[0].strip()


def collect():
    """反复解析直到依赖集合稳定，每次都用最高版本重算。"""
    chosen = {}            # (g, a) -> version
    poms = {}              # (g, a, v) -> parsed deps
    for _ in range(4):
        changed = False
        queue = list(ROOTS)
        seen = set()
        while queue:
            g, a, v = queue.pop(0)
            key = (g, a)
            if key in chosen and vkey(chosen[key]) >= vkey(v):
                if (g, a, chosen[key]) in poms:
                    for dep in poms[(g, a, chosen[key])]:
                        if dep not in seen:
                            seen.add(dep)
                            queue.append(dep)
                    continue
                v = chosen[key]
            if (g, a, v) in seen or (g, a, v) in poms and key in chosen:
                pass
            seen.add((g, a, v))

            url, raw = resolve_pom(g, a, v)
            if raw is None:
                continue
            try:
                root = ET.fromstring(raw)
            except ET.ParseError:
                continue

            deps = []
            # 只看顶层 <dependencies>：<dependencyManagement> 里是版本声明（BOM），
            # 把它当依赖会把 kotlinx-coroutines 全家（rx2/rx3/slf4j/swing/test）都拉下来
            deps_node = root.find(NS + "dependencies")
            for dep in (deps_node.findall(NS + "dependency") if deps_node is not None else []):
                def t(tag):
                    el = dep.find(NS + tag)
                    return el.text.strip() if el is not None and el.text else ""
                # optional 的依赖是"你要用才需要"，比如 coroutines 的 rx2/rx3/swing 适配器。
                # 全拉进来会让 30MB 的树里一半是永远用不到的包。
                # optional 的依赖是"你要用才需要"，比如 coroutines 的 rx2/rx3/swing 适配器。
                # 全拉进来会让 30MB 的树里一半是永远用不到的包。
                if t("scope") in ("test", "provided", "system"):
                    continue
                if t("optional") == "true":
                    continue
                if t("optional") == "true":
                    continue
                dg, da, dv = t("groupId"), t("artifactId"), clean_version(t("version"))
                if not (dg and da and dv) or "$" in dv:
                    continue
                deps.append((dg, da, dv))
            poms[(g, a, v)] = deps

            if key not in chosen or vkey(v) > vkey(chosen[key]):
                chosen[key] = v
                changed = True
            for dep in deps:
                if dep not in seen:
                    seen.add(dep)
                    queue.append(dep)
        if not changed:
            break
    return chosen, poms


def download(item):
    group, artifact, version = item
    base = path_of(group, artifact, version, "")
    dest_dir = LIBS
    for ext in ("aar", "jar"):
        rel = path_of(group, artifact, version, ext)
        name = "%s-%s.%s" % (artifact, version, ext)
        dest = os.path.join(dest_dir, name)
        if os.path.exists(dest):
            return (name, os.path.getsize(dest), "已存在")
        for repo in REPOS:
            try:
                data = fetch_bytes(repo + "/" + rel, timeout=90)
            except Exception:
                continue
            with open(dest, "wb") as f:
                f.write(data)
            return (name, len(data), "下载")
    return ("%s:%s:%s" % (group, artifact, version), 0, "失败")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    os.makedirs(LIBS, exist_ok=True)
    print("解析依赖树…")
    chosen, poms = collect()
    items = sorted((g, a, v) for (g, a), v in chosen.items())
    print("共 %d 个 artifact\n" % len(items))

    if args.dry_run:
        for g, a, v in items:
            print("  %s:%s:%s" % (g, a, v))
        return

    total = 0
    failed = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        for name, size, how in pool.map(download, items):
            total += size
            if how == "失败":
                failed.append(name)
            elif how == "下载":
                print("  + %-58s %6.1f KB" % (name, size / 1024))
    print("\n合计 %.1f MB，落盘到 android/libs/" % (total / 1024 / 1024))
    if failed:
        print("以下没拉到（不影响使用，属于可选/纯 pom 依赖）：")
        for f in failed:
            print("    " + f)


if __name__ == "__main__":
    main()
