import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'fs';
import { parseCSV, mapHeaders, RAMP_FIELDS, TASK_FIELDS, parseDate, loadRamp, funnel, forecast, loadTasks, acceptanceBy, reviewerLoad, dailyRate, median, quantile, checkRateInputs, checkForecastInputs, detectDateOrder, describeDateOrder, xlsxToRows, xlsxToCSV, xlsxSheets } from '../public/lib.js';
const DAY = 864e5, D = s => Date.parse(s + 'T00:00:00Z');

test('parseCSV handles quotes, escaped quotes, CRLF, BOM, comment lines', () => {
  const r = parseCSV('\uFEFF# comment\r\na,b\r\n"x, y","he said ""hi"""\r\n\r\n3,4');
  assert.deepEqual(r.headers, ['a', 'b']); assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].a, 'x, y'); assert.equal(r.rows[0].b, 'he said "hi"');
});
test('parseCSV detects semicolon and tab delimiters', () => {
  assert.deepEqual(parseCSV('a;b\n1;2').rows[0], { a: '1', b: '2' });
  assert.deepEqual(parseCSV('a\tb\n1\t2').rows[0], { a: '1', b: '2' });
});
test('parseDate: ISO, US M/D/YY, datetime, blanks', () => {
  assert.equal(parseDate('2026-10-02'), D('2026-10-02'));
  assert.equal(parseDate('10/2/26'), D('2026-10-02'));
  assert.equal(parseDate('10/02/2026 13:30'), D('2026-10-02') + 13.5 * 3600e3);
  for (const v of ['', 'N/A', 'null', '-', undefined]) assert.equal(parseDate(v), null);
});
test('fuzzy header mapping for ramp exports', () => {
  const m = mapHeaders(['Contributor ID', 'Applied On', 'Screen Passed (date)', 'Training Completed', '1st Accepted Task', 'Hit Productivity', 'Pod', 'Source'], RAMP_FIELDS);
  assert.equal(m.recruited, 'Applied On'); assert.equal(m.screened, 'Screen Passed (date)'); assert.equal(m.trained, 'Training Completed');
  assert.equal(m.firstAccepted, '1st Accepted Task'); assert.equal(m.productive, 'Hit Productivity'); assert.equal(m.vendor, 'Source');
  const m2 = mapHeaders(['worker_id', 'signup_date', 'vetted_on', 'onboarded_at', 'first_task_accepted', 'ramped_at'], RAMP_FIELDS);
  assert.deepEqual([m2.recruited, m2.screened, m2.trained, m2.firstAccepted, m2.productive], ['signup_date', 'vetted_on', 'onboarded_at', 'first_task_accepted', 'ramped_at']);
});
test('fuzzy header mapping for task exports never maps one header twice', () => {
  const m = mapHeaders(['Annotator', 'QA Reviewer', 'Review Outcome', 'Submitted At', 'Team', 'Vendor'], TASK_FIELDS);
  assert.deepEqual(m, { contributor: 'Annotator', reviewer: 'QA Reviewer', status: 'Review Outcome', date: 'Submitted At', pod: 'Team', vendor: 'Vendor' });
  assert.equal(new Set(Object.values(m)).size, Object.values(m).length);
});
test('messy real CSV fixture imports correctly', () => {
  const r = loadRamp(fs.readFileSync(new URL('./fixtures/messy-ramp.csv', import.meta.url), 'utf8'));
  assert.deepEqual(r.missing, []);
  assert.equal(r.map.id, 'Expert Name'); assert.equal(r.map.recruited, 'Date Applied'); assert.equal(r.map.screened, 'Passed Screening?');
  assert.equal(r.map.trained, 'Onboarding complete'); assert.equal(r.map.firstAccepted, 'First approved task'); assert.equal(r.map.productive, 'Fully Ramped');
  assert.equal(r.people.length, 5); assert.equal(r.skipped, 1);
  assert.equal(r.people[0].id, 'Doe, Jane'); assert.equal(r.people[1].id, 'Smith; Bob'); assert.equal(r.people[2].id, 'O"Neil');
  const kim = r.people.find(p => p.id === 'Kim'); assert.equal(kim.productive, null, 'skipped-stage row is counted only up to its first gap');
  assert.deepEqual(r.skippedStage, [{ row: 6, id: 'Kim', missing: 'screened' }]);
  const f = funnel(r.people);
  assert.deepEqual(f.stages.map(s => s.count), [5, 3, 2, 1, 1]);
  assert.equal(f.bottleneck.key, 'firstAccepted');
  assert.equal(f.ttpMedian, 7);
});
test('funnel conversion, drop-off and time to productivity', () => {
  const ps = [0, 1, 2, 3].map(i => ({ recruited: D('2026-10-01'), screened: i < 3 ? D('2026-10-02') : null, trained: i < 2 ? D('2026-10-03') : null, firstAccepted: i < 2 ? D('2026-10-04') : null, productive: i < 1 ? D('2026-10-06') : null }));
  const f = funnel(ps);
  assert.equal(f.stages[1].convFromPrev, 0.75); assert.equal(f.stages[1].dropOff, 1);
  assert.equal(f.overall, 0.25); assert.equal(f.ttpMedian, 5);
  assert.equal(f.bottleneck.key, 'productive');
});
test('forecast: 1,000 in 3 days is infeasible when TTP > 3 days', () => {
  const r = forecast({ n: 1000, start: D('2026-10-22'), deadline: D('2026-10-25'), rates: [0.5, 0.8, 0.9, 0.8], ttpDays: 5, capacity: 10000 });
  assert.equal(r.feasible, false); assert.match(r.reason, /longer than/);
  assert.equal(r.needRecruits, Math.ceil(1000 / (0.5 * 0.8 * 0.9 * 0.8)));
});
test('forecast: feasible and capacity-bound cases', () => {
  const ok = forecast({ n: 100, start: 0, deadline: 10 * DAY, rates: [0.5, 1, 1, 1], ttpDays: 2, capacity: 50 });
  assert.equal(ok.needRecruits, 200); assert.equal(ok.needPerDay, 25); assert.equal(ok.feasible, true); assert.equal(ok.earliestDays, 6);
  const no = forecast({ n: 1000, start: 0, deadline: 10 * DAY, rates: [0.5, 1, 1, 1], ttpDays: 2, capacity: 50 });
  assert.equal(no.feasible, false); assert.equal(no.reachable, 200);
  assert.equal(forecast({ n: 5, start: 0, deadline: DAY * 9, rates: [0, 1, 1, 1], ttpDays: 1, capacity: 9 }).feasible, false);
});
test('tasks: status synonyms, acceptance by group, reviewer load, daily rate', () => {
  const csv = 'Annotator,Outcome,Vendor,Reviewed By,Day\na,Approved,V1,r1,2026-10-01\na,rework,V1,r1,2026-10-01\nb,PASS,V2,r2,2026-10-02\nb,accepted,V2,r1,2026-10-02\nc,???,V2,r1,2026-10-02';
  const { tasks } = loadTasks(csv);
  assert.deepEqual(tasks.map(t => t.accepted), [true, false, true, true, null]);
  const acc = acceptanceBy(tasks, 'vendor'); assert.equal(acc[0].key, 'V1'); assert.equal(acc[0].rate, 0.5); assert.equal(acc[1].rate, 1);
  const rl = reviewerLoad(tasks); assert.equal(rl[0].reviewer, 'r1'); assert.equal(rl[0].n, 4); assert.equal(rl[0].perDay, 2);
  const d = dailyRate(tasks, { target: 10, start: D('2026-10-01'), deadline: D('2026-10-04'), asOf: D('2026-10-02') });
  assert.equal(d.delivered, 3); assert.equal(d.actualPerDay, 1.5); assert.equal(d.remainingDays, 2); assert.equal(d.requiredPerDay, 3.5); assert.equal(d.onTrack, false);
});
test('median / quantile', () => { assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5); assert.equal(quantile([0, 10], 0.8), 8); assert.equal(median([]), null); });
test('bundled data is labelled ILLUSTRATIVE', () => {
  for (const f of ['illustrative-ramp.csv', 'illustrative-tasks.csv']) assert.match(fs.readFileSync(new URL('../public/data/' + f, import.meta.url), 'utf8').split('\n')[0], /ILLUSTRATIVE DATA/);
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /ILLUSTRATIVE DATA/); assert.doesNotMatch(html, /example\.com|href="#"|fonts\.googleapis|fonts\.gstatic/);
});
test('DD/MM vs MM/DD detected per file and applied', () => {
  assert.equal(detectDateOrder(['03/10/2026', '13/10/2026']).order, 'dmy');
  assert.equal(detectDateOrder(['10/03/2026', '10/13/2026']).order, 'mdy');
  const amb = detectDateOrder(['03/10/2026', '2026-10-05']); assert.equal(amb.basis, 'ambiguous'); assert.match(describeDateOrder(amb), /MM\/DD\/YYYY \(US default\)/);
  assert.equal(detectDateOrder(['2026-10-01']).basis, 'none');
  assert.equal(detectDateOrder(['13/01/2026', '01/13/2026']).basis, 'conflict');
  assert.equal(parseDate('03/10/2026', 'dmy'), D('2026-10-03')); assert.equal(parseDate('03/10/2026'), D('2026-03-10'));
  assert.equal(parseDate('13/10/2026', 'mdy'), null, 'impossible month is rejected, not rolled over');
  const r = loadRamp(fs.readFileSync(new URL('./fixtures/dmy-ramp.csv', import.meta.url), 'utf8'));
  assert.equal(r.dateOrder.order, 'dmy'); assert.equal(r.people[0].productive, D('2026-10-13')); assert.equal(funnel(r.people).ttpMedian, 10);
});
test('stage-date order violations are flagged', () => {
  const r = loadRamp(fs.readFileSync(new URL('./fixtures/dmy-ramp.csv', import.meta.url), 'utf8'));
  assert.deepEqual(r.violations, [{ row: 4, id: 'C', earlier: 'screened', later: 'trained' }]);
  assert.equal(loadRamp(fs.readFileSync(new URL('./fixtures/messy-ramp.csv', import.meta.url), 'utf8')).violations.length, 0);
});
test('XLSX import: real openpyxl workbook with shared strings, date cells, text dates, blanks', async () => {
  const buf = fs.readFileSync(new URL('./fixtures/ramp.xlsx', import.meta.url));
  const rows = await xlsxToRows(buf);
  assert.deepEqual(rows[0], ['Worker ID', 'Signup Date', 'Vetted On', 'Onboarded At', 'First Task Accepted', 'Ramped At', 'Team']);
  assert.equal(rows[3][0], 'W-3 "quoted", comma'); assert.equal(rows[2][3], '');
  const r = loadRamp(await xlsxToCSV(buf));
  assert.deepEqual(r.missing, []); assert.equal(r.people.length, 4); assert.equal(r.skipped, 1);
  assert.equal(r.people[0].recruited, D('2026-10-01')); assert.equal(r.people[0].productive, D('2026-10-08'));
  assert.equal(r.people[2].id, 'W-3 "quoted", comma'); assert.equal(r.people[2].trained, D('2026-10-06'));
  assert.deepEqual(funnel(r.people).stages.map(s => s.count), [4, 4, 3, 2, 2]);
  assert.deepEqual(r.violations.map(v => v.id), ['W-4']);
  await assert.rejects(xlsxToRows(new TextEncoder().encode('a,b\n1,2').buffer), /Not an XLSX/);
});
test('XLSX: every sheet is listed and any sheet can be read', async () => {
  const buf = fs.readFileSync(new URL('./fixtures/ramp.xlsx', import.meta.url));
  assert.deepEqual(await xlsxSheets(buf), ['Contributors', 'Cohort B & notes']);
  const r = loadRamp(await xlsxToCSV(buf, 1));
  assert.deepEqual(r.people.map(p => p.id), ['B-1', 'B-2']); assert.deepEqual(funnel(r.people).stages.map(s => s.count), [2, 1, 1, 1, 1]);
});
test('funnel cohort cutoff: recent recruits are not counted as drop-offs', () => {
  const old = [0, 1, 2, 3].map(i => ({ recruited: D('2026-10-01'), screened: i < 2 ? D('2026-10-03') : null, trained: null, firstAccepted: null, productive: null }));
  const fresh = [0, 1, 2, 3, 4, 5].map(() => ({ recruited: D('2026-10-09'), screened: null, trained: null, firstAccepted: null, productive: null }));
  const f = funnel([...old, ...fresh], { asOf: D('2026-10-10') });
  assert.equal(f.stages[1].rawConv, 0.2); assert.equal(f.stages[1].eligible, 4); assert.equal(f.stages[1].convFromPrev, 0.5);
});
test('daily rate measures from as-of (today), pace from the data span, and reports staleness', () => {
  const tasks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(d => ({ accepted: true, date: D(`2026-10-${String(d).padStart(2, '0')}`) }));
  const r = dailyRate(tasks, { target: 30, start: D('2026-10-01'), deadline: D('2026-10-21'), asOf: D('2026-10-19'), dataEnd: D('2026-10-10') });
  assert.equal(r.actualPerDay, 1); assert.equal(r.remainingDays, 2); assert.equal(r.requiredPerDay, 10); assert.equal(r.staleDays, 9); assert.equal(r.onTrack, false);
  assert.equal(dailyRate(tasks, { target: 5, start: D('2026-10-01'), deadline: D('2026-10-21'), asOf: D('2026-10-19'), dataEnd: D('2026-10-10') }).requiredPerDay, 0);
});
test('input guards: negative/empty target, empty dates, X before start', () => {
  assert.match(checkRateInputs({ target: -5, deadline: 1 }), /target/); assert.match(checkRateInputs({ target: NaN, deadline: 1 }), /target/);
  assert.match(checkRateInputs({ target: 10, deadline: NaN }), /deadline/); assert.equal(checkRateInputs({ target: 10, deadline: 1 }), null);
  assert.match(checkForecastInputs({ n: 0, start: 0, deadline: DAY, capacity: 1 }), /N of at least 1/);
  assert.match(checkForecastInputs({ n: 5, start: NaN, deadline: DAY, capacity: 1 }), /start/);
  assert.match(checkForecastInputs({ n: 5, start: 0, deadline: NaN, capacity: 1 }), /date X/);
  assert.match(checkForecastInputs({ n: 5, start: DAY, deadline: 0, capacity: 1 }), /after the start/);
  assert.equal(checkForecastInputs({ n: 5, start: 0, deadline: DAY, capacity: 1 }), null);
});
test("task header 'who' maps to contributor", () => { assert.equal(mapHeaders(['who', 'result', 'day'], TASK_FIELDS).contributor, 'who'); });
test('200k-row task file loads and aggregates in under 2s', () => {
  const rows = ['worker,outcome,date,reviewer']; for (let i = 0; i < 200000; i++) rows.push(`w${i % 5000},${i % 5 ? 'accepted' : 'rejected'},2026-10-${String(1 + i % 10).padStart(2, '0')},r${i % 40}`);
  const t0 = Date.now(); const { tasks } = loadTasks(rows.join('\n'));
  acceptanceBy(tasks, 'contributor'); reviewerLoad(tasks); dailyRate(tasks, { target: 1e6, start: D('2026-10-01'), deadline: D('2026-10-21'), asOf: D('2026-10-19'), dataEnd: D('2026-10-10') });
  assert.equal(tasks.length, 200000); assert.ok(Date.now() - t0 < 2000, `${Date.now() - t0} ms`);
});
