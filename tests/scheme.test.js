/* 计费方案库 + 分享码 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};

function boot() {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  html = html.replace(/<script[^>]*src=[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'https://kebao.local/', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.Notification = class { static permission = 'granted'; static requestPermission() { return Promise.resolve('granted'); } };
  w.eval(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8') + `
window.__api = {
  get state() { return state; },
  snapshotScheme, applySchemeSnapshot, shareCodeOf, parseShareCode, schemeSummary,
  openCalcRules, openSchemeSave, saveSchemeNow, openSchemeSheet, applySchemeById,
  openSchemeShare, openSchemeImport, parseShareInput, applyShareInput, calcMonth
};`);
  return w;
}

const w = boot();
const api = w.__api;
const $ = s => w.document.querySelector(s);
const txt = s => ($(s) ? $(s).textContent.replace(/\s+/g, ' ').trim() : '');

console.log('\n【1】快照与应用');
const snap = api.snapshotScheme();
ok(snap.scheme === 'standard', '默认标准计费', snap.scheme);
ok(Array.isArray(snap.types) && snap.types.length >= 5, '带上课程类型', snap.types.length);
ok(snap.types.some(t => t.id === 'regular'), '含正课');

// 改成阶梯 + 抬高单价，再拍快照
api.state.settings.scheme = 'tiered';
api.state.settings.tiers = [{ upTo: 10, price: 80 }, { upTo: 9999, price: 100 }];
const regular = api.state.types.find(t => t.id === 'regular');
regular.price = 80;
const snap2 = api.snapshotScheme();

// 还原成别的样子，再应用回来
api.state.settings.scheme = 'standard';
api.state.settings.tiers = [{ upTo: 20, price: 65 }];
regular.price = 65;
api.applySchemeSnapshot(snap2);
ok(api.state.settings.scheme === 'tiered', '公式切回阶梯');
ok(api.state.settings.tiers[0].price === 80, '阶梯同步', api.state.settings.tiers[0].price);
ok(api.state.types.find(t => t.id === 'regular').price === 80, '单价同步');

console.log('\n【2】分享码往返');
const code = api.shareCodeOf(snap2, '本校方案');
ok(/^KB1-/.test(code), '前缀是 KB1-', code.slice(0, 6));
ok(!/[+/=]/.test(code.slice(4)), 'base64url，没有 + / =');
const back = api.parseShareCode(code);
ok(back.name === '本校方案', '名称带回来', back.name);
ok(back.scheme === 'tiered', '公式带回来');
ok(back.types.find(t => t.id === 'regular').price === 80, '单价带回来');
ok(back.tiers.length === 2 && back.tiers[1].price === 100, '阶梯带回来');

// 长名字被截断，不会撑爆
ok(api.shareCodeOf(snap2, '一二三四五六七八九十十一十二十三').length > 0, '超长名字不报错');

console.log('\n【3】坏码要拦住');
const bad = [
  ['', '不是课酬的分享码'],
  ['hello', '不是课酬的分享码'],
  ['KB1-@@@@', '不完整'],
];
bad.forEach(([input, expect]) => {
  let msg = '';
  try { api.parseShareCode(input); } catch (e) { msg = e.message; }
  ok(msg.includes(expect), `「${input || '(空)'}」→ ${expect}`, msg);
});

console.log('\n【4】应用时合并类型，不丢本地类型');
api.state.types.push({ id: 'contest', name: '竞赛辅导', unit: 'hour', price: 200, factor: 1, color: '#EF6C4D', tierable: false, enabled: true });
const before = api.state.types.length;
api.applySchemeSnapshot(back);
ok(api.state.types.some(t => t.id === 'contest'), '本地独有的类型保留');
ok(api.state.types.length === before, '不会重复添加', api.state.types.length);

console.log('\n【5】界面');
api.openCalcRules();
ok(/我的方案/.test(txt('#sheetBody')), '计费公式里有「我的方案」');
ok(!!$('#sheetBody [data-act="scheme-save"]'), '有保存入口');
ok(!!$('#sheetBody [data-act="scheme-share"]'), '有分享入口');
ok(!!$('#sheetBody [data-act="scheme-import"]'), '有导入入口');

// 保存一套
api.openSchemeSave();
$('#schemeName').value = '本校秋季';
$('#sheetFooter [data-act="scheme-save-ok"]').click();
ok((api.state.schemes || []).length === 1, '存下一套', api.state.schemes.length);
ok(api.state.settings.activeScheme === api.state.schemes[0].id, '保存后标记为当前方案');

// 再存一套，切换
api.state.settings.scheme = 'standard';
api.openSchemeSave();
$('#schemeName').value = '兼职按次';
$('#sheetFooter [data-act="scheme-save-ok"]').click();
ok(api.state.schemes.length === 2, '两套');
const first = api.state.schemes[0];
api.applySchemeById(first.id);
ok(api.state.settings.scheme === 'tiered', '切回第一套的公式');
ok(api.state.settings.activeScheme === first.id, '当前方案标记跟着变');

// 分享面板
api.openSchemeShare(first.id);
const out = $('#shareOut');
ok(!!out && /^KB1-/.test(out.value), '分享面板给出分享码');
ok(api.parseShareCode(out.value).name === '本校秋季', '码里带名字');

// 导入面板
api.openSchemeImport();
const importCode = api.shareCodeOf(snap2, '同事的方案');
$('#shareIn').value = importCode;
$('#sheetFooter [data-act="scheme-import-parse"]').click();
ok(/解析成功/.test(txt('#sheetBody')), '解析后给预览');
ok(/同事的方案/.test(txt('#sheetBody')), '预览里显示名字');
$('#sheetFooter [data-act="scheme-import-ok"]').click();
ok(api.state.schemes.length === 3, '导入后多一套', api.state.schemes.length);
ok(api.state.settings.scheme === 'tiered', '导入即应用');

console.log('\n【6】导入不影响已录课程的计价类型');
api.state.lessons = [{ id: 'z', date: '2026-11-03', period: 1, typeId: 'contest', klass: '竞赛班', dur: 60, status: 'normal' }];
const m = api.calcMonth('2026-11');
ok(m.rows.length === 1 && m.rows[0].type.name === '竞赛辅导', '课程仍认自己的类型', m.rows[0] && m.rows[0].type.name);

console.log(`\n通过 ${pass} · 失败 ${fail}`);
process.exit(fail ? 1 : 0);
