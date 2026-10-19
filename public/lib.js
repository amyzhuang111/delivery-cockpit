// Delivery Cockpit — pure logic (no DOM). Tested in test/lib.test.mjs.
export function parseCSV(text) {
  text = String(text).replace(/^\uFEFF/, '').replace(/^(?:\s*#[^\n]*\n)+/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const delim = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';'
    : (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(v => v.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell); if (row.some(v => v.trim() !== '')) rows.push(row);
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map(h => h.trim());
  return { headers, rows: rows.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}

const stem = t => t.length > 4 ? t.replace(/(ivity|ive|ion|ed|ing|s)$/, '') : t;
const norm = s => String(s).toLowerCase().replace(/\b1st\b/g, 'first').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').map(stem).join(' ');
// distinctive word stems: one of these alone is enough evidence (score 45)
const KEYS = { recruited: ['recruit', 'appli', 'signup', 'sourc'], screened: ['screen', 'vett', 'qualifi'], trained: ['train', 'onboard', 'certifi'],
  firstAccepted: ['first'], productive: ['product', 'ramp'], reviewer: ['review', 'qa', 'auditor', 'grader'], status: ['outcome', 'status', 'verdict', 'decision'] };

export const RAMP_FIELDS = {
  id: ['id', 'contributor id', 'contributor', 'worker id', 'worker', 'expert id', 'candidate id', 'candidate', 'email', 'name', 'user id'],
  recruited: ['recruited', 'recruited at', 'recruit date', 'applied', 'applied at', 'application date', 'signup', 'sign up date', 'sourced', 'created at', 'date applied'],
  screened: ['screened', 'screened at', 'screen passed', 'screening passed', 'passed screen', 'vetted', 'interview passed', 'assessment passed', 'qualified', 'qualification date'],
  trained: ['trained', 'trained at', 'training complete', 'training completed', 'onboarded', 'onboarding complete', 'course done', 'certified'],
  firstAccepted: ['first accepted', 'first accepted task', 'first accepted at', 'first approved task', 'first task accepted', 'first approval', 'first accept date'],
  productive: ['productive', 'productive at', 'reached productivity', 'ramped', 'fully ramped', 'hit quota', 'steady state', 'productive date'],
  pod: ['pod', 'team', 'squad', 'cohort', 'group'],
  vendor: ['vendor', 'source', 'channel', 'agency', 'partner']
};
export const TASK_FIELDS = {
  contributor: ['contributor', 'who', 'contributor id', 'done by', 'submitted by', 'worker', 'worker id', 'annotator', 'expert', 'author', 'labeler'],
  pod: ['pod', 'team', 'squad', 'group'],
  vendor: ['vendor', 'source', 'agency', 'partner'],
  reviewer: ['reviewer', 'reviewed by', 'qa', 'qa reviewer', 'auditor', 'grader'],
  status: ['status', 'review status', 'outcome', 'result', 'decision', 'verdict', 'accepted'],
  date: ['date', 'submitted', 'submitted at', 'submission date', 'day', 'created at', 'timestamp']
};

function score(header, syn, field) {
  const h = norm(header); if (!h) return 0;
  syn = syn.map(norm);
  const hc = h.replace(/ /g, '');
  let best = 0;
  for (const s of syn) {
    const sc = s.replace(/ /g, '');
    if (h === s || hc === sc) return 100;
    const ht = h.split(' '), st = s.split(' ');
    const overlap = st.filter(t => ht.includes(t)).length;
    if (overlap === st.length) best = Math.max(best, 70 - (ht.length - st.length) * 2);
    else if (overlap) best = Math.max(best, 30 * overlap / st.length);
    if (hc.includes(sc) && sc.length >= 4) best = Math.max(best, 60);
  }
  const ht = h.split(' ');
  for (const k of KEYS[field] || []) if (ht.some(t => t.startsWith(k))) best = Math.max(best, field === 'firstAccepted' ? (ht.some(t => t.startsWith('accept') || t.startsWith('approv') || t === 'task') ? 65 : 0) : 45);
  return best;
}
/** Map canonical field -> actual header. Greedy, highest score first, threshold 40. */
export function mapHeaders(headers, fields) {
  const cands = [];
  for (const [f, syn] of Object.entries(fields)) headers.forEach(h => { const s = score(h, syn, f); if (s >= 40) cands.push({ f, h, s }); });
  cands.sort((a, b) => b.s - a.s);
  const out = {}, used = new Set();
  for (const c of cands) if (!(c.f in out) && !used.has(c.h)) { out[c.f] = c.h; used.add(c.h); }
  return out;
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
/** order: 'mdy' (US, default) or 'dmy' for slash/dot dates like 03/10/26. ISO dates and Excel serials are unambiguous. */
export function parseDate(v, order = 'mdy') {
  if (v == null) return null; v = String(v).trim(); if (!v || /^(n\/?a|null|none|-|—)$/i.test(v)) return null;
  if (/^\d{5}(\.\d+)?$/.test(v) && +v > 20000 && +v < 80000) return EXCEL_EPOCH + Math.round(+v * 86400000 / 60000) * 60000; // Excel serial date
  let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]) + timeOfDay(v);
  m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; const [mo, d] = order === 'dmy' ? [+m[2], +m[1]] : [+m[1], +m[2]]; if (mo > 12 || d > 31) return null; return Date.UTC(y, mo - 1, d) + timeOfDay(v); }
  const t = Date.parse(v); return isNaN(t) ? null : t;
}
/** Decide DD/MM vs MM/DD for one file from its slash dates. A first part >12 proves DD/MM; a second part >12 proves MM/DD. */
export function detectDateOrder(values) {
  let dmy = 0, mdy = 0, slash = 0;
  for (const v of values) { const m = String(v ?? '').trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/); if (!m) continue; slash++; if (+m[1] > 12) dmy++; if (+m[2] > 12) mdy++; }
  if (!slash) return { order: 'mdy', basis: 'none', slash, dmy, mdy };
  if (dmy && mdy) return { order: mdy >= dmy ? 'mdy' : 'dmy', basis: 'conflict', slash, dmy, mdy };
  if (dmy) return { order: 'dmy', basis: 'evidence', slash, dmy, mdy };
  if (mdy) return { order: 'mdy', basis: 'evidence', slash, dmy, mdy };
  return { order: 'mdy', basis: 'ambiguous', slash, dmy, mdy };
}
export function describeDateOrder(d) {
  if (!d || d.basis === 'none') return 'Dates: ISO / Excel dates only, no DD/MM vs MM/DD choice needed.';
  const f = d.order === 'dmy' ? 'DD/MM/YYYY' : 'MM/DD/YYYY';
  if (d.basis === 'evidence') return `Dates read as ${f}: ${d.order === 'dmy' ? d.dmy : d.mdy} of ${d.slash} slash dates only make sense that way.`;
  if (d.basis === 'conflict') return `Dates read as ${f}, but the file mixes both (${d.mdy} look MM/DD, ${d.dmy} look DD/MM). Check the export.`;
  return `Dates read as ${f} (US default): all ${d.slash} slash dates have day ≤ 12, so the file can't tell us.`;
}
function timeOfDay(v) { const m = v.match(/[ T](\d{1,2}):(\d{2})/); return m ? (+m[1] * 60 + +m[2]) * 60000 : 0; }
const DAY = 86400000;
export const STAGES = ['recruited', 'screened', 'trained', 'firstAccepted', 'productive'];
export const STAGE_LABEL = { recruited: 'Recruited', screened: 'Screened', trained: 'Trained', firstAccepted: 'First accepted task', productive: 'Productive' };

export function loadRamp(text) {
  const { headers, rows } = parseCSV(text);
  const map = mapHeaders(headers, RAMP_FIELDS);
  const missing = STAGES.filter(s => !map[s]);
  const dateOrder = detectDateOrder(rows.flatMap(r => STAGES.filter(s => map[s]).map(s => r[map[s]])));
  const violations = [], skippedStage = [];
  const people = rows.map((r, i) => {
    const p = { id: map.id ? r[map.id] : `row ${i + 2}`, pod: map.pod ? r[map.pod] : '', vendor: map.vendor ? r[map.vendor] : '' };
    for (const s of STAGES) p[s] = map[s] ? parseDate(r[map[s]], dateOrder.order) : null;
    // stage dates must not go backwards (e.g. trained before screened)
    let prev = null;
    for (const s of STAGES) if (p[s] != null) { if (prev && p[s] < p[prev]) { violations.push({ row: i + 2, id: p.id, earlier: prev, later: s }); p.orderViolation = true; } prev = s; }
    // skipped stage: a later stage has a date but an earlier one is blank. Count the person only up to the first gap
    // (so later-stage conversion isn't inflated) and list the row so the export can be fixed.
    const gap = STAGES.findIndex(st => p[st] == null);
    if (gap > 0 && STAGES.slice(gap).some(st => p[st] != null)) { skippedStage.push({ row: i + 2, id: p.id, missing: STAGES[gap] }); for (const st of STAGES.slice(gap)) p[st] = null; }
    return p;
  }).filter(p => p.recruited != null);
  return { map, missing, people, skipped: rows.length - people.length, headers, dateOrder, violations, skippedStage: skippedStage.filter(x => people.some(p => p.id === x.id)) };
}

export function median(a) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
export function quantile(a, q) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); }

const maxOf = a => { let m = -Infinity; for (const v of a) if (v > m) m = v; return m; };
const minOf = a => { let m = Infinity; for (const v of a) if (v < m) m = v; return m; };
export { maxOf, minOf };
/**
 * Funnel with a cohort age cutoff. Raw counts include in-flight recruits. Conversion for stage i uses only people who reached
 * stage i-1 at least the P80 lag (i-1 -> i) before the data's last date, so recent recruits aren't counted as drop-offs.
 */
export function funnel(people, { asOf } = {}) {
  asOf ??= maxOf(people.flatMap(p => STAGES.map(s => p[s]).filter(v => v != null)));
  const counts = STAGES.map(s => people.filter(p => p[s] != null).length);
  const stages = STAGES.map((s, i) => {
    const o = { key: s, label: STAGE_LABEL[s], count: counts[i], convFromPrev: 1, rawConv: 1, dropOff: 0, medianDaysFromPrev: null, lagP80: null, eligible: counts[0], mature: true };
    if (!i) return o;
    const prev = STAGES[i - 1], lags = people.filter(p => p[s] != null && p[prev] != null).map(p => (p[s] - p[prev]) / DAY);
    o.medianDaysFromPrev = median(lags); o.lagP80 = lags.length ? quantile(lags, 0.8) : 0;
    o.rawConv = counts[i - 1] ? counts[i] / counts[i - 1] : 0; o.dropOff = counts[i - 1] - counts[i];
    const elig = people.filter(p => p[prev] != null && p[prev] <= asOf - Math.ceil(o.lagP80) * DAY);
    o.eligible = elig.length; o.mature = elig.length > 0;
    o.convFromPrev = elig.length ? elig.filter(p => p[s] != null).length / elig.length : o.rawConv;
    return o;
  });
  const ttp = people.filter(p => p.productive != null).map(p => (p.productive - p.recruited) / DAY);
  const overall = stages.slice(1).reduce((a, st) => a * st.convFromPrev, 1), rawOverall = counts[0] ? counts[4] / counts[0] : 0;
  let worst = null;
  stages.slice(1).forEach(st => { if (!worst || st.convFromPrev < worst.convFromPrev) worst = st; });
  return { stages, overall, rawOverall, asOf, ttpMedian: median(ttp), ttpP80: quantile(ttp, 0.8), bottleneck: worst };
}

/** Observed recruit intake per day over the data's span. */
export function intakePerDay(people) {
  const t = people.map(p => p.recruited); if (!t.length) return 0;
  const span = Math.max(1, Math.round((maxOf(t) - minOf(t)) / DAY) + 1);
  return t.length / span;
}

/**
 * Can we have N productive contributors by `deadline` starting `start`?
 * rates: stage conversion array (4 numbers), ttpDays: days recruit->productive (use P80 for safety),
 * capacity: recruits/day we can actually source.
 */
export function forecast({ n, start, deadline, rates, ttpDays, capacity }) {
  const overall = rates.reduce((a, r) => a * r, 1);
  const days = (deadline - start) / DAY;
  const recruitWindow = days - ttpDays; // last day a recruit can enter and still be productive
  const needRecruits = overall > 0 ? Math.ceil(n / overall) : Infinity;
  const needPerDay = recruitWindow > 0 ? needRecruits / recruitWindow : Infinity;
  const feasible = recruitWindow > 0 && needPerDay <= capacity;
  const reachable = recruitWindow > 0 ? Math.floor(capacity * recruitWindow * overall) : 0;
  const earliestDays = overall > 0 && capacity > 0 ? ttpDays + needRecruits / capacity : Infinity;
  let reason;
  if (overall <= 0) reason = 'Conversion is 0% at some stage — nobody reaches productive.';
  else if (recruitWindow <= 0) reason = `Time-to-productivity (${ttpDays.toFixed(1)} d) is longer than the ${days.toFixed(1)} days available. Shorten a stage or start earlier.`;
  else if (!feasible) reason = `Needs ${needPerDay.toFixed(0)} recruits/day for ${recruitWindow.toFixed(1)} days; capacity is ${capacity.toFixed(0)}/day. At capacity you reach ~${reachable}.`;
  else reason = `Needs ${needPerDay.toFixed(0)} recruits/day for ${recruitWindow.toFixed(1)} days (capacity ${capacity.toFixed(0)}/day).`;
  return { overall, days, earliestDays, recruitWindow, needRecruits, needPerDay, feasible, reachable, reason };
}

// ---------- delivery / quality ----------
const ACCEPT = /^(accept(ed)?|approved?|pass(ed)?|ok|yes|true|1|good)$/i;
const REJECT = /^(reject(ed)?|declined?|fail(ed)?|no|false|0|bad|rework|redo|returned)$/i;
export function loadTasks(text) {
  const { headers, rows } = parseCSV(text);
  const map = mapHeaders(headers, TASK_FIELDS);
  const dateOrder = detectDateOrder(map.date ? rows.map(r => r[map.date]) : []);
  const tasks = rows.map(r => {
    const st = map.status ? r[map.status] : '';
    return {
      contributor: map.contributor ? r[map.contributor] : '', pod: map.pod ? r[map.pod] : '', vendor: map.vendor ? r[map.vendor] : '',
      reviewer: map.reviewer ? r[map.reviewer] : '', date: map.date ? parseDate(r[map.date], dateOrder.order) : null,
      accepted: ACCEPT.test(st) ? true : REJECT.test(st) ? false : null
    };
  });
  return { map, tasks, headers, dateOrder };
}
export function acceptanceBy(tasks, key) {
  const g = new Map();
  for (const t of tasks) { if (t.accepted == null || !t[key]) continue; const k = t[key]; const o = g.get(k) || { key: k, n: 0, acc: 0 }; o.n++; if (t.accepted) o.acc++; g.set(k, o); }
  return [...g.values()].map(o => ({ ...o, rate: o.acc / o.n })).sort((a, b) => a.rate - b.rate || b.n - a.n);
}
export function reviewerLoad(tasks) {
  const g = new Map(); const days = new Set();
  for (const t of tasks) { if (!t.reviewer) continue; g.set(t.reviewer, (g.get(t.reviewer) || 0) + 1); if (t.date) days.add(Math.floor(t.date / DAY)); }
  const d = Math.max(1, days.size);
  return [...g.entries()].map(([k, n]) => ({ reviewer: k, n, perDay: n / d })).sort((a, b) => b.n - a.n);
}
/**
 * asOf = the day "from here" starts (default: today). dataEnd = last date in the export.
 * Pace is measured over start..dataEnd. Remaining days run inclusively from the first day not yet in the data
 * (max(asOf, dataEnd + 1)) through the deadline, so a deadline of today still has 1 day left.
 * gapDays = days between the last data date and asOf that have no data. Projection is a range:
 *   low  = those gap days produced nothing; high = they ran at the measured pace.
 */
export function dailyRate(tasks, { target, start, deadline, asOf, dataEnd = asOf }) {
  let delivered = 0; const byDay = new Map();
  for (const t of tasks) { if (!t.accepted || t.date == null) continue; delivered++; const d = Math.floor(t.date / DAY) * DAY; byDay.set(d, (byDay.get(d) || 0) + 1); }
  const series = [...byDay.entries()].sort((a, b) => a[0] - b[0]);
  const elapsed = Math.max(1, Math.round((dataEnd - start) / DAY) + 1);
  const from = Math.max(asOf, dataEnd + DAY);
  const remainingDays = Math.max(0, Math.round((deadline - from) / DAY) + 1);
  const gapDays = Math.max(0, Math.round((Math.min(asOf, deadline + DAY) - dataEnd) / DAY) - 1);
  const actualPerDay = delivered / elapsed;
  const left = Math.max(0, target - delivered);
  const requiredPerDay = remainingDays > 0 ? left / remainingDays : (left ? Infinity : 0);
  const projectedLow = delivered + actualPerDay * remainingDays, projectedHigh = projectedLow + actualPerDay * gapDays;
  const etaDays = actualPerDay > 0 ? Math.ceil(left / actualPerDay) : Infinity; // days after dataEnd, gap at pace
  return { delivered, series, actualPerDay, requiredPerDay, remainingDays, gapDays, dueToday: remainingDays === 1 && Math.round((deadline - from) / DAY) === 0,
    projected: projectedLow, projectedLow, projectedHigh, onTrack: projectedLow >= target, maybe: projectedLow < target && projectedHigh >= target,
    staleDays: Math.max(0, Math.round((asOf - dataEnd) / DAY)), etaHigh: dataEnd + etaDays * DAY, etaLow: Math.max(asOf - DAY, dataEnd) + etaDays * DAY };
}
/** Safe ISO date: '' for anything toISOString would throw on. */
export const isoDate = t => Number.isFinite(t) && Math.abs(t) <= 8.64e15 ? new Date(t).toISOString().slice(0, 10) : '';
export function checkThreshold(v) { return v === '' || !Number.isFinite(+v) || +v < 0 || +v > 100 ? 'Flag threshold must be between 0 and 100.' : null; }
/** Input checks for the rate panel and forecast. Returns a message or null. */
export function checkRateInputs({ target, deadline }) {
  if (!Number.isFinite(target) || target < 1) return 'Enter a target of at least 1 accepted task.';
  if (target > 1e9) return 'Target is capped at 1,000,000,000.';
  if (!Number.isFinite(deadline)) return 'Enter a deadline date.';
  return null;
}
export function checkForecastInputs({ n, start, deadline, capacity }) {
  if (!Number.isFinite(n) || n < 1) return 'Enter N of at least 1.';
  if (n > 1e6) return 'N is capped at 1,000,000.';
  if (!Number.isFinite(start)) return 'Enter a start date.';
  if (!Number.isFinite(deadline)) return 'Enter date X.';
  if (deadline <= start) return 'Date X must be after the start date.';
  if (!Number.isFinite(capacity) || capacity <= 0) return 'Enter a recruits/day capacity above 0.';
  if (capacity > 1e6) return 'Capacity is capped at 1,000,000 recruits/day.';
  if ((deadline - start) / DAY > 3650) return 'Date X must be within 10 years of the start.';
  return null;
}

// ---------- XLSX (first worksheet) -> CSV text, no dependencies ----------
const u16 = (b, o) => b[o] | b[o + 1] << 8, u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
async function unzip(buf) {
  const b = new Uint8Array(buf); let e = b.length - 22;
  while (e >= 0 && u32(b, e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Not an XLSX file (no zip directory found).');
  const files = {}; let o = u32(b, e + 16);
  for (let n = u16(b, e + 10); n--;) {
    const method = u16(b, o + 10), csize = u32(b, o + 20), nl = u16(b, o + 28), xl = u16(b, o + 30), cl = u16(b, o + 32), lo = u32(b, o + 42);
    const name = new TextDecoder().decode(b.subarray(o + 46, o + 46 + nl));
    files[name] = { method, csize, lo }; o += 46 + nl + xl + cl;
  }
  const read = async name => {
    const f = files[name]; if (!f) return null;
    const start = f.lo + 30 + u16(b, f.lo + 26) + u16(b, f.lo + 28), raw = b.subarray(start, start + f.csize);
    if (f.method === 0) return new TextDecoder().decode(raw);
    if (f.method !== 8) throw new Error('Unsupported compression in XLSX.');
    const ds = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new TextDecoder().decode(await new Response(ds).arrayBuffer());
  };
  return { names: Object.keys(files), read };
}
const xmlText = s => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
const colIdx = ref => { let n = 0; for (const c of ref.replace(/\d+$/, '')) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };
/** Sheet names and their XML paths, in workbook order. */
async function sheetList(z) {
  const wb = await z.read('xl/workbook.xml'), rels = await z.read('xl/_rels/workbook.xml.rels');
  const target = {}; for (const m of (rels || '').matchAll(/<Relationship\b[^>]*>/g)) { const id = (m[0].match(/\bId="([^"]+)"/) || [])[1], t = (m[0].match(/\bTarget="([^"]+)"/) || [])[1]; if (id && t) target[id] = t.replace(/^\/?(xl\/)?/, 'xl/'); }
  const out = [...(wb || '').matchAll(/<sheet\b[^>]*>/g)].map(m => ({ name: xmlText((m[0].match(/\bname="([^"]*)"/) || [])[1] || ''), path: target[(m[0].match(/\br:id="([^"]+)"/) || [])[1]] })).filter(x => x.path && z.names.includes(x.path));
  return out.length ? out : z.names.filter(n => /^xl\/worksheets\/[^/]+\.xml$/.test(n)).sort().map((path, i) => ({ name: `Sheet ${i + 1}`, path }));
}
export async function xlsxSheets(buf) { return (await sheetList(await unzip(buf))).map(s => s.name); }
/** Rows of one worksheet (index into xlsxSheets order; default first). */
export async function xlsxToRows(buf, sheetIndex = 0) {
  const z = await unzip(buf);
  const ss = await z.read('xl/sharedStrings.xml');
  const shared = ss ? [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => xmlText([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(''))) : [];
  const sheets = await sheetList(z), sheet = (sheets[sheetIndex] || {}).path;
  if (!sheet) throw new Error('No worksheet found in XLSX.');
  const xml = await z.read(sheet), rows = [];
  for (const rm of xml.matchAll(/<row[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row = [];
    for (const cm of (rm[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], inner = cm[2] || '', ref = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1], t = (attrs.match(/\bt="(\w+)"/) || [])[1];
      const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val = t === 's' ? shared[+v] ?? '' : t === 'inlineStr' ? xmlText((inner.match(/<is>([\s\S]*?)<\/is>/) || ['', ''])[1]) : v != null ? xmlText(v) : '';
      if (t === 'b') val = val === '1' ? 'TRUE' : 'FALSE';
      row[ref ? colIdx(ref) : row.length] = val;
    }
    rows.push(Array.from(row, x => x ?? ''));
  }
  return rows;
}
export const rowsToCSV = rows => rows.map(r => r.map(c => /[",\n\r]/.test(c) ? '"' + String(c).replace(/"/g, '""') + '"' : c).join(',')).join('\n');
export const xlsxToCSV = async (buf, sheetIndex = 0) => rowsToCSV(await xlsxToRows(buf, sheetIndex));
