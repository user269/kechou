/* 假期 / 调休当天不计课时费 */
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
  calcLesson, calcMonth, lessonTotal, lessonPreview, holidayPaysOff, holidayOn,
  render, switchTab, openLessonMenu, save,
  monthStatementText, getPeriod, todayYmd,
};`);
  return w;
}

const w = boot();
const api = w.__api;
const $ = s => w.document.querySelector(s);
const txt = s => ($(s) ? $(s).textContent.replace(/\s+/g, ' ').trim() : '');

api.state.lessons.length = 0;
api.state.master = {};
api.state.settings.scheme = 'standard';
api.state.settings.useClassFactor = false;
api.state.settings.holidayNoPay = true;

// 用过去的一天：说明这条规则不只管「今天以后」（排课那条才只看今天以后）
const HOLI = '2026-10-01';
const WORK = '2026-10-10';     // 补班日
const NORMAL = '2026-10-15';

api.state.holidays = [
  { date: HOLI, name: '国庆', kind: 'off', half: '', asDow: null, custom: true },
  { date: WORK, name: '补班', kind: 'work', half: '', asDow: 3, custom: true },
];

const mk = (id, date, extra) => Object.assign({
  id, date, period: 1, typeId: 'regular', klass: '高一(1)班', status: 'normal', dur: 45,
}, extra || {});

console.log('\n【1】整天放假：当天课时费为 0');
const onHoliday = mk('h1', HOLI);
const c = api.calcLesson(onHoliday);
ok(c.holidayOff === true, '标记为假期不计费', c.holidayOff);
ok(c.subtotal === 0, '金额 0', c.subtotal);
ok(c.qty > 0 && c.unitPrice > 0, '仍保留数量与单价（界面能显示本来多少）', [c.qty, c.unitPrice]);
ok(api.lessonTotal(onHoliday) === 0, '单节合计 0');

console.log('\n【2】补班日（kind=work）照常计费');
const onWork = mk('w1', WORK);
const cw = api.calcLesson(onWork);
ok(cw.holidayOff === false, '不算假期', cw.holidayOff);
ok(cw.subtotal > 0, '照常有钱', cw.subtotal);

console.log('\n【3】普通日不受影响');
const cn = api.calcLesson(mk('n1', NORMAL));
ok(cn.subtotal > 0 && !cn.holidayOff, '普通日照常', cn.subtotal);

console.log('\n【4】月度总额里那一天是 0');
api.state.lessons.push(mk('l1', NORMAL), mk('l2', HOLI), mk('l3', WORK));
api.setPayMonth('2026-10');
const m = api.calcMonth('2026-10');
const holidayRow = m.rows.find(r => r.lesson.id === 'l2');
ok(holidayRow.subtotal === 0, '假期那节行金额 0', holidayRow.subtotal);
ok(holidayRow.holidayOff === true, '行上带假期标记', holidayRow.holidayOff);
ok(m.total === cn.subtotal + cw.subtotal, '总额 = 普通日 + 补班日', [m.total, cn.subtotal, cw.subtotal]);
ok(m.holidayOffCount === 1, '统计到 1 节未计费', m.holidayOffCount);

console.log('\n【5】不计入折合课时');
ok(m.km === 2, '3 节里只有 2 节算课时', m.km);

console.log('\n【6】月报文字说明有几节没算');
const text = api.monthStatementText('2026-10');
ok(/假期.*1 节未计费/.test(text), '月报写明假期未计费', text.split('\n').find(l => /假期/.test(l)));

console.log('\n【7】关掉设置后照常计价');
api.state.settings.holidayNoPay = false;
ok(api.calcLesson(onHoliday).subtotal > 0, '关掉后假期也有钱', api.calcLesson(onHoliday).subtotal);
api.state.settings.holidayNoPay = true;

console.log('\n【8】单节课「照常计费」覆盖');
const paid = mk('h2', HOLI, { payHoliday: true });
ok(api.calcLesson(paid).holidayOff === false, '勾了就按正常算', api.calcLesson(paid).holidayOff);
ok(api.calcLesson(paid).subtotal > 0, '并且真有钱', api.calcLesson(paid).subtotal);

console.log('\n【9】半天假：只挡放学之后的节次');
const HALF = '2026-10-20';
api.state.holidays.push({ date: HALF, name: '半天', kind: 'off', half: '12:00', asDow: null, custom: true });
const periods = api.state.periods;
const before = periods.find(p => p.start < '12:00');
const after = periods.slice().reverse().find(p => p.start >= '12:00');
ok(!!before && !!after, '作息里有放学前后的节次', [before && before.no, after && after.no]);
if (before && after) {
  ok(api.calcLesson(mk('b1', HALF, { period: before.no })).holidayOff === false, '上午那节照常', before.no);
  ok(api.calcLesson(mk('b2', HALF, { period: after.no })).holidayOff === true, '下午那节不计', after.no);
}

console.log('\n【10】界面上标出来，金额显示 0');
api.state.lessons.length = 0;
api.state.lessons.push(mk('ui1', HOLI));
api.state.settings.termStart = '2026-08-31';
api.switchTab('pay');
api.setPayMonth('2026-10');
api.render();
const body = w.document.body.textContent.replace(/\s+/g, ' ');
ok(/假期/.test(body), '页面上出现「假期」字样');

console.log('\n【11】课程详情里有「照常计费」开关');
api.openLessonMenu('ui1');
const sheet = txt('#sheetBody') + ' ' + txt('#sheetTitle');
ok(/假期/.test(sheet), '详情页标明假期', sheet.slice(0, 60));
ok(/照常计费/.test(txt('#sheetBody')), '给出单节覆盖入口');
ok(!!w.document.querySelector('[data-act="lesson-toggle-payholiday"]'), '开关存在');

console.log(`\n=== 通过 ${pass} / 失败 ${fail} ===`);
process.exit(fail ? 1 : 0);
