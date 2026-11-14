#!/usr/bin/env python3
"""把 libs/ 里各 AAR 的清单声明合并进主清单。

Gradle 有 manifest merger，手写构建链没有。缺了声明的后果不是编译报错，
而是运行时 ActivityNotFoundException / 广告加载失败——很难查。

这里只做「加法」：把 AAR 里的权限、组件、meta-data 补进主清单。
主清单已有的同名项不覆盖（以主清单为准），冲突时打印提醒。

用法：python tools/merge-manifests.py <主清单> <AAR解压目录根> <输出清单>
"""

import os
import sys
import xml.etree.ElementTree as ET

ANDROID_NS = "http://schemas.android.com/apk/res/android"
TOOLS_NS = "http://schemas.android.com/tools"
ET.register_namespace("android", ANDROID_NS)
ET.register_namespace("tools", TOOLS_NS)

A = "{%s}" % ANDROID_NS

# 只合这些：权限、组件、meta-data、uses-library
APP_CHILDREN = ("activity", "activity-alias", "service", "receiver", "provider",
                "meta-data", "uses-library", "uses-native-library")


def name_of(el):
    return el.get(A + "name") or el.get(A + "authorities") or ""


def collect(aar_root):
    """遍历解压目录，收集所有 AndroidManifest.xml 里的声明。"""
    perms, features, comps, app_attrs = [], [], [], []
    if not os.path.isdir(aar_root):
        return perms, features, comps, app_attrs

    for dirpath, _, files in os.walk(aar_root):
        if "AndroidManifest.xml" not in files:
            continue
        path = os.path.join(dirpath, "AndroidManifest.xml")
        try:
            root = ET.parse(path).getroot()
        except Exception as e:
            print("    跳过（解析失败）：%s %s" % (path, e))
            continue
        lib = os.path.basename(dirpath)

        for el in root.findall("uses-permission"):
            n = name_of(el)
            if n:
                perms.append((n, lib))
        for el in root.findall("uses-feature"):
            n = name_of(el)
            if n:
                features.append((n, lib))

        app = root.find("application")
        if app is None:
            continue
        for child in app:
            tag = child.tag
            if tag not in APP_CHILDREN:
                continue
            comps.append((tag, name_of(child), child, lib))
    return perms, features, comps, app_attrs


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        return 1
    main_manifest, aar_root, out_path = sys.argv[1:4]
    pkg = os.environ.get("APP_PACKAGE", "com.kebao.lessonpay")

    tree = ET.parse(main_manifest)
    root = tree.getroot()
    app = root.find("application")
    if app is None:
        print("主清单里没有 <application>")
        return 1

    existing_perms = {name_of(e) for e in root.findall("uses-permission")}
    existing_comps = {}
    for child in app:
        existing_comps[(child.tag, name_of(child))] = child

    perms, features, comps, _ = collect(aar_root)

    added_p = added_c = 0
    for n, lib in perms:
        if n in existing_perms:
            continue
        el = ET.SubElement(root, "uses-permission")
        el.set(A + "name", n)
        existing_perms.add(n)
        added_p += 1
        print("    + 权限 %s（来自 %s）" % (n, lib))

    for n, lib in features:
        if any(name_of(e) == n for e in root.findall("uses-feature")):
            continue
        el = ET.SubElement(root, "uses-feature")
        el.set(A + "name", n)
        el.set(A + "required", "false")
        print("    + 特性 %s（来自 %s）" % (n, lib))

    for tag, name, node, lib in comps:
        key = (tag, name)
        if key in existing_comps:
            continue
        # ${applicationId} 占位符必须换成真实包名，否则 provider 授权会撞
        clone = _clone(node, pkg)
        app.append(clone)
        existing_comps[key] = clone
        added_c += 1
        print("    + 组件 <%s %s>（来自 %s）" % (tag, name, lib))

    tree.write(out_path, encoding="utf-8", xml_declaration=True)
    print("    合并完成：+%d 权限 / +%d 组件 → %s" % (added_p, added_c, out_path))
    return 0


def _clone(node, pkg):
    """复制节点并把 ${applicationId} 换掉。"""
    new = ET.Element(node.tag, dict(node.attrib))
    for k, v in list(new.attrib.items()):
        if "${applicationId}" in v:
            new.set(k, v.replace("${applicationId}", pkg))
    for child in node:
        new.append(_clone(child, pkg))
    if node.text and node.text.strip():
        new.text = node.text
    return new


if __name__ == "__main__":
    sys.exit(main())
