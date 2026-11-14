/* 界面：我的页排版、文案精简、二级菜单合并 */
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
  get state(){return state}, switchTab, render, calcMonth, money, todayYmd,
  weekIndexOf, weekParity, lessonEnd, addDays, ymd, startOfWeek, openHelp,
  checkUpdate, openSwapCenter, openBackupSheet, openCalcRules, openClassFactorSheet,
  openScheduleIO, openUpdateSheet, UPD
};`);
  return w;
}
const $ = (w, s) => w.document.querySelector(s);
const $$ = (w, s) => [...w.document.querySelectorAll(s)];
const txt = (w, s) => ($(w, s) ? $(w, s).textContent.replace(/\s+/g, ' ').trim() : '');
const close = w => { const ov = $(w, '#overlay'); if (ov) ov.classList.remove('show'); };

console.log('\n【1】身份卡：三格指标取自真数据');
const w = boot();
const api = w.__api;
api.switchTab('mine');
ok(!!$(w, '#page-mine .mine-profile'), '渲染了身份卡');
const kpis = $$(w, '#page-mine .mp-kpis > div').map(d => ({
  v: d.querySelector('b').textContent.trim(), k: d.querySelector('span').textContent.trim(),
}));
ok(kpis.map(x => x.k).join('/') === '本月课时/本月课酬/本周剩余', '三格标签', kpis.map(x => x.k));
const m = api.calcMonth(api.todayYmd().slice(0, 7));
ok(Number(kpis[0].v) === m.count, '本月课时与 calcMonth 一致', [kpis[0].v, m.count]);
ok(kpis[1].v === api.money(m.total), '本月课酬格式与 money() 一致', [kpis[1].v, api.money(m.total)]);

console.log('\n【2】本周剩余：只算今天没上完的 + 本周余下几天');
{
  const w2 = boot();
  const a2 = w2.__api;
  const t0 = a2.todayYmd();
  // 今天是几点会影响「今天上没上完」，所以按当前时刻挑一节已结束、一节还没开始的课，
  // 这样测试在早上、中午、夜里跑都成立（原写法按固定节次，换时段就会挂）。
  const endOf = no => a2.lessonEnd({ date: t0, period: no, durAuto: true });
  const past = a2.state.periods.filter(p => endOf(p.no) < new Date()).map(p => p.no).pop();
  const future = a2.state.periods.filter(p => endOf(p.no) > new Date()).map(p => p.no)[0];
  if (past && future && future !== past) {
    a2.state.lessons = [
      { id: 'e1', date: t0, period: past, typeId: 'regular', status: 'normal', dur: 45 },
      { id: 'e2', date: t0, period: future, typeId: 'regular', status: 'normal', dur: 45 },
      { id: 'n1', date: a2.ymd(a2.addDays(new Date(), 7)), period: 2, typeId: 'regular', status: 'normal', dur: 45 },
      { id: 'l1', date: t0, period: future, typeId: 'regular', status: 'leave', dur: 45 },
    ];
    a2.switchTab('home'); a2.switchTab('mine');
    const rest = Number($$(w2, '#page-mine .mp-kpis > div')[2].querySelector('b').textContent);
    ok(rest === 1, '只算今天还没上完的那节，请假与下周都不算', rest);
  } else {
    ok(true, '当前时刻找不到「已结束 + 未开始」的组合，跳过');
  }
}

console.log('\n【3】学期卡：周次、单双周、剩余周数');
{
  const wk = api.weekIndexOf(api.todayYmd());
  const total = api.state.settings.termWeeks;
  ok(new RegExp(`第 ${wk} 周 / 共 ${total} 周`).test(txt(w, '#page-mine .mt-title')), '当前周与总周数', txt(w, '#page-mine .mt-title'));
  ok(/单周|双周/.test(txt(w, '#page-mine .mt-badge')), '单双周徽标');
  const barW = $(w, '#page-mine .mt-bar i').getAttribute('style');
  ok(barW.includes(`width:${Math.min(100, Math.round((wk / total) * 100))}%`), '进度条宽度按周数计算', barW);
  const sub = txt(w, '#page-mine .mt-sub');
  ok(/^还剩 \d+ 周$/.test(sub) || sub === '本学期已结束', '副标题只写剩余周数，不重复周次', sub);
  ok($(w, '#page-mine .mine-term').dataset.act === 'open-term', '整卡可点进学期设置');
}

console.log('\n【4】分组结构与行数');
{
  const labels = $$(w, '#page-mine .section-label').map(e => e.textContent.trim());
  ok(labels.join('/') === '计费/课表与提醒/数据/帮助与关于', '四个分组', labels);
  const rowsOf = idx => {
    const el = $$(w, '#page-mine .section-label')[idx].nextElementSibling;
    return el && el.classList.contains('rows') ? el.querySelectorAll('.row').length : 0;
  };
  ok(rowsOf(0) === 2, '计费 2 行（班级系数并入计费公式）', rowsOf(0));
  ok(rowsOf(1) === 4, '课表与提醒 4 行', rowsOf(1));
  ok(rowsOf(2) === 4, '数据 4 行（含多设备同步）', rowsOf(2));
  ok($$(w, '#page-mine .row').length === 10, '整页 10 行', $$(w, '#page-mine .row').length);
  ok($$(w, '#page-mine .mine-actions').length === 0, '不再有并排的次级按钮');
}

console.log('\n【5】每行只说一件事');
{
  const subs = $$(w, '#page-mine .row')
    .map(r => (r.querySelector('.s') ? r.querySelector('.s').textContent.trim() : ''))
    .filter(Boolean);
  ok(subs.every(t => t.length <= 16), '副标题都很短', subs);
  const all = txt(w, '#page-mine');
  ['决定上课时长与提醒时刻', '提前时间、每日小结、通知权限', '正课、自习等分开计价',
    '总课表变成一段文本', 'JSON 文件可换机恢复', '点此调整'].forEach(x =>
    ok(!all.includes(x), `已删掉冗余说明：${x}`));
  ok(!/资源 \d|versionCode|CDN|update\.json/.test(all), '页面不出现技术术语');
  ok(/数据只保存在本机/.test(txt(w, '#topbarRow')), '页头一句话交代数据在哪', txt(w, '#topbarRow'));
}

console.log('\n【6】提醒收成一行，开关与入口合一');
{
  const row = $(w, '#page-mine .row[data-act="open-remind"]');
  ok(!!row, '课前提醒整行可点');
  ok(/提前 \d+ 分钟|已关闭/.test(row.textContent), '副标题写出提前时间', row.textContent.trim());
  ok(!!row.querySelector('.switch[data-act="toggle-remind"]'), '行内保留开关');
  row.click();
  ok(txt(w, '#sheetTitle') === '提醒设置', '点开提醒设置', txt(w, '#sheetTitle'));
  close(w);
}

console.log('\n【7】调休与调课合并为一张面板');
{
  const row = $(w, '#page-mine .row[data-act="open-swap-center"]');
  ok(!!row && /调课与调休/.test(row.textContent), '入口为「调课与调休」');
  row.click();
  ok(txt(w, '#sheetTitle') === '调课与调休', '面板标题', txt(w, '#sheetTitle'));
  const tabBox = $$(w, '#sheetBody .segmented')[0];
  const tabs = [...tabBox.querySelectorAll('button')].map(b => b.textContent.trim());
  ok(tabs.join('/') === '调休规则/调课记录', '两个标签', tabs);
  tabBox.querySelectorAll('button')[1].click();
  ok(/还没有调课/.test(txt(w, '#sheetBody')), '可切到调课记录', txt(w, '#sheetBody').slice(0, 24));
  $$(w, '#sheetBody .segmented')[0].querySelectorAll('button')[0].click();
  ok(/启用调休规则/.test(txt(w, '#sheetBody')), '切回调休规则', txt(w, '#sheetBody').slice(0, 24));
  close(w);
}

console.log('\n【8】备份与恢复合成一个入口');
{
  const row = $(w, '#page-mine .row[data-act="open-backup"]');
  ok(!!row && /备份与恢复/.test(row.textContent), '入口为「备份与恢复」');
  row.click();
  const acts = $$(w, '#sheetBody [data-act]').map(e => e.dataset.act);
  ok(acts.includes('export-data') && acts.includes('import-data'), '导出与恢复都在里面', acts);
  ok(/覆盖/.test(txt(w, '#sheetBody')), '提示恢复会覆盖数据');
  close(w);
}

console.log('\n【9】班级系数收进计费公式');
{
  api.switchTab('mine');
  $(w, '#page-mine .row[data-act="open-calc-rules"]').click();
  ok(!/班级系数/.test(txt(w, '#page-mine')), '我的页不再单列班级系数');
  const row = $(w, '#sheetBody .row[data-act="open-class-factor"]');
  ok(!!row, '计费公式里有班级系数入口');
  ok(/\d+ 条关键词/.test(row.textContent), '写明关键词条数', row.textContent.trim());
  row.click();
  ok(/班级系数/.test(txt(w, '#sheetTitle')), '能打开班级系数面板', txt(w, '#sheetTitle'));
  close(w);
}

console.log('\n【10】批量导入收进导入导出');
{
  api.switchTab('mine');
  $(w, '#page-mine .row[data-act="open-schedule-io"]').click();
  $$(w, '#sheetBody .segmented')[0].querySelectorAll('button')[1].click();
  const row = $(w, '#sheetBody .row[data-act="open-import"]');
  ok(!!row && /按行批量导入/.test(row.textContent), '导入页里有批量导入入口');
  close(w);
}

console.log('\n【11】帮助三格 + 页脚');
{
  api.switchTab('mine');
  const links = $$(w, '#page-mine .mine-links > div');
  ok(links.length === 3, '三格');
  ok(links.map(l => l.dataset.h).join('/') === 'faq/guide/about', 'data-h 完整', links.map(l => l.dataset.h));
  ok(links.map(l => l.querySelector('b').textContent).join('/') === '快捷帮助/使用说明/关于', '标题文案');
  const ver = $(w, '#page-mine .mine-foot .ver');
  const curVer = (ver.textContent.match(/v\d+\.\d+\.\d+[a-z]?/) || [])[0];
  ok(links[2].textContent.includes(curVer), '关于格显示版本号', links[2].textContent.trim());
  ok(ver.dataset.act === 'check-update', '页脚版本号点了是检查更新', ver.dataset.act);
  ok(/^v\d+\.\d+\.\d+[a-z]? · 检查更新$/.test(ver.textContent.trim()), '页脚只留一行', ver.textContent.trim());
  ok(!/浏览器|不会上传/.test(txt(w, '#page-mine .mine-foot')), '页脚不再堆说明');
}

console.log('\n【12】关于页：不重复入口、隐私说人话');
{
  api.openHelp('about');
  ok(!$_(w, '#sheetBody').includes('快捷入口'), '没有「快捷入口」分区');
  ok($$(w, '#sheetBody [data-act="export-data"], #sheetBody [data-act="check-update"]').length === 0, '不再重复我的页的功能');
  ok(/只保存在/.test(txt(w, '#sheetBody')) && /不上传/.test(txt(w, '#sheetBody')), '隐私说明讲清数据在哪', txt(w, '#sheetBody').slice(0, 40));
  ok(/\d+ 个版本/.test(txt(w, '#sheetBody [data-act="log-toggle"]')), '更新记录可展开', txt(w, '#sheetBody [data-act="log-toggle"]'));
  close(w);
}
function $_(w, s) { const el = $(w, s); return el ? el.textContent : ''; }

console.log('\n【13】空数据不报错');
{
  const w3 = boot();
  w3.__api.state.lessons = [];
  w3.__api.state.teacher = { name: '', school: '', subject: '' };
  let err = null;
  try { w3.__api.switchTab('mine'); } catch (e) { err = e.message; }
  ok(!err, '渲染无异常', err);
  const k = $$(w3, '#page-mine .mp-kpis b').map(e => e.textContent.trim());
  ok(k[0] === '0', '课时显示 0', k);
  ok(/填写学校与科目/.test(txt(w3, '#page-mine .mp-sub')), '资料为空给出占位文案');
}

console.log('\n【14】清理与重置仍可执行');
{
  const w4 = boot();
  const a4 = w4.__api;
  a4.switchTab('mine');
  $(w4, '#page-mine .row[data-act="clear-schedule"]').click();
  ok($(w4, '#overlay').classList.contains('show'), '清理课表打开面板');
  ok(/只删除/.test(txt(w4, '#sheetBody')), '说明只删课程记录');
  w4.document.getElementById('overlay').classList.remove('show');
  $(w4, '#page-mine [data-act="reset-demo"]').click();
  ok($(w4, '#modalOverlay').classList.contains('show'), '重置示例弹确认框');
}

console.log('\n【15】更新面板不露技术细节');
{
  const w5 = boot();
  const u = w5.__api;
  u.UPD.phase = 'uptodate';
  u.UPD.remoteCode = 16;
  u.UPD.remoteName = '1.0.15';
  u.openUpdateSheet();
  const body = txt(w5, '#sheetBody');
  ok(/已是最新版本/.test(body), '状态文案');
  ok(!/服务器上最新|比本机还旧|CDN|资源 \d/.test(body), '不显示版本诊断与资源编号', body);
  ok(!/换个更新源/.test(txt(w5, '#sheetFooter')), '底部不再有技术分支出按钮', txt(w5, '#sheetFooter'));
  close(w5);

  u.UPD.phase = 'idle';
  u.UPD.kind = 'apk';
  u.UPD.latest = '1.0.15';
  u.UPD.size = 365813;
  u.UPD.notes = ['「我的」页重新整理'];
  u.openUpdateSheet();
  ok(txt(w5, '#sheetBody .upd-badge') === '新版本', '整包标签用「新版本」', txt(w5, '#sheetBody .upd-badge'));
  ok(!/当前 v[\d.]+ · \d+ KB/.test(txt(w5, '#sheetBody .upd-from')), '当前版本行不再混排体积', txt(w5, '#sheetBody .upd-from'));
  ok(/\d+ KB/.test(txt(w5, '#sheetFooter')), '体积出现在按钮上', txt(w5, '#sheetFooter'));
}

console.log(`\n=== 通过 ${pass} / 失败 ${fail} ===`);
process.exit(fail ? 1 : 0);
