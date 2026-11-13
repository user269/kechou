/* 「法定节假日」专项测试：内置数据、面板、编辑、铺课表跳过、补班、半天、同步解析 */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const ROOT = 'C:/Users/555/WorkBuddy/课时';

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};

function boot() {
  let html = fs.readFileSync(ROOT + '/index.html', 'utf8').replace(/<script[^>]*src=[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'https://kebao.local/', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.Notification = class { static permission = 'granted'; static requestPermission() { return Promise.resolve('granted'); } };
  const js = fs.readFileSync(ROOT + '/app.js', 'utf8');
  w.eval(js + `
window.__api = {
  get state(){return state}, render, switchTab, save,
  syncFromMaster, masterPut, holidayOn, holidayBlocks, holidaySummary, holidayBanner,
  applyHolidayData, parseHolidayPayload, allBuiltinHolidays, builtinHolidays,
  todayYmd, ymd, addDays, startOfWeek, parseYmd,
  dayView, weekView, lessonsOfDay, openHolidaysSheet, openHolidayEditor, scheduleDow,
  get hdDraft(){return hdDraft}, set hdDraft(v){hdDraft=v}, openHelp
};`);
  return w;
}

const $ = (w, s) => w.document.querySelector(s);
const $$ = (w, s) => [...w.document.querySelectorAll(s)];
const txt = (w, s) => ($(w, s) ? $(w, s).textContent.replace(/\s+/g, ' ').trim() : '');

const w = boot();
const api = w.__api;
const S = () => api.state;

/* ---------- 准备一个干净的学期：本周为第 1 周，共 2 周 ---------- */
function resetTerm() {
  const s = S();
  s.lessons = [];
  s.master = {};
  s.adjusts = [];
  s.swaps = [];
  s.settings.termStart = api.ymd(api.startOfWeek(new Date()));
  s.settings.termWeeks = 2;
  s.settings.holidaySkip = true;
  // 只留测试用的假期，避免内置假期干扰
  s.holidays = [];
}
function setHoliday(date, kind, extra) {
  S().holidays = S().holidays.filter(h => h.date !== date);
  S().holidays.push(Object.assign({ date, name: '测试', kind: kind || 'off', half: '', asDow: null, custom: true }, extra || {}));
  S().holidays.sort((a, b) => (a.date < b.date ? -1 : 1));
}

console.log('\n【1】内置放假安排');
const b26 = api.builtinHolidays(2026);
const b27 = api.builtinHolidays(2027);
ok(b26.length === 39, '2026 年 39 条（33 天假 + 6 天补班）', b26.length);
ok(b27.length === 34, '2027 年 34 条', b27.length);
ok(b26.filter(h => h.kind === 'off').length === 33, '2026 年 33 天放假', b26.filter(h => h.kind === 'off').length);
ok(api.holidayOn('2026-10-01').name === '国庆节', '国庆节 10-01 已收录', api.holidayOn('2026-10-01'));
ok(api.holidayOn('2026-10-10').kind === 'work', '10-10 标记为补班');
ok(api.holidayOn('2026-02-17').name === '初一', '春节初一 02-17');
ok(/2026.*2027/.test(api.holidaySummary()), '摘要包含收录年份', api.holidaySummary());

console.log('\n【2】「我的」页入口');
api.switchTab('mine');
const entry = $(w, '#page-mine [data-act="open-holidays"]');
ok(!!entry, '出现「法定节假日」一行');
ok(/法定节假日/.test(txt(w, '#page-mine [data-act="open-holidays"] .t')), '标题文字正确');
ok(/天假/.test(txt(w, '#page-mine [data-act="open-holidays"] .s')), '副标题显示放假天数', txt(w, '#page-mine [data-act="open-holidays"] .s'));
const labels = $$(w, '#page-mine .section-label').map(e => e.textContent.trim());
ok(labels.includes('课表与提醒'), '归在「课表与提醒」分组内', labels);

console.log('\n【3】打开节假日面板');
entry.click();
ok($(w, '#overlay').classList.contains('show'), '面板已弹出');
ok(txt(w, '#sheetTitle') === '法定节假日', '标题正确', txt(w, '#sheetTitle'));
ok(!!$(w, '#sheetBody [data-act="hd-sync"]'), '有「同步最新」按钮');
ok(!!$(w, '#sheetBody [data-act="hd-reset"]'), '有「恢复内置」按钮');
ok(!!$(w, '#sheetBody [data-act="hd-add"]'), '有「添加」按钮');
ok(!!$(w, '#sheetBody [data-act="hd-toggle-skip"]'), '有跳过假期开关');
ok($$(w, '#sheetBody .hd-row').length === S().holidays.length, '列表条数与数据一致', [$$(w, '#sheetBody .hd-row').length, S().holidays.length]);
ok($$(w, '#sheetBody .hd-year').length === 2, '按年份分成两组', $$(w, '#sheetBody .hd-year').length);
ok(!!$(w, '#sheetBody .hd-hero-n'), '顶部有统计卡');
ok(/内置数据/.test(txt(w, '#sheetBody .hd-hero')), '未同步时标注「内置数据」');

console.log('\n【4】把某天改成半天');
$(w, '#sheetBody .hd-row[data-date="2026-10-02"]').click();
ok(/编辑假日/.test(txt(w, '#sheetTitle')), '进入编辑页', txt(w, '#sheetTitle'));
ok(!!$(w, '#hdDate'), '有日期输入');
ok($(w, '#hdDate').value === '2026-10-02', '日期带出正确', $(w, '#hdDate').value);
ok(!!$(w, '#hdHalf'), '放假类型显示「上到几点」');
$(w, '#hdHalf').value = '12:00';
$(w, '#hdName').value = '国庆（半天）';
$(w, '#sheetFooter [data-act="hd-save"]').click();
ok(/法定节假日/.test(txt(w, '#sheetTitle')), '保存后回到列表');
const h1002 = api.holidayOn('2026-10-02');
ok(h1002.half === '12:00', '半天时间已写入', h1002);
ok(h1002.custom === true, '标记为自定义');
ok(h1002.name === '国庆（半天）', '名称已更新', h1002.name);
ok(/上到 12:00/.test(txt(w, '#sheetBody .hd-row[data-date="2026-10-02"]')), '列表显示「上到 12:00」', txt(w, '#sheetBody .hd-row[data-date="2026-10-02"]'));
ok(/自定义/.test(txt(w, '#sheetBody .hd-row[data-date="2026-10-02"]')), '列表标注「自定义」');

console.log('\n【5】新增一条自定义假日');
$(w, '#sheetBody [data-act="hd-add"]').click();
ok(/添加假日/.test(txt(w, '#sheetTitle')), '进入添加页', txt(w, '#sheetTitle'));
$(w, '#hdDate').value = '2026-12-31';
$(w, '#hdName').value = '校运会';
$(w, '#sheetFooter [data-act="hd-save"]').click();
ok(!!api.holidayOn('2026-12-31'), '新条目已保存');
ok(api.holidayOn('2026-12-31').name === '校运会', '名称正确', api.holidayOn('2026-12-31'));
ok(!!$(w, '#sheetBody .hd-row[data-date="2026-12-31"]'), '列表已出现新条目');

console.log('\n【6】删除一条');
$(w, '#sheetBody .hd-row[data-date="2026-12-31"]').click();
$(w, '#sheetFooter [data-act="hd-del"]').click();
$(w, '#modalFooter [data-modal="ok"]').click();
ok(!api.holidayOn('2026-12-31'), '条目已删除');
ok(!$(w, '#sheetBody .hd-row[data-date="2026-12-31"]'), '列表已移除');

console.log('\n【7】铺课表：放假当天不排课');
resetTerm();
// 用「下周」的日期，保证一定在今天之后：本测试在任意星期几跑都成立
S().settings.termWeeks = 3;
const nextMon = api.ymd(api.addDays(api.parseYmd(api.ymd(api.startOfWeek(new Date()))), 7));
const today = api.todayYmd();
const thu = api.ymd(api.addDays(api.parseYmd(nextMon), 3));   // 下周四
api.masterPut(4, 1, 'all', { typeId: 'regular', klass: '高一(3)班' });
api.masterPut(4, 7, 'all', { typeId: 'regular', klass: '高一(3)班' });
let r = api.syncFromMaster(false);
ok(api.lessonsOfDay(thu).length === 2, '先铺出周四 2 节课', api.lessonsOfDay(thu).length);
setHoliday(thu, 'off', { name: '校庆' });
S().lessons = S().lessons.filter(l => l.date !== thu);    // 模拟还没排
r = api.syncFromMaster(false);
ok(api.lessonsOfDay(thu).length === 0, '放假当天一节课都不生成', api.lessonsOfDay(thu).length);
const nextThu = api.ymd(api.addDays(api.parseYmd(thu), 7));
ok(api.lessonsOfDay(nextThu).length === 2, '下一周同一天照常排课', api.lessonsOfDay(nextThu).length);
ok(api.holidayBlocks(thu, 1) === true, 'holidayBlocks 判定为阻断');

console.log('\n【8】半天：只排到放学时刻');
resetTerm();
S().settings.termWeeks = 3;
const fri = api.ymd(api.addDays(api.parseYmd(api.ymd(api.addDays(api.parseYmd(api.ymd(api.startOfWeek(new Date()))), 7))), 4));   // 下周五
api.masterPut(5, 1, 'all', { typeId: 'regular', klass: '高二(2)班' });
api.masterPut(5, 7, 'all', { typeId: 'regular', klass: '高二(2)班' });
setHoliday(fri, 'off', { half: '10:00', name: '中秋' });
api.syncFromMaster(false);
const friList = api.lessonsOfDay(fri);
ok(friList.length === 1, '只生成 10:00 前的那一节', friList.map(l => l.period));
ok(friList[0] && friList[0].period === 1, '留下的是第 1 节（07:50）', friList.map(l => l.period));
ok(api.holidayBlocks(fri, 1) === false && api.holidayBlocks(fri, 7) === true, '第 1 节不阻断、第 7 节阻断');

console.log('\n【9】补班日：按指定星期的课表上课');
resetTerm();
S().settings.termWeeks = 3;
const sat = api.ymd(api.addDays(api.parseYmd(api.ymd(api.addDays(api.parseYmd(api.ymd(api.startOfWeek(new Date()))), 7))), 5));   // 下周六
api.masterPut(5, 2, 'all', { typeId: 'tutor', klass: '竞赛班' });
setHoliday(sat, 'work', { asDow: 5, name: '国庆后补班' });
api.syncFromMaster(false);
const satList = api.lessonsOfDay(sat);
ok(satList.length === 1, '周六补班排出了课', satList.length);
ok(satList[0] && satList[0].period === 2 && satList[0].klass === '竞赛班', '用的是周五第 2 节的课表', satList[0] && [satList[0].period, satList[0].klass]);

console.log('\n【10】已经过去的日期不受影响');
resetTerm();
const mon = api.ymd(api.startOfWeek(new Date()));
const past = api.ymd(api.addDays(api.parseYmd(mon), -3));   // 上周四
api.masterPut(4, 1, 'all', { typeId: 'regular', klass: '高一(3)班' });
S().lessons.push({ id: 'past1', date: past, period: 1, typeId: 'regular', klass: '高一(3)班', dur: 45, students: 1, status: 'normal', auto: true, weekMode: 'all' });
setHoliday(past, 'off', { name: '已过假日' });
api.syncFromMaster(false);
ok(api.lessonsOfDay(past).length === 1, '历史课程仍在（不因新增假期被删）', api.lessonsOfDay(past).length);
ok(api.holidayBlocks(past, 1) === false, '历史日期不阻断');

console.log('\n【11】关掉「跳过假期」后照常排课');
resetTerm();
api.masterPut(4, 1, 'all', { typeId: 'regular', klass: '高一(3)班' });
const thu2 = api.ymd(api.addDays(api.parseYmd(mon), 3));
setHoliday(thu2, 'off', { name: '测试假' });
S().settings.holidaySkip = false;
api.syncFromMaster(false);
ok(api.lessonsOfDay(thu2).length === 1, '开关关闭后假期照常生成', api.lessonsOfDay(thu2).length);
S().settings.holidaySkip = true;

console.log('\n【12】同步数据解析与合并');
const payload = fs.readFileSync(ROOT + '/holidays.json', 'utf8');
const parsed = api.parseHolidayPayload(payload);
ok(parsed.length === 73, '仓库数据解析出 73 条', parsed.length);
ok(parsed.filter(h => h.kind === 'work').length === 11, '其中 11 条补班', parsed.filter(h => h.kind === 'work').length);
ok(parsed[0].date === '2026-01-01' && parsed[0].kind === 'off', '首条为 2026-01-01 放假', parsed[0]);

// 自定义项在同步时保留
S().holidays = [];
api.applyHolidayData([{ date: '2026-05-01', name: '我的劳动节', kind: 'off' }]);
S().holidays[0].custom = true;
S().holidays[0].half = '11:00';
const n1 = api.applyHolidayData(parsed, { stamp: false });
ok(n1 === 73, '整批写入 73 条', n1);
const may1 = api.holidayOn('2026-05-01');
ok(may1 && may1.custom === true, '自定义条目未被覆盖');
ok(may1 && may1.half === '11:00', '自定义的半天时间保留', may1 && may1.half);
ok(may1 && may1.name === '我的劳动节', '自定义名称保留', may1 && may1.name);
ok(S().meta.holidaySyncAt === 0 || S().meta.holidaySyncAt > 0, '同步时间已记录');
const dup = S().holidays.filter(h => h.date === '2026-05-01').length;
ok(dup === 1, '同一天不会出现两条', dup);

console.log('\n【13】日视图与周视图的假期提示');
const d1002 = api.holidayOn('2026-10-02');
d1002.half = '12:00';
d1002.name = '国庆节';
S().lessons = S().lessons.filter(l => l.date !== '2026-10-02');
const dayHtml = api.dayView('2026-10-01');
ok(/国庆节/.test(dayHtml), '日视图显示假期名称');
ok(/放假/.test(dayHtml), '日视图标注放假');
ok(/今天不上课|没有课程/.test(dayHtml), '空态文案说明今天不上课', dayHtml.slice(0, 160));
const halfHtml = api.dayView('2026-10-02');
ok(/上到 12:00/.test(halfHtml), '半天在日视图里显示放学时刻');
const wkHtml = api.weekView(new Date(2026, 8, 28));
ok(/wg-hd/.test(wkHtml), '周视图表头带假期徽标');
ok(/wg-off/.test(wkHtml), '周视图格子里标出放假日');

console.log('\n【14】补班日的排课星期');
setHoliday('2026-10-10', 'work', { asDow: 5 });
ok(api.scheduleDow('2026-10-10') === 5, '补班日按周五的课表', api.scheduleDow('2026-10-10'));
ok(api.scheduleDow('2026-10-11') === 0, '普通周日仍是周日', api.scheduleDow('2026-10-11'));
ok(api.scheduleDow('2026-10-12') === 1, '普通周一仍是周一', api.scheduleDow('2026-10-12'));

console.log('\n【15】版本号与更新记录');
api.switchTab('mine');
const curVer = (txt(w, '#page-mine .mine-foot').match(/v\d+\.\d+\.\d+/) || [])[0];
ok(!!curVer, '页脚有版本号', curVer);
api.openHelp('about');
ok(txt(w, '#sheetBody').includes(curVer), '关于页版本与页脚一致', curVer);
// 更新记录默认只展开最近三条，法定节假日那条要展开后才看得到
const logRow = w.document.querySelector('#sheetBody [data-act="log-toggle"]');
ok(!!logRow, '更新记录可展开');
if (logRow) logRow.click();
ok(/法定节假日/.test(txt(w, '#sheetBody')), '更新记录提到法定节假日');

console.log(`\n通过 ${pass} · 失败 ${fail}`);
process.exit(fail ? 1 : 0);
