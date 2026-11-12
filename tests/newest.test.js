/**
 * 1.0.14 · 清单并发取最新
 *
 * 回归的是这个 bug：jsDelivr 的分支地址会被 CDN 缓存 12 小时，
 * 发布 1.0.13 后它仍然吐 1.0.12 的清单；而旧的「第一个连上就用」逻辑
 * 一撞上它就停手，于是 1.0.12 的用户永远看到「已是最新」。
 */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const ROOT = 'C:/Users/555/WorkBuddy/课时';

let pass = 0, fail = 0;
const ok = (c, name, extra) => {
  if (c) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra !== undefined ? '  \u2192 ' + extra : '')); }
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const txt = (w, sel) => { const e = w.document.querySelector(sel); return e ? e.textContent.replace(/\s+/g, ' ') : ''; };

const MAN = (vc, wb, extra) => JSON.stringify(Object.assign({
  versionCode: vc,
  versionName: '1.0.' + (vc - 1),
  notes: ['测试说明'],
  apk: { url: 'https://github.com/user269/kechou/releases/download/v1.0.' + (vc - 1) + '/kebao.apk', size: 300000 },
  web: { build: wb || 0, url: wb ? 'https://x.com/' + wb + '.zip' : '', size: 0 },
}, extra || {}));

function boot(opts) {
  const o = opts || {};
  const html = fs.readFileSync(ROOT + '/index.html', 'utf8').replace(/<script[^>]*src=[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'https://kebao.local/', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.Notification = class {
    static permission = 'granted';
    static requestPermission() { return Promise.resolve('granted'); }
  };
  if (o.native) {
    const info = JSON.stringify({ versionName: '1.0.13', versionCode: 13, webBuild: 0, canInstall: true });
    const native = {
      appInfo: () => info,
      // 模拟原生的并发取最新：把 o.manifests 里最大的一份回传
      updateCheck: (json) => {
        w.__srcAsked = JSON.parse(json);
        setTimeout(() => {
          if (o.manifests) w.__onUpdateCheck(o.manifests, null, 'mock://best');
          else w.__onUpdateCheck(null, 'ConnectException: Failed to connect to raw.githubusercontent.com/0.0.0.0:443', '');
        }, 10);
      },
    };
    // 其余桥接方法一律空实现，避免界面初始化时报「不是函数」
    w.KebaoNative = new Proxy(native, {
      get: (t, k) => (k in t ? t[k] : () => {}),
    });
  } else {
    w.fetch = o.fetch;
  }
  w.eval(fs.readFileSync(ROOT + '/app.js', 'utf8')
    + '\nwindow.__api={get state(){return state},UPD,checkUpdate,pickNewestManifest,manifestSources,'
    + 'manifestRank,openUpdateSheet,renderUpdateSheet,updateBodyHtml,handleCheck,applyManifest,openUpdateSource};');
  return w;
}

(async () => {
  console.log('\n【1】清单版本号排序：谁新用谁');
  {
    const w = boot({});
    const a = { man: JSON.parse(MAN(13, 0)), source: 'a' };
    const b = { man: JSON.parse(MAN(14, 0)), source: 'b' };
    const c = { man: JSON.parse(MAN(12, 0)), source: 'c' };
    ok(w.__api.pickNewestManifest([a, b, c]).source === 'b', '三份取 versionCode 最大的', w.__api.pickNewestManifest([a, b, c]).source);
    ok(w.__api.pickNewestManifest([c, a, b]).source === 'b', '与顺序无关');
    ok(w.__api.pickNewestManifest([]) === null, '空列表返回 null');
    ok(w.__api.pickNewestManifest(null) === null, 'null 也不炸');

    // versionCode 相同就看资源包 build
    const d = { man: JSON.parse(MAN(14, 3)), source: 'd' };
    const e = { man: JSON.parse(MAN(14, 9)), source: 'e' };
    ok(w.__api.pickNewestManifest([b, d, e]).source === 'e', '同版本比资源包 build', w.__api.pickNewestManifest([b, d, e]).source);
    ok(w.__api.manifestRank(e.man).join() === '14,9', 'rank 取 [versionCode, build]', w.__api.manifestRank(e.man));
  }

  console.log('\n【2】浏览器分支：五个源一起请求，取最新的');
  {
    const bodies = {
      // 模拟真实情况：第 1、3 个是旧缓存，第 4 个才是真的
      0: MAN(13, 0), 1: MAN(13, 0), 2: MAN(13, 0), 3: MAN(14, 0), 4: MAN(13, 0),
    };
    let n = 0;
    const asked = [];
    const w = boot({
      fetch: (url) => {
        const i = n++;
        asked.push(url);
        return Promise.resolve({ ok: true, text: () => Promise.resolve(bodies[i] || bodies[4]) });
      },
    });
    const srcs = w.__api.manifestSources();
    ok(srcs.length === 5, '内置 5 个清单地址', srcs.length);
    ok(!srcs.some(u => /jsdelivr\.net\/gh\/[^/]+\/[^@]+@main/.test(u)), '不再使用会被长时间缓存的 @main 地址');
    ok(srcs[srcs.length - 1].indexOf('jsdelivr') >= 0, 'jsDelivr 退到最后只作兜底', srcs[srcs.length - 1]);

    w.__api.checkUpdate(true);
    await wait(150);
    ok(n === 5, '五个地址全部请求，不是连上第一个就停', n);
    ok(w.__api.UPD.remoteCode === 14, '最终采用版本号最大的那份', w.__api.UPD.remoteCode);
    ok(asked.length === 5, '没有提前中断');
  }

  console.log('\n【3】浏览器分支：资源包 build 也取最大');
  {
    const bodies = [MAN(0, 3), MAN(0, 7), MAN(0, 5), MAN(0, 1), MAN(0, 2)];
    let n = 0;
    const w = boot({ fetch: () => Promise.resolve({ ok: true, text: () => Promise.resolve(bodies[n++]) }) });
    w.__api.checkUpdate(true);
    await wait(150);
    ok(w.__api.UPD.kind === 'web', '判定为资源包更新', w.__api.UPD.kind);
    ok(w.__api.UPD.build === 7, '取 build 最大的', w.__api.UPD.build);
  }

  console.log('\n【4】全部失败时才报错');
  {
    let n = 0;
    const w = boot({ fetch: () => { n++; return Promise.reject(new Error('Failed to connect to 0.0.0.0')); } });
    w.__api.checkUpdate(false);
    await wait(150);
    ok(n === 5, '五个地址都试过', n);
    ok(w.__api.UPD.phase === 'error', '进入失败态', w.__api.UPD.phase);
    ok(/连不上|网络/.test(txt(w, '#updBody')), '给出可读的失败原因', txt(w, '#updBody').slice(0, 40));
  }

  console.log('\n【5】原生路径：1.0.13 的机器拿到 1.0.14 的清单');
  {
    const w = boot({ native: true, manifests: MAN(15, 0) });
    w.__api.checkUpdate(false);
    await wait(60);
    ok(w.__api.UPD.kind === 'apk', '识别为整包更新', w.__api.UPD.kind);
    ok(w.__api.UPD.latest === '1.0.14', '版本号取清单里的', w.__api.UPD.latest);
    const urls = w.__api.UPD.urls;
    ok(urls.some(u => /ghfast\.top/.test(u)), '下载地址含镜像', urls.length);
    ok(/立即更新/.test(txt(w, '#sheetFooter')), '底部出现「立即更新」', txt(w, '#sheetFooter'));
  }

  console.log('\n【6】原生路径：清单比本机还旧时要说清是缓存');
  {
    const w = boot({ native: true, manifests: MAN(12, 0) });
    w.__api.checkUpdate(false);
    await wait(60);
    ok(w.__api.UPD.phase === 'uptodate', '比本机旧就不提示更新', w.__api.UPD.phase);
    const body = txt(w, '#updBody');
    ok(!/v1\.0\.11|服务器上最新/.test(body), '不再把服务器版本号摆给普通用户', body.slice(0, 60));
    ok(/缓存/.test(body), '只提示可能是网络缓存', body.slice(0, 80));
    const alt = w.document.querySelector('#sheetBody .upd-alt');
    ok(!!alt && /更新地址/.test(alt.textContent), '给出一行换地址的出口');
    alt.click();
    ok(/更新地址/.test(txt(w, '#sheetTitle')), '能打开换地址面板', txt(w, '#sheetTitle'));
    w.document.getElementById('overlay').classList.remove('show');
  }

  console.log('\n【7】原生路径：本机已是最新时不吓人');
  {
    const w = boot({ native: true, manifests: MAN(13, 0) });
    w.__api.checkUpdate(false);
    await wait(60);
    ok(w.__api.UPD.phase === 'uptodate', '版本一致');
    const body = txt(w, '#updBody');
    ok(/已是最新/.test(body), '标题正常');
    ok(!/缓存/.test(body), '一致时不提缓存', body.slice(0, 60));
  }

  console.log(`\n=== 通过 ${pass} / 失败 ${fail} ===`);
  process.exit(fail ? 1 : 0);
})();
