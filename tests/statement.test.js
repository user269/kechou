/* 月账单导出（文字 / CSV）+ 作息预设 */
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
  calcMonth, render, switchTab, periodMinutes,
  monthStatementText, monthStatementCsv, PERIOD_PRESETS, applyPeriodPreset
};`);
  return w;
}

const w = boot();
const api = w.__api;
const $ = s => w.document.querySelector(s);
const $$ = s => [...w.document.querySelectorAll(s)];
const txt = s => ($(s) ? $(s).textContent.replace(/\s+/g, ' ').trim() : '');

// 造三门课：11-03 第1节、11-04 第6节、11-05 第9节（第9节用于验证作息预设的拦截）
// 先清掉首次启动写入的示例数据，否则统计里会混进一堆演示课
api.state.lessons.length = 0;
api.state.master = {};
const lessons = [
  { id: 't1', date: '2026-11-03', period: 1, typeId: 'regular', klass: '高三1班', subject: '数学', dur: 45, status: 'normal' },
  { id: 't2', date: '2026-11-04', period: 6, typeId: 'self', klass: '高二3班', subject: '数学', dur: 45, status: 'normal' },
  { id: 't3', date: '2026-11-05', period: 9, typeId: 'regular', klass: '高三2班, 实验', subject: '数学', dur: 45, status: 'normal' },
];
api.state.lessons.push(...lessons);
api.state.settings.scheme = 'standard';
api.setPayMonth('2026-11');

console.log('\n【1】文字月报');
const text = api.monthStatementText('2026-11');
ok(/课酬月报/.test(text), '有标题');
ok(/2026年11月/.test(text), '写明月份', text.split('\n')[0]);
ok(/总课酬/.test(text), '有总额');
ok(/高三1班/.test(text), '明细里有班级');
ok(/11-03/.test(text), '明细里有日期');
ok(/折课时/.test(text), '有折算课时');
ok(text.includes('¥'), '金额带货币符号（给人看的）');

console.log('\n【2】CSV 表格');
const csv = api.monthStatementCsv('2026-11');
ok(csv.charCodeAt(0) === 0xfeff, '带 BOM，Excel 才认中文');
const lines = csv.replace(/^\ufeff/, '').split('\r\n');
ok(lines[0] === '日期,星期,节次,时间,班级,科目,类型,数量,计价单位,单价,班级系数,延长分钟,小计,状态', '表头字段完整', lines[0]);
ok(lines.length === lessons.length + 2, '行数 = 课程数 + 表头 + 合计', lines.length);
ok(lines[lines.length - 1].startsWith('合计'), '最后一行是合计');
ok(!/[¥￥]/.test(lines[1]), '数字列不带货币符号，方便求和', lines[1]);
ok(/"高三2班, 实验"/.test(csv), '含逗号的班级被引号包住');
ok(/-/.test(lines[1].split(',')[3]), '时间列是 07:50-08:35 这种区间', lines[1].split(',')[3]);

const m = api.calcMonth('2026-11');
ok(lines[lines.length - 1].split(',')[12] === String(m.total), '合计金额与 calcMonth 一致', m.total);

console.log('\n【3】作息预设');
ok(api.PERIOD_PRESETS.length === 3, '内置三套作息');
const before = api.state.periods.length;

// 有课排在第 9 节，套用 6 节的小学作息应被拦下
api.applyPeriodPreset('primary');
ok(api.state.periods.length === before, '第 9 节有课排课时，拒绝套用 6 节作息');
ok(!$('#modalOverlay').classList.contains('show'), '被拦下时不弹确认框');

// 去掉那节课后可以套用
api.state.lessons = api.state.lessons.filter(l => l.period <= 6);
api.applyPeriodPreset('primary');
ok($('#modalOverlay').classList.contains('show'), '可以套用时弹确认框');
$('#modalFooter [data-modal="ok"]').click();
ok(api.state.periods.length === 6, '套用后作息是 6 节', api.state.periods.length);
ok(api.state.periods[0].start === '08:00', '第 1 节时间取自预设', api.state.periods[0].start);
const l1 = api.state.lessons.find(l => l.period === 1);
ok(Number(l1.dur) === 40, '已有课程的时长跟着新作息重算（45 → 40）', l1.dur);

// 换成高中作息
api.applyPeriodPreset('senior');
$('#modalFooter [data-modal="ok"]').click();
ok(api.state.periods.length === 12, '高中作息 12 个节次', api.state.periods.length);
ok(api.state.periods[0].name === '早读', '第 1 个是早读');

console.log('\n【4】界面入口');
api.switchTab('pay');
ok(!!$('#page-pay [data-act="stmt-copy"]'), '课时费页有「复制成文字」');
ok(!!$('#page-pay [data-act="stmt-csv"]'), '课时费页有「导出表格」');
api.switchTab('mine');
const rows = $$('#page-mine .row');
ok(rows.some(r => /作息/.test(r.textContent)), '我的页仍有作息入口');

console.log(`\n通过 ${pass} · 失败 ${fail}`);
process.exit(fail ? 1 : 0);
