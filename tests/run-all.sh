#!/usr/bin/env bash
# 跑一遍全部前端测试：node tests/run-all.sh
# 依赖 jsdom（全局装过即可：npm i -g jsdom）
set -u
cd "$(dirname "$0")"

fail=0
for f in *.test.js; do
  printf '%-18s' "${f%.test.js}"
  if out=$(node "$f" 2>&1); then
    echo "$out" | grep -E "通过" | tail -1
  else
    echo "有失败"
    echo "$out" | grep "✗" | head -5 | sed 's/^/                   /'
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then echo; echo "全部通过"; else echo; echo "有失败的套件，见上"; fi
exit $fail
