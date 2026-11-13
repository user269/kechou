/* 广告位：放哪里、什么时候出现、没接 SDK 时的行为 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (c, n, e) => c ? (pass++, console.log('  ✓ ' + n))
                          : (fail++, console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')));
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 广告桩：记录每一次调用，方便断言"到底有没有真的请求广告" */
function makeAdStub(ready) {
  const calls = [];
  return {
    calls,
    stub: {
      version: () => '1.2.0',
      syncReminders: () => '{"ok":true}',
      hasNotifyPermission: () => true,
      canScheduleExact: () => true,
      saveFileAs: () => { },
      adInfo: () => JSON.stringify({ ok: true, ready: !!ready, preview: false, position: '' }),
      adShow: p => { calls.push(['show', p]); return true; },
      adHide: () => { calls.push(['hide']); },
      adPreview: on => { calls.push(['preview', on]); },
    },
  };
}

function boot(nativeStub) {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    .replace(/<script[^>]*src=[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'https://kebao.local/', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.Notification = class { static permission = 'granted'; static requestPermission() { return Promise.resolve('granted'); } };
  // 后台更新检查会发请求，jsdom 没有 fetch；给个永远失败的桩，别污染输出
  w.fetch = () => Promise.reject(new Error('offline'));
  if (nativeStub) w.KebaoNative = nativeStub;
  w.eval(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8') + `
window.__api = {
  get state() { return state; },
  switchTab, adCfg, adAvailable, adMaybeShow, adHideNow, adSdkReady, toggleAdPreview,
  get currentTab() { return currentTab; },
  render,
};`);
  return w;
}

async function run() {
console.log('\n【1】默认不打扰：出厂状态下一次广告请求都不发');
{
  const { calls, stub } = makeAdStub(false);
  const w = boot(stub);
  const api = w.__api;
  ok(api.adCfg().enabled === false, '广告默认关闭', api.adCfg());
  api.switchTab('pay');
  await sleep(1800);
  ok(calls.filter(c => c[0] === 'show').length === 0, '没有发起展示', calls);
  ok(api.adAvailable() === true, '但原生能力是可用的（只是没开）');
  ok(api.adSdkReady() === false, '识别出还没接真实 SDK');
}

console.log('\n【2】打开后：只在浏览型页面出现');
{
  const { calls, stub } = makeAdStub(true);
  const w = boot(stub);
  const api = w.__api;
  api.state.settings.ads = { enabled: true, positions: ['pay', 'mine'], delay: 100 };

  api.switchTab('home');
  await sleep(300);
  ok(calls.filter(c => c[0] === 'show').length === 0, '首页不展示（那是看课表的地方）');

  api.switchTab('schedule');
  await sleep(300);
  ok(calls.filter(c => c[0] === 'show').length === 0, '课表页不展示（操作密集）');

  api.switchTab('pay');
  await sleep(300);
  const shown = calls.filter(c => c[0] === 'show');
  ok(shown.length === 1 && shown[0][1] === 'pay', '课时费页展示一次', shown);

  api.switchTab('mine');
  await sleep(300);
  ok(calls.filter(c => c[0] === 'show').length === 2, '我的页也展示', calls);
}

console.log('\n【3】切走时立刻收起，不留残影');
{
  const { calls, stub } = makeAdStub(true);
  const w = boot(stub);
  const api = w.__api;
  api.state.settings.ads = { enabled: true, positions: ['pay'], delay: 50 };
  api.switchTab('pay');
  await sleep(200);
  ok(calls.some(c => c[0] === 'show'), '先展示出来了');
  api.switchTab('home');
  ok(calls[calls.length - 1][0] === 'hide', '切到首页时收起', calls);
}

console.log('\n【4】延迟：进入页面不会立刻请求（避免拖慢首屏）');
{
  const { calls, stub } = makeAdStub(true);
  const w = boot(stub);
  const api = w.__api;
  api.state.settings.ads = { enabled: true, positions: ['pay'], delay: 900 };
  api.switchTab('pay');
  await sleep(200);
  ok(calls.filter(c => c[0] === 'show').length === 0, '200ms 时还没请求');
  await sleep(900);
  ok(calls.filter(c => c[0] === 'show').length === 1, '延迟到了才请求', calls);
}

console.log('\n【5】预览：没接 SDK 也能看版式');
{
  const { calls, stub } = makeAdStub(false);
  const w = boot(stub);
  const api = w.__api;
  api.state.settings.adPreview = true;
  api.switchTab('pay');
  await sleep(1800);
  ok(calls.some(c => c[0] === 'show' && c[1] === 'pay'), '预览模式下会请求占位', calls);
}

console.log('\n【6】预览开关能来回切，并且同步给原生');
{
  const { calls, stub } = makeAdStub(false);
  const w = boot(stub);
  const api = w.__api;
  api.switchTab('mine');
  api.toggleAdPreview();
  ok(api.state.settings.adPreview === true, '打开了', api.state.settings.adPreview);
  ok(calls.some(c => c[0] === 'preview' && c[1] === true), '通知了原生', calls);
  api.toggleAdPreview();
  ok(api.state.settings.adPreview === false, '关掉了');
  ok(calls.some(c => c[0] === 'preview' && c[1] === false), '原生也收到了关闭');
}

console.log('\n【7】没有广告能力的安装包：不报错，也不显示预览入口');
{
  const w = boot({
    version: () => '1.0.23',
    syncReminders: () => '{}',
    hasNotifyPermission: () => true,
    saveFileAs: () => { },
  });
  const api = w.__api;
  ok(api.adAvailable() === false, '判定为不可用');
  let threw = false;
  try { api.switchTab('pay'); await sleep(200); api.adHideNow(); api.toggleAdPreview(); } catch (e) { threw = true; }
  ok(!threw, '全程不抛异常');
  api.switchTab('mine');
  const rows = [...w.document.querySelectorAll('#page-mine .row')].map(r => r.textContent);
  ok(!rows.some(t => /广告位预览/.test(t)), '旧安装包不显示预览入口');
}

console.log('\n【8】纯网页（浏览器打开）：同样不体现广告');
{
  const w = boot(null);
  const api = w.__api;
  ok(api.adAvailable() === false, '没有原生能力');
  let threw = false;
  try { api.switchTab('pay'); await sleep(150); } catch (e) { threw = true; }
  ok(!threw, '不抛异常');
}

}  // run

run().then(() => {
  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
}).catch(e => {
  console.error('测试自身出错：', e);
  process.exit(1);
});
