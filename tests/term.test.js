/* 学期报表 + 口径问答 + CSV 文本清洗 */
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
  termRange, calcTerm, termStatementText, openTermReport, openHelp, switchTab,
  calcMonth, FAQ_GROUPS, normalizeCsvText, isExcelBinary
};`);
  return w;
}

const w = boot();
const api = w.__api;
const $ = s => w.document.querySelector(s);
const $$ = s => [...w.document.querySelectorAll(s)];
const txt = s => ($(s) ? $(s).textContent.replace(/\s+/g, ' ').trim() : '');

// 学期：2026-09-07（周一）起 20 周；课分布在 9/10/11，另有一条在学期前（8 月）
api.state.lessons.length = 0;
api.state.master = {};
api.state.extras = [];
api.state.settings.termStart = '2026-09-07';
api.state.settings.termWeeks = 20;
api.state.settings.scheme = 'standard';
api.state.lessons.push(
  { id: 'a', date: '2026-09-08', period: 1, typeId: 'regular', klass: '高三1班', dur: 45, status: 'normal' },
  { id: 'b', date: '2026-10-13', period: 2, typeId: 'regular', klass: '高三1班', dur: 45, status: 'normal' },
  { id: 'c', date: '2026-11-03', period: 3, typeId: 'self', klass: '高二3班', dur: 45, status: 'normal' },
  { id: 'x', date: '2026-08-20', period: 1, typeId: 'regular', klass: '旧学期', dur: 45, status: 'normal' },
);

console.log('\n【1】学期区间');
const r = api.termRange();
ok(r.start === '2026-09-07', '起点是学期第一周周一', r.start);
ok(r.months[0] === '2026-09' && r.months.includes('2027-01'), '跨年月份算进来', r.months);
ok(r.months.length === 5, '9 月到次年 1 月共 5 个月', r.months.length);

console.log('\n【2】汇总');
const t = api.calcTerm();
const manual = r.months.reduce((s, ym) => s + api.calcMonth(ym).total, 0);
ok(Math.abs(t.total - manual) < 0.01, '总额 = 各月之和', [t.total, manual]);
ok(t.count === 3, '只统计学期内的课（8 月那条不算）', t.count);
ok(t.doneCount === 3, '都已完成', t.doneCount);
ok(t.byType.length >= 2, '按类型合并', t.byType.map(x => x.name).join(','));
ok(t.byType.reduce((s, x) => s + x.fee, 0).toFixed(2) === t.lessonTotal.toFixed(2), '类型金额之和 = 课时费');

console.log('\n【3】报表文字');
const text = api.termStatementText();
ok(/课酬学期报表/.test(text), '有标题');
ok(/2026-09-07 至/.test(text), '写明区间');
ok(/学期总课酬/.test(text), '有总额');
ok(/按月/.test(text), '按月分段');
ok(/按类型/.test(text), '按类型分段');
ok(!/旧学期/.test(text), '不含学期外的课');

console.log('\n【4】面板');
api.switchTab('pay');
ok(!!$('#page-pay [data-act="term-report"]'), '课时费页有学期总览入口');
api.openTermReport();
ok(/学期总览/.test(txt('#sheetTitle')), '打开学期总览');
ok(/共 20 周/.test(txt('#sheetBody')), '显示周数');
ok(/按月/.test(txt('#sheetBody')), '面板里有按月列表');

console.log('\n【5】口径问答');
const faq = api.FAQ_GROUPS;
const kj = faq.find(g => g.name === '口径');
ok(!!kj, '有帮助分组「口径」');
ok(kj && kj.items.length >= 6, '至少 6 条', kj && kj.items.length);
ok(kj.items.every(it => it.q && it.a), '每条都有问题与解答');
const qs = kj.items.map(x => x.q).join('|');
ok(/跨月/.test(qs) && /请假/.test(qs) && /系数/.test(qs) && /拖堂/.test(qs), '覆盖关键口径');
ok(faq.every(g => g.items.length > 0), '没有空分组');

api.openHelp('faq');
ok(/口径/.test(txt('#sheetBody')), '帮助页渲染出「口径」分组');

console.log('\n【6】CSV 清洗');
const dirty = '\ufeff周一,第1节,"高一(3)班",正课\r\n\r\n周二\t第2节\t高一(5)班\t正课\r\n,,,\r\n';
const clean = api.normalizeCsvText(dirty);
ok(!clean.includes('\ufeff'), '去掉 BOM');
ok(!/"/.test(clean), '去掉外层引号', clean);
ok(clean.split('\n').length === 2, '空行和纯分隔符行被丢掉', clean.split('\n').length);
ok(/高一\(3\)班/.test(clean), '引号里的内容保留');
ok(api.isExcelBinary('课表.xlsx') && api.isExcelBinary('旧表.XLS'), '识别 Excel 二进制');
ok(!api.isExcelBinary('课表.csv'), 'CSV 不算二进制');

console.log(`\n通过 ${pass} · 失败 ${fail}`);
process.exit(fail ? 1 : 0);
