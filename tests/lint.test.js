/* 源码约定检查：前端调用的原生方法，安装包里必须真的有 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (c, n, e) => c ? (pass++, console.log('  ✓ ' + n))
                          : (fail++, console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')));

const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const bridgePath = path.join(ROOT, 'android/app/src/main/java/com/kebao/lessonpay/WebBridge.java');
const bridge = fs.readFileSync(bridgePath, 'utf8');

console.log('\n【1】原生对象只能用项目约定的名字');
// 注入名是 "KebaoNative"，前端通过 NATIVE 常量访问。
// 写成 window.Native 的话永远是 undefined —— 线上真出过：同步页一直显示"网页版没有局域网能力"。
const wrongRef = [...app.matchAll(/window\.Native\b/g)];
ok(wrongRef.length === 0, '没有 window.Native 这种写法（应为 NATIVE / window.KebaoNative）', wrongRef.length);
ok(/const NATIVE = \(typeof window\.KebaoNative/.test(app), 'NATIVE 常量仍从 KebaoNative 取');

console.log('\n【2】注入名与前端约定一致');
const javaName = (/addJavascriptInterface\([^,]+,\s*"([^"]+)"/.exec(
  fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/kebao/lessonpay/MainActivity.java'), 'utf8')
) || [])[1];
ok(javaName === 'KebaoNative', 'MainActivity 注入名是 KebaoNative', javaName);
ok(app.includes(`window.${javaName}`), '前端用的是同一个名字', javaName);

console.log('\n【3】前端用到的每个原生方法，WebBridge 里都要有');
const used = new Set(
  [...app.matchAll(/\bNATIVE\.([a-zA-Z_][a-zA-Z0-9_]*)/g)].map(m => m[1])
);
// @JavascriptInterface 与方法声明之间可能翻行，放宽到 120 个字符
const exposed = new Set(
  [...bridge.matchAll(/@JavascriptInterface[\s\S]{0,120}?public\s+[\w.<>\[\]]+\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)]
    .map(m => m[1])
);
ok(used.size > 0, '确实扫到了前端调用', used.size);
const missing = [...used].filter(k => !exposed.has(k));
ok(missing.length === 0, '没有"前端调了、原生没有"的方法', missing);

console.log('\n【4】局域网那一组方法必须齐全');
// 缺一个的症状不是报错，而是"点一下没反应"，比报错更难查
const lanNeed = ['lanStart', 'lanStop', 'lanPublish', 'lanScanStart', 'lanScanResult',
  'lanSyncStart', 'lanSyncPoll', 'lanInbox'];
const lanMissing = lanNeed.filter(k => !exposed.has(k));
ok(lanMissing.length === 0, '八个局域网方法都在 WebBridge 里', lanMissing);
const lanUnused = lanNeed.filter(k => !used.has(k));
ok(lanUnused.length === 0, '这八个方法前端都真的在用（不是死代码）', lanUnused);

console.log('\n【5】能力探测覆盖所有前端会调的原生方法');
// nativeInfo() 决定"要不要提示用户更新安装包"，名单必须和实际调用对得上
const probeBlock = (/function nativeInfo\(\)[\s\S]*?\n}/.exec(app) || [''])[0];
ok(probeBlock.length > 0, '找到了 nativeInfo');
const lanProbed = ['lanStart', 'lanScanStart', 'lanSyncStart', 'lanInbox'].filter(k => probeBlock.includes(k));
ok(lanProbed.length === 4, '四个关键方法都参与探测', lanProbed);

console.log('\n【6】每次新增原生调用都要有降级路径');
// 用到局域网方法的地方，都应该先过 hasLan()
const lanCallSites = [...app.matchAll(/\bNATIVE\.(lanScanStart|lanSyncStart|lanInbox|lanStart)\(/g)];
ok(lanCallSites.length > 0, '有局域网调用点', lanCallSites.length);
const guardCount = (app.match(/hasLan\(\)/g) || []).length;
ok(guardCount >= 3, '至少三处做了 hasLan 保护', guardCount);

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
