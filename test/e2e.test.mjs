// Run: E2E_URL=https://... node --test test/e2e.test.mjs
import test from 'node:test'; import assert from 'node:assert/strict'; import puppeteer from 'puppeteer-core'; import path from 'path'; import fs from 'fs'; import os from 'os';
const URL_ = process.env.E2E_URL || 'http://localhost:47311/';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
let browser; test.before(async () => { browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox'] }); });
test.after(async () => browser && browser.close());
async function open(w = 1280) {
  const p = await browser.newPage(); await p.setViewport({ width: w, height: 900 });
  const ext = []; p.on('request', r => { const u = new URL(r.url()); if (/^https?:/.test(u.protocol) && u.origin !== new URL(URL_).origin) ext.push(r.url()); });
  await p.goto(URL_, { waitUntil: 'networkidle0' }); await p.waitForSelector('body[data-ready="1"]'); return { p, ext };
}
test('loads, labels illustrative data, makes no third-party requests, uses self-hosted Inter', async () => {
  const { p, ext } = await open();
  const txt = await p.evaluate(() => document.body.innerText);
  assert.match(txt, /ILLUSTRATIVE DATA/); assert.deepEqual(ext, []);
  assert.equal(await p.evaluate(async () => { await document.fonts.ready; return document.fonts.check('300 16px Inter'); }), true);
  assert.equal(await p.evaluate(() => [...document.fonts].some(f => f.family.replace(/"/g, '') === 'Inter' && f.status === 'loaded')), true);
  await p.close();
});
test('demo moment: 1,000 in 3 days → verdict No, bottleneck highlighted, decision logged', async () => {
  const { p } = await open();
  await p.evaluate(() => localStorage.clear()); await p.reload({ waitUntil: 'networkidle0' }); await p.waitForSelector('body[data-ready="1"]');
  await p.click('#demo-btn'); await new Promise(r => setTimeout(r, 900));
  const v = await p.$eval('#verdict', e => e.innerText); const want = await p.evaluate(() => { const n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) + 3 * 864e5).toISOString().slice(0, 10); });
  assert.ok(v.startsWith(`No: 1,000 productive by ${want}`), v);
  assert.equal(await p.$eval('#fc-n', e => e.value), '1000');
  assert.ok(await p.$('.funnel .bar.worst.hl'));
  assert.match(await p.$eval('#log-body', e => e.innerText), /DEMO\s+1,000-in-3-days check on ILLUSTRATIVE data: NOT feasible/i);
  await p.click('#demo-btn'); await new Promise(r => setTimeout(r, 300)); await p.click('#demo-btn'); await new Promise(r => setTimeout(r, 300));
  assert.equal((await p.$$('#log-body tr.demo-row')).length, 1, 'demo is idempotent');
  await p.close();
});
test('uploading a messy CSV maps headers and recomputes the funnel', async () => {
  const { p } = await open();
  const inp = await p.$('#ramp-file'); await inp.uploadFile(path.resolve('test/fixtures/messy-ramp.csv'));
  await p.waitForFunction(() => /Fully Ramped/.test(document.querySelector('#ramp-map').innerText));
  const map = await p.$eval('#ramp-map', e => e.innerText); assert.doesNotMatch(map, /not found/); assert.match(map, /1 row\(s\) skipped/);
  const counts = await p.$$eval('#funnel .bar .n', es => es.map(e => e.innerText.split(' ')[0]));
  assert.deepEqual(counts, ['5', '3', '2', '1', '1']);
  assert.match(await p.$eval('#ramp-skip', e => e.innerText), /1 row\(s\) skip a stage[\s\S]*Kim/);
  assert.match(await p.$eval('#ramp .illus-tag', e => e.innerText), /YOUR UPLOADED DATA/);
  await p.close();
});
test('375px: no horizontal scroll', async () => {
  const { p } = await open(375);
  await p.click('#demo-btn'); await new Promise(r => setTimeout(r, 500));
  const [sw, cw] = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  assert.ok(sw <= cw, `scrollWidth ${sw} > ${cw}`); await p.close();
});
test('every visible link returns 200 and none are placeholders', async () => {
  const { p } = await open();
  const links = await p.$$eval('a[href]', as => as.filter(a => a.offsetParent !== null || a.getClientRects().length).map(a => a.href));
  assert.ok(links.length >= 5);
  for (const l of [...new Set(links)]) {
    assert.doesNotMatch(l, /example\.com|localhost:\d+\/?#$|todo|placeholder/i);
    if (new URL(l).hash && new URL(l).origin === new URL(URL_).origin) { assert.ok(await p.$(new URL(l).hash), 'anchor ' + l); continue; }
    const r = await fetch(l, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 link-check' } });
    assert.equal(r.status, 200, l);
  }
  await p.close();
});
test('rate chart has y-axis labels, gridlines and a legend', async () => {
  const { p } = await open();
  const ys = await p.$$eval('#rate-chart text.ax[text-anchor="end"]', es => es.map(e => e.textContent));
  assert.ok(ys.includes('0') && ys.length >= 4, ys.join('|'));
  assert.ok((await p.$$('#rate-chart line.grid-l')).length >= 3);
  assert.match(await p.$eval('#rate-legend', e => e.innerText), /Accepted \(cumulative\)/);
  await p.close();
});
test('matched columns listed in stage order; date format stated', async () => {
  const { p } = await open();
  const m = await p.$eval('#ramp-map', e => e.innerText);
  const idx = ['recruited', 'screened', 'trained', 'firstAccepted', 'productive'].map(k => m.indexOf(k + ' ←'));
  assert.ok(idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1])), m);
  assert.match(await p.$eval('#ramp-dates', e => e.innerText), /^Dates:/);
  await p.close();
});
test('XLSX upload imports, states date choice, flags out-of-order stages', async () => {
  const { p } = await open();
  await (await p.$('#ramp-file')).uploadFile(path.resolve('test/fixtures/ramp.xlsx'));
  await p.waitForFunction(() => /Ramped At/.test(document.querySelector('#ramp-map').innerText));
  assert.deepEqual(await p.$$eval('#funnel .bar .n', es => es.map(e => e.innerText.split(' ')[0])), ['4', '4', '3', '2', '2']);
  assert.match(await p.$eval('#ramp-order', e => e.innerText), /1 row\(s\) have stage dates out of order[\s\S]*W-4/);
  assert.match(await p.$eval('#ramp-dates', e => e.innerText), /MM\/DD\/YYYY/);
  assert.equal(await p.$eval('#ramp-sheet', e => e.parentElement.hidden), false);
  await p.select('#ramp-sheet', '1');
  await p.waitForFunction(() => document.querySelector('#funnel .bar .n').innerText.split(' ')[0] === '2');
  await (await p.$('#ramp-file')).uploadFile(path.resolve('test/fixtures/dmy-ramp.csv'));
  await p.waitForFunction(() => document.querySelector('#ramp-sheet').parentElement.hidden);
  await p.waitForFunction(() => /DD\/MM\/YYYY/.test(document.querySelector('#ramp-dates').innerText));
  await p.close();
});
// Layout assertions for the key panels at desktop and phone widths
for (const w of [1440, 375]) test(`layout @${w}: key panels fit their cards, tags on one line, style tokens`, async () => {
  const { p } = await open(w);
  await p.click('#demo-btn'); await new Promise(r => setTimeout(r, 600));
  const L = await p.evaluate(() => {
    const r = s => document.querySelector(s).getBoundingClientRect();
    const card = r('.chart-wrap'), svg = r('#rate-chart');
    const overflow = ['#rate', '#quality', '#reviewers', '#ramp', '#log'].flatMap(id => { const pr = r(id); return [...document.querySelectorAll(id + ' *')].filter(e => { const b = e.getBoundingClientRect(); return b.width && (b.left < pr.left - 1 || b.right > pr.right + 1) && !e.closest('svg'); }).map(e => id + ' ' + e.tagName + '.' + e.className); });
    const tags = [...document.querySelectorAll('.illus-tag')].map(t => { const lh = parseFloat(getComputedStyle(t).lineHeight) || 16; return t.getBoundingClientRect().height <= lh * 1.5; });
    const ax = [...document.querySelectorAll('#rate-chart text.ax')].map(t => t.getBoundingClientRect().height);
    const kpis = getComputedStyle(document.querySelector('#rate-kpis')).gridTemplateColumns.split(' ').length;
    const h2 = getComputedStyle(document.querySelector('#rate h2'));
    return { card: [card.left, card.right], svg: [svg.left, svg.right], overflow, tags, minAx: Math.min(...ax), kpis, h2w: h2.fontWeight, rad: getComputedStyle(document.querySelector('.kpi')).borderTopLeftRadius, bc: getComputedStyle(document.querySelector('.kpi')).borderTopColor, verdictIn: r('#verdict').right <= r('#ramp').right + 1 };
  });
  assert.ok(L.svg[0] >= L.card[0] && L.svg[1] <= L.card[1], `chart ${L.svg} wider than card ${L.card}`);
  assert.deepEqual(L.overflow, []); assert.ok(L.tags.every(Boolean), 'an ILLUSTRATIVE tag wraps');
  assert.ok(L.minAx >= 10, `axis text renders at ${L.minAx}px`);
  assert.equal(L.kpis, w > 860 ? 4 : 2); assert.equal(L.h2w, '300'); assert.equal(L.rad, '6px'); assert.equal(L.bc, 'rgb(229, 231, 235)'); assert.ok(L.verdictIn);
  await p.close();
});
test('as-of defaults to today and the stale data date is shown', async () => {
  const { p } = await open();
  const note = await p.$eval('#rate-asof-note', e => e.innerText); assert.match(note, /^Data through Oct 10 \(\d+ days? stale\)/);
  const kp = await p.$eval('#rate-kpis', e => e.innerText); const today = await p.evaluate(() => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  assert.ok(kp.includes(`Required / day from ${today}`), kp);
  assert.equal(await p.$eval('#deadline', e => e.value), await p.evaluate(() => { const n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) + 7 * 864e5).toISOString().slice(0, 10); }));
  await p.select('#asof', 'data'); assert.match(await p.$eval('#rate-kpis', e => e.innerText), /Required \/ day from Oct 10/);
  assert.match(await p.$eval('#fc-cap-note', e => e.innerText), /observed recruit intake .*\d+(\.\d)?\/day/);
  assert.match(await p.$eval('#funnel-note', e => e.innerText), /includes in-flight recruits/);
  await p.close();
});
test('bad inputs show a message, never a verdict', async () => {
  const { p } = await open();
  const set = async (sel, v) => { await p.$eval(sel, (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, v); };
  await set('#target', '-5'); assert.match(await p.$eval('#rate-kpis', e => e.innerText), /target of at least 1/); assert.doesNotMatch(await p.$eval('#rate-kpis', e => e.innerText), /on track/);
  await set('#target', '6000'); await set('#deadline', ''); assert.match(await p.$eval('#rate-kpis', e => e.innerText), /Enter a deadline/);
  await set('#fc-date', ''); assert.match(await p.$eval('#fc-out', e => e.innerText), /Enter date X/); assert.equal(await p.$('#verdict'), null);
  await set('#fc-start', '2026-12-01'); await set('#fc-date', '2026-11-01'); assert.match(await p.$eval('#fc-out', e => e.innerText), /after the start/);
  await set('#fc-date', '2026-12-20'); await set('#fc-n', '0'); assert.match(await p.$eval('#fc-out', e => e.innerText), /N of at least 1/);
  assert.doesNotMatch(await p.evaluate(() => document.body.innerText), /NaN|Infinity/);
  await p.close();
});
test('200k-row task CSV renders in under 5s', async () => {
  const f = path.join(os.tmpdir(), 'dc-200k.csv'), rows = ['worker,outcome,date,reviewer,vendor'];
  for (let i = 0; i < 200000; i++) rows.push(`w${i % 5000},${i % 5 ? 'accepted' : 'rejected'},2026-10-${String(1 + i % 10).padStart(2, '0')},r${i % 40},v${i % 7}`);
  fs.writeFileSync(f, rows.join('\n'));
  const { p } = await open(375);
  const t0 = Date.now(); await (await p.$('#task-file')).uploadFile(f);
  await p.waitForFunction(() => /Accepted so far\s*160,000/.test(document.querySelector('#rate-kpis').innerText), { timeout: 5000 });
  const ms = Date.now() - t0; assert.ok(ms < 5000, ms + ' ms'); console.log('# 200k render ms', ms);
  await p.close();
});
test('tabs: arrow keys move selection, aria-controls set', async () => {
  const { p } = await open();
  await p.focus('#tab-vendor'); await p.keyboard.press('ArrowRight');
  assert.equal(await p.$eval('#tab-pod', e => e.getAttribute('aria-selected')), 'true');
  assert.equal(await p.evaluate(() => document.activeElement.id), 'tab-pod');
  assert.equal(await p.$eval('#acc-bars', e => e.getAttribute('aria-labelledby')), 'tab-pod');
  assert.equal(await p.$eval('#tab-vendor', e => e.tabIndex), -1);
  await p.select('#fc-src', 'published'); assert.match(await p.$eval('#verdict', e => e.innerText), /Mixed sources/);
  await p.close();
});
