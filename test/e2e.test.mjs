// Run: E2E_URL=https://... node --test test/e2e.test.mjs
import test from 'node:test'; import assert from 'node:assert/strict'; import puppeteer from 'puppeteer-core'; import path from 'path';
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
  const v = await p.$eval('#verdict', e => e.innerText); assert.match(v, /^No: 1,000 productive by 2026-10-25/);
  assert.equal(await p.$eval('#fc-n', e => e.value), '1000');
  assert.ok(await p.$('.funnel .bar.worst.hl'));
  assert.match(await p.$eval('#log-body', e => e.innerText), /1,000-in-3-days check: NOT feasible/);
  await p.close();
});
test('uploading a messy CSV maps headers and recomputes the funnel', async () => {
  const { p } = await open();
  const inp = await p.$('#ramp-file'); await inp.uploadFile(path.resolve('test/fixtures/messy-ramp.csv'));
  await p.waitForFunction(() => /Fully Ramped/.test(document.querySelector('#ramp-map').innerText));
  const map = await p.$eval('#ramp-map', e => e.innerText); assert.doesNotMatch(map, /not found/); assert.match(map, /1 row\(s\) skipped/);
  const counts = await p.$$eval('#funnel .bar .n', es => es.map(e => e.innerText.split(' ')[0]));
  assert.deepEqual(counts, ['5', '4', '3', '2', '2']);
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
  await (await p.$('#ramp-file')).uploadFile(path.resolve('test/fixtures/dmy-ramp.csv'));
  await p.waitForFunction(() => /DD\/MM\/YYYY/.test(document.querySelector('#ramp-dates').innerText));
  await p.close();
});
