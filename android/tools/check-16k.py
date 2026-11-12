#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""检查 APK 是否满足 16KB 页大小要求。

Android 15 起，运行在 16KB 页设备上的应用必须满足：
  1. lib/<abi>/*.so 以「不压缩」方式存储；
  2. 每个 .so 在 APK 内的起始偏移按 16KB 对齐（zipalign -P 16 负责）；
  3. .so 自身的 PT_LOAD 段 p_align >= 16384（编译时就决定了，链接时要
     -Wl,-z,max-page-size=16384；拿到的第三方 .so 不合规只能找厂商换）。

没有任何 .so 的包天然合规，脚本会明确说明「跳过」。

用法：
    python tools/check-16k.py build/xxx.apk
    python tools/check-16k.py build/xxx.apk --zipalign /path/to/zipalign.exe
"""
import struct
import subprocess
import sys
import zipfile

PAGE = 16384
PT_LOAD = 1


def elf_load_alignments(data):
    """返回所有 PT_LOAD 段的 p_align。"""
    if len(data) < 64 or data[:4] != b'\x7fELF':
        return None
    ei_class = data[4]
    ei_data = data[5]
    endian = '<' if ei_data == 1 else '>'
    out = []
    if ei_class == 2:                      # 64 位
        e_phoff = struct.unpack_from(endian + 'Q', data, 0x20)[0]
        e_phentsize = struct.unpack_from(endian + 'H', data, 0x36)[0]
        e_phnum = struct.unpack_from(endian + 'H', data, 0x38)[0]
        for i in range(e_phnum):
            off = e_phoff + i * e_phentsize
            if off + 56 > len(data):
                break
            p_type = struct.unpack_from(endian + 'I', data, off)[0]
            if p_type == PT_LOAD:
                out.append(struct.unpack_from(endian + 'Q', data, off + 48)[0])
    elif ei_class == 1:                    # 32 位
        e_phoff = struct.unpack_from(endian + 'I', data, 0x1C)[0]
        e_phentsize = struct.unpack_from(endian + 'H', data, 0x2A)[0]
        e_phnum = struct.unpack_from(endian + 'H', data, 0x2C)[0]
        for i in range(e_phnum):
            off = e_phoff + i * e_phentsize
            if off + 32 > len(data):
                break
            p_type = struct.unpack_from(endian + 'I', data, off)[0]
            if p_type == PT_LOAD:
                out.append(struct.unpack_from(endian + 'I', data, off + 28)[0])
    return out


def data_offset(zf, info):
    """未压缩数据在文件中的真实偏移（要跳过变长的 local header）。"""
    with open(zf.filename, 'rb') as fh:
        fh.seek(info.header_offset)
        head = fh.read(30)
        if len(head) < 30 or head[:4] != b'PK\x03\x04':
            return -1
        name_len = struct.unpack_from('<H', head, 26)[0]
        extra_len = struct.unpack_from('<H', head, 28)[0]
        return info.header_offset + 30 + name_len + extra_len


def main():
    if len(sys.argv) < 2:
        print('用法：python tools/check-16k.py <apk> [--zipalign <path>]')
        return 2

    apk = sys.argv[1]
    zipalign = None
    if '--zipalign' in sys.argv:
        zipalign = sys.argv[sys.argv.index('--zipalign') + 1]

    bad = []
    checked = 0

    with zipfile.ZipFile(apk) as zf:
        for info in zf.infolist():
            name = info.filename
            if not (name.startswith('lib/') and name.endswith('.so')):
                continue
            checked += 1

            if info.compress_type != zipfile.ZIP_STORED:
                bad.append('%s 被压缩了（extractNativeLibs=false 时必须 STORED）' % name)
                continue

            off = data_offset(zf, info)
            if off < 0 or off % PAGE != 0:
                bad.append('%s 在包内偏移 %d，未按 16KB 对齐' % (name, off))

            aligns = elf_load_alignments(zf.read(name))
            if aligns is None:
                bad.append('%s 不是有效的 ELF 文件' % name)
            else:
                worst = min(aligns) if aligns else 0
                if worst < PAGE:
                    bad.append('%s 的 PT_LOAD 只按 %d 字节对齐，需要 >= %d'
                               '（链接时加 -Wl,-z,max-page-size=16384）'
                               % (name, worst, PAGE))

    if checked == 0:
        print('16KB 检查：包里没有原生库（.so），天然合规')
    else:
        print('16KB 检查：检查了 %d 个 .so' % checked)

    if zipalign:
        p = subprocess.run([zipalign, '-c', '-P', '16', '4', apk],
                           capture_output=True, text=True)
        if p.returncode != 0:
            bad.append('zipalign -c -P 16 未通过：'
                       + (p.stdout or '').strip() + (p.stderr or '').strip())
        else:
            print('16KB 检查：zipalign -c -P 16 通过')

    if bad:
        print('\n不合规项：')
        for b in bad:
            print('  ✗ ' + b)
        return 1

    print('16KB 检查：全部通过')
    return 0


if __name__ == '__main__':
    sys.exit(main())
