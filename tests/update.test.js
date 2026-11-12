/* 自动更新：版本比较、下载流程、界面状态 */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const ROOT = 'C:/Users/555/WorkBuddy/课时';

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};
const wait = ms => new Promise(r => setTimeout(r, ms));

let current = '{}';   // 当前服务端返回的清单

// 版本号从 app.js 里读，发版时不用回来改断言
const VER = (fs.readFileSync(ROOT + '/app.js', 'utf8').match(/const APP_VERSION = '([^']+)'/) || [])[1];

function dom0() {
  let html = fs.readFileSync(ROOT + '/index.html', 'utf8');
  html = html.replace(/<script[^>]*src=[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'https://kebao.local/', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.Notification = class { static permission = 'granted'; static requestPermission() { return Promise.resolve('granted'); } };
  return w;
}

/** 模拟装了 App 的安卓环境：原生侧按调用顺序把结果回调给页面。 */
function bootNative(info) {
  const w = dom0();
  const local = Object.assign({ versionName: '1.0.12', versionCode: 9, webBuild: 0, canInstall: true }, info || {});
  w.__calls = { web: null, apk: null, install: 0, perm: 0, reload: 0, installResult: 'ok' };
  w.KebaoNative = {
    platform: () => 'android',
    version: () => local.versionName,
    appInfo: () => JSON.stringify(local),
    updateCheck: () => { setTimeout(() => w.__onUpdateCheck(current, null), 0); },
    updateDownloadWeb: (u, b) => { w.__calls.web = { url: u, build: b }; },
    updateDownloadApk: (u, v) => { w.__calls.apk = { url: u, ver: v }; },
    updateInstall: () => { w.__calls.install++; return w.__calls.installResult; },
    canInstallPackages: () => local.canInstall,
    openInstallSettings: () => { w.__calls.perm++; },
    webBuild: () => local.webBuild,
    resetWebUpdate: () => { w.__calls.reset = 1; },
    reloadPage: () => { w.__calls.reload++; },
    hasNotifyPermission: () => true,
    canScheduleExact: () => true,
    requestNotifyPermission: () => {},
    openExactAlarmSettings: () => {},
    syncReminders: () => {},
    syncRemindersEcho: () => '0',
    notifyNow: () => {},
    vibrate: () => {},
    toast: () => {},
    appLabel: () => '课酬',
    saveFile: () => null,
    saveFileAs: () => {},
  };
  w.eval(fs.readFileSync(ROOT + '/app.js', 'utf8') + `
window.__api = {
  get state(){return state}, UPD, checkUpdate, openUpdateSheet, renderUpdateSheet,
  switchTab, render, localAppInfo, applyManifest, handleCheck, startUpdate
};`);
  return w;
}

/** 纯浏览器环境（无原生桥） */
function bootWeb() {
  const w = dom0();
  w.eval(fs.readFileSync(ROOT + '/app.js', 'utf8') + '\nwindow.__api = { get state(){return state}, UPD, checkUpdate, openUpdateSheet, localAppInfo };');
  return w;
}

const $ = (w, s) => w.document.querySelector(s);
const $$ = (w, s) => [...w.document.querySelectorAll(s)];
const txt = (w, s) => ($(w, s) ? $(w, s).textContent.replace(/\s+/g, ' ').trim() : '');
const sheetOpen = w => $(w, '#overlay').classList.contains('show');

const WEB_ONLY = JSON.stringify({
  versionCode: 9,
  versionName: '1.0.12',
  notes: ['修复已知问题'],
  apk: { url: 'https://x/kebao-1.0.8.apk', size: 330000 },
  web: { build: 2, name: '资源 2', url: 'https://x/www-2.zip', size: 230000, notes: ['「我的」页重排', '帮助中心补三处说明'] },
});

const APK_NEW = JSON.stringify({
  versionCode: 10,
  versionName: '1.0.12',
  notes: ['新增自动更新', '修复提醒偶发不响'],
  apk: { url: 'https://x/kebao-1.0.9.apk', size: 338000 },
  web: { build: 9, name: '资源 9', url: 'https://x/www-9.zip', size: 240000, notes: [] },
});

const NONE = JSON.stringify({
  versionCode: 9,
  versionName: '1.0.12',
  apk: { url: 'https://x/kebao-1.0.8.apk', size: 330000 },
  web: { build: 0, url: 'https://x/www.zip', size: 0, notes: [] },
});

(async () => {
  /* ------------------------------------------------------------------ */
  console.log('\n【1】手动检查：发现资源包更新');
  current = WEB_ONLY;
  let w = bootNative();
  let api = w.__api;
  api.state.settings.lastUpdateAt = Date.now();
  api.checkUpdate(false);
  ok(sheetOpen(w), '弹出更新面板');
  ok(txt(w, '#sheetTitle') === '软件更新', '面板标题', txt(w, '#sheetTitle'));
  ok(txt(w, '#sheetBody .upd-title') === '正在检查更新', '先显示检查中');

  await wait(30);
  ok(api.UPD.kind === 'web', '判定为资源包更新', api.UPD.kind);
  ok(txt(w, '#sheetBody .upd-badge') === '界面更新', '类型标签正确', txt(w, '#sheetBody .upd-badge'));
  ok(!$(w, '#sheetBody .upd-ver'), '界面更新不显示资源编号');
  ok(/当前 v1\.0\.12/.test(txt(w, '#sheetBody .upd-from')), '显示当前版本');
  const notes = $$(w, '#sheetBody .upd-notes li').map(e => e.textContent.trim());
  ok(notes.length === 2 && notes[0] === '「我的」页重排', '更新说明逐条列出', notes);
  ok(/立即更新/.test(txt(w, '#sheetFooter .btn')), '主按钮为立即更新', txt(w, '#sheetFooter .btn'));
  ok(/\d+ KB/.test(txt(w, '#sheetFooter .btn')), '按钮上带体积', txt(w, '#sheetFooter .btn'));
  ok($$(w, '#sheetFooter .btn').length === 2, '另有稍后按钮');

  /* ------------------------------------------------------------------ */
  console.log('\n【2】下载：进度回调驱动进度条');
  $(w, '#sheetFooter [data-act="upd-start"]').click();
  ok(w.__calls.web && w.__calls.web.build === 2, '把 build 号传给原生', w.__calls.web);
  ok(JSON.parse(w.__calls.web.url)[0] === 'https://x/www-2.zip', '把下载地址传给原生', w.__calls.web.url);
  ok(api.UPD.phase === 'download', '进入下载中状态');

  w.__onUpdateProgress('web', 42);
  ok(/width:\s*42%/.test($(w, '#sheetBody .upd-bar i').getAttribute('style')), '进度条宽度 42%');
  ok(/42%/.test(txt(w, '#sheetBody .upd-pct')), '显示百分比', txt(w, '#sheetBody .upd-pct'));
  ok($(w, '#sheetFooter .btn').disabled, '下载中主按钮不可点');

  w.__onUpdateProgress('apk', 88);
  ok(api.UPD.pct === 42, '忽略非当前类型的进度', api.UPD.pct);

  /* ------------------------------------------------------------------ */
  console.log('\n【3】资源包下载完成：重启生效');
  w.__onUpdateResult('web', true, '');
  ok(api.UPD.phase === 'ready', '进入就绪状态');
  ok(/重启生效/.test(txt(w, '#sheetFooter .btn')), '主按钮变为重启生效', txt(w, '#sheetFooter .btn'));
  ok(/重启一下就生效/.test(txt(w, '#sheetBody')), '提示需重启');
  $(w, '#sheetFooter [data-act="upd-reload"]').click();
  ok(w.__calls.reload === 1, '触发页面重载');

  /* ------------------------------------------------------------------ */
  console.log('\n【4】整包更新优先于资源包');
  current = APK_NEW;
  w = bootNative();
  api = w.__api;
  api.state.settings.lastUpdateAt = Date.now();
  api.checkUpdate(false);
  await wait(30);
  ok(api.UPD.kind === 'apk', '有新安装包时选整包', api.UPD.kind);
  ok(txt(w, '#sheetBody .upd-badge') === '新版本', '类型标签为新版本');
  ok(txt(w, '#sheetBody .upd-ver') === 'v1.0.12', '版本号带 v 前缀', txt(w, '#sheetBody .upd-ver'));
  ok(/当前 v1\.0\.12/.test(txt(w, '#sheetBody .upd-from')), '写明当前版本');
  ok(/330 KB/.test(txt(w, '#sheetFooter .btn')), '显示安装包体积');

  $(w, '#sheetFooter [data-act="upd-start"]').click();
  ok(w.__calls.apk && w.__calls.apk.ver === '1.0.12', '把版本名传给原生', w.__calls.apk);
  w.__onUpdateProgress('apk', 100);
  w.__onUpdateResult('apk', true, '/data/app/kebao-1.0.9.apk');
  ok(api.UPD.phase === 'ready', '下载完进入就绪');
  ok(/安装/.test(txt(w, '#sheetFooter .btn')), '主按钮为安装', txt(w, '#sheetFooter .btn'));
  $(w, '#sheetFooter [data-act="upd-install"]').click();
  ok(w.__calls.install === 1, '调起原生安装');

  /* ------------------------------------------------------------------ */
  console.log('\n【5】缺少「安装未知应用」权限');
  w = bootNative({ canInstall: false });
  api = w.__api;
  w.__calls.installResult = 'need-permission';
  api.state.settings.lastUpdateAt = Date.now();
  current = APK_NEW;
  api.checkUpdate(false);
  await wait(30);
  $(w, '#sheetFooter [data-act="upd-start"]').click();
  w.__onUpdateResult('apk', true, '');
  $(w, '#sheetFooter [data-act="upd-install"]').click();
  ok(w.__calls.perm === 1, '自动跳去授权页');
  ok(/允许「安装未知应用」/.test(txt(w, '#toastWrap')), '提示如何授权', txt(w, '#toastWrap'));

  /* ------------------------------------------------------------------ */
  console.log('\n【6】没有新版本');
  current = NONE;
  w = bootNative();
  api = w.__api;
  api.state.settings.lastUpdateAt = Date.now();
  api.checkUpdate(false);
  await wait(30);
  ok(api.UPD.kind === '', '不判定为有更新');
  ok(api.UPD.phase === 'uptodate', '进入已是最新状态', api.UPD.phase);
  ok(/已是最新版本/.test(txt(w, '#sheetBody .upd-title')), '面板提示已是最新');
  ok(/重新检查/.test(txt(w, '#sheetFooter')), '按钮为重新检查');
  ok($$(w, '#sheetFooter .btn').length === 2, '底部仍有重新检查与关闭');
  ok(!/服务器上最新|CDN|比本机还旧/.test(txt(w, '#sheetBody')), '不向普通用户展示版本诊断');

  /* ------------------------------------------------------------------ */
  console.log('\n【7】检查失败');
  w = bootNative();
  api = w.__api;
  api.state.settings.lastUpdateAt = Date.now();
  api.checkUpdate(false);
  w.__onUpdateCheck(null, '连接超时');
  ok(api.UPD.phase === 'error', '进入错误状态', api.UPD.phase);
  ok(/检查失败/.test(txt(w, '#sheetBody .upd-title')), '标题为检查失败');
  ok(/连接超时/.test(txt(w, '#sheetBody')), '显示具体原因');
  ok(/重试/.test(txt(w, '#sheetFooter')), '提供重试按钮');
  ok(/检查失败不会影响使用/.test(txt(w, '#sheetBody')), '说明不影响本地数据', txt(w, '#sheetBody'));

  /* ------------------------------------------------------------------ */
  console.log('\n【8】后台静默检查不打扰');
  current = WEB_ONLY;
  w = bootNative();
  api = w.__api;
  ok(!sheetOpen(w), '启动时不弹面板');
  api.state.settings.lastUpdateAt = Date.now();
  api.checkUpdate(true);
  await wait(30);
  ok(!sheetOpen(w), '静默检查不弹面板');
  ok(api.UPD.kind === 'web', '但已记下待更新');
  api.switchTab('home');
  ok($(w, '.upd-tip'), '首页出现更新提示条');
  ok(/界面有更新/.test(txt(w, '.upd-tip')), '提示条文案', txt(w, '.upd-tip'));
  ok(/重启后生效/.test(txt(w, '.upd-tip')), '说明是界面更新');

  $(w, '.upd-tip').click();
  ok(sheetOpen(w), '点提示条打开面板');
  ok(api.state.settings.updateSeen === '资源 2', '记录已查看', api.state.settings.updateSeen);
  w.document.querySelector('#sheetFooter [data-close]').click();
  api.switchTab('home');
  ok(!$(w, '.upd-tip'), '看过之后提示条不再出现');

  /* ------------------------------------------------------------------ */
  console.log('\n【9】静默检查失败完全无声');
  w = bootNative();
  api = w.__api;
  api.state.settings.lastUpdateAt = Date.now();
  api.checkUpdate(true);
  w.__onUpdateCheck(null, '无法连接更新服务器');
  ok(!sheetOpen(w), '不弹任何面板');
  ok(api.UPD.phase !== 'error', '不进入错误态', api.UPD.phase);

  /* ------------------------------------------------------------------ */
  console.log('\n【10】清单异常与浏览器降级');
  w = bootNative();
  api = w.__api;
  api.state.settings.lastUpdateAt = Date.now();
  api.checkUpdate(false);
  w.__onUpdateCheck('<html>404</html>', null);
  ok(api.UPD.phase === 'error', 'HTML 当成清单时进入错误态');
  ok(/更新信息不完整/.test(txt(w, '#sheetBody')), '提示清单格式有问题', txt(w, '#sheetBody .upd-sub'));

  // 浏览器里版本号取 MAX，任何清单都不会提示换整包
  const bw = bootWeb();
  const bi = bw.__api.localAppInfo();
  ok(bi.versionCode === Number.MAX_SAFE_INTEGER, '浏览器环境不提示整包', bi.versionCode);
  ok(bw.__api.localAppInfo().versionName === VER, '版本名仍取自常量', bw.__api.localAppInfo().versionName);

  /* ------------------------------------------------------------------ */
  console.log('\n【11】版本行接的是真检查');
  w = bootNative();
  api = w.__api;
  current = WEB_ONLY;
  api.state.settings.lastUpdateAt = Date.now();
  api.switchTab('mine');
  ok(!$(w, '#page-mine [data-act="open-help"][data-h="about"]').textContent.match(/检查更新/), '关于格里不再重复放置检查更新');
  const verRow = $(w, '#page-mine .mine-foot .ver');
  ok(new RegExp('v' + VER.replace(/\./g, '\\.') + ' · 检查更新').test(verRow.textContent), '版本行写明可检查更新', verRow.textContent.trim());
  verRow.click();
  await wait(30);
  ok(txt(w, '#sheetTitle') === '软件更新', '点击后切到更新面板', txt(w, '#sheetTitle'));
  ok(api.UPD.kind === 'web', '并真的完成了检查');

  /* ------------------------------------------------------------------ */
  console.log('\n【12】已下载过的资源包再检查时不重复提示');
  current = JSON.stringify({
    versionCode: 9, versionName: '1.0.12',
    apk: { url: '', size: 0 },
    web: { build: 2, url: 'https://x/www-2.zip', size: 1, notes: [] },
  });
  w = bootNative({ webBuild: 2 });
  api = w.__api;
  api.state.settings.lastUpdateAt = Date.now();
  api.checkUpdate(false);
  await wait(30);
  ok(api.UPD.kind === '', '本地资源号已追上，不再提示', api.UPD.kind);

  console.log(`\n=== 通过 ${pass} / 失败 ${fail} ===`);
  process.exit(fail ? 1 : 0);
})();
