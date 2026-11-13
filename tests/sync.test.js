/* 多设备同步：修订跟踪 + 双向合并 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};

/**
 * 起一台「设备」：独立 JSDOM + 独立 state。
 * 所有设备的时钟由同一个 clock 驱动——真实两台手机的时钟是各自走的，
 * 这里必须能精确控制先后，否则「谁更新」根本测不出来。
 */
const clock = { t: 1000000 };
const wins = [];

function boot(nativeStub) {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  html = html.replace(/<script[^>]*src=[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'https://kebao.local/', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.__now = clock.t;
  w.Notification = class { static permission = 'granted'; static requestPermission() { return Promise.resolve('granted'); } };
  // 必须在执行 app.js 之前挂上：app.js 顶部的 `const NATIVE = window.KebaoNative` 是执行时求值的。
  // 基础能力统一补齐，各场景只声明自己关心的差异，免得初始化时到处报"不是函数"。
  if (nativeStub) {
    w.KebaoNative = Object.assign({
      version: () => '1.1.1',
      syncReminders: () => '{"ok":true}',
      syncRemindersEcho: () => '{"ok":true}',
      hasNotifyPermission: () => true,
      requestNotifyPermission: () => { },
      canScheduleExact: () => true,
      saveFileAs: () => { },
    }, nativeStub);
  }
  w.eval(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8') + `
window.__now = ${clock.t};
Date.now = () => window.__now;
window.__api = {
  get state() { return state; },
  set state(v) { state = v; },
  save, trackChanges, collectEntities, stableKey, shortHash,
  buildSyncPacket, parseSyncPacket, mergeSyncPacket, deviceInfo, setDeviceName, pruneSyncMeta,
  openSyncSheet, lanStart, lanStop, lanScan, lanAskCode, lanGo, lanDrainInbox, hasLan, syncMineSub,
  nativeInfo, lanBodyHtml,
  get lanInfo() { return lanInfo; },
  get lanPeers() { return lanPeers; },
  now() { return Date.now(); },
};`);
  wins.push(w);
  return w;
}

/** 推进所有设备的时钟，保证「先做的操作时间一定更早」 */
function tick(ms) {
  clock.t += (ms || 1000);
  wins.forEach(w => { w.__now = clock.t; });
}

/** 拿某台设备的名字，用于断言 */
const fromName = api => (api.state.meta.deviceName || 'A 手机');

const mkLesson = (id, date, period, extra) => ({
  id, date, period, typeId: 'regular', klass: '高一(3)班', status: 'normal', dur: 45, ...(extra || {}),
});

const wa = boot(), wb = boot();
const A = wa.__api, B = wb.__api;

const reset = (api, name) => {
  api.state.lessons.length = 0;
  api.state.swaps.length = 0;
  api.state.adjusts.length = 0;
  api.state.extras.length = 0;
  api.state.schemes.length = 0;
  api.state.master = {};
  api.state.settings.termWeeks = 20;
  api.state.settings.remindBefore = 10;
  api.state.meta.deviceName = name;
  api.state.meta.rev = {}; api.state.meta.fp = {}; api.state.meta.tomb = {};
  api.state.meta.syncInit = 0;
  tick();
  api.save();
};
reset(A, 'A 手机');
reset(B, 'B 手机');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runTests() {
console.log('\n【1】首次基线：两端都是历史数据，合并后谁都不丢');
A.state.lessons.push(mkLesson('l_a', '2026-11-16', 1));
tick(); A.save();
B.state.lessons.push(mkLesson('l_b', '2026-11-16', 2));
tick(); B.save();
ok(A.state.meta.rev['l:l_a'] > 0, '新加的课记了修订时间', A.state.meta.rev['l:l_a']);

// 倒回「基线 0」：模拟从旧版本升上来，历史数据没有修订时间
A.state.meta.rev['l:l_a'] = 0; A.state.meta.tomb = {};
B.state.meta.rev['l:l_b'] = 0; B.state.meta.tomb = {};
const s1 = B.mergeSyncPacket(A.buildSyncPacket());
ok(B.state.lessons.length === 2, 'B 合并后两节课都在', B.state.lessons.map(l => l.id));
ok(s1.added === 1, '统计出新增 1 条', s1);

console.log('\n【2】各自新增：合完是并集，不是谁覆盖谁');
tick(); A.state.lessons.push(mkLesson('l_a2', '2026-11-17', 3)); A.save();
tick(); B.state.lessons.push(mkLesson('l_b2', '2026-11-18', 4)); B.save();
B.mergeSyncPacket(A.buildSyncPacket());
A.mergeSyncPacket(B.buildSyncPacket());
const idsA = A.state.lessons.map(l => l.id).sort();
const idsB = B.state.lessons.map(l => l.id).sort();
ok(idsA.length === 4, 'A 合并后 4 节', idsA);
ok(JSON.stringify(idsA) === JSON.stringify(idsB), '两台结果一致', [idsA, idsB]);

console.log('\n【3】同一条记录都改过：取时间新的那个');
tick();
A.state.lessons.find(l => l.id === 'l_a').klass = 'A改的班';
A.save();
tick();
B.state.lessons.find(l => l.id === 'l_a').klass = 'B改的班';
B.save();
B.mergeSyncPacket(A.buildSyncPacket());
ok(B.state.lessons.find(l => l.id === 'l_a').klass === 'B改的班', 'B 保留自己较新的改动');
A.mergeSyncPacket(B.buildSyncPacket());
ok(A.state.lessons.find(l => l.id === 'l_a').klass === 'B改的班', 'A 接受了 B 较新的改动');

console.log('\n【4】删除同步：一方删掉，另一方也删');
tick();
A.state.lessons = A.state.lessons.filter(l => l.id !== 'l_b');
A.save();
ok(!!A.state.meta.tomb['l:l_b'], '删除留下了墓碑', A.state.meta.tomb);
const s4 = B.mergeSyncPacket(A.buildSyncPacket());
ok(!B.state.lessons.some(l => l.id === 'l_b'), 'B 也删掉了', B.state.lessons.map(l => l.id));
ok(s4.removed === 1, '统计出删除 1 条', s4);

console.log('\n【5】删了之后又被改：较新的修改让记录活过来');
tick();
A.state.lessons = A.state.lessons.filter(l => l.id !== 'l_b2');
A.save();                          // A 删除 l_b2
tick();
B.state.lessons.find(l => l.id === 'l_b2').klass = 'B又改了';
B.save();                          // B 在删除之后又改了这条
B.mergeSyncPacket(A.buildSyncPacket());
ok(B.state.lessons.some(l => l.id === 'l_b2'), 'B 端记录没被旧删除标记带走');
A.mergeSyncPacket(B.buildSyncPacket());
ok(A.state.lessons.some(l => l.id === 'l_b2'), 'A 端记录也回来了', A.state.lessons.map(l => l.id));

console.log('\n【6】配置按字段合并：改周数和改提醒提前量互不覆盖');
const aTiers = JSON.parse(JSON.stringify(A.state.settings.tiers));
tick();
A.state.settings.termWeeks = 22;
A.save();
tick();
B.state.settings.remindBefore = 20;
B.save();
B.mergeSyncPacket(A.buildSyncPacket());
A.mergeSyncPacket(B.buildSyncPacket());
ok(A.state.settings.termWeeks === 22 && A.state.settings.remindBefore === 20, 'A 两个字段都对', [A.state.settings.termWeeks, A.state.settings.remindBefore]);
ok(B.state.settings.termWeeks === 22 && B.state.settings.remindBefore === 20, 'B 两个字段都对', [B.state.settings.termWeeks, B.state.settings.remindBefore]);
ok(JSON.stringify(A.state.settings.tiers) === JSON.stringify(aTiers), '没动过的阶梯没被改坏');

console.log('\n【7】课程类型整条更新');
tick();
A.state.types.find(t => t.id === 'regular').price = 88;
A.save();
B.mergeSyncPacket(A.buildSyncPacket());
ok(B.state.types.find(t => t.id === 'regular').price === 88, 'B 收到新单价', B.state.types.find(t => t.id === 'regular').price);

console.log('\n【8】总课表（键值结构）也能合并');
tick();
A.state.master['1#1#all'] = { typeId: 'regular', klass: '高一(3)班' };
A.state.master['2#3#all'] = { typeId: 'self', klass: '' };
A.save();
tick();
B.state.master['5#7#all'] = { typeId: 'night', klass: '高二(2)班' };
B.save();
B.mergeSyncPacket(A.buildSyncPacket());
A.mergeSyncPacket(B.buildSyncPacket());
ok(Object.keys(A.state.master).length === 3, 'A 拿到 3 个键', Object.keys(A.state.master));
ok(!!A.state.master['5#7#all'] && !!A.state.master['1#1#all'], '两边的键都在');

console.log('\n【9】幂等：同一份包合两次，第二次没有新变化');
const s9a = A.mergeSyncPacket(B.buildSyncPacket());
ok(s9a.added === 0 && s9a.updated === 0 && s9a.removed === 0, '第二次合并无变化', s9a);
const s9b = B.mergeSyncPacket(A.buildSyncPacket());
ok(s9b.added === 0 && s9b.updated === 0 && s9b.removed === 0, '反向也无变化', s9b);

console.log('\n【10】合并不会把刚合进来的记录当成「本地新改」');
const before = A.state.meta.rev['l:l_a2'];
tick(5000);
A.save();
ok(A.state.meta.rev['l:l_a2'] === before, '合并后 save 不改修订时间', [before, A.state.meta.rev['l:l_a2']]);

console.log('\n【11】同步包结构');
const pkt = A.buildSyncPacket();
ok(pkt.kb === 'kbsync', '有格式标记');
ok(pkt.v === 1, '版本号 1');
ok(!!pkt.device && !!pkt.device.id && pkt.device.name === 'A 手机', '带上设备信息', pkt.device);
ok(!!pkt.data && Array.isArray(pkt.data.lessons), '带上课表');
ok(!('updateCache' in (pkt.data.settings || {})), '配置里不含更新缓存');
ok(!('lastUpdateOk' in (pkt.data.settings || {})), '配置里不含上次检查时间');

console.log('\n【12】非法输入给出中文原因');
const bad = (input, name) => {
  try { A.parseSyncPacket(input); ok(false, name + '（本该报错）'); }
  catch (e) { ok(/同步包|课酬|版本/.test(e.message), name, e.message); }
};
bad('不是 json', '纯文本');
bad('{"kb":"other"}', '别的格式');
bad('{"kb":"kbsync","v":9,"data":{}}', '版本过高');
bad('{"kb":"kbsync","v":1}', '缺少数据');

console.log('\n【13】字符串形式的包也能吃');
ok(A.parseSyncPacket(JSON.stringify(A.buildSyncPacket())).kb === 'kbsync', '字符串解析正常');

console.log('\n【14】墓碑会被清理，不会一直堆着');
const nowMs = A.now();
A.state.meta.tomb['l:ancient'] = nowMs - 200 * 86400000;
A.state.meta.tomb['l:recent'] = nowMs - 3 * 86400000;
A.pruneSyncMeta();
ok(!A.state.meta.tomb['l:ancient'], '超过 180 天的墓碑清掉了');
ok(!!A.state.meta.tomb['l:recent'], '3 天前的墓碑还留着');

console.log('\n【15】空设备收到全部数据');
const wc = boot();
const C = wc.__api;
C.state.lessons.length = 0; C.state.master = {};
tick(); C.save();
const s15 = C.mergeSyncPacket(A.buildSyncPacket());
ok(C.state.lessons.length === A.state.lessons.length, '条数一致', [C.state.lessons.length, A.state.lessons.length]);
ok(s15.added > 0, '统计有新增', s15);

console.log('\n【16】三台设备串起来也不重复');
C.mergeSyncPacket(B.buildSyncPacket());
B.mergeSyncPacket(C.buildSyncPacket());
A.mergeSyncPacket(C.buildSyncPacket());
const uniq = new Set(A.state.lessons.map(l => l.id));
ok(uniq.size === A.state.lessons.length, 'A 没有重复记录', A.state.lessons.length);
ok(A.state.lessons.length === C.state.lessons.length, 'A 与 C 条数一致', [A.state.lessons.length, C.state.lessons.length]);

console.log('\n【17】局域网通道：原生返回的那串 JSON 能正确消化');
let published = null, scanned = 0;
const wl = boot({
  version: () => '1.1.1',
  lanStart: () => JSON.stringify({ ok: true, ip: '192.168.1.23', port: 8801, code: '3847' }),
  lanStop: () => { },
  lanPublish: j => { published = j; },
  lanScanStart: () => JSON.stringify({ ok: true }),
  lanScanResult: () => JSON.stringify({ ok: true, scanning: false, peers: [
    { ip: '192.168.1.23', port: 8801, name: '自己' },        // 自己不该出现
    { ip: '192.168.1.57', port: 8801, name: 'Xiaomi 14' },
  ] }),
  lanSyncStart: () => JSON.stringify({ ok: true }),
  lanSyncPoll: () => JSON.stringify({ state: 'done', result: { ok: true, pulled: A.buildSyncPacket(), pushed: true } }),
  lanInbox: () => JSON.stringify({ items: [] }),
  deviceName: () => 'Redmi K70',
});
const L = wl.__api;
ok(L.hasLan() === true, '识别到原生能力', L.hasLan());
L.openSyncSheet();
L.lanStart();
ok(L.lanInfo.on === true, '开启后状态正确', L.lanInfo);
ok(L.lanInfo.ip === '192.168.1.23' && L.lanInfo.port === 8801, '拿到本机地址', L.lanInfo);
ok(!!published && JSON.parse(published).kb === 'kbsync', '开始就把本机包交给原生缓存');

L.lanScan();
await sleep(900);
ok(L.lanPeers.length === 1, '扫到 1 台（自己已被过滤）', L.lanPeers.map(p => p.name));
ok(L.lanPeers[0].ip === '192.168.1.57', '留下的是对方', L.lanPeers[0]);

ok(L.lanInfo.code === '3847', '拿到配对码', L.lanInfo.code);

const beforeLessons = L.state.lessons.length;
L.lanAskCode({ dataset: { ip: '192.168.1.57', port: '8801', name: 'Xiaomi 14' } });
ok(!!wl.document.querySelector('#lan-code'), '点设备会先要配对码');
wl.document.querySelector('#lan-code').value = '3847';
L.lanGo();
await sleep(800);
ok(L.state.lessons.length >= beforeLessons, '同步后课程没有减少', [beforeLessons, L.state.lessons.length]);
ok(L.state.meta.syncPeer === 'Xiaomi 14' || L.state.meta.syncPeer === fromName(A), '记下了同步对象', L.state.meta.syncPeer);

console.log('\n【18】对方推过来的包：正常合、坏包跳过');
const wl2 = boot({
  version: () => '1.1.1',
  lanStart: () => JSON.stringify({ ok: true, ip: '192.168.1.23', port: 8801 }),
  lanScanStart: () => '{"ok":true}',
  lanSyncStart: () => '{"ok":true}',
  lanInbox: () => JSON.stringify({ items: [
    { from: 'Xiaomi 14', packet: '{这不是 json' },     // 坏包，应被跳过
    { from: 'Xiaomi 14', packet: A.buildSyncPacket() },
  ] }),
  lanPublish: () => { },
});
const L2 = wl2.__api;
L2.state.lessons.length = 0;
L2.state.master = {};
L2.state.meta.rev = {}; L2.state.meta.fp = {}; L2.state.meta.tomb = {}; L2.state.meta.syncInit = 0;
tick(); L2.save();

L2.openSyncSheet();
L2.lanInfo.on = true;
L2.lanDrainInbox();
ok(L2.state.lessons.length === A.state.lessons.length, '好包合进来了、坏包没影响', [L2.state.lessons.length, A.state.lessons.length]);

console.log('\n【19】原生报错时不崩，只提示');
const wl3 = boot({
  version: () => '1.1.1',
  lanStart: () => JSON.stringify({ ok: false, msg: '没能开启：端口被占用' }),
  lanPublish: () => { },
  lanScanStart: () => 'not json at all',
  lanScanResult: () => 'not json',
  lanSyncStart: () => 'not json',
  lanSyncPoll: () => 'not json',
  lanInbox: () => 'broken',
  deviceName: () => '',
});
const L3 = wl3.__api;
L3.openSyncSheet();
L3.lanStart();
ok(L3.lanInfo.on === false, '启动失败时状态仍是关的', L3.lanInfo);
L3.lanInfo.on = true;
let threw = false;
try { L3.lanScan(); } catch (e) { threw = true; }
ok(!threw, '扫描返回垃圾也不抛异常');
L3.lanAskCode({ dataset: { ip: '1.2.3.4', port: '9', name: 'x' } });
const codeInput = wl3.document.querySelector('#lan-code');
if (codeInput) codeInput.value = '1234';
let threw2 = false;
try { L3.lanGo(); } catch (e) { threw2 = true; }
await sleep(500);
ok(!threw2, '同步失败不抛异常');

console.log('\n【20】配对码不是 4 位数字就不放行');
let called = 0;
const wl4 = boot({
  version: () => '1.1.1',
  lanStart: () => JSON.stringify({ ok: true, ip: '192.168.1.23', port: 8801, code: '3847' }),
  lanScanStart: () => '{"ok":true}',
  lanSyncStart: () => { called++; return '{"ok":true}'; },
  lanSyncPoll: () => '{"state":"idle"}',
  lanPublish: () => { },
  lanInbox: () => '{"items":[]}',
  deviceName: () => 'X',
});
const L4 = wl4.__api;
L4.openSyncSheet();
L4.lanAskCode({ dataset: { ip: '192.168.1.57', port: '8801', name: 'A' } });
const inp = wl4.document.querySelector('#lan-code');
inp.value = '12';
L4.lanGo();
ok(called === 0, '两位数字不发请求', called);
inp.value = 'abcd';
L4.lanGo();
ok(called === 0, '非数字不发请求', called);

console.log('\n【21】界面是新的、安装包是旧的（这次的线上问题）');
// 旧 APK：有 KebaoNative（能存文件），但没有后来加的局域网方法
const wOld = boot({
  version: () => '1.0.23',
  saveFileAs: () => { },
  deviceName: () => 'V2302A',
});
const OLD = wOld.__api;
const info = OLD.nativeInfo();
ok(info.native === true, '认得出是在手机里跑', info);
ok(info.lan === false, '局域网能力判定为不可用', info.lan);
ok(info.missing.length === 4, '四个方法都缺', info.missing);
ok(info.version === '1.0.23', '读到了安装包版本', info.version);

const htmlOld = OLD.lanBodyHtml();
ok(/1\.0\.23/.test(htmlOld), '提示里带上安装包版本');
ok(/还不支持局域网直传/.test(htmlOld), '说清楚是安装包的问题');
ok(/更新安装包/.test(htmlOld), '给了更新按钮');
ok(!/网页版没有局域网能力/.test(htmlOld), '不再误报成「网页版」');

OLD.openSyncSheet();
const sheetTxt = (wOld.document.querySelector('#sheetBody') || {}).textContent || '';
ok(/更新安装包/.test(sheetTxt), '面板里确实显示了更新入口');

console.log('\n【22】真·浏览器打开时说「网页版」');
const wWeb = boot();
const WEB = wWeb.__api;
ok(WEB.nativeInfo().native === false, '没有 Native', WEB.nativeInfo());
ok(/网页版没有局域网能力/.test(WEB.lanBodyHtml()), '才是网页版文案');

console.log('\n【23】能力齐全时说「开启接收」');
const wOk = boot({
  version: () => '1.1.1',
  lanStart: () => '{"ok":true,"ip":"1.2.3.4","port":1,"code":"0000"}',
  lanScanStart: () => '{"ok":true}',
  lanSyncStart: () => '{"ok":true}',
  lanInbox: () => '{"items":[]}',
  lanPublish: () => { },
});
const OK = wOk.__api;
ok(OK.nativeInfo().lan === true, '能力齐全');
ok(/开启接收/.test(OK.lanBodyHtml()), '显示开启接收入口', OK.lanBodyHtml().slice(0, 40));

console.log('\n【24】缺一个方法也要当成不可用（1.0.25 那种半新不旧的包）');
const wHalf = boot({
  version: () => '1.0.25',
  lanStart: () => '{"ok":true}',      // 有 lanStart
  lanInbox: () => '{"items":[]}',
  lanSyncStart: () => '{"ok":true}',
  // 少了 lanScanStart —— 点「查找」会静默失败
});
const HALF = wHalf.__api;
const halfInfo = HALF.nativeInfo();
ok(halfInfo.lan === false, '缺一个就判不可用', halfInfo.missing);
ok(halfInfo.missing.includes('lanScanStart'), '指出缺的是哪个', halfInfo.missing);

}  // runTests

runTests().then(() => {
  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
}).catch(e => {
  console.error('测试自身出错：', e);
  process.exit(1);
});
