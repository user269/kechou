/* 数据自检与修复 */
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
  repairState, save, calcMonth, todayYmd, uid, defaultTypes, DEFAULT_PERIODS,
};`);
  return w;
}

const w = boot();
const api = w.__api;
const S = api.state;

/** 重置成一份干净的最小数据，避免示例课干扰 */
function reset() {
  S.types = api.defaultTypes();
  S.periods = api.DEFAULT_PERIODS.map(p => ({ ...p }));
  S.lessons = [];
  S.master = {};
  S.extras = [];
  S.settings.remindBefore = 10;
  S.settings.termWeeks = 20;
  S.settings.defaultDur = 45;
}

console.log('\n【1】干净数据不该被"修"');
reset();
S.lessons.push({ id: 'l1', date: '2026-11-16', period: 1, typeId: 'regular', status: 'normal', dur: 45 });
const clean = api.repairState();
ok(clean.length === 0, '没有修复项', clean);
ok(S.lessons.length === 1 && S.lessons[0].typeId === 'regular', '数据原样保留');

console.log('\n【2】类型不存在 → 换成有效类型（否则金额会按错的单价算）');
reset();
S.lessons.push({ id: 'l2', date: '2026-11-16', period: 1, typeId: '已删除的类型', status: 'normal', dur: 45 });
const r2 = api.repairState();
ok(S.lessons[0].typeId !== '已删除的类型', '已改掉不存在的类型', S.lessons[0].typeId);
ok(S.types.some(t => t.id === S.lessons[0].typeId), '新类型确实存在', S.lessons[0].typeId);
ok(r2.some(x => /类型不存在/.test(x)), '有对应的提示文案', r2);

console.log('\n【3】日期不合法 → 改成今天');
reset();
S.lessons.push({ id: 'l3', date: '2026/13/45', period: 2, typeId: 'regular', status: 'normal', dur: 45 });
api.repairState();
ok(/^\d{4}-\d{2}-\d{2}$/.test(S.lessons[0].date), '日期变成合法格式', S.lessons[0].date);
ok(S.lessons[0].date === api.todayYmd(), '落在今天', S.lessons[0].date);

console.log('\n【4】早读（第 0 节）是合法节次，不能当成越界');
reset();
S.lessons.push({ id: 'l0', date: '2026-11-16', period: 0, typeId: 'morning', status: 'normal', dur: 30 });
const r0 = api.repairState();
ok(S.lessons[0].period === 0, '第 0 节保持不动', S.lessons[0].period);
ok(!r0.some(x => /节次/.test(x)), '没有把第 0 节报成越界', r0);
ok(S.periods.every((p, i) => p.no === i), '默认作息的编号没被改号', S.periods.map(p => p.no).slice(0, 4));

console.log('\n【5】节次越界 → 夹到作息范围内');
reset();
S.lessons.push({ id: 'l4', date: '2026-11-16', period: 99, typeId: 'regular', status: 'normal', dur: 45 });
S.lessons.push({ id: 'l5', date: '2026-11-16', period: -3, typeId: 'regular', status: 'normal', dur: 45 });
api.repairState();
const nos = S.periods.map(p => p.no);
ok(S.lessons[0].period === Math.max(...nos), '过大的节次夹到最后一节', S.lessons[0].period);
ok(S.lessons[1].period === Math.min(...nos), '负数节次夹到第一节', S.lessons[1].period);

console.log('\n【5】重复的课程类型 → 去重（否则单价看运气）');
reset();
S.types.push({ ...S.types[0] });            // 同一个 id 再来一份
const r5 = api.repairState();
const ids = S.types.map(t => t.id);
ok(new Set(ids).size === ids.length, '类型 id 不重复', ids);
ok(r5.some(x => /重复/.test(x)), '有去重提示', r5);

console.log('\n【6】作息表丢了 → 恢复默认（不能留空数组）');
reset();
S.periods = [];
api.repairState();
ok(S.periods.length > 0, '作息非空', S.periods.length);
ok(/^\d{2}:\d{2}$/.test(S.periods[0].start), '节次时间合法', S.periods[0].start);

console.log('\n【7】时长非法 → 恢复默认');
reset();
S.lessons.push({ id: 'l7', date: '2026-11-16', period: 1, typeId: 'regular', status: 'normal', dur: -20 });
S.lessons.push({ id: 'l8', date: '2026-11-16', period: 2, typeId: 'regular', status: 'normal', dur: 'abc' });
api.repairState();
ok(S.lessons[0].dur === 45, '负数时长改回默认', S.lessons[0].dur);
ok(S.lessons[1].dur === 45, '非数字时长改回默认', S.lessons[1].dur);

console.log('\n【8】总课表的坏键 → 移除');
reset();
S.master['1#1#all'] = { typeId: 'regular', klass: '高一(1)班' };
S.master['坏键'] = { typeId: 'regular' };
S.master['9#1#all'] = { typeId: 'regular' };       // 星期越界
S.master['1#99#all'] = { typeId: 'regular' };      // 节次越界
S.master['1#2#all'] = { typeId: '不存在' };         // 类型无效
const r8 = api.repairState();
ok(!!S.master['1#1#all'], '合法格子保留');
ok(!S.master['坏键'] && !S.master['9#1#all'] && !S.master['1#99#all'], '坏键被清掉', Object.keys(S.master));
ok(!S.master['1#2#all'], '类型无效的格子也清掉');
ok(r8.some(x => /总课表/.test(x)), '有提示', r8);

console.log('\n【9】数值设置越界 → 夹回范围');
reset();
S.settings.remindBefore = 999;
S.settings.termWeeks = 0;
S.settings.defaultDur = -5;
api.repairState();
ok(S.settings.remindBefore === 120, '提醒分钟数上限', S.settings.remindBefore);
ok(S.settings.termWeeks === 1, '学期周数下限', S.settings.termWeeks);
ok(S.settings.defaultDur === 1, '默认时长下限', S.settings.defaultDur);

console.log('\n【10】补贴金额不是数字 → 移除这一条');
reset();
S.extras.push({ id: 'x1', name: '津贴', amount: 600, kind: 'add', cycle: 'monthly', date: '2026-11-01' });
S.extras.push({ id: 'x2', name: '坏数据', amount: 'abc', kind: 'add', cycle: 'once', date: '2026-11-01' });
S.extras.push({ id: '', name: '没有 id', amount: 10, kind: 'add', cycle: 'once', date: '2026-11-01' });
api.repairState();
ok(S.extras.length === 1, '只剩有效的那条', S.extras.map(e => e.name));
ok(S.extras[0].id === 'x1', '留下的是正确记录');

console.log('\n【11】修完之后金额算得对（端到端）');
reset();
S.settings.scheme = 'standard';
S.settings.useClassFactor = false;
S.lessons.push({ id: 'e1', date: '2026-11-16', period: 1, typeId: 'ghost', status: 'normal', dur: 45 });
api.repairState();
const m = api.calcMonth('2026-11');
const regular = S.types.find(t => t.id === 'regular');
ok(m.count === 1, '统计到 1 节', m.count);
ok(m.total === regular.price, '按修好后的类型单价结算', [m.total, regular.price]);

console.log('\n【12】整份数据被打烂也能救回来');
reset();
S.lessons = [{ id: 'a', date: 'x', period: 0, typeId: null }, null, 'not an object', { date: '2026-11-16' }];
S.types = [{ id: 'only', name: '唯一', unit: 'period', price: 50, factor: 1, enabled: true }];
S.periods = null;
const r12 = api.repairState();
ok(Array.isArray(S.lessons) && S.lessons.length === 2, '丢掉非对象记录，保留两条', S.lessons.length);
ok(S.lessons.every(l => l.id && l.typeId === 'only'), '每条都有 id 且指向唯一类型', S.lessons.map(l => [l.id, l.typeId]));
ok(Array.isArray(S.periods) && S.periods.length > 0, '作息被恢复', S.periods && S.periods.length);
ok(r12.length > 0, '有修复记录', r12.length);

console.log('\n【13】连续调用两次，第二次不该再修（幂等）');
const again = api.repairState();
ok(again.length === 0, '第二次没有新修复', again);

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
