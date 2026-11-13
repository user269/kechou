/* ============================================================
   课酬 App — app.js
   教师课时费自动管理
   ============================================================ */
'use strict';

/* ---------------- 运行环境 ----------------
   Android 安装包通过 KebaoNative 暴露系统能力（通知、闹钟、文件保存）。
   在普通浏览器里运行时为 null，全部逻辑退回 Web 实现。            */
const NATIVE = (typeof window.KebaoNative !== 'undefined' && window.KebaoNative) || null;
const IS_NATIVE = !!NATIVE;

/* ---------------- 工具函数 ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const pad2 = n => String(n).padStart(2, '0');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = (name, size = 18) =>
  `<svg width="${size}" height="${size}" style="flex:0 0 auto"><use href="#i-${name}"/></svg>`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEK_SHORT = ['日', '一', '二', '三', '四', '五', '六'];

function ymd(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function parseYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}
function startOfWeek(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const g = x.getDay();
  return addDays(x, g === 0 ? -6 : 1 - g);
}
function todayYmd() { return ymd(new Date()); }
function weekdayCN(dateStr) { return WEEK_CN[parseYmd(dateStr).getDay()]; }
function fmtMD(dateStr) {
  const d = parseYmd(dateStr);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return `${y}年${Number(m)}月`;
}
function daysBetween(a, b) {
  return Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
}

/* ---------------- 学期与周次（单双周） ---------------- */
/** 学期第一周的周一 */
function termStartYmd() {
  const s = state.settings.termStart;
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) return ymd(startOfWeek(parseYmd(s)));
  return ymd(startOfWeek(new Date()));
}
/** 该日期是学期第几周（周一为一周之始） */
function weekIndexOf(dateStr) {
  if (!dateStr) return 1;
  const a = startOfWeek(parseYmd(termStartYmd()));
  const b = startOfWeek(parseYmd(dateStr));
  return Math.round(daysBetween(ymd(a), ymd(b)) / 7) + 1;
}
/** 'odd' 单周 | 'even' 双周 */
function weekParity(dateStr) {
  const n = weekIndexOf(dateStr);
  return ((n % 2) + 2) % 2 === 1 ? 'odd' : 'even';
}
const parityLabel = p => (p === 'odd' ? '单周' : p === 'even' ? '双周' : '每周');
/** 学期最后一天 */
function termEndYmd() {
  const weeks = clamp(Number(state.settings.termWeeks) || 20, 1, 30);
  return ymd(addDays(startOfWeek(parseYmd(termStartYmd())), (weeks - 1) * 7 + 6));
}
/** 把日期挪到最近的、符合单双周的同一星期几（过去的课向前找） */
function alignDateToParity(dateStr, mode) {
  if (mode !== 'odd' && mode !== 'even') return dateStr;
  if (weekParity(dateStr) === mode) return dateStr;
  const past = dateStr < todayYmd();
  for (let k = 1; k <= 8; k++) {
    const cand = ymd(addDays(parseYmd(dateStr), (past ? -7 : 7) * k));
    if (weekParity(cand) === mode) return cand;
  }
  return dateStr;
}
/** 从某天起，按每周/单周/双周展开到学期末 */
function repeatDates(fromDate, mode) {
  const end = termEndYmd();
  const out = [];
  let cur = fromDate, guard = 0;
  while (cur <= end && out.length < 30 && guard++ < 40) {
    if (mode === 'all' || weekParity(cur) === mode) out.push(cur);
    cur = ymd(addDays(parseYmd(cur), 7));
  }
  return out;
}

/* ============================================================
   法定节假日
   ============================================================ */
/** 内置放假安排（依据国务院办公厅通知整理，离线也能直接排课）
 *  [日期, 名称, 类型]   off = 放假   work = 周末补班上课
 *  用户可在「我的 → 法定节假日」里改名、改日期、设半天、增删 */
const HOLIDAY_BUILTIN = {
  2026: [
    ['2026-01-01', '元旦', 'off'], ['2026-01-02', '元旦', 'off'], ['2026-01-03', '元旦', 'off'],
    ['2026-01-04', '元旦补班', 'work'],
    ['2026-02-14', '春节前补班', 'work'],
    ['2026-02-15', '春节', 'off'], ['2026-02-16', '除夕', 'off'], ['2026-02-17', '初一', 'off'],
    ['2026-02-18', '初二', 'off'], ['2026-02-19', '初三', 'off'], ['2026-02-20', '初四', 'off'],
    ['2026-02-21', '初五', 'off'], ['2026-02-22', '初六', 'off'], ['2026-02-23', '初七', 'off'],
    ['2026-02-28', '春节后补班', 'work'],
    ['2026-04-04', '清明节', 'off'], ['2026-04-05', '清明节', 'off'], ['2026-04-06', '清明节', 'off'],
    ['2026-05-01', '劳动节', 'off'], ['2026-05-02', '劳动节', 'off'], ['2026-05-03', '劳动节', 'off'],
    ['2026-05-04', '劳动节', 'off'], ['2026-05-05', '劳动节', 'off'],
    ['2026-05-09', '劳动节补班', 'work'],
    ['2026-06-19', '端午节', 'off'], ['2026-06-20', '端午节', 'off'], ['2026-06-21', '端午节', 'off'],
    ['2026-09-20', '国庆前补班', 'work'],
    ['2026-09-25', '中秋节', 'off'], ['2026-09-26', '中秋节', 'off'], ['2026-09-27', '中秋节', 'off'],
    ['2026-10-01', '国庆节', 'off'], ['2026-10-02', '国庆节', 'off'], ['2026-10-03', '国庆节', 'off'],
    ['2026-10-04', '国庆节', 'off'], ['2026-10-05', '国庆节', 'off'], ['2026-10-06', '国庆节', 'off'],
    ['2026-10-07', '国庆节', 'off'],
    ['2026-10-10', '国庆后补班', 'work'],
  ],
  2027: [
    ['2027-01-01', '元旦', 'off'], ['2027-01-02', '元旦', 'off'], ['2027-01-03', '元旦', 'off'],
    ['2027-01-31', '春节前补班', 'work'],
    ['2027-02-05', '除夕', 'off'], ['2027-02-06', '初一', 'off'], ['2027-02-07', '初二', 'off'],
    ['2027-02-08', '初三', 'off'], ['2027-02-09', '初四', 'off'], ['2027-02-10', '初五', 'off'],
    ['2027-02-11', '初六', 'off'], ['2027-02-12', '初七', 'off'], ['2027-02-13', '初八', 'off'],
    ['2027-02-14', '春节后补班', 'work'],
    ['2027-04-03', '清明节', 'off'], ['2027-04-04', '清明节', 'off'], ['2027-04-05', '清明节', 'off'],
    ['2027-05-01', '劳动节', 'off'], ['2027-05-02', '劳动节', 'off'], ['2027-05-03', '劳动节', 'off'],
    ['2027-05-04', '劳动节', 'off'], ['2027-05-05', '劳动节', 'off'],
    ['2027-05-08', '劳动节补班', 'work'],
    ['2027-06-09', '端午节', 'off'],
    ['2027-09-15', '中秋节', 'off'],
    ['2027-09-26', '国庆前补班', 'work'],
    ['2027-10-01', '国庆节', 'off'], ['2027-10-02', '国庆节', 'off'], ['2027-10-03', '国庆节', 'off'],
    ['2027-10-04', '国庆节', 'off'], ['2027-10-05', '国庆节', 'off'], ['2027-10-06', '国庆节', 'off'],
    ['2027-10-07', '国庆节', 'off'],
    ['2027-10-09', '国庆后补班', 'work'],
  ],
};

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeHoliday(h) {
  const date = String((h && h.date) || '');
  if (!YMD_RE.test(date)) return null;
  const kind = h.kind === 'work' ? 'work' : 'off';
  const half = kind === 'off' && /^\d{2}:\d{2}$/.test(String(h.half || '')) ? String(h.half) : '';
  let asDow = null;
  if (kind === 'work' && h.asDow !== null && h.asDow !== '' && h.asDow !== undefined) {
    const n = Number(h.asDow);
    if (Number.isInteger(n) && n >= 0 && n <= 6) asDow = n;
  }
  return { date, name: String(h.name || '').trim() || '假日', kind, half, asDow, custom: !!h.custom };
}

function builtinHolidays(year) {
  return (HOLIDAY_BUILTIN[year] || []).map(([date, name, kind]) => normalizeHoliday({ date, name, kind }));
}
function allBuiltinHolidays() {
  return Object.keys(HOLIDAY_BUILTIN).sort().reduce((acc, y) => acc.concat(builtinHolidays(Number(y))), []);
}
function sortHolidays(list) {
  return list.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
/** 某天的假期记录（放假 / 补班），没有则 null */
function holidayOn(dateStr) {
  const arr = state.holidays || [];
  for (let i = 0; i < arr.length; i++) if (arr[i].date === dateStr) return arr[i];
  return null;
}
const isHolidayOff = ds => { const h = holidayOn(ds); return !!h && h.kind !== 'work'; };
const isMakeupWorkday = ds => { const h = holidayOn(ds); return !!h && h.kind === 'work'; };
/** 半天放学时刻（'HH:MM'），整天放假返回 '' */
function holidayHalf(ds) {
  const h = holidayOn(ds);
  return h && h.kind !== 'work' && h.half ? h.half : '';
}
/** 排课该看星期几：补班日可指定「按周几的课表」 */
function scheduleDow(dateStr) {
  const h = holidayOn(dateStr);
  if (h && h.kind === 'work' && h.asDow !== null && h.asDow !== undefined) return Number(h.asDow);
  return parseYmd(dateStr).getDay();
}
/** 假期标签 */
function holidayTag(dateStr) {
  const h = holidayOn(dateStr);
  if (!h) return '';
  if (h.kind === 'work') return `<span class="tag sky">补班</span>`;
  if (h.half) return `<span class="tag amber">上到 ${esc(h.half)}</span>`;
  return `<span class="tag rose">放假</span>`;
}
/** 一句话说明（日视图提示条） */
function holidayBanner(dateStr) {
  const h = holidayOn(dateStr);
  if (!h) return '';
  if (h.kind === 'work') {
    const sw = scheduleDow(dateStr);
    const same = sw === parseYmd(dateStr).getDay();
    return `${h.name} · 补班上课${same ? '' : `，按${WEEK_CN[sw]}的课表`}`;
  }
  return h.half ? `${h.name} · 半天，${h.half} 放学` : `${h.name} · 放假`;
}
/** 我的页一行摘要 */
function holidaySummary() {
  const list = state.holidays || [];
  if (!list.length) return '未收录，点此同步';
  const ys = [...new Set(list.map(h => String(h.date).slice(0, 4)))].sort();
  const off = list.filter(h => h.kind !== 'work').length;
  const work = list.length - off;
  return `${ys.join('、')} 年 · ${off} 天假${work ? ` · ${work} 天补班` : ''}`;
}
/** 用于排课的判断：今天及以后才自动跳过，历史课程不动 */
function holidayBlocks(dateStr, periodNo) {
  if (state.settings.holidaySkip === false) return false;
  if (dateStr < todayYmd()) return false;
  const h = holidayOn(dateStr);
  if (!h || h.kind === 'work') return false;
  if (!h.half) return true;
  return getPeriod(periodNo).start >= h.half;   // 半天：放学后的节次不上
}

/* ---------------- 节假日数据合并与同步 ---------------- */
/** 用一批新数据覆盖对应年份（保留用户自定义项与未涉及的年份） */
function applyHolidayData(list, opts) {
  const incoming = (list || []).map(normalizeHoliday).filter(Boolean);
  if (!incoming.length) return 0;
  const years = new Set(incoming.map(h => h.date.slice(0, 4)));
  const kept = (state.holidays || []).filter(h => h.custom || !years.has(String(h.date).slice(0, 4)));
  const customDates = new Set(kept.filter(h => h.custom).map(h => h.date));
  const merged = kept.concat(incoming.filter(h => !customDates.has(h.date)).map(h => ({ ...h, custom: false })));
  const seen = new Set();
  state.holidays = sortHolidays(merged.filter(h => (seen.has(h.date) ? false : (seen.add(h.date), true))));
  if (!opts || opts.stamp !== false) state.meta.holidaySyncAt = Date.now();
  return incoming.length;
}

const HOLIDAY_API = 'https://timor.tech/api/holiday/year/';
/** 仓库里的整合数据（一次拿全部年份），走国内可用的镜像 */
const HOLIDAY_BUNDLES = [
  'https://cdn.jsdelivr.net/gh/user269/kechou@main/holidays.json',
  'https://ghfast.top/https://raw.githubusercontent.com/user269/kechou/main/holidays.json',
  'https://gh-proxy.com/https://raw.githubusercontent.com/user269/kechou/main/holidays.json',
  'https://raw.githubusercontent.com/user269/kechou/main/holidays.json',
];

function parseHolidayPayload(text) {
  const j = JSON.parse(text);
  const map = (j && (j.holiday || j.days)) || null;
  if (!map || typeof map !== 'object') throw new Error('数据格式不对');
  const out = [];
  Object.keys(map).forEach(k => {
    const v = map[k];
    if (!v || !YMD_RE.test(String(v.date || ''))) return;
    out.push({
      date: v.date,
      name: v.name || v.target || '假日',
      kind: v.holiday === false ? 'work' : 'off',
    });
  });
  return out;
}

async function fetchWithTimeout(url, ms) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, ms || 8000);
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

/** 同步：先拉仓库整合数据，缺哪年再用公共接口补 */
async function syncHolidayData() {
  const y = new Date().getFullYear();
  const want = [y, y + 1];
  const collected = [];
  const years = new Set();
  const errors = [];
  const custom = String(state.settings.holidaySource || '').trim();
  const bundles = (custom ? [custom] : []).concat(HOLIDAY_BUNDLES);

  for (const url of bundles) {
    if (years.has(String(y))) break;
    try {
      const list = parseHolidayPayload(await fetchWithTimeout(url, 8000));
      list.forEach(h => { collected.push(h); years.add(h.date.slice(0, 4)); });
    } catch (e) {
      errors.push(`${url.slice(0, 42)}… ${e && e.message ? e.message : '失败'}`);
    }
  }
  for (const year of want) {
    if (years.has(String(year))) continue;
    const url = HOLIDAY_API + year;
    try {
      const list = parseHolidayPayload(await fetchWithTimeout(url, 8000));
      list.forEach(h => { collected.push(h); years.add(h.date.slice(0, 4)); });
    } catch (e) {
      errors.push(`${year} 年接口 ${e && e.message ? e.message : '失败'}`);
    }
  }
  if (!collected.length) return { ok: false, errors };
  const n = applyHolidayData(collected);
  save();
  return { ok: true, count: n, years: [...years].sort(), errors };
}

/* ============================================================
   总课表（母版）与调休
   ============================================================ */
const WM_LIST = ['all', 'odd', 'even'];
/** 星期顺序：周一 → 周日 */
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
const masterKey = (dow, period, wm) => `${dow}#${period}#${wm || 'all'}`;

/** 某一周的周一 */
function weekStartOf(dateStr) {
  return ymd(startOfWeek(parseYmd(dateStr)));
}
/** 某周内第 dow 天（0=周日，落在该周最后一天） */
function dateOfDow(ws, dow) {
  return ymd(addDays(parseYmd(ws), dow === 0 ? 6 : dow - 1));
}

/** 某个「星期#节次」上的全部课（可能有每周 / 单周 / 双周三份） */
function masterSlots(dow, period) {
  const out = [];
  WM_LIST.forEach(wm => {
    const c = state.master[masterKey(dow, period, wm)];
    if (c && c.typeId) out.push({ typeId: c.typeId, klass: c.klass || '', subject: c.subject || '', extend: Number(c.extend) || 0, weekMode: wm });
  });
  return out;
}
function masterPut(dow, period, wm, cell) {
  const k = masterKey(dow, period, wm);
  if (!cell) { delete state.master[k]; return; }
  state.master[k] = {
    typeId: cell.typeId,
    klass: cell.klass || '',
    subject: cell.subject || '',
    extend: clamp(Number(cell.extend) || 0, 0, 300),
  };
}
function masterLessonCount() {
  return Object.keys(state.master).filter(k => state.master[k] && state.master[k].typeId).length;
}
/** 一段时间内该槽位最多几节课（用于判断单双周是否分离） */
function masterSlotCount(dow, period) {
  return masterSlots(dow, period).length;
}

/** 从现有课表里挑一个「没被调休过、课最全」的周，作为总课表母版 */
function inferMaster() {
  const locked = new Set(state.adjusts.filter(a => !a.undone).map(a => a.weekStart));
  const byWeek = {};
  state.lessons.forEach(l => {
    if (l.status === 'canceled' || l.status === 'leave') return;
    const ws = weekStartOf(l.date);
    if (locked.has(ws)) return;
    (byWeek[ws] = byWeek[ws] || []).push(l);
  });
  const weeks = Object.keys(byWeek).sort();
  if (!weeks.length) return {};
  const best = weeks.reduce((a, b) => (byWeek[a].length >= byWeek[b].length ? a : b));
  const out = {};
  byWeek[best].forEach(l => {
    const dow = parseYmd(l.date).getDay();
    out[masterKey(dow, l.period, l.weekMode || 'all')] = {
      typeId: l.typeId, klass: l.klass || '', subject: l.subject || '',
      extend: Number(l.extend) || 0,
    };
  });
  return out;
}

/** 总课表为空时自动填充一次 */
function ensureMaster() {
  if (masterLessonCount() > 0) return false;
  const m = inferMaster();
  if (!Object.keys(m).length) return false;
  state.master = m;
  return true;
}

/** 把总课表铺到整个学期：补全缺失、更新模板改动、清掉模板已删除的自动课
 *  dry=true 时只统计不写入，用于二次确认 */
function syncFromMaster(dry) {
  const res = { added: 0, updated: 0, removed: 0, manual: 0, locked: 0 };
  const locked = new Set(state.adjusts.filter(a => !a.undone).map(a => a.weekStart));
  const weeks = clamp(Number(state.settings.termWeeks) || 20, 1, 30);
  const t0 = termStartYmd();

  for (let w = 0; w < weeks; w++) {
    const ws = ymd(addDays(parseYmd(t0), w * 7));
    if (locked.has(ws)) { res.locked++; continue; }
    DOW_ORDER.forEach(dow => {
      const date = dateOfDow(ws, dow);
      const par = weekParity(date);
      // 补班日可以「按周五的课表」上课
      const lookDow = scheduleDow(date);
      state.periods.forEach(p => {
        const exist = state.lessons.find(l => l.date === date && l.period === p.no);
        // 法定假日不排课：今天及以后才自动跳过，历史课程保持原样
        if (holidayBlocks(date, p.no)) {
          if (exist && exist.auto) {
            res.removed++;
            if (dry) return;
            state.lessons = state.lessons.filter(l => l.id !== exist.id);
          } else if (exist) {
            res.manual++;
          }
          return;
        }
        let cell = state.master[masterKey(lookDow, p.no, 'all')] || state.master[masterKey(lookDow, p.no, par)];
        let cellWeek = state.master[masterKey(lookDow, p.no, 'all')] ? 'all' : par;
        if (!cell && lookDow !== dow) {
          cell = state.master[masterKey(dow, p.no, 'all')] || state.master[masterKey(dow, p.no, par)];
          cellWeek = state.master[masterKey(dow, p.no, 'all')] ? 'all' : par;
        }
        if (cell) {
          if (!exist) {
            res.added++;
            if (dry) return;
            state.lessons.push({
              id: uid(), date, period: p.no, typeId: cell.typeId,
              klass: cell.klass || '', subject: cell.subject || '',
              dur: periodMinutes(p.no), durAuto: true, students: 1,
              extend: Number(cell.extend) || 0,
              status: 'normal', weekMode: cellWeek, auto: true, createdAt: Date.now(),
            });
          } else if (exist.auto) {
            const ext = Number(cell.extend) || 0;
            if (exist.typeId !== cell.typeId || (exist.klass || '') !== (cell.klass || '') || exist.weekMode !== cellWeek || (Number(exist.extend) || 0) !== ext) {
              res.updated++;
              if (dry) return;
              exist.typeId = cell.typeId;
              exist.klass = cell.klass || '';
              exist.subject = cell.subject || '';
              exist.weekMode = cellWeek;
              exist.extend = ext;
            }
          } else {
            res.manual++;
          }
        } else if (exist && exist.auto) {
          res.removed++;
          if (dry) return;
          state.lessons = state.lessons.filter(l => l.id !== exist.id);
        }
      });
    });
  }
  return res;
}

/* ---------------- 调休 ---------------- */
/** 节次所属时段 */
function periodSection(no) {
  const t = getPeriod(no).start || '00:00';
  if (t < '12:30') return 'am';
  if (t < '18:00') return 'pm';
  return 'night';
}
/** 上午最后一节 */
function morningLastPeriod() {
  const ams = state.periods.filter(p => periodSection(p.no) === 'am').map(p => p.no);
  return ams.length ? Math.max(...ams) : 5;
}
function makeupRule() {
  return { ...defaultSettings().makeup, ...(state.settings.makeup || {}) };
}

/** 某周的调休计划：把 fromDow 那天 cutAfter 之后的课平移到 toDow 的同节次 */
function makeupPlan(ws, rule) {
  const r = rule || makeupRule();
  const fromDate = dateOfDow(ws, r.fromDow);
  const toDate = dateOfDow(ws, r.toDow);
  const cut = Number.isFinite(Number(r.cutAfter)) ? Number(r.cutAfter) : morningLastPeriod();
  const moves = [], conflicts = [];
  state.lessons.forEach(l => {
    if (l.date !== fromDate) return;
    if (l.status === 'canceled' || l.status === 'leave') return;
    if (Number(l.period) <= cut) return;
    if (!r.includeNight && periodSection(l.period) === 'night') return;
    const hit = state.lessons.find(x => x.date === toDate && x.period === l.period && x.id !== l.id);
    if (hit) conflicts.push({ lesson: l, target: hit });
    else moves.push(l);
  });
  moves.sort((a, b) => a.period - b.period);
  return {
    weekStart: ws, weekNo: weekIndexOf(fromDate), parity: weekParity(fromDate),
    fromDate, toDate, cut, moves, conflicts,
  };
}

function adjustOfWeek(ws) {
  return state.adjusts.find(a => a.weekStart === ws && !a.undone) || null;
}

/** 执行某一周的调休 */
function applyMakeup(ws) {
  if (adjustOfWeek(ws)) return { ok: false, reason: 'done' };
  const plan = makeupPlan(ws);
  if (!plan.moves.length) return { ok: false, reason: 'empty', plan };
  const moves = plan.moves.map(l => {
    const rec = { lessonId: l.id, fromDate: l.date, fromPeriod: l.period, toDate: plan.toDate, toPeriod: l.period };
    l.date = plan.toDate;
    l.status = 'swapped';
    l.adjustFrom = `${plan.fromDate}#${l.period}`;
    return rec;
  });
  state.adjusts.push({
    id: uid(), type: 'makeup', weekStart: ws,
    fromDate: plan.fromDate, toDate: plan.toDate,
    moves, createdAt: Date.now(), undone: false,
  });
  state.swaps.push({
    id: uid(), type: 'makeup',
    from: plan.fromDate, to: plan.toDate, at: Date.now(),
  });
  save();
  return { ok: true, plan, count: moves.length };
}

/** 撤销某一周的调休 */
function undoMakeup(ws) {
  const adj = adjustOfWeek(ws);
  if (!adj) return { ok: false, reason: 'none' };
  let restored = 0, blocked = 0;
  adj.moves.forEach(m => {
    const l = state.lessons.find(x => x.id === m.lessonId);
    if (!l) { blocked++; return; }
    const hit = state.lessons.find(x => x.date === m.fromDate && x.period === m.fromPeriod && x.id !== l.id);
    if (hit) { blocked++; return; }
    l.date = m.fromDate;
    l.period = m.fromPeriod;
    if (l.status === 'swapped') l.status = 'normal';
    delete l.adjustFrom;
    restored++;
  });
  adj.undone = true;
  save();
  return { ok: true, restored, blocked };
}

/** 学期内所有符合调休规则的周 */
function makeupWeeks() {
  const r = makeupRule();
  const weeks = clamp(Number(state.settings.termWeeks) || 20, 1, 30);
  const t0 = termStartYmd();
  const out = [];
  for (let w = 0; w < weeks; w++) {
    const ws = ymd(addDays(parseYmd(t0), w * 7));
    if (weekParity(ws) !== r.parity) continue;
    out.push({ weekStart: ws, weekNo: weekIndexOf(ws), done: !!adjustOfWeek(ws), plan: makeupPlan(ws, r) });
  }
  return out;
}

/** 一句话描述调休规则 */
function makeupSummary() {
  const r = makeupRule();
  if (!r.enabled) return '未启用';
  const cutP = state.periods.find(p => p.no === Number(r.cutAfter));
  const after = cutP ? `${cutP.name}之后` : '上午之后';
  return `${parityLabel(r.parity)}${WEEK_CN[r.fromDow]}${after} → ${WEEK_CN[r.toDow]}`;
}

/** 金额整数/小数拆分显示 */
function splitMoney(n) {
  const raw = Number(n);
  const safe = Number.isFinite(raw) ? raw : 0;   // Infinity / NaN 不能漏到界面上
  const v = Math.abs(Math.round(safe * 100) / 100);
  const s = v.toFixed(2).split('.');
  const int = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return { int, dec: s[1], neg: safe < 0, raw: v };
}
/** ¥1,234.00 / ¥1,234 */
function money(n, withDec = false) {
  const { int, dec, neg } = splitMoney(n);
  const body = withDec || dec !== '00' ? `${int}.${dec}` : int;
  return (neg ? '-¥' : '¥') + body;
}
function moneyPlain(n) {
  const { int, dec } = splitMoney(n);
  return dec === '00' ? int : `${int}.${dec}`;
}
function round2(n) { return Math.round(Number(n || 0) * 100) / 100; }

/** 计价单位的后缀：¥36/小时、¥40/节、¥45/人 */
function unitSuffix(unit) {
  return unit === 'hour' ? '/小时' : unit === 'student' ? '/人' : '/节';
}
/** 「数量 × 单价」的展示式。按时长的课用真实分钟数表示，
 *  避免出现「×1.17 小时」这种近似值（36×1.17 会算出 42.12）。 */
function priceExpr(unitPrice, qty, unitLabel, dur) {
  const p = money(unitPrice);
  if (unitLabel === '小时') return `${Number(dur) || state.settings.defaultDur || 45} 分钟 × ${p}/小时`;
  if (unitLabel === '人') return `${qty} 人 × ${p}/人`;
  if (unitLabel === '人·节') return `${qty} 人·节 × ${p}/人·节`;
  return `${qty} 节 × ${p}/节`;
}

/* ---------------- 默认数据 ---------------- */
const DEFAULT_PERIODS = [
  { no: 0,  name: '早读',   short: '早读', start: '07:10', end: '07:40' },
  { no: 1,  name: '第1节',  short: '1',    start: '07:50', end: '08:35' },
  { no: 2,  name: '第2节',  short: '2',    start: '08:45', end: '09:30' },
  { no: 3,  name: '第3节',  short: '3',    start: '09:50', end: '10:35' },
  { no: 4,  name: '第4节',  short: '4',    start: '10:45', end: '11:30' },
  { no: 5,  name: '第5节',  short: '5',    start: '11:40', end: '12:25' },
  { no: 6,  name: '第6节',  short: '6',    start: '14:00', end: '14:45' },
  { no: 7,  name: '第7节',  short: '7',    start: '14:55', end: '15:40' },
  { no: 8,  name: '第8节',  short: '8',    start: '15:50', end: '16:35' },
  { no: 9,  name: '第9节',  short: '9',    start: '16:45', end: '17:30' },
  { no: 10, name: '晚自习1', short: '晚1',  start: '18:40', end: '19:25' },
  { no: 11, name: '晚自习2', short: '晚2',  start: '19:35', end: '20:20' },
];

const TYPE_COLORS = ['#3B5BFD', '#0FAF87', '#F59E0B', '#7C5CFF', '#0BA5EC', '#EF6C4D', '#E0457B', '#14A3A3'];

/**
 * 常见作息预设：一次换掉整张作息表，省得一条条填时间。
 * no 由下标生成，这里只写「叫什么、几点到几点」。
 */
const PERIOD_PRESETS = [
  {
    id: 'junior',
    name: '初中 · 8 节',
    desc: '早读 + 上午 4 节 + 下午 4 节，40 分钟一节',
    periods: [
      { name: '早读',  short: '早', start: '07:20', end: '07:50' },
      { name: '第1节', short: '1', start: '08:00', end: '08:40' },
      { name: '第2节', short: '2', start: '08:50', end: '09:30' },
      { name: '第3节', short: '3', start: '09:50', end: '10:30' },
      { name: '第4节', short: '4', start: '10:40', end: '11:20' },
      { name: '第5节', short: '5', start: '14:00', end: '14:40' },
      { name: '第6节', short: '6', start: '14:50', end: '15:30' },
      { name: '第7节', short: '7', start: '15:50', end: '16:30' },
      { name: '第8节', short: '8', start: '16:40', end: '17:20' },
    ],
  },
  {
    id: 'senior',
    name: '高中 · 9 节 + 晚自习',
    desc: '早读 + 白天 9 节 + 晚自习 2 节，45 分钟一节',
    periods: [
      { name: '早读',   short: '早',  start: '06:50', end: '07:20' },
      { name: '第1节',  short: '1',  start: '07:40', end: '08:25' },
      { name: '第2节',  short: '2',  start: '08:35', end: '09:20' },
      { name: '第3节',  short: '3',  start: '09:40', end: '10:25' },
      { name: '第4节',  short: '4',  start: '10:35', end: '11:20' },
      { name: '第5节',  short: '5',  start: '11:30', end: '12:15' },
      { name: '第6节',  short: '6',  start: '14:00', end: '14:45' },
      { name: '第7节',  short: '7',  start: '14:55', end: '15:40' },
      { name: '第8节',  short: '8',  start: '15:50', end: '16:35' },
      { name: '第9节',  short: '9',  start: '16:45', end: '17:30' },
      { name: '晚自习1', short: '晚1', start: '18:40', end: '19:25' },
      { name: '晚自习2', short: '晚2', start: '19:35', end: '20:20' },
    ],
  },
  {
    id: 'primary',
    name: '小学 · 6 节',
    desc: '上午 4 节 + 下午 2 节，40 分钟一节',
    periods: [
      { name: '第1节', short: '1', start: '08:00', end: '08:40' },
      { name: '第2节', short: '2', start: '08:50', end: '09:30' },
      { name: '第3节', short: '3', start: '09:50', end: '10:30' },
      { name: '第4节', short: '4', start: '10:40', end: '11:20' },
      { name: '第5节', short: '5', start: '14:00', end: '14:40' },
      { name: '第6节', short: '6', start: '14:50', end: '15:30' },
    ],
  },
];

/* ---------- 模板同步（内容与代码解耦：改 templates.json 即可，不用发版） ---------- */
// 顺序有讲究：jsDelivr 的 @main 地址有 12 小时 CDN 缓存，放前面会拿旧内容还不报错；
// 反代走的是实时的 raw，所以反代优先、jsDelivr 殿后兜底。
const TEMPLATE_BUNDLES = [
  'https://ghfast.top/https://raw.githubusercontent.com/user269/kechou/main/templates.json',
  'https://gh-proxy.com/https://raw.githubusercontent.com/user269/kechou/main/templates.json',
  'https://raw.githubusercontent.com/user269/kechou/main/templates.json',
  'https://cdn.jsdelivr.net/gh/user269/kechou@main/templates.json',
];
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 内置模板 + 联网同步来的模板，同 id 以联网的为准 */
function allPresets() {
  const map = new Map(PERIOD_PRESETS.map(p => [p.id, p]));
  (state.templates || []).forEach(p => map.set(p.id, p));
  return [...map.values()];
}

/** 容错解析：字段缺一个就丢那一条，不整份作废 */
function parseTemplatePayload(text) {
  const j = JSON.parse(text);
  const list = (j && j.periods) || null;
  if (!Array.isArray(list) || !list.length) throw new Error('没有模板数据');

  const out = [];
  list.forEach(p => {
    if (!p || !p.id || !p.name) return;
    const items = (p.items || []).filter(it => it && it.name
      && HM_RE.test(String(it.start)) && HM_RE.test(String(it.end)));
    if (!items.length) return;
    out.push({
      id: String(p.id).slice(0, 24),
      name: String(p.name).slice(0, 20),
      desc: String(p.desc || `${items.length} 个节次`).slice(0, 40),
      periods: items.slice(0, 20).map(it => ({
        name: String(it.name).slice(0, 8),
        short: String(it.short || '').slice(0, 4),
        start: it.start,
        end: it.end,
      })),
    });
  });
  if (!out.length) throw new Error('模板内容不可用');
  return out;
}

async function syncTemplates() {
  const errors = [];
  for (const url of TEMPLATE_BUNDLES) {
    try {
      const list = parseTemplatePayload(await fetchWithTimeout(url, 8000));
      state.templates = list;
      state.meta.templateSyncAt = Date.now();
      save();
      return { ok: true, count: list.length, errors };
    } catch (e) {
      errors.push(`${url.slice(0, 38)}… ${e && e.message ? e.message : '失败'}`);
    }
  }
  return { ok: false, errors };
}

function defaultTypes() {
  return [
    { id: 'regular', name: '正课',   unit: 'period', price: 65,  factor: 1,   color: '#3B5BFD', tierable: true,  enabled: true },
    { id: 'self',    name: '自习',   unit: 'period', price: 25,  factor: 1,   color: '#0FAF87', tierable: false, enabled: true },
    { id: 'morning', name: '早读',   unit: 'period', price: 15,  factor: 1,   color: '#F59E0B', tierable: false, enabled: true },
    { id: 'night',   name: '晚自习', unit: 'period', price: 30,  factor: 1,   color: '#7C5CFF', tierable: false, enabled: true },
    { id: 'tutor',   name: '辅导',   unit: 'hour',   price: 120, factor: 1,   color: '#0BA5EC', tierable: false, enabled: true },
  ];
}

function defaultSettings() {
  return {
    scheme: 'standard',        // standard | tiered | overtime
    useClassFactor: true,      // 班级系数加成
    classFactors: [
      { key: '高三', factor: 1.2 },
      { key: '初三', factor: 1.15 },
    ],
    tiers: [
      { upTo: 20, price: 65 },
      { upTo: 40, price: 75 },
      { upTo: 9999, price: 90 },
    ],
    overtimeFrom: 40,
    overtimeRate: 1.5,
    remindEnabled: true,
    remindBefore: 10,
    dailyRemind: false,
    dailyRemindAt: '21:00',
    defaultDur: 45,
    updateSource: '',          // 自定义更新源（留空用内置的候选列表）
    updateCache: null,         // 上次成功拿到的清单，断网时用来告诉用户「上次检查是几号」
    lastUpdateOk: 0,
    lastLesson: null,          // 上次录入课程时的偏好（类型、时长、人数、延长），下次自动带出
    extendTypeId: 'self',      // 延长课时按哪个类型的单价计价（默认自习）
    activeScheme: '',          // 当前应用的保存方案 id（空 = 未保存的自定义）
    termStart: '',             // 学期第一周的周一（用于周次编号与单双周判定）
    termWeeks: 20,             // 学期总周数
    holidaySkip: true,         // 排课时跳过法定假日（半天只排到放学时刻）
    holidaySource: '',         // 自定义节假日同步源（留空用内置候选）
    // 调休规则：某类周的某天只上半天，被截掉的课平移到同周另一天
    makeup: {
      enabled: true,
      parity: 'even',          // 触发周：odd 单周 | even 双周
      fromDow: 5,              // 触发日：0=周日 … 5=周五 6=周六
      toDow: 0,                // 平移到：默认周日返校
      cutAfter: 5,             // 上到第几节为止（含），之后的课平移到目标日
      includeNight: true,      // 晚自习是否一起平移
      autoSync: false,         // 调休后是否自动重建该周课表
    },
  };
}

/* ---------------- 状态与持久化 ---------------- */
const STORE_KEY = 'kerchou.v1';

let state = {
  teacher: { name: '张老师', school: '阳光中学', subject: '数学', avatar: '' },
  settings: defaultSettings(),
  types: defaultTypes(),
  periods: DEFAULT_PERIODS.map(p => ({ ...p })),
  lessons: [],
  swaps: [],
  master: {},           // 总课表模板：`星期#节次#周次` → { typeId, klass, subject }
  adjusts: [],          // 调休记录
  holidays: allBuiltinHolidays(),   // 法定节假日（放假 / 补班），可自行增删改
  templates: [],        // 联网同步来的作息模板（内置的另算，见 allPresets）
  extras: [],           // 补贴与扣款：{id,name,amount,kind:'add'|'sub',cycle:'monthly'|'once',date}
  schemes: [],          // 保存的计费方案：{id,name,at,snap}
  meta: {
    seeded: false, notified: {}, holidaySyncAt: 0, templateSyncAt: 0,
    deviceId: '',        // 本机标识，同步时用来区分「哪台设备改的」
    deviceName: '',      // 用户可改的显示名
    rev: {}, fp: {}, tomb: {},   // 同步用：各自实体的修改时间、指纹、删除标记
    syncInit: 0, syncAt: 0, syncPeer: '',
  },
};

/* ============================================================
   数据自检与修复
   ------------------------------------------------------------
   坏数据比崩溃更麻烦：一条 typeId 指向不存在的类型，getType() 会悄悄
   回落到第一种课，金额按错误单价算出来，界面上看不出任何异常。
   所以每次启动先过一遍，能修的修掉，修了什么记下来告诉用户。
   ============================================================ */

const REPAIR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const REPAIR_HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const LESSON_STATUS = ['normal', 'canceled', 'leave', 'swapped'];

function repairState() {
  const fixed = [];
  const s = state;
  const note = msg => { if (!fixed.includes(msg)) fixed.push(msg); };

  /* ---- 课程类型：金额全靠它 ---- */
  if (!Array.isArray(s.types) || !s.types.length) {
    s.types = defaultTypes();
    note('课程类型丢失，已恢复默认');
  } else {
    const seen = new Set();
    const kept = [];
    s.types.forEach(t => {
      if (!t || !t.id) { note('有课程类型缺少标识，已移除'); return; }
      if (seen.has(t.id)) { note('有重复的课程类型，已去重'); return; }
      seen.add(t.id);
      if (!Number.isFinite(Number(t.price))) { t.price = 0; note('有课程类型单价不是数字，已归零'); }
      else t.price = Number(t.price);
      if (!Number.isFinite(Number(t.factor)) || Number(t.factor) <= 0) { t.factor = 1; }
      else t.factor = Number(t.factor);
      if (!['period', 'hour', 'student'].includes(t.unit)) t.unit = 'period';
      kept.push(t);
    });
    if (!kept.length) { s.types = defaultTypes(); note('课程类型全部不可用，已恢复默认'); }
    else s.types = kept;
  }
  const typeIds = new Set(s.types.map(t => t.id));
  const fallbackType = (s.types.find(t => t.enabled !== false) || s.types[0]).id;

  /* ---- 作息：决定时长和提醒时间 ---- */
  if (!Array.isArray(s.periods) || !s.periods.length) {
    s.periods = DEFAULT_PERIODS.map(p => ({ ...p }));
    note('作息时间表丢失，已恢复默认');
  } else {
    let badTime = 0;
    s.periods.forEach((p, i) => {
      if (!p || typeof p !== 'object') {
        s.periods[i] = { ...DEFAULT_PERIODS[Math.min(i, DEFAULT_PERIODS.length - 1)] };
        note('有作息节次损坏，已用默认值补上');
        return;
      }
      if (!REPAIR_HM.test(String(p.start))) { p.start = '08:00'; badTime++; }
      if (!REPAIR_HM.test(String(p.end))) { p.end = '08:45'; badTime++; }
    });
    if (badTime) note('有作息时间格式不对，已改成整点默认');

    // 节次编号只在「重复 / 非整数」时重排，而且起点沿用原数据的最小值。
    // 默认作息是从 0 开始（早读 = 第 0 节），如果硬按 i+1 改成 1 开头，
    // 所有课的时间会整体错位一节——这个坑测试当场抓到了。
    const nos = s.periods.map(p => Number(p.no));
    const valid = nos.filter(n => Number.isInteger(n));
    if (valid.length !== s.periods.length || new Set(valid).size !== s.periods.length) {
      const base = Math.max(0, valid.length ? Math.min(...valid) : 0);
      s.periods.forEach((p, i) => { p.no = base + i; });
      note('作息节次编号有重复或异常，已按顺序重排');
    }
  }
  // 合法节次是 periods 里实际的 no 集合（可能是 0..11，也可能自定义），
  // 不能用 1..length 判断，否则早读（第 0 节）会被判成非法。
  const periodNos = s.periods.map(p => p.no);
  const minNo = Math.min(...periodNos);
  const maxNo = Math.max(...periodNos);

  /* ---- 课程记录：一条坏记录就是一笔错账 ---- */
  if (!Array.isArray(s.lessons)) {
    s.lessons = [];
    note('课程记录格式损坏，已清空（设置都保留）');
  } else {
    let badDate = 0, badPeriod = 0, badType = 0, badDur = 0, badId = 0, badStatus = 0;
    const today = todayYmd();
    const seenIds = new Set();
    s.lessons = s.lessons.filter(l => l && typeof l === 'object').map(l => {
      if (!l.id || seenIds.has(l.id)) { l.id = uid(); badId++; }
      seenIds.add(l.id);
      if (!REPAIR_DATE.test(String(l.date))) { l.date = today; badDate++; }
      const p = Number(l.period);
      if (!Number.isFinite(p) || p < minNo || p > maxNo) {
        l.period = clamp(Number.isFinite(p) ? Math.round(p) : minNo, minNo, maxNo);
        badPeriod++;
      }
      if (!typeIds.has(l.typeId)) { l.typeId = fallbackType; badType++; }
      if (l.dur != null && (!Number.isFinite(Number(l.dur)) || Number(l.dur) <= 0)) {
        l.dur = Number(s.settings.defaultDur) || 45;
        badDur++;
      }
      if (!LESSON_STATUS.includes(l.status)) { l.status = 'normal'; badStatus++; }
      return l;
    });
    if (badId) note(`${badId} 节课程缺少标识，已补上`);
    if (badDate) note(`${badDate} 节课程日期不合法，已改成今天`);
    if (badPeriod) note(`${badPeriod} 节课程节次超出作息范围，已夹到有效节次`);
    if (badType) note(`${badType} 节课程的类型不存在，已改成「${(s.types.find(t => t.id === fallbackType) || {}).name || fallbackType}」`);
    if (badDur) note(`${badDur} 节课程时长不合法，已恢复默认`);
    if (badStatus) note(`${badStatus} 节课程状态异常，已改回正常`);
  }

  /* ---- 总课表：键格式坏了对不上任何一天 ---- */
  if (s.master && typeof s.master === 'object') {
    let bad = 0;
    Object.keys(s.master).forEach(k => {
      const parts = String(k).split('#');
      const cell = s.master[k];
      const okKey = parts.length === 3
        && /^[0-6]$/.test(parts[0])
        && Number(parts[1]) >= minNo && Number(parts[1]) <= maxNo
        && /^(all|odd|even)$/.test(parts[2]);
      if (!okKey || !cell || typeof cell !== 'object' || !typeIds.has(cell.typeId)) {
        delete s.master[k];
        bad++;
      }
    });
    if (bad) note(`总课表里 ${bad} 个格子的数据不可用，已移除`);
  } else if (s.master != null) {
    s.master = {};
    note('总课表格式损坏，已重置');
  }

  /* ---- 数值设置：越界会让提醒或统计出错 ---- */
  const st = s.settings || {};
  const numFix = (key, min, max, label) => {
    const v = Number(st[key]);
    if (!Number.isFinite(v) || v < min || v > max) {
      st[key] = clamp(Number.isFinite(v) ? v : min, min, max);
      if (label) note(label);
    }
  };
  numFix('remindBefore', 0, 120, '「提前提醒」的分钟数超出范围，已修正');
  numFix('termWeeks', 1, 30, '学期周数超出范围，已修正');
  numFix('defaultDur', 1, 300, '默认课程时长超出范围，已修正');
  numFix('overtimeFrom', 0, 200, null);
  numFix('overtimeRate', 0.1, 5, null);

  /* ---- 补贴与扣款 ---- */
  if (Array.isArray(s.extras)) {
    let bad = 0;
    s.extras = s.extras.filter(e => {
      if (!e || typeof e !== 'object' || !e.id) { bad++; return false; }
      if (!Number.isFinite(Number(e.amount))) { bad++; return false; }
      if (!['add', 'sub'].includes(e.kind)) e.kind = 'add';
      if (!['monthly', 'once'].includes(e.cycle)) e.cycle = 'once';
      return true;
    });
    if (bad) note(`补贴与扣款里有 ${bad} 条数据不可用，已移除`);
  } else if (s.extras != null) {
    s.extras = [];
  }

  return fixed;
}

function save() {
  try {
    // 记下每条记录的修改时间：同步靠它判断「谁更新」，业务代码不用关心
    trackChanges();
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('保存失败', e);
  }
  // 局域网面板开着时，边改边更新交给对方的快照，
  // 否则对方拉到的还是打开面板那一刻的数据
  if (window.__lanOn && window.Native && window.Native.lanPublish) {
    try { window.Native.lanPublish(JSON.stringify(buildSyncPacket())); } catch (e) { }
  }
  scheduleReminderSync();
}
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    state = {
      ...state,
      ...data,
      settings: { ...defaultSettings(), ...(data.settings || {}), makeup: { ...defaultSettings().makeup, ...((data.settings || {}).makeup || {}) } },
      teacher: { ...state.teacher, ...(data.teacher || {}) },
      periods: (data.periods && data.periods.length) ? data.periods : state.periods,
      types: (data.types && data.types.length) ? data.types : state.types,
      lessons: Array.isArray(data.lessons) ? data.lessons.map(l => ({ ...l, weekMode: l.weekMode || 'all' })) : [],
      swaps: Array.isArray(data.swaps) ? data.swaps : [],
      master: (data.master && typeof data.master === 'object') ? data.master : {},
      adjusts: Array.isArray(data.adjusts) ? data.adjusts : [],
      holidays: Array.isArray(data.holidays) && data.holidays.length
        ? sortHolidays(data.holidays.map(normalizeHoliday).filter(Boolean))
        : allBuiltinHolidays(),
      meta: { ...state.meta, ...(data.meta || {}) },
    };
    // 老版本升级上来：第一次打开时建立同步基线（统一记 0，之后才逐条记真实时间）
    state.meta.rev = state.meta.rev || {};
    state.meta.fp = state.meta.fp || {};
    state.meta.tomb = state.meta.tomb || {};
    if (!state.meta.deviceId) deviceInfo();
    // 数据修正在这里做：越早越好，后面所有计算都建立在干净数据上
    try {
      const fixed = repairState();
      if (fixed.length) {
        state.meta.repairedAt = Date.now();
        state.meta.repairNotes = fixed.slice(0, 8);
      }
    } catch (e) {
      console.warn('数据自检失败', e);
    }
    return true;
  } catch (e) {
    console.warn('读取失败', e);
    return false;
  }
}

/* ---------------- 演示数据 ---------------- */
const DEMO_CLASSES = ['高一(3)班', '高一(5)班', '高二(2)班', '高二(4)班'];

const DEMO_TEMPLATE = {
  1: [{ p: 0, t: 'morning' }, { p: 1, t: 'regular' }, { p: 3, t: 'regular' }, { p: 6, t: 'regular' }, { p: 10, t: 'night' }],
  2: [{ p: 2, t: 'regular' }, { p: 4, t: 'tutor', w: 'odd' }, { p: 7, t: 'regular' }],
  3: [{ p: 0, t: 'morning' }, { p: 1, t: 'regular' }, { p: 3, t: 'regular' }, { p: 6, t: 'regular' }, { p: 11, t: 'night' }],
  4: [{ p: 2, t: 'regular' }, { p: 5, t: 'regular', w: 'even' }, { p: 7, t: 'regular' }, { p: 10, t: 'night' }],
  5: [{ p: 1, t: 'regular' }, { p: 4, t: 'regular' }, { p: 8, t: 'self' }],
  6: [{ p: 3, t: 'self' }],
  0: [],
};

function seedDemo() {
  const lessons = [];
  const thisMonday = startOfWeek(new Date());
  state.meta.seeded = true;
  // 学期首周设为 7 周前，于是本周是第 8 周、下周是第 9 周
  state.settings.termStart = ymd(addDays(thisMonday, -49));
  state.settings.termWeeks = 20;
  // 生成过去 7 周 + 本周 + 下周
  for (let w = -7; w <= 1; w++) {
    const mon = addDays(thisMonday, w * 7);
    for (let wd = 0; wd <= 6; wd++) {
      const day = addDays(mon, wd);
      const dow = day.getDay();
      const tpl = DEMO_TEMPLATE[dow] || [];
      tpl.forEach((item, idx) => {
        // 单双周课程只在对应周次出现
        if (item.w && weekParity(ymd(day)) !== item.w) return;
        // 周末偶尔取消，制造真实感
        if (dow === 6 && (w + idx) % 3 === 0) return;
        const period = state.periods.find(p => p.no === item.p);
        if (!period) return;
        lessons.push({
          id: uid() + w + '_' + wd + '_' + item.p,
          date: ymd(day),
          period: item.p,
          typeId: item.t,
          klass: DEMO_CLASSES[(w + wd + idx + 8) % DEMO_CLASSES.length],
          subject: '数学',
          dur: periodMinutes(item.p),
          durAuto: true,       // 时长跟随作息时间表
          students: item.t === 'tutor' ? 1 : 0,
          note: '',
          weekMode: item.w || 'all',
          status: 'normal',
          demo: true,          // 示例课标记：可被「仅清理示例课」精准删除
          createdAt: Date.now(),
        });
      });
    }
  }
  return lessons;
}

/* ---------------- 清理课表 ---------------- */
const demoLessons = () => state.lessons.filter(l => l.demo);

/** mode: 'demo' 只清理示例课 | 'all' 清空全部课程 */
function clearSchedule(mode) {
  const removed = new Set();
  if (mode === 'demo') {
    state.lessons = state.lessons.filter(l => {
      if (l.demo) { removed.add(l.id); return false; }
      return true;
    });
  } else {
    state.lessons.forEach(l => removed.add(l.id));
    state.lessons = [];
  }

  if (mode === 'all') {
    state.swaps = [];
    state.adjusts = [];
    state.master = {};
    state.settings.termStart = '';   // 学期基准回到「本周为第 1 周」
  } else {
    // 只留下与现存课程相关的调休 / 调课记录
    state.adjusts = state.adjusts.filter(a => !(a.moves || []).some(m => removed.has(m.lessonId)));
    state.swaps = state.swaps.filter(s => !(removed.has(s.a) || removed.has(s.b)));
    state.lessons.forEach(l => {
      if (l.status !== 'swapped') return;
      const still = state.adjusts.some(a => !a.undone && (a.moves || []).some(m => m.lessonId === l.id));
      if (!still && l.adjustFrom) { l.status = 'normal'; delete l.adjustFrom; }
    });
    state.master = inferMaster();
  }

  state.meta.notified = {};
  state.meta.seeded = state.lessons.some(l => l.demo);
  save();
  render();
  toast(mode === 'demo' ? `已清理 ${removed.size} 节示例课` : `已清空 ${removed.size} 节课`, 'reset');
}

function openClearSheet() {
  const total = state.lessons.length;
  const demoN = demoLessons().length;
  const userN = total - demoN;
  const masterN = masterLessonCount();

  if (!total) {
    toast('课表现在是空的', 'info');
    return;
  }

  openSheet({
    title: '清理课表',
    body: `
      <div class="info-banner" style="margin-bottom:14px">
        ${ic('info', 16)}
        <div>只删除<b>课程记录</b>，作息时间、单价方案与个人信息都会保留。</div>
      </div>
      <div class="rows">
        ${demoN ? `<div class="row" data-act="clear-demo">
          <div class="ri" style="background:var(--amber-soft);color:#B26A00">${ic('spark', 17)}</div>
          <div class="rc"><div class="t">仅清理示例课</div><div class="s">删除 ${demoN} 节演示课${userN ? `，保留自己录入的 ${userN} 节` : ''}</div></div>
          ${ic('right', 15)}
        </div>` : ''}
        <div class="row" data-act="clear-all">
          <div class="ri" style="background:var(--rose-soft);color:var(--rose)">${ic('trash', 17)}</div>
          <div class="rc"><div class="t" style="color:var(--rose)">清空全部课程</div><div class="s">删除 ${total} 节课${masterN ? `、总课表 ${masterN} 个时段` : ''}与调课调休记录</div></div>
          ${ic('right', 15)}
        </div>
      </div>
      <div class="tiny muted center" style="margin-top:14px;line-height:1.8">
        清空后可用「批量导入」或「总课表」重新录入
      </div>
    `,
    footer: `<button class="btn ghost" data-close>取消</button>`,
  });
}

/* ---------------- 基础查询 ---------------- */
const getType = id => state.types.find(t => t.id === id) || state.types[0] || { name: '课程', price: 0, color: '#3B5BFD', unit: 'period', factor: 1 };

const TYPE_ICONS = { regular: 'book', self: 'edit', morning: 'spark', night: 'clock', tutor: 'user' };
const typeIcon = t => TYPE_ICONS[t && t.id] || 'grid';
const getPeriod = no => state.periods.find(p => p.no === Number(no)) || state.periods[0];
function periodTime(no) {
  const p = getPeriod(no);
  return { start: p.start, end: p.end, name: p.name };
}
/** 两个时刻之间的分钟数（跨零点按 24 小时回绕） */
function minutesBetween(start, end) {
  const [sh, sm] = String(start || '00:00').split(':').map(Number);
  const [eh, em] = String(end || '00:00').split(':').map(Number);
  if ([sh, sm, eh, em].some(n => !Number.isFinite(n))) return 0;
  let m = (eh * 60 + em) - (sh * 60 + sm);
  if (m <= 0) m += 1440;
  return m > 0 && m <= 1440 ? m : 0;
}
/** 某一节课在作息表里的长度（分钟）——自习、正课的时长都以此为准 */
function periodMinutes(no) {
  const p = getPeriod(no);
  const m = minutesBetween(p.start, p.end);
  return m || Number(state.settings.defaultDur) || 45;
}
/** 该课是否「时长跟随作息」：老数据没有标记时，用 durations 是否等于当时作息长度来判断 */
function isDurAuto(l) {
  if (!l) return true;
  if (l.durAuto === false) return false;
  if (l.durAuto === true) return true;
  return Number(l.dur) === periodMinutes(l.period);
}
function lessonKey(l) { return `${l.date}#${l.period}`; }

/** 课程开始时间 → Date */
function lessonStart(l) {
  const p = getPeriod(l.period);
  const d = parseYmd(l.date);
  const [h, m] = (p.start || '00:00').split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}
function lessonEnd(l) {
  const p = getPeriod(l.period);
  const start = parseYmd(l.date);
  const [sh, sm] = (p.start || '00:00').split(':').map(Number);
  start.setHours(sh, sm, 0, 0);

  const d = new Date(start.getTime());
  if (l.durAuto === false && Number(l.dur) > 0) {
    // 手动指定时长：按开始时间 + 时长
    d.setMinutes(d.getMinutes() + Number(l.dur));
  } else {
    // 跟随作息：用该节的结束时间（跨零点顺延一天）
    const [eh, em] = (p.end || '00:00').split(':').map(Number);
    d.setHours(eh, em, 0, 0);
    if (d.getTime() <= start.getTime()) d.setDate(d.getDate() + 1);
  }
  // 延长课时顺延结束时间
  const ext = Number(l.extend) || 0;
  if (ext > 0) d.setMinutes(d.getMinutes() + ext);
  return d;
}

const STATUS_LABEL = {
  normal: '',
  swapped: '调课',
  canceled: '已取消',
  leave: '请假',
  makeup: '补课',
};

/* ---------------- 计费引擎 ---------------- */
/**
 * 单节课基础计费
 * unit: period(元/节) | hour(元/小时) | student(元/人·节)
 */
function calcLesson(l) {
  const t = getType(l.typeId);
  let qty = 1, unitPrice = Number(t.price) || 0, unitLabel = '节';

  if (t.unit === 'hour') {
    qty = (Number(l.dur) || state.settings.defaultDur || 45) / 60;
    unitLabel = '小时';
  } else if (t.unit === 'student') {
    qty = Number(l.students) || 1;
    unitLabel = '人';
  }

  const base = unitPrice * qty * (Number(t.factor) || 1);

  // 班级系数
  let classFactor = 1, classKey = '';
  if (state.settings.useClassFactor) {
    const hit = (state.settings.classFactors || []).find(c => c.key && String(l.klass || '').includes(c.key));
    if (hit) { classFactor = Number(hit.factor) || 1; classKey = hit.key; }
  }

  return {
    type: t,
    qty: round2(qty),      // 展示用（70 分钟 → 1.17 小时）
    qtyRaw: qty,           // 计算用，绝不拿取整后的数量再乘单价
    unitPrice,
    unitLabel,
    base: round2(base),
    classFactor,
    classKey,
    subtotal: round2(base * classFactor),
  };
}

/* ---------------- 延长课 ----------------
   一节课超出原定节次的部分，不按原课程单价算，而是按「自习」那套单价与
   计价方式折算（默认取自习类型，可在计费设置里改）。                     */
function extendType() {
  const want = state.settings.extendTypeId;
  let t = want ? state.types.find(x => x.id === want) : null;
  if (!t) t = state.types.find(x => x.id === 'self') || state.types.find(x => /自习/.test(x.name));
  return t || { id: 'self', name: '自习', price: 0, unit: 'period', factor: 1, color: '#5CE1B4' };
}

/** 单节课的延长费用；未延长返回 null */
function calcExtend(l) {
  const min = Number(l.extend) || 0;
  if (min <= 0) return null;

  const t = extendType();
  const periodMin = Number(l.dur) || Number(state.settings.defaultDur) || 45;
  const ppl = Number(l.students) || 1;
  let qty, unitLabel, note;

  if (t.unit === 'hour') {
    qty = min / 60;
    unitLabel = '小时';
    note = `${min} 分钟`;
  } else if (t.unit === 'student') {
    qty = ppl * (min / periodMin);
    unitLabel = '人·节';
    note = `${ppl} 人 × ${min} 分钟`;
  } else {
    qty = min / periodMin;
    unitLabel = '节';
    note = `${min} 分钟（按 ${periodMin} 分钟/节折算）`;
  }

  const price = Number(t.price) || 0;
  const base = price * qty * (Number(t.factor) || 1);

  // 展示用的精确算式：分钟除不尽时用分数表示，避免「×0.44 却不等于金额」
  let expr;
  if (t.unit === 'hour') expr = `¥${price}/小时 × ${min}/60 小时`;
  else if (t.unit === 'student') expr = `¥${price}/人 × ${ppl} 人 × ${min}/${periodMin} 节`;
  else expr = `¥${price}/节 × ${min}/${periodMin} 节`;

  // 延长时段仍在同一个班，班级系数一并生效
  let classFactor = 1, classKey = '';
  if (state.settings.useClassFactor) {
    const hit = (state.settings.classFactors || []).find(c => c.key && String(l.klass || '').includes(c.key));
    if (hit) { classFactor = Number(hit.factor) || 1; classKey = hit.key; }
  }

  return {
    type: t,
    minutes: min,
    qty: round2(qty),
    unitPrice: price,
    unitLabel,
    note,
    expr,
    base: round2(base),
    classFactor,
    classKey,
    subtotal: round2(base * classFactor),
  };
}

/** 单节课总课时费（正课 + 延长），不套用月度计费方案，用于展示 */
function lessonTotal(l) {
  if (l.status === 'canceled' || l.status === 'leave') return 0;
  const c = calcLesson(l);
  const e = calcExtend(l);
  return round2(c.subtotal + (e ? e.subtotal : 0));
}

/** 编辑弹层里的计费预览文案 */
function lessonPreview(l) {
  const c = calcLesson(l);
  const e = calcExtend(l);
  const total = round2(c.subtotal + (e ? e.subtotal : 0));
  let sub = `${c.type.name} ${money(c.unitPrice)}/${c.unitLabel}`;
  if (e) sub += ` ＋ 延长 ${e.minutes} 分按${e.type.name} ${money(e.subtotal)}`;
  if (l.status === 'leave' || l.status === 'canceled') sub += ' · 不计费';
  return { total, sub };
}

function pickTier(cum) {
  const tiers = (state.settings.tiers || []).slice().sort((a, b) => a.upTo - b.upTo);
  for (let i = 0; i < tiers.length; i++) {
    if (cum < Number(tiers[i].upTo)) return { ...tiers[i], index: i + 1 };
  }
  return { ...(tiers[tiers.length - 1] || { upTo: 9999, price: 0 }), index: tiers.length };
}

/**
 * 月度结算
 * 返回 { rows, total, doneFee, planFee, doneCount, planCount, byType, km }
 */
/* ---------------- 补贴与扣款 ---------------- */
/**
 * 某月生效的补贴/扣款条目。
 *
 * cycle='monthly'：从起始那个月起，往后每个月都算（班主任津贴、教龄补贴这类）；
 * cycle='once'   ：只算起始那个月（监考费、代课费、一次性的缺勤扣款）。
 * 都是"起始月 ≤ 目标月"即可，想看更早的月份自然不会命中。
 */
function extrasOf(ym, list) {
  return (list || state.extras || []).filter(e => {
    const em = String(e.date || '').slice(0, 7);
    if (!em) return false;
    return e.cycle === 'monthly' ? em <= ym : em === ym;
  }).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function extraTotals(ym) {
  const rows = extrasOf(ym);
  let add = 0, sub = 0;
  rows.forEach(e => {
    const a = Math.abs(Number(e.amount) || 0);
    if (e.kind === 'sub') sub += a; else add += a;
  });
  return { rows, add: round2(add), sub: round2(sub) };
}

function calcMonth(ym) {
  const scheme = state.settings.scheme;
  const tstr = todayYmd();

  const lessons = state.lessons
    .filter(l => String(l.date).startsWith(ym) && l.status !== 'canceled' && l.status !== 'leave')
    .sort((a, b) => (a.date === b.date ? a.period - b.period : a.date < b.date ? -1 : 1));

  let cumPeriods = 0;
  const rows = lessons.map(l => {
    const r = calcLesson(l);
    const t = r.type;
    let unitPrice = r.unitPrice;
    let extra = 0, extraLabel = '', meta = '';

    if (scheme === 'tiered' && t.tierable) {
      const tier = pickTier(cumPeriods);
      unitPrice = Number(tier.price);
      meta = `阶梯第${tier.index}档`;
      cumPeriods += 1;
    } else if (scheme === 'overtime' && t.tierable) {
      const from = Number(state.settings.overtimeFrom) || 0;
      if (from > 0 && cumPeriods >= from) {
        const rate = Number(state.settings.overtimeRate) || 1;
        extra = 1; // 标记
        extraLabel = `超课时 ×${rate}`;
      }
      cumPeriods += 1;
    } else if (t.tierable) {
      cumPeriods += 1;
    }

    let base = unitPrice * (r.qtyRaw != null ? r.qtyRaw : r.qty);
    if (scheme === 'overtime' && extra) base *= Number(state.settings.overtimeRate) || 1;

    // 延长部分按自习计价单独算，不参与阶梯/超课时（那两条针对整节课）
    const ex = calcExtend(l);
    const extFee = ex ? ex.subtotal : 0;
    const subtotal = round2(base * r.classFactor + extFee);

    return {
      lesson: l,
      type: t,
      qty: r.qty,
      qtyRaw: r.qtyRaw,
      unitPrice: round2(unitPrice),
      unitLabel: r.unitLabel,
      base: round2(base),
      classFactor: r.classFactor,
      classKey: r.classKey,
      subtotal,
      extend: ex,
      meta,
      extraLabel,
      done: l.date <= tstr,
    };
  });

  // 延长课的费用按自习归集，所以「自习」那一栏 = 自习课 + 各科延长部分
  const byType = {};
  const bucketOf = t => ({ id: t.id, name: t.name, color: t.color, unit: t.unit || 'period', price: Number(t.price) || 0, fee: 0, count: 0, doneCount: 0 });
  rows.forEach(r => {
    const k = r.type.id;
    if (!byType[k]) byType[k] = bucketOf(r.type);
    const ownFee = round2(r.subtotal - (r.extend ? r.extend.subtotal : 0));
    byType[k].fee = round2(byType[k].fee + ownFee);
    byType[k].count += 1;
    if (r.done) byType[k].doneCount += 1;

    if (r.extend) {
      const ek = r.extend.type.id;
      if (!byType[ek]) byType[ek] = bucketOf(r.extend.type);
      // 延长不计节数（不是独立一节课），金额按计价类型归集
      byType[ek].fee = round2(byType[ek].fee + r.extend.subtotal);
    }
  });

  const lessonTotal = round2(rows.reduce((s, r) => s + r.subtotal, 0));
  // 补贴与扣款直接进总额：工资条上本来就是一进一出算在一起的
  const ex = extraTotals(ym);
  const total = round2(lessonTotal + ex.add - ex.sub);
  const doneFee = round2(rows.filter(r => r.done).reduce((s, r) => s + r.subtotal, 0));
  const planFee = round2(total - doneFee);
  const doneCount = rows.filter(r => r.done).length;
  const planCount = rows.length - doneCount;

  // 总课时（按 45 分钟折算，延长的时间也算进总量）
  const totalMinutes = rows.reduce((s, r) => s + (Number(r.lesson.dur) || 45) + (Number(r.lesson.extend) || 0), 0);
  const km = round2(totalMinutes / 45);

  return {
    ym, rows, total, lessonTotal, doneFee, planFee, doneCount, planCount,
    count: rows.length, km,
    extraRows: ex.rows, extraAdd: ex.add, extraSub: ex.sub,
    byType: Object.values(byType).sort((a, b) => b.fee - a.fee),
  };
}

/** 某天的课（按节次排序） */
function lessonsOfDay(dateStr) {
  return state.lessons
    .filter(l => l.date === dateStr)
    .sort((a, b) => a.period - b.period);
}
/** 某天的课时费合计（按当前方案单日独立计算，仅作展示） */
function dayFee(dateStr) {
  return round2(lessonsOfDay(dateStr)
    .filter(l => l.status !== 'canceled' && l.status !== 'leave')
    .reduce((s, l) => s + lessonTotal(l), 0));
}
function dayCount(dateStr) {
  return lessonsOfDay(dateStr).filter(l => l.status !== 'canceled' && l.status !== 'leave').length;
}

/* ---------------- 导航 ---------------- */
let currentTab = 'home';
let viewDate = new Date();
let schedMode = 'day';          // day | week
let payMonth = todayYmd().slice(0, 7);
let payDetailOpen = false;

const TAB_META = {
  home: { title: () => greetingTitle(), sub: () => fmtFullDate(new Date()) },
  schedule: { title: () => '我的课表', sub: () => `${monthLabel(todayYmd().slice(0, 7))} · 本月 ${state.lessons.filter(l => l.date.startsWith(todayYmd().slice(0, 7))).length} 节课` },
  pay: { title: () => '课时费', sub: () => '自动结算 · 实时更新' },
  mine: { title: () => '我的', sub: () => '数据只保存在本机' },
};

function greetingTitle() {
  const h = new Date().getHours();
  const g = h < 6 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
  return `${g}，${state.teacher.name}`;
}
function fmtFullDate(d) {
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK_CN[d.getDay()]}`;
}

function switchTab(tab) {
  currentTab = tab;
  $$('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + tab));
  $('#main').scrollTop = 0;
  renderTopbar();
  render();
}

function renderTopbar() {
  const meta = TAB_META[currentTab];
  const row = $('#topbarRow');
  if (currentTab === 'home' || currentTab === 'schedule') {
    row.innerHTML = `
      <div style="flex:1;min-width:0">
        <h1 class="topbar-title">${esc(meta.title())}</h1>
        <div class="topbar-sub">${esc(meta.sub())}</div>
      </div>
      <button class="icon-btn" data-act="open-remind" aria-label="提醒">
        ${ic('bell', 19)}
        <span id="bellDot" style="position:absolute;transform:translate(11px,-9px);width:7px;height:7px;border-radius:50%;background:var(--rose);display:none"></span>
      </button>
      <div class="avatar" data-act="go-mine">${esc((state.teacher.name || '师').slice(0, 1))}</div>`;
  } else if (currentTab === 'pay') {
    row.innerHTML = `
      <div style="flex:1;min-width:0">
        <h1 class="topbar-title">课时费</h1>
        <div class="topbar-sub">${esc(meta.sub())}</div>
      </div>
      <button class="icon-btn" data-act="open-calc-rules" aria-label="计费规则">${ic('cog', 19)}</button>`;
  } else {
    row.innerHTML = `
      <div style="flex:1;min-width:0">
        <h1 class="topbar-title">我的</h1>
        <div class="topbar-sub">${esc(meta.sub())}</div>
      </div>`;
  }
  // 铃铛红点：今天是否还有未上课
  const dot = $('#bellDot');
  if (dot) {
    const t = todayYmd();
    const now = Date.now();
    const un = lessonsOfDay(t).some(l => lessonEnd(l).getTime() > now && l.status !== 'canceled');
    dot.style.display = un ? 'block' : 'none';
  }
}

function render() {
  if (currentTab === 'home') renderHome();
  else if (currentTab === 'schedule') renderSchedule();
  else if (currentTab === 'pay') renderPay();
  else renderMine();
}

/** 计算对比基准：当月看「上月同期」，历史月看整月 */
function compareBase(ym, prevData) {
  const isCur = ym === todayYmd().slice(0, 7);
  if (!isCur) return { total: prevData.total, label: '较上月' };
  const dayN = new Date().getDate();
  const total = round2(prevData.rows
    .filter(r => parseYmd(r.lesson.date).getDate() <= dayN)
    .reduce((s, r) => s + r.subtotal, 0));
  return { total, label: '较上月同期' };
}

/* ---------------- 首页 ---------------- */
function renderHome() {
  const ym = todayYmd().slice(0, 7);
  const m = calcMonth(ym);
  const prev = calcMonth(shiftMonth(ym, -1));
  const t = todayYmd();
  const todayList = lessonsOfDay(t);
  const mSplit = splitMoney(m.total);

  // 环比
  const base = compareBase(ym, prev);
  let deltaHtml = '本月暂无数据';
  if (base.total > 0) {
    const d = round2(((m.total - base.total) / base.total) * 100);
    if (d > 0.05) deltaHtml = `${base.label} <b>↑ ${d.toFixed(1)}%</b>`;
    else if (d < -0.05) deltaHtml = `${base.label} <b>↓ ${Math.abs(d).toFixed(1)}%</b>`;
    else deltaHtml = `${base.label}持平`;
  }

  const reg = m.byType.find(x => x.id === 'regular') || { fee: 0, count: 0 };
  const self = m.byType.find(x => x.id === 'self') || { fee: 0, count: 0 };
  const other = round2(m.total - reg.fee - self.fee);
  const otherCount = m.count - reg.count - self.count;

  // 下一节课
  const now = Date.now();
  const upcoming = state.lessons
    .filter(l => l.status !== 'canceled' && l.status !== 'leave')
    .map(l => ({ l, s: lessonStart(l) }))
    .filter(x => x.s.getTime() > now - 5 * 60000)
    .sort((a, b) => a.s - b.s)[0];

  let nextHtml = '';
  if (upcoming) {
    const l = upcoming.l;
    const typ = getType(l.typeId);
    const cost = calcLesson(l).subtotal;
    const diffMin = Math.round((upcoming.s.getTime() - now) / 60000);
    let countdown;
    if (diffMin <= 0) countdown = '<span>进行中</span>';
    else if (diffMin < 60) countdown = `<span>${diffMin}</span>分钟后`;
    else if (diffMin < 1440) countdown = `<span>${Math.floor(diffMin / 60)}</span>小时后`;
    else countdown = `<span>${Math.ceil(diffMin / 1440)}</span>天后`;

    nextHtml = `
      <div class="next-card" data-act="lesson-menu" data-id="${l.id}">
        <div class="accent" style="background:${typ.color}"></div>
        <div class="next-ring" style="background:${typ.color}18;color:${typ.color}">${countdown}</div>
        <div class="next-main">
          <div class="next-title">${esc(l.klass || '未命名')} · ${esc(typ.name)}</div>
          <div class="next-meta">
            <span>${WEEK_CN[parseYmd(l.date).getDay()]} ${periodTime(l.period).start}–${periodTime(l.period).end}</span>
            <span class="tag gray">${esc(periodTime(l.period).name)}</span>
            ${l.status === 'swapped' ? '<span class="tag amber">调课</span>' : ''}
          </div>
        </div>
        <div class="next-fee">
          <div class="v">${money(cost)}</div>
          <div class="k">预计课时费</div>
        </div>
      </div>`;
  }

  // 今日课程
  const hdToday = holidayOn(t);
  const hdTip = hdToday
    ? `<div class="hd-tip ${hdToday.kind === 'work' ? 'work' : ''}">
        <span class="hd-tip-t">${esc(holidayBanner(t))}</span>
        <button class="hd-tip-b" data-act="open-holidays">调整</button>
      </div>`
    : '';
  let todayHtml = '';
  if (!todayList.length) {
    todayHtml = `
      <div class="empty">
        ${ic('cal', 40)}
        <div class="t">${hdToday && hdToday.kind !== 'work' ? `${esc(hdToday.name)} · 今天不上课` : '今天没有课程安排'}</div>
        <div class="s">${hdToday && hdToday.kind !== 'work'
          ? (hdToday.half ? `上到 ${esc(hdToday.half)}，之后的课已跳过` : '好好休息，假期课程不会计入课时')
          : '可以导入课表，或手动添加一节课'}</div>
        <button class="btn outline sm mt16" data-act="open-import">${ic('upload', 15)} 导入课表</button>
      </div>`;
  } else {
    todayHtml = `<div class="timeline">${todayList.map((l, i) => {
      const typ = getType(l.typeId);
      const tm = periodTime(l.period);
      const cost = lessonTotal(l);
      const endD = lessonEnd(l);
      const endHM = `${pad2(endD.getHours())}:${pad2(endD.getMinutes())}`;
      const isPast = lessonEnd(l).getTime() < now;
      const canceled = l.status === 'canceled' || l.status === 'leave';
      return `
        <div class="tl-item">
          <div class="tl-time"><div class="s">${tm.start}</div><div class="e">${endHM}</div></div>
          <div class="tl-rail"><i style="background:${canceled ? '#C4CAD4' : typ.color};box-shadow:0 0 0 3px ${canceled ? '#F0F2F6' : typ.color + '22'}"></i>${i < todayList.length - 1 ? '<div class="bar"></div>' : ''}</div>
          <div class="tl-body">
            <div class="lesson ${l.typeId === 'self' ? 'self' : 'regular'} ${canceled ? 'canceled' : ''}" data-act="lesson-menu" data-id="${l.id}">
              <div class="l-main">
                <div class="l-title">${esc(l.klass || '未命名')}
                  <span class="tag" style="background:${typ.color}15;color:${typ.color}">${esc(typ.name)}</span>
                  ${l.extend ? `<span class="tag mint">+${l.extend}分</span>` : ''}
                  ${l.status === 'swapped' ? '<span class="tag amber">调课</span>' : ''}
                  ${l.status === 'leave' ? '<span class="tag rose">请假</span>' : ''}
                </div>
                <div class="l-meta">
                  <span>${esc(tm.name)}</span>
                  ${isPast ? '<span class="tag gray">已结束</span>' : ''}
                  ${l.note ? `<span>· ${esc(l.note)}</span>` : ''}
                </div>
              </div>
              <div class="l-fee">${canceled ? '—' : money(cost)}<small>${esc(typ.unit === 'hour' ? (l.dur || 45) + '分钟' : '1节')}${l.extend ? ` +${l.extend}分` : ''}</small></div>
            </div>
          </div>
        </div>`;
    }).join('')}</div>`;
  }

  // 本周迷你柱
  const ws = startOfWeek(new Date());
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const weekFees = weekDays.map(d => dayFee(ymd(d)));
  const maxW = Math.max(1, ...weekFees);
  const weekTotal = round2(weekFees.reduce((a, b) => a + b, 0));

  // 示例数据提示条
  const demoN = demoLessons().length;
  const presetTip = (state.meta.seeded && demoN) ? `
    <div class="preset-tip">
      <div class="pt-ic">${ic('spark', 16)}</div>
      <div class="pt-txt"><b>当前是示例课表</b><span>${demoN} 节演示课程，清空后即可录入自己的课</span></div>
      <button class="pt-btn" data-act="clear-schedule">清理</button>
    </div>` : '';

  // 有可用更新时挂一条提示，点开就是更新面板
  const updateTip = (UPD.kind && state.settings.updateSeen !== UPD.latest) ? `
    <div class="upd-tip" data-act="upd-open">
      <div class="ut-ic">${ic('download', 16)}</div>
      <div class="ut-txt">
        <b>${UPD.kind === 'web' ? '界面有更新' : `发现新版本 v${esc(UPD.latest)}`}</b>
        <span>${UPD.kind === 'web' ? '点这里更新，重启后生效' : '点这里下载安装'}</span>
      </div>
      <span class="ut-btn">查看</span>
    </div>` : '';

  $('#page-home').innerHTML = `
    <div class="hero">
      <div class="hero-top">
        <span>${monthLabel(ym)} · 本月课酬</span>
        <span class="pill">已上 ${m.doneCount} 节 / 共 ${m.count} 节</span>
      </div>
      <div class="hero-amount">
        <span class="cur">¥</span>
        <span class="val">${mSplit.int}</span>
        <span class="cents">.${mSplit.dec}</span>
      </div>
      <div class="hero-delta">${deltaHtml} · 当前方案：${schemeName(state.settings.scheme)}</div>
      <div class="hero-split">
        <div class="item">
          <div class="k"><i class="tick" style="background:#9DB0FF"></i>正课</div>
          <div class="v">¥${moneyPlain(reg.fee)}<small>${reg.count}节</small></div>
        </div>
        <div class="item">
          <div class="k"><i class="tick" style="background:#5CE1B4"></i>自习</div>
          <div class="v">¥${moneyPlain(self.fee)}<small>${self.count}节</small></div>
        </div>
        <div class="item">
          <div class="k"><i class="tick" style="background:rgba(255,255,255,.7)"></i>其他</div>
          <div class="v">¥${moneyPlain(other)}<small>${Math.max(0, otherCount)}节</small></div>
        </div>
      </div>
    </div>

    ${presetTip}
    ${updateTip}
    ${nextHtml}

    <div class="quick-grid">
      <button class="quick" data-act="open-import">
        <div class="qi" style="background:var(--brand-soft);color:var(--brand)">${ic('upload', 19)}</div>
        <div class="ql">导入课表</div>
      </button>
      <button class="quick" data-act="open-swap-picker">
        <div class="qi" style="background:var(--mint-soft);color:var(--mint)">${ic('swap', 19)}</div>
        <div class="ql">快捷调课</div>
      </button>
      <button class="quick" data-act="add-lesson">
        <div class="qi" style="background:var(--violet-soft);color:var(--violet)">${ic('plus', 19)}</div>
        <div class="ql">记一节</div>
      </button>
      <button class="quick" data-act="go-pay">
        <div class="qi" style="background:var(--amber-soft);color:#B26A00">${ic('chart', 19)}</div>
        <div class="ql">结算明细</div>
      </button>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="card-title"><span class="dot"></span>今日课程</div>
        <div class="card-more" data-act="go-schedule">全部 ${ic('right', 13)}</div>
      </div>
      ${hdTip}
      ${todayHtml}
    </div>

    <div class="card">
      <div class="card-head">
        <div class="card-title"><span class="dot" style="background:var(--mint)"></span>本周课酬</div>
        <div class="card-more">${money(weekTotal)}</div>
      </div>
      <div class="chart" style="height:96px">
        ${weekDays.map((d, i) => {
          const v = weekFees[i];
          const isToday = ymd(d) === t;
          const h = v > 0 ? Math.max(6, (v / maxW) * 62) : 3;
          return `<div class="col ${isToday ? 'cur' : ''}" style="gap:5px">
            <div class="bar-wrap"><div class="bar" style="height:${h}px;${isToday ? '' : 'background:linear-gradient(180deg,#C3CEFF,#8FA3F5)'}"></div></div>
            <div class="lbl">${WEEK_SHORT[d.getDay()]}</div>
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
function schemeName(s) {
  return { standard: '标准计费', tiered: '阶梯累进', overtime: '超课时上浮' }[s] || '标准计费';
}

/* ---------------- 课表页 ---------------- */
function renderSchedule() {
  const ws = startOfWeek(viewDate);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const selStr = ymd(viewDate);
  const tStr = todayYmd();

  const strip = days.map(d => {
    const ds = ymd(d);
    const ls = lessonsOfDay(ds).filter(l => l.status !== 'canceled' && l.status !== 'leave');
    const types = [...new Set(ls.map(l => getType(l.typeId).color))].slice(0, 3);
    return `<button class="day-chip ${ds === selStr ? 'active' : ''} ${ds === tStr ? 'today' : ''}" data-act="pick-day" data-date="${ds}">
      <span class="wd">${WEEK_SHORT[d.getDay()]}</span>
      <span class="dd">${d.getDate()}</span>
      <span class="dots">${types.map(c => `<i style="background:${c}"></i>`).join('')}</span>
    </button>`;
  }).join('');

  const wkNo = weekIndexOf(ymd(ws));
  const wkPar = weekParity(ymd(ws));

  const head = `
    <div class="weekstrip-wrap">
      <div class="weekstrip-head">
        <div class="ws-month">${ws.getMonth() + 1}月<b class="wk-badge ${wkPar}" data-act="open-term">${parityLabel(wkPar)} · 第${wkNo}周</b><span>本周 ${round2(days.reduce((s, d) => s + dayFee(ymd(d)), 0))} 元</span></div>
        <div class="ws-nav">
          <button data-act="week-prev">${ic('left', 16)}</button>
          <button data-act="week-today" style="width:auto;padding:0 9px;font-size:11.5px;font-weight:650">今</button>
          <button data-act="week-next">${ic('right', 16)}</button>
        </div>
      </div>
      <div class="weekstrip">${strip}</div>
    </div>
    <div class="hstack" style="margin-bottom:14px">
      <div class="segmented" style="flex:1;max-width:248px">
        <button class="${schedMode === 'day' ? 'on' : ''}" data-act="sched-mode" data-mode="day">日</button>
        <button class="${schedMode === 'week' ? 'on' : ''}" data-act="sched-mode" data-mode="week">周</button>
        <button class="${schedMode === 'master' ? 'on' : ''}" data-act="sched-mode" data-mode="master">总课表</button>
      </div>
      <div class="spacer"></div>
      <button class="btn ghost sm" data-act="open-import">${ic('upload', 14)} 导入</button>
    </div>`;

  const body = schedMode === 'day' ? dayView(selStr)
    : schedMode === 'week' ? weekView(ws)
    : masterView();

  $('#page-schedule').innerHTML = head + body;
}

function dayView(dateStr) {
  const list = lessonsOfDay(dateStr);
  const d = parseYmd(dateStr);
  const isToday = dateStr === todayYmd();
  const dPar = weekParity(dateStr);
  const dWk = weekIndexOf(dateStr);

  // 调休：说明今天的课去哪了 / 从哪来
  const adj = adjustOfWeek(weekStartOf(dateStr));
  let adjBanner = '';
  if (adj && adj.moves.length) {
    const firstP = periodTime(adj.moves[0].fromPeriod).name;
    if (adj.fromDate === dateStr) {
      adjBanner = `<div class="info-banner" style="margin-bottom:12px">${ic('swap', 16)}
        <div>本周调休：${esc(firstP)}起的 <b>${adj.moves.length}</b> 节课已调至 ${fmtMD(adj.toDate)} ${weekdayCN(adj.toDate)}</div></div>`;
    } else if (adj.toDate === dateStr) {
      adjBanner = `<div class="info-banner" style="margin-bottom:12px">${ic('swap', 16)}
        <div>今天有 <b>${adj.moves.length}</b> 节课由 ${fmtMD(adj.fromDate)} ${weekdayCN(adj.fromDate)} 调休补上</div></div>`;
    }
  }

  // 法定假日 / 补班
  const hd = holidayOn(dateStr);
  let hdBanner = '';
  if (hd) {
    const cls = hd.kind === 'work' ? 'mint' : (hd.half ? 'amber' : 'rose');
    const ico = hd.kind === 'work' ? 'swap' : (hd.half ? 'clock' : 'spark');
    hdBanner = `<div class="info-banner ${cls}" style="margin-bottom:12px">${ic(ico, 16)}
      <div>${esc(holidayBanner(dateStr))}${hd.custom ? ' <span class="tiny muted">（已自定义）</span>' : ''}</div></div>`;
  }

  if (!list.length) {
    // 本周不上：同星期几在邻近单/双周有课
    let off = null;
    state.lessons.forEach(l => {
      if (l.weekMode !== 'odd' && l.weekMode !== 'even') return;
      if (parseYmd(l.date).getDay() !== d.getDay()) return;
      const diff = Math.abs(daysBetween(dateStr, l.date));
      if (diff === 0 || diff % 7 !== 0 || diff > 28) return;
      if (l.weekMode === dPar) return;
      if (!off || diff < off.diff) off = { diff, mode: l.weekMode };
    });

    return `${adjBanner}${hdBanner}<div class="card">
      <div class="empty">
        ${ic('cal', 40)}
        <div class="t">${hd && hd.kind !== 'work' ? `${esc(hd.name)} · 今天不上课` : `${fmtMD(dateStr)} 没有课程`}</div>
        <div class="s">${hd && hd.kind !== 'work'
          ? (hd.half ? `上到 ${esc(hd.half)}，之后的课已跳过` : '法定假日，排课时可自动跳过')
          : (off
            ? `本周是${parityLabel(dPar)}，${parityLabel(off.mode)}的课不在本周`
            : '点击右上角导入课表，或手动添加')}</div>
        <div class="hstack" style="justify-content:center;margin-top:16px">
          <button class="btn outline sm" data-act="add-lesson" data-date="${dateStr}">${ic('plus', 14)} 添加课程</button>
        </div>
      </div>
    </div>`;
  }

  const total = dayFee(dateStr);
  const cnt = dayCount(dateStr);

  return `
    ${adjBanner}${hdBanner}
    <div class="card" style="padding:14px 16px">
      <div class="hstack">
        <div style="flex:1">
          <div style="font-size:15px;font-weight:750">${fmtMD(dateStr)} <span class="muted tiny" style="font-weight:500">${weekdayCN(dateStr)} · 第${dWk}周 · ${parityLabel(dPar)}</span></div>
          <div class="tiny muted" style="margin-top:2px">${cnt} 节课 · 合计 <b style="color:var(--brand)">${money(total)}</b></div>
        </div>
        ${isToday ? '<span class="tag brand">今天</span>' : ''}
      </div>
    </div>
    <div class="timeline">
      ${list.map((l, i) => {
        const typ = getType(l.typeId);
        const tm = periodTime(l.period);
        const cost = lessonTotal(l);
        const endD = lessonEnd(l);
        const endHM = `${pad2(endD.getHours())}:${pad2(endD.getMinutes())}`;
        const canceled = l.status === 'canceled' || l.status === 'leave';
        const wkTag = (l.weekMode === 'odd' || l.weekMode === 'even')
          ? `<span class="tag wk ${l.weekMode}">${parityLabel(l.weekMode)}</span>` : '';
        return `<div class="tl-item">
          <div class="tl-time"><div class="s">${tm.start}</div><div class="e">${endHM}</div></div>
          <div class="tl-rail"><i style="background:${canceled ? '#C4CAD4' : typ.color};box-shadow:0 0 0 3px ${canceled ? '#F0F2F6' : typ.color + '22'}"></i>${i < list.length - 1 ? '<div class="bar"></div>' : ''}</div>
          <div class="tl-body">
            <div class="lesson ${canceled ? 'canceled' : ''}" data-act="lesson-menu" data-id="${l.id}">
              <div class="l-main">
                <div class="l-title">${esc(l.klass || '未命名')}
                  <span class="tag" style="background:${typ.color}15;color:${typ.color}">${esc(typ.name)}</span>
                  ${wkTag}
                  ${l.extend ? `<span class="tag mint">+${l.extend}分</span>` : ''}
                  ${l.status === 'swapped' ? '<span class="tag amber">调课</span>' : ''}
                </div>
                <div class="l-meta">
                  <span>${esc(tm.name)}</span>
                  ${l.note ? `<span>· ${esc(l.note)}</span>` : ''}
                  ${l.status === 'leave' ? '<span class="tag rose">请假</span>' : ''}
                </div>
              </div>
              <div class="l-fee">${canceled ? '—' : money(cost)}<small>${esc(typ.unit === 'hour' ? (l.dur || 45) + '分钟' : typ.unit === 'student' ? (l.students || 1) + '人' : '1节')}${l.extend ? ` +${l.extend}分` : ''}</small></div>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

function weekView(ws) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const tStr = todayYmd();
  const periods = state.periods;
  const wkNo = weekIndexOf(ymd(ws));
  const wkPar = weekParity(ymd(ws));

  // 单双周课程占用的「星期几#节次」槽位，用来在空档提示本周不上
  const ghost = {};
  state.lessons.forEach(l => {
    if (l.weekMode !== 'odd' && l.weekMode !== 'even') return;
    ghost[`${parseYmd(l.date).getDay()}#${l.period}`] = l.weekMode;
  });

  // 本周是否已调休：把提前放学那天的空档标出来，避免误以为漏排
  const adj = adjustOfWeek(ymd(ws));
  const adjDow = adj ? parseYmd(adj.fromDate).getDay() : -1;
  const adjToShort = adj ? WEEK_SHORT[parseYmd(adj.toDate).getDay()] : '';
  const adjPeriods = adj
    ? new Set(adj.moves.filter(m => m.fromDate === adj.fromDate).map(m => m.fromPeriod))
    : new Set();

  let html = `<div class="tiny muted" style="margin:0 2px 8px;display:flex;align-items:center;gap:5px">
    ${ic('swap', 12)} 第${wkNo}周 · ${parityLabel(wkPar)}${adj ? ` · <b style="color:var(--violet)">已调休</b>` : ''} · 左右滑动看完整一周
  </div>
  <div class="weekgrid-wrap"><div class="weekgrid-scroll"><div class="weekgrid">
    <div class="wg-head"></div>
    ${days.map(d => {
      const ds = ymd(d);
      const hd = holidayOn(ds);
      const cls = hd ? (hd.kind === 'work' ? 'wg-work' : 'wg-off') : '';
      const mark = hd ? `<em class="wg-hd">${hd.kind === 'work' ? '补' : (hd.half ? '半' : '假')}</em>` : '';
      return `<div class="wg-head ${ds === tStr ? 'today' : ''} ${cls}"><span style="font-size:10px">${WEEK_SHORT[d.getDay()]}</span><b>${d.getDate()}</b>${mark}</div>`;
    }).join('')}`;

  periods.forEach(p => {
    html += `<div class="wg-time"><b>${p.short}</b><span>${p.start}</span></div>`;
    days.forEach(d => {
      const ds = ymd(d);
      const l = state.lessons.find(x => x.date === ds && x.period === p.no);
      if (!l) {
        if (holidayBlocks(ds, p.no)) {
          html += `<div class="wg-cell wg-free wg-off" data-act="add-lesson" data-date="${ds}" data-period="${p.no}"><span>假</span></div>`;
        } else if (adj && d.getDay() === adjDow && adjPeriods.has(p.no)) {
          html += `<div class="wg-cell wg-free wg-adj" data-act="add-lesson" data-date="${ds}" data-period="${p.no}"><span>调${adjToShort}</span></div>`;
        } else {
          const g = ghost[`${d.getDay()}#${p.no}`];
          html += g
            ? `<div class="wg-cell wg-free wg-ghost" data-act="add-lesson" data-date="${ds}" data-period="${p.no}"><span>${parityLabel(g)}课</span></div>`
            : `<div class="wg-cell wg-free" data-act="add-lesson" data-date="${ds}" data-period="${p.no}"></div>`;
        }
      } else {
        const typ = getType(l.typeId);
        const canceled = l.status === 'canceled' || l.status === 'leave';
        html += `<div class="wg-cell wg-lesson ${l.status === 'swapped' ? 'swapped' : ''} ${canceled ? 'canceled' : ''}"
          data-act="lesson-menu" data-id="${l.id}"
          style="background:${canceled ? '#DDE1E9' : typ.color}">
          <div class="nm">${esc(l.klass || typ.name)}</div>
          <div class="cl">${esc(typ.name)}</div>
        </div>`;
      }
    });
  });

  html += `</div></div></div>`;
  return html;
}

/* ---------------- 总课表视图 ---------------- */
/** 单双周标记：单/双/每 */
const parityShort = wm => (wm === 'odd' ? '单' : wm === 'even' ? '双' : '每');

/** 总课表一个格子：单双周各上一节课时上下两行分开显示，各用自己的课程颜色 */
function masterCellHtml(dow, p) {
  const attr = `data-act="master-cell" data-dow="${dow}" data-period="${p.no}"`;
  const slots = masterSlots(dow, p.no);

  if (!slots.length) {
    return `<div class="wg-cell wg-free" ${attr}><span class="plus-ghost">+</span></div>`;
  }

  // 只有一节课
  if (slots.length === 1) {
    const s = slots[0];
    const typ = getType(s.typeId);
    const ext = Number(s.extend) || 0;
    if (s.weekMode === 'all') {
      return `<div class="wg-cell wg-lesson" ${attr} style="background:${typ.color}">
        <div class="nm">${esc(s.klass || typ.name)}</div>
        <div class="cl">${esc(typ.name)}${ext ? `<i class="wg-ext">+${ext}分</i>` : ''}</div>
      </div>`;
    }
    // 整格都是单周 / 双周课：同样带周次标签，一眼看出不是每周都有
    return `<div class="wg-cell wg-lesson wg-stack one${ext ? ' wg-hasext' : ''}" ${attr}>
      <div class="wg-slot" style="background:${typ.color}">
        <div class="wg-row">
          <i class="wg-tag ${s.weekMode}">${parityLabel(s.weekMode)}</i>
          <span class="nm">${esc(s.klass || typ.name)}</span>
        </div>
        ${ext ? `<div class="wg-sub">+${ext} 分</div>` : ''}
      </div>
    </div>`;
  }

  // 两节及以上：单双周分别一行
  const rows = slots.map(s => {
    const typ = getType(s.typeId);
    const ext = Number(s.extend) || 0;
    return `<div class="wg-slot" style="background:${typ.color}">
      <div class="wg-row">
        <i class="wg-tag ${s.weekMode}">${parityShort(s.weekMode)}</i>
        <span class="nm">${esc(s.klass || typ.name)}</span>
      </div>
      ${ext ? `<div class="wg-sub">+${ext} 分</div>` : ''}
    </div>`;
  }).join('');

  return `<div class="wg-cell wg-lesson wg-stack${slots.some(x => Number(x.extend) > 0) ? ' wg-hasext' : ''}" ${attr}>${rows}</div>`;
}

function masterView() {
  const periods = state.periods;
  const rule = makeupRule();

  let allN = 0, oddN = 0, evenN = 0, extN = 0;
  Object.keys(state.master).forEach(k => {
    const c = state.master[k];
    if (!c || !c.typeId) return;
    if (Number(c.extend) > 0) extN++;
    const wm = k.split('#')[2];
    if (wm === 'odd') oddN++;
    else if (wm === 'even') evenN++;
    else allN++;
  });
  const weeks = makeupWeeks();
  const doneN = weeks.filter(w => w.done).length;
  const pendingWeeks = weeks.filter(w => !w.done && w.plan.moves.length > 0).length;

  let grid = `<div class="weekgrid-wrap"><div class="weekgrid-scroll"><div class="weekgrid">
    <div class="wg-head"></div>
    ${DOW_ORDER.map(d => `<div class="wg-head"><span style="font-size:10px">${WEEK_SHORT[d]}</span></div>`).join('')}`;

  periods.forEach(p => {
    grid += `<div class="wg-time"><b>${p.short}</b><span>${p.start}</span></div>`;
    DOW_ORDER.forEach(dow => { grid += masterCellHtml(dow, p); });
  });
  grid += `</div></div></div>`;

  return `
    <div class="card" style="padding:14px 16px;margin-bottom:14px">
      <div class="hstack">
        <div style="flex:1;min-width:0">
          <div style="font-size:14.5px;font-weight:750">标准周总课表</div>
          <div class="tiny muted" style="margin-top:3px">每周 ${allN} 节 · 单周 ${oddN} 节 · 双周 ${evenN} 节${extN ? ` · 延长 ${extN} 节` : ''}</div>
        </div>
        <button class="btn sm" data-act="master-sync">铺到本学期</button>
      </div>
    </div>

    ${allN + oddN + evenN === 0 ? `<div class="info-banner" style="margin-bottom:12px">${ic('info', 16)}
      <div>总课表还是空的。点下面的格子把每周固定的课录进来，之后就能一键铺满整个学期。</div></div>` : ''}

    <div class="wg-tools">
      ${ic('grid', 12)}<span>按总课表自动对应 · 点格子可改 · 左右滑动</span>
      <button class="wg-io" data-act="open-schedule-io" data-ie="export">导入导出${ic('right', 11)}</button>
    </div>
    ${oddN + evenN > 0 ? `<div class="wg-legend">
      <span><i class="lg lg-all"></i>每周</span>
      <span><i class="lg lg-odd"></i>单周</span>
      <span><i class="lg lg-even"></i>双周</span>
      <em>单双周不同课分两行显示</em>
    </div>` : ''}
    ${extN ? `<div class="tiny muted" style="margin:2px 2px 10px;display:flex;align-items:center;gap:5px">
      ${ic('clock', 12)} 格子里的「+20」表示拖堂 20 分钟，按延长单价另算
    </div>` : ''}
    <div class="makeup-strip" data-act="open-makeup">
      <div class="ms-ic">${ic('swap', 15)}</div>
      <div class="ms-tx">
        <b>${rule.enabled ? esc(makeupSummary()) : '调休规则已关闭'}</b>
        <span>${weeks.length} 个${parityLabel(rule.parity)} · ${doneN} 个已调休${pendingWeeks ? ` · ${pendingWeeks} 个待处理` : ''}</span>
      </div>
      ${weeks.length ? `<span class="ms-go">快捷调休${ic('right', 13)}</span>` : ''}
    </div>
    ${grid}

    <div class="info-banner" style="margin-top:14px">
      ${ic('info', 16)}
      <div>总课表是<b>母版</b>：改动后点「铺到本学期」就会同步到每个周次。已调休的周会被跳过，不会覆盖你调整过的安排。</div>
    </div>
  `;
}

/* ---------------- 总课表格子编辑 ---------------- */
let draftMaster = null;
let draftMakeup = null;

function openMasterCell(dow, period) {
  const slots = masterSlots(dow, period);
  if (slots.length === 0) { openMasterEditor(dow, period, 'all'); return; }
  // 只有一节「每周」课，直接进编辑
  if (slots.length === 1 && slots[0].weekMode === 'all') { openMasterEditor(dow, period, 'all'); return; }

  const rowOf = s => {
    const typ = getType(s.typeId);
    const ext = Number(s.extend) || 0;
    return `<div class="row" data-act="master-pick" data-dow="${dow}" data-period="${period}" data-w="${s.weekMode}">
      <div class="ri" style="background:${typ.color}18;color:${typ.color}">${ic('book', 17)}</div>
      <div class="rc"><div class="t">${esc(s.klass || '未命名')}</div><div class="s">${esc(typ.name)} · ${parityLabel(s.weekMode)}${ext ? ` · 延长 ${ext} 分` : ''}</div></div>
      ${ic('right', 15)}
    </div>`;
  };

  // 只有一节单/双周课 → 可补另一周
  const otherWm = slots.length === 1 ? (slots[0].weekMode === 'odd' ? 'even' : 'odd') : '';

  openSheet({
    title: `${WEEK_CN[dow]} · ${periodTime(period).name}`,
    body: `
      <div class="tiny muted" style="margin-bottom:10px">这个时段安排了 ${slots.length} 节课，选择要修改的</div>
      <div class="rows">
        ${slots.map(rowOf).join('')}
        ${otherWm ? `<div class="row" data-act="master-pick" data-dow="${dow}" data-period="${period}" data-w="${otherWm}">
          <div class="ri" style="background:var(--brand-soft);color:#2C43B8">${ic('plus', 17)}</div>
          <div class="rc"><div class="t">添加${parityLabel(otherWm)}课</div><div class="s">这个时段的${parityLabel(otherWm)}还空着</div></div>
          ${ic('right', 15)}
        </div>` : ''}
      </div>
      <div class="tiny muted" style="margin-top:14px;line-height:1.7">同一时段若要单双周上不同的课，可分别设置；同一时段最多两节。</div>
    `,
    footer: `<button class="btn ghost" data-close>关闭</button>`,
  });
}

function openMasterEditor(dow, period, wm) {
  const cur = state.master[masterKey(dow, period, wm)];
  draftMaster = cur
    ? { dow, period, weekMode: wm, typeId: cur.typeId, klass: cur.klass || '', subject: cur.subject || '', extend: Number(cur.extend) || 0 }
    : { dow, period, weekMode: wm, typeId: (state.types[0] && state.types[0].id), klass: '', subject: state.teacher.subject || '', extend: 0 };
  renderMasterEditor();
}

function renderMasterEditor() {
  const d = draftMaster;
  const editing = !!state.master[masterKey(d.dow, d.period, d.weekMode)];
  const typ = getType(d.typeId);
  const factor = Number(typ.factor) || 1;

  // 延长课：按「延长类型」（默认自习）单价折算，存到母版后随铺课一起下发
  const et = extendType();
  const extVal = Number(d.extend) || 0;
  const extUnit = et.unit === 'hour' ? '小时' : et.unit === 'student' ? '人·节' : '节';
  const pMin = periodMinutes(d.period);
  const extCalc = extVal > 0
    ? calcExtend({ extend: extVal, dur: pMin, students: 1, klass: d.klass || '' })
    : null;
  // 按时长计价的课按本节实际分钟折算，避免把「¥120/时」当成「¥120/节」
  const baseFee = round2(Number(typ.price) * factor * (typ.unit === 'hour' ? pMin / 60 : 1));

  const typeChips = state.types.filter(t => t.enabled !== false).map(t => {
    const on = t.id === d.typeId;
    return `<button class="period-cell ${on ? 'on' : ''}" data-act="master-pick-type" data-type="${t.id}"
      style="${on ? `background:${t.color};border-color:${t.color}` : ''}">
      ${esc(t.name)}<small>${money(t.price)}/${t.unit === 'hour' ? '时' : t.unit === 'student' ? '人' : '节'}</small>
    </button>`;
  }).join('');

  openSheet({
    title: `${WEEK_CN[d.dow]} ${periodTime(d.period).name}`,
    body: `
      <div class="field">
        <div class="field-label">班级 <span class="hint">这个时段固定上的班</span></div>
        <input class="input" id="m-klass" placeholder="如 高一(3)班" value="${esc(d.klass)}">
      </div>
      <div class="field">
        <div class="field-label">课程类型 <span class="hint">决定单价</span></div>
        <div class="period-grid">${typeChips}</div>
      </div>
      <div class="field">
        <div class="field-label">上课周次</div>
        <div class="segmented">
          ${[['all', '每周'], ['odd', '单周'], ['even', '双周']].map(([v, l]) =>
            `<button class="${d.weekMode === v ? 'on' : ''}" data-act="master-pick-week" data-w="${v}">${l}</button>`
          ).join('')}
        </div>
        <div class="tiny muted" style="margin-top:8px;line-height:1.6">选「每周」会覆盖该时段的单/双周设置。</div>
      </div>
      <div class="field">
        <div class="field-label">延长课时 <span class="hint">拖堂部分按「${esc(et.name)}」${money(et.price)}/${extUnit} 计</span></div>
        <div class="segmented">
          ${[0, 10, 15, 20, 30].map(n =>
            `<button class="${extVal === n ? 'on' : ''}" data-act="master-pick-extend" data-n="${n}">${n ? n + ' 分' : '不延长'}</button>`
          ).join('')}
        </div>
        <div class="input-suffix" style="margin-top:9px">
          <input class="input num" id="m-extend" type="number" inputmode="numeric" min="0" max="300" step="5" value="${extVal}">
          <span class="sfx">分钟</span>
        </div>
        <div class="tiny muted" style="margin-top:8px;line-height:1.6">${esc(periodTime(d.period).name)} ${periodTime(d.period).start}–${periodTime(d.period).end} 共 ${pMin} 分钟${extVal > 0 ? '，延长后下课顺延' : ''}。铺到本学期时一并生效。</div>
      </div>
      <div class="breakdown" style="margin-bottom:4px">
        <div class="bd-line"><span class="k">单节课时费</span><span class="v">${money(round2(baseFee + (extCalc ? extCalc.subtotal : 0)))}</span></div>
        <div class="bd-line"><span class="k sub">${esc(typ.name)} · ${money(typ.price)}/${typ.unit === 'hour' ? '小时' : typ.unit === 'student' ? '人' : '节'}${typ.unit === 'hour' ? ` × ${pMin}/60` : ''}${factor !== 1 ? ` · 系数 ${factor}` : ''}</span><span class="v sub"></span></div>
        ${extCalc ? `<div class="bd-line"><span class="k sub">含延长 ${extVal} 分 · 延长费 ${money(extCalc.subtotal)}${extCalc.classFactor !== 1 ? `（${esc(extCalc.type.name)} ×${extCalc.classFactor}）` : ''}</span><span class="v sub"></span></div>` : ''}
      </div>
    `,
    footer: `${editing ? `<button class="btn outline" style="color:var(--rose);border-color:#FBD5DD" data-act="master-del">删除</button>` : ''}
      <button class="btn ghost" data-close>取消</button>
      <button class="btn" data-act="master-save">保存</button>`,
  });
}

function captureMasterForm() {
  if (!draftMaster) return;
  const k = $('#m-klass');
  if (k) draftMaster.klass = k.value;
  const ex = $('#m-extend');
  if (ex) draftMaster.extend = clamp(Number(ex.value) || 0, 0, 300);
}

function saveMasterCell() {
  const d = draftMaster;
  if (!d) return;
  const k = $('#m-klass');
  if (k) d.klass = k.value;
  const exInp = $('#m-extend');
  if (exInp) d.extend = clamp(Number(exInp.value) || 0, 0, 300);
  const klass = (d.klass || '').trim();
  if (!klass) { toast('请填写班级名称'); return; }
  if (d.weekMode === 'all') {
    delete state.master[masterKey(d.dow, d.period, 'odd')];
    delete state.master[masterKey(d.dow, d.period, 'even')];
  } else {
    delete state.master[masterKey(d.dow, d.period, 'all')];
    // 同一时段最多两节（单周 + 双周）
    const other = d.weekMode === 'odd' ? 'even' : 'odd';
    if (!state.master[masterKey(d.dow, d.period, other)] && masterSlots(d.dow, d.period).length >= 1) {
      // 已有另一节，允许并存
    }
  }
  const ext = clamp(Number(d.extend) || 0, 0, 300);
  masterPut(d.dow, d.period, d.weekMode, { typeId: d.typeId, klass, subject: d.subject, extend: ext });
  save();
  closeSheet();
  renderSchedule();
  toast(ext > 0 ? `总课表已更新 · 延长 ${ext} 分` : '总课表已更新', 'check');
}

function deleteMasterCell() {
  const d = draftMaster;
  if (!d) return;
  delete state.master[masterKey(d.dow, d.period, d.weekMode)];
  save();
  closeSheet();
  renderSchedule();
  toast('已从总课表移除', 'trash');
}

/* ---------------- 调休 ---------------- */
function openMakeupSheet() {
  const weeks = makeupWeeks();
  const pending = weeks.filter(w => !w.done && w.plan.moves.length > 0);

  const rows = weeks.map(w => {
    const mv = w.plan.moves.length;
    const cf = w.plan.conflicts.length;
    const fromP = periodTime(w.plan.cut);
    const crossMonth = w.plan.fromDate.slice(0, 7) !== w.plan.toDate.slice(0, 7);
    return `<div class="mk-row ${w.done ? 'done' : ''}">
      <div class="mk-wk"><b>第${w.weekNo}周</b><span>${parityLabel(w.plan.parity)}</span></div>
      <div class="mk-line">
        <div class="mk-flow">${fmtMD(w.plan.fromDate)} ${weekdayCN(w.plan.fromDate)} <i>${esc(fromP.name)}后</i></div>
        <div class="mk-flow to">${ic('right', 11)} ${fmtMD(w.plan.toDate)} ${weekdayCN(w.plan.toDate)} 同节次${crossMonth ? `<em class="mk-cross">跨月 · 计入${Number(w.plan.toDate.slice(5, 7))}月</em>` : ''}</div>
      </div>
      <div class="mk-act">
        ${w.done
          ? `<span class="tag mint">已调休</span><button class="btn ghost sm" data-act="makeup-undo" data-ws="${w.weekStart}">撤销</button>`
          : `<span class="tag ${mv ? 'brand' : 'gray'}">${mv} 节${cf ? ` · ${cf} 冲突` : ''}</span>
             <button class="btn sm" data-act="makeup-one" data-ws="${w.weekStart}" ${mv ? '' : 'disabled'}>调休</button>`}
      </div>
    </div>`;
  }).join('');

  openSheet({
    title: '快捷调休',
    body: `
      <div class="info-banner" style="margin-bottom:14px">${ic('swap', 16)}
        <div>把 <b>${esc(makeupSummary())}</b> 的课整体平移，节次不变，课时费照算。</div>
      </div>
      ${weeks.length ? `<div class="mk-list">${rows}</div>` : `<div class="empty" style="padding:30px 0">
        <div class="t">本学期没有${parityLabel(makeupRule().parity)}</div>
        <div class="s">请检查学期首周与总周数设置</div>
      </div>`}
      <div class="tiny muted" style="margin-top:12px;line-height:1.7">「冲突」表示目标时段已有其他课，这些课会被跳过，需要手动在课表里调整。</div>
    `,
    footer: `<button class="btn ghost" data-close>关闭</button>
      <button class="btn" data-act="makeup-all" ${pending.length ? '' : 'disabled'}>全部调休（${pending.length} 周）</button>`,
  });
}

/** 调课与调休共用一张面板，顶部两个标签切换。 */
let swapTab = 'rule';     // rule | log

function openSwapCenter(tab) {
  swapTab = tab === 'log' ? 'log' : 'rule';
  if (swapTab === 'rule') draftMakeup = { ...makeupRule() };
  renderSwapCenter();
}

function renderSwapCenter() {
  const isRule = swapTab === 'rule';
  openSheet({
    title: '调课与调休',
    body: `
      <div class="segmented" style="margin-bottom:16px">
        <button class="${isRule ? 'on' : ''}" data-act="swap-tab" data-t="rule">调休规则</button>
        <button class="${isRule ? '' : 'on'}" data-act="swap-tab" data-t="log">调课记录</button>
      </div>
      ${isRule ? makeupRuleHtml() : swapLogHtml()}`,
    footer: isRule
      ? `<button class="btn ghost" data-close>取消</button><button class="btn" data-act="makeup-save-rule">保存</button>`
      : `<button class="btn ghost" data-close>关闭</button>`,
  });
}

function openMakeupRuleSheet() { openSwapCenter('rule'); }
function renderMakeupRule() { renderSwapCenter(); }

function makeupRuleHtml() {
  const r = draftMakeup;
  const periods = state.periods;
  return `
      <div class="info-banner" style="margin-bottom:14px">${ic('info', 16)}
        <div>把某天放学前后的课挪到<b>同一周</b>的另一天，节次不变，照常计价。</div></div>
      <div class="field">
        <div class="row" style="background:#F7F9FC;border-radius:14px;padding:13px">
          <div class="rc"><div class="t" style="font-size:13.5px">启用调休规则</div><div class="s">关闭后总课表不显示快捷调休</div></div>
          <div class="switch ${r.enabled ? 'on' : ''}" data-act="makeup-toggle"></div>
        </div>
      </div>
      <div class="field">
        <div class="field-label">哪一周提前放学</div>
        <div class="segmented">
          ${[['odd', '单周'], ['even', '双周']].map(([v, l]) =>
            `<button class="${r.parity === v ? 'on' : ''}" data-act="makeup-parity" data-v="${v}">${l}</button>`
          ).join('')}
        </div>
      </div>
      <div class="field">
        <div class="field-label">哪天提前放学</div>
        <div class="period-grid">
          ${[1, 2, 3, 4, 5, 6, 0].map(d =>
            `<button class="period-cell ${Number(r.fromDow) === d ? 'on' : ''}" data-act="makeup-from" data-d="${d}">${WEEK_SHORT[d]}</button>`
          ).join('')}
        </div>
      </div>
      <div class="field">
        <div class="field-label">补到哪一天 <span class="hint">须在同一周</span></div>
        <div class="period-grid">
          ${[1, 2, 3, 4, 5, 6, 0].map(d =>
            `<button class="period-cell ${Number(r.toDow) === d ? 'on' : ''}" data-act="makeup-to" data-d="${d}">${WEEK_SHORT[d]}</button>`
          ).join('')}
        </div>
      </div>
      <div class="field">
        <div class="field-label">上到第几节 <span class="hint">之后的课全部平移</span></div>
        <div class="period-grid">
          ${periods.map(p =>
            `<button class="period-cell ${Number(r.cutAfter) === p.no ? 'on' : ''}" data-act="makeup-cut" data-p="${p.no}">${esc(p.short)}<small>${p.start}</small></button>`
          ).join('')}
        </div>
      </div>
      <div class="field">
        <div class="row" style="background:#F7F9FC;border-radius:14px;padding:13px">
          <div class="rc"><div class="t" style="font-size:13.5px">晚自习一起平移</div><div class="s">关闭则晚自习留在当天</div></div>
          <div class="switch ${r.includeNight ? 'on' : ''}" data-act="makeup-night"></div>
        </div>
      </div>
      <div style="height:6px"></div>`;
}

/* ---------------- 法定节假日页 ---------------- */
let hdDraft = null;        // 正在编辑的一条
let hdIsNew = false;
let hdSyncing = false;

function openHolidaysSheet() {
  hdDraft = null;
  renderHolidays();
}

function holidayRowHtml(h) {
  const d = parseYmd(h.date);
  const sub = h.kind === 'work'
    ? `补班上课${h.asDow !== null && h.asDow !== undefined ? ` · 按${WEEK_CN[Number(h.asDow)]}课表` : ''}`
    : (h.half ? `放半天 · ${h.half} 放学` : '放假 · 全天');
  return `<div class="hd-row" data-act="hd-edit" data-date="${h.date}">
    <div class="hd-d"><b>${h.date.slice(5)}</b><span>周${WEEK_SHORT[d.getDay()]}</span></div>
    <div class="hd-c">
      <div class="t">${esc(h.name)}${h.custom ? '<span class="tag gray">自定义</span>' : ''}</div>
      <div class="s">${sub}</div>
    </div>
    ${holidayTag(h.date)}
    ${ic('right', 14)}
  </div>`;
}

function renderHolidays() {
  const list = state.holidays || [];
  const ys = [...new Set(list.map(h => String(h.date).slice(0, 4)))].sort();
  const offN = list.filter(h => h.kind !== 'work').length;
  const workN = list.length - offN;
  const syncAt = Number(state.meta.holidaySyncAt) || 0;
  const thisYear = String(new Date().getFullYear());

  const groups = ys.map(y => {
    const items = list.filter(h => String(h.date).slice(0, 4) === y);
    return `<div class="hd-year">${y} 年${y === thisYear ? '<em>今年</em>' : ''}<span>${items.filter(h => h.kind !== 'work').length} 天假 · ${items.filter(h => h.kind === 'work').length} 天补班</span></div>
      <div class="hd-list">${items.map(holidayRowHtml).join('')}</div>`;
  }).join('');

  openSheet({
    title: '法定节假日',
    body: `
      <div class="hd-hero">
        <div class="hd-hero-top">
          <div>
            <div class="hd-hero-n">${offN}<span>天放假</span></div>
            <div class="hd-sub">${ys.length ? ys.join(' / ') + ' 年' : '暂无数据'}${workN ? ` · 另有 ${workN} 天补班` : ''}</div>
          </div>
          <span class="tag ${syncAt ? 'mint' : 'gray'}">${syncAt ? '已同步' : '内置数据'}</span>
        </div>
        <div class="hd-acts">
          <button class="btn sm" data-act="hd-sync" ${hdSyncing ? 'disabled' : ''}>${ic('download', 14)} ${hdSyncing ? '同步中…' : '同步最新'}</button>
          <button class="btn ghost sm" data-act="hd-reset">恢复内置</button>
          <button class="btn ghost sm" data-act="hd-add">${ic('plus', 14)} 添加</button>
        </div>
        <div class="tiny muted" style="margin-top:9px;line-height:1.6">
          点任意一天可以改名称、设半天放假
        </div>
      </div>

      <div class="rows" style="margin-bottom:16px">
        <div class="row">
          <div class="ri" style="background:var(--brand-soft);color:var(--brand)">${ic('cal', 17)}</div>
          <div class="rc"><div class="t">排课时跳过假期</div><div class="s">半天只排到放学，补班日按指定星期上课</div></div>
          <div class="switch ${state.settings.holidaySkip !== false ? 'on' : ''}" data-act="hd-toggle-skip"></div>
        </div>
      </div>

      ${groups || `<div class="empty" style="padding:26px 0">
        <div class="t">还没有任何节假日</div>
        <div class="s">点「同步最新」或「添加」手动录入</div>
      </div>`}
      <div class="tiny muted" style="margin-top:14px;line-height:1.7">
        依据国务院放假通知整理；你手动改过的那几天，同步时不会被覆盖。
      </div>
    `,
    footer: `<button class="btn ghost" data-close>关闭</button>`,
  });
}

function renderHolidayEditor() {
  const d = hdDraft;
  openSheet({
    title: hdIsNew ? '添加假日' : `编辑假日 · ${fmtMD(d.date)}`,
    body: `
      <div class="field">
        <div class="field-label">日期</div>
        <input class="input" type="date" id="hdDate" value="${d.date}">
      </div>
      <div class="field">
        <div class="field-label">名称 <span class="hint">元旦、校运会、家长会…</span></div>
        <input class="input" id="hdName" value="${esc(d.name)}" placeholder="假日名称" maxlength="14" autocomplete="off">
      </div>
      <div class="field">
        <div class="field-label">类型</div>
        <div class="segmented">
          <button class="${d.kind !== 'work' ? 'on' : ''}" data-act="hd-kind" data-v="off">放假</button>
          <button class="${d.kind === 'work' ? 'on' : ''}" data-act="hd-kind" data-v="work">补班上课</button>
        </div>
      </div>
      ${d.kind === 'work' ? `
        <div class="field">
          <div class="field-label">按哪天的课表 <span class="hint">不选就按当天星期</span></div>
          <div class="period-grid">
            ${[1, 2, 3, 4, 5, 6, 0].map(x =>
              `<button class="period-cell ${d.asDow !== null && Number(d.asDow) === x ? 'on' : ''}" data-act="hd-dow" data-d="${x}">${WEEK_SHORT[x]}</button>`
            ).join('')}
          </div>
        </div>` : `
        <div class="field">
          <div class="field-label">上到几点 <span class="hint">留空 = 整天放假</span></div>
          <input class="input" type="time" id="hdHalf" value="${d.half || ''}">
        </div>`}
      <div class="tiny muted" style="line-height:1.7">
        改完回到课表页点「铺到本学期」，今天及以后的假期课程会自动跳过；已经过去的日期不会改动。
      </div>
    `,
    footer: hdIsNew
      ? `<button class="btn ghost" data-close>取消</button><button class="btn" data-act="hd-save">添加</button>`
      : `<button class="btn ghost" data-act="hd-del">删除</button><button class="btn" data-act="hd-save">保存</button>`,
  });
}

/* ---------------- 节假日的增删改与同步 ---------------- */
function openHolidayEditor(dateStr) {
  const h = dateStr ? holidayOn(dateStr) : null;
  hdIsNew = !h;
  hdDraft = h
    ? { ...h, _orig: h.date }
    : { date: dateStr || todayYmd(), name: '', kind: 'off', half: '', asDow: null, custom: true, _orig: '' };
  renderHolidayEditor();
}

function captureHolidayForm() {
  if (!hdDraft) return;
  const de = $('#hdDate');
  if (de && YMD_RE.test(de.value)) hdDraft.date = de.value;
  const ne = $('#hdName');
  if (ne) hdDraft.name = ne.value.trim();
  const he = $('#hdHalf');
  if (he) hdDraft.half = he.value || '';
}

function saveHolidayDraft() {
  captureHolidayForm();
  const d = hdDraft;
  if (!d) return;
  if (!YMD_RE.test(d.date)) return toast('请选择日期', 'alert');
  const item = normalizeHoliday({ ...d, name: d.name || '假日', custom: true });
  const others = (state.holidays || []).filter(h => h.date !== d._orig);
  if (others.some(h => h.date === item.date)) return toast(`${fmtMD(item.date)} 已经有一条记录`, 'alert');
  const idx = (state.holidays || []).findIndex(h => h.date === d._orig);
  if (idx >= 0) state.holidays[idx] = item;
  else state.holidays.push(item);
  state.holidays = sortHolidays(state.holidays);
  save();
  hdDraft = null;
  renderHolidays();
  render();
  toast(`${fmtMD(item.date)} ${item.name} 已保存`, 'check');
}

function deleteHolidayDraft() {
  const d = hdDraft;
  if (!d) return;
  const run = () => {
    state.holidays = (state.holidays || []).filter(h => h.date !== d._orig);
    save();
    hdDraft = null;
    renderHolidays();
    render();
    toast('已删除该条目');
  };
  if (!d._orig) { run(); return; }
  confirmModal({
    title: '删除这一条',
    desc: `确定删除 <b>${fmtMD(d._orig)} ${esc(d.name)}</b>？排课时会按普通日期处理。`,
    okText: '删除', danger: true,
    onDone: v => { if (v) run(); },
  });
}

async function doSyncHolidays() {
  if (hdSyncing) return;
  hdSyncing = true;
  renderHolidays();
  let res;
  try {
    res = await syncHolidayData();
  } catch (e) {
    res = { ok: false, errors: [String((e && e.message) || e)] };
  }
  hdSyncing = false;
  renderHolidays();
  render();
  if (res.ok) toast(`已同步 ${res.years.join('、')} 年共 ${res.count} 天`, 'check');
  else toast('同步失败，可继续用内置数据', 'alert');
}

function resetHolidayData() {
  confirmModal({
    title: '恢复内置安排',
    desc: `用应用内置的放假安排覆盖已收录的年份。<br>你手动改过、标记为「自定义」的条目会保留。`,
    okText: '恢复',
    onDone: v => {
      if (!v) return;
      const n = applyHolidayData(allBuiltinHolidays(), { stamp: false });
      state.meta.holidaySyncAt = 0;
      save();
      renderHolidays();
      render();
      toast(`已恢复为内置的 ${n} 天安排`, 'reset');
    },
  });
}

/* ============================================================
   基础 UI：toast / sheet / modal
   ============================================================ */
function toast(msg, iconName) {
  const wrap = $('#toastWrap');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = (iconName ? ic(iconName, 15) : '') + `<span>${esc(msg)}</span>`;
  wrap.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 240);
  }, 2200);
}

const overlay = () => $('#overlay');
function openSheet(opt) {
  $('#sheetTitle').innerHTML = opt.title || '';
  $('#sheetBody').innerHTML = opt.body || '';
  const f = $('#sheetFooter');
  f.innerHTML = opt.footer || '';
  f.style.display = opt.footer ? 'flex' : 'none';
  f.querySelectorAll('[data-close]').forEach(b => { b.onclick = closeSheet; });
  overlay().classList.add('show');
  document.body.style.overflow = 'hidden';
  if (opt.after) opt.after();
}
function closeSheet() {
  overlay().classList.remove('show');
  document.body.style.overflow = '';
}
const sheetOpen = () => overlay().classList.contains('show');

function confirmModal(opt) {
  const ov = $('#modalOverlay');
  $('#modalTitle').textContent = opt.title || '确认';
  $('#modalDesc').innerHTML = opt.desc || '';
  $('#modalBody').innerHTML = opt.body || '';
  $('#modalBody').style.display = opt.body ? 'block' : 'none';
  const ft = $('#modalFooter');
  ft.innerHTML = `
    <button class="btn ghost" data-modal="cancel">${esc(opt.cancelText || '取消')}</button>
    <button class="btn ${opt.danger ? 'danger' : ''}" data-modal="ok">${esc(opt.okText || '确定')}</button>`;
  ov.classList.add('show');
  const done = v => { ov.classList.remove('show'); opt.onDone && opt.onDone(v); };
  ft.querySelector('[data-modal="cancel"]').onclick = () => done(false);
  ft.querySelector('[data-modal="ok"]').onclick = () => done(true);
}
$('#modalOverlay').addEventListener('click', e => {
  if (e.target.id === 'modalOverlay') e.currentTarget.classList.remove('show');
});
overlay().addEventListener('click', e => {
  if (e.target.id === 'overlay') closeSheet();
});
$$('[data-close]').forEach(b => b.onclick = closeSheet);

/* ============================================================
   课时费页
   ============================================================ */
function renderPay() {
  const m = calcMonth(payMonth);
  const prev = calcMonth(shiftMonth(payMonth, -1));
  const isCurMonth = payMonth === todayYmd().slice(0, 7);
  const ms = splitMoney(m.total);

  // 近 6 个月
  const months = [];
  for (let i = 5; i >= 0; i--) months.push(shiftMonth(payMonth, -i));
  const monthData = months.map(ym => ({ ym, ...calcMonth(ym) }));
  const maxM = Math.max(1, ...monthData.map(x => x.total));

  // 环比
  const base = compareBase(payMonth, prev);
  let delta = '';
  if (base.total > 0) {
    const d = round2(((m.total - base.total) / base.total) * 100);
    delta = d >= 0
      ? `<span class="d up">↑ ${d.toFixed(1)}%</span> ${base.label}`
      : `<span class="d down">↓ ${Math.abs(d).toFixed(1)}%</span> ${base.label}`;
  } else if (m.total > 0) {
    delta = '<span class="d">上月无记录</span>';
  }

  const avgDay = (() => {
    const dates = [...new Set(m.rows.filter(r => r.done).map(r => r.lesson.date))];
    if (!dates.length) return 0;
    return round2(m.doneFee / dates.length);
  })();

  const maxTypeFee = Math.max(1, ...m.byType.map(t => t.fee));

  const detailRows = payDetailOpen ? m.rows : m.rows.slice(-12).reverse();
  const grouped = {};
  detailRows.forEach(r => {
    (grouped[r.lesson.date] = grouped[r.lesson.date] || []).push(r);
  });
  const dateKeys = Object.keys(grouped).sort().reverse();

  $('#page-pay').innerHTML = `
    <div class="month-switch">
      <button data-act="pay-prev">${ic('left', 16)}</button>
      <div class="m">${Number(payMonth.split('-')[1])}月<small>${payMonth.split('-')[0]}年${isCurMonth ? ' · 本月' : ''}</small></div>
      <button data-act="pay-next">${ic('right', 16)}</button>
    </div>

    <div class="card" style="background:linear-gradient(150deg,#1E2F80,#2C43C4 55%,#3B5BFD)">
      <div style="color:#fff">
        <div style="font-size:12.5px;opacity:.8;display:flex;justify-content:space-between">
          <span>应得课时费</span><span>${m.count} 节课 · ${m.km} 标准课时</span>
        </div>
        <div style="display:flex;align-items:flex-end;gap:6px;margin-top:6px">
          <span style="font-size:19px;font-weight:700;padding-bottom:7px;opacity:.9">¥</span>
          <span class="num" style="font-size:38px;font-weight:800;letter-spacing:-1.2px;line-height:1">${ms.int}</span>
          ${ms.dec === '00' ? '' : `<span class="num" style="font-size:17px;font-weight:700;padding-bottom:4px;opacity:.85">.${ms.dec}</span>`}
        </div>
        <div style="display:flex;gap:18px;margin-top:14px;padding-top:13px;border-top:1px solid rgba(255,255,255,.16);font-size:12px">
          <div><div style="opacity:.7">已结课</div><div class="num" style="font-size:15px;font-weight:700;margin-top:2px">${money(m.doneFee)}</div></div>
          <div><div style="opacity:.7">待上课</div><div class="num" style="font-size:15px;font-weight:700;margin-top:2px">${money(m.planFee)}</div></div>
          <div><div style="opacity:.7">方案</div><div style="font-size:14px;font-weight:700;margin-top:3px">${schemeName(state.settings.scheme)}</div></div>
        </div>
      </div>
    </div>

    <div class="stat-row">
      <div class="stat">
        <div class="k">${ic('clock', 13)} 总课时</div>
        <div class="v">${m.km}<small>课时</small></div>
        <div class="d">${m.doneCount} 节已上 · ${m.planCount} 节待上</div>
      </div>
      <div class="stat">
        <div class="k">${ic('chart', 13)} 单节均价</div>
        <div class="v">${m.count ? Math.round(m.lessonTotal / m.count) : 0}<small>元</small></div>
        <div class="d">${delta}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="card-title"><span class="dot"></span>课时费构成</div>
        <div class="card-more" data-act="open-calc-rules">规则 ${ic('right', 12)}</div>
      </div>
      <div class="split-bar">
        ${m.byType.length ? m.byType.map(t => `
          <div class="sb-item">
            <div class="sb-top">
              <span class="nm"><i class="tick" style="background:${t.color};width:8px;height:8px;border-radius:3px"></i>${esc(t.name)}</span>
              <span class="vl">${money(t.fee)}<small>${t.count
                ? `${t.count}节 · ¥${t.price}${unitSuffix(t.unit)}`
                : '含延长课时'}</small></span>
            </div>
            <div class="sb-track"><div class="sb-fill" style="width:${Math.max(3, (t.fee / maxTypeFee) * 100)}%;background:linear-gradient(90deg,${t.color}AA,${t.color})"></div></div>
          </div>`).join('') : `<div class="empty" style="padding:16px"><div class="s">本月还没有课时记录</div></div>`}
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="card-title"><span class="dot" style="background:var(--amber)"></span>补贴与扣款</div>
        <div class="card-more">${m.extraAdd || m.extraSub
          ? `${m.extraAdd ? '+' + money(m.extraAdd) : ''}${m.extraAdd && m.extraSub ? ' · ' : ''}${m.extraSub ? '−' + money(m.extraSub) : ''}`
          : '本月没有'}</div>
      </div>
      ${m.extraRows.length ? `<div class="rows">
        ${m.extraRows.map(e => `
          <div class="row" data-act="extra-edit" data-id="${esc(e.id)}" style="padding-left:0;padding-right:0">
            <div class="ri" style="background:${e.kind === 'sub' ? 'var(--rose-soft)' : 'var(--mint-soft)'};color:${e.kind === 'sub' ? 'var(--rose)' : 'var(--mint)'}">${ic(e.kind === 'sub' ? 'download' : 'spark', 16)}</div>
            <div class="rc">
              <div class="t">${esc(e.name || '未命名')}</div>
              <div class="s">${e.cycle === 'monthly' ? '每月固定' : '只这一次'}</div>
            </div>
            <div class="rv" style="color:${e.kind === 'sub' ? 'var(--rose)' : 'var(--mint)'}">${e.kind === 'sub' ? '−' : '+'}${money(Math.abs(Number(e.amount) || 0))}</div>
            ${ic('right', 15)}
          </div>`).join('')}
      </div>` : `<div class="help-note" style="margin-top:0">班主任津贴、监考费、代课费、缺勤扣款，都可以记在这里，会一起算进月度总额。</div>`}
      <div class="row" data-act="extra-add" style="padding-left:0;padding-right:0;border-top:1px solid var(--line-2)">
        <div class="ri" style="background:var(--brand-soft);color:var(--brand)">${ic('plus', 16)}</div>
        <div class="rc"><div class="t">添加补贴 / 扣款</div></div>
        ${ic('right', 15)}
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="card-title"><span class="dot" style="background:var(--mint)"></span>近 6 个月趋势</div>
        <div class="card-more">${money(monthData.reduce((s, x) => s + x.total, 0))}</div>
      </div>
      <div class="chart">
        ${monthData.map((x, i) => {
          const h = x.total > 0 ? Math.max(6, (x.total / maxM) * 78) : 3;
          const cur = x.ym === payMonth;
          return `<div class="col ${cur ? 'cur' : ''}">
            <div class="bar-wrap"><div class="bar" style="height:${h}px"></div></div>
            <div class="lbl">${Number(x.ym.split('-')[1])}月</div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="card-title"><span class="dot" style="background:var(--violet)"></span>月账单</div>
        <div class="card-more">${m.count ? `${m.count} 节` : '本月暂无'}</div>
      </div>
      <div class="rows">
        <div class="row" data-act="stmt-copy" style="padding-left:0;padding-right:0">
          <div class="ri" style="background:var(--brand-soft);color:var(--brand)">${ic('doc', 17)}</div>
          <div class="rc"><div class="t">复制成文字</div><div class="s">粘到微信发给教务，或自己存档</div></div>
          ${ic('right', 15)}
        </div>
        <div class="row" data-act="stmt-csv" style="padding-left:0;padding-right:0;border-top:1px solid var(--line-2)">
          <div class="ri" style="background:var(--mint-soft);color:var(--mint)">${ic('download', 17)}</div>
          <div class="rc"><div class="t">导出表格</div><div class="s">CSV 文件，Excel / WPS 可直接打开求和</div></div>
          ${ic('right', 15)}
        </div>
        <div class="row" data-act="term-report" style="padding-left:0;padding-right:0;border-top:1px solid var(--line-2)">
          <div class="ri" style="background:var(--violet-soft);color:var(--violet)">${ic('chart', 17)}</div>
          <div class="rc"><div class="t">学期总览</div><div class="s">整个学期的总额、按月分布与类型占比</div></div>
          ${ic('right', 15)}
        </div>
      </div>
      <div class="help-note" style="margin-top:10px">只统计本机记过的课；还没上的课按计划时长计入「待上」。</div>
    </div>

    <div class="section-label">
      <span>课时明细</span>
      <span style="font-weight:500;color:var(--ink-3)">${m.rows.length} 条</span>
    </div>

    ${dateKeys.length ? dateKeys.map(dk => `
      <div class="ledger-group">
        <div class="ledger-date">
          <span>${fmtMD(dk)} <span class="muted">${weekdayCN(dk)}</span></span>
          <span class="sum">${money(round2(grouped[dk].reduce((s, r) => s + r.subtotal, 0)))}</span>
        </div>
        ${grouped[dk].map(r => `
          <div class="ledger-item" data-act="show-breakdown" data-id="${r.lesson.id}">
            <div class="t">${periodTime(r.lesson.period).start}</div>
            <div class="n">
              <div class="a">${esc(r.lesson.klass || '未命名')} <span class="tag" style="background:${r.type.color}15;color:${r.type.color}">${esc(r.type.name)}</span></div>
              <div class="b">${esc(periodTime(r.lesson.period).name)} · ${priceExpr(r.unitPrice, r.qty, r.unitLabel, r.lesson.dur)}${r.classKey ? ` · ${esc(r.classKey)}×${r.classFactor}` : ''}${r.extraLabel ? ' · ' + esc(r.extraLabel) : ''}${r.extend ? ` · 含延长 ${r.extend.minutes} 分（按${esc(r.extend.type.name)} ${money(r.extend.subtotal)}）` : ''}</div>
            </div>
            <div class="f">${money(r.subtotal)}</div>
          </div>`).join('')}
      </div>`).join('') : `
      <div class="card"><div class="empty">
        ${ic('wallet', 40)}
        <div class="t">本月暂无课时记录</div>
        <div class="s">导入课表后自动计算课时费</div>
        <button class="btn outline sm mt16" data-act="open-import">${ic('upload', 14)} 导入课表</button>
      </div></div>`}

    ${m.rows.length > 12 ? `
      <button class="btn ghost" data-act="toggle-detail" style="margin-bottom:10px">
        ${payDetailOpen ? '收起明细' : `展开全部 ${m.rows.length} 条`}
      </button>` : ''}
  `;
}

/* ============================================================
   我的页
   ============================================================ */
function renderMine() {
  const ym = todayYmd().slice(0, 7);
  const m = calcMonth(ym);

  const t0 = todayYmd();
  const wk = weekIndexOf(t0);
  const totalWk = state.settings.termWeeks || 20;
  const par = weekParity(t0);
  const termPct = clamp(Math.round((wk / totalWk) * 100), 0, 100);
  const leftWk = Math.max(0, totalWk - wk);

  // 本周还剩几节：今天已下课的不算，只看今天之后到本周日
  const now = Date.now();
  const wsEnd = ymd(addDays(startOfWeek(new Date()), 6));
  const restN = state.lessons.filter(l => {
    if (l.status === 'canceled' || l.status === 'leave') return false;
    if (l.date === t0) return lessonEnd(l).getTime() > now;
    return l.date > t0 && l.date <= wsEnd;
  }).length;

  const typeN = state.types.filter(x => x.enabled !== false).length;
  const swapN = state.swaps.length;
  const meta = [state.teacher.school, state.teacher.subject].filter(Boolean).join(' · ') || '填写学校与科目';

  const offN = state.holidays.filter(h => h.kind !== 'work').length;
  const workN = state.holidays.filter(h => h.kind === 'work').length;
  const remindSub = state.settings.remindEnabled
    ? `提前 ${state.settings.remindBefore} 分钟`
    : '已关闭';

  $('#page-mine').innerHTML = `
    <div class="card mine-profile" data-act="edit-teacher">
      <div class="mp-top">
        <div class="avatar mp-avatar">${esc((state.teacher.name || '师').slice(0, 1))}</div>
        <div class="mp-id">
          <div class="mp-name">${esc(state.teacher.name)}<span class="pen">${ic('edit', 13)}</span></div>
          <div class="mp-sub">${esc(meta)}</div>
        </div>
        ${ic('right', 16)}
      </div>
      <div class="mp-kpis">
        <div><b>${m.count}</b><span>本月课时</span></div>
        <div><b class="green">${money(m.total)}</b><span>本月课酬</span></div>
        <div><b class="accent">${restN}</b><span>本周剩余</span></div>
      </div>
    </div>

    <div class="card mine-term" data-act="open-term">
      <div class="mt-row">
        <div class="mt-title">${ic('cal', 15)} 第 ${wk} 周 / 共 ${totalWk} 周</div>
        <span class="mt-badge ${par === 'even' ? 'even' : ''}">${parityLabel(par)}</span>
        <span class="mt-chev">${ic('right', 14)}</span>
      </div>
      <div class="mt-bar"><i style="width:${termPct}%"></i></div>
      <div class="mt-sub">${leftWk > 0 ? `还剩 ${leftWk} 周` : '本学期已结束'}</div>
    </div>

    <div class="section-label">计费</div>
    <div class="rows">
      <div class="row" data-act="open-types">
        <div class="ri" style="background:var(--brand-soft);color:var(--brand)">${ic('book', 17)}</div>
        <div class="rc"><div class="t">课程类型与单价</div></div>
        <div class="rv">${typeN} 类</div>
        ${ic('right', 15)}
      </div>
      <div class="row" data-act="open-calc-rules">
        <div class="ri" style="background:var(--violet-soft);color:var(--violet)">${ic('spark', 17)}</div>
        <div class="rc"><div class="t">计费公式</div></div>
        <div class="rv">${schemeName(state.settings.scheme)}</div>
        ${ic('right', 15)}
      </div>
    </div>

    <div class="section-label">课表与提醒</div>
    <div class="rows">
      <div class="row" data-act="open-periods">
        <div class="ri" style="background:var(--sky-soft);color:#026AA2">${ic('clock', 17)}</div>
        <div class="rc"><div class="t">作息时间表</div></div>
        <div class="rv">${state.periods.length} 节</div>
        ${ic('right', 15)}
      </div>
      <div class="row" data-act="open-holidays">
        <div class="ri" style="background:var(--rose-soft);color:var(--rose)">${ic('cal', 17)}</div>
        <div class="rc"><div class="t">法定节假日</div><div class="s">${offN} 天假 · ${workN} 天补班</div></div>
        <div class="rv">${state.settings.holidaySkip === false ? '不跳过' : ''}</div>
        ${ic('right', 15)}
      </div>
      <div class="row" data-act="open-swap-center">
        <div class="ri" style="background:var(--mint-soft);color:var(--mint)">${ic('swap', 17)}</div>
        <div class="rc"><div class="t">调课与调休</div><div class="s">${esc(makeupSummary())}</div></div>
        <div class="rv">${swapN ? `${swapN} 次` : ''}</div>
        ${ic('right', 15)}
      </div>
      <div class="row" data-act="open-remind">
        <div class="ri" style="background:var(--rose-soft);color:var(--rose)">${ic('bell', 17)}</div>
        <div class="rc"><div class="t">课前提醒</div><div class="s">${remindSub}</div></div>
        <div class="switch ${state.settings.remindEnabled ? 'on' : ''}" data-act="toggle-remind"></div>
        ${ic('right', 15)}
      </div>
    </div>

    <div class="section-label">数据</div>
    <div class="rows">
      <div class="row" data-act="open-schedule-io" data-ie="export">
        <div class="ri" style="background:var(--brand-soft);color:var(--brand)">${ic('swap', 17)}</div>
        <div class="rc"><div class="t">导入导出课表</div><div class="s">复制成文本发给同事</div></div>
        ${ic('right', 15)}
      </div>
      <div class="row" data-act="open-backup">
        <div class="ri" style="background:var(--mint-soft);color:var(--mint)">${ic('download', 17)}</div>
        <div class="rc"><div class="t">备份与恢复</div><div class="s">换手机不丢数据</div></div>
        ${ic('right', 15)}
      </div>
      <div class="row" data-act="open-sync">
        <div class="ri" style="background:var(--violet-soft);color:var(--violet)">${ic('swap', 17)}</div>
        <div class="rc"><div class="t">多设备同步</div><div class="s">${syncMineSub()}</div></div>
        ${ic('right', 15)}
      </div>
      <div class="row" data-act="clear-schedule">
        <div class="ri" style="background:var(--rose-soft);color:var(--rose)">${ic('trash', 17)}</div>
        <div class="rc"><div class="t" style="color:var(--rose)">清理课表</div><div class="s">只删课程，设置都保留</div></div>
        ${ic('right', 15)}
      </div>
    </div>

    <div class="section-label">帮助与关于</div>
    <div class="mine-links">
      <div data-act="open-help" data-h="faq">
        <div class="ml-ic" style="background:var(--amber-soft);color:#B26A00">${ic('spark', 16)}</div>
        <b>快捷帮助</b><span>常见问题</span>
      </div>
      <div data-act="open-help" data-h="guide">
        <div class="ml-ic" style="background:var(--sky-soft);color:#026AA2">${ic('doc', 16)}</div>
        <b>使用说明</b><span>上手步骤</span>
      </div>
      <div data-act="open-help" data-h="about">
        <div class="ml-ic" style="background:var(--brand-soft);color:var(--brand)">${ic('info', 16)}</div>
        <b>关于</b><span class="rv">v${APP_VERSION}</span>
      </div>
    </div>

    <div class="mine-foot">
      <button class="danger-link" data-act="reset-demo">恢复示例数据</button>
      <div class="ver" data-act="check-update">v${APP_VERSION} · 检查更新</div>
    </div>
  `;
}

/* ============================================================
   帮助 · 说明 · 关于
   ============================================================ */
const APP_VERSION = '1.1.0';
const APP_BUILD = '2026-11-12';

let helpTab = 'faq';                       // faq | guide | about
const helpOpen = new Set(['0-0']);         // 展开的问答（key: 组序-条序）
let logOpen = false;                       // 关于页更新记录

const FAQ_GROUPS = [
  {
    name: '计费',
    items: [
      {
        q: '一节课的钱是怎么算出来的？',
        a: `先取这节课的<b>课程类型单价</b>，乘以数量（按节次是 1 节、按时长是实际分钟 ÷ 60、按人数是上课人数），再乘类型系数与班级系数，最后四舍五入到分。<br>在课表里点开任意一节课 →「费用构成」，能看到每一步用的数字。`,
      },
      {
        q: '自习、晚自习按时长算，会出现几分钱的小数吗？',
        a: `不会。按小时计价时用<b>实际分钟数 ÷ 60</b> 参与计算，中间不做四舍五入，只在最后结算到分。<br>比如 36 元/小时、25 分钟一节：36 × 25 ÷ 60 = <b>15.00 元</b>；晚自习 70 分钟 = 42.00 元、50 分钟 = 30.00 元，加起来不会出现 .01 的毛刺。`,
        go: { act: 'types', text: '查看课程类型' },
      },
      {
        q: '拖堂（延长课）怎么记？',
        a: `两个入口：记课时的时候在「延长课时」里填分钟数；或者在<b>总课表</b>的格子里直接设延长，铺到本学期后每节课都自带这段延长。<br>延长部分不按正课单价算，而是走「延长课计价类型」（默认自习）的单价，可在计费公式里改。`,
        go: { act: 'calc', text: '设置延长课单价' },
      },
      {
        q: '班级系数是什么？',
        a: `按班级名里的<b>关键词</b>自动上浮，例如关键词「高三」× 1.1，那么高三(2) 的课会自动乘 1.1。<br>只有打开开关后才生效，且只影响之后的计算与展示，不改动已录入的数据。`,
        go: { act: 'calc', text: '去设置' },
      },
      {
        q: '三种计费公式有什么区别？',
        a: `<b>标准计费</b>：单价 × 数量，最常用。<br><b>阶梯累进</b>：每月前 N 节按原价，超出部分按更高单价。<br><b>超课时上浮</b>：每月总量超过 N 小时后，超出部分 × 倍数（如 1.5）。<br>切换后当月和历史月份都会按新公式重算。`,
        go: { act: 'calc', text: '切换公式' },
      },
      {
        q: '为什么某节课没算进课时费？',
        a: `被标记为<b>请假</b>或<b>取消</b>的课不计费，也不会计入节数和时长。在课表里点开那节课可以改回「正常」。`,
      },
    ],
  },
  {
    name: '课表',
    items: [
      {
        q: '单双周怎么排？',
        a: `在<b>总课表</b>里点格子，周次选「单周」或「双周」。同一个格子可以同时挂单周、双周两门课，格子里会分两行显示，行首标「单」「双」，并用各自颜色区分。<br>图例在总课表下方。`,
        go: { act: 'master', text: '打开总课表' },
      },
      {
        q: '总课表改了，为什么课表没变？',
        a: `总课表是<b>模板</b>，改完要点「铺到本学期」，才会按模板生成每一天的课。<br>已经调休过的周、你手动加的课不会被覆盖，会跳过。`,
        go: { act: 'master', text: '去铺课表' },
      },
      {
        q: '双周周五下午的课要挪到周日返校，怎么弄？',
        a: `我的 → <b>调休规则</b>：设好「提前放学日 = 周五」「补课日 = 周日」「第几节之后平移」，保存后到课表页 →「调休」，点那一周的「平移」即可。<br>也可以「一键全部调休」，之后想撤销点「恢复」。`,
        go: { act: 'makeup', text: '设置调休规则' },
      },
      {
        q: '临时换课怎么办？',
        a: `课表里点那节课 →「调课」，选目标日期和节次。若目标位置已有课，会提示并支持两节互换，调课记录可以在我的 →「调课记录」里查。`,
        go: { act: 'schedule', text: '去课表' },
      },
      {
        q: '改了作息时间表，以前录的课会跟着变吗？',
        a: `会。<b>跟随作息</b>的课（时长后面标着「跟随作息」）会按新的节次时长自动更新；你手动改过时长的课保持原样，不会被动。`,
        go: { act: 'periods', text: '打开作息表' },
      },
      {
        q: '法定节假日是自动同步的吗？',
        a: `我的 → <b>法定节假日</b>：内置 2026–2027 年的放假与补班安排，点「同步最新」可联网取最新年份。<br>每一条都能改：点开可改<b>名称、日期</b>，放假还能设<b>半天放学</b>；也能手动添加校运会、家长会这类只有你们学校才有的日子。改过的条目会标「自定义」，再次同步不会被覆盖。`,
        go: { act: 'holidays', text: '打开法定节假日' },
      },
      {
        q: '假日和补班日会怎么影响排课？',
        a: `打开「排课时跳过假期」（默认开启）后点「铺到本学期」：<b>放假日</b>不生成课；<b>半天</b>只排到放学时刻，之后的节次自动空出；<b>补班日</b>照常上课，还可以指定「按周五的课表」来排。<br>只影响<b>今天及以后</b>的日期，已经过去的课不会被改动。`,
      },
      {
        q: '怎么把课表发给同事，或换到另一台手机？',
        a: `我的 →「导入导出课表」，导出得到一段纯文本（一行一节，含单双周和 +20分 延长）。对方粘贴进去导入即可，还能勾选「同时铺到本学期」。`,
        go: { act: 'io', text: '打开导入导出' },
      },
      {
        q: '能把 Excel 课表直接导入吗？',
        a: `可以。我的 →「导入导出课表」→ 导入，点<b>读 Excel / CSV</b> 选 <b>.xlsx</b> 文件，读第一张工作表。<br>表格里的表头（日期 / 节次 / 班级 / 类型）会自动跳过；日期列如果是 Excel 日期格式，会转成 2026-11-16 这种写法。<br>老式 <b>.xls</b> 读不了，在 Excel 里「另存为」成 .xlsx 或 CSV 就行。`,
        go: { act: 'io', text: '去导入课表' },
      },
    ],
  },
  {
    name: '提醒与数据',
    items: [
      {
        q: '为什么收不到课前提醒？',
        a: `按顺序检查三件事：① 系统<b>通知权限</b>已允许；② 允许「闹钟和提醒」（精确闹钟）；③ 把课酬加入<b>电池优化白名单</b>，避免后台被清理。<br>提醒设置页有对应按钮，也可以点「测试通知」验证。`,
        go: { act: 'remind', text: '检查提醒设置' },
      },
      {
        q: '数据存在哪里？换手机怎么迁移？',
        a: `所有数据只保存在本机，<b>不上传、不收集、无广告</b>。<br>换机时可以「我的 → 多设备同步」，同一个 WiFi 下两台手机直接对传；不方便连同一个 WiFi 就导出同步包用微信发过去。<br>也可以用「备份与恢复」导出 JSON（那个是覆盖恢复，换机用）。<b>卸载或清除数据会一起删掉</b>，建议每月备份一次。`,
        go: { act: 'sync', text: '打开多设备同步' },
      },
      {
        q: '示例课表怎么清掉？',
        a: `首页提示条点「清理」，或「我的 → 清理课表」。可以只删示例课、留着自己录的，也可以全部清空（会二次确认）。`,
        go: { act: 'clear', text: '清理课表' },
      },
    ],
  },
  {
    name: '口径',
    items: [
      {
        q: '两台手机的数据怎么合到一起？',
        a: `「我的 → 多设备同步」。同一个 WiFi 下，一台点<b>开启接收</b>，另一台点<b>查找另一台手机</b>，找到后点一下就开始传。<br>不方便连同一个 WiFi 时，导出同步包用微信发过去，对方点"导入同步包"。<br>同步是<b>合并</b>不是覆盖：两边各自加的课都留着；同一条记录两边都改过，以改得晚的为准。删掉的课也会同步删掉。全程不经过服务器。`,
        go: { act: 'sync', text: '打开多设备同步' },
      },
      {
        q: '跨月的课算哪个月？',
        a: `按<b>上课那天</b>算。比如 12 月 31 日的晚自习，就算 12 月，哪怕下课已经过了零点。<br>所以月初核对时，只要看那个月的账单就是完整的。`,
      },
      {
        q: '请假、取消的课要不要算钱？',
        a: `不算。点开那节课标成<b>请假</b>或<b>取消</b>后，它既不进金额，也不进节数和课时。<br>好处是不用删记录——月底翻回来还能看到「这节确实没上」。`,
      },
      {
        q: '补课、调休挪过来的课怎么算？',
        a: `都算<b>实际上课那天</b>的钱，按那节课原本的类型单价结算，不会因为「补」就减价。<br>挪到周日的课进周日所在那个月，原定日期的记录会被替换掉，不会重复计。`,
        go: { act: 'swap', text: '去看调课与调休' },
      },
      {
        q: '班级系数是按班算还是按人算？',
        a: `按<b>班级名里的关键词</b>算，一整个班都乘同一个系数，和个人无关。<br>比如关键词「高三 ×1.2」，那么高三(1)、高三(7) 的所有课都乘 1.2；想给某个班单独设，就把那个班名当成关键词加进去。`,
        go: { act: 'calc', text: '设置班级系数' },
      },
      {
        q: '拖堂的时长算不算进阶梯和超课时？',
        a: `不算。<b>阶梯档位</b>与<b>超课时</b>只按整节课的节数累计，拖堂那段时间单独按「延长课计价类型」的单价另算，不会把你顶进更高的一档。`,
        go: { act: 'calc', text: '查看计费公式' },
      },
      {
        q: '一学期从哪天算到哪天？',
        a: `从<b>学期第一周的周一</b>起，往后数「总周数」周。它决定三件事：今天是第几周、这周是单周还是双周、以及「学期总览」统计的区间。<br>学期中途改这个日期，单双周会整体平移，历史记录本身不受影响。`,
        go: { act: 'term', text: '设置学期' },
      },
    ],
  },
];

const GUIDE_STEPS = [
  {
    t: '第 1 步 · 填好单价',
    s: `「我的 → 课程类型与单价」里把正课、自习、晚自习分开设。计价方式选<b>按节次</b>（一节固定价）还是<b>按时长</b>（按分钟折算），决定了后面怎么算。`,
    go: ['types', '去设单价'],
  },
  {
    t: '第 2 步 · 核对作息时间表',
    s: `每节的起止时间决定三件事：录入时自动带出的<b>时长</b>、课表上显示的<b>时间</b>、课前提醒的<b>提醒时刻</b>。改完保存，跟随作息的课会自动同步。`,
    go: ['periods', '打开作息表'],
  },
  {
    t: '第 3 步 · 设学期与单双周',
    s: `选<b>学期第一周的周一</b>和总周数，系统据此推算今天是第几周、这周是单周还是双周。日期选错会让单双周整体错位。`,
    go: ['term', '设置学期'],
  },
  {
    t: '第 4 步 · 搭一张总课表',
    s: `总课表是每周的模板：点格子选课、班级和<b>周次</b>（每周/单周/双周），有拖堂就顺手填<b>延长课时</b>。填完点「铺到本学期」，整个学期的课就排好了。<br>铺之前先去「我的 → 法定节假日」看一眼，放假与补班的日子会自动跳过或按指定星期排。`,
    go: ['master', '打开总课表'],
  },
  {
    t: '第 5 步 · 每天照常上课',
    s: `临时换课用「调课」，双周提前放学用「调休」，请假点开那节课标记即可。没上的课不计费，也不用担心漏记。`,
    go: ['schedule', '去课表'],
  },
  {
    t: '第 6 步 · 月底核对课时费',
    s: `「课时费」页按月汇总，点「课时费构成」看每类课各多少节、多少钱，再点具体一节课能看到<b>逐项计算过程</b>，对账时直接给这张明细。`,
    go: ['pay', '查看课时费'],
  },
  {
    t: '第 7 步 · 备份一次',
    s: `数据只在本机。每月「导出备份」存一份 JSON 到手机或网盘，换机、重装都能恢复。课表还可以另存为文本，方便发给同事。`,
    go: ['backup', '导出备份'],
  },
];

const CHANGELOG = [
  { v: '1.1.0', d: '2026-11-13', items: ['多设备同步更稳了：修掉部分机型一直扫不到对方的毛病，配对时页面不再卡住', '启动时自动体检数据，发现异常当场修正并告诉你改了什么', '课表、金额、作息这些算得不对的老问题，多半是历史数据坏了，现在会被兜住', '同步包和导入的文件若来自别的版本，也只修不丢'] },
  { v: '1.0.23', d: '2026-11-13', items: ['课表可以直接从 .xlsx 导入，不用再另存为 CSV', 'Excel 里的日期列会自动认出来；表头上方有标题行也没关系', '老式 .xls 仍不支持，会提示另存为 .xlsx 或 CSV'] },
  { v: '1.0.22', d: '2026-11-13', items: ['计费方案可以存多套，换学校、换算法一键切回', '方案能生成一段分享码发给同事，对方粘贴即用', '课时费页新增「学期总览」：整个学期的总额、按月分布、类型占比', '批量导入课表支持直接读 CSV 文件；帮助里补了「口径」问答'] },
  { v: '1.0.21', d: '2026-11-12', items: ['作息模板改为优先走实时线路，更新后不再被 CDN 缓存拖住'] },
  { v: '1.0.20', d: '2026-11-12', items: ['新增「补贴与扣款」：班主任津贴、监考费、代课费、缺勤扣款都能记账，一起算进月度总额', '可设「每月固定」或「只这一次」，一次性款项不会跟着月份重复', '月报和导出的表格里也会带上这些条目', '作息模板可以联网更新，以后新增学段或地区作息不用等新版本'] },
  { v: '1.0.19', d: '2026-11-12', items: ['课时费页新增「月账单」：一键复制成文字，或导出表格（Excel / WPS 直接打开）', '作息表可一键套用初中 / 高中 / 小学三套常见时间', '已经有课排在第 9 节时，套用短作息会被拦下，避免时间算错'] },
  { v: '1.0.18', d: '2026-11-12', items: ['新版本不用自己想起来看了：后台每 6 小时查一次，有更新会弹通知', '点通知直接打开更新页，一路点到装好', '页面被系统回收后会自动重开，不再整应用退出'] },
  { v: '1.0.17', d: '2026-11-12', items: ['修复在 Android 17 上打开就退出的问题', '万一还是闪退，下次打开会显示原因，可复制发给我'] },
  { v: '1.0.16', d: '2026-11-12', items: ['适配 Android 16：状态栏不会再压住页面顶上那一条', '返回键换成系统新机制，全面屏手势返回更跟手', '最低支持仍是 Android 6.0，老机器不受影响'] },
  { v: '1.0.15', d: '2026-11-12', items: ['「我的」页重新整理：分组更少，每行只说一件事', '调休规则与调课记录合并到「调课与调休」', '备份与恢复合成一个入口，清理课表单独成行', '更新页面只显示版本号和更新内容，去掉技术细节'] },
  { v: '1.0.14', d: '2026-11-12', items: ['修复有了新版本却提示「已是最新」的问题', '检查更新更稳，不再受网络缓存影响'] },
  { v: '1.0.13', d: '2026-11-12', items: ['新增法定节假日：内置 2026–2027 年放假与补班安排', '可改日期名称、设半天放学，联网可同步最新年份', '铺课表自动跳过假期，补班日按指定星期的课表上课'] },
  { v: '1.0.12', d: '2026-11-11', items: ['部分网络下检查更新会失败，这次换了更稳的线路'] },
  { v: '1.0.11', d: '2026-11-11', items: ['修复部分网络连不上更新服务器', '检查失败时可以自己填一个更新地址'] },
  { v: '1.0.10', d: '2026-11-11', items: ['更新改从正式发布页获取'] },
  { v: '1.0.9', d: '2026-11-11', items: ['新增自动更新：检查、下载、安装一条龙', '界面可热更新，改文案不必再重装整包', '更新失败不影响本地数据，随时可回退'] },
  { v: '1.0.8', d: '2026-11-11', items: ['「我的」页重排：身份卡带本月课时/课酬/本周剩余', '新增学期进度条，一眼看出第几周、单双周', '计费与课表拆成两组，清理与重置下沉到页脚'] },
  { v: '1.0.7', d: '2026-11-11', items: ['新增帮助中心：快捷帮助、使用说明、关于', '关于页可查看本机数据统计与完整更新记录', '补充空状态与几处文案细节'] },
  { v: '1.0.6', d: '2026-11-09', items: ['总课表可直接设置延长课，铺课后每节自带', '课表文本导入导出支持行尾 +20分'] },
  { v: '1.0.5', d: '2026-11-09', items: ['课表可一键导出为文本，粘贴即可换机或分享', '支持覆盖/合并导入，并可同时铺到本学期'] },
  { v: '1.0.4', d: '2026-11-09', items: ['修正按分钟计价时的分币误差', '导出文件可自选保存位置'] },
  { v: '1.0.3', d: '2026-11-09', items: ['总课表显示单双周，同格分色并用「单/双」标注'] },
  { v: '1.0.2', d: '2026-11-09', items: ['修改作息时间表后，自习等课程时长自动跟随'] },
  { v: '1.0.1', d: '2026-11-09', items: ['新增一键清理示例课表，保留自己的记录'] },
  { v: '1.0.0', d: '2026-11-08', items: ['首个版本：正课与自习分开计价、多种计费公式', '课表、课前提醒、快捷调课与调休'] },
];

function helpStat() {
  const days = new Set(state.lessons.map(l => l.date)).size;
  const cells = Object.keys(state.master || {}).length;
  const fee = state.lessons
    .filter(l => l.status !== 'canceled' && l.status !== 'leave')
    .reduce((s, l) => s + lessonTotal(l), 0);
  return { lessons: state.lessons.length, days, cells, fee: round2(fee) };
}

function openHelp(tab) {
  helpTab = tab || 'faq';
  renderHelp(false);
}

function helpTabsHtml() {
  const tabs = [['faq', '快捷帮助'], ['guide', '使用说明'], ['about', '关于']];
  return `<div class="segmented" style="margin-bottom:14px;flex:0 0 auto">
    ${tabs.map(([k, n]) => `<button class="${helpTab === k ? 'on' : ''}" data-act="help-tab" data-h="${k}">${n}</button>`).join('')}
  </div>`;
}

function renderHelp(keepScroll) {
  const sc = keepScroll && $('#sheetBody') ? $('#sheetBody').scrollTop : 0;
  const body = helpTab === 'faq' ? faqHtml() : helpTab === 'guide' ? guideHtml() : aboutHtml();
  openSheet({ title: '帮助与关于', body });
  const sb = $('#sheetBody');
  if (sb) sb.scrollTop = sc;
}

function faqHtml() {
  const groups = FAQ_GROUPS.map((g, gi) => `
    <div class="help-group">${esc(g.name)}</div>
    ${g.items.map((it, ii) => {
      const key = gi + '-' + ii;
      const open = helpOpen.has(key);
      return `<div class="faq ${open ? 'on' : ''}" data-act="faq-toggle" data-k="${key}">
        <div class="faq-q"><span>${esc(it.q)}</span>${ic('right', 14)}</div>
        <div class="faq-a">${it.a}${it.go
          ? `<br><button class="btn ghost sm" data-act="help-go" data-go="${it.go.act}">${esc(it.go.text)}</button>`
          : ''}</div>
      </div>`;
    }).join('')}
  `).join('');

  return `${helpTabsHtml()}
    <div class="tiny muted" style="line-height:1.75;margin-bottom:4px">
      点问题展开答案。第一次用，建议先看一遍「使用说明」。
    </div>
    ${groups}
    <div class="help-foot">
      没找到答案？把这段说明转给帮你装这个 App 的人<br>或先导出备份，再重置示例数据试一遍
    </div>`;
}

function guideHtml() {
  return `${helpTabsHtml()}
    <div class="tiny muted" style="line-height:1.75;margin-bottom:6px">
      从装好到算出第一个月的钱，一共七步，大约十分钟。
    </div>
    <div class="card" style="padding:2px 16px;margin-top:12px;box-shadow:none;border:1px solid var(--line)">
      ${GUIDE_STEPS.map((s, i) => `
        <div class="step">
          <div class="sn">${i + 1}</div>
          <div class="sc">
            <div class="st">${esc(s.t)}</div>
            <div class="ss">${s.s}</div>
            <button class="btn ghost sm" data-act="help-go" data-go="${s.go[0]}">${esc(s.go[1])}</button>
          </div>
        </div>`).join('')}
    </div>
    <div class="help-note">
      <b>三个容易踩的坑</b><br>
      · 单价忘了改成「按时长」，自习就会按整节算；<br>
      · 总课表改完忘了「铺到本学期」，课表看起来没反应；<br>
      · 学期第一周的周一选错，单双周会整体错一周。
    </div>
    <div class="help-foot">上手遇到问题，去「快捷帮助」按关键词找找</div>`;
}

function aboutHtml() {
  const st = helpStat();
  const logs = logOpen ? CHANGELOG : CHANGELOG.slice(0, 3);
  return `${helpTabsHtml()}
    <div class="about-hero">
      <div class="about-logo">酬</div>
      <div class="about-name">课酬</div>
      <div class="about-ver">v${APP_VERSION} · ${APP_BUILD}</div>
      <div class="about-tag">正课自习分开算，一节都不会漏</div>
    </div>

    <div class="about-stats">
      <div><b>${st.lessons}</b><span>节课</span></div>
      <div><b>${st.days}</b><span>天有课</span></div>
      <div><b>${moneyPlain(st.fee)}</b><span>累计课酬(元)</span></div>
    </div>

    <div class="help-group">更新记录</div>
    <div class="card" style="padding:2px 16px;box-shadow:none;border:1px solid var(--line)">
      ${logs.map(c => `
        <div class="log-item">
          <div class="log-head"><span class="log-v">v${c.v}</span><span class="log-d">${c.d}</span></div>
          <ul class="log-ul">${c.items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        </div>`).join('')}
      <div class="row" style="padding-left:0;padding-right:0" data-act="log-toggle">
        <div class="rc"><div class="t" style="font-size:13px">${logOpen ? '收起更新记录' : `查看更早的 ${CHANGELOG.length - 3} 个版本`}</div></div>
        ${ic(logOpen ? 'left' : 'right', 15)}
      </div>
    </div>

    <div class="help-group">数据与隐私</div>
    <div class="help-note" style="margin-top:0">
      课程、课表和设置都只保存在<b>这台手机</b>，我们拿不到，也不上传、不收集、无广告。<br>
      卸载或清除数据会一并删除，建议定期在「备份与恢复」里存一份。
    </div>

    <div class="help-foot">
      课酬 · 给一线老师的小工具<br>
      数字对不上时，点开那节课看「费用构成」
    </div>`;
}

/* ============================================================
   软件更新
   ------------------------------------------------------------
   两条路：
   · 资源包（web）—— 只换 html/css/js，几百 KB，下完即生效；
   · 整包（apk）—— 原生有改动才发，必须用户手动点「安装」。
   原生只负责网络与文件，版本比较和界面都放在这里，
   这样更新逻辑本身也能跟着资源包一起升级。
   ============================================================ */

/**
 * 更新清单的候选地址。
 *
 * 国内 raw.githubusercontent.com 常被 DNS 污染（解析到 0.0.0.0，连都连不上），
 * 所以列一串备用地址。注意这里**不是**「谁先成功就用谁」——那样会踩缓存：
 * jsDelivr 的分支（@main）地址带 12 小时 CDN 缓存，发布新版后它会继续吐旧清单，
 * 而它往往又比别的源先返回，于是新版本永远检测不到。
 *
 * 正确做法见 checkUpdate()：所有地址并发拉，取 versionCode 最大的那一份。
 * 缓存旧的源自然被淘汰，不再影响判断。
 *
 * jsDelivr 故意放最后，只做「别的源全挂」时的兜底：
 * 它的内容可能是旧的，但至少能告诉用户「连上了，只是没看到新版」。
 * 用 @latest 而不是 @main —— tag 是不可变地址，新版本一发布就是全新 URL，不会被旧缓存粘住。
 */
const UPDATE_SOURCES = [
  'https://raw.githubusercontent.com/user269/kechou/main/update.json',
  'https://ghfast.top/https://raw.githubusercontent.com/user269/kechou/main/update.json',
  'https://gh-proxy.com/https://raw.githubusercontent.com/user269/kechou/main/update.json',
  'https://ghproxy.net/https://raw.githubusercontent.com/user269/kechou/main/update.json',
  'https://cdn.jsdelivr.net/gh/user269/kechou@latest/update.json',
];
/** 安装包与资源包的镜像前缀，GitHub 的下载直链在国内同样常被卡。 */
const MIRROR_PREFIXES = ['https://ghfast.top/', 'https://gh-proxy.com/', 'https://ghproxy.net/'];
const UPDATE_GAP = 6 * 60 * 60 * 1000;   // 自动检查的最小间隔

const UPD = {
  checking: false,
  phase: 'idle',    // idle | check | uptodate | error | download | ready
  kind: '',         // '' | web | apk
  latest: '',
  notes: [],
  size: 0,
  build: 0,
  url: '',
  urls: [],         // 下载地址候选：原始地址 + 清单里的 mirrors + 镜像前缀
  source: '',       // 这次是从哪个清单地址拿到的
  remoteName: '',   // 清单里写的最新版本名，用于「已是最新」时展示，方便排查
  remoteCode: 0,
  pct: 0,
  err: '',
};
let updSilent = true;

/** 这一轮要试的清单地址：用户自定义的排最前，其余按内置顺序。 */
function manifestSources() {
  const custom = String((state.settings && state.settings.updateSource) || '').trim();
  const list = [];
  if (custom) list.push(custom);
  UPDATE_SOURCES.forEach(u => { if (list.indexOf(u) < 0) list.push(u); });
  return list;
}

/** 给一个地址生成候选列表：清单给的镜像优先，然后原始地址，最后是通用镜像前缀。 */
function mirrorUrls(url, extra) {
  const out = [];
  const add = u => { if (u && out.indexOf(u) < 0) out.push(u); };
  // 清单里的 mirrors 是发布时按可达性排好序的，国内往往比原始直链先通
  (Array.isArray(extra) ? extra : []).forEach(add);
  add(url);
  // 只有 GitHub 的直链才套镜像前缀，用户自定义的地址原样使用
  const u = String(url || '');
  if (u.indexOf('https://github.com/') === 0
      || u.indexOf('https://raw.githubusercontent.com/') === 0) {
    MIRROR_PREFIXES.forEach(pfx => add(pfx + u));
  }
  return out;
}

/** 把原生的英文异常翻成用户能看懂、并且知道下一步该干什么的话。 */
function friendlyUpdateError(msg) {
  const m = String(msg || '');
  if (/0\.0\.0\.0|ConnectException|Failed to connect|ECONNREFUSED/i.test(m)) {
    return '连不上更新服务器，可能是当前网络限制了它。换成流量或别的 WiFi 再试一次。';
  }
  if (/UnknownHost|域名解析|No address associated/i.test(m)) {
    return '当前网络找不到更新服务器，换个网络再试。';
  }
  if (/超时|timeout/i.test(m)) return '连接超时了，网络有点慢，稍后再试。';
  if (/HTTP 4\d\d/.test(m)) return '更新服务器暂时没有响应，可能是这个版本刚被撤回。';
  if (/清单为空|清单格式|JSON/i.test(m)) return '收到的更新信息不完整，换个网络再试。';
  return m || '连不上更新服务器，稍后再试。';
}

/** 当前安装包与资源包的版本信息，浏览器里取不到就按「永不提示整包」处理。 */
function localAppInfo() {
  const info = { versionName: APP_VERSION, versionCode: 0, webBuild: 0, canInstall: false };
  if (IS_NATIVE && NATIVE.appInfo) {
    try {
      const raw = NATIVE.appInfo();
      if (raw) Object.assign(info, JSON.parse(raw));
    } catch (e) { /* 老版本没有这个方法，保持默认值 */ }
  }
  if (!IS_NATIVE) info.versionCode = Number.MAX_SAFE_INTEGER;
  return info;
}

function applyManifest(man) {
  const local = localAppInfo();
  const remoteCode = Number(man && man.versionCode) || 0;
  const remoteName = String((man && man.versionName) || '');
  const web = (man && man.web) || null;
  const webBuild = Number(web && web.build) || 0;
  const apkUrl = man && man.apk && man.apk.url ? String(man.apk.url) : '';

  UPD.kind = '';
  UPD.latest = '';
  UPD.notes = [];
  UPD.url = '';
  UPD.urls = [];
  UPD.size = 0;
  UPD.build = 0;
  UPD.remoteName = remoteName;
  UPD.remoteCode = remoteCode;

  // 整包里已经带了最新界面，所以只要能换整包就不必再下一份资源
  if (remoteCode > Number(local.versionCode || 0) && apkUrl) {
    UPD.kind = 'apk';
    UPD.latest = remoteName || `build ${remoteCode}`;
    UPD.notes = Array.isArray(man.notes) ? man.notes : [];
    UPD.size = Number(man.apk.size) || 0;
    UPD.url = apkUrl;
    UPD.urls = mirrorUrls(apkUrl, man.apk.mirrors);
  } else if (webBuild > Number(local.webBuild || 0) && web && web.url) {
    UPD.kind = 'web';
    UPD.latest = web.name || `资源 ${webBuild}`;
    UPD.notes = Array.isArray(web.notes) ? web.notes
      : (Array.isArray(man.notes) ? man.notes : []);
    UPD.size = Number(web.size) || 0;
    UPD.url = String(web.url);
    UPD.urls = mirrorUrls(UPD.url, web.mirrors);
    UPD.build = webBuild;
  }
}

/** 清单的「新旧」排序依据：先比整包 versionCode，再比资源包 build。 */
function manifestRank(man) {
  return [
    Number(man && man.versionCode) || 0,
    Number(man && man.web && man.web.build) || 0,
  ];
}

/** 从若干份成功拿到的清单里挑最新的一份。全都没有就返回 null。 */
function pickNewestManifest(list) {
  let best = null;
  let bestRank = null;
  (list || []).forEach(it => {
    const r = manifestRank(it.man);
    if (!best) { best = it; bestRank = r; return; }
    if (r[0] > bestRank[0] || (r[0] === bestRank[0] && r[1] > bestRank[1])) {
      best = it; bestRank = r;
    }
  });
  return best;
}

/**
 * 检查更新。所有清单地址同时拉，谁报的版本号大就用谁。
 *
 * 为什么不能「第一个连上就用」：CDN 缓存会让某个源长期返回旧清单，
 * 它又常常比别的源快，于是应用永远认为「已是最新」，而实际上新版本已经发了。
 * 并发 + 取最大是最省事也最稳的解法——旧缓存源的答案天然被淘汰，
 * 代价只是一次多发几个小请求（清单才几百字节）。
 */
function checkUpdate(silent) {
  if (UPD.checking) return;
  updSilent = !!silent;
  UPD.checking = true;
  UPD.err = '';
  UPD.source = '';
  UPD.remoteName = '';
  UPD.remoteCode = 0;

  if (!silent) {
    UPD.phase = 'check';
    openUpdateSheet();
  }

  const sources = manifestSources();
  if (!sources.length) return handleCheck(null, '没有可用的更新地址');

  if (IS_NATIVE && NATIVE.updateCheck) {
    try {
      // 原生在后台并发拉全部分支，把版本最高的那份回传过来
      NATIVE.updateCheck(JSON.stringify(sources));
    } catch (e) {
      handleCheck(null, '调用更新接口失败');
    }
    return;
  }

  // 浏览器预览：没有原生兜底，用 fetch 自己并发试
  let left = sources.length;
  let firstErr = '';
  const got = [];
  sources.forEach(src => {
    fetch(src, { cache: 'no-store' })
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(t => {
        let man = null;
        try { man = JSON.parse(t); } catch (e) { throw new Error('清单格式错误'); }
        if (!man || typeof man !== 'object') throw new Error('清单为空');
        got.push({ body: t, source: src, man });
      })
      .catch(e => { if (!firstErr) firstErr = (e && e.message) || '连接失败'; })
      .then(() => {
        if (--left > 0) return;
        const best = pickNewestManifest(got);
        if (best) handleCheck(best.body, null, best.source);
        else handleCheck(null, firstErr || '所有更新地址都连不上');
      });
  });
}

function handleCheck(text, err, source) {
  UPD.checking = false;
  if (err) return handleCheckFail(err);

  let man = null;
  try {
    man = typeof text === 'string' ? JSON.parse(text) : text;
  } catch (e) {
    return handleCheckFail('更新清单格式错误');
  }
  if (!man || typeof man !== 'object') return handleCheckFail('更新清单为空');

  UPD.source = source || '';
  applyManifest(man);
  UPD.phase = UPD.kind ? 'idle' : 'uptodate';
  state.settings.lastUpdateAt = Date.now();
  state.settings.lastUpdateOk = Date.now();
  // 留一份最近的清单，断网时至少能告诉用户上次检查到了什么
  state.settings.updateCache = { body: JSON.stringify(man), at: Date.now() };
  save();

  if (updSilent) {
    // 自动检查不打扰：有新版本才让首页长出提示条
    if (UPD.kind) render();
    return;
  }
  // 用户已经看到结果了，首页提示条没必要再挂着
  if (UPD.kind) { state.settings.updateSeen = UPD.latest; save(); }
  renderUpdateSheet();
}

function handleCheckFail(msg) {
  UPD.checking = false;
  UPD.err = friendlyUpdateError(msg);
  if (updSilent) return;            // 后台检查失败静默忽略，不打扰用户
  UPD.phase = 'error';
  renderUpdateSheet();
}

function startUpdate() {
  if (!UPD.kind) return;
  if (!IS_NATIVE) {
    toast('浏览器预览不支持下载更新，安装版可用', 'bell');
    return;
  }
  UPD.phase = 'download';
  UPD.pct = 0;
  renderUpdateSheet();
  const urls = (UPD.urls && UPD.urls.length) ? UPD.urls : mirrorUrls(UPD.url);
  try {
    if (UPD.kind === 'web') NATIVE.updateDownloadWeb(JSON.stringify(urls), UPD.build);
    else NATIVE.updateDownloadApk(JSON.stringify(urls), UPD.latest);
  } catch (e) {
    handleResult(UPD.kind, false, '调用下载接口失败');
  }
}

function handleResult(kind, ok, msg) {
  if (kind === 'install') {
    if (UPD.phase === 'ready') UPD.err = ok ? '' : (msg || '安装失败');
    if (!ok) toast('无法打开安装器：' + (msg || '未知原因'), 'bell');
    return;
  }
  if (!ok) {
    UPD.phase = 'error';
    UPD.err = msg || '下载失败';
    if (sheetOpen() && $('#updBody')) renderUpdateSheet();
    else toast('更新失败：' + UPD.err, 'bell');
    return;
  }
  UPD.phase = 'ready';
  UPD.pct = 100;
  if (sheetOpen() && $('#updBody')) renderUpdateSheet();
  toast(kind === 'web' ? '资源已更新，重启后生效' : '安装包已下载', 'check');
}

function installUpdate() {
  if (!IS_NATIVE) return;
  let r = 'ok';
  try { r = NATIVE.updateInstall(); } catch (e) { r = 'no-file'; }
  if (r === 'need-permission') {
    try { NATIVE.openInstallSettings(); } catch (e) { }
    toast('请允许「安装未知应用」，返回后再点安装', 'bell');
    return;
  }
  if (r === 'no-file') toast('安装包不存在，请重新下载', 'bell');
}

function applyWebUpdate() {
  if (IS_NATIVE && NATIVE.reloadPage) NATIVE.reloadPage();
  else location.reload();
}

/** 启动后延迟几秒静默查一次，6 小时内不重复；失败或没网都不打扰用户。 */
function maybeAutoCheckUpdate() {
  if (!IS_NATIVE) return;
  if (state.settings.autoUpdate === false) return;
  const last = Number(state.settings.lastUpdateAt) || 0;
  if (Date.now() - last < UPDATE_GAP) return;
  setTimeout(() => {
    if (document.hidden) return;
    const last = Number(state.settings.lastUpdateAt) || 0;
    if (Date.now() - last < UPDATE_GAP) return;
    checkUpdate(true);
  }, 4000);
}

window.__onUpdateCheck = function (text, err, source) { handleCheck(text, err, source); };
window.__onUpdateProgress = function (kind, pct) {
  if (kind !== UPD.kind) return;
  UPD.pct = clamp(Number(pct) || 0, 0, 100);
  if (sheetOpen() && $('#updBody')) renderUpdateSheet();
};
window.__onUpdateResult = function (kind, ok, msg) { handleResult(kind, ok, msg); };

/* ---------- 更新面板 ---------- */

function openUpdateSheet() {
  UPD.err = '';
  if (UPD.kind) { state.settings.updateSeen = UPD.latest; save(); }
  openSheet({
    title: '软件更新',
    body: `<div id="updBody">${updateBodyHtml()}</div>`,
    footer: updateFooterHtml(),
  });
}

/** 换个更新源：给网络受限的用户留一条自己填地址的出路。 */
function openUpdateSource() {
  const cur = String(state.settings.updateSource || '');
  const def = UPDATE_SOURCES
    .map((u, i) => `<div class="src-line"><b>${i + 1}</b><span>${esc(u)}</span></div>`)
    .join('');
  openSheet({
    title: '换个更新地址',
    body: `
      <div class="help-note" style="margin-top:4px">
        更新信息存在 GitHub 上，有些网络连不进去。如果你有能打开的地址，填在下面就能用。
      </div>
      <div class="section-label">自定义地址</div>
      <input class="input" id="upd-src" placeholder="https://你的域名/update.json" value="${esc(cur)}">
      <div class="tiny muted" style="margin-top:8px;line-height:1.7">
        留空表示只用内置地址。
      </div>
      <details class="src-fold">
        <summary>查看内置地址（${UPDATE_SOURCES.length} 个）</summary>
        ${def}
      </details>
      <div class="rows" style="margin-top:14px">
        <div class="row" data-act="upd-clear-src">
          <div class="ri" style="background:#F2F4F7;color:var(--ink-2)">${ic('swap', 17)}</div>
          <div class="rc"><div class="t">恢复默认</div><div class="s">清掉自定义地址</div></div>
          ${ic('right', 15)}
        </div>
      </div>`,
    footer: `<button class="btn ghost" data-close>取消</button><button class="btn" data-act="upd-save-src">保存并重试</button>`,
  });
}

function saveUpdateSource() {
  const el = $('#upd-src');
  const v = el ? String(el.value || '').trim() : '';
  if (v && !/^https?:\/\//i.test(v)) {
    toast('地址要以 http:// 或 https:// 开头', 'bell');
    return;
  }
  state.settings.updateSource = v;
  save();
  closeSheet();
  setTimeout(() => checkUpdate(false), 150);
}

function renderUpdateSheet() {
  const body = $('#updBody');
  if (!body) return;
  body.innerHTML = updateBodyHtml();
  const foot = $('#sheetFooter');
  if (foot) {
    foot.innerHTML = updateFooterHtml();
    foot.querySelectorAll('[data-close]').forEach(b => { b.onclick = closeSheet; });
  }
}

/** 简短时间：今天只说时分，其他日子带月日。 */
function fmtShortTime(ts) {
  const d = new Date(Number(ts) || 0);
  if (!d.getTime()) return '';
  const pad = n => String(n).padStart(2, '0');
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const t0 = new Date();
  const sameDay = d.getFullYear() === t0.getFullYear()
    && d.getMonth() === t0.getMonth() && d.getDate() === t0.getDate();
  return sameDay ? `今天 ${hm}` : `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${hm}`;
}

function sizeText(byte) {
  if (!byte || byte < 1024) return '';
  if (byte < 1024 * 1024) return ` · ${Math.round(byte / 1024)} KB`;
  return ` · ${(byte / 1024 / 1024).toFixed(1)} MB`;
}

function updateBodyHtml() {
  const local = localAppInfo();

  if (UPD.phase === 'check') {
    return `<div class="upd-wait">
      <div class="upd-spin"></div>
      <div class="upd-title">正在检查更新</div>
      <div class="upd-sub">马上就好</div>
    </div>`;
  }

  if (UPD.phase === 'error') {
    return `<div class="upd-wait">
      <div class="upd-mark err">!</div>
      <div class="upd-title">检查失败</div>
      <div class="upd-sub">${esc(UPD.err || '网络不可用')}</div>
    </div>
    <div class="help-note">
      课表和课酬都存在本机，<b>检查失败不会影响使用</b>。
    </div>
    <div class="upd-alt" data-act="upd-source">换了网络还是不行？点这里换一个更新地址</div>`;
  }

  if (UPD.phase === 'uptodate') {
    const rc = Number(UPD.remoteCode) || 0;
    const lc = Number(local.versionCode) || 0;
    // rc < lc：拿到的清单比本机还旧，典型是 CDN 缓存没刷新，不是真的「最新」
    const stale = rc > 0 && lc > 0 && rc < lc;
    return `<div class="upd-wait">
      <div class="upd-mark ok">${ic('check', 26)}</div>
      <div class="upd-title">已是最新版本</div>
      <div class="upd-sub">当前 v${esc(local.versionName)}</div>
    </div>
    ${stale ? `<div class="upd-alt" data-act="upd-source">没查到新版本？可能是网络缓存，点这里换个更新地址</div>` : ''}`;
  }

  const notes = UPD.notes.length ? UPD.notes : ['优化使用体验，修复已知问题'];

  let extra = '';
  if (UPD.phase === 'download') {
    extra = `<div class="upd-bar"><i style="width:${UPD.pct}%"></i></div>
      <div class="upd-pct">${UPD.pct}%${UPD.size ? ` · 共 ${Math.round(UPD.size / 1024)} KB` : ''}</div>`;
  } else if (UPD.phase === 'ready') {
    extra = UPD.kind === 'web'
      ? `<div class="help-note" style="margin-top:14px">已经准备好，重启一下就生效。</div>`
      : `<div class="help-note" style="margin-top:14px">下载好了。点「安装」后系统会弹窗确认，覆盖安装不会清除课表数据。</div>`;
  }

  return `
    <div class="upd-hero">
      <span class="upd-badge ${UPD.kind === 'apk' ? 'apk' : ''}">${UPD.kind === 'apk' ? '新版本' : '界面更新'}</span>
      ${UPD.kind === 'apk' ? `<div class="upd-ver">v${esc(UPD.latest)}</div>` : ''}
      <div class="upd-from">当前 v${esc(local.versionName)}</div>
    </div>
    <ul class="upd-notes">${notes.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    ${extra}`;
}

function updateFooterHtml() {
  switch (UPD.phase) {
    case 'check':
      return `<button class="btn ghost" data-close>取消</button>`;
    case 'error':
      return `<button class="btn" data-act="upd-retry">重试</button>`
        + `<button class="btn ghost" data-close>关闭</button>`;
    case 'uptodate':
      return `<button class="btn" data-act="upd-retry">重新检查</button>`
        + `<button class="btn ghost" data-close>关闭</button>`;
    case 'download':
      return `<button class="btn" disabled>下载中 ${UPD.pct}%</button>`;
    case 'ready':
      return UPD.kind === 'web'
        ? `<button class="btn" data-act="upd-reload">重启生效</button><button class="btn ghost" data-act="upd-later">稍后</button>`
        : `<button class="btn" data-act="upd-install">安装</button><button class="btn ghost" data-act="upd-later">稍后</button>`;
    default:
      if (!UPD.kind) return `<button class="btn ghost" data-close>关闭</button>`;
      return `<button class="btn" data-act="upd-start">立即更新${sizeText(UPD.size)}</button><button class="btn ghost" data-close>稍后</button>`;
  }
}

/* 帮助里的一键跳转 */
function helpGo(go) {
  switch (go) {
    case 'types': openTypesSheet(); break;
    case 'calc': openCalcRules(); break;
    case 'periods': openPeriodsSheet(); break;
    case 'term': openTermSheet(); break;
    case 'remind': openRemindSheet(); break;
    case 'makeup': openMakeupRuleSheet(); break;
    case 'holidays': openHolidaysSheet(); break;
    case 'io': openScheduleIO('export'); break;
    case 'backup': exportData(); break;
    case 'sync': openSyncSheet(); break;
    case 'clear': openClearSheet(); break;
    case 'master': schedMode = 'master'; switchTab('schedule'); break;
    case 'schedule': schedMode = 'day'; switchTab('schedule'); break;
    case 'pay': switchTab('pay'); break;
    default: break;
  }
}

/* ============================================================
   课程编辑
   ============================================================ */
let draft = null;

function captureLessonForm() {
  if (!draft) return;
  const k = $('#f-klass'); if (k) draft.klass = k.value;
  const n = $('#f-note'); if (n) draft.note = n.value;
  const s = $('#f-subject'); if (s) draft.subject = s.value;
  const d = $('#f-dur');
  if (d) {
    const v = Number(d.value) || periodMinutes(draft.period);
    draft.dur = v;
    draft.durAuto = v === periodMinutes(draft.period);
  }
  const st = $('#f-students'); if (st) draft.students = Number(st.value) || 1;
  const ex = $('#f-extend'); if (ex) draft.extend = clamp(Number(ex.value) || 0, 0, 300);
}

function openLessonSheet(opt = {}) {
  const existing = opt.id ? state.lessons.find(l => l.id === opt.id) : null;
  const last = state.settings.lastLesson || {};
  const period = opt.period != null ? Number(opt.period)
    : (opt.date ? nextFreePeriod(opt.date) : nextFreePeriod(todayYmd()));

  if (existing) {
    draft = { ...existing, repeat: false };
    draft.durAuto = isDurAuto(draft);
    if (!draft.dur) { draft.dur = periodMinutes(draft.period); draft.durAuto = true; }
  } else {
    // 时长/人数/延长沿用上次录入的设置；时长若上次手动改过就不再跟随作息
    const keepDur = last.durAuto === false && Number(last.dur) > 0;
    const pick = id => (state.types.some(t => t.id === id) ? id : '');
    draft = {
      id: null,
      date: opt.date || ymd(viewDate) || todayYmd(),
      period,
      typeId: pick(opt.typeId) || pick(last.typeId) || (state.types[0] && state.types[0].id),
      klass: '',
      subject: state.teacher.subject || '',
      note: '',
      dur: keepDur ? Number(last.dur) : periodMinutes(period),
      durAuto: !keepDur,
      students: Number(last.students) || 1,
      extend: Number(last.extend) || 0,
      weekMode: 'all',
      repeat: false,
      status: 'normal',
    };
  }
  renderLessonSheet();
}

function nextFreePeriod(dateStr) {
  const used = new Set(lessonsOfDay(dateStr).map(l => l.period));
  const p = state.periods.find(x => !used.has(x.no));
  return p ? p.no : 1;
}

function renderLessonSheet() {
  const editing = !!draft.id;
  const typ = getType(draft.typeId);
  const pv = lessonPreview({ ...draft });
  const taken = {};
  lessonsOfDay(draft.date).forEach(l => { if (l.id !== draft.id) taken[l.period] = l; });

  const periodCells = state.periods.map(p => `
    <button class="period-cell ${p.no === draft.period ? 'on' : ''} ${taken[p.no] ? 'taken' : ''}"
      data-act="lesson-pick-period" data-period="${p.no}">
      ${esc(p.short)}<small>${taken[p.no] ? '有课' : p.start}</small>
    </button>`).join('');

  const typeChips = state.types.filter(t => t.enabled !== false).map(t => {
    const on = t.id === draft.typeId;
    return `<button class="period-cell ${on ? 'on' : ''}" data-act="lesson-pick-type" data-type="${t.id}"
      style="${on ? `background:${t.color};border-color:${t.color}` : ''}">
      ${esc(t.name)}<small>${money(t.price)}/${t.unit === 'hour' ? '时' : t.unit === 'student' ? '人' : '节'}</small>
    </button>`;
  }).join('');

  const pMin = periodMinutes(draft.period);
  const curPer = getPeriod(draft.period);
  const durAuto = draft.durAuto !== false;

  // 时长说明：自习等按节计费的课看不到时长输入，就在这里显示它跟随作息的结果
  const durLine = `
    <div class="hstack" style="gap:8px;margin-top:8px;flex-wrap:wrap">
      <span class="tiny muted">${esc(curPer.name)} ${curPer.start}–${curPer.end} · ${pMin} 分钟${durAuto ? ' · 时长跟随作息' : ` · 时长手动 ${Number(draft.dur) || pMin} 分钟`}</span>
      ${durAuto ? '' : `<button class="btn ghost sm" data-act="lesson-dur-auto">跟随作息</button>`}
    </div>`;

  const extra = typ.unit === 'hour' ? `
    <div class="field">
      <div class="field-label">单次时长 <span class="hint">按 ¥${typ.price}/小时 计 · ${durAuto ? '跟随作息' : '已手动指定'}</span></div>
      <div class="input-suffix"><input class="input num" id="f-dur" type="number" inputmode="numeric" min="1" max="600" step="5" value="${Number(draft.dur) || pMin}"><span class="sfx">分钟</span></div>
    </div>` : typ.unit === 'student' ? `
    <div class="field">
      <div class="field-label">学生人数 <span class="hint">按 ¥${typ.price}/人 计</span></div>
      <div class="input-suffix"><input class="input num" id="f-students" type="number" inputmode="numeric" value="${draft.students || 1}"><span class="sfx">人</span></div>
    </div>` : '';

  const et = extendType();
  const extVal = Number(draft.extend) || 0;
  const extUnit = et.unit === 'hour' ? '小时' : et.unit === 'student' ? '人·节' : '节';

  // —— 单双周 ——
  const wm = draft.weekMode || 'all';
  const wPar = weekParity(draft.date);
  const wMismatch = (wm === 'odd' || wm === 'even') && wPar !== wm;
  const fixedDate = wMismatch ? alignDateToParity(draft.date, wm) : '';
  const repDates = draft.repeat ? repeatDates(wMismatch ? fixedDate : draft.date, wm) : [];

  const weekField = `
    <div class="field">
      <div class="field-label">上课周次 <span class="hint">${fmtMD(draft.date)} 是第${weekIndexOf(draft.date)}周（${parityLabel(wPar)}）</span></div>
      <div class="segmented">
        ${[['all', '每周'], ['odd', '单周'], ['even', '双周']].map(([v, label]) =>
          `<button class="${wm === v ? 'on' : ''}" data-act="lesson-pick-week" data-w="${v}">${label}</button>`
        ).join('')}
      </div>
      ${wMismatch ? `<div class="notice-inline">
        ${ic('info', 14)}
        <span>日期在${parityLabel(wPar)}，与${parityLabel(wm)}不符，保存时自动挪到 ${fmtMD(fixedDate)}</span>
        <button class="btn ghost sm" data-act="lesson-fix-parity">调整</button>
      </div>` : ''}
      <div class="row" style="margin-top:10px;background:#F7F9FC;border-radius:14px;padding:12px" data-act="lesson-toggle-repeat">
        <div class="rc">
          <div class="t" style="font-size:13.5px">${editing ? '同步到本学期' : '重复到学期末'}</div>
          <div class="s">${draft.repeat
            ? `${editing ? '再生成' : '生成'} ${editing ? Math.max(0, repDates.filter(ds => ds !== draft.date).length) : repDates.length} 节课 · 至 ${fmtMD(termEndYmd())}`
            : `按${parityLabel(wm)}排课，至 ${fmtMD(termEndYmd())}`}</div>
        </div>
        <div class="switch ${draft.repeat ? 'on' : ''}"></div>
      </div>
    </div>`;

  const extendField = `
    <div class="field">
      <div class="field-label">延长课时 <span class="hint">超出部分按「${esc(et.name)}」${money(et.price)}/${extUnit} 计</span></div>
      <div class="segmented">
        ${[0, 10, 15, 20, 30].map(n =>
          `<button class="${extVal === n ? 'on' : ''}" data-act="lesson-pick-extend" data-n="${n}">${n ? n + ' 分' : '不延长'}</button>`
        ).join('')}
      </div>
      <div class="input-suffix" style="margin-top:9px">
        <input class="input num" id="f-extend" type="number" inputmode="numeric" min="0" max="300" step="5" value="${extVal}">
        <span class="sfx">分钟</span>
      </div>
    </div>`;

  openSheet({
    title: editing ? '编辑课程' : '记一节课',
    body: `
      <div class="field">
        <div class="field-label">上课日期</div>
        <input class="input" id="f-date" type="date" value="${draft.date}">
      </div>
      <div class="field">
        <div class="field-label">节次 <span class="hint">点击选择</span></div>
        <div class="period-grid">${periodCells}</div>
        ${durLine}
      </div>
      <div class="field">
        <div class="field-label">课程类型 <span class="hint">决定单价</span></div>
        <div class="period-grid">${typeChips}</div>
      </div>
      <div class="field">
        <div class="field-label">班级 / 学生</div>
        <input class="input" id="f-klass" value="${esc(draft.klass)}" placeholder="如：高一(3)班">
      </div>
      <div class="input-row">
        <div class="field" style="flex:1">
          <div class="field-label">科目</div>
          <input class="input" id="f-subject" value="${esc(draft.subject)}" placeholder="数学">
        </div>
      </div>
      ${extra}
      ${weekField}
      ${extendField}
      <div class="field">
        <div class="field-label">状态</div>
        <div class="segmented">
          <button class="${draft.status === 'normal' ? 'on' : ''}" data-act="lesson-pick-status" data-status="normal">正常</button>
          <button class="${draft.status === 'leave' ? 'on' : ''}" data-act="lesson-pick-status" data-status="leave">请假</button>
          <button class="${draft.status === 'canceled' ? 'on' : ''}" data-act="lesson-pick-status" data-status="canceled">取消</button>
        </div>
      </div>
      <div class="field">
        <div class="field-label">备注</div>
        <input class="input" id="f-note" value="${esc(draft.note || '')}" placeholder="选填，如：单元测验">
      </div>
      <div class="breakdown" style="margin-bottom:4px">
        <div class="bd-line"><span class="k">计费预览</span><span class="v" id="feePreview">${money(pv.total)}</span></div>
        <div class="bd-line"><span class="k sub" id="feePreviewSub">${esc(pv.sub)}</span><span class="v sub"></span></div>
      </div>
    `,
    footer: `${editing ? `<button class="btn danger" style="flex:0 0 58px" data-act="lesson-del">${ic('trash', 18)}</button>` : ''}
      <button class="btn" data-act="lesson-save">${editing ? '保存修改' : '添加课程'}</button>`,
  });
}

function saveLesson() {
  captureLessonForm();
  if (!draft.klass.trim()) { toast('请填写班级名称'); return; }
  const wm = draft.weekMode || 'all';

  // 单双周与日期对齐：单/双周课必须落在对应周次
  if (wm !== 'all' && weekParity(draft.date) !== wm) {
    const fixed = alignDateToParity(draft.date, wm);
    if (!state.lessons.some(l => l.date === fixed && l.period === draft.period && l.id !== draft.id)) {
      draft.date = fixed;
      toast(`已对齐到最近的${parityLabel(wm)}`);
    } else {
      toast(`${fmtMD(fixed)} 该节已有课程`);
      return;
    }
  }

  const conflict = state.lessons.find(l => l.date === draft.date && l.period === draft.period && l.id !== draft.id);
  if (conflict) { toast('该时间已有课程，可用「调课」处理'); return; }

  if (draft.id) {
    const l = state.lessons.find(x => x.id === draft.id);
    Object.assign(l, {
      date: draft.date, period: draft.period, typeId: draft.typeId,
      klass: draft.klass.trim(), subject: draft.subject, note: draft.note,
      dur: draft.dur, durAuto: draft.durAuto !== false, students: draft.students, status: draft.status,
      extend: Number(draft.extend) || 0,
      weekMode: wm,
    });
    if (draft.repeat) {
      const r = addRepeatLessons(draft, wm);
      toast(`已保存，另生成 ${r.added} 节课${r.skipped > 1 ? `，跳过 ${r.skipped - 1} 个已有课时` : ''}`, 'check');
    } else {
      toast('已保存修改', 'check');
    }
  } else if (draft.repeat) {
    const r = addRepeatLessons(draft, wm);
    if (!r.total) { toast('该日期已超出学期范围，请调整学期设置'); return; }
    toast(r.skipped ? `已添加 ${r.added} 节，跳过 ${r.skipped} 个已有课时` : `已按${parityLabel(wm)}添加 ${r.added} 节课`, 'check');
  } else {
    state.lessons.push({
      id: uid(), date: draft.date, period: draft.period, typeId: draft.typeId,
      klass: draft.klass.trim(), subject: draft.subject, note: draft.note,
      dur: draft.dur, durAuto: draft.durAuto !== false, students: draft.students, status: draft.status,
      extend: Number(draft.extend) || 0,
      weekMode: wm,
    });
    toast('已添加课程', 'check');
  }

  // 记住这次的录入偏好，下次「记一节课」直接带出
  state.settings.lastLesson = {
    typeId: draft.typeId,
    dur: Number(draft.dur) || periodMinutes(draft.period),
    durAuto: draft.durAuto !== false,
    students: Number(draft.students) || 1,
    extend: Number(draft.extend) || 0,
  };
  save();
  closeSheet();
  render();
}

/** 按周次把当前草稿展开成整学期的课程 */
function addRepeatLessons(src, wm) {
  const dates = repeatDates(src.date, wm);
  let added = 0, skipped = 0;
  dates.forEach(ds => {
    if (state.lessons.some(l => l.date === ds && l.period === src.period)) { skipped++; return; }
    state.lessons.push({
      id: uid(), date: ds, period: src.period, typeId: src.typeId,
      klass: src.klass.trim(), subject: src.subject, note: src.note,
      dur: src.dur, durAuto: src.durAuto !== false, students: src.students, status: src.status,
      extend: Number(src.extend) || 0,
      weekMode: wm,
      createdAt: Date.now(),
    });
    added++;
  });
  return { added, skipped, total: dates.length };
}

/* ---- 课程操作菜单 ---- */
function openLessonMenu(id) {
  const l = state.lessons.find(x => x.id === id);
  if (!l) return;
  const typ = getType(l.typeId);
  const c = calcLesson(l);
  const ex = calcExtend(l);
  const total = lessonTotal(l);
  const tm = periodTime(l.period);
  const endD = lessonEnd(l);
  const tmEnd = `${pad2(endD.getHours())}:${pad2(endD.getMinutes())}`;

  openSheet({
    title: '课程详情',
    body: `
      <div class="card flat" style="margin-bottom:14px">
        <div class="hstack" style="align-items:flex-start">
          <div style="width:4px;height:38px;border-radius:3px;background:${typ.color}"></div>
          <div style="flex:1;min-width:0">
            <div style="font-size:17px;font-weight:750;letter-spacing:-.3px">${esc(l.klass || '未命名')}</div>
            <div class="tiny muted" style="margin-top:3px">${fmtMD(l.date)} ${weekdayCN(l.date)} · ${esc(tm.name)} ${tm.start}–${tmEnd}</div>
          </div>
          <div style="text-align:right">
            <div class="num" style="font-size:19px;font-weight:800;color:var(--brand)">${money(total)}</div>
            <div class="tiny muted">${ex ? `含延长 ${money(ex.subtotal)}` : '课时费'}</div>
          </div>
        </div>
        <div class="hstack" style="gap:6px;margin-top:12px;flex-wrap:wrap">
          <span class="tag" style="background:${typ.color}15;color:${typ.color}">${esc(typ.name)}</span>
          <span class="tag gray">${esc(l.subject || '—')}</span>
          ${(l.weekMode === 'odd' || l.weekMode === 'even') ? `<span class="tag wk ${l.weekMode}">${parityLabel(l.weekMode)} · 第${weekIndexOf(l.date)}周</span>` : ''}
          ${ex ? `<span class="tag mint">延长 ${ex.minutes} 分 · 按${esc(ex.type.name)}计</span>` : ''}
          ${l.status === 'swapped' ? '<span class="tag amber">已调课</span>' : ''}
          ${l.status === 'leave' ? '<span class="tag rose">请假</span>' : ''}
          ${l.status === 'canceled' ? '<span class="tag rose">已取消</span>' : ''}
        </div>
        ${l.note ? `<div class="tiny muted" style="margin-top:10px">备注：${esc(l.note)}</div>` : ''}
      </div>
      <div class="rows" style="margin-bottom:12px">
        <div class="row" data-act="lesson-edit" data-id="${l.id}">
          <div class="ri" style="background:var(--brand-soft);color:var(--brand)">${ic('edit', 17)}</div>
          <div class="rc"><div class="t">编辑课程</div></div>${ic('right', 15)}
        </div>
        <div class="row" data-act="lesson-swap" data-id="${l.id}">
          <div class="ri" style="background:var(--mint-soft);color:var(--mint)">${ic('swap', 17)}</div>
          <div class="rc"><div class="t">调课 / 互换</div><div class="s">移到空档，或与另一节课对调</div></div>${ic('right', 15)}
        </div>
        <div class="row" data-act="lesson-leave" data-id="${l.id}">
          <div class="ri" style="background:var(--amber-soft);color:#B26A00">${ic('clock', 17)}</div>
          <div class="rc"><div class="t">${l.status === 'leave' ? '取消请假标记' : '标记请假'}</div><div class="s">请假不计入课时费</div></div>${ic('right', 15)}
        </div>
        <div class="row" data-act="lesson-del" data-id="${l.id}">
          <div class="ri" style="background:var(--rose-soft);color:var(--rose)">${ic('trash', 17)}</div>
          <div class="rc"><div class="t" style="color:var(--rose)">删除这节课</div></div>${ic('right', 15)}
        </div>
      </div>
    `,
    footer: `<button class="btn ghost" data-close>关闭</button>`,
  });
}

/* ---- 课时费构成 ---- */
function openBreakdown(id) {
  const l = state.lessons.find(x => x.id === id);
  if (!l) return;
  const c = calcLesson(l);
  const typ = c.type;
  const ym = l.date.slice(0, 7);
  const m = calcMonth(ym);
  const row = m.rows.find(r => r.lesson.id === id);
  const ex = row ? row.extend : calcExtend(l);

  openSheet({
    title: '课时费计算过程',
    body: `
      <div class="breakdown" style="margin-bottom:14px">
        <div class="bd-line"><span class="k">课程</span><span class="v">${esc(l.klass)} · ${esc(typ.name)}</span></div>
        <div class="bd-line"><span class="k">时间</span><span class="v">${fmtMD(l.date)} ${esc(periodTime(l.period).name)}</span></div>
        <div class="divider" style="margin:8px 0"></div>
        <div class="bd-line"><span class="k">计价方式</span><span class="v">${typ.unit === 'hour' ? '按时长' : typ.unit === 'student' ? '按人数' : '按节次'}</span></div>
        <div class="bd-line"><span class="k">单价 × 数量</span><span class="v">${priceExpr(row ? row.unitPrice : c.unitPrice, c.qty, c.unitLabel, l.dur)}</span></div>
        <div class="bd-line"><span class="k">小计</span><span class="v">${money(row ? row.base : round2((row ? row.unitPrice : c.unitPrice) * (c.qtyRaw != null ? c.qtyRaw : c.qty)))}</span></div>
        ${c.classFactor !== 1 ? `<div class="bd-line"><span class="k">班级系数 <span class="sub">${esc(c.classKey)}</span></span><span class="v">× ${c.classFactor}</span></div>` : ''}
        ${row && row.extraLabel ? `<div class="bd-line"><span class="k">加成</span><span class="v">${esc(row.extraLabel)}</span></div>` : ''}
        ${row && row.meta ? `<div class="bd-line"><span class="k">档位</span><span class="v">${esc(row.meta)}</span></div>` : ''}
        ${ex ? `
        <div class="divider" style="margin:8px 0"></div>
        <div class="bd-line"><span class="k">延长课时</span><span class="v">${ex.minutes} 分钟</span></div>
        <div class="bd-line"><span class="k">按「${esc(ex.type.name)}」计价</span><span class="v">${esc(ex.expr)}</span></div>
        ${ex.classFactor !== 1 ? `<div class="bd-line"><span class="k">班级系数 <span class="sub">${esc(ex.classKey)}</span></span><span class="v">× ${ex.classFactor}</span></div>` : ''}
        <div class="bd-line"><span class="k">延长部分</span><span class="v">${money(ex.subtotal)}</span></div>
        ` : ''}
        <div class="bd-line total"><span class="k">实得课时费</span><span class="v">${money(row ? row.subtotal : lessonTotal(l))}</span></div>
      </div>
      <div class="info-banner">
        ${ic('info', 16)}
        <div>当前计费方案为「${schemeName(state.settings.scheme)}」${state.settings.useClassFactor ? '，并启用班级系数加成' : ''}。可在「我的 → 计费公式」中调整。</div>
      </div>
    `,
    footer: `<button class="btn ghost" data-close>知道了</button>`,
  });
}

/* ============================================================
   批量导入
   ============================================================ */
let draftImport = null;
let draftImportExpand = true;

const TYPE_ALIASES = {
  night: ['晚自习', '夜自习', '晚修', '晚辅'],
  morning: ['早读', '晨读', '早自习', '早课'],
  self: ['自习', '自修', '自学', '自习课'],
  tutor: ['辅导', '一对一', '1对1', '补习', '培优', '小班'],
  regular: ['正课', '常规课', '正常课', '授课', '上课', '新课', '讲评'],
};

function matchTypeToken(s) {
  const v = s.replace(/\s/g, '');
  for (const [id, words] of Object.entries(TYPE_ALIASES)) {
    if (words.some(w => v === w || v.includes(w))) return id;
  }
  return null;
}

function matchDateToken(s) {
  let m;
  if ((m = s.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/))) {
    return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  }
  if ((m = s.match(/^(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/))) {
    return `${new Date().getFullYear()}-${pad2(m[1])}-${pad2(m[2])}`;
  }
  const wd = s.match(/(?:周|星期|礼拜)([一二三四五六日天])/);
  if (wd) {
    const map = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6 };
    const base = startOfWeek(viewDate || new Date());
    return ymd(addDays(base, map[wd[1]]));
  }
  return null;
}

function matchPeriodToken(s) {
  const v = s.replace(/\s/g, '');
  if (/晚自习2|晚2|晚二/.test(v)) return 11;
  if (/晚自习|夜自习|晚修|晚辅|晚1|晚一/.test(v)) return 10;
  if (/早读|晨读/.test(v)) return 0;
  const m = v.match(/第?(\d{1,2})(?:节|课)/) || v.match(/^(\d{1,2})$/);
  if (m) {
    const n = Number(m[1]);
    if (state.periods.some(p => p.no === n)) return n;
  }
  return null;
}

function matchTimeToken(s) {
  const m = s.match(/(\d{1,2})[:：](\d{2})/);
  if (!m) return null;
  const t = Number(m[1]) * 60 + Number(m[2]);
  let best = null, bestDiff = Infinity;
  state.periods.forEach(p => {
    const [h, mi] = p.start.split(':').map(Number);
    const ps = h * 60 + mi;
    const d = Math.abs(ps - t);
    if (d < bestDiff) { bestDiff = d; best = p.no; }
  });
  return bestDiff <= 25 ? best : null;
}

function splitCells(line) {
  if (line.includes('\t')) return line.split('\t').map(s => s.trim());
  if (/[,，;；|]/.test(line)) return line.split(/[,，;；|]/).map(s => s.trim());
  return line.split(/\s{1,}/).map(s => s.trim());
}

function matchWeekToken(s) {
  const v = s.replace(/[\s()（）【】\[\]]/g, '').toLowerCase();
  if (/^(单|单周|单数周|odd)$/.test(v)) return 'odd';
  if (/^(双|双周|双数周|even)$/.test(v)) return 'even';
  if (/^(每周|全周|每周课|all)$/.test(v)) return 'all';
  return null;
}

function parseImportText(text) {
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean).filter(s => !s.startsWith('#'));
  const rows = [], errors = [];
  lines.forEach((line, idx) => {
    // 跳过表头：Excel 里表头不一定在第一行（上面常有「2026 秋季课表」这种标题），
    // 所以按内容判断而不是按行号——含表头词又没有日期/时间的行直接忽略。
    if (/日期|星期|节次|班级|课程|时间/.test(line)
      && !/\d{1,2}[:：]\d{2}/.test(line)
      && !/\d{1,2}[-/月]\d{1,2}/.test(line)) return;

    const cells = splitCells(line).filter(c => c !== '');
    let date = null, period = null, typeId = null, klass = '', timeHit = null, noteParts = [], weekMode = null;

    cells.forEach(c => {
      if (!date) { const d = matchDateToken(c); if (d) { date = d; return; } }
      if (!weekMode) { const w = matchWeekToken(c); if (w) { weekMode = w; return; } }
      if (!typeId) { const t = matchTypeToken(c); if (t) { typeId = t; return; } }
      if (period === null) {
        const tm = matchTimeToken(c);
        if (tm !== null && /[:：]/.test(c)) { timeHit = tm; period = tm; return; }
        const p = matchPeriodToken(c);
        if (p !== null) { period = p; return; }
      }
      if (!klass && /班|级|组|队/.test(c)) { klass = c; return; }
      noteParts.push(c);
    });

    if (!klass && noteParts.length) klass = noteParts.shift();
    if (!date) {
      // 表头上方常有一行「2026 秋季课表」这类标题：没有任何日期/节次/类型信息，
      // 且出现在第一节课之前，就当标题忽略；其余仍按错误报出来。
      if (!rows.length && period === null && !typeId) return;
      errors.push(line);
      return;
    }

    // 单双周与日期不一致时，挪到最近的同星期几
    let aligned = false;
    if (weekMode === 'odd' || weekMode === 'even') {
      const fixed = alignDateToParity(date, weekMode);
      if (fixed !== date) { date = fixed; aligned = true; }
    } else if (weekMode === null) {
      weekMode = 'all';
    }

    if (period === null) period = typeId === 'morning' ? 0 : typeId === 'night' ? 10 : 1;
    if (!typeId) typeId = period === 0 ? 'morning' : (period >= 10 ? 'night' : (klass && /自习/.test(klass) ? 'self' : 'regular'));
    if (!state.types.some(t => t.id === typeId)) typeId = state.types[0].id;

    rows.push({
      date, period, typeId,
      klass: klass || '未命名班级',
      subject: state.teacher.subject || '',
      note: noteParts.join(' ').slice(0, 40),
      dur: periodMinutes(period),
      durAuto: true,
      students: 1,
      weekMode,
      aligned,
    });
  });
  return { rows, errors };
}

function openImportSheet() {
  draftImport = null;
  const sample = `周一 第1节 高一(3)班 正课
周一 第3节 高一(5)班 正课
周二 第2节 单周 高二(2)班 辅导
周二 第10节 高一(3)班 晚自习
周三 早读 高一(3)班 早读
周三 第6节 高二(4)班 正课
周四 第8节 双周 高一(5)班 正课`;
  openSheet({
    title: '批量导入课表',
    body: `
      <div class="info-banner" style="margin-bottom:14px">
        ${ic('info', 16)}
        <div>每行一节课，用<b>空格 / 逗号 / 制表符</b>分隔。支持 <b>2026-11-09</b>、<b>11-09</b>、<b>周一</b>；节次写 <b>第3节</b>、<b>3</b> 或 <b>08:45</b>；类型写 正课 / 自习 / 早读 / 晚自习 / 辅导，不写默认正课；周次写 <b>单周</b> / <b>双周</b>，不写默认每周。</div>
      </div>
      <div class="field">
        <div class="field-label">粘贴内容 <span class="hint">也可点「读文件」直接选 .xlsx / .csv</span></div>
        <textarea class="input" id="impText" rows="9" placeholder="${esc(sample)}"></textarea>
      </div>
      <div class="hstack" style="gap:8px;flex-wrap:wrap">
        <button class="btn ghost sm" data-act="imp-file">${ic('upload', 14)} 读 Excel / CSV</button>
        <button class="btn outline sm" data-act="imp-sample">填入示例</button>
        <button class="btn ghost sm" data-act="imp-clear">清空</button>
      </div>
      <div class="row" style="margin-top:12px;background:#F7F9FC;border-radius:14px;padding:12px" data-act="imp-toggle-expand">
        <div class="rc">
          <div class="t" style="font-size:13.5px">按单双周展开到学期末</div>
          <div class="s">标了单/双周的行自动排满整学期</div>
        </div>
        <div class="switch ${draftImportExpand ? 'on' : ''}"></div>
      </div>
      <div id="impResult" style="margin-top:14px"></div>
      <div style="height:6px"></div>
    `,
    footer: `<button class="btn ghost" data-close>取消</button>
      <button class="btn" data-act="imp-parse" id="impBtn">解析预览</button>`,
  });
}

function renderImportResult() {
  const box = $('#impResult');
  if (!draftImport) return;
  const { rows, errors, skipped, expanded } = draftImport;
  box.innerHTML = `
    <div class="hstack" style="margin-bottom:10px">
      <span class="tag mint">识别 ${rows.length} 节</span>
      ${expanded ? `<span class="tag violet">${expanded} 条已展开</span>` : ''}
      ${skipped ? `<span class="tag amber">跳过 ${skipped} 条</span>` : ''}
      ${errors.length ? `<span class="tag rose">未识别 ${errors.length} 行</span>` : ''}
    </div>
    ${rows.length ? `<div class="preview-box">${rows.slice(0, 30).map(r => {
      const t = getType(r.typeId);
      const wk = (r.weekMode === 'odd' || r.weekMode === 'even')
        ? `<span style="color:#5A3FD6;font-weight:700">${parityLabel(r.weekMode)}</span> ` : '';
      return `${r.date} ${wk}${periodTime(r.period).name.padEnd(4, ' ')} ${r.klass}  <span style="color:${t.color};font-weight:700">${esc(t.name)}</span>`;
    }).join('<br>')}${rows.length > 30 ? `<br>… 还有 ${rows.length - 30} 条` : ''}</div>` : ''}
    ${rows.some(r => r.aligned) ? '<div class="tiny muted" style="margin-top:8px">单双周与日期不符的行，已对齐到最近的同星期几</div>' : ''}
    ${errors.length ? `<div class="tiny" style="color:var(--rose);margin-top:10px">未识别：${esc(errors.slice(0, 3).join(' / '))}</div>` : ''}
  `;
  const btn = $('#impBtn');
  if (btn) {
    btn.textContent = rows.length ? `确认导入 ${rows.length} 节` : '重新解析';
    btn.dataset.act = rows.length ? 'imp-confirm' : 'imp-parse';
  }
}

function doParseImport() {
  const txt = $('#impText').value;
  if (!txt.trim()) { toast('请先粘贴课表内容'); return; }
  const { rows, errors } = parseImportText(txt);
  let skipped = 0, expanded = 0;
  const out = [];
  const seen = new Set();
  const cap = 400;
  rows.forEach(r => {
    const useExpand = draftImportExpand && (r.weekMode === 'odd' || r.weekMode === 'even');
    const dates = useExpand ? repeatDates(r.date, r.weekMode) : [r.date];
    if (useExpand && dates.length > 1) expanded++;
    dates.forEach(ds => {
      if (out.length >= cap) { skipped++; return; }
      const key = `${ds}#${r.period}`;
      if (seen.has(key)) return;
      if (state.lessons.some(l => l.date === ds && l.period === r.period)) { skipped++; return; }
      seen.add(key);
      out.push({ ...r, date: ds, aligned: ds === r.date ? r.aligned : false });
    });
  });
  draftImport = { rows: out, errors, skipped, expanded };
  renderImportResult();
  if (!rows.length) toast('没有识别到有效课程');
}

function doConfirmImport() {
  if (!draftImport || !draftImport.rows.length) return;
  const rows = draftImport.rows;
  rows.forEach(r => {
    const { aligned, ...rest } = r;
    state.lessons.push({
      id: uid(), ...rest,
      weekMode: rest.weekMode || 'all',
      status: 'normal', createdAt: Date.now(),
    });
  });
  save();
  closeSheet();
  draftImport = null;
  render();
  toast(`成功导入 ${rows.length} 节课`, 'check');
}

/* ============================================================
   调课
   ============================================================ */
let draftSwap = null;

function openSwapPicker(lessonId) {
  if (lessonId) { openSwapTarget(lessonId); return; }
  const t = todayYmd();
  const upcoming = state.lessons
    .filter(l => l.date >= t && l.status !== 'canceled')
    .sort((a, b) => (a.date === b.date ? a.period - b.period : a.date < b.date ? -1 : 1))
    .slice(0, 12);

  openSheet({
    title: '选择要调整的课',
    body: upcoming.length ? `
      <div class="info-banner" style="margin-bottom:12px">${ic('info', 16)}<div>选择一节课，再指定它要挪到的新时间；若目标时间已有课，可一键互换。</div></div>
      ${upcoming.map(l => {
        const typ = getType(l.typeId);
        return `<div class="ledger-item" data-act="lesson-swap" data-id="${l.id}" style="cursor:pointer">
          <div class="t" style="flex:0 0 44px">${fmtMD(l.date).replace('月', '/').replace('日', '')}</div>
          <div class="n">
            <div class="a">${esc(l.klass)} <span class="tag" style="background:${typ.color}15;color:${typ.color}">${esc(typ.name)}</span></div>
            <div class="b">${weekdayCN(l.date)} · ${esc(periodTime(l.period).name)} ${periodTime(l.period).start}</div>
          </div>
          ${ic('right', 15)}
        </div>`;
      }).join('')}
    ` : `<div class="empty">${ic('cal', 40)}<div class="t">近期没有课程</div><div class="s">导入课表后再来调课</div></div>`,
    footer: `<button class="btn ghost" data-close>关闭</button>`,
  });
}

function openSwapTarget(lessonId) {
  const l = state.lessons.find(x => x.id === lessonId);
  if (!l) return;
  draftSwap = { lessonId, date: l.date, period: null };
  renderSwapSheet();
}

function renderSwapSheet() {
  const l = state.lessons.find(x => x.id === draftSwap.lessonId);
  const typ = getType(l.typeId);
  const base = parseYmd(todayYmd());
  const days = Array.from({ length: 14 }, (_, i) => addDays(base, i));
  const target = draftSwap.period === null ? null
    : state.lessons.find(x => x.date === draftSwap.date && x.period === draftSwap.period);

  const dayChips = days.map(d => {
    const ds = ymd(d);
    const n = dayCount(ds);
    return `<button class="day-chip ${ds === draftSwap.date ? 'active' : ''}" style="min-height:56px" data-act="swap-pick-day" data-date="${ds}">
      <span class="wd">${WEEK_SHORT[d.getDay()]}</span>
      <span class="dd">${d.getDate()}</span>
      <span class="dots">${n ? `<span style="font-size:9px;color:var(--ink-3);font-weight:600">${n}节</span>` : ''}</span>
    </button>`;
  }).join('');

  const periodCells = state.periods.map(p => {
    const occ = state.lessons.find(x => x.date === draftSwap.date && x.period === p.no);
    const isOrigin = l.date === draftSwap.date && l.period === p.no;
    const on = draftSwap.period === p.no;
    return `<button class="period-cell ${on ? 'on' : ''} ${occ && !on ? 'taken' : ''}"
      data-act="swap-pick-period" data-period="${p.no}"
      style="${on ? 'background:var(--brand);color:#fff;border-color:var(--brand)' : isOrigin ? 'border-color:var(--brand);color:var(--brand)' : ''}">
      ${esc(p.short)}<small>${isOrigin ? '原位置' : occ ? '有课' : p.start}</small>
    </button>`;
  }).join('');

  let tip = '';
  if (target && target.id !== l.id) {
    const tt = getType(target.typeId);
    tip = `<div class="info-banner warn" style="margin-top:12px">${ic('swap', 16)}
      <div>该时段已有 <b>${esc(target.klass)}（${esc(tt.name)}）</b>，确认后将<b>互换</b>两节课的时间，课时费各自保留。</div></div>`;
  } else if (target && target.id === l.id) {
    tip = `<div class="info-banner" style="margin-top:12px">${ic('info', 16)}<div>这是原位置，请选择其他时段。</div></div>`;
  }

  openSheet({
    title: '调课',
    body: `
      <div class="card flat" style="margin-bottom:14px;padding:12px 14px">
        <div class="hstack">
          <div style="width:4px;height:34px;border-radius:3px;background:${typ.color}"></div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:14.5px">${esc(l.klass)} · ${esc(typ.name)}</div>
            <div class="tiny muted" style="margin-top:2px">原时间：${fmtMD(l.date)} ${weekdayCN(l.date)} ${esc(periodTime(l.period).name)} ${periodTime(l.period).start}</div>
          </div>
        </div>
      </div>
      <div class="field-label">调整到哪一天</div>
      <div class="weekstrip" style="grid-template-columns:repeat(7,1fr);margin-bottom:16px;gap:5px">
        ${dayChips}
      </div>
      <div class="field-label">选择节次</div>
      <div class="period-grid">${periodCells}</div>
      ${tip}
      <div style="height:6px"></div>
    `,
    footer: `<button class="btn ghost" data-close>取消</button>
      <button class="btn" data-act="swap-confirm" ${draftSwap.period === null ? 'disabled' : ''}>
        ${target && target.id !== l.id ? '互换两节课' : '确认调课'}
      </button>`,
  });
}

function doSwap() {
  if (!draftSwap || draftSwap.period === null) return;
  const l = state.lessons.find(x => x.id === draftSwap.lessonId);
  const target = state.lessons.find(x => x.date === draftSwap.date && x.period === draftSwap.period);
  if (target && target.id === l.id) { toast('请选择不同的时段'); return; }

  const fromDate = l.date, fromPeriod = l.period;
  if (target) {
    target.date = fromDate; target.period = fromPeriod; target.status = 'swapped';
    l.date = draftSwap.date; l.period = draftSwap.period; l.status = 'swapped';
    state.swaps.push({
      id: uid(), type: 'exchange', a: l.id, b: target.id,
      aName: l.klass, bName: target.klass,
      from: `${fromDate}#${fromPeriod}`, to: `${draftSwap.date}#${draftSwap.period}`, at: Date.now(),
    });
    toast('已互换两节课的时间', 'swap');
  } else {
    l.date = draftSwap.date; l.period = draftSwap.period; l.status = 'swapped';
    state.swaps.push({
      id: uid(), type: 'move', a: l.id, aName: l.klass,
      from: `${fromDate}#${fromPeriod}`, to: `${draftSwap.date}#${draftSwap.period}`, at: Date.now(),
    });
    toast('已调课', 'swap');
  }
  // 调到另一单双周后，原「单/双周」标记不再成立，转为单次课程
  [l, target].filter(Boolean).forEach(x => {
    if ((x.weekMode === 'odd' || x.weekMode === 'even') && weekParity(x.date) !== x.weekMode) {
      x.weekMode = 'all';
    }
    // 调到别的节次后，时长跟着新节次的作息走（手动指定过的除外）
    if (x.durAuto !== false) x.dur = periodMinutes(x.period);
  });
  save();
  closeSheet();
  viewDate = parseYmd(draftSwap.date);
  render();
}

/* ============================================================
   计费设置
   ============================================================ */
function openCalcRules() {
  const s = state.settings;
  const schemes = [
    { id: 'standard', name: '标准计费', desc: '课时费 = 节数 × 单价（可叠加班级系数）', icon: 'book' },
    { id: 'tiered', name: '阶梯累进', desc: '按月累计课时分档，上的越多单价越高', icon: 'chart' },
    { id: 'overtime', name: '超课时上浮', desc: '超出基准课时后，超出部分单价乘系数', icon: 'flame' },
  ];
  openSheet({
    title: '计费公式',
    body: `
      <div class="field-label">选择方案</div>
      <div style="display:flex;flex-direction:column;gap:9px;margin-bottom:16px">
        ${schemes.map(x => `
          <button data-act="set-scheme" data-scheme="${x.id}"
            style="width:100%;text-align:left;display:flex;gap:11px;align-items:flex-start;padding:13px;border-radius:15px;
            background:${s.scheme === x.id ? 'var(--brand-soft)' : '#F7F9FC'};
            border:1.5px solid ${s.scheme === x.id ? 'var(--brand)' : 'transparent'}">
            <div style="width:32px;height:32px;border-radius:10px;display:grid;place-items:center;flex:0 0 auto;
              background:${s.scheme === x.id ? 'var(--brand)' : '#fff'};color:${s.scheme === x.id ? '#fff' : 'var(--ink-3)'}">
              ${ic(x.icon, 16)}
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;font-weight:700">${x.name}</div>
              <div class="tiny muted" style="margin-top:2px;line-height:1.5">${x.desc}</div>
            </div>
            ${s.scheme === x.id ? `<span style="color:var(--brand)">${ic('check', 18)}</span>` : ''}
          </button>`).join('')}
      </div>

      ${s.scheme === 'tiered' ? `
        <div class="field-label">阶梯档位 <span class="hint">按自然月累计正课节数</span></div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
          ${s.tiers.map((t, i) => `
            <div class="hstack" style="gap:8px">
              <div class="input-suffix" style="flex:1"><input class="input num" data-tier="${i}" data-k="upTo" type="number" value="${t.upTo}"><span class="sfx">节内</span></div>
              <div class="input-suffix" style="flex:1"><input class="input num" data-tier="${i}" data-k="price" type="number" value="${t.price}"><span class="sfx">元/节</span></div>
            </div>`).join('')}
        </div>
        <div class="info-banner" style="margin-bottom:14px">${ic('info', 16)}<div>前 20 节按第一档，之后按第二档，超出按最后一档。</div></div>
      ` : ''}

      ${s.scheme === 'overtime' ? `
        <div class="field-label">超课时设置</div>
        <div class="input-row" style="margin-bottom:14px">
          <div class="input-suffix"><input class="input num" id="otFrom" type="number" value="${s.overtimeFrom}"><span class="sfx">节后</span></div>
          <div class="input-suffix"><input class="input num" id="otRate" type="number" step="0.1" value="${s.overtimeRate}"><span class="sfx">倍</span></div>
        </div>
        <div class="info-banner" style="margin-bottom:14px">${ic('info', 16)}<div>当月累计正课超过 ${s.overtimeFrom} 节后，超出部分按 ×${s.overtimeRate} 计算。</div></div>
      ` : ''}

      <div class="field">
        <div class="field-label">延长课时计价 <span class="hint">超出原节次的部分按此类型单价算</span></div>
        <select class="input" id="extendTypeSel">
          ${state.types.filter(t => t.enabled !== false).map(t => {
            const u = t.unit === 'hour' ? '小时' : t.unit === 'student' ? '人' : '节';
            return `<option value="${t.id}" ${(s.extendTypeId || 'self') === t.id ? 'selected' : ''}>${esc(t.name)} · ${money(t.price)}/${u}</option>`;
          }).join('')}
        </select>
        <div class="tiny muted" style="margin-top:7px;line-height:1.65">
          例：正课 45 分钟 65 元，拖堂 20 分钟，这 20 分钟按这里选的类型单独计价。
        </div>
      </div>

      <div class="field-label">班级系数</div>
      <div class="row" data-act="open-class-factor" style="background:#F7F9FC;border-radius:14px;padding:13px">
        <div class="rc">
          <div class="t" style="font-size:14px">${state.settings.classFactors.length} 条关键词</div>
          <div class="s">班级名匹配时自动乘系数，点这里增删</div>
        </div>
        <div class="switch ${s.useClassFactor ? 'on' : ''}" data-act="toggle-class-factor"></div>
        ${ic('right', 15)}
      </div>
      <div class="field-label">我的方案 <span class="hint">换学校、换算法时一键切回</span></div>
      <div class="rows" style="background:#F7F9FC;border-radius:14px">
        ${(state.schemes || []).map(x => `
          <div class="row" data-act="scheme-open" data-id="${esc(x.id)}" style="padding:12px 13px">
            <div class="rc">
              <div class="t" style="font-size:14px">${esc(x.name)}</div>
              <div class="s">${esc(schemeSummary(x.snap))}</div>
            </div>
            ${s.activeScheme === x.id ? `<span style="color:var(--brand)">${ic('check', 18)}</span>` : ic('right', 15)}
          </div>`).join('')}
        ${(state.schemes || []).length ? '' : '<div class="help-note" style="margin:0;padding:12px 13px">还没有保存的方案。把常用的一套存下来，换学校或换算法时一键切回。</div>'}
        <div class="row" data-act="scheme-save" style="padding:12px 13px;border-top:1px solid var(--line-2)">
          <div class="ri" style="background:var(--violet-soft);color:var(--violet)">${ic('doc', 16)}</div>
          <div class="rc"><div class="t" style="font-size:14px">把当前设置存成方案</div><div class="s">起个名字，以后一键切换</div></div>
          ${ic('right', 15)}
        </div>
        <div class="row" data-act="scheme-share" style="padding:12px 13px;border-top:1px solid var(--line-2)">
          <div class="ri" style="background:var(--brand-soft);color:var(--brand)">${ic('upload', 16)}</div>
          <div class="rc"><div class="t" style="font-size:14px">发给同事</div><div class="s">复制一段码，对方粘贴即用</div></div>
          ${ic('right', 15)}
        </div>
        <div class="row" data-act="scheme-import" style="padding:12px 13px;border-top:1px solid var(--line-2)">
          <div class="ri" style="background:var(--mint-soft);color:var(--mint)">${ic('download', 16)}</div>
          <div class="rc"><div class="t" style="font-size:14px">粘贴同事的分享码</div><div class="s">导入前先给你看这份配置</div></div>
          ${ic('right', 15)}
        </div>
      </div>
      <div style="height:6px"></div>
    `,
    footer: `<button class="btn ghost" data-close>关闭</button><button class="btn" data-act="save-calc-rules">保存设置</button>`,
  });
}

/* ---------- 计费方案：保存多套、分享给同事 ---------- */
let shareDraft = null;      // 导入时解析出来的方案，确认后才应用

/** 把当前计费设置拍成一份快照（课程类型一并带上，否则单价丢了） */
function snapshotScheme() {
  const s = state.settings;
  return {
    scheme: s.scheme,
    useClassFactor: !!s.useClassFactor,
    classFactors: (s.classFactors || []).map(x => ({ key: x.key, factor: Number(x.factor) || 1 })),
    tiers: (s.tiers || []).map(t => ({ upTo: Number(t.upTo) || 0, price: Number(t.price) || 0 })),
    overtimeFrom: Number(s.overtimeFrom) || 0,
    overtimeRate: Number(s.overtimeRate) || 1,
    extendTypeId: s.extendTypeId || 'self',
    types: (state.types || []).filter(t => t.enabled !== false).map(t => ({ ...t })),
  };
}

/**
 * 应用快照：课程类型按 id 合并，本地多出来的类型保留。
 * 直接整体替换会让老课表里的 typeId 找不到类型，金额会悄悄变成第一种课的钱。
 */
function applySchemeSnapshot(snap) {
  if (!snap) return;
  const s = state.settings;
  s.scheme = ['standard', 'tiered', 'overtime'].includes(snap.scheme) ? snap.scheme : 'standard';
  s.useClassFactor = !!snap.useClassFactor;
  s.classFactors = (snap.classFactors || []).slice(0, 20);
  s.tiers = (snap.tiers || []).slice(0, 6);
  s.overtimeFrom = Number(snap.overtimeFrom) || 0;
  s.overtimeRate = Number(snap.overtimeRate) || 1;
  s.extendTypeId = snap.extendTypeId || 'self';

  (snap.types || []).forEach(t => {
    if (!t || !t.id) return;
    const hit = state.types.find(x => x.id === t.id);
    const clean = {
      id: t.id, name: String(t.name || '未命名').slice(0, 12),
      unit: ['period', 'hour', 'student'].includes(t.unit) ? t.unit : 'period',
      price: Number(t.price) || 0,
      factor: Number(t.factor) || 1,
      color: /^#[0-9a-fA-F]{6}$/.test(String(t.color)) ? t.color : '#3B5BFD',
      tierable: !!t.tierable, enabled: true,
    };
    if (hit) Object.assign(hit, clean);
    else state.types.push(clean);
  });
}

/* 分享码：紧凑字段 + base64url，便于在微信里当成一段文字传 */
function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const t = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t);
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

function shareCodeOf(snap, name) {
  const payload = {
    t: 's', v: 1, n: String(name || '').slice(0, 12),
    sc: snap.scheme,
    cf: snap.useClassFactor ? 1 : 0,
    kf: snap.classFactors.map(x => [x.key, x.factor]),
    ti: snap.tiers.map(t => [t.upTo, t.price]),
    of: snap.overtimeFrom,
    or: snap.overtimeRate,
    et: snap.extendTypeId,
    ty: snap.types.map(t => [t.id, t.name, t.unit, t.price, t.factor, t.color, t.tierable ? 1 : 0]),
  };
  return 'KB1-' + b64urlEncode(JSON.stringify(payload));
}

/** 解析分享码；格式不对就抛错，交给界面提示 */
function parseShareCode(code) {
  const txt = String(code || '').trim().replace(/\s+/g, '');
  if (!/^KB1-/.test(txt)) throw new Error('不是课酬的分享码');
  let o;
  try {
    o = JSON.parse(b64urlDecode(txt.slice(4)));
  } catch (e) {
    throw new Error('这串码不完整，可能复制时被截断了');
  }
  if (!o || o.t !== 's' || o.v !== 1) throw new Error('分享码版本不对');
  return {
    name: String(o.n || '同事的方案').slice(0, 12),
    scheme: o.sc,
    useClassFactor: !!o.cf,
    classFactors: (o.kf || []).map(x => ({ key: String(x[0]).slice(0, 8), factor: Number(x[1]) || 1 })),
    tiers: (o.ti || []).map(x => ({ upTo: Number(x[0]) || 0, price: Number(x[1]) || 0 })),
    overtimeFrom: Number(o.of) || 0,
    overtimeRate: Number(o.or) || 1,
    extendTypeId: o.et || 'self',
    types: (o.ty || []).map(t => ({
      id: String(t[0]), name: String(t[1] || '').slice(0, 12),
      unit: t[2], price: Number(t[3]) || 0, factor: Number(t[4]) || 1,
      color: t[5], tierable: !!t[6], enabled: true,
    })),
  };
}

function schemeSummary(snap) {
  return `${schemeName(snap.scheme)} · ${snap.types.length} 个类型`
    + `${snap.useClassFactor ? ` · ${snap.classFactors.length} 条班级系数` : ''}`;
}

function openSchemeSave() {
  openSheet({
    title: '保存为方案',
    body: `
      <div class="field">
        <div class="field-label">方案名称</div>
        <input class="input" id="schemeName" maxlength="12"
               placeholder="如 本校 2026 秋季" value="${esc(`方案 ${(state.schemes || []).length + 1}`)}">
      </div>
      <div class="help-note">保存后会记住当前的计费公式、课程类型单价、班级系数、阶梯与超课时设置。以后换回来就是一键的事。</div>
    `,
    footer: `<button class="btn ghost" data-close>取消</button><button class="btn" data-act="scheme-save-ok">保存</button>`,
  });
}

function saveSchemeNow() {
  const name = (($('#schemeName') || {}).value || '').trim();
  if (!name) { toast('给方案起个名字'); return; }
  state.schemes = state.schemes || [];
  const id = uid();
  state.schemes.push({ id, name: name.slice(0, 12), at: Date.now(), snap: snapshotScheme() });
  state.settings.activeScheme = id;
  save();
  closeSheet();
  render();
  toast('方案已保存', 'check');
}

function openSchemeSheet(id) {
  const hit = (state.schemes || []).find(x => x.id === id);
  if (!hit) return;
  const on = state.settings.activeScheme === id;
  openSheet({
    title: hit.name,
    body: `
      <div class="help-note" style="margin-top:0">${esc(schemeSummary(hit.snap))}</div>
      <div class="rows" style="background:#F7F9FC;border-radius:14px;margin-top:12px">
        ${hit.snap.types.map(t => `
          <div class="row" style="padding:10px 13px">
            <div class="rc"><div class="t" style="font-size:13.5px">${esc(t.name)}</div></div>
            <div class="rv">${money(t.price)}<span class="tiny muted">/${t.unit === 'hour' ? '时' : t.unit === 'student' ? '人' : '节'}</span></div>
          </div>`).join('')}
      </div>
      <button class="btn outline" data-act="scheme-share-one" data-id="${esc(id)}" style="margin-top:14px">${ic('upload', 16)} 复制分享码</button>
      <button class="danger-link" style="margin-top:14px" data-act="scheme-del" data-id="${esc(id)}">删除这个方案</button>
    `,
    footer: `<button class="btn ghost" data-close>关闭</button>
      <button class="btn" data-act="scheme-apply" data-id="${esc(id)}" ${on ? 'disabled' : ''}>${on ? '当前正在用' : '应用这套方案'}</button>`,
  });
}

function applySchemeById(id) {
  const hit = (state.schemes || []).find(x => x.id === id);
  if (!hit) return;
  applySchemeSnapshot(hit.snap);
  state.settings.activeScheme = id;
  save();
  closeSheet();
  render();
  toast(`已应用「${hit.name}」`, 'check');
}

function deleteSchemeById(id) {
  const hit = (state.schemes || []).find(x => x.id === id);
  if (!hit) return;
  confirmModal({
    title: `删除「${hit.name}」`,
    desc: '只删这份保存的方案，当前正在使用的计费设置不受影响。',
    okText: '删除',
    danger: true,
    onDone: ok => {
      if (!ok) return;
      state.schemes = state.schemes.filter(x => x.id !== id);
      if (state.settings.activeScheme === id) state.settings.activeScheme = '';
      save();
      closeSheet();
      render();
      toast('已删除');
    },
  });
}

function openSchemeShare(id) {
  const hit = id ? (state.schemes || []).find(x => x.id === id) : null;
  const snap = hit ? hit.snap : snapshotScheme();
  const name = hit ? hit.name : (state.teacher.name || '我的方案');
  const code = shareCodeOf(snap, name);
  openSheet({
    title: '分享给同事',
    body: `
      <div class="help-note" style="margin-top:0">把下面这段发给同事，他在「我的方案 → 粘贴分享码」里贴进去，就能得到和你一样的算法与单价。</div>
      <textarea class="input" id="shareOut" readonly
        style="min-height:132px;font-size:11px;line-height:1.7;white-space:pre-wrap;word-break:break-all;font-family:ui-monospace,Menlo,Consolas,monospace">${esc(code)}</textarea>
      <div class="tiny muted" style="margin-top:8px">共 ${code.length} 个字符 · 只含计费设置，不含任何课表和姓名</div>
    `,
    footer: `<button class="btn ghost" data-close>关闭</button><button class="btn" data-act="scheme-copy">复制分享码</button>`,
  });
}

function openSchemeImport() {
  shareDraft = null;
  renderSchemeImport();
}

function renderSchemeImport() {
  const d = shareDraft;
  openSheet({
    title: '粘贴分享码',
    body: d ? `
      <div class="help-note" style="margin-top:0">解析成功，确认后再应用。</div>
      <div class="rows" style="background:#F7F9FC;border-radius:14px;margin-top:12px">
        <div class="row" style="padding:12px 13px">
          <div class="rc"><div class="t" style="font-size:14px">${esc(d.name)}</div>
            <div class="s">${esc(schemeSummary(d))}</div></div>
        </div>
        ${d.types.map(t => `
          <div class="row" style="padding:10px 13px;border-top:1px solid var(--line-2)">
            <div class="rc"><div class="t" style="font-size:13.5px">${esc(t.name)}</div></div>
            <div class="rv">${money(t.price)}</div>
          </div>`).join('')}
      </div>
      <div class="help-note">应用后会覆盖当前的计费公式与同名课程类型的单价；你本地多出来的课程类型会保留。</div>
    ` : `
      <div class="help-note" style="margin-top:0">把同事发来的那串「KB1-…」整段贴进来。</div>
      <textarea class="input" id="shareIn" placeholder="KB1-..."
        style="min-height:132px;font-size:11px;line-height:1.7;white-space:pre-wrap;word-break:break-all;font-family:ui-monospace,Menlo,Consolas,monospace"></textarea>
    `,
    footer: d
      ? `<button class="btn ghost" data-act="scheme-import-back">重填</button><button class="btn" data-act="scheme-import-ok">应用</button>`
      : `<button class="btn ghost" data-close>取消</button><button class="btn" data-act="scheme-import-parse">解析</button>`,
  });
}

function parseShareInput() {
  const raw = (($('#shareIn') || {}).value || '').trim();
  if (!raw) { toast('先把分享码贴上'); return; }
  try {
    shareDraft = parseShareCode(raw);
    renderSchemeImport();
  } catch (e) {
    toast(e && e.message ? e.message : '解析失败');
  }
}

function applyShareInput() {
  if (!shareDraft) return;
  const name = shareDraft.name || '同事的方案';
  state.schemes = state.schemes || [];
  const id = uid();
  state.schemes.push({ id, name, at: Date.now(), snap: { ...shareDraft, name: undefined } });
  applySchemeSnapshot(shareDraft);
  state.settings.activeScheme = id;
  save();
  closeSheet();
  render();
  toast(`已导入「${name}」`, 'check');
}

/* ---------- 学期报表 ---------- */
/** 学期区间：从学期第一周周一算起 termWeeks 周 */
function termRange() {
  const start = termStartYmd();
  const weeks = clamp(Number(state.settings.termWeeks) || 20, 1, 30);
  const end = ymd(addDays(parseYmd(start), weeks * 7 - 1));
  const months = [];
  let cur = start.slice(0, 7);
  const last = end.slice(0, 7);
  let guard = 0;
  while (cur <= last && guard++ < 24) {
    months.push(cur);
    cur = shiftMonth(cur, 1);
  }
  return { start, end, weeks, months };
}

/** 逐月汇总成整学期；补贴/扣款按各自月份累加 */
function calcTerm() {
  const { start, end, weeks, months } = termRange();
  const per = months.map(ym => ({ ym, m: calcMonth(ym) }));
  let total = 0, lessonTotal = 0, doneFee = 0, planFee = 0;
  let count = 0, doneCount = 0, km = 0, extraAdd = 0, extraSub = 0;
  const byType = new Map();

  per.forEach(({ m }) => {
    total = round2(total + m.total);
    lessonTotal = round2(lessonTotal + m.lessonTotal);
    doneFee = round2(doneFee + m.doneFee);
    planFee = round2(planFee + m.planFee);
    count += m.count;
    doneCount += m.doneCount;
    km = round2(km + m.km);
    extraAdd = round2(extraAdd + m.extraAdd);
    extraSub = round2(extraSub + m.extraSub);
    m.byType.forEach(t => {
      if (!byType.has(t.id)) byType.set(t.id, { id: t.id, name: t.name, color: t.color, fee: 0, count: 0 });
      const b = byType.get(t.id);
      b.fee = round2(b.fee + t.fee);
      b.count += t.count;
    });
  });

  return {
    start, end, weeks, months, per,
    total, lessonTotal, doneFee, planFee, count, doneCount, km, extraAdd, extraSub,
    byType: [...byType.values()].sort((a, b) => b.fee - a.fee),
  };
}

function termStatementText() {
  const t = calcTerm();
  const who = [state.teacher.school, state.teacher.name, state.teacher.subject].filter(Boolean).join(' · ');
  const L = [];
  L.push(`课酬学期报表 · ${t.start} 至 ${t.end}`);
  if (who) L.push(who);
  L.push('');
  L.push(`学期总课酬　${money(t.total)}`);
  if (t.extraAdd || t.extraSub) {
    L.push(`　课时费　　${money(t.lessonTotal)}`);
    if (t.extraAdd) L.push(`　补贴　　　+${money(t.extraAdd)}`);
    if (t.extraSub) L.push(`　扣款　　　−${money(t.extraSub)}`);
  }
  L.push(`课时　　　　${t.count} 节（已完成 ${t.doneCount} 节，待上 ${t.count - t.doneCount} 节）`);
  L.push(`折合课时　　${t.km} 节（按 45 分钟折算）`);
  L.push('');
  L.push('按月');
  t.per.forEach(({ ym, m }) => {
    L.push(`　${monthLabel(ym)}　${String(m.count).padStart(2, ' ')} 节　${money(m.total)}`);
  });
  if (t.byType.length) {
    L.push('');
    L.push('按类型');
    t.byType.forEach(x => L.push(`　${x.name}　${x.count} 节　${money(x.fee)}`));
  }
  L.push('');
  L.push(`生成于 ${todayYmd()} · 课酬`);
  return L.join('\n');
}

function openTermReport() {
  const t = calcTerm();
  const maxFee = Math.max(1, ...t.byType.map(x => x.fee));
  openSheet({
    title: '学期总览',
    body: `
      <div class="help-note" style="margin-top:0">${t.start} 至 ${t.end} · 共 ${t.weeks} 周</div>

      <div class="card" style="background:linear-gradient(150deg,#1E2F80,#2C43C4 55%,#3B5BFD);margin-top:12px">
        <div style="color:#fff">
          <div style="font-size:12.5px;opacity:.8;display:flex;justify-content:space-between">
            <span>学期总课酬</span><span>${t.count} 节课 · ${t.km} 标准课时</span>
          </div>
          <div style="display:flex;align-items:flex-end;gap:6px;margin-top:6px">
            <span style="font-size:19px;font-weight:700;padding-bottom:7px;opacity:.9">¥</span>
            <span class="num" style="font-size:38px;font-weight:800;letter-spacing:-1.2px;line-height:1">${splitMoney(t.total).int}</span>
            ${splitMoney(t.total).dec === '00' ? '' : `<span class="num" style="font-size:17px;font-weight:700;padding-bottom:4px;opacity:.85">.${splitMoney(t.total).dec}</span>`}
          </div>
          <div style="display:flex;gap:18px;margin-top:14px;padding-top:13px;border-top:1px solid rgba(255,255,255,.16);font-size:12px">
            <div><div style="opacity:.7">已结课</div><div class="num" style="font-size:15px;font-weight:700;margin-top:2px">${money(t.doneFee)}</div></div>
            <div><div style="opacity:.7">待上课</div><div class="num" style="font-size:15px;font-weight:700;margin-top:2px">${money(t.planFee)}</div></div>
            <div><div style="opacity:.7">完成</div><div class="num" style="font-size:15px;font-weight:700;margin-top:2px">${t.count ? Math.round(t.doneCount / t.count * 100) : 0}%</div></div>
          </div>
        </div>
      </div>

      ${t.extraAdd || t.extraSub ? `
        <div class="rows" style="background:#F7F9FC;border-radius:14px;margin-bottom:14px">
          <div class="row" style="padding:11px 13px">
            <div class="rc"><div class="t" style="font-size:13.5px">课时费</div></div>
            <div class="rv">${money(t.lessonTotal)}</div>
          </div>
          ${t.extraAdd ? `<div class="row" style="padding:11px 13px;border-top:1px solid var(--line-2)">
            <div class="rc"><div class="t" style="font-size:13.5px">补贴</div></div>
            <div class="rv" style="color:var(--mint)">+${money(t.extraAdd)}</div></div>` : ''}
          ${t.extraSub ? `<div class="row" style="padding:11px 13px;border-top:1px solid var(--line-2)">
            <div class="rc"><div class="t" style="font-size:13.5px">扣款</div></div>
            <div class="rv" style="color:var(--rose)">−${money(t.extraSub)}</div></div>` : ''}
        </div>` : ''}

      <div class="field-label">按月</div>
      <div class="rows" style="background:#F7F9FC;border-radius:14px;margin-bottom:14px">
        ${t.per.map(({ ym, m }, i) => `
          <div class="row" style="padding:11px 13px${i ? ';border-top:1px solid var(--line-2)' : ''}">
            <div class="rc">
              <div class="t" style="font-size:13.5px">${monthLabel(ym)}</div>
              <div class="s">${m.count} 节${m.doneCount !== m.count ? ` · 待上 ${m.count - m.doneCount}` : ''}</div>
            </div>
            <div class="rv">${money(m.total)}</div>
          </div>`).join('')}
      </div>

      ${t.byType.length ? `
        <div class="field-label">按类型</div>
        <div class="card" style="box-shadow:none;border:1px solid var(--line);padding:14px 16px">
          ${t.byType.map(x => `
            <div class="sb-item" style="margin-bottom:12px">
              <div class="sb-top">
                <span class="nm"><i class="tick" style="background:${x.color};width:8px;height:8px;border-radius:3px"></i>${esc(x.name)}</span>
                <span class="vl">${money(x.fee)}<small>${x.count} 节</small></span>
              </div>
              <div class="sb-track"><div class="sb-fill" style="width:${Math.max(3, (x.fee / maxFee) * 100)}%;background:${x.color}"></div></div>
            </div>`).join('')}
        </div>` : ''}
    `,
    footer: `<button class="btn ghost" data-close>关闭</button><button class="btn" data-act="term-copy">复制报表</button>`,
  });
}

function openTypesSheet() {
  const list = state.types.filter(t => t.enabled !== false);
  openSheet({
    title: '课程类型与单价',
    body: `
      <div class="info-banner" style="margin-bottom:14px">${ic('info', 16)}
        <div>每种类型单独设单价，正课和自习分开算。</div></div>
      ${list.map(t => `
        <div class="row" style="background:#F7F9FC;border-radius:14px;margin-bottom:9px" data-act="edit-type" data-id="${t.id}">
          <div class="ri" style="background:${t.color}18;color:${t.color}">${ic(typeIcon(t), 17)}</div>
          <div class="rc">
            <div class="t">${esc(t.name)}</div>
            <div class="s">${t.unit === 'hour' ? '按时长' : t.unit === 'student' ? '按人数' : '按节次'} · 系数 ×${t.factor || 1}${t.tierable ? ' · 参与阶梯' : ''}</div>
          </div>
          <div class="rv" style="color:${t.color}">${money(t.price)}<span class="tiny muted">/${t.unit === 'hour' ? '时' : t.unit === 'student' ? '人' : '节'}</span></div>
          ${ic('right', 15)}
        </div>`).join('')}
      <button class="btn outline" data-act="add-type" style="margin-top:6px">${ic('plus', 16)} 新增课程类型</button>
      <div style="height:6px"></div>
    `,
    footer: `<button class="btn ghost" data-close>完成</button>`,
  });
}

function openTypeEditor(typeId) {
  const isNew = !typeId;
  const t = isNew
    ? { id: uid(), name: '', unit: 'period', price: 50, factor: 1, color: TYPE_COLORS[state.types.length % TYPE_COLORS.length], tierable: false, enabled: true }
    : { ...state.types.find(x => x.id === typeId) };

  const draw = () => {
    openSheet({
      title: isNew ? '新增课程类型' : '编辑课程类型',
      body: `
        <div class="field">
          <div class="field-label">名称</div>
          <input class="input" id="t-name" value="${esc(t.name)}" placeholder="如：竞赛辅导">
        </div>
        <div class="field">
          <div class="field-label">计价方式</div>
          <div class="segmented">
            <button class="${t.unit === 'period' ? 'on' : ''}" data-act="type-unit" data-unit="period">按节次</button>
            <button class="${t.unit === 'hour' ? 'on' : ''}" data-act="type-unit" data-unit="hour">按时长</button>
            <button class="${t.unit === 'student' ? 'on' : ''}" data-act="type-unit" data-unit="student">按人数</button>
          </div>
        </div>
        <div class="input-row">
          <div class="field">
            <div class="field-label">单价</div>
            <div class="input-suffix"><input class="input num" id="t-price" type="number" value="${t.price}"><span class="sfx">元</span></div>
          </div>
          <div class="field">
            <div class="field-label">系数</div>
            <div class="input-suffix"><input class="input num" id="t-factor" type="number" step="0.1" value="${t.factor || 1}"><span class="sfx">倍</span></div>
          </div>
        </div>
        <div class="field">
          <div class="field-label">颜色标识</div>
          <div class="color-row">
            ${TYPE_COLORS.map(c => `<button class="color-dot ${c === t.color ? 'on' : ''}" data-act="type-color" data-color="${c}" style="background:${c}"></button>`).join('')}
          </div>
        </div>
        <div class="row" style="background:#F7F9FC;border-radius:14px;padding:13px">
          <div class="rc"><div class="t" style="font-size:14px">参与阶梯 / 超课时</div><div class="s">仅在对应计费方案下生效</div></div>
          <div class="switch ${t.tierable ? 'on' : ''}" data-act="type-tierable"></div>
        </div>
        <div style="height:6px"></div>
      `,
      footer: `${isNew ? '' : `<button class="btn danger" style="flex:0 0 58px" data-act="type-del" data-id="${t.id}">${ic('trash', 18)}</button>`}
        <button class="btn" data-act="type-save" data-new="${isNew ? 1 : 0}" data-id="${t.id}">保存</button>`,
    });
  };
  draw();
  window.__typeDraw = draw;
  window.__typeDraft = t;
}

function openClassFactorSheet() {
  const cf = state.settings.classFactors;
  openSheet({
    title: '班级系数',
    body: `
      <div class="info-banner" style="margin-bottom:14px">${ic('info', 16)}
        <div>班级名里带关键词就自动乘系数，比如「高三」×1.2。</div></div>
      ${cf.length ? cf.map((c, i) => `
        <div class="hstack" style="gap:8px;margin-bottom:9px">
          <div style="flex:1.4"><input class="input" data-cf="${i}" data-k="key" value="${esc(c.key)}" placeholder="关键词"></div>
          <div class="input-suffix" style="flex:1"><input class="input num" data-cf="${i}" data-k="factor" type="number" step="0.05" value="${c.factor}"><span class="sfx">倍</span></div>
          <button class="icon-btn" data-act="cf-del" data-i="${i}" style="box-shadow:none;background:#FEEcea;color:var(--rose)">${ic('close', 16)}</button>
        </div>`).join('') : `<div class="empty" style="padding:20px"><div class="s">还没有配置系数</div></div>`}
      <button class="btn outline" data-act="cf-add" style="margin-top:6px">${ic('plus', 16)} 添加关键词</button>
      <div class="row" style="background:#F7F9FC;border-radius:14px;padding:13px;margin-top:14px">
        <div class="rc"><div class="t" style="font-size:14px">启用班级系数</div></div>
        <div class="switch ${state.settings.useClassFactor ? 'on' : ''}" data-act="toggle-class-factor"></div>
      </div>
      <div style="height:6px"></div>
    `,
    footer: `<button class="btn ghost" data-close>取消</button><button class="btn" data-act="cf-save">保存</button>`,
  });
}

function openTermSheet() {
  const s = state.settings;
  const ts = termStartYmd();
  const wk = weekIndexOf(todayYmd());
  const par = weekParity(todayYmd());
  openSheet({
    title: '学期与单双周',
    body: `
      <div class="info-banner" style="margin-bottom:14px">${ic('cal', 16)}
        <div>单双周按<b>学期周次</b>判定：以学期第一周的周一为第 1 周，单数周为单周、双数为双周。</div></div>
      <div class="term-now">
        <div><b>第 ${wk} 周</b><em>${parityLabel(par)}</em></div>
        <div class="tiny muted">${fmtMD(todayYmd())} ${weekdayCN(todayYmd())}</div>
      </div>
      <div class="field">
        <div class="field-label">学期第一周的周一</div>
        <input class="input" id="t-start" type="date" value="${ts}">
      </div>
      <div class="field">
        <div class="field-label">学期总周数 <span class="hint">用于「重复到学期末」</span></div>
        <div class="input-suffix">
          <input class="input num" id="t-weeks" type="number" inputmode="numeric" min="1" max="30" value="${s.termWeeks || 20}">
          <span class="sfx">周</span>
        </div>
      </div>
      <div class="breakdown" style="margin-bottom:4px">
        <div class="bd-line"><span class="k">学期范围</span><span class="v" id="t-range">${fmtMD(ts)} – ${fmtMD(termEndYmd())}</span></div>
        <div class="bd-line"><span class="k sub">调整首周只改变周次编号，不会改动已有课程</span><span class="v sub"></span></div>
      </div>
      <div style="height:6px"></div>
    `,
    footer: `<button class="btn ghost" data-close>取消</button><button class="btn" data-act="term-save">保存</button>`,
  });
}

/* ---------- 补贴 / 扣款 ---------- */
let draftExtra = null;

function openExtraSheet(id) {
  const hit = id ? (state.extras || []).find(e => e.id === id) : null;
  draftExtra = hit
    ? { ...hit }
    : {
      // 同一毫秒内连加两条时 Date.now() 会撞车，补随机后缀
      id: 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: '', amount: 0, kind: 'add', cycle: 'monthly', date: `${payMonth}-01`,
    };
  renderExtraSheet();
}

function renderExtraSheet() {
  const d = draftExtra;
  if (!d) return;
  const editing = (state.extras || []).some(e => e.id === d.id);
  openSheet({
    title: editing ? '编辑补贴 / 扣款' : '添加补贴 / 扣款',
    body: `
      <div class="field">
        <div class="field-label">名称</div>
        <input class="input" id="extraName" maxlength="20"
               value="${esc(d.name)}" placeholder="如 班主任津贴、监考费">
      </div>
      <div class="field">
        <div class="field-label">类型</div>
        <div class="segmented">
          <button class="${d.kind === 'sub' ? '' : 'on'}" data-act="extra-kind" data-v="add">补贴（加钱）</button>
          <button class="${d.kind === 'sub' ? 'on' : ''}" data-act="extra-kind" data-v="sub">扣款（减钱）</button>
        </div>
      </div>
      <div class="field">
        <div class="field-label">金额（元）</div>
        <input class="input" id="extraAmount" type="number" inputmode="decimal"
               min="0" step="0.01" value="${d.amount || ''}" placeholder="0.00">
      </div>
      <div class="field">
        <div class="field-label">什么时候</div>
        <div class="segmented">
          <button class="${d.cycle === 'monthly' ? 'on' : ''}" data-act="extra-cycle" data-v="monthly">每月固定</button>
          <button class="${d.cycle === 'monthly' ? '' : 'on'}" data-act="extra-cycle" data-v="once">只这一次</button>
        </div>
        <input class="input" id="extraDate" type="date" value="${esc(d.date)}" style="margin-top:10px">
        <div class="help-note" style="margin-top:10px">${d.cycle === 'monthly'
          ? '从所选月份起，之后每个月都算，直到你删掉它。'
          : '只算所选日期所在的那个月。'}</div>
      </div>
      ${editing ? '<button class="danger-link" style="margin-top:4px" data-act="extra-del">删除这条</button>' : ''}
    `,
    footer: `<button class="btn ghost" data-close>取消</button><button class="btn" data-act="extra-save">保存</button>`,
  });
}

/** 重绘面板前先把输入框的值收回草稿，否则点一下分段按钮刚填的就没了 */
function syncExtraInputs() {
  if (!draftExtra) return;
  const n = $('#extraName'), a = $('#extraAmount'), d = $('#extraDate');
  if (n) draftExtra.name = n.value;
  if (a) draftExtra.amount = Number(a.value) || 0;
  if (d) draftExtra.date = d.value;
}

function saveExtraSheet() {
  const d = draftExtra;
  if (!d) return;
  const name = (($('#extraName') || {}).value || '').trim();
  const amount = Number((($('#extraAmount') || {}).value || '').trim());
  const date = (($('#extraDate') || {}).value || '').trim();
  if (!name) { toast('给它起个名字'); return; }
  if (!Number.isFinite(amount) || amount <= 0) { toast('金额要大于 0'); return; }
  if (!YMD_RE.test(date)) { toast('选一个日期'); return; }

  d.name = name;
  d.amount = round2(amount);
  d.date = date;
  const i = (state.extras || []).findIndex(e => e.id === d.id);
  if (i >= 0) state.extras[i] = { ...d };
  else state.extras.push({ ...d });
  save();
  closeSheet();
  render();
  toast('已保存', 'check');
}

function deleteExtra() {
  const d = draftExtra;
  if (!d) return;
  state.extras = (state.extras || []).filter(e => e.id !== d.id);
  save();
  closeSheet();
  render();
  toast('已删除');
}

function tplSyncText() {
  const n = (state.templates || []).length;
  const at = Number(state.meta.templateSyncAt) || 0;
  if (!at) return '联网获取更多学段 / 地区作息';
  const d = new Date(at);
  return `${n} 个已同步 · ${d.getMonth() + 1}月${d.getDate()}日更新`;
}

function openPeriodsSheet() {
  openSheet({
    title: '作息时间表',
    body: `
      <div class="info-banner" style="margin-bottom:14px">${ic('clock', 16)}
        <div>这里的时间决定课表显示、课前提醒和<b>自习时长</b>，改完会自动同步。</div></div>
      <div class="field-label">套用常见作息</div>
      <div class="rows" style="background:#F7F9FC;border-radius:14px;margin-bottom:16px">
        ${allPresets().map((p, i) => `
          <div class="row" data-act="period-preset" data-p="${esc(p.id)}"
               style="padding:11px 13px${i ? ';border-top:1px solid var(--line-2)' : ''}">
            <div class="rc"><div class="t" style="font-size:14px">${esc(p.name)}</div><div class="s">${esc(p.desc || '')}</div></div>
            ${ic('right', 15)}
          </div>`).join('')}
        <div class="row" data-act="tpl-sync" style="padding:11px 13px;border-top:1px solid var(--line-2)">
          <div class="ri" style="background:var(--brand-soft);color:var(--brand)">${ic('download', 16)}</div>
          <div class="rc">
            <div class="t" style="font-size:14px">更新模板</div>
            <div class="s">${tplSyncText()}</div>
          </div>
          ${ic('right', 15)}
        </div>
      </div>
      <div class="field-label">逐节时间</div>
      ${state.periods.map((p, i) => `
        <div class="hstack" style="gap:8px;margin-bottom:8px">
          <div style="flex:0 0 62px;font-size:13px;font-weight:650;color:var(--ink-2)">${esc(p.name)}</div>
          <input class="input" data-period="${i}" data-k="start" type="time" value="${p.start}" style="flex:1;padding:9px 10px">
          <span class="muted tiny">至</span>
          <input class="input" data-period="${i}" data-k="end" type="time" value="${p.end}" style="flex:1;padding:9px 10px">
        </div>`).join('')}
      <div style="height:6px"></div>
    `,
    footer: `<button class="btn ghost" data-close>取消</button><button class="btn" data-act="period-save">保存</button>`,
  });
}

function applyPeriodPreset(id) {
  const p = allPresets().find(x => x.id === id);
  if (!p) return;

  // 已经排到第 9 节的课，套用只有 6 节的作息后会被算成第 1 节，金额和提醒时间都会错。
  // 与其偷偷改，不如直接拦下来让人先调课表。
  const used = Math.max(
    0,
    ...state.lessons.map(l => Number(l.period) || 0),
    ...Object.keys(state.master || {}).map(k => Number(String(k).split('#')[1]) || 0)
  );
  if (used > p.periods.length) {
    toast(`这套作息只有 ${p.periods.length} 节，你有课排在第 ${used} 节`);
    return;
  }

  confirmModal({
    title: `套用「${p.name}」`,
    desc: `将用这套时间替换当前作息表的 ${p.periods.length} 个节次，已有课程的时间跟着变。`,
    okText: '套用',
    onDone: ok => {
      if (!ok) return;
      // 和手动保存作息一样，把「跟着作息走」的课时长同步过去
      const before = {};
      state.periods.forEach(x => { before[x.no] = minutesBetween(x.start, x.end); });
      state.periods = p.periods.map((x, i) => ({
        no: i + 1, name: x.name, short: x.short, start: x.start, end: x.end,
      }));
      state.lessons.forEach(l => {
        if (l.durAuto === false) return;
        const auto = l.durAuto === true || Number(l.dur) === before[l.period] || !l.dur;
        if (!auto) return;
        l.dur = periodMinutes(l.period);
        l.durAuto = true;
      });
      save();
      render();
      openPeriodsSheet();
      toast('已套用作息', 'check');
    },
  });
}

function openRemindSheet() {
  const s = state.settings;
  const perm = notifyPermissionState();
  const permText = {
    granted: '通知已开启',
    denied: IS_NATIVE ? '通知被关掉了' : '通知被浏览器拦了',
    default: '通知还没开启',
    unsupported: '这台设备不支持通知',
  }[perm];
  const exactOk = IS_NATIVE ? NATIVE.canScheduleExact() : true;
  const subText = IS_NATIVE
    ? '由系统闹钟触发，关掉应用也有效'
    : '建议先「添加到主屏幕」再用';

  openSheet({
    title: '提醒设置',
    body: `
      <div class="row" style="background:#F7F9FC;border-radius:14px;padding:13px;margin-bottom:14px">
        <div class="rc"><div class="t" style="font-size:14px">课前提醒</div><div class="s">每节课开始前提醒你</div></div>
        <div class="switch ${s.remindEnabled ? 'on' : ''}" data-act="toggle-remind"></div>
      </div>
      <div class="field">
        <div class="field-label">提前时间</div>
        <div class="segmented">
          ${[5, 10, 15, 30].map(n => `<button class="${s.remindBefore === n ? 'on' : ''}" data-act="set-remind-before" data-n="${n}">${n} 分钟</button>`).join('')}
        </div>
      </div>
      <div class="field">
        <div class="field-label">每日小结</div>
        <div class="row" style="background:#F7F9FC;border-radius:14px;padding:13px">
          <div class="rc"><div class="t" style="font-size:14px">每晚提醒记课</div><div class="s">${s.dailyRemindAt} 提醒补充当天课程</div></div>
          <div class="switch ${s.dailyRemind ? 'on' : ''}" data-act="toggle-daily-remind"></div>
        </div>
      </div>
      <div class="field">
        <div class="field-label">系统通知权限</div>
        <div class="row" style="background:#F7F9FC;border-radius:14px;padding:13px">
          <div class="rc"><div class="t" style="font-size:13.5px;font-weight:600">${permText}</div>
          <div class="s">${subText}</div></div>
          ${perm === 'default' ? `<button class="btn sm" data-act="req-notify">授权</button>` : ''}
        </div>
      </div>
      ${IS_NATIVE ? `
      <div class="field">
        <div class="field-label">准点提醒</div>
        <div class="row" style="background:#F7F9FC;border-radius:14px;padding:13px">
          <div class="rc"><div class="t" style="font-size:13.5px;font-weight:600">${exactOk ? '已开启，提醒准点' : '未开启，可能延迟几分钟'}</div>
          <div class="s">需要「闹钟与提醒」权限才能准点</div></div>
          ${exactOk ? '' : `<button class="btn sm" data-act="req-exact">开启</button>`}
        </div>
      </div>` : ''}
      <div class="info-banner" style="margin-bottom:6px">${ic('info', 16)}
        <div>${IS_NATIVE
          ? '已排好未来 15 天，改了课表会自动重排。'
          : '提醒需要应用在后台运行才响。'}</div></div>
    `,
    footer: `<button class="btn ghost" data-close>关闭</button><button class="btn" data-act="test-notify">测试提醒</button>`,
  });
}

function swapLogHtml() {
  const list = state.swaps.slice().sort((a, b) => b.at - a.at);
  const fmtSlot = s => {
    const [d, p] = String(s).split('#');
    const per = getPeriod(Number(p));
    return `${fmtMD(d)} ${per.name}`;
  };
  if (!list.length) {
    return `<div class="empty" style="padding:32px 0">${ic('swap', 40)}
      <div class="t">还没有调课</div>
      <div class="s">在课表里点开一节课，就能换时间或与人互换</div></div>`;
  }
  return list.map(s => `
      <div class="card flat" style="padding:12px 14px;margin-bottom:9px">
        <div class="hstack" style="justify-content:space-between">
          <div style="font-weight:700;font-size:14px">${esc(s.aName || '课程')}</div>
          <span class="tag ${s.type === 'exchange' ? 'violet' : 'mint'}">${s.type === 'exchange' ? '互换' : '调课'}</span>
        </div>
        <div class="hstack" style="gap:8px;margin-top:8px;font-size:12.5px;color:var(--ink-2)">
          <span style="text-decoration:line-through;color:var(--ink-3)">${esc(fmtSlot(s.from))}</span>
          ${ic('right', 13)}
          <span style="font-weight:650;color:var(--brand)">${esc(fmtSlot(s.to))}</span>
        </div>
        ${s.type === 'exchange' && s.bName ? `<div class="tiny muted" style="margin-top:5px">与 ${esc(s.bName)} 互换</div>` : ''}
        <div class="tiny muted" style="margin-top:6px">${new Date(s.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 操作</div>
      </div>`).join('');
}

function openSwapLog() { openSwapCenter('log'); }

/** 备份与恢复：两件事放在一张面板里，避免「我的」页堆三行。 */
/* ============================================================
   多设备同步面板：局域网直传 + 文件包
   ------------------------------------------------------------
   两条通道共用一个同步包（buildSyncPacket）和一套合并逻辑，
   所以「怎么传」和「怎么合」是分开的，以后加蓝牙、加网盘都不用改合并。
   ============================================================ */

let lanPeers = [];
let lanInfo = { on: false, ip: '', port: 0, code: '', scanning: false };
let lanTimer = 0;
let pendSyncPkt = null;
let lastSyncStats = null;

function hasLan() {
  try {
    return !!(window.Native && typeof window.Native.lanStart === 'function');
  } catch (e) { return false; }
}

/** 「我的」页那一行的副标题 */
function syncMineSub() {
  const at = Number(state.meta.syncAt) || 0;
  if (!at) return '两台手机，数据合并';
  const d = new Date(at);
  return `上次同步 ${d.getMonth() + 1}月${d.getDate()}日 · 与 ${state.meta.syncPeer || '另一台设备'}`;
}

function syncWhenText() {
  const at = Number(state.meta.syncAt) || 0;
  if (!at) return '还没有同步过';
  const d = new Date(at);
  const p = n => String(n).padStart(2, '0');
  return `上次同步 ${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`
    + (state.meta.syncPeer ? ` · 与 ${state.meta.syncPeer}` : '');
}

function lanBodyHtml() {
  if (!hasLan()) {
    return `<div class="help-note">网页版没有局域网能力。装到手机上就能用「同一 WiFi 直接传」，不用数据线也不用网盘。</div>`;
  }
  if (!lanInfo.on) {
    return `
      <div class="rows" style="background:#F7F9FC;border-radius:14px">
        <div class="row" data-act="lan-start" style="padding:12px 13px">
          <div class="ri" style="background:var(--brand-soft);color:var(--brand)">${ic('swap', 16)}</div>
          <div class="rc"><div class="t" style="font-size:14px">开启接收</div>
            <div class="s">同一 WiFi 下的另一台手机就能找到这台</div></div>
          ${ic('right', 15)}
        </div>
      </div>`;
  }
  const peers = lanPeers.length
    ? lanPeers.map((p, i) => `
        <div class="row" data-act="lan-ask" data-ip="${esc(p.ip)}" data-port="${p.port}" data-name="${esc(p.name || '')}"
             style="padding:12px 13px${i ? ';border-top:1px solid var(--line-2)' : ''}">
          <div class="ri" style="background:var(--mint-soft);color:var(--mint)">${ic('grid', 16)}</div>
          <div class="rc"><div class="t" style="font-size:14px">${esc(p.name || '另一台手机')}</div>
            <div class="s">${esc(p.ip)}:${p.port} · 点一下开始同步</div></div>
          ${ic('right', 15)}
        </div>`).join('')
    : `<div class="help-note" style="margin:0;padding:12px 13px">${lanInfo.scanning ? '正在找…' : '点下面「查找另一台手机」'}</div>`;

  return `
    <div class="rows" style="background:#F7F9FC;border-radius:14px">
      <div class="row" style="padding:12px 13px">
        <div class="ri" style="background:var(--brand-soft);color:var(--brand)">${ic('info', 16)}</div>
        <div class="rc"><div class="t" style="font-size:14px">配对码</div>
          <div class="s">另一台手机要输这 4 位数字才能连上</div></div>
        <div class="rv num" style="font-size:20px;font-weight:700;letter-spacing:3px">${esc(lanInfo.code || '----')}</div>
      </div>
      ${peers}
      <div class="row" data-act="lan-scan" style="padding:12px 13px;border-top:1px solid var(--line-2)">
        <div class="ri" style="background:var(--violet-soft);color:var(--violet)">${ic('spark', 16)}</div>
        <div class="rc"><div class="t" style="font-size:14px">${lanInfo.scanning ? '正在查找…' : '查找另一台手机'}</div>
          <div class="s">两台都开到这个页面，成功率最高</div></div>
        ${ic('right', 15)}
      </div>
      <div class="row" data-act="lan-stop" style="padding:12px 13px;border-top:1px solid var(--line-2)">
        <div class="ri" style="background:#F2F4F7;color:var(--ink-2)">${ic('close', 15)}</div>
        <div class="rc"><div class="t" style="font-size:14px;color:var(--ink-2)">关闭接收</div>
          <div class="s">关闭后对方就找不到这台了</div></div>
      </div>
    </div>`;
}

function syncBodyHtml() {
  const dev = deviceInfo();
  return `
    <div class="tiny muted" style="margin:-4px 0 12px">${syncWhenText()}</div>

    <div class="field">
      <div class="field-label">本机名称 <span class="hint">同步时用来区分是哪台手机</span></div>
      <input class="input" id="sync-device" maxlength="16" value="${esc(dev.name)}" placeholder="如 张老师的手机">
    </div>

    <div class="field-label">局域网直传 <span class="hint">同一个 WiFi，不经过任何服务器</span></div>
    ${lanBodyHtml()}

    <div class="field-label" style="margin-top:16px">用文件同步 <span class="hint">不方便连同一个 WiFi 时</span></div>
    <div class="rows" style="background:#F7F9FC;border-radius:14px">
      <div class="row" data-act="sync-export" style="padding:12px 13px">
        <div class="ri" style="background:var(--mint-soft);color:var(--mint)">${ic('upload', 16)}</div>
        <div class="rc"><div class="t" style="font-size:14px">导出同步包</div>
          <div class="s">存成文件，发给另一台手机</div></div>
        ${ic('right', 15)}
      </div>
      <div class="row" data-act="sync-import" style="padding:12px 13px;border-top:1px solid var(--line-2)">
        <div class="ri" style="background:var(--brand-soft);color:var(--brand)">${ic('download', 16)}</div>
        <div class="rc"><div class="t" style="font-size:14px">导入同步包</div>
          <div class="s">合并两份数据，不是覆盖</div></div>
        ${ic('right', 15)}
      </div>
    </div>

    <div class="help-note">
      同步是<b>合并</b>：两边各自加的课、改的价都会保留；同一条记录两边都改过，以改得晚的为准。
      删掉的课也会同步删掉。全程不经过服务器，这个文件只在你自己的设备之间传。
    </div>`;
}

function openSyncSheet() {
  openSheet({
    title: '多设备同步',
    body: syncBodyHtml(),
    footer: `<button class="btn ghost" data-close>关闭</button>`,
  });
  if (lanInfo.on) startLanPoll();
}

/* ---- 局域网 ---- */

function lanParse(raw, fallback) {
  try { return JSON.parse(String(raw)); } catch (e) { return fallback; }
}

function lanStart() {
  if (!hasLan()) { toast('这台设备没有局域网能力'); return; }
  const r = lanParse(window.Native.lanStart(), { ok: false, msg: '启动失败' });
  if (!r.ok) { toast(r.msg || '没能开启，检查是否连了 WiFi'); return; }
  lanInfo.on = true;
  window.__lanOn = true;
  lanInfo.ip = r.ip || '';
  lanInfo.port = r.port || 0;
  lanInfo.code = r.code || '';
  lanInfo.scanning = false;
  lanPeers = [];
  // 把当前数据交给原生缓存，对方来取就能直接拿到
  window.Native.lanPublish(JSON.stringify(buildSyncPacket()));
  refreshSyncSheet();
  startLanPoll();
  toast('已开启接收', 'check');
}

function lanStop() {
  window.__lanOn = false;
  if (hasLan()) window.Native.lanStop();
  lanInfo = { on: false, ip: '', port: 0, code: '', scanning: false };
  lanPeers = [];
  stopLanPoll();
  refreshSyncSheet();
}

function lanScan() {
  if (!hasLan() || !lanInfo.on) return;
  const r = lanParse(window.Native.lanScanStart(2600), null);
  if (!r || !r.ok) { toast((r && r.msg) || '没能开始查找'); return; }

  lanInfo.scanning = true;
  refreshSyncSheet();
  const t0 = Date.now();
  let lastSig = '';

  const step = () => {
    if (!sheetOpen() || !$('#sync-device')) { lanInfo.scanning = false; return; }
    const st = lanParse(window.Native.lanScanResult(), null) || {};
    const list = (st.peers || []).filter(p => p && p.ip && p.ip !== lanInfo.ip);
    const sig = JSON.stringify(list);
    if (sig !== lastSig) {
      lastSig = sig;
      lanPeers = list;
      refreshSyncSheet();               // 边扫边出，扫到一台就显示一台
    }
    if (!st.scanning || Date.now() - t0 > 8000) {
      lanInfo.scanning = false;
      refreshSyncSheet();
      if (!lanPeers.length) {
        toast('没找到另一台手机。两台要连同一个 WiFi，有些校园网或公司网不允许设备互访，这种情况用「用文件同步」');
      }
      return;
    }
    setTimeout(step, 400);
  };
  setTimeout(step, 400);
}

let lanTarget = null;

/** 点某台设备后先要配对码：光扫到 IP 不该就能读走工资数据 */
function lanAskCode(el) {
  lanTarget = {
    ip: el.dataset.ip,
    port: Number(el.dataset.port),
    name: el.dataset.name || '另一台手机',
  };
  openSheet({
    title: '连接到 ' + lanTarget.name,
    body: `
      <div class="help-note" style="margin-top:0">在<b>对方手机上</b>看到 4 位配对码，输在这里。配对码只在开启接收期间有效。</div>
      <div class="field">
        <div class="field-label">配对码</div>
        <input class="input" id="lan-code" inputmode="numeric" maxlength="4" placeholder="····"
               style="letter-spacing:8px;font-size:22px;text-align:center;font-weight:700">
      </div>`,
    footer: `<button class="btn ghost" data-act="lan-back">返回</button>
      <button class="btn" data-act="lan-go">开始同步</button>`,
  });
}

function lanGo() {
  const t = lanTarget;
  if (!t || !hasLan()) return;
  const code = (($('#lan-code') || {}).value || '').trim();
  if (!/^\d{4}$/.test(code)) { toast('配对码是 4 位数字'); return; }

  const started = lanParse(
    window.Native.lanSyncStart(t.ip, t.port, code, JSON.stringify(buildSyncPacket())), null);
  if (!started || !started.ok) {
    toast((started && started.msg) || '没能开始同步');
    return;
  }
  closeSheet();
  toast('正在和 ' + t.name + ' 同步…');

  const t0 = Date.now();
  const step = () => {
    const st = lanParse(window.Native.lanSyncPoll(), null) || {};
    if (st.state !== 'done') {
      if (Date.now() - t0 > 30000) { toast('同步超时，检查两台是否在同一个 WiFi'); return; }
      setTimeout(step, 300);
      return;
    }
    const res = st.result || {};
    if (!res.ok) { toast(res.msg || '同步失败'); return; }

    let stats = null;
    if (res.pulled) {
      try {
        stats = mergeSyncPacket(res.pulled);
        save();
        render();
      } catch (e) {
        toast(e && e.message ? e.message : '对方的数据读不了');
        return;
      }
    }
    lastSyncStats = stats;
    openSyncResult(stats, t.name);
  };
  setTimeout(step, 300);
}

/** 对方推过来的包，轮询取回来合并 */
function lanDrainInbox() {
  if (!hasLan() || !lanInfo.on) return;
  const r = lanParse(window.Native.lanInbox(), { items: [] });
  const items = Array.isArray(r.items) ? r.items : [];
  if (!items.length) return;
  let total = null;
  items.forEach(it => {
    try {
      const st = mergeSyncPacket(it.packet);
      total = total || { added: 0, updated: 0, removed: 0, from: it.from || '另一台手机' };
      total.added += st.added; total.updated += st.updated; total.removed += st.removed;
    } catch (e) { /* 坏包直接跳过，不影响其他 */ }
  });
  if (total) {
    save();
    render();
    lastSyncStats = total;
    toast(`已与 ${total.from} 同步：新增 ${total.added}、更新 ${total.updated}`);
    refreshSyncSheet();
  }
}

function startLanPoll() {
  stopLanPoll();
  lanTimer = setInterval(() => {
    // 面板关了就停：没必要在后台一直轮询，省电也省心
    if (!sheetOpen() || !$('#sync-device')) { stopLanPoll(); return; }
    try { lanDrainInbox(); } catch (e) { /* 轮询失败不打扰用户 */ }
  }, 1200);
}

function stopLanPoll() {
  if (lanTimer) { clearInterval(lanTimer); lanTimer = 0; }
}

function refreshSyncSheet() {
  const body = $('#sheetBody');
  if (!body || !$('#sync-device')) return;      // 面板已关，别乱重绘
  body.innerHTML = syncBodyHtml();
}

/* ---- 文件 ---- */

function exportSyncFile() {
  const pkt = buildSyncPacket();
  saveTextAs(`课酬同步_${todayYmd()}.kbsync`, JSON.stringify(pkt, null, 2), 'application/json', '课酬同步包');
}

function importSyncFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.kbsync,.json';
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        pendSyncPkt = parseSyncPacket(String(reader.result));
        openSyncPreview(pendSyncPkt);
      } catch (e) {
        toast(e && e.message ? e.message : '这个文件不是同步包');
      }
    };
    reader.onerror = () => toast('文件读取失败');
    reader.readAsText(file);
  };
  input.click();
}

function openSyncPreview(pkt) {
  const d = pkt.data || {};
  const dev = (pkt.device && pkt.device.name) || '另一台手机';
  const at = Number(pkt.at) || 0;
  const p = n => String(n).padStart(2, '0');
  const dt = at ? (() => { const x = new Date(at); return `${x.getMonth() + 1}月${x.getDate()}日 ${p(x.getHours())}:${p(x.getMinutes())}`; })() : '';
  const nLessons = Array.isArray(d.lessons) ? d.lessons.length : 0;

  openSheet({
    title: '合并这份同步包',
    body: `
      <div class="rows" style="background:#F7F9FC;border-radius:14px">
        <div class="row" style="padding:12px 13px">
          <div class="ri" style="background:var(--brand-soft);color:var(--brand)">${ic('grid', 16)}</div>
          <div class="rc"><div class="t" style="font-size:14px">${esc(dev)}</div>
            <div class="s">${nLessons} 节课${dt ? ' · ' + dt + ' 导出' : ''}</div></div>
        </div>
        <div class="row" style="padding:12px 13px;border-top:1px solid var(--line-2)">
          <div class="rc"><div class="t" style="font-size:13.5px">本机现有</div></div>
          <div class="rv">${state.lessons.length} 节课</div>
        </div>
      </div>
      <div class="help-note">
        合并<b>不会覆盖</b>本机数据：两边各自加的课都留下，同一条记录两边都改过时以改得晚的为准。
        删除也会同步过来。
      </div>`,
    footer: `<button class="btn ghost" data-close>取消</button>
      <button class="btn" data-act="sync-apply">合并</button>`,
  });
}

function applySyncPkt() {
  if (!pendSyncPkt) return;
  let stats;
  try {
    stats = mergeSyncPacket(pendSyncPkt);
  } catch (e) {
    toast(e && e.message ? e.message : '合并失败');
    return;
  }
  pendSyncPkt = null;
  save();
  render();
  lastSyncStats = stats;
  openSyncResult(stats, stats.from);
}

function openSyncResult(stats, from) {
  const s = stats || { added: 0, updated: 0, removed: 0 };
  const rows = [
    ['新增', s.added, 'var(--mint)'],
    ['更新', s.updated, 'var(--brand)'],
    ['删除', s.removed, 'var(--rose)'],
  ].filter(x => x[1] > 0);

  openSheet({
    title: '同步完成',
    body: `
      <div class="help-note" style="margin-top:0">已与 <b>${esc(from || '另一台手机')}</b> 合并，本机现在有 ${state.lessons.length} 节课。</div>
      <div class="rows" style="background:#F7F9FC;border-radius:14px;margin-top:12px">
        ${rows.length ? rows.map((r, i) => `
          <div class="row" style="padding:12px 13px${i ? ';border-top:1px solid var(--line-2)' : ''}">
            <div class="rc"><div class="t" style="font-size:13.5px">${r[0]}</div></div>
            <div class="rv" style="color:${r[2]}">${r[1]} 条</div>
          </div>`).join('')
    : '<div class="help-note" style="margin:0;padding:12px 13px">两边已经一致，没有需要合并的改动。</div>'}
      </div>
      <div class="help-note">建议也把这次结果同步回对方，两边就完全一致了。</div>`,
    footer: `<button class="btn" data-close>好</button>`,
  });
}

function openBackupSheet() {
  openSheet({
    title: '备份与恢复',
    body: `
      <div class="rows">
        <div class="row" data-act="export-data">
          <div class="ri" style="background:var(--mint-soft);color:var(--mint)">${ic('download', 17)}</div>
          <div class="rc"><div class="t">导出备份文件</div><div class="s">存成 JSON，换手机或重装后恢复</div></div>
          ${ic('right', 15)}
        </div>
        <div class="row" data-act="import-data">
          <div class="ri" style="background:#F2F4F7;color:var(--ink-2)">${ic('doc', 17)}</div>
          <div class="rc"><div class="t">从备份恢复</div><div class="s">选择之前导出的 JSON 文件</div></div>
          ${ic('right', 15)}
        </div>
      </div>
      <div class="help-note" style="margin-top:12px">
        恢复会<b>覆盖当前所有数据</b>，建议先导出一份再操作。备份文件只存在你选择的位置，不会上传。
      </div>`,
    footer: `<button class="btn ghost" data-close>关闭</button>`,
  });
}

function openTeacherSheet() {
  const t = state.teacher;
  openSheet({
    title: '个人信息',
    body: `
      <div class="field">
        <div class="field-label">姓名</div>
        <input class="input" id="tc-name" value="${esc(t.name)}" placeholder="张老师">
      </div>
      <div class="field">
        <div class="field-label">学校</div>
        <input class="input" id="tc-school" value="${esc(t.school)}" placeholder="阳光中学">
      </div>
      <div class="field">
        <div class="field-label">任教学科</div>
        <input class="input" id="tc-subject" value="${esc(t.subject)}" placeholder="数学">
      </div>
      <div style="height:6px"></div>
    `,
    footer: `<button class="btn ghost" data-close>取消</button><button class="btn" data-act="teacher-save">保存</button>`,
  });
}

/* ============================================================
   提醒
   ============================================================ */
function notifyPermissionState() {
  if (IS_NATIVE) return NATIVE.hasNotifyPermission() ? 'granted' : 'default';
  return ('Notification' in window) ? Notification.permission : 'unsupported';
}

async function requestNotifyPermission() {
  if (IS_NATIVE) {
    if (NATIVE.hasNotifyPermission()) return true;
    NATIVE.requestNotifyPermission();
    toast('请在系统弹窗中允许通知');
    // 系统弹窗是异步的，稍后再确认一次结果
    setTimeout(() => {
      if (NATIVE.hasNotifyPermission()) {
        toast('通知已开启', 'check');
        syncNativeReminders();
        renderMine();
      }
    }, 1200);
    return NATIVE.hasNotifyPermission();
  }
  if (!('Notification' in window)) { toast('当前浏览器不支持系统通知'); return false; }
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') { toast('通知权限已被拒绝，请在浏览器设置中开启'); return false; }
  try {
    const p = await Notification.requestPermission();
    return p === 'granted';
  } catch (e) { return false; }
}

function fireNotify(title, body, tag) {
  if (IS_NATIVE) {
    try { NATIVE.notifyNow(title, body); } catch (e) { /* ignore */ }
    return;
  }
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body, tag, silent: false }); } catch (e) { /* ignore */ }
  }
  toast(`${title} · ${body}`, 'bell');
}

function checkReminders() {
  // 原生安装包里提醒交给系统闹钟，页面不再重复触发，避免同一条提醒弹两次
  if (IS_NATIVE) return;
  const s = state.settings;
  if (!s.remindEnabled) return;
  const now = Date.now();
  const lead = Number(s.remindBefore) * 60000;
  const t = todayYmd();

  state.lessons.forEach(l => {
    if (l.status === 'canceled' || l.status === 'leave') return;
    if (l.date !== t) return;
    const start = lessonStart(l).getTime();
    const diff = start - now;
    const key = `${l.id}@${l.date}#${l.period}`;
    if (diff > 0 && diff <= lead && !state.meta.notified[key]) {
      state.meta.notified[key] = 1;
      const typ = getType(l.typeId);
      fireNotify(`${Math.round(diff / 60000)} 分钟后上课`,
        `${l.klass} · ${typ.name} · ${periodTime(l.period).start}`, key);
    }
  });

  // 每日小结
  if (s.dailyRemind) {
    const [hh, mm] = (s.dailyRemindAt || '21:00').split(':').map(Number);
    const d = new Date();
    if (d.getHours() === hh && d.getMinutes() === mm) {
      const key = `daily_${t}`;
      if (!state.meta.notified[key]) {
        state.meta.notified[key] = 1;
        fireNotify('今日课时小结', `今天 ${dayCount(t)} 节课，共 ${money(dayFee(t))}`, key);
      }
    }
  }

  // 清理过期标记
  const keys = Object.keys(state.meta.notified);
  if (keys.length > 400) {
    state.meta.notified = {};
  }
  save();
}

function startReminderLoop() {
  setTimeout(checkReminders, 1200);
  setInterval(checkReminders, 30000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { checkReminders(); render(); }
  });
}

/* ---------------- 原生闹钟调度 ----------------
   网页只负责算出「几点几分提醒什么」，具体到点弹窗由系统闹钟完成，
   这样 App 被划掉、手机息屏也不会漏提醒。                       */
const REMIND_HORIZON_DAYS = 15;

function buildReminderPayload() {
  const s = state.settings;
  if (!s.remindEnabled) return [];
  const lead = Number(s.remindBefore) * 60000;
  const now = Date.now();
  const limit = now + REMIND_HORIZON_DAYS * 86400000;
  const out = [];

  state.lessons.forEach(l => {
    if (l.status === 'canceled' || l.status === 'leave') return;
    if (now - 8 * 86400000 > lessonStart(l).getTime()) return; // 只关心近期课程
    const at = lessonStart(l).getTime() - lead;
    if (at <= now + 5000 || at > limit) return;
    const typ = getType(l.typeId);
    out.push({
      at,
      id: `l_${l.id}_${l.date}_${l.period}`,
      title: `${Number(s.remindBefore)} 分钟后上课`,
      body: `${l.klass} · ${typ.name} · ${periodTime(l.period).start}-${periodTime(l.period).end}`,
    });
  });

  if (s.dailyRemind) {
    const [hh, mm] = String(s.dailyRemindAt || '21:00').split(':').map(Number);
    for (let i = 0; i < REMIND_HORIZON_DAYS; i++) {
      const d = addDays(new Date(), i);
      d.setHours(hh || 21, mm || 0, 0, 0);
      const at = d.getTime();
      if (at <= now + 5000) continue;
      out.push({
        at,
        id: `daily_${ymd(d)}`,
        title: '今日课时小结',
        body: '点开看看今天上了几节课、挣了多少',
      });
    }
  }

  return out.sort((a, b) => a.at - b.at).slice(0, 120);
}

let remSyncTimer = null;
function syncNativeReminders() {
  if (!IS_NATIVE) return;
  try {
    NATIVE.syncReminders(JSON.stringify(buildReminderPayload()));
  } catch (e) {
    console.warn('提醒同步失败', e);
  }
}
function scheduleReminderSync() {
  if (!IS_NATIVE) return;
  clearTimeout(remSyncTimer);
  remSyncTimer = setTimeout(syncNativeReminders, 1500);
}

/* 接管 Android 返回键：先关弹层，再回落首页，都没有才退出应用 */
function handleNativeBack() {
  if (sheetOpen()) { closeSheet(); return true; }
  const mo = $('#modalOverlay');
  if (mo && mo.classList.contains('show')) {
    const cancel = mo.querySelector('[data-modal="cancel"]');
    if (cancel) cancel.click(); else mo.classList.remove('show');
    return true;
  }
  if (currentTab !== 'home') { switchTab('home'); return true; }
  return false;
}
if (IS_NATIVE) {
  window.__kebaoBack = handleNativeBack;
  // 点「有新版本」通知进来：直接打开更新面板并静默检查一次
  window.__kebaoOpenUpdate = function () {
    try { openUpdateSheet(); checkUpdate(true); } catch (e) { }
    return true;
  };
  window.addEventListener('resize', () => {
    // 键盘弹起时保持页面不被顶飞
    if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
      setTimeout(() => document.activeElement.scrollIntoView({ block: 'center' }), 260);
    }
  });
}

/* ============================================================
   数据管理
   ============================================================ */
/** 把文本写成文件：安卓弹系统「保存到」自选路径，浏览器走文件选择器 / 下载 */
function saveTextAs(fileName, content, mime, desc) {
  const ext = (fileName.match(/\.[a-z0-9]+$/i) || ['.txt'])[0];

  // 安卓：弹系统「保存到」界面，目录和文件名都由自己选
  if (IS_NATIVE && NATIVE.saveFileAs) {
    window.__onSaveAsResult = (ok, msg) => {
      window.__onSaveAsResult = null;
      if (ok) toast('已保存到所选位置', 'download');
      else if (msg === 'canceled') toast('已取消保存');
      else toast('保存失败：' + msg);
    };
    try { NATIVE.saveFileAs(fileName, content, mime); return; }
    catch (e) { window.__onSaveAsResult = null; /* 落到默认目录 */ }
  }

  // 安卓（旧版）：直接放到「下载」目录
  if (IS_NATIVE) {
    let err = null;
    try { err = NATIVE.saveFile(fileName, content, mime); }
    catch (e) { err = String(e && e.message ? e.message : e); }
    if (!err) toast('已保存到手机「下载」目录', 'download');
    else toast('保存失败：' + err);
    return;
  }

  // 浏览器：桌面版支持选择保存位置，不支持就按默认下载
  const download = () => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('已导出文件', 'download');
  };

  if (window.showSaveFilePicker) {
    try {
      window.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: desc || '文件', accept: { [mime]: [ext] } }],
      }).then(async handle => {
        const ws = await handle.createWritable();
        await ws.write(content);
        await ws.close();
        toast('已保存到所选位置', 'download');
      }).catch(err => {
        if (err && err.name === 'AbortError') return;
        download();
      });
      return;
    } catch (e) { /* 环境不允许，退回下载 */ }
  }
  download();
}

/* ---------- 月账单：能交出去的那种 ---------- */

/** 纯文本月报，直接粘到微信里发给教务，或者自己存档 */
function monthStatementText(ym) {
  const m = calcMonth(ym);
  const t = state.teacher;
  const who = [t.school, t.name, t.subject].filter(Boolean).join(' · ');
  const L = [];
  L.push(`课酬月报 · ${monthLabel(ym)}`);
  if (who) L.push(who);
  L.push('');
  L.push(`总课酬　${money(m.total)}`);
  if (m.extraAdd || m.extraSub) {
    L.push(`　课时费　${money(m.lessonTotal)}`);
    if (m.extraAdd) L.push(`　补贴　　+${money(m.extraAdd)}`);
    if (m.extraSub) L.push(`　扣款　　−${money(m.extraSub)}`);
    m.extraRows.forEach(e => {
      L.push(`　　· ${e.name} ${e.kind === 'sub' ? '−' : '+'}${money(Math.abs(Number(e.amount) || 0))}`
        + `${e.cycle === 'monthly' ? '（每月）' : ''}`);
    });
  }
  L.push(`课程　　${m.count} 节（已完成 ${m.doneCount} 节，待上 ${m.planCount} 节）`);
  L.push(`已完成　${money(m.doneFee)}`);
  if (m.planCount) L.push(`待上　　${money(m.planFee)}`);
  L.push(`折课时　${m.km} 节（按 45 分钟折算）`);

  if (m.byType.length) {
    L.push('');
    L.push('按类型');
    m.byType.forEach(x => {
      const cnt = x.count ? `${x.count} 节` : '仅延长';
      L.push(`　${x.name}　${cnt}　${money(x.fee)}`);
    });
  }

  if (m.rows.length) {
    L.push('');
    L.push('逐节明细');
    m.rows.forEach(r => {
      const pt = periodTime(r.lesson.period);
      L.push(`　${r.lesson.date.slice(5)} ${weekdayCN(r.lesson.date)} ${pt.name}　`
        + `${r.lesson.klass || '未命名'}·${r.type.name}　${money(r.subtotal)}`);
    });
  }

  L.push('');
  L.push(`生成于 ${todayYmd()} · 课酬`);
  return L.join('\n');
}

/** CSV 单元格：含逗号/引号/换行时才加引号 */
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** 表格版月报：Excel / WPS / 石墨都能直接打开，数字列保持纯数字好求和 */
function monthStatementCsv(ym) {
  const m = calcMonth(ym);
  const head = ['日期', '星期', '节次', '时间', '班级', '科目', '类型',
    '数量', '计价单位', '单价', '班级系数', '延长分钟', '小计', '状态'];
  const lines = [head.map(csvCell).join(',')];
  m.rows.forEach(r => {
    const pt = periodTime(r.lesson.period);
    lines.push([
      r.lesson.date,
      weekdayCN(r.lesson.date),
      pt.name,
      `${pt.start}-${pt.end}`,
      r.lesson.klass || '',
      r.lesson.subject || state.teacher.subject || '',
      r.type.name,
      r.qty,
      r.unitLabel,
      r.unitPrice,
      r.classFactor,
      r.extend ? r.extend.minutes : 0,
      r.subtotal,
      r.done ? '已完成' : '待上',
    ].map(csvCell).join(','));
  });
  // 补贴与扣款也占一行，明细看着才完整（一进一出在小计列带符号）
  m.extraRows.forEach(e => {
    const amt = Math.abs(Number(e.amount) || 0);
    lines.push([
      '', '', '', '', e.name || '未命名', '',
      e.kind === 'sub' ? '扣款' : '补贴',
      '', '', amt, '', '',
      e.kind === 'sub' ? -amt : amt,
      e.cycle === 'monthly' ? '每月固定' : '一次性',
    ].map(csvCell).join(','));
  });
  // 合计行：金额列放在「小计」那一列
  lines.push(['合计', '', '', '', '', '', '', '', '', '', '', '', m.total, '']
    .map(csvCell).join(','));
  return '\ufeff' + lines.join('\r\n');   // 带 BOM，Excel 才认得中文
}

function copyMonthStatement() {
  copyText(monthStatementText(payMonth), '月报已复制，去粘贴吧');
}

function exportMonthStatement() {
  saveTextAs(`课酬账单_${payMonth}.csv`, monthStatementCsv(payMonth), 'text/csv', '账单表格');
}

/* ============================================================
   同步引擎：记录级修订 + 双向合并
   ------------------------------------------------------------
   目标：两台设备各改各的，同步之后谁的改动都不丢。
   做法：
     1) 每次保存时给每条记录算一个指纹。指纹变了就记下修改时间（rev），
        记录消失了就留一个删除标记（tomb，带时间）——否则下次同步会被对方"复活"。
     2) 同步时按实体对齐：同一实体谁的时间新用谁；只有删除标记足够新才算真删，
        否则一律当成"对方还没有这条"。
   合并以并集为底，所以不会因为一端数据旧就把那边的课抹掉。
   ============================================================ */

/** 各实体集合：prefix 用于生成实体键，取 id 的方式各不相同 */
const SYNC_SETS = [
  { key: 'lessons',   p: 'l', get: s => s.lessons || [],   id: r => r && r.id },
  { key: 'swaps',     p: 'w', get: s => s.swaps || [],     id: r => r && r.id },
  { key: 'adjusts',   p: 'j', get: s => s.adjusts || [],   id: r => r && r.id },
  { key: 'extras',    p: 'x', get: s => s.extras || [],    id: r => r && r.id },
  { key: 'schemes',   p: 'c', get: s => s.schemes || [],   id: r => r && r.id },
  { key: 'types',     p: 't', get: s => s.types || [],     id: r => r && r.id },
  { key: 'periods',   p: 'q', get: s => s.periods || [],   id: r => r && r.no != null ? String(r.no) : '' },
  { key: 'holidays',  p: 'h', get: s => s.holidays || [],  id: r => r && r.date },
  { key: 'templates', p: 'n', get: s => s.templates || [], id: r => r && r.id },
];

/** 键值对实体：master 的总课表模板，键本身就是身份 */
const SYNC_MAPS = [
  { key: 'master', p: 'k', get: s => s.master || {} },
];

/** 扁平配置：按字段合并，改单价和改系数互不覆盖 */
const SYNC_FLATS = [
  { key: 'settings', p: 's', get: s => s.settings || {} },
  { key: 'teacher',  p: 'r', get: s => s.teacher || {} },
];

/** 键序稳定的序列化：同一份内容永远得到同一个字符串 */
function stableKey(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(stableKey).join(',') + ']';
  const ks = Object.keys(v).filter(k => v[k] !== undefined).sort();
  return '{' + ks.map(k => JSON.stringify(k) + ':' + stableKey(v[k])).join(',') + '}';
}

/** FNV-1a 32 位，够用来判断"变没变"，不需要抗碰撞强度 */
function shortHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** 把整份状态摊平成 Map<实体键, {fp, rec}> */
function collectEntities(st) {
  const map = new Map();
  SYNC_SETS.forEach(def => {
    (def.get(st) || []).forEach(rec => {
      const id = def.id(rec);
      if (id == null || id === '') return;
      const k = def.p + ':' + id;
      map.set(k, { fp: shortHash(stableKey(rec)), rec });
    });
  });
  SYNC_MAPS.forEach(def => {
    const obj = def.get(st) || {};
    Object.keys(obj).forEach(k2 => {
      map.set(def.p + ':' + k2, { fp: shortHash(stableKey(obj[k2])), rec: obj[k2] });
    });
  });
  SYNC_FLATS.forEach(def => {
    const obj = def.get(st) || {};
    Object.keys(obj).forEach(f => {
      if (f === 'updateCache' || f === 'lastUpdateOk') return;   // 纯本机状态，不同步
      map.set(def.p + '.' + f, { fp: shortHash(stableKey(obj[f])) });
    });
  });
  return map;
}

/**
 * 比对指纹，更新修订表。save() 里顺手调用，业务代码不用管"我该不该记时间"。
 * 首次建立基线时统一记 0：那是"历史数据，不知道谁先改的"，
 * 合并时并列取本地，等价于各留各的，不会出现一边全胜一边全丢。
 */
function trackChanges() {
  const now = Date.now();
  const meta = state.meta;
  if (!meta.rev) meta.rev = {};
  if (!meta.fp) meta.fp = {};
  if (!meta.tomb) meta.tomb = {};

  const cur = collectEntities(state);
  const base = meta.syncInit ? { ...meta.fp } : null;

  cur.forEach((e, k) => {
    if (!base) { meta.rev[k] = 0; meta.fp[k] = e.fp; return; }
    if (base[k] !== e.fp) {
      meta.rev[k] = now;
      meta.fp[k] = e.fp;
      delete meta.tomb[k];
    }
  });

  if (base) {
    Object.keys(base).forEach(k => {
      if (cur.has(k)) return;
      meta.tomb[k] = now;
      delete meta.rev[k];
      delete meta.fp[k];
    });
  }
  meta.syncInit = 1;
}

/** 删除标记留太久没意义，顺手清掉，别让它把存储撑大 */
function pruneSyncMeta() {
  const meta = state.meta;
  const alive = collectEntities(state);
  const keepKeys = new Set(alive.keys());

  Object.keys(meta.fp || {}).forEach(k => { if (!keepKeys.has(k)) delete meta.fp[k]; });
  Object.keys(meta.rev || {}).forEach(k => { if (!keepKeys.has(k)) delete meta.rev[k]; });

  const cutoff = Date.now() - 180 * 86400000;
  Object.keys(meta.tomb || {}).forEach(k => {
    if (Number(meta.tomb[k]) < cutoff) delete meta.tomb[k];
  });
}

function deviceInfo() {
  const meta = state.meta;
  if (!meta.deviceId) meta.deviceId = 'd' + Math.random().toString(36).slice(2, 10);
  let model = '';
  try {
    const n = window.Native;
    if (n && typeof n.deviceName === 'function') model = String(n.deviceName() || '');
  } catch (e) { model = ''; }
  if (!model && typeof navigator !== 'undefined' && navigator.userAgent) {
    const m = /Android[^;]*;\s*([^)]+)\)/.exec(navigator.userAgent);
    model = m ? m[1].split('Build')[0].trim() : '';
  }
  return { id: meta.deviceId, name: meta.deviceName || model || '这台设备', model };
}

function setDeviceName(name) {
  state.meta.deviceName = String(name || '').trim().slice(0, 16);
  save();
}

/* ---- 同步包 ---- */

const SYNC_MAGIC = 'kbsync';

function buildSyncPacket() {
  // 有些字段只对本机有意义（更新清单缓存、上次检查时间），传过去反而会
  // 让对方的「检查更新」显示成没检查过，直接在包里剔掉
  const settings = { ...state.settings };
  delete settings.updateCache;
  delete settings.lastUpdateOk;

  return {
    kb: SYNC_MAGIC,
    v: 1,
    device: deviceInfo(),
    at: Date.now(),
    rev: state.meta.rev || {},
    tomb: state.meta.tomb || {},
    data: {
      teacher: state.teacher,
      settings,
      types: state.types,
      periods: state.periods,
      lessons: state.lessons,
      swaps: state.swaps,
      master: state.master,
      adjusts: state.adjusts,
      holidays: state.holidays,
      templates: state.templates,
      extras: state.extras,
      schemes: state.schemes,
    },
  };
}

/** 接受字符串或已解析对象；格式不对抛中文错误，界面直接显示 */
function parseSyncPacket(input) {
  let pkt = input;
  if (typeof input === 'string') {
    try {
      pkt = JSON.parse(input);
    } catch (e) {
      throw new Error('这段内容不是有效的同步包');
    }
  }
  if (!pkt || pkt.kb !== SYNC_MAGIC) throw new Error('不是课酬的同步包');
  if (Number(pkt.v) > 1) throw new Error('同步包来自更新版本，请先升级');
  if (!pkt.data || typeof pkt.data !== 'object') throw new Error('同步包里没有数据');
  return pkt;
}

/**
 * 合并：把 pkt 的改动并进本地状态，返回统计。
 * 不覆盖、不删除对方的独有数据——只按修订时间取新。
 */
function mergeSyncPacket(input) {
  const pkt = parseSyncPacket(input);
  const remote = pkt.data;
  const rrev = pkt.rev || {};
  const rtomb = pkt.tomb || {};

  const meta = state.meta;
  if (!meta.rev) meta.rev = {};
  if (!meta.tomb) meta.tomb = {};
  const lrev = meta.rev;
  const ltomb = meta.tomb;

  const stats = { added: 0, updated: 0, removed: 0, kept: 0, from: (pkt.device && pkt.device.name) || '另一台设备' };

  // 先保证本地修订表是最新的（否则刚做的改动会被判成"旧"）
  trackChanges();

  /** 判断某个实体该取哪边 */
  const pick = (k, localRec, hasLocal, remoteRec, hasRemote) => {
    const lr = Number(lrev[k]) || 0;
    const rr = Number(rrev[k]) || 0;
    const lt = Number(ltomb[k]) || 0;
    const rt = Number(rtomb[k]) || 0;

    // 对方删除了这条，且删除时间不早于本地的最后修改
    if (rt && rt >= lr && !(lt && lt > rt)) return { act: 'del', rev: rt, tomb: rt };
    // 本地删除了，对方也没更新的版本
    if (lt && lt > rr) return { act: 'del', rev: lt, tomb: lt };

    if (hasRemote && !hasLocal) return { act: 'add', rec: remoteRec, rev: Math.max(rr, lr) };
    if (hasRemote && hasLocal) {
      if (rr > lr) return { act: 'upd', rec: remoteRec, rev: rr };
      return { act: 'same', rec: localRec, rev: lr };
    }
    return { act: 'keep', rec: localRec, rev: lr };
  };

  // 集合类：按本地顺序走一遍（保留/更新/删除），远端独有的追加在后面。
  // 这样合并后课表顺序基本不变，不会因为同步一次就乱了序。
  SYNC_SETS.forEach(def => {
    const byId = new Map();
    (def.get(state) || []).forEach(r => {
      const id = def.id(r);
      if (id != null && id !== '') byId.set(String(id), r);
    });
    const remoteById = new Map();
    (def.get(remote) || []).forEach(r => {
      const id = def.id(r);
      if (id != null && id !== '') remoteById.set(String(id), r);
    });

    const out = [];
    byId.forEach((rec, id) => {
      const k = def.p + ':' + id;
      const r = pick(k, rec, true, remoteById.get(id), remoteById.has(id));
      if (r.act === 'del') {
        stats.removed++;
        delete lrev[k];
        ltomb[k] = r.tomb || Date.now();
        return;
      }
      if (r.act === 'upd') { out.push(r.rec); stats.updated++; }
      else out.push(rec);
      if (r.rev) lrev[k] = r.rev;
      delete ltomb[k];
    });

    remoteById.forEach((rec, id) => {
      if (byId.has(id)) return;
      const k = def.p + ':' + id;
      const r = pick(k, null, false, rec, true);
      if (r.act === 'del') { delete lrev[k]; ltomb[k] = r.tomb || Date.now(); return; }
      out.push(r.rec || rec);
      stats.added++;
      lrev[k] = r.rev || Date.now();
      delete ltomb[k];
    });

    state[def.key] = out;
  });

  // 键值类（总课表模板）：逐键判断，键就是身份
  SYNC_MAPS.forEach(def => {
    const next = { ...(def.get(state) || {}) };
    const remoteObj = def.get(remote) || {};
    Object.keys(remoteObj).forEach(id => {
      const k = def.p + ':' + id;
      const hasL = Object.prototype.hasOwnProperty.call(next, id);
      const r = pick(k, next[id], hasL, remoteObj[id], true);
      if (r.act === 'del') {
        if (hasL) { delete next[id]; stats.removed++; }
        delete lrev[k];
        ltomb[k] = r.tomb || Date.now();
        return;
      }
      if (r.act === 'add') { next[id] = r.rec; stats.added++; }
      else if (r.act === 'upd') { next[id] = r.rec; stats.updated++; }
      if (r.rev) lrev[k] = r.rev;
      delete ltomb[k];
    });
    // 本地独有的键：对方删过就删，没删就留
    Object.keys(next).forEach(id => {
      if (Object.prototype.hasOwnProperty.call(remoteObj, id)) return;
      const k = def.p + ':' + id;
      const rt = Number(rtomb[k]) || 0;
      const lr = Number(lrev[k]) || 0;
      if (rt && rt >= lr) {
        delete next[id];
        stats.removed++;
        delete lrev[k];
        ltomb[k] = rt;
      }
    });
    state[def.key] = next;
  });

  // 扁平配置：逐字段判断，改单价和改系数互不覆盖
  SYNC_FLATS.forEach(def => {
    const next = { ...(def.get(state) || {}) };
    const remoteObj = def.get(remote) || {};
    Object.keys(remoteObj).forEach(f => {
      if (f === 'updateCache' || f === 'lastUpdateOk') return;   // 纯本机状态，不同步
      const k = def.p + '.' + f;
      const lr = Number(lrev[k]) || 0;
      const rr = Number(rrev[k]) || 0;
      const rt = Number(rtomb[k]) || 0;
      if (rt && rt >= lr) {
        delete next[f];
        delete lrev[k];
        ltomb[k] = rt;
        return;
      }
      if (rr > lr) {
        next[f] = remoteObj[f];
        lrev[k] = rr;
        delete ltomb[k];
        stats.updated++;
      }
    });
    state[def.key] = next;
  });

  // 合并完重算指纹，避免下一轮 save 把刚合进来的记录当成"本地新改"
  const fresh = collectEntities(state);
  meta.fp = {};
  fresh.forEach((e, k) => { meta.fp[k] = e.fp; });

  // 修订表对齐：取双方较大值，下次同步不会重复搬运。
  // 删除标记只在「本地确实没有这条」时才接受——否则刚被较新修改救活的记录
  // 会带着对方的旧墓碑传下去，下一轮又被删掉（这个坑真踩过）。
  Object.keys(rrev).forEach(k => {
    const r = Number(rrev[k]) || 0;
    if (r > (Number(lrev[k]) || 0)) lrev[k] = r;
  });
  Object.keys(rtomb).forEach(k => {
    const r = Number(rtomb[k]) || 0;
    if (r > (Number(ltomb[k]) || 0) && !fresh.has(k)) ltomb[k] = r;
  });

  // 兜底：记录在，墓碑就不该留。防止前面任何一条分支漏清理
  Object.keys(ltomb).forEach(k => {
    if (fresh.has(k)) delete ltomb[k];
  });
  meta.syncInit = 1;
  meta.syncAt = Date.now();
  meta.syncPeer = stats.from;

  return stats;
}


function exportData() {
  saveTextAs(`课酬备份_${todayYmd()}.json`, JSON.stringify(state, null, 2), 'application/json', '课酬备份');
}

/** 复制文本：优先剪贴板 API，不行就退回隐藏 textarea */
function copyText(text, okMsg) {
  const ok = () => toast(okMsg || '已复制', 'check');
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const done = document.execCommand && document.execCommand('copy');
      ta.remove();
      return !!done;
    } catch (e) { return false; }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(ok).catch(() => {
      if (fallback()) ok(); else toast('复制失败，请长按文本框全选复制');
    });
    return;
  }
  if (fallback()) ok(); else toast('复制失败，请长按文本框全选复制');
}

function importDataFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!data || !Array.isArray(data.lessons)) throw new Error('格式不正确');
        confirmModal({
          title: '恢复备份',
          desc: `将导入 ${data.lessons.length} 条课程记录，覆盖当前数据。`,
          okText: '覆盖恢复',
          danger: true,
          onDone: ok => {
            if (!ok) return;
            state = {
              ...state,
              ...data,
              settings: { ...defaultSettings(), ...(data.settings || {}) },
              periods: (data.periods && data.periods.length) ? data.periods : state.periods,
              types: (data.types && data.types.length) ? data.types : state.types,
              // 备份里的 rev/tomb 属于那台设备，恢复后必须重建，
              // 否则本机会带着别人的时间戳参与合并，判断「谁更新」就错了
              meta: {
                ...state.meta,
                ...(data.meta || {}),
                deviceId: state.meta.deviceId,
                deviceName: state.meta.deviceName,
                rev: {}, fp: {}, tomb: {}, syncInit: 0, syncAt: 0,
              },
            };
            save(); render(); toast('已恢复备份', 'check');
          },
        });
      } catch (e) {
        toast('文件解析失败，请选择课酬导出的 JSON');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

/* ============================================================
   课表文本：快捷导出 / 导入
   ============================================================ */
const SCHEDULE_TXT_VER = '课酬课表 v1';
const DOW_TOKENS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0, '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 0 };
const TYPE_KEYWORDS = [
  ['晚自习', '晚'], ['晚修', '晚'], ['自习', '自习'], ['早读', '早'], ['晨读', '早'],
  ['辅导', '辅导'], ['一对一', '辅导'], ['正课', '正课'], ['上课', '正课'],
];

/** 导出的母版：总课表为空时用现有课表推断，避免导出一段空文本 */
function scheduleMasterSnapshot() {
  return masterLessonCount() > 0 ? state.master : inferMaster();
}

/** 课表 → 可读文本，一行一节课，可直接手改 */
function exportScheduleText(master) {
  const m = master || scheduleMasterSnapshot();
  const rows = [];
  DOW_ORDER.forEach((dow, di) => {
    state.periods.forEach(p => {
      WM_LIST.forEach(wm => {
        const c = m[masterKey(dow, p.no, wm)];
        if (!c || !c.typeId) return;
        rows.push({ dow, di, no: p.no, wm, c });
      });
    });
  });
  rows.sort((a, b) => a.di - b.di || a.no - b.no || (WM_LIST.indexOf(a.wm) - WM_LIST.indexOf(b.wm)));

  const weeks = clamp(Number(state.settings.termWeeks) || 20, 1, 30);
  const lines = [SCHEDULE_TXT_VER, `#学期 ${termStartYmd()} 起 · 共 ${weeks} 周 · 共 ${rows.length} 节`];
  rows.forEach(r => {
    const parts = [];
    if (r.wm !== 'all') parts.push(parityLabel(r.wm));
    parts.push(WEEK_CN[r.dow], periodTime(r.no).name, getType(r.c.typeId).name);
    if ((r.c.klass || '').trim()) parts.push(r.c.klass.trim());
    if ((r.c.subject || '').trim()) parts.push(r.c.subject.trim());
    if (Number(r.c.extend) > 0) parts.push(`+${Number(r.c.extend)}分`);
    lines.push(parts.join(' '));
  });
  if (!rows.length) lines.push('#还没有课：先在总课表里点格子录入，或点「导入课表」粘贴一段');
  return lines.join('\n');
}

/** 节次名 / 第N节 / 仅数字 → 节次编号 */
function resolvePeriodNo(tok) {
  const t = String(tok == null ? '' : tok).trim();
  if (!t) return null;
  let p = state.periods.find(x => x.name === t || x.short === t);
  if (p) return p.no;
  const m = /^第?(\d{1,2})节?$/.exec(t);
  if (m) {
    p = state.periods.find(x => Number(x.no) === Number(m[1]));
    if (p) return p.no;
  }
  if (t.length > 1) {
    p = state.periods.find(x => x.name && (x.name.includes(t) || t.includes(x.name)));
  }
  return p ? p.no : null;
}

/** 课程类型名 → 现有类型（先精确，再关键词兜底） */
function resolveTypeByName(name) {
  const norm = s => String(s || '').replace(/[\s()（）·]/g, '').toLowerCase();
  const n = norm(name);
  if (n) {
    const exact = state.types.find(t => norm(t.name) === n);
    if (exact) return { type: exact, exact: true };
    const rule = TYPE_KEYWORDS.find(([kw]) => n.includes(kw));
    if (rule) {
      const hit = state.types.find(t => norm(t.name).includes(rule[1]));
      if (hit) return { type: hit, exact: false };
    }
  }
  return { type: state.types[0] || null, exact: false };
}

/** 文本 → 课程行。宽松解析：空格 / 逗号 / 制表符分隔都能读 */
function parseScheduleText(text) {
  const out = { rows: [], bad: [], unknownType: 0, unknownPeriod: 0 };
  String(text || '').split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) return;
    if (/^课酬课表/i.test(line)) return;   // 首行版本标记
    const fail = why => out.bad.push({ line: idx + 1, text: line, why });
    const toks = line.split(/[\s,，、;；\t|]+/).filter(Boolean);

    let i = 0, wm = 'all';
    if (/^(每周|全周|单周|双周|单|双)$/.test(toks[i] || '')) {
      wm = /双/.test(toks[i]) ? 'even' : /单/.test(toks[i]) ? 'odd' : 'all';
      i++;
    }

    const dm = /^(?:周|星期|礼拜)([一二三四五六日天0-9])$/.exec(toks[i] || '');
    if (!dm) { fail('没找到「周几」'); return; }
    const dow = DOW_TOKENS[dm[1]];
    if (dow == null) { fail('星期不认识'); return; }
    i++;

    const no = resolvePeriodNo(toks[i]);
    if (no == null) {
      if (toks[i]) out.unknownPeriod++;
      fail(toks[i] ? '节次不认识' : '没找到节次');
      return;
    }
    i++;

    const { type, exact } = resolveTypeByName(toks[i]);
    if (!type) { fail('没有可用的课程类型'); return; }
    if (!exact) out.unknownType++;
    i++;

    // 剩余字段里挑出「+20分」这类延长标记，其余按「班级 科目」理解
    const rest = toks.slice(i);
    let extend = 0;
    const restNoExt = rest.filter(tok => {
      const em = /^\+?(\d{1,3})(?:分钟|分|min|m)$/i.exec(tok);
      if (em) { extend = clamp(Number(em[1]) || 0, 0, 300); return false; }
      return true;
    });

    const klass = (restNoExt[0] || '').trim();
    const subject = restNoExt.slice(1).join(' ').trim();
    out.rows.push({ dow, no, wm, typeId: type.id, typeName: type.name, klass, subject, extend });
  });
  return out;
}

/** 把解析结果写进总课表（replace 覆盖 / merge 合并，同一格后写的胜出） */
function writeScheduleRows(rows, mode) {
  const next = mode === 'merge' ? { ...state.master } : {};
  rows.forEach(r => {
    next[masterKey(r.dow, r.no, r.wm)] = {
      typeId: r.typeId, klass: r.klass, subject: r.subject, extend: clamp(Number(r.extend) || 0, 0, 300),
    };
  });
  state.master = next;
  return next;
}

/* ---------------- 快捷导入导出面板 ---------------- */
let ieTab = 'export';
let ieOpts = { mode: 'replace', sync: true };
let ieText = '';

function ieStatHtml(text) {
  const p = parseScheduleText(text);
  if (!p.rows.length) {
    return p.bad.length
      ? `<span style="color:var(--rose)">${p.bad.length} 行读不出来，例如第 ${p.bad[0].line} 行「${esc(p.bad[0].why)}」</span>`
      : '还没有内容';
  }
  const odd = p.rows.filter(r => r.wm === 'odd').length;
  const even = p.rows.filter(r => r.wm === 'even').length;
  const ext = p.rows.filter(r => Number(r.extend) > 0).length;
  const bits = [`识别到 <b>${p.rows.length}</b> 节`];
  if (odd) bits.push(`单周 ${odd}`);
  if (even) bits.push(`双周 ${even}`);
  if (ext) bits.push(`含延长 ${ext}`);
  if (p.bad.length) bits.push(`<span style="color:var(--rose)">跳过 ${p.bad.length} 行</span>`);
  if (p.unknownType) bits.push(`<span style="color:#B26A00">${p.unknownType} 节类型未匹配</span>`);
  return bits.join(' · ');
}

function updateIEStat() {
  const el = $('#ie-stat');
  if (el) el.innerHTML = ieStatHtml(ieTextValue());
}

function ieTextValue() {
  const ta = $('#ie-text');
  return ta ? ta.value : ieText;
}

function openScheduleIO(tab) {
  ieTab = tab || 'export';
  ieText = ieTab === 'export' ? exportScheduleText() : '';
  renderScheduleIO();
}

function renderScheduleIO() {
  const isExport = ieTab === 'export';
  const body = `
    <div class="segmented" style="margin-bottom:14px">
      <button class="${isExport ? 'on' : ''}" data-act="ie-tab" data-ie="export">导出课表</button>
      <button class="${!isExport ? 'on' : ''}" data-act="ie-tab" data-ie="import">导入课表</button>
    </div>
    <div class="tiny muted" style="line-height:1.75;margin-bottom:8px">
      ${isExport
        ? '这是当前总课表，可以复制发给同事，或存成 txt 留档。'
        : '一行一节课，例如：<b>周二 第4节 高二(3)班 正课</b>，拖堂写在行尾 <b>+20分</b>。'}
    </div>
    <textarea class="input" id="ie-text" spellcheck="false" autocapitalize="off" autocorrect="off"
      style="min-height:${isExport ? 240 : 168}px;font-size:11.5px;line-height:1.8;white-space:pre;font-family:ui-monospace,Menlo,Consolas,monospace">${esc(ieText)}</textarea>
    <div class="tiny" id="ie-stat" style="margin:8px 2px 0;color:var(--ink-3);line-height:1.7">${ieStatHtml(ieText)}</div>
    <div class="hstack" style="gap:8px;margin-top:12px;flex-wrap:wrap">
      <button class="btn ghost sm" data-act="ie-copy">${ic('doc', 14)} 复制全文</button>
      <button class="btn ghost sm" data-act="ie-save">${ic('download', 14)} 存为文件</button>
      <button class="btn ghost sm" data-act="ie-load">${ic('upload', 14)} 读文件</button>
      <button class="btn ghost sm" data-act="ie-clear">清空</button>
    </div>
    ${isExport ? '' : `
      <div class="hstack" style="gap:8px;margin-top:16px">
        <div class="tiny muted" style="width:44px">方式</div>
        <div class="segmented" style="flex:1">
          <button class="${ieOpts.mode === 'replace' ? 'on' : ''}" data-act="ie-mode" data-mode="replace">覆盖总课表</button>
          <button class="${ieOpts.mode === 'merge' ? 'on' : ''}" data-act="ie-mode" data-mode="merge">合并</button>
        </div>
      </div>
      <div class="row" style="padding-left:0;padding-right:0;margin-top:4px" data-act="ie-toggle-sync">
        <div class="ri" style="background:var(--brand-soft);color:var(--brand)">${ic('cal', 17)}</div>
        <div class="rc"><div class="t">同时铺到本学期</div><div class="s">补全每个周次的课，已调休的周跳过</div></div>
        <div class="switch ${ieOpts.sync ? 'on' : ''}"></div>
      </div>
      <div class="row" style="padding-left:0;padding-right:0;border-top:1px solid var(--line-2)" data-act="open-import">
        <div class="ri" style="background:var(--amber-soft);color:#B26A00">${ic('upload', 17)}</div>
        <div class="rc"><div class="t">按行批量导入</div><div class="s">从 Excel 直接复制，支持日期与单双周</div></div>
        ${ic('right', 15)}
      </div>
    `}
  `;
  openSheet({
    title: isExport ? '导出课表' : '导入课表',
    body,
    footer: isExport
      ? `<button class="btn ghost" data-close>关闭</button><button class="btn" data-act="ie-copy">复制课表</button>`
      : `<button class="btn ghost" data-close>取消</button><button class="btn" data-act="ie-apply">导入</button>`,
    after: () => {
      const ta = $('#ie-text');
      if (!ta) return;
      ta.addEventListener('input', () => { ieText = ta.value; updateIEStat(); });
      if (ieTab === 'import') ta.focus();
    },
  });
}

/** 切换方式 / 开关时重绘面板，但不丢用户已输入或粘贴的内容 */
function renderScheduleIOAfterCapture() {
  ieText = ieTextValue();
  renderScheduleIO();
}

/** 读本地 txt/csv 到文本框 */
/** Excel 另存为 CSV 后常见的小毛病：BOM、外层引号、空行，先抹平 */
function normalizeCsvText(raw) {
  let t = String(raw || '').replace(/^\ufeff/, '');
  t = t.split(/\r?\n/).map(line => {
    if (!/"/.test(line)) return line;
    return line.replace(/"([^"]*)"/g, (m, inner) => inner.replace(/""/g, '"'));
  }).join('\n');
  return t.split('\n').filter(l => l.replace(/[\s,，\t|]/g, '') !== '').join('\n');
}

/** .xlsx/.xls 是压缩包，纯前端解得先引入解压库，这里如实告知而不是假装读成功 */
function isExcelBinary(name) {
  return /\.(xlsx|xls|xlsm)$/i.test(String(name || ''));
}

function pickScheduleFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'text/plain,.txt,.csv,.tsv,.md,.xlsx,text/*';
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (isExcelBinary(file.name)) { readXlsxInto(file, 'text'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      ieText = normalizeCsvText(reader.result);
      ieTab = 'import';
      renderScheduleIO();
      toast('已读入文本，检查无误后点「导入」', 'check');
    };
    reader.onerror = () => toast('文件读取失败');
    reader.readAsText(file);
  };
  input.click();
}

/* ============================================================
   xlsx 解析（零依赖）
   ----------
   .xlsx 本质是一个 zip，里面放 XML。浏览器没有现成的解压能力，
   这里自己实现：raw inflate → 读 zip 目录 → 用 DOMParser 读 SpreadsheetML。
   只取「第一张工作表 + 共享字符串 + 单元格格式（判断是不是日期）」，够课表导入用。
   ============================================================ */

/* ---- 1. raw deflate 解压（puff 算法的紧凑实现） ---- */
const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function buildHuffman(lengths) {
  const count = new Array(16).fill(0);
  for (let i = 0; i < lengths.length; i++) count[lengths[i]]++;
  count[0] = 0;
  const offs = new Array(16).fill(0);
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1];
  const symbol = new Array(lengths.length).fill(0);
  for (let i = 0; i < lengths.length; i++) {
    if (lengths[i]) symbol[offs[lengths[i]]++] = i;
  }
  return { count, symbol };
}

function inflateRaw(input) {
  const src = input instanceof Uint8Array ? input : new Uint8Array(input);
  let pos = 0, bitBuf = 0, bitCnt = 0;
  let out = new Uint8Array(Math.max(1024, src.length * 4));
  let outLen = 0;

  const room = n => {
    if (outLen + n <= out.length) return;
    let size = out.length || 1024;
    while (size < outLen + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(out.subarray(0, outLen));
    out = next;
  };
  const bits = n => {
    while (bitCnt < n) {
      if (pos >= src.length) throw new Error('压缩数据不完整');
      bitBuf |= src[pos++] << bitCnt;
      bitCnt += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCnt -= n;
    return v;
  };
  const decode = h => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len <= 15; len++) {
      code |= bits(1);
      const cnt = h.count[len];
      if (code - first < cnt) return h.symbol[index + (code - first)];
      index += cnt;
      first = (first + cnt) << 1;
      code <<= 1;
    }
    throw new Error('压缩数据损坏');
  };

  let fixedLit = null, fixedDist = null;
  for (;;) {
    const last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0; bitCnt = 0;                       // 对齐到字节
      if (pos + 4 > src.length) throw new Error('压缩数据不完整');
      const len = src[pos] | (src[pos + 1] << 8);
      pos += 4;                                     // 跳过 LEN 与 NLEN
      if (pos + len > src.length) throw new Error('压缩数据不完整');
      room(len);
      out.set(src.subarray(pos, pos + len), outLen);
      outLen += len;
      pos += len;
    } else if (type === 1 || type === 2) {
      let lit, dist;
      if (type === 1) {
        if (!fixedLit) {
          const l = new Array(288);
          for (let i = 0; i < 144; i++) l[i] = 8;
          for (let i = 144; i < 256; i++) l[i] = 9;
          for (let i = 256; i < 280; i++) l[i] = 7;
          for (let i = 280; i < 288; i++) l[i] = 8;
          fixedLit = buildHuffman(l);
          fixedDist = buildHuffman(new Array(30).fill(5));
        }
        lit = fixedLit; dist = fixedDist;
      } else {
        const hlit = bits(5) + 257;
        const hdist = bits(5) + 1;
        const hclen = bits(4) + 4;
        const clens = new Array(19).fill(0);
        for (let i = 0; i < hclen; i++) clens[CLEN_ORDER[i]] = bits(3);
        const clh = buildHuffman(clens);
        const lengths = new Array(hlit + hdist).fill(0);
        let i = 0;
        while (i < hlit + hdist) {
          const sym = decode(clh);
          if (sym < 16) { lengths[i++] = sym; continue; }
          let rep = 0, val = 0;
          if (sym === 16) {
            if (i === 0) throw new Error('压缩数据损坏');
            val = lengths[i - 1];
            rep = 3 + bits(2);
          } else if (sym === 17) {
            rep = 3 + bits(3);
          } else {
            rep = 11 + bits(7);
          }
          while (rep-- > 0 && i < lengths.length) lengths[i++] = val;
        }
        lit = buildHuffman(lengths.slice(0, hlit));
        dist = buildHuffman(lengths.slice(hlit));
      }

      for (;;) {
        const sym = decode(lit);
        if (sym < 256) {
          room(1);
          out[outLen++] = sym;
          continue;
        }
        if (sym === 256) break;
        const li = sym - 257;
        if (li >= LEN_BASE.length) throw new Error('压缩数据损坏');
        const len = LEN_BASE[li] + bits(LEN_EXTRA[li]);
        const di = decode(dist);
        if (di >= DIST_BASE.length) throw new Error('压缩数据损坏');
        const back = DIST_BASE[di] + bits(DIST_EXTRA[di]);
        if (back > outLen) throw new Error('压缩数据损坏');
        room(len);
        for (let k = 0; k < len; k++, outLen++) out[outLen] = out[outLen - back];
      }
    } else {
      throw new Error('压缩数据损坏');
    }
    if (last) break;
  }
  return out.slice(0, outLen);
}

/* ---- 2. 读 zip 目录 ---- */
function openZip(buffer) {
  // 同时接受 ArrayBuffer 与 Uint8Array：FileReader 给的是前者，测试里常传后者
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  const floor = Math.max(0, u8.length - 65558);
  for (let i = u8.length - 22; i >= floor; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 Excel 文件');

  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = new Map();
  const dec = new TextDecoder('utf-8');
  for (let i = 0; i < count; i++) {
    if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const cmtLen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, compSize, size, off });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  if (!entries.size) throw new Error('Excel 文件是空的');

  return {
    names: [...entries.keys()],
    has: n => entries.has(n),
    read(n) {
      const e = entries.get(n);
      if (!e) return null;
      if (e.size === 0xffffffff || e.off === 0xffffffff) throw new Error('Excel 文件太大，换个小的试试');
      const lnameLen = dv.getUint16(e.off + 26, true);
      const lextraLen = dv.getUint16(e.off + 28, true);
      const start = e.off + 30 + lnameLen + lextraLen;
      const raw = u8.subarray(start, start + e.compSize);
      if (e.method === 0) return raw;
      if (e.method !== 8) throw new Error('这个 Excel 用了不支持的压缩方式');
      return inflateRaw(raw);
    },
  };
}

/* ---- 3. 读 SpreadsheetML ---- */
const xlsxText = bytes => (bytes ? new TextDecoder('utf-8').decode(bytes) : '');
const xmlDoc = str => new DOMParser().parseFromString(str, 'application/xml');

function relIdOf(el) {
  if (!el || !el.attributes) return '';
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i];
    if (a.localName === 'id' && /relationships/.test(a.namespaceURI || '')) return a.value;
  }
  return el.getAttribute('r:id') || '';
}

function colIndexOf(ref) {
  const m = /^([A-Z]+)/i.exec(String(ref || ''));
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const doc = xmlDoc(xml);
  const out = [];
  const si = doc.getElementsByTagName('si');
  for (let i = 0; i < si.length; i++) {
    const ts = si[i].getElementsByTagName('t');
    let s = '';
    for (let j = 0; j < ts.length; j++) s += ts[j].textContent;
    out.push(s);
  }
  return out;
}

/** 哪些单元格样式是日期（内置格式 14–22、45–47 与自定义 y/m/d 格式） */
function parseDateStyles(xml) {
  const set = new Set();
  if (!xml) return set;
  const doc = xmlDoc(xml);
  const custom = new Map();
  const fmts = doc.getElementsByTagName('numFmt');
  for (let i = 0; i < fmts.length; i++) {
    const id = Number(fmts[i].getAttribute('numFmtId'));
    const code = fmts[i].getAttribute('formatCode') || '';
    if (/[yYdD]/.test(code) || /m{2,}/.test(code) || /h{1,2}:/.test(code)) custom.set(id, true);
  }
  const builtinDate = id => (id >= 14 && id <= 22) || (id >= 45 && id <= 47)
    || id === 27 || id === 30 || id === 36 || id === 50 || id === 57;
  const xfs = doc.getElementsByTagName('xf');
  let idx = 0;
  for (let i = 0; i < xfs.length; i++) {
    const xf = xfs[i];
    const parent = xf.parentNode;
    if (!parent || String(parent.nodeName) !== 'cellXfs') continue;
    const id = Number(xf.getAttribute('numFmtId') || 0);
    if (builtinDate(id) || custom.has(id)) set.add(idx);
    idx++;
  }
  return set;
}

/** Excel 序列号 → YYYY-MM-DD（1900 年起算，含那个著名闰年 bug 的偏移） */
function serialToYmd(n) {
  const ms = Math.round((n - 25569) * 86400000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(n);
  const p = v => String(v).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function parseSheetRows(xml, shared, dateXfs) {
  const doc = xmlDoc(xml);
  const rows = [];
  const rowEls = doc.getElementsByTagName('row');
  for (let i = 0; i < rowEls.length; i++) {
    const cells = [];
    const cEls = rowEls[i].getElementsByTagName('c');
    for (let j = 0; j < cEls.length; j++) {
      const c = cEls[j];
      const idx = colIndexOf(c.getAttribute('r'));
      if (idx < 0) continue;
      const t = c.getAttribute('t') || 'n';
      const style = Number(c.getAttribute('s'));
      let val = '';

      if (t === 'inlineStr') {
        const ts = c.getElementsByTagName('t');
        for (let k = 0; k < ts.length; k++) val += ts[k].textContent;
      } else {
        const v = c.getElementsByTagName('v')[0];
        const raw = v ? v.textContent : '';
        if (t === 's') val = shared[Number(raw)] || '';
        else if (t === 'b') val = raw === '1' ? '是' : '否';
        else if (t === 'e') val = '';
        else if (raw !== '' && dateXfs.has(style) && /^\d+(\.\d+)?$/.test(raw)) val = serialToYmd(Number(raw));
        else val = raw;
      }
      cells[idx] = String(val).replace(/\s+/g, ' ').trim();
    }
    for (let k = 0; k < cells.length; k++) if (cells[k] == null) cells[k] = '';
    if (cells.some(x => x !== '')) rows.push(cells);
  }
  return rows;
}

/** 找到第一张工作表的 XML 路径：走 workbook.xml 的 r:id → rels 里的 Target */
function firstSheetPath(zip) {
  let target = '';
  const wb = zip.read('xl/workbook.xml');
  if (wb) {
    const doc = xmlDoc(xlsxText(wb));
    const sheet = doc.getElementsByTagName('sheet')[0];
    const rid = relIdOf(sheet);
    if (rid) {
      const rels = zip.read('xl/_rels/workbook.xml.rels');
      if (rels) {
        const rdoc = xmlDoc(xlsxText(rels));
        const list = rdoc.getElementsByTagName('Relationship');
        for (let i = 0; i < list.length; i++) {
          if (list[i].getAttribute('Id') === rid) {
            target = list[i].getAttribute('Target') || '';
            break;
          }
        }
      }
    }
  }
  if (!target) {
    const guess = zip.names.find(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    return guess || 'xl/worksheets/sheet1.xml';
  }
  target = target.replace(/\\/g, '/');
  if (target.startsWith('/')) return target.slice(1);
  if (target.startsWith('xl/')) return target;
  return 'xl/' + target;
}

/** xlsx 二进制 → 二维数组（第一张表） */
function xlsxToRows(buffer) {
  const zip = openZip(buffer);
  const sheetPath = firstSheetPath(zip);
  const sheet = zip.read(sheetPath);
  if (!sheet) throw new Error('这个 Excel 里没找到工作表');
  const shared = parseSharedStrings(xlsxText(zip.read('xl/sharedStrings.xml')));
  const dateXfs = parseDateStyles(xlsxText(zip.read('xl/styles.xml')));
  return parseSheetRows(xlsxText(sheet), shared, dateXfs);
}

/** xlsx 二进制 → 制表符分隔的文本，交给现有的行解析器 */
function xlsxToText(buffer) {
  const rows = xlsxToRows(buffer);
  if (!rows.length) throw new Error('工作表里没有内容');
  return rows.map(r => r.join('\t')).join('\n');
}

/**
 * 读 .xlsx：解出第一张表 → 制表符文本 → 交给对应文本框。
 * target='import' 走批量导入（支持日期/单双周），'text' 走课表文本导入。
 */
function readXlsxInto(file, target) {
  if (!/\.xlsx$/i.test(file.name)) {
    toast('老式 .xls 读不了，请在 Excel 里另存为 .xlsx 或 CSV');
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    toast('文件超过 20MB，请只保留课表那一张表');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    let text = '';
    try {
      text = xlsxToText(reader.result);
    } catch (e) {
      toast(e && e.message ? e.message : '这个 Excel 打不开');
      return;
    }
    if (target === 'import') {
      const ta = $('#impText');
      if (!ta) return;
      ta.value = text;
      draftImport = null;
      if ($('#impBtn')) $('#impBtn').click();
    } else {
      ieText = text;
      ieTab = 'import';
      renderScheduleIO();
    }
    toast(`已读入 ${file.name}，确认后点导入`, 'check');
  };
  reader.onerror = () => toast('文件读取失败');
  reader.readAsArrayBuffer(file);
}

/** 批量导入面板里读文件：读进来直接填到文本框并解析 */
function pickImportFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'text/plain,.txt,.csv,.tsv,.md,.xlsx,text/*';
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (isExcelBinary(file.name)) { readXlsxInto(file, 'import'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const ta = $('#impText');
      if (!ta) return;
      ta.value = normalizeCsvText(reader.result);
      draftImport = null;
      $('#impBtn') && $('#impBtn').click();
      toast(`已读入 ${file.name}`, 'check');
    };
    reader.onerror = () => toast('文件读取失败');
    reader.readAsText(file);
  };
  input.click();
}

function applyScheduleFromSheet() {
  const text = ieTextValue();
  const parsed = parseScheduleText(text);
  if (!parsed.rows.length) {
    toast(parsed.bad.length ? `第 ${parsed.bad[0].line} 行「${parsed.bad[0].why}」，先修一下格式` : '文本里还没有课表行');
    return;
  }
  const odd = parsed.rows.filter(r => r.wm === 'odd').length;
  const even = parsed.rows.filter(r => r.wm === 'even').length;
  const parts = [`每周 ${parsed.rows.length - odd - even} 节`];
  if (odd) parts.push(`单周 ${odd} 节`);
  if (even) parts.push(`双周 ${even} 节`);

  const demoN = demoLessons().length;
  confirmModal({
    title: '导入课表',
    desc: `识别到 <b>${parsed.rows.length}</b> 节课（${parts.join(' · ')}）。<br>` +
      `将<b>${ieOpts.mode === 'merge' ? '合并进' : '覆盖'}</b>总课表${ieOpts.sync ? '，并铺到本学期' : ''}。` +
      (parsed.bad.length ? `<br><span style="color:var(--rose)">有 ${parsed.bad.length} 行读不出来，会跳过。</span>` : '') +
      (parsed.unknownType ? `<br><span style="color:#B26A00">${parsed.unknownType} 节课程类型没匹配上，先按「${esc((state.types[0] || {}).name || '正课')}」导入，可再改。</span>` : '') +
      (ieOpts.mode === 'replace' && demoN ? `<br><span style="color:#B26A00">原有的 ${demoN} 节示例课会一并清掉。</span>` : ''),
    okText: '导入',
    danger: ieOpts.mode === 'replace',
    onDone: ok => {
      if (!ok) return;
      writeScheduleRows(parsed.rows, ieOpts.mode);
      let removedDemo = 0;
      if (ieOpts.mode === 'replace' && demoN) {
        const before = state.lessons.length;
        state.lessons = state.lessons.filter(l => !l.demo);
        removedDemo = before - state.lessons.length;
      }
      let added = 0;
      if (ieOpts.sync) added = syncFromMaster(false).added;
      save();
      closeSheet();
      render();
      toast(`已导入 ${parsed.rows.length} 节${removedDemo ? `，清掉 ${removedDemo} 节示例课` : ''}${ieOpts.sync ? `，铺到本学期 ${added} 节` : ''}`, 'check');
    },
  });
}

/* ============================================================
   事件分发
   ============================================================ */
document.addEventListener('click', e => {
  const tabBtn = e.target.closest('.tab[data-tab]');
  if (tabBtn) { switchTab(tabBtn.dataset.tab); return; }

  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const id = el.dataset.id;

  switch (act) {
    /* 导航 */
    case 'go-mine': switchTab('mine'); break;
    case 'go-pay': switchTab('pay'); break;
    case 'go-schedule': switchTab('schedule'); break;

    /* 课表 */
    case 'pick-day': viewDate = parseYmd(el.dataset.date); renderSchedule(); break;
    case 'week-prev': viewDate = addDays(viewDate, -7); renderSchedule(); break;
    case 'week-next': viewDate = addDays(viewDate, 7); renderSchedule(); break;
    case 'week-today': viewDate = new Date(); renderSchedule(); break;
    case 'sched-mode': schedMode = el.dataset.mode; renderSchedule(); break;

    /* 总课表 */
    case 'master-cell': openMasterCell(Number(el.dataset.dow), Number(el.dataset.period)); break;
    case 'master-pick': closeSheet(); setTimeout(() => openMasterEditor(Number(el.dataset.dow), Number(el.dataset.period), el.dataset.w), 60); break;
    case 'master-pick-type':
      captureMasterForm();
      draftMaster.typeId = el.dataset.type;
      renderMasterEditor();
      break;
    case 'master-pick-week':
      captureMasterForm();
      draftMaster.weekMode = el.dataset.w;
      renderMasterEditor();
      break;
    case 'master-pick-extend':
      captureMasterForm();
      draftMaster.extend = Number(el.dataset.n) || 0;
      renderMasterEditor();
      break;
    case 'master-save': saveMasterCell(); break;
    case 'master-del': deleteMasterCell(); break;
    case 'master-sync': {
      const pre = syncFromMaster(true);
      if (!pre.added && !pre.updated && !pre.removed) { toast('课表已是最新'); break; }
      const bits = [];
      if (pre.added) bits.push(`补齐 ${pre.added} 节课`);
      if (pre.updated) bits.push(`更新 ${pre.updated} 节`);
      if (pre.removed) bits.push(`移除 ${pre.removed} 节`);
      confirmModal({
        title: '铺到本学期？',
        desc: `按总课表${bits.join('、')}，范围为 ${fmtMD(termStartYmd())} – ${fmtMD(termEndYmd())}。已调休的周和手动添加的课不会被改动。`,
        okText: '开始同步',
        onDone: ok => {
          if (!ok) return;
          const r = syncFromMaster();
          save();
          renderSchedule();
          const parts = [];
          if (r.added) parts.push(`新增 ${r.added} 节`);
          if (r.updated) parts.push(`更新 ${r.updated} 节`);
          if (r.removed) parts.push(`移除 ${r.removed} 节`);
          if (r.locked) parts.push(`跳过 ${r.locked} 个调休周`);
          toast(parts.length ? parts.join(' · ') : '课表已是最新', 'check');
        },
      });
      break;
    }

    /* 调休 */
    case 'open-makeup': openMakeupSheet(); break;
    case 'open-makeup-rule': openMakeupRuleSheet(); break;
    case 'open-swap-center': openSwapCenter('rule'); break;
    case 'swap-tab':
      swapTab = el.dataset.t === 'log' ? 'log' : 'rule';
      if (swapTab === 'rule') draftMakeup = { ...makeupRule() };
      renderSwapCenter();
      break;

    /* 法定节假日 */
    case 'open-holidays': openHolidaysSheet(); break;
    case 'hd-add': openHolidayEditor(''); break;
    case 'hd-edit': openHolidayEditor(el.dataset.date); break;
    case 'hd-kind':
      captureHolidayForm();
      hdDraft.kind = el.dataset.v === 'work' ? 'work' : 'off';
      if (hdDraft.kind === 'off') hdDraft.asDow = null;
      renderHolidayEditor();
      break;
    case 'hd-dow': {
      captureHolidayForm();
      const dd = Number(el.dataset.d);
      hdDraft.asDow = Number(hdDraft.asDow) === dd ? null : dd;
      renderHolidayEditor();
      break;
    }
    case 'hd-save': saveHolidayDraft(); break;
    case 'hd-del': deleteHolidayDraft(); break;
    case 'hd-sync': doSyncHolidays(); break;
    case 'hd-reset': resetHolidayData(); break;
    case 'hd-toggle-skip':
      state.settings.holidaySkip = state.settings.holidaySkip === false;
      save();
      renderHolidays();
      render();
      break;
    case 'makeup-one': {
      const r = applyMakeup(el.dataset.ws);
      if (!r.ok) { toast(r.reason === 'empty' ? '这一周没有可平移的课' : '这一周已调休过'); break; }
      renderSchedule();
      openMakeupSheet();
      toast(`已平移 ${r.count} 节课`, 'swap');
      break;
    }
    case 'makeup-all': {
      const list = makeupWeeks().filter(w => !w.done);
      let n = 0, skipped = 0;
      list.forEach(w => {
        const r = applyMakeup(w.weekStart);
        if (r.ok) n += r.count; else skipped++;
      });
      save();
      renderSchedule();
      openMakeupSheet();
      toast(skipped ? `已平移 ${n} 节 · 跳过 ${skipped} 周` : `已平移 ${n} 节课`, 'swap');
      break;
    }
    case 'makeup-undo': {
      const r = undoMakeup(el.dataset.ws);
      if (!r.ok) { toast('没有找到调休记录'); break; }
      renderSchedule();
      openMakeupSheet();
      toast(r.blocked ? `已恢复 ${r.restored} 节 · ${r.blocked} 节原位置已占用` : `已恢复 ${r.restored} 节课`, 'reset');
      break;
    }
    case 'makeup-toggle': draftMakeup.enabled = !draftMakeup.enabled; renderMakeupRule(); break;
    case 'makeup-parity': draftMakeup.parity = el.dataset.v; renderMakeupRule(); break;
    case 'makeup-from': draftMakeup.fromDow = Number(el.dataset.d); renderMakeupRule(); break;
    case 'makeup-to': draftMakeup.toDow = Number(el.dataset.d); renderMakeupRule(); break;
    case 'makeup-cut': draftMakeup.cutAfter = Number(el.dataset.p); renderMakeupRule(); break;
    case 'makeup-night': draftMakeup.includeNight = !draftMakeup.includeNight; renderMakeupRule(); break;
    case 'makeup-save-rule':
      if (Number(draftMakeup.fromDow) === Number(draftMakeup.toDow)) { toast('提前放学日与补课日不能是同一天'); break; }
      state.settings.makeup = { ...draftMakeup, cutAfter: Number(draftMakeup.cutAfter) };
      save();
      closeSheet();
      renderSchedule();
      toast('调休规则已保存', 'check');
      break;

    /* 课程 */
    case 'add-lesson':
      openLessonSheet({ date: el.dataset.date, period: el.dataset.period });
      break;
    case 'lesson-menu': openLessonMenu(id); break;
    case 'lesson-edit': openLessonSheet({ id }); break;
    case 'lesson-swap': openSwapTarget(id); break;
    case 'lesson-leave': {
      const l = state.lessons.find(x => x.id === id);
      if (!l) break;
      l.status = l.status === 'leave' ? 'normal' : 'leave';
      save(); closeSheet(); render();
      toast(l.status === 'leave' ? '已标记请假' : '已取消请假', 'check');
      break;
    }
    case 'lesson-del': {
      confirmModal({
        title: '删除这节课？',
        desc: '删除后该节课不再计入课时费，操作不可撤销。',
        okText: '删除', danger: true,
        onDone: ok => {
          if (!ok) return;
          state.lessons = state.lessons.filter(x => x.id !== id);
          save(); closeSheet(); render(); toast('已删除', 'trash');
        },
      });
      break;
    }
    case 'lesson-pick-period':
      captureLessonForm();
      // 时长跟随作息时，换节次自动换成该节的长度
      if (draft.durAuto !== false) draft.dur = periodMinutes(Number(el.dataset.period));
      draft.period = Number(el.dataset.period);
      renderLessonSheet();
      break;
    case 'lesson-dur-auto':
      captureLessonForm();
      draft.dur = periodMinutes(draft.period);
      draft.durAuto = true;
      renderLessonSheet();
      toast('时长已恢复为跟随作息', 'clock');
      break;
    case 'lesson-pick-extend':
      captureLessonForm();
      draft.extend = Number(el.dataset.n) || 0;
      renderLessonSheet();
      break;
    case 'lesson-pick-type':
      captureLessonForm();
      draft.typeId = el.dataset.type;
      renderLessonSheet();
      break;
    case 'lesson-pick-status':
      captureLessonForm();
      draft.status = el.dataset.status;
      renderLessonSheet();
      break;
    case 'lesson-pick-week':
      captureLessonForm();
      draft.weekMode = el.dataset.w;
      renderLessonSheet();
      break;
    case 'lesson-fix-parity':
      captureLessonForm();
      draft.date = alignDateToParity(draft.date, draft.weekMode);
      renderLessonSheet();
      toast(`已调到 ${fmtMD(draft.date)}`);
      break;
    case 'lesson-toggle-repeat':
      captureLessonForm();
      draft.repeat = !draft.repeat;
      renderLessonSheet();
      break;
    case 'lesson-save': saveLesson(); break;
    case 'show-breakdown': openBreakdown(id); break;

    /* 调课 */
    case 'open-swap-picker': openSwapPicker(null); break;
    case 'swap-pick-day': draftSwap.date = el.dataset.date; draftSwap.period = null; renderSwapSheet(); break;
    case 'swap-pick-period': draftSwap.period = Number(el.dataset.period); renderSwapSheet(); break;
    case 'swap-confirm': doSwap(); break;

    /* 导入 */
    case 'open-import': openImportSheet(); break;
    case 'imp-file': pickImportFile(); break;
    case 'imp-sample': {
      const t = $('#impText');
      t.value = `周一 第1节 高一(3)班 正课
周一 第3节 高一(5)班 正课
周二 第2节 单周 高二(2)班 辅导
周二 第10节 高一(3)班 晚自习
周三 早读 高一(3)班 早读
周三 第6节 高二(4)班 正课
周四 第8节 双周 高一(5)班 正课`;
      break;
    }
    case 'imp-clear': $('#impText').value = ''; draftImport = null; $('#impResult').innerHTML = ''; break;
    case 'imp-parse': doParseImport(); break;
    case 'imp-confirm': doConfirmImport(); break;
    case 'imp-toggle-expand': {
      draftImportExpand = !draftImportExpand;
      const sw = el.querySelector('.switch');
      if (sw) sw.classList.toggle('on', draftImportExpand);
      if (draftImport) doParseImport();
      break;
    }

    /* 课时费 */
    case 'pay-prev': payMonth = shiftMonth(payMonth, -1); renderPay(); break;
    case 'pay-next': payMonth = shiftMonth(payMonth, 1); renderPay(); break;
    case 'toggle-detail': payDetailOpen = !payDetailOpen; renderPay(); break;

    /* 设置 */
    case 'open-calc-rules': openCalcRules(); break;
    case 'set-scheme':
      state.settings.scheme = el.dataset.scheme;
      save(); openCalcRules();
      break;
    case 'save-calc-rules':
      if (state.settings.scheme === 'overtime') {
        state.settings.overtimeFrom = Number($('#otFrom')?.value) || 40;
        state.settings.overtimeRate = Number($('#otRate')?.value) || 1.5;
      }
      {
        const extSel = $('#extendTypeSel');
        if (extSel && extSel.value) state.settings.extendTypeId = extSel.value;
      }
      $$('[data-tier]').forEach(inp => {
        const i = Number(inp.dataset.tier), k = inp.dataset.k;
        if (state.settings.tiers[i]) state.settings.tiers[i][k] = Number(inp.value);
      });
      save(); closeSheet(); render(); toast('计费规则已更新', 'check');
      break;
    case 'toggle-class-factor':
      state.settings.useClassFactor = !state.settings.useClassFactor;
      save();
      if (sheetOpen() && $('#sheetTitle').textContent === '计费公式') openCalcRules();
      else if (sheetOpen() && $('#sheetTitle').textContent === '班级系数') openClassFactorSheet();
      render();
      break;

    case 'open-types': openTypesSheet(); break;
    case 'edit-type': openTypeEditor(id); break;
    case 'add-type': openTypeEditor(null); break;
    case 'type-unit': {
      const d = window.__typeDraft;
      d.name = $('#t-name').value; d.price = Number($('#t-price').value) || 0; d.factor = Number($('#t-factor').value) || 1;
      d.unit = el.dataset.unit;
      window.__typeDraw();
      break;
    }
    case 'type-color': {
      const d = window.__typeDraft;
      d.name = $('#t-name').value; d.price = Number($('#t-price').value) || 0; d.factor = Number($('#t-factor').value) || 1;
      d.color = el.dataset.color;
      window.__typeDraw();
      break;
    }
    case 'type-tierable':
      window.__typeDraft.tierable = !window.__typeDraft.tierable;
      window.__typeDraft.name = $('#t-name').value;
      window.__typeDraft.price = Number($('#t-price').value) || 0;
      window.__typeDraw();
      break;
    case 'type-save': {
      const d = window.__typeDraft;
      const name = $('#t-name').value.trim();
      if (!name) { toast('请填写名称'); break; }
      d.name = name;
      d.price = Number($('#t-price').value) || 0;
      d.factor = Number($('#t-factor').value) || 1;
      const isNew = el.dataset.new === '1';
      if (isNew) state.types.push(d);
      else {
        const i = state.types.findIndex(x => x.id === d.id);
        if (i >= 0) state.types[i] = d;
      }
      save(); openTypesSheet(); render(); toast('已保存', 'check');
      break;
    }
    case 'type-del': {
      const tid = el.dataset.id;
      if (state.lessons.some(l => l.typeId === tid)) { toast('该类型下已有课程，无法删除'); break; }
      confirmModal({
        title: '删除课程类型？', desc: '删除后不可恢复。', danger: true, okText: '删除',
        onDone: ok => {
          if (!ok) return;
          state.types = state.types.filter(x => x.id !== tid);
          save(); openTypesSheet(); render(); toast('已删除');
        },
      });
      break;
    }

    case 'open-class-factor': openClassFactorSheet(); break;
    case 'cf-add':
      state.settings.classFactors.push({ key: '', factor: 1.1 });
      openClassFactorSheet();
      break;
    case 'cf-del': {
      const i = Number(el.dataset.i);
      state.settings.classFactors.splice(i, 1);
      save(); openClassFactorSheet();
      break;
    }
    case 'cf-save':
      $$('[data-cf]').forEach(inp => {
        const i = Number(inp.dataset.cf), k = inp.dataset.k;
        if (state.settings.classFactors[i]) {
          state.settings.classFactors[i][k] = k === 'factor' ? (Number(inp.value) || 1) : inp.value.trim();
        }
      });
      state.settings.classFactors = state.settings.classFactors.filter(c => c.key);
      save(); render(); toast('班级系数已保存', 'check');
      openCalcRules();       // 回到上一级，别让用户以为退出了设置
      break;

    case 'open-periods': openPeriodsSheet(); break;
    case 'open-term': openTermSheet(); break;
    case 'term-save': {
      const sd = $('#t-start')?.value;
      const wk = Number($('#t-weeks')?.value) || 20;
      if (!sd || !/^\d{4}-\d{2}-\d{2}$/.test(sd)) { toast('请选择学期第一周的周一'); break; }
      state.settings.termStart = ymd(startOfWeek(parseYmd(sd)));
      state.settings.termWeeks = clamp(wk, 1, 30);
      save(); closeSheet(); render();
      toast(`学期已设为 ${state.settings.termWeeks} 周`, 'check');
      break;
    }
    case 'open-swap-log': openSwapLog(); break;
    case 'open-backup': openBackupSheet(); break;
    case 'period-save': {
      // 记录旧时长，用于判断哪些课原本就「跟着作息走」
      const before = {};
      state.periods.forEach(p => { before[p.no] = minutesBetween(p.start, p.end); });
      $$('[data-period]').forEach(inp => {
        const i = Number(inp.dataset.period), k = inp.dataset.k;
        if (state.periods[i]) state.periods[i][k] = inp.value;
      });
      // 自习等课程的时长自动跟着作息变
      let synced = 0;
      state.lessons.forEach(l => {
        if (l.durAuto === false) return;
        const auto = l.durAuto === true || Number(l.dur) === before[l.period] || !l.dur;
        if (!auto) return;
        const m = periodMinutes(l.period);
        if (Number(l.dur) === m) { l.durAuto = true; return; }
        l.dur = m;
        l.durAuto = true;
        synced++;
      });
      save(); closeSheet(); render();
      toast(synced ? `作息已更新，${synced} 节课时已自动同步` : '作息已更新', 'check');
      break;
    }

    case 'open-remind': openRemindSheet(); break;
    case 'toggle-remind':
      state.settings.remindEnabled = !state.settings.remindEnabled;
      if (state.settings.remindEnabled) requestNotifyPermission().then(() => {
        save();
        if (sheetOpen()) openRemindSheet(); else render();
      });
      else { save(); if (sheetOpen()) openRemindSheet(); else render(); }
      break;
    case 'set-remind-before':
      state.settings.remindBefore = Number(el.dataset.n);
      save(); openRemindSheet();
      break;
    case 'toggle-daily-remind':
      state.settings.dailyRemind = !state.settings.dailyRemind;
      save(); openRemindSheet();
      break;
    case 'req-notify':
      requestNotifyPermission().then(ok => {
        openRemindSheet();
        toast(ok ? '通知已开启' : '未获得通知权限');
      });
      break;
    case 'req-exact':
      if (IS_NATIVE) NATIVE.openExactAlarmSettings();
      break;
    case 'test-notify':
      fireNotify('课前提醒测试', '数学 · 高一(3)班 · 10 分钟后开始', 'test');
      break;

    case 'edit-teacher': openTeacherSheet(); break;
    case 'teacher-save':
      state.teacher.name = $('#tc-name').value.trim() || '老师';
      state.teacher.school = $('#tc-school').value.trim();
      state.teacher.subject = $('#tc-subject').value.trim();
      save(); closeSheet(); render(); renderTopbar(); toast('已保存', 'check');
      break;

    /* 帮助与关于 */
    case 'open-help': openHelp(el.dataset.h || 'faq'); break;
    case 'help-tab':
      if (helpTab !== el.dataset.h) { helpTab = el.dataset.h; renderHelp(false); }
      break;
    case 'faq-toggle': {
      const k = el.dataset.k;
      if (helpOpen.has(k)) helpOpen.delete(k); else helpOpen.add(k);
      renderHelp(true);
      break;
    }
    case 'log-toggle':
      logOpen = !logOpen;
      renderHelp(true);
      break;
    case 'check-update':
      checkUpdate(false);
      break;
    case 'upd-start': startUpdate(); break;
    case 'upd-install': installUpdate(); break;
    case 'upd-reload': applyWebUpdate(); break;
    case 'upd-retry': checkUpdate(false); break;
    case 'upd-source': openUpdateSource(); break;
    case 'upd-save-src': saveUpdateSource(); break;
    case 'upd-clear-src':
      state.settings.updateSource = '';
      save();
      toast('已恢复默认更新源', 'check');
      closeSheet();
      setTimeout(() => checkUpdate(false), 150);
      break;
    case 'upd-later': closeSheet(); break;
    case 'upd-open':
      if (UPD.kind) openUpdateSheet();
      else checkUpdate(false);
      break;
    case 'help-go':
      closeSheet();
      setTimeout(() => helpGo(el.dataset.go), 90);
      break;

    case 'export-data': exportData(); break;
    case 'import-data': importDataFile(); break;

    /* 多设备同步 */
    case 'open-sync': openSyncSheet(); break;
    case 'sync-export': exportSyncFile(); break;
    case 'sync-import': importSyncFile(); break;
    case 'sync-apply': applySyncPkt(); break;
    case 'lan-start': lanStart(); break;
    case 'lan-stop': lanStop(); break;
    case 'lan-scan': lanScan(); break;
    case 'lan-ask': lanAskCode(el); break;
    case 'lan-go': lanGo(); break;
    case 'lan-back': lanTarget = null; openSyncSheet(); break;

    /* 月账单：复制文字 / 导出表格 */
    case 'stmt-copy': copyMonthStatement(); break;
    case 'stmt-csv': exportMonthStatement(); break;
    case 'term-report': openTermReport(); break;
    case 'term-copy': copyText(termStatementText(), '学期报表已复制'); break;

    /* 计费方案 */
    case 'scheme-open': openSchemeSheet(el.dataset.id); break;
    case 'scheme-save': openSchemeSave(); break;
    case 'scheme-save-ok': saveSchemeNow(); break;
    case 'scheme-apply': applySchemeById(el.dataset.id); break;
    case 'scheme-del': deleteSchemeById(el.dataset.id); break;
    case 'scheme-share': openSchemeShare(); break;
    case 'scheme-share-one': openSchemeShare(el.dataset.id); break;
    case 'scheme-copy': {
      const ta = $('#shareOut');
      copyText(ta ? ta.value : '', '分享码已复制');
      break;
    }
    case 'scheme-import': openSchemeImport(); break;
    case 'scheme-import-parse': parseShareInput(); break;
    case 'scheme-import-ok': applyShareInput(); break;
    case 'scheme-import-back': shareDraft = null; renderSchemeImport(); break;

    /* 补贴与扣款 */
    case 'extra-add': openExtraSheet(); break;
    case 'extra-edit': openExtraSheet(el.dataset.id); break;
    case 'extra-kind':
      if (draftExtra) {
        syncExtraInputs();
        draftExtra.kind = el.dataset.v === 'sub' ? 'sub' : 'add';
        renderExtraSheet();
      }
      break;
    case 'extra-cycle':
      if (draftExtra) {
        syncExtraInputs();
        draftExtra.cycle = el.dataset.v === 'monthly' ? 'monthly' : 'once';
        renderExtraSheet();
      }
      break;
    case 'extra-save': saveExtraSheet(); break;
    case 'extra-del': deleteExtra(); break;
    case 'period-preset': applyPeriodPreset(el.dataset.p); break;
    case 'tpl-sync':
      toast('正在获取模板…');
      syncTemplates().then(r => {
        if (r.ok) {
          toast(`已同步 ${r.count} 个模板`, 'check');
          openPeriodsSheet();
        } else {
          toast('没连上模板服务器，稍后再试');
        }
      });
      break;

    /* 课表文本：快捷导入导出 */
    case 'open-schedule-io': openScheduleIO(el.dataset.ie || 'export'); break;
    case 'ie-tab': if (ieTab !== el.dataset.ie) openScheduleIO(el.dataset.ie); break;
    case 'ie-copy': copyText(ieTextValue(), '课表已复制，可直接粘贴'); break;
    case 'ie-save': saveTextAs(`课表_${todayYmd()}.txt`, ieTextValue(), 'text/plain', '课表文本'); break;
    case 'ie-load': pickScheduleFile(); break;
    case 'ie-clear': {
      const ta = $('#ie-text');
      if (ta) { ta.value = ''; ieText = ''; updateIEStat(); ta.focus(); }
      break;
    }
    case 'ie-mode': ieOpts.mode = el.dataset.mode; renderScheduleIOAfterCapture(); break;
    case 'ie-toggle-sync': ieOpts.sync = !ieOpts.sync; renderScheduleIOAfterCapture(); break;
    case 'ie-apply': applyScheduleFromSheet(); break;
    case 'clear-schedule': openClearSheet(); break;
    case 'clear-demo': {
      const n = demoLessons().length;
      const keep = state.lessons.length - n;
      confirmModal({
        title: '清理示例课？',
        desc: `将删除 ${n} 节演示课程${keep ? `，保留你自己录入的 ${keep} 节` : ''}。作息时间、单价方案与个人信息不受影响。`,
        okText: '清理', danger: true,
        onDone: ok => {
          if (!ok) return;
          closeSheet();
          clearSchedule('demo');
        },
      });
      break;
    }
    case 'clear-all': {
      const n = state.lessons.length;
      confirmModal({
        title: '清空全部课程？',
        desc: `将删除 ${n} 节课、总课表模板以及调课/调休记录，且<b>无法恢复</b>。如需保留请先到「我的」导出备份。`,
        okText: '清空', danger: true,
        onDone: ok => {
          if (!ok) return;
          closeSheet();
          clearSchedule('all');
        },
      });
      break;
    }
    case 'reset-demo':
      confirmModal({
        title: '重置为示例数据？',
        desc: '当前所有课程与调课记录将被清空，并载入演示课表。',
        okText: '重置', danger: true,
        onDone: ok => {
          if (!ok) return;
          state.lessons = seedDemo();
          state.swaps = [];
          state.meta.notified = {};
          save(); render(); toast('已重置为示例数据', 'reset');
        },
      });
      break;
    default: break;
  }
});

// 日期切换需要重绘（节次占用情况变化）
document.addEventListener('change', e => {
  if (e.target.id === 'f-date' && draft) {
    captureLessonForm();
    draft.date = e.target.value || draft.date;
    renderLessonSheet();
  }
  // 手动改完时长后重绘，标出「已手动指定 / 跟随作息」
  if (e.target.id === 'f-dur' && draft) {
    captureLessonForm();
    renderLessonSheet();
  }
  // 同步面板：改本机名称
  if (e.target.id === 'sync-device') {
    setDeviceName(e.target.value);
    toast('已改名', 'check');
  }
  // 总课表：手动填延长分钟数后刷新费用说明
  if (e.target.id === 'm-extend' && draftMaster) {
    captureMasterForm();
    renderMasterEditor();
  }
});

// 时长/人数/延长变化时刷新计费预览
document.addEventListener('input', e => {
  if ((e.target.id === 'f-dur' || e.target.id === 'f-students' || e.target.id === 'f-extend') && draft) {
    captureLessonForm();
    const pv = lessonPreview({ ...draft });
    const el = $('#feePreview');
    if (el) el.textContent = money(pv.total);
    const sub = $('#feePreviewSub');
    if (sub) sub.textContent = pv.sub;
  }
  // 学期范围实时预览
  if ((e.target.id === 't-start' || e.target.id === 't-weeks') && $('#t-range')) {
    const sd = $('#t-start')?.value;
    const wk = clamp(Number($('#t-weeks')?.value) || 20, 1, 30);
    if (sd && /^\d{4}-\d{2}-\d{2}$/.test(sd)) {
      const st = startOfWeek(parseYmd(sd));
      $('#t-range').textContent = `${fmtMD(ymd(st))} – ${fmtMD(ymd(addDays(st, (wk - 1) * 7 + 6)))}`;
    }
  }
});

/* ============================================================
   启动
   ============================================================ */
function init() {
  const ok = load();
  if (!ok || !state.lessons.length) {
    if (!ok) {
      state.lessons = seedDemo();
      save();
    }
  }
  // 自检修过东西就说一声，不悄悄改用户的数据
  const repaired = (state.meta.repairNotes || []).length;
  if (repaired) {
    setTimeout(() => toast(`启动时修正了 ${repaired} 处数据问题`, 'alert'), 900);
  }

  // 老数据补一个学期首周：取最早一节课所在周的周一
  if (!state.settings.termStart) {
    const min = state.lessons.length
      ? state.lessons.reduce((a, l) => (l.date < a ? l.date : a), state.lessons[0].date)
      : todayYmd();
    state.settings.termStart = ymd(startOfWeek(parseYmd(min)));
    save();
  }
  // 总课表为空时，从现有课表里提取一份母版
  if (ensureMaster()) save();
  viewDate = new Date();
  payMonth = todayYmd().slice(0, 7);

  const fab = $('#fabBtn');
  if (fab) fab.addEventListener('click', () => openLessonSheet({}));

  const hashTab = (location.hash || '').replace('#', '');
  if (['home', 'schedule', 'pay', 'mine'].includes(hashTab)) switchTab(hashTab);
  else switchTab('home');

  window.addEventListener('hashchange', () => {
    const h = (location.hash || '').replace('#', '');
    if (['home', 'schedule', 'pay', 'mine'].includes(h)) switchTab(h);
  });

  startReminderLoop();
  maybeAutoCheckUpdate();

  if (IS_NATIVE) {
    // 首次进入与每次启动都把提醒计划交给系统闹钟
    syncNativeReminders();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        syncNativeReminders();
        render();
      }
    });
  }

  // 离线缓存（仅浏览器下的 http/https 生效；安装包内资源本就打包在本地）
  if (!IS_NATIVE && 'serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init();
