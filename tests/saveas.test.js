/* 导出自选保存路径 */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const ROOT = 'C:/Users/555/WorkBuddy/课时';

let pass = 0, fail = 0;
const ok = (c, n, e) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''))); };

const html = fs.readFileSync(ROOT + '/index.html', 'utf8').replace(/<script[^>]*src=[^>]*><\/script>/g, '');

const baseNative = {
  platform: () => 'android',
  version: () => '1.0.4',
  appLabel: () => '课酬',
  hasNotifyPermission: () => true,
  requestNotifyPermission: () => {},
  canScheduleExact: () => true,
  openExactAlarmSettings: () => {},
  notifyNow: () => {},
  syncReminders: () => {},
  syncRemindersEcho: () => '0',
  vibrate: () => {},
  toast: () => {},
};

function boot(native) {
  const dom = new JSDOM(html, { url: 'https://kebao.local/', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.Notification = class { static permission = 'granted'; static requestPermission() { return Promise.resolve('granted'); } };
  if (native) w.KebaoNative = native;
  w.eval(fs.readFileSync(ROOT + '/app.js', 'utf8') + `
window.__api = { exportData, get state(){return state}, switchTab };`);
  return { w, api: w.__api, D: w.document };
}
const toastText = D => [...D.querySelectorAll('#toastWrap .toast')].map(x => x.textContent.trim()).pop() || '';

console.log('\n【1】安卓：走系统「保存到」界面');
const calls = [];
const { w, api, D } = boot({
  ...baseNative,
  saveFileAs: (name, content, mime) => { calls.push({ name, content, mime }); },
  saveFile: () => { calls.push({ legacy: true }); return null; },
});
ok(typeof w.__onSaveAsResult === 'undefined', '导出前还没有挂回调');
api.exportData();
ok(calls.length === 1 && !calls[0].legacy, '调用 saveFileAs 而不是旧的 saveFile', calls);
ok(calls[0] && /^课酬备份_\d{4}-\d{2}-\d{2}\.json$/.test(calls[0].name), '文件名带日期', calls[0] && calls[0].name);
ok(calls[0] && calls[0].mime === 'application/json', 'MIME 正确', calls[0] && calls[0].mime);
ok(calls[0] && JSON.parse(calls[0].content).lessons.length === api.state.lessons.length, '内容是可解析的完整备份');
ok(typeof w.__onSaveAsResult === 'function', '挂上了结果回调');

console.log('\n【2】保存成功的提示');
w.__onSaveAsResult(true, '课酬备份_2026-11-10.json');
ok(/已保存到所选位置/.test(toastText(D)), '提示「已保存到所选位置」', toastText(D));
ok(w.__onSaveAsResult === null, '回调用完即清，不会误触发');

console.log('\n【3】取消与失败');
api.exportData();
w.__onSaveAsResult(false, 'canceled');
ok(/已取消保存/.test(toastText(D)), '取消时提示「已取消保存」', toastText(D));
api.exportData();
w.__onSaveAsResult(false, 'SecurityException: 无权限');
ok(/保存失败/.test(toastText(D)) && /SecurityException/.test(toastText(D)), '失败时带原因', toastText(D));

console.log('\n【4】旧版 APK 没有 saveFileAs 时退回下载目录');
const legacyCalls = [];
const b = boot({
  ...baseNative,
  saveFile: (n, c, m) => { legacyCalls.push({ n, m }); return null; },
});
b.api.exportData();
ok(legacyCalls.length === 1 && legacyCalls[0].m === 'application/json', '退回 NATIVE.saveFile', legacyCalls);
ok(/已保存到手机「下载」目录/.test(toastText(b.D)), '提示落到下载目录', toastText(b.D));

console.log('\n【5】备份入口文案');
b.api.switchTab('mine');
const bkRow = b.D.querySelector('#page-mine [data-act="open-backup"]');
ok(!!bkRow && /备份与恢复/.test(bkRow.textContent), '我的页只有一个备份入口');
bkRow.click();
ok(/导出备份文件/.test(b.D.querySelector('#sheetBody').textContent), '面板里区分导出与恢复');
ok(/覆盖/.test(b.D.querySelector('#sheetBody').textContent), '提醒恢复会覆盖');

console.log(`\n=== 通过 ${pass} / 失败 ${fail} ===`);
process.exit(fail ? 1 : 0);
