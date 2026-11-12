/* 补贴与扣款：计入月度总额、编辑删除、进月报与 CSV */
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
  setPayMonth(m) { payMonth = m; },
  calcMonth, extrasOf, extraTotals, render, switchTab,
  openExtraSheet, monthStatementText, monthStatementCsv
};`);
  return w;
}

const w = boot();
const api = w.__api;
const $ = s => w.document.querySelector(s);
const txt = s => ($(s) ? $(s).textContent.replace(/\s+/g, ' ').trim() : '');

// 两节课 + 清掉示例数据
api.state.lessons.length = 0;
api.state.master = {};
api.state.extras = [];
api.state.lessons.push(
  { id: 'a', date: '2026-11-03', period: 1, typeId: 'regular', klass: '高三1班', dur: 45, status: 'normal' },
  { id: 'b', date: '2026-11-04', period: 2, typeId: 'regular', klass: '高三2班', dur: 45, status: 'normal' },
);
api.setPayMonth('2026-11');

const base = api.calcMonth('2026-11');
const baseTotal = base.total;

console.log('\n【1】没有补贴时总额不变');
ok(base.total === base.lessonTotal, '总额 = 课时费', [base.total, base.lessonTotal]);
ok(base.extraRows.length === 0, '没有条目');
ok(base.extraAdd === 0 && base.extraSub === 0, '补贴扣款都是 0');

console.log('\n【2】新增「每月固定」补贴');
api.openExtraSheet();
$('#extraName').value = '班主任津贴';
$('#extraAmount').value = '300';
$('#extraDate').value = '2026-09-01';
$('#sheetFooter [data-act="extra-save"]').click();
ok(api.state.extras.length === 1, '存下一条', api.state.extras.length);
ok(api.state.extras[0].cycle === 'monthly', '默认按每月固定');
ok(api.state.extras[0].amount === 300, '金额 300', api.state.extras[0].amount);

const n1 = api.calcMonth('2026-11');
ok(n1.total === baseTotal + 300, '11 月总额 +300', [n1.total, baseTotal]);
ok(n1.extraAdd === 300 && n1.extraSub === 0, '分别统计补贴与扣款');
ok(api.calcMonth('2026-08').total === api.calcMonth('2026-08').lessonTotal, '8 月（起始月之前）不受影响');

console.log('\n【3】一次性扣款只影响当月');
api.openExtraSheet();
$('#extraName').value = '缺勤扣款';
$('#extraAmount').value = '50';
$('#extraDate').value = '2026-11-10';
$('.segmented [data-act="extra-kind"][data-v="sub"]').click();
$('.segmented [data-act="extra-cycle"][data-v="once"]').click();
$('#sheetFooter [data-act="extra-save"]').click();
const sub = api.state.extras.find(e => e.name === '缺勤扣款');
ok(!!sub && sub.kind === 'sub' && sub.cycle === 'once', '存成一次性扣款', sub);

const n2 = api.calcMonth('2026-11');
ok(n2.total === baseTotal + 300 - 50, '11 月总额 +300-50', [n2.total, baseTotal]);
ok(api.calcMonth('2026-12').total === api.calcMonth('2026-12').lessonTotal + 300,
  '12 月只有每月固定那条，一次性扣款不跟过去');

console.log('\n【4】编辑与删除');
api.openExtraSheet(api.state.extras[0].id);
ok(($('#extraName') || {}).value === '班主任津贴', '编辑面板带出原值');
$('#extraAmount').value = '420';
$('#sheetFooter [data-act="extra-save"]').click();
ok(api.state.extras.find(e => e.id === api.state.extras[0].id).amount === 420, '改金额生效');
ok(api.calcMonth('2026-11').total === baseTotal + 420 - 50, '总额跟着变', api.calcMonth('2026-11').total);

api.openExtraSheet(api.state.extras[1].id);
$('#sheetBody [data-act="extra-del"]').click();
ok(api.state.extras.length === 1, '删除后只剩一条');
ok(api.calcMonth('2026-11').total === baseTotal + 420, '删掉扣款后总额回来');

console.log('\n【5】校验');
api.openExtraSheet();
$('#extraName').value = '';
$('#extraAmount').value = '100';
$('#sheetFooter [data-act="extra-save"]').click();
ok(api.state.extras.length === 1, '没名字不保存');
$('#extraName').value = '监考费';
$('#extraAmount').value = '0';
$('#sheetFooter [data-act="extra-save"]').click();
ok(api.state.extras.length === 1, '金额 0 不保存');
$('#sheetFooter [data-close]') || $('#sheetBody') && null;

console.log('\n【6】进月报与 CSV');
const text = api.monthStatementText('2026-11');
ok(/补贴　　\+/.test(text), '文字月报列出补贴', text.split('\n').slice(0, 6).join(' | '));
ok(/课时费　/.test(text), '文字月报有课时费小计');
const csv = api.monthStatementCsv('2026-11');
const rows = csv.replace(/^\ufeff/, '').split('\r\n');
ok(rows.length === 2 + 1 + 1 + 1, 'CSV 行数 = 课 2 + 补贴 1 + 表头 + 合计', rows.length);
ok(/班主任津贴/.test(rows[3]), '补贴单独占一行', rows[3]);
ok(rows[rows.length - 1].split(',')[12] === String(api.calcMonth('2026-11').total), '合计含补贴');

console.log('\n【7】界面入口');
api.switchTab('pay');
ok(!!$('#page-pay [data-act="extra-add"]'), '课时费页有添加入口');
ok(/补贴与扣款/.test(txt('#page-pay')), '课时费页有这张卡');
const row = $('#page-pay [data-act="extra-edit"]');
ok(!!row, '已有条目可点开编辑');

console.log(`\n通过 ${pass} · 失败 ${fail}`);
process.exit(fail ? 1 : 0);
