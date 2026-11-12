/* 更新源容错：国内 raw 被污染时的多地址回退、错误提示、自定义源 */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const ROOT = 'C:/Users/555/WorkBuddy/课时';

let pass = 0, fail = 0;
const ok = (c, n, e) => c ? (pass++, console.log('  ✓ ' + n))
                          : (fail++, console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));

const MANIFEST = JSON.stringify({
  versionCode: 12, versionName: '1.0.12',
  notes: ['修复检查更新', '多地址回退'],
  apk: {
    url: 'https://github.com/user269/kechou/releases/download/v1.0.12/kebao-1.0.11.apk',
    size: 353527,
    mirrors: ['https://cdn.jsdelivr.net/gh/user269/kechou@v1.0.12/apk/kebao-1.0.11.apk'],
  },
  web: { build: 0, url: '', size: 0, notes: [] },
});

function boot(info) {
  let html = fs.readFileSync(ROOT + '/index.html', 'utf8')
    .replace(/<script[^>]*src=[^>]*><\/script>/g, '');
  const w = new JSDOM(html, { url: 'https://kebao.local/', runScripts: 'dangerously', pretendToBeVisual: true }).window;
  w.Notification = class { static permission = 'granted'; static requestPermission() { return Promise.resolve('granted'); } };
  const local = Object.assign({ versionName: '1.0.12', versionCode: 12, webBuild: 0, canInstall: true }, info);
  w.__calls = { checkUrls: null, apk: null, web: null };
  w.KebaoNative = {
    platform: () => 'android',
    version: () => local.versionName,
    appInfo: () => JSON.stringify(local),
    updateCheck: urls => { w.__calls.checkUrls = urls; w.__checkReply = true; },
    updateDownloadWeb: (u, b) => { w.__calls.web = { u, b }; },
    updateDownloadApk: (u, v) => { w.__calls.apk = { u, v }; },
    updateInstall: () => 'ok',
    canInstallPackages: () => true,
    openInstallSettings: () => {},
    webBuild: () => local.webBuild,
    resetWebUpdate: () => {},
    reloadPage: () => {},
    hasNotifyPermission: () => true,
    canScheduleExact: () => true,
    requestNotifyPermission: () => {},
    openExactAlarmSettings: () => {},
    syncReminders: () => {},
    syncRemindersEcho: () => '0',
    notifyNow: () => {}, vibrate: () => {}, toast: () => {},
    appLabel: () => '课酬', saveFile: () => null, saveFileAs: () => {},
  };
  w.eval(fs.readFileSync(ROOT + '/app.js', 'utf8')
    + '\nwindow.__api={get state(){return state},UPD,checkUpdate,openUpdateSheet,openUpdateSource,'
    + 'saveUpdateSource,manifestSources,mirrorUrls,friendlyUpdateError,handleCheck};');
  return w;
}
const $ = (w, s) => w.document.querySelector(s);
const txt = (w, s) => ($(w, s) ? $(w, s).textContent.replace(/\s+/g, ' ').trim() : '');

(async () => {
  console.log('\n【1】默认会准备多个清单地址');
  let w = boot();
  const srcs = w.__api.manifestSources();
  ok(srcs.length >= 3, '内置至少 3 个候选地址', srcs.length);
  ok(/raw\.githubusercontent\.com/.test(srcs[0]), 'raw 排第一（被污染时立即失败，不拖累后面）', srcs[0]);
  ok(srcs.some(u => /cdn\.jsdelivr\.net/.test(u)), '包含 jsDelivr 备用');
  ok(srcs.some(u => /ghfast\.top/.test(u)), '包含反代备用');

  console.log('\n【2】检查更新时把候选列表交给原生');
  w.__api.checkUpdate(false);
  ok(!!w.__calls.checkUrls, '调用了原生检查');
  const sent = JSON.parse(w.__calls.checkUrls);
  ok(Array.isArray(sent) && sent.length === srcs.length, '传的是完整数组', sent.length);
  ok(sent[0] === srcs[0], '顺序一致');

  console.log('\n【3】原生从第三个地址拿到清单 → 记录来源');
  w.__onUpdateCheck(MANIFEST, null, srcs[2]);
  await wait(20);
  ok(w.__api.UPD.source === srcs[2], '记录命中的地址', w.__api.UPD.source);
  ok(w.__api.UPD.kind === '', '同版本不提示更新', w.__api.UPD.kind);
  ok(!!w.__api.state.settings.updateCache, '缓存了最近的清单');
  ok(w.__api.state.settings.lastUpdateOk > 0, '记录了成功时间');

  console.log('\n【4】被墙时的错误提示要说人话');
  w = boot({ versionCode: 11 });
  w.__api.checkUpdate(false);
  w.__onUpdateCheck(null, 'ConnectException: Failed to connect to raw.githubusercontent.com/0.0.0.0:443（已试 4 个地址）', '');
  await wait(20);
  const errTxt = txt(w, '#sheetBody .upd-sub');
  ok(/网络限制|换个网络|流量/.test(errTxt), '用大白话提示网络问题', errTxt);
  ok(!/ConnectException/.test(errTxt), '不直接把 Java 异常甩给用户', errTxt);
  ok(/不会影响使用/.test(txt(w, '#sheetBody')), '说明数据不受影响');

  console.log('\n【5】失败时给出换地址的出路（收在正文里，不占底部按钮）');
  ok(w.document.querySelectorAll('#sheetFooter .btn').length === 2 && /关闭/.test(txt(w, '#sheetFooter')), '底部只留重试与关闭', txt(w, '#sheetFooter'));
  const alt = $(w, '#sheetBody .upd-alt');
  ok(!!alt, '正文里有一行轻量入口');
  alt.click();
  await wait(20);
  ok(txt(w, '#sheetTitle') === '换个更新地址', '打开换地址面板', txt(w, '#sheetTitle'));
  ok(!!$(w, '#upd-src'), '有地址输入框');
  const fold = $(w, '#sheetBody .src-fold');
  ok(!!fold && !fold.open, '内置地址默认折叠，不糊一屏 URL');
  ok(/内置地址/.test(fold.textContent), '折叠区写明是内置地址');
  fold.open = true;
  ok(/raw\.githubusercontent\.com/.test(txt(w, '#sheetBody')), '展开后能看到内置地址');

  console.log('\n【6】保存自定义源后立刻重试，并排在最前');
  $(w, '#upd-src').value = 'https://mirror.example.com/update.json';
  $(w, '#sheetFooter [data-act="upd-save-src"]').click();
  await wait(220);
  ok(w.__api.state.settings.updateSource === 'https://mirror.example.com/update.json', '自定义源已保存');
  const after = JSON.parse(w.__calls.checkUrls || '[]');
  ok(after[0] === 'https://mirror.example.com/update.json', '自定义源排在最前', after[0]);

  console.log('\n【7】非法地址不让保存');
  w = boot();
  w.__api.checkUpdate(false);
  w.__onUpdateCheck(null, '连接超时', '');
  await wait(20);
  $(w, '#sheetBody .upd-alt').click();
  await wait(20);
  $(w, '#upd-src').value = 'ftp://bad';
  $(w, '#sheetFooter [data-act="upd-save-src"]').click();
  await wait(20);
  ok(w.__api.state.settings.updateSource === '', '拒绝非 http 地址');
  ok(/http/.test(txt(w, '#toastWrap')), '提示地址格式', txt(w, '#toastWrap'));

  console.log('\n【8】恢复默认');
  w.__api.state.settings.updateSource = 'https://mine/x.json';
  $(w, '#upd-src') && (w.document.querySelector('#upd-src').value = 'https://mine/x.json');
  w.__api.checkUpdate(false);
  w.__onUpdateCheck(null, '连接超时', '');
  await wait(20);
  $(w, '#sheetBody .upd-alt').click();
  await wait(20);
  $(w, '#sheetBody [data-act="upd-clear-src"]').click();
  await wait(20);
  ok(w.__api.state.settings.updateSource === '', '清空自定义源');

  console.log('\n【9】下载时按顺序试镜像，jsDelivr 排在最前');
  w = boot({ versionCode: 11 });
  w.__api.checkUpdate(false);
  w.__onUpdateCheck(MANIFEST, null, 'https://x/update.json');
  await wait(20);
  ok(w.__api.UPD.kind === 'apk', '识别为整包更新', w.__api.UPD.kind);
  const urls = w.__api.UPD.urls;
  ok(urls[0].indexOf('cdn.jsdelivr.net') >= 0, '清单里的镜像优先（国内先通）', urls[0]);
  ok(urls.some(u => /releases\/download/.test(u)), '原始直链仍在候选里');
  ok(urls.some(u => /ghfast\.top/.test(u)), '自动补了反代前缀');
  $(w, '#sheetFooter [data-act="upd-start"]').click();
  await wait(20);
  const dl = JSON.parse(w.__calls.apk.u);
  ok(dl[0] === urls[0] && dl.length === urls.length, '把整个候选列表交给原生', dl.length);

  console.log('\n【10】浏览器环境：逐个源重试');
  let html = fs.readFileSync(ROOT + '/index.html', 'utf8').replace(/<script[^>]*src=[^>]*><\/script>/g, '');
  const bw = new JSDOM(html, { url: 'https://kebao.local/', runScripts: 'dangerously', pretendToBeVisual: true }).window;
  bw.Notification = class { static permission = 'granted'; static requestPermission() { return Promise.resolve('granted'); } };
  let n = 0;
  bw.fetch = () => {
    n++;
    if (n < 3) return Promise.reject(new Error('Failed to connect to 0.0.0.0'));
    return Promise.resolve({ ok: true, text: () => Promise.resolve(MANIFEST) });
  };
  bw.eval(fs.readFileSync(ROOT + '/app.js', 'utf8') + '\nwindow.__api={get state(){return state},UPD,checkUpdate};');
  bw.__api.checkUpdate(true);
  await wait(120);
  ok(n === 5, '五个地址同时尝试', n);
  ok(bw.__api.UPD.phase === 'uptodate', '最终拿到清单', bw.__api.UPD.phase);

  console.log(`\n=== 通过 ${pass} / 失败 ${fail} ===`);
  process.exit(fail ? 1 : 0);
})();
