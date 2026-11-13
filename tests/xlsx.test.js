/* xlsx 解析：inflate、zip、SpreadsheetML、与导入器对接 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
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
  inflateRaw, openZip, xlsxToRows, xlsxToText, serialToYmd, parseImportText,
  parseSharedStrings, parseDateStyles
};`);
  return w;
}

const w = boot();
const api = w.__api;

/* ---- 在测试里现做一个 zip（不引第三方库） ---- */
function makeZip(files) {
  const parts = [], central = [];
  let offset = 0;
  const names = Object.keys(files);
  names.forEach(name => {
    const item = files[name];
    const data = Buffer.isBuffer(item) ? item : Buffer.from(item, 'utf8');
    const stored = item && item.__stored;
    const comp = stored ? data : zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0x0800, 6);
    lfh.writeUInt16LE(stored ? 0 : 8, 8);
    lfh.writeUInt32LE(0, 10);
    lfh.writeUInt32LE(comp.length, 18);
    lfh.writeUInt32LE(data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    parts.push(lfh, nameBuf, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(stored ? 0 : 8, 10);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  });
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(names.length, 8);
  eocd.writeUInt16LE(names.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, eocd]);
}

console.log('\n【1】inflate：和自己压的数据逐字节相同');
[10, 300, 5000, 70000].forEach(n => {
  const raw = Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + (i % 7) * 11) % 256));
  const got = api.inflateRaw(new Uint8Array(zlib.deflateRawSync(raw)));
  ok(Buffer.compare(Buffer.from(got), raw) === 0, `${n} 字节随机数据往返一致`);
});
const text = Buffer.from('课酬课表 '.repeat(500), 'utf8');
ok(Buffer.compare(Buffer.from(api.inflateRaw(new Uint8Array(zlib.deflateRawSync(text)))), text) === 0,
  '中文长文本往返一致');
// 全零数据会走 stored/低压缩比分支
const zeros = Buffer.alloc(3000);
ok(Buffer.compare(Buffer.from(api.inflateRaw(new Uint8Array(zlib.deflateRawSync(zeros)))), zeros) === 0,
  '全零数据往返一致');

console.log('\n【2】zip 读取');
const zipBuf = makeZip({ 'a.txt': 'hello', 'b/c.txt': 'world'.repeat(50) });
const zip = api.openZip(new Uint8Array(zipBuf));
ok(zip.names.length === 2, '读出两个条目', zip.names);
ok(Buffer.from(zip.read('a.txt')).toString() === 'hello', 'deflate 条目解压正确');
ok(Buffer.from(zip.read('b/c.txt')).toString() === 'world'.repeat(50), '嵌套路径解压正确');
ok(zip.read('nope.txt') === null, '不存在的条目返回 null');

let threw = '';
try { api.openZip(new Uint8Array([1, 2, 3, 4])); } catch (e) { threw = e.message; }
ok(threw.includes('不是有效的 Excel 文件'), '随便一段字节被拦下', threw);

/* ---- 造一个真 xlsx ---- */
const T = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const serialOf = (y, m, d) => Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);

const shared = [
  '日期', '节次', '班级', '类型',
  '高三(1)班', '正课', '第1节', '高二(3)班', '自习',
];
const sharedXml = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="${T}" count="${shared.length}" uniqueCount="${shared.length}">
${shared.map(s => `<si><t>${s}</t></si>`).join('')}
</sst>`;

const workbookXml = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="${T}" xmlns:r="${R}">
  <sheets><sheet name="课表" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="${T}">
  <numFmts count="1"><numFmt numFmtId="176" formatCode="yyyy/m/d"/></numFmts>
  <cellStyleXfs count="1"><xf numFmtId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs>
</styleSheet>`;

const cell = (ref, v, t, s) => `<c r="${ref}"${t ? ` t="${t}"` : ''}${s ? ` s="${s}"` : ''}><v>${v}</v></c>`;
const sheetXml = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="${T}"><sheetData>
  <row r="1">${cell('A1', 0, 's')}${cell('B1', 1, 's')}${cell('C1', 2, 's')}${cell('D1', 3, 's')}</row>
  <row r="2">${cell('A2', serialOf(2026, 11, 16), null, 1)}${cell('B2', 6, 's')}${cell('C2', 4, 's')}${cell('D2', 5, 's')}</row>
  <row r="3">${cell('A3', serialOf(2026, 11, 17), null, 1)}${cell('B3', 6, 's')}<c r="C3" t="inlineStr"><is><t>高二(3)班</t></is></c>${cell('D3', 8, 's')}</row>
  <row r="4">${cell('A4', serialOf(2026, 11, 18), null, 1)}<c r="C4" t="s"><v>4</v></c>${cell('D4', 5, 's')}</row>
</sheetData></worksheet>`;

const xlsx = makeZip({
  'xl/workbook.xml': workbookXml,
  'xl/_rels/workbook.xml.rels': relsXml,
  'xl/sharedStrings.xml': sharedXml,
  'xl/styles.xml': stylesXml,
  'xl/worksheets/sheet1.xml': sheetXml,
});

console.log('\n【3】读 xlsx');
ok(api.serialToYmd(serialOf(2026, 11, 16)) === '2026-11-16', '序列号转日期正确', api.serialToYmd(serialOf(2026, 11, 16)));
ok(api.serialToYmd(45658) === '2025-01-01', '已知日期：45658 = 2025-01-01', api.serialToYmd(45658));

const rows = api.xlsxToRows(new Uint8Array(xlsx));
ok(rows.length === 4, '四行', rows.length);
ok(rows[0].join('|') === '日期|节次|班级|类型', '表头读出', rows[0]);
ok(rows[1][0] === '2026-11-16', '日期列按样式转成了 YYYY-MM-DD', rows[1][0]);
ok(rows[1][2] === '高三(1)班', '共享字符串解析正确', rows[1][2]);
ok(rows[2][2] === '高二(3)班', 'inlineStr 也能读', rows[2][2]);
ok(rows[3][1] === '' && rows[3][2] === '高三(1)班', '跳过 B 列时中间补空串', rows[3]);

console.log('\n【4】交给导入器');
const txt = api.xlsxToText(new Uint8Array(xlsx));
ok(txt.split('\n').length === 4, '转成 4 行文本');
ok(txt.split('\n')[1].split('\t').length === 4, '用制表符分列');
const parsed = api.parseImportText(txt);
ok(parsed.errors.length === 0, '导入器没有报错行', parsed.errors);
ok(parsed.rows.length === 3, '解析出 3 节课（表头跳过）', parsed.rows.length);
ok(parsed.rows[0].date === '2026-11-16', '第一节课日期', parsed.rows[0].date);
ok(parsed.rows[0].period === 1, '节次', parsed.rows[0].period);
ok(parsed.rows[0].klass === '高三(1)班', '班级', parsed.rows[0].klass);
ok(parsed.rows[0].typeId === 'regular', '类型映射到正课', parsed.rows[0].typeId);
ok(parsed.rows[1].typeId === 'self', '第二行是自习', parsed.rows[1].typeId);
ok(parsed.rows[2].date === '2026-11-18', '第三行日期', parsed.rows[2].date);

console.log('\n【5】标题行在表头之上也能导入');
const withTitle = '2026 秋季课表\n日期\t节次\t班级\t类型\n2026-11-16\t第1节\t高三(1)班\t正课';
const p2 = api.parseImportText(withTitle);
ok(p2.errors.length === 0, '标题行与表头都不算错行', p2.errors);
ok(p2.rows.length === 1, '只剩一节有效课', p2.rows.length);

console.log('\n【6】异常路径');
let err = '';
try { api.xlsxToRows(new Uint8Array(makeZip({ 'readme.txt': 'not excel' }))); } catch (e) { err = e.message; }
ok(/没找到工作表/.test(err), '没有 worksheet 时报错', err);

err = '';
try { api.parseDateStyles('<styleSheet><cellXfs><xf numFmtId="0"/></cellXfs></styleSheet>'); } catch (e) { err = e.message; }
ok(err === '', '样式缺失不抛异常');

console.log(`\n通过 ${pass} · 失败 ${fail}`);
process.exit(fail ? 1 : 0);
