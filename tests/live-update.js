/* 真实网络校验：拿线上清单，确认版本号与下载地址都可用。
   不属于日常回归（run-all 只跑 *.test.js），发版后手动执行：
   node tests/live-update.js */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};

(async () => {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  html = html.replace(/<script[^>]*src=[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'https://kebao.local/', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.Notification = class { static permission = 'granted'; static requestPermission() { return Promise.resolve('granted'); } };
  // 不注入 KebaoNative：走浏览器的并发拉取分支，测的正是 checkUpdate 本身
  w.fetch = (url, opt) => globalThis.fetch(url, Object.assign({}, opt, { signal: AbortSignal.timeout(12000) }))
    .then(r => ({ ok: r.ok, status: r.status, text: () => r.text() }));
  w.eval(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8') + `
window.__api = { get state(){return state}, UPD, checkUpdate, manifestSources };`);

  const api = w.__api;
  const sources = api.manifestSources();
  ok(sources.length >= 4, '内置多个清单地址', sources.length);

  api.checkUpdate(true);
  await new Promise(r => setTimeout(r, 14000));

  const U = api.UPD;
  ok(!!U.source, '至少有一个地址连通', U.source);
  ok(Number(U.remoteCode) >= 20, '线上 versionCode ≥ 20', U.remoteCode);
  ok(U.remoteName === '1.0.19', '线上版本名 1.0.19', U.remoteName);

  const cache = api.state.settings.updateCache;
  const man = cache && cache.body ? JSON.parse(cache.body) : {};
  const mirrors = (man.apk && man.apk.mirrors) || [];
  ok(mirrors.length >= 2, '清单里有多个下载镜像', mirrors.length);
  ok(mirrors.every(u => String(u).startsWith('https://')), '下载地址都是 https');
  ok(!mirrors.some(u => /cdn\.jsdelivr\.net/.test(u)), '下载地址不含会重定向到 raw 的 jsDelivr');
  ok(Number(man.apk && man.apk.size) > 300000, '安装包大小合理', man.apk && man.apk.size);

  console.log('\n  清单来源：' + U.source);
  mirrors.forEach((u, i) => console.log(`  ${i + 1}. ${u.slice(0, 96)}`));

  // 真下第一块，确认镜像不是 404
  try {
    const r = await fetch(mirrors[0], { headers: { Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(20000) });
    ok(r.status === 200 || r.status === 206, '镜像能下到字节', r.status);
  } catch (e) {
    ok(false, '镜像能下到字节', String(e && e.message));
  }

  console.log(`\n=== 通过 ${pass} / 失败 ${fail} ===`);
  process.exit(fail ? 1 : 0);
})();
