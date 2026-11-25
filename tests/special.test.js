/* 特殊课时：运动会按天、培训按次 */
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
  calcLesson, calcMonth, lessonQtyLabel, spanOf, isSpanUnit,
  unitShort, unitName, unitPlanName, lessonPreview, lessonTotal,
  openTypeEditor, openLessonSheet, render, switchTab,
  monthStatementText, save, repairState, getType, uid,
  setDraft(patch) { Object.assign(draft, patch); renderLessonSheet(); },
};`);
  return w;
}

const w = boot();
const api = w.__api;
const $ = s => w.document.querySelector(s);
const $$ = s => [...w.document.querySelectorAll(s)];

// 干净起点：去掉首次启动的示例课
api.state.lessons.length = 0;
api.state.master = {};
api.state.settings.scheme = 'standard';
api.state.settings.useClassFactor = false;

// 造三种特殊类型
api.state.types.push(
  { id: 'sport', name: '运动会', unit: 'day', price: 200, factor: 1, color: '#3B5BFD', tierable: false, enabled: true },
  { id: 'train', name: '培训', unit: 'flat', price: 300, factor: 1, color: '#0FAF87', tierable: false, enabled: true },
);

console.log('\n【1】按天：一天一个价，半天算一半');
const day1 = { id: 'd1', date: '2026-11-02', period: 1, typeId: 'sport', klass: '全校', status: 'normal', dur: 45, times: 3 };
const c1 = api.calcLesson(day1);
ok(c1.qty === 3 && c1.unitLabel === '天', '数量 3 天', [c1.qty, c1.unitLabel]);
ok(c1.subtotal === 600, '200×3=600', c1.subtotal);

const half = api.calcLesson({ ...day1, times: 0.5 });
ok(half.subtotal === 100, '半天 200×0.5=100', half.subtotal);

const noTimes = api.calcLesson({ ...day1, times: undefined });
ok(noTimes.qty === 1 && noTimes.subtotal === 200, '没填天数按 1 天', noTimes.subtotal);
ok(api.spanOf({ times: 0 }) === 1, '天数 0 当 1 处理', api.spanOf({ times: 0 }));
ok(api.spanOf({ times: -3 }) === 1, '负数当 1 处理', api.spanOf({ times: -3 }));
ok(api.spanOf({ times: 999 }) === 60, '超上限夹到 60', api.spanOf({ times: 999 }));

console.log('\n【2】按次：与时长无关');
const trLesson = { id: 't1', date: '2026-11-03', period: 5, typeId: 'train', dur: 240, times: 2 };
const tr = api.calcLesson(trLesson);
ok(tr.subtotal === 600, '300×2=600，4 小时也不影响', tr.subtotal);
const tr1 = api.calcLesson({ id: 't2', date: '2026-11-03', period: 5, typeId: 'train' });
ok(tr1.subtotal === 300, '一次就是 300', tr1.subtotal);

console.log('\n【3】班级系数照样生效');
api.state.settings.useClassFactor = true;
api.state.settings.classFactors = [{ key: '高三', factor: 1.2 }];
const withClass = api.calcLesson({ ...day1, klass: '高三运动会' });
ok(withClass.subtotal === 720, '600×1.2=720', withClass.subtotal);
api.state.settings.useClassFactor = false;
api.state.settings.classFactors = [];

console.log('\n【4】不计入折合课时，也不占超课时名额');
api.state.lessons.push(
  { id: 'a1', date: '2026-11-02', period: 1, typeId: 'regular', klass: '高一1班', status: 'normal', dur: 45 },
  day1,
  trLesson,
);
api.setPayMonth('2026-11');
const m = api.calcMonth('2026-11');
ok(m.km === 1, '只有那节正课算 1 标准课时', m.km);
ok(m.count === 3, '记录数仍是 3（列表里都看得到）', m.count);
ok(m.lessonTotal === 50 + 600 + 600 || m.lessonTotal === 600 + 600 + api.calcLesson({ id: 'a1', date: '2026-11-02', period: 1, typeId: 'regular', klass: '高一1班', status: 'normal', dur: 45 }).subtotal,
  '总额 = 三笔加起来', m.lessonTotal);

console.log('\n【5】超课时：特殊课时不把后面的课顶进加价档');
api.state.lessons.length = 0;
api.state.settings.scheme = 'overtime';
api.state.settings.overtimeFrom = 1;
api.state.settings.overtimeRate = 2;
api.state.types.forEach(t => { if (t.id !== 'sport' && t.id !== 'train') t.tierable = true; });
api.state.types.find(t => t.id === 'sport').tierable = true;
api.state.lessons.push(
  { id: 'b1', date: '2026-11-02', period: 1, typeId: 'sport', klass: '全校', status: 'normal', dur: 45, times: 1 },
  { id: 'b2', date: '2026-11-03', period: 1, typeId: 'regular', klass: '高一1班', status: 'normal', dur: 45 },
);
const mo = api.calcMonth('2026-11');
const regRow = mo.rows.find(r => r.lesson.id === 'b2');
ok(!/超课时/.test(regRow.extraLabel || ''), '第二天那节正课没被顶进超课时', regRow.extraLabel);

api.state.settings.scheme = 'standard';
api.state.settings.overtimeFrom = 0;
api.state.settings.overtimeRate = 1;

console.log('\n【6】文案：一天 / 一次，不是「节」');
ok(api.unitShort('day') === '天' && api.unitShort('flat') === '次', '短名');
ok(api.unitName('day') === '天' && api.unitName('flat') === '次', '全名');
ok(api.unitPlanName('day') === '按天' && api.unitPlanName('flat') === '按次', '计价方式说法');
ok(api.unitShort('period') === '节' && api.unitShort('hour') === '时', '老单位不受影响');
ok(api.lessonQtyLabel(day1, api.getType('sport')) === '3天', '列表里显示 3天', api.lessonQtyLabel(day1, api.getType('sport')));
ok(api.lessonQtyLabel({ dur: 60 }, { unit: 'hour' }) === '60分钟', '按时长仍显示分钟');

const prev = api.lessonPreview(day1);
ok(/× 3 天/.test(prev.sub), '预览文案带天数', prev.sub);
ok(prev.total === 600, '预览总额 600', prev.total);

console.log('\n【7】月报按类型写「天 / 次」');
const text = api.monthStatementText('2026-11');
ok(/1 天/.test(text) || /1 次/.test(text), '按类型一栏用天/次', text.split('\n').filter(l => /运动会|培训/.test(l)).join(' | '));

console.log('\n【8】自检：坏数量被夹回来');
api.state.lessons.length = 0;
api.state.lessons.push({ id: 'x1', date: '2026-11-05', period: 1, typeId: 'sport', klass: '全校', status: 'normal', dur: 45, times: 999 });
api.state.lessons.push({ id: 'x2', date: '2026-11-06', period: 1, typeId: 'flat'.length ? 'train' : 'train', klass: '全校', status: 'normal', dur: 45, times: 'abc' });
const fixed = api.repairState();
const x1 = api.state.lessons.find(l => l.id === 'x1');
const x2 = api.state.lessons.find(l => l.id === 'x2');
ok(x1.times === 60, '999 夹到 60', x1.times);
ok(x2.times === 1, '非数字改成 1', x2.times);
ok(Array.isArray(fixed), '自检有返回修复项数组');

console.log('\n【9】界面：类型编辑能选「按天 / 按次」');
api.switchTab('mine');
api.openTypeEditor('sport');
const units = $$('[data-act="type-unit"]').map(b => b.dataset.unit);
ok(units.includes('day') && units.includes('flat'), '五个计价方式都在', units);
ok(units.length === 5, '不多不少 5 个', units.length);
const onBtn = $$('[data-act="type-unit"]').find(b => b.classList.contains('on'));
ok(onBtn && onBtn.dataset.unit === 'day', '当前选中「按天」', onBtn && onBtn.dataset.unit);

console.log('\n【10】界面：录课时能填天数');
api.state.lessons.length = 0;
api.openLessonSheet({ date: '2026-11-09', period: 1 });
// 选中运动会类型
api.setDraft({ typeId: 'sport', klass: '全校' });
const timesInput = $('[id="f-times"]');
ok(!!timesInput, '出现数量输入框');
ok(timesInput && timesInput.value === '1', '默认 1', timesInput && timesInput.value);
const label = timesInput ? timesInput.closest('.field').textContent.replace(/\s+/g, ' ') : '';
ok(/天数/.test(label) && /\/天/.test(label), '标签写「天数」和单价', label);
ok(/sfx/.test(timesInput.parentElement.innerHTML) && /天/.test(timesInput.parentElement.textContent), '单位后缀是天');

console.log('\n【11】界面：按次类型显示「次数」');
api.setDraft({ typeId: 'train' });
const t2 = $('[id="f-times"]');
const lb2 = t2 ? t2.closest('.field').textContent.replace(/\s+/g, ' ') : '';
ok(/次数/.test(lb2) && /\/次/.test(lb2), '标签写「次数」和单价', lb2);

console.log(`\n=== 通过 ${pass} / 失败 ${fail} ===`);
process.exit(fail ? 1 : 0);
