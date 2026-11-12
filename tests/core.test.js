/* 核心计算：计费精度、单双周、时长、铺课与假期、课表文本 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};

const API = `
window.__api = {
  get state(){return state}, set state(v){state=v},
  calcLesson, calcMonth, calcExtend, money, splitMoney, round2,
  weekIndexOf, weekParity, parityLabel, ymd, parseYmd, addDays, startOfWeek,
  todayYmd, periodMinutes, lessonEnd, lessonStart, syncFromMaster, masterPut, masterKey,
  parseScheduleText, exportScheduleText, holidayBlocks, scheduleDow, holidayOn,
  getPeriod, periodTime, dayFee, dayCount, uid, save
};`;

function boot(seed) {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  html = html.replace(/<script[^>]*src=[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'https://kebao.local/', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.Notification = class { static permission = 'granted'; static requestPermission() { return Promise.resolve('granted'); } };
  w.eval(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8') + API);
  if (seed) seed(w.__api, w);
  return w.__api;
}

console.log('\n【1】按节次计价与班级系数');
{
  const api = boot();
  const st = api.state;
  st.types = [
    { id: 'regular', name: '正课', unit: 'period', price: 65, factor: 1, color: '#3B5BFD', enabled: true },
    { id: 'self', name: '自习', unit: 'hour', price: 36, factor: 1, color: '#0FAF87', enabled: true },
  ];
  st.settings.useClassFactor = true;
  st.settings.classFactors = [{ key: '高三', factor: 1.2 }];

  const plain = api.calcLesson({ typeId: 'regular', dur: 45, klass: '高二(2)班' });
  ok(plain.subtotal === 65, '一节 65', plain.subtotal);
  ok(plain.classFactor === 1, '没命中关键词不加成', plain.classFactor);

  const bumped = api.calcLesson({ typeId: 'regular', dur: 45, klass: '高三(3)班' });
  ok(bumped.subtotal === 78, '高三 ×1.2 → 78', bumped.subtotal);
  ok(bumped.classKey === '高三', '记录命中的关键词', bumped.classKey);

  st.settings.useClassFactor = false;
  const off = api.calcLesson({ typeId: 'regular', dur: 45, klass: '高三(3)班' });
  ok(off.subtotal === 65, '关掉开关后不再加成', off.subtotal);
}

console.log('\n【2】按时长计价不带分币毛刺');
{
  const api = boot();
  const st = api.state;
  st.settings.useClassFactor = false;
  st.types = [{ id: 'self', name: '自习', unit: 'hour', price: 36, factor: 1, color: '#0FAF87', enabled: true }];
  const cases = [[25, 15], [70, 42], [50, 30], [35, 21], [55, 33]];
  cases.forEach(([min, want]) => {
    const r = api.calcLesson({ typeId: 'self', dur: min });
    ok(r.subtotal === want, `${min} 分钟 = ${want} 元`, r.subtotal);
  });
  const r = api.calcLesson({ typeId: 'self', dur: 25 });
  ok(r.qty === 0.42, '展示用数量保留两位', r.qty);
  ok(r.qtyRaw === 25 / 60, '计算用原始比例，不取整再乘', r.qtyRaw);
}

console.log('\n【3】按月汇总与总额');
{
  const api = boot();
  const st = api.state;
  st.settings.useClassFactor = false;
  st.lessons = [];
  const ym = '2026-03';
  const mk = (day, price) => ({ id: api.uid(), date: `${ym}-${String(day).padStart(2, '0')}`, period: 1, typeId: 'regular', dur: 45, status: 'normal' });
  st.types = [{ id: 'regular', name: '正课', unit: 'period', price: 60, factor: 1, color: '#3B5BFD', enabled: true }];
  st.lessons.push(mk(2), mk(2), mk(9), mk(16));
  const m = api.calcMonth(ym);
  ok(m.count === 4, '4 节', m.count);
  ok(m.total === 240, '合计 240', m.total);
  ok(api.money(240) === '¥240', '金额格式', api.money(240));
  const sp = api.splitMoney(1234.5);
  ok(sp.int === '1,234' && sp.dec === '50', '千分位与分位拆分', sp);
  ok(api.money(1234.5) === '¥1,234.50', '带小数的金额格式', api.money(1234.5));
  ok(api.money(0) === '¥0', '零显示为 ¥0', api.money(0));
}

console.log('\n【4】周次与单双周');
{
  const api = boot();
  const st = api.state;
  // 2026-03-02 是周一，设为学期第一周
  st.settings.termStart = '2026-03-02';
  ok(api.weekIndexOf('2026-03-02') === 1, '第一周的周一是第 1 周', api.weekIndexOf('2026-03-02'));
  ok(api.weekIndexOf('2026-03-08') === 1, '同周周日仍是第 1 周', api.weekIndexOf('2026-03-08'));
  ok(api.weekIndexOf('2026-03-09') === 2, '下一周是第 2 周', api.weekIndexOf('2026-03-09'));
  ok(api.weekIndexOf('2026-05-04') === 10, '第 10 周', api.weekIndexOf('2026-05-04'));
  ok(api.weekParity('2026-03-02') === 'odd', '第 1 周为单周', api.weekParity('2026-03-02'));
  ok(api.weekParity('2026-03-09') === 'even', '第 2 周为双周', api.weekParity('2026-03-09'));
  ok(api.parityLabel('odd') === '单周' && api.parityLabel('even') === '双周', '标签文案');
}

console.log('\n【5】时长跟随作息；跨零点');
{
  const api = boot();
  const st = api.state;
  st.periods = [
    { no: 1, name: '第1节', short: '1', start: '08:00', end: '08:45' },
    { no: 2, name: '第2节', short: '2', start: '21:30', end: '00:10' },
  ];
  ok(api.periodMinutes(1) === 45, '第 1 节 45 分钟', api.periodMinutes(1));
  ok(api.periodMinutes(2) === 160, '跨零点按 21:30→00:10 算 160 分钟', api.periodMinutes(2));
  const end = api.lessonEnd({ date: '2026-03-02', period: 2, dur: 40 });
  ok(end.getDate() === 3 && end.getHours() === 0 && end.getMinutes() === 10, '结束时间落到次日 00:10', [end.getDate(), end.getHours(), end.getMinutes()]);
}

console.log('\n【6】铺课表：单双周分离 + 跳过假期 + 补班日');
{
  const api = boot();
  const st = api.state;
  // 2027-03-29 是周一；往后 6 周里跨清明与劳动节
  st.settings.termStart = '2027-03-29';
  st.settings.termWeeks = 6;
  st.settings.useClassFactor = false;
  st.lessons = [];
  st.adjusts = [];
  st.master = {};
  st.periods = [
    { no: 1, name: '第1节', short: '1', start: '08:00', end: '08:45' },
    { no: 2, name: '第2节', short: '2', start: '08:55', end: '09:40' },
  ];
  st.types = [{ id: 'regular', name: '正课', unit: 'period', price: 65, factor: 1, color: '#3B5BFD', enabled: true }];
  api.masterPut(1, 1, 'all', { typeId: 'regular', klass: '高一(1)班' });
  api.masterPut(1, 2, 'odd', { typeId: 'regular', klass: '单周课' });
  api.masterPut(5, 1, 'all', { typeId: 'regular', klass: '高一(2)班' });

  const res = api.syncFromMaster();
  ok(res.added > 0, '铺出课程', res.added);
  const mon = d => st.lessons.filter(l => l.date === d);
  ok(mon('2027-03-29').length === 2, '单周的周一排 2 节', mon('2027-03-29').map(l => l.period));
  ok(mon('2027-04-12').length === 2, '第 3 周也是单周，2 节', mon('2027-04-12').map(l => l.period));
  ok(mon('2027-04-19').length === 1, '双周只排每周课', mon('2027-04-19').map(l => l.period));

  ok(!!api.holidayOn('2027-04-05'), '04-05 是清明节');
  ok(mon('2027-04-05').length === 0, '清明当天不排课', mon('2027-04-05').length);
  ok(mon('2027-05-03').length === 0, '劳动节当天不排课', mon('2027-05-03').length);
  ok(mon('2027-04-09').length === 1, '普通周五照常排', mon('2027-04-09').length);

  // 半天假：只排到放学时刻
  st.holidays = st.holidays.filter(h => h.date !== '2027-04-12');
  st.holidays.push({ date: '2027-04-12', name: '校运会', kind: 'off', half: '08:45', asDow: null, custom: true });
  st.lessons = [];
  api.syncFromMaster();
  const halfDay = mon('2027-04-12').map(l => l.period);
  ok(halfDay.length === 1 && halfDay[0] === 1, '半天只排第 1 节', halfDay);
  st.holidays = st.holidays.filter(h => h.date !== '2027-04-12');

  // 补班日：把 05-08 指定为「按周五的课表」
  const wk = st.holidays.find(h => h.date === '2027-05-08');
  ok(!!wk && wk.kind === 'work', '05-08 是补班日', wk && wk.name);
  ok(api.scheduleDow('2027-05-08') === 6, '未指定时按当天（周六）', api.scheduleDow('2027-05-08'));
  wk.asDow = 5;
  ok(api.scheduleDow('2027-05-08') === 5, '指定后按周五', api.scheduleDow('2027-05-08'));
  st.lessons = [];
  api.syncFromMaster();
  const makeup = mon('2027-05-08');
  ok(makeup.length === 1 && makeup[0].klass === '高一(2)班', '补班日排上 05-08 那天的周五课', makeup.map(x => x.klass));
}

console.log('\n【7】清理课表只删课，不动设置');
{
  const api = boot();
  const st = api.state;
  st.types = [{ id: 'regular', name: '正课', unit: 'period', price: 65, factor: 1, color: '#3B5BFD', enabled: true }];
  st.lessons = [{ id: 'a', date: '2026-03-02', period: 1, typeId: 'regular', dur: 45, status: 'normal' }];
  st.master[api.masterKey(1, 1, 'all')] = { typeId: 'regular' };
  const before = JSON.stringify({ types: st.types, periods: st.periods, teacher: st.teacher });
  st.lessons = [];
  st.master = {};
  ok(st.lessons.length === 0, '课程被清空');
  ok(JSON.stringify({ types: st.types, periods: st.periods, teacher: st.teacher }) === before, '单价/作息/个人信息都没动');
}

console.log('\n【8】课表文本：导出再导入不丢信息');
{
  const api = boot();
  const st = api.state;
  st.settings.termStart = '2026-03-02';
  st.master = {};
  api.masterPut(2, 3, 'all', { typeId: 'regular', klass: '高二(3)班', subject: '英语', extend: 20 });
  api.masterPut(4, 5, 'even', { typeId: 'regular', klass: '高一(1)班' });
  const text = api.exportScheduleText();
  ok(/周二/.test(text) && /高二\(3\)班/.test(text), '导出含星期与班级', text.split('\n').slice(0, 3));
  ok(/\+20分/.test(text), '导出带延长课时', text);

  const parsed = api.parseScheduleText(text);
  ok(parsed.rows.length === 2, '解析回 2 条', parsed.rows.length);
  ok(parsed.rows.some(r => r.klass === '高二(3)班' && r.extend === 20), '班级与延长都在', parsed.rows);
  ok(parsed.rows.some(r => r.wm === 'even'), '双周信息保留', parsed.rows.map(r => r.wm));
}

console.log(`\n=== 通过 ${pass} / 失败 ${fail} ===`);
process.exit(fail ? 1 : 0);
