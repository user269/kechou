/* 模板远程可更新：解析容错、合并规则、联网同步 */
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
  allPresets, parseTemplatePayload, syncTemplates, openPeriodsSheet, applyPeriodPreset
};`);
  return w;
}

const w = boot();
const api = w.__api;
const $ = s => w.document.querySelector(s);
const txt = s => ($(s) ? $(s).textContent.replace(/\s+/g, ' ').trim() : '');

console.log('\n【1】内置模板');
const builtin = api.allPresets();
ok(builtin.length === 3, '默认三套', builtin.length);
ok(builtin.map(p => p.id).join(',') === 'junior,senior,primary', 'id 顺序稳定', builtin.map(p => p.id).join(','));

console.log('\n【2】解析容错');
const good = JSON.stringify({
  periods: [{
    id: 'vocational', name: '中职 · 7 节', desc: '上午 4 + 下午 3',
    items: [
      { name: '第1节', short: '1', start: '08:00', end: '08:45' },
      { name: '坏数据', short: 'x', start: '8点', end: '9点' },
      { name: '第2节', short: '2', start: '08:55', end: '09:40' },
    ],
  }],
});
const parsed = api.parseTemplatePayload(good);
ok(parsed.length === 1, '解析出一套');
ok(parsed[0].periods.length === 2, '时间格式不对的条目被丢掉', parsed[0].periods.length);
ok(parsed[0].periods[0].start === '08:00', '保留合法时间');

let threw = false;
try { api.parseTemplatePayload('{"periods":[]}'); } catch (e) { threw = true; }
ok(threw, '空数据抛错');

threw = false;
try { api.parseTemplatePayload('<html>404</html>'); } catch (e) { threw = true; }
ok(threw, 'HTML 错误页抛错');

console.log('\n【3】与内置合并');
api.state.templates = parsed;
const merged = api.allPresets();
ok(merged.length === 4, '内置 3 + 新增 1', merged.length);
ok(merged.some(p => p.id === 'vocational'), '新模板进来了');

// 同 id 覆盖内置
api.state.templates = [{ id: 'junior', name: '初中 · 改过的', desc: 'x', periods: [{ name: '第1节', short: '1', start: '08:10', end: '08:50' }] }];
const over = api.allPresets();
ok(over.length === 3, '同 id 不新增，只覆盖', over.length);
ok(over.find(p => p.id === 'junior').name === '初中 · 改过的', '同 id 以联网的为准');
ok(over.find(p => p.id === 'junior').periods[0].start === '08:10', '内容也替换了');

console.log('\n【4】联网同步');
api.state.templates = [];
api.state.meta.templateSyncAt = 0;
let hitUrl = '';
w.fetch = url => {
  hitUrl = String(url);
  return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(good) });
};
api.syncTemplates().then(r => {
  ok(r.ok === true, '同步成功');
  ok(r.count === 1, '同步到 1 套', r.count);
  ok(api.state.templates.length === 1, '写进 state');
  ok(api.state.meta.templateSyncAt > 0, '记下同步时间');
  ok(/templates\.json/.test(hitUrl), '请求的是 templates.json', hitUrl);

  // 全挂时给失败结果，而不是抛异常
  w.fetch = () => Promise.reject(new Error('offline'));
  return api.syncTemplates();
}).then(r => {
  ok(r.ok === false, '连不上时返回失败', r.ok);
  ok(Array.isArray(r.errors) && r.errors.length === 4, '四个源都记了错误', r.errors && r.errors.length);

  console.log('\n【5】界面');
  api.state.templates = parsed;
  api.openPeriodsSheet();
  ok(/更新模板/.test(txt('#sheetBody')), '作息面板有「更新模板」入口');
  ok(/中职 · 7 节/.test(txt('#sheetBody')), '同步来的模板出现在列表里');
  ok(/联网获取更多/.test(txt('#sheetBody')) || /个已同步/.test(txt('#sheetBody')), '有同步状态文案');
  ok(!!$('#sheetBody [data-act="tpl-sync"]'), '同步行可点');

  console.log(`\n通过 ${pass} · 失败 ${fail}`);
  process.exit(fail ? 1 : 0);
}).catch(e => {
  console.log('✗ 异步流程异常：' + e.message);
  process.exit(1);
});
