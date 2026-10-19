import { loadRamp, funnel, forecast, intakePerDay, loadTasks, acceptanceBy, reviewerLoad, dailyRate, median, maxOf, minOf, checkRateInputs, checkForecastInputs, isoDate, checkThreshold, STAGES, STAGE_LABEL, describeDateOrder, xlsxToCSV, xlsxSheets } from './lib.js';
const $ = s => document.querySelector(s);
const DAY = 864e5;
const pct = x => (x * 100).toFixed(x < 0.1 && x > 0 ? 1 : 0) + '%';
const fmt = x => isFinite(x) ? Math.round(x).toLocaleString('en-US') : '∞';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dateVal = id => Date.parse($(id).value + 'T00:00:00Z');
const iso = isoDate; // returns '' instead of throwing on out-of-range dates
// "today" as a UTC-midnight date in the viewer's own calendar (so it matches <input type=date>)
const TODAY = (() => { const n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()); })();
const state = { tasks: [], ramp: null, accKey: 'vendor', taskUser: false, rampUser: false };

function kpi(l, v, cls = '') { return `<div class="kpi ${cls}"><div class="l">${l}</div><div class="v">${v}</div></div>`; }
function tag(sec, user) { const t = document.querySelector(`#${sec} .illus-tag`); if (t) { t.textContent = user ? 'YOUR UPLOADED DATA' : 'ILLUSTRATIVE DATA'; t.classList.toggle('user', user); } }
function mapLine(map, el, need, order) {
  const keys = [...order.filter(k => k in map), ...Object.keys(map).filter(k => !order.includes(k))];
  const parts = keys.map(k => `${k} ← <code>${esc(map[k])}</code>`);
  const miss = need.filter(k => !map[k]);
  el.innerHTML = 'Matched columns: ' + (parts.join(' · ') || 'none') + (miss.length ? ` · <b class="bad-t">not found: ${miss.join(', ')}</b>` : '');
}
const dateNote = (el, d) => { el.textContent = describeDateOrder(d); el.classList.toggle('warn-t', d.basis === 'conflict'); };

// ---------- tasks ----------
function setTasks(text, user) {
  const r = loadTasks(text); state.tasks = r.tasks; state.taskUser = user;
  mapLine(r.map, $('#task-map'), ['contributor', 'status'], ['contributor', 'status', 'date', 'pod', 'vendor', 'reviewer']); dateNote($('#task-dates'), r.dateOrder);
  ['rate', 'quality', 'reviewers'].forEach(s => tag(s, user));
  // open on a tab that has data (e.g. an export with no vendor column)
  const has = k => r.tasks.some(t => t[k] && t.accepted != null);
  document.querySelectorAll('.tabs [role=tab]').forEach(b => { b.disabled = !has(b.dataset.k); b.title = b.disabled ? 'No such column in this file' : ''; });
  if (!has(state.accKey)) { const b = [...document.querySelectorAll('.tabs [role=tab]')].find(b => has(b.dataset.k)); if (b) state.pick?.(b); }
  renderTasks();
}
function renderTasks() {
  const t = state.tasks, dates = []; for (const x of t) if (x.date != null) dates.push(x.date);
  const target = $('#target').value === '' ? NaN : +$('#target').value, deadline = dateVal('#deadline');
  const bad = checkRateInputs({ target, deadline });
  if (!dates.length) { $('#rate-kpis').innerHTML = '<p class="note">No date column found, so daily rate can’t be computed.</p>'; $('#rate-chart').innerHTML = ''; $('#rate-legend').innerHTML = ''; $('#rate-asof-note').textContent = ''; }
  else if (bad) { $('#rate-kpis').innerHTML = `<p class="warnbox" id="rate-invalid">${esc(bad)}</p>`; $('#rate-chart').innerHTML = ''; $('#rate-legend').innerHTML = ''; }
  else {
    const start = minOf(dates), dataEnd = maxOf(dates), asOf = $('#asof').value === 'data' ? dataEnd : Math.max(TODAY, dataEnd);
    const d = dailyRate(t, { target, start, deadline, asOf, dataEnd });
    $('#asof').options[0].text = `Today (${short(TODAY)})`; $('#asof').options[1].text = `Last data date (${short(dataEnd)})`;
    const gapTxt = d.gapDays ? `${short(dataEnd + DAY)}${d.gapDays > 1 ? '–' + short(dataEnd + d.gapDays * DAY) : ''}` : '';
    $('#rate-asof-note').innerHTML = `<b>Data through ${short(dataEnd)}</b>${d.staleDays ? ` (${d.staleDays} day${d.staleDays > 1 ? 's' : ''} stale)` : ''}. ` +
      `Pace is measured over ${short(start)}–${short(dataEnd)}. “From here” counts ${d.remainingDays} day(s), ${short(Math.max(asOf, dataEnd + DAY))} through the deadline inclusive.` +
      (d.gapDays ? ` ${gapTxt} has no data, so the projection is a range: <b>low</b> = those ${d.gapDays} day(s) produced nothing, <b>high</b> = they ran at pace.` : '') +
      (isFinite(d.etaHigh) ? ` ETA to target at this pace: <b>${short(d.etaHigh)}</b>${d.gapDays ? ` (gap at pace) to <b>${short(d.etaLow)}</b> (gap at zero)` : ''}.` : '');
    const cls = d.onTrack ? 'ok' : d.maybe ? 'warn' : 'bad';
    const proj = d.gapDays ? `${fmt(d.projectedLow)}–${fmt(d.projectedHigh)}` : fmt(d.projectedLow);
    const projSub = d.onTrack ? 'on track' : d.maybe ? `on track only if ${gapTxt} ran at pace` : 'short ' + fmt(target - (d.gapDays ? d.projectedHigh : d.projectedLow)) + (d.gapDays ? ' even at pace' : '');
    $('#rate-kpis').innerHTML = kpi(`Accepted in data (to ${short(dataEnd)})`, fmt(d.delivered)) + kpi('Actual / day', fmt(d.actualPerDay)) +
      kpi(`Required / day from ${short(Math.max(asOf, dataEnd + DAY))}`, d.remainingDays ? fmt(d.requiredPerDay) + (d.dueToday ? ' <span class="kpi-s">due today</span>' : '') + (d.gapDays ? `<span class="kpi-s">assumes ${gapTxt} = 0 (no data)</span>` : '') : 'deadline passed', d.requiredPerDay > d.actualPerDay ? 'bad' : 'ok') +
      kpi(d.gapDays ? 'Projected at deadline (low–high)' : 'Projected at deadline', `${proj}<span class="kpi-s">${projSub}</span>`, cls + (d.gapDays ? ' wide' : ''));
    drawChart(d, start, deadline, target, asOf);
  }
  renderAcc();
  const rl = reviewerLoad(t), med = median(rl.map(r => r.perDay)) || 0, mx = Math.max(1, maxOf(rl.map(r => r.perDay)));
  $('#rev-bars').innerHTML = rl.length ? rl.slice(0, 30).map(r => bar(r.reviewer, r.perDay / mx, `${r.perDay.toFixed(0)}/day`, r.perDay > 1.5 * med)).join('') + (rl.length > 30 ? `<p class="note">Top 30 of ${fmt(rl.length)} reviewers by volume.</p>` : '') : '<p class="note">No reviewer column found.</p>';
}
function renderAcc() {
  const tbad = checkThreshold($('#thresh').value); $('#thresh-err').textContent = tbad || ''; $('#thresh').setAttribute('aria-invalid', !!tbad);
  const th = tbad ? 0.8 : +$('#thresh').value / 100;
  let rows = acceptanceBy(state.tasks, state.accKey); const total = rows.length, contrib = state.accKey === 'contributor';
  if (tbad) $('#thresh-err').textContent += ' Using 80% until fixed.';
  rows = contrib ? rows.filter(r => r.n >= 10).slice(0, 12) : rows.slice(0, 30);
  $('#acc-bars').innerHTML = rows.length ? rows.map(r => bar(r.key, r.rate, `${pct(r.rate)} · ${r.n}`, r.rate < th)).join('') +
    (contrib ? '<p class="note">Lowest 12 contributors with ≥10 reviewed tasks.</p>' : total > 30 ? `<p class="note">Lowest 30 of ${fmt(total)}.</p>` : '') : '<p class="note">No rows with that column.</p>';
}
function bar(label, frac, n, flag, extra = '') {
  return `<div class="bar ${flag ? 'flag' : ''} ${extra}"><span title="${esc(label)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(label)}</span><div class="t"><div class="f" style="width:${Math.max(0, Math.min(1, frac)) * 100}%"></div></div><span class="n">${n}</span></div>`;
}
function niceStep(max, n = 4) { const raw = max / n, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
const short = t => iso(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—';
function drawChart(d, start, deadline, target, asOf) {
  const W = Math.round($('#rate-chart').getBoundingClientRect().width || 800), H = W < 500 ? 220 : 260, L = W < 500 ? 44 : 56, R = W < 500 ? 12 : 24, T = 30, B = 34, end = Math.max(deadline, start + DAY);
  const ymax = Math.max(target, d.projectedHigh, 1), step = niceStep(ymax), top = Math.ceil(ymax / step) * step;
  const x = t => L + (t - start) / (end - start) * (W - L - R), y = v => H - B - v / top * (H - T - B);
  let cum = 0; const pts = d.series.map(([t, n]) => (cum += n, `${x(t).toFixed(1)},${y(cum).toFixed(1)}`));
  const last = d.series.length ? d.series[d.series.length - 1][0] : start;
  let g = '';
  for (let v = 0; v <= top + 1e-9; v += step) g += `<line class="grid-l" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
  const days = Math.round((end - start) / DAY), xs = Math.max(1, Math.ceil(days / Math.max(2, Math.floor((W - L - R) / 90))));
  $('#rate-chart').setAttribute('viewBox', `0 0 ${W} ${H}`);
  for (let k = 0; k <= days; k += xs) if (x(start + k * DAY) <= W - R - 22) g += `<text class="ax" x="${x(start + k * DAY)}" y="${H - B + 18}" text-anchor="middle">${short(start + k * DAY)}</text>`;
  $('#rate-chart').innerHTML = `${g}<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="#d1d5db"/>
  <line x1="${x(start)}" y1="${y(0)}" x2="${x(end)}" y2="${y(target)}" stroke="#9ca3af" stroke-width="1.5" stroke-dasharray="5 4"/>
  ${d.gapDays ? `<polygon points="${x(last)},${y(cum)} ${x(end)},${y(d.projectedHigh)} ${x(end)},${y(d.projectedLow)} ${x(asOf)},${y(cum)}" fill="#eef2ff" opacity=".8"/>
  <line x1="${x(last)}" y1="${y(cum)}" x2="${x(end)}" y2="${y(d.projectedHigh)}" stroke="#6366f1" stroke-width="1.5" stroke-dasharray="2 3"/>` : ''}
  <line x1="${x(Math.max(last, asOf))}" y1="${y(cum)}" x2="${x(end)}" y2="${y(d.projectedLow)}" stroke="${d.onTrack ? '#047857' : '#b91c1c'}" stroke-width="1.5" stroke-dasharray="2 3"/>
  <polyline fill="none" stroke="#4f46e5" stroke-width="2.5" stroke-linejoin="round" points="${pts.join(' ')}"/>
  <line x1="${x(end)}" y1="${T}" x2="${x(end)}" y2="${H - B}" stroke="#9ca3af"/>
  ${asOf > last && asOf < end ? `<line x1="${x(asOf)}" y1="${T}" x2="${x(asOf)}" y2="${H - B}" stroke="#c7d2fe" stroke-dasharray="3 3"/><text class="ax" x="${x(asOf) - 4}" y="${H - B - 6}" text-anchor="end">as of ${short(asOf)}</text>` : ''}
  <text class="ax" x="${x(end)}" y="${T - 12}" text-anchor="end">deadline ${short(end)} · target ${fmt(target)}</text>`;
  let c2 = 0; $('#rate-table').innerHTML = '<tr><th>Day</th><th>Accepted</th><th>Cumulative</th></tr>' + d.series.map(([t, n]) => `<tr><td>${short(t)}</td><td>${fmt(n)}</td><td>${fmt(c2 += n)}</td></tr>`).join('');
  $('#rate-legend').innerHTML = `<span><i style="background:#4f46e5"></i>Accepted (cumulative)</span><span><i class="dash" style="border-color:#9ca3af"></i>Straight-line pace to target</span>${d.gapDays ? '<span><i class="dot" style="border-color:#6366f1"></i>High: no-data days at pace</span>' : ''}<span><i class="dot" style="border-color:${d.onTrack ? '#047857' : '#b91c1c'}"></i>${d.gapDays ? 'Low: no-data days at zero' : 'Projection at current pace'}</span>`;
}

// ---------- ramp ----------
function setRamp(text, user) {
  const r = loadRamp(text); state.ramp = r; state.rampUser = user; tag('ramp', user);
  mapLine(r.map, $('#ramp-map'), STAGES, ['id', ...STAGES, 'pod', 'vendor']); dateNote($('#ramp-dates'), r.dateOrder);
  if (r.skipped) $('#ramp-map').innerHTML += ` · ${r.skipped} row(s) skipped (no recruit date)`;
  const v = r.violations, vEl = $('#ramp-order');
  vEl.hidden = !v.length;
  vEl.innerHTML = v.length ? `<b>${v.length} row(s) have stage dates out of order</b> (a later stage dated before an earlier one). They are still counted; check them in the export: ` +
    v.slice(0, 5).map(x => `${esc(x.id)} (row ${x.row}: ${STAGE_LABEL[x.later]} before ${STAGE_LABEL[x.earlier]})`).join(' · ') + (v.length > 5 ? ` · +${v.length - 5} more` : '') : '';
  const sk = r.skippedStage, sEl = $('#ramp-skip'); sEl.hidden = !sk.length;
  sEl.innerHTML = sk.length ? `<b>${sk.length} row(s) skip a stage</b> (a later stage has a date but an earlier one is blank). They are counted only up to the gap so later stages aren’t inflated: ` +
    sk.slice(0, 5).map(x => `${esc(x.id)} (row ${x.row}: no ${STAGE_LABEL[x.missing]} date)`).join(' · ') + (sk.length > 5 ? ` · +${sk.length - 5} more` : '') : '';
  state.intake = r.people.length ? intakePerDay(r.people) : 0;
  if (r.people.length) $('#fc-cap').value = Math.max(1, Math.round(state.intake));
  renderRamp();
}
function renderRamp() {
  const r = state.ramp; if (!r || !r.people.length) { $('#funnel').innerHTML = '<p class="note">No rows with a recruit date. Check the matched columns above.</p>'; $('#ramp-kpis').innerHTML = ''; $('#fc-out').innerHTML = ''; return; }
  const f = funnel(r.people); state.funnel = f;
  $('#ramp-kpis').innerHTML = kpi('Recruited', fmt(f.stages[0].count)) + kpi('Recruit → productive (cohort-adjusted)', pct(f.overall)) +
    kpi('Median time to productive', f.ttpMedian == null ? '—' : f.ttpMedian.toFixed(1) + ' d') + kpi('P80 time to productive', f.ttpP80 == null ? '—' : f.ttpP80.toFixed(1) + ' d');
  const top = f.stages[0].count || 1;
  $('#funnel').innerHTML = f.stages.map((s, i) => bar(s.label, s.count / top,
    i ? `${fmt(s.count)} · ${pct(s.convFromPrev)}${s.mature ? '' : '*'} · ${s.medianDaysFromPrev != null ? `${s.medianDaysFromPrev.toFixed(1)}d` : '—'}` : fmt(s.count), false, f.bottleneck && s.key === f.bottleneck.key ? 'worst' : '')).join('') +
    `<p class="note" id="funnel-note">Each row: people who reached the stage (includes in-flight recruits) · cohort-adjusted conversion · median days from the previous stage. ` +
    `Conversion counts only people who reached the previous stage at least its P80 lag before the last data date (${short(f.asOf)}), so recent recruits aren’t treated as drop-offs` +
    ` (raw, unadjusted end-to-end: ${pct(f.rawOverall)}). ${f.stages.some(s => !s.mature) ? '* no cohort old enough yet, raw rate shown. ' : ''}Red = lowest conversion (${f.bottleneck ? esc(f.bottleneck.label) : '—'}).</p>`;
  runForecast();
}
function stageRates() {
  const f = state.funnel; const rates = f.stages.slice(1).map(s => s.convFromPrev);
  if ($('#fc-src').value === 'published') { rates[0] = 0.13; rates[1] = 0.20; }
  return rates;
}
function runForecast() {
  try { return runForecast_(); } catch (e) { $('#fc-out').innerHTML = `<p class="warnbox" id="fc-invalid">Couldn’t compute: ${esc(e.message)}</p>`; return null; }
}
function runForecast_() {
  const f = state.funnel; if (!f) return;
  const start = dateVal('#fc-start'), deadline = dateVal('#fc-date'), n = $('#fc-n').value === '' ? NaN : +$('#fc-n').value, capacity = $('#fc-cap').value === '' ? NaN : +$('#fc-cap').value;
  $('#fc-cap-note').textContent = `Default = observed recruit intake in the loaded ${state.rampUser ? 'upload' : 'ILLUSTRATIVE data'}: ${state.intake.toFixed(1)}/day. Set your own sourcing capacity.`;
  const pub = $('#fc-src').value === 'published';
  $('#fc-src-note').textContent = pub
    ? `MIXED SOURCES: screen 13% (Zhang et al. 2023: qualification task) and 20% for the trained stage (Nangia et al. 2021: share of tutorial completers who qualified for the final round after several writing rounds) are from academic MTurk studies; first-accepted and productive rates still come from the loaded ${state.rampUser ? 'upload' : 'ILLUSTRATIVE data'}. Not a forecast for any real program.`
    : `Stage rates from the loaded ${state.rampUser ? 'upload' : 'ILLUSTRATIVE data'}, cohort-adjusted.`;
  const bad = checkForecastInputs({ n, start, deadline, capacity });
  if (bad) { $('#fc-out').innerHTML = `<p class="warnbox" id="fc-invalid">${esc(bad)}</p>`; return null; }
  const res = forecast({ n, start, deadline, rates: stageRates(), ttpDays: f.ttpP80 ?? 0, capacity });
  const earliest = isFinite(res.earliestDays) && res.earliestDays <= 3650 ? iso(start + Math.ceil(res.earliestDays) * DAY) : 'more than 10 years out at these rates';
  $('#fc-out').innerHTML = `<div class="verdict ${res.feasible ? 'yes' : 'no'}" id="verdict"><strong>${res.feasible ? 'Yes' : 'No'}: ${fmt(n)} productive by ${$('#fc-date').value}</strong>
  ${esc(res.reason)}<br>Recruits needed at ${pct(res.overall)} end-to-end conversion: <b>${fmt(res.needRecruits)}</b>. Earliest date at this capacity: <b>${earliest}</b>.${pub ? '<br><span class="warn-t">Mixed sources: two stages from published MTurk studies, the rest from the loaded data.</span>' : ''}</div>`;
  return res;
}

// ---------- decision log ----------
const LOG = 'dc-log-v1';
const getLog = () => { try { return JSON.parse(localStorage.getItem(LOG)) || []; } catch { return []; } };
// demo entries replace the previous demo entry instead of piling up
function addLog(text, why, demo = false) { const l = getLog().filter(e => !(demo && e.demo)); l.unshift({ at: new Date().toISOString(), text, why, demo }); localStorage.setItem(LOG, JSON.stringify(l.slice(0, 200))); renderLog(); }
function renderLog() { const l = getLog(); $('#log-body').innerHTML = l.length ? l.map(e => `<tr${e.demo ? ' class="demo-row"' : ''}><td style="white-space:nowrap">${esc(new Date(e.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</td><td>${e.demo ? '<span class="pill">demo</span> ' : ''}${esc(e.text)}</td><td>${esc(e.why || '')}</td></tr>`).join('') : '<tr><td colspan="3" class="note">Nothing logged yet.</td></tr>'; }

// ---------- demo ----------
function demo() {
  if (!Number.isFinite(dateVal('#fc-start'))) $('#fc-start').value = iso(TODAY);
  const s = dateVal('#fc-start');
  $('#fc-n').value = 1000; $('#fc-date').value = iso(s + 3 * DAY);
  if (!(+$('#fc-cap').value > 0)) $('#fc-cap').value = Math.max(1, Math.round(state.intake));
  const res = runForecast(); if (!res) return;
  const f = state.funnel;
  addLog(`1,000-in-3-days check on ${state.rampUser ? 'uploaded' : 'ILLUSTRATIVE'} data: ${res.feasible ? 'feasible' : 'NOT feasible'}`,
    `${res.reason} Lowest conversion: ${f.bottleneck ? f.bottleneck.label + ' (' + pct(f.bottleneck.convFromPrev) + ')' : '—'}. Earliest at capacity: ${res.earliestDays <= 3650 ? Math.ceil(res.earliestDays) + ' days' : 'over 10 years'}.`, true);
  const v = $('#verdict'); document.querySelector('#funnel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => { v.classList.add('hl'); document.querySelector('.funnel .worst')?.classList.add('hl'); }, 400);
}

// ---------- wiring ----------
// XLSX: list every sheet; the user picks one (default: first). CSV/TSV: read as text.
const readFile = (inp, cb, errEl, sel) => {
  let buf = null, name = '';
  const load = async () => { try { cb(await xlsxToCSV(buf, +sel.value || 0), true); } catch (e) { errEl.textContent = `Couldn’t read ${name}: ${e.message}`; } };
  sel.addEventListener('change', load);
  inp.addEventListener('change', async () => {
    const f = inp.files[0]; if (!f) return; errEl.textContent = ''; name = f.name; sel.parentElement.hidden = true;
    try {
      if (!/\.xlsx$/i.test(f.name)) return cb(await f.text(), true);
      buf = await f.arrayBuffer(); const names = await xlsxSheets(buf);
      sel.innerHTML = names.map((n, i) => `<option value="${i}">${esc(n)}</option>`).join(''); sel.parentElement.hidden = names.length < 2;
      await load();
    } catch (e) { errEl.textContent = `Couldn’t read ${f.name}: ${e.message}`; }
  });
};
readFile($('#task-file'), setTasks, $('#task-err'), $('#task-sheet')); readFile($('#ramp-file'), setRamp, $('#ramp-err'), $('#ramp-sheet'));
let rw = 0; addEventListener('resize', () => { const w = $('#rate-chart').getBoundingClientRect().width; if (Math.abs(w - rw) > 40) { rw = w; renderTasks(); } });
['#target', '#deadline', '#asof'].forEach(s => $(s).addEventListener('input', renderTasks));
$('#thresh').addEventListener('input', renderAcc);
const tabs = [...document.querySelectorAll('.tabs [role=tab]')];
const pick = b => { tabs.forEach(x => { x.setAttribute('aria-selected', x === b); x.tabIndex = x === b ? 0 : -1; }); state.accKey = b.dataset.k; $('#acc-bars').setAttribute('aria-labelledby', b.id); renderAcc(); };
state.pick = pick;
tabs.forEach((b, i) => { b.addEventListener('click', () => pick(b)); b.addEventListener('keydown', e => {
  const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key]; if (j == null) return;
  e.preventDefault(); let k = j, t; for (let n = 0; n < tabs.length; n++, k += (e.key === 'ArrowLeft' || e.key === 'End' ? -1 : 1)) { t = tabs[(k + tabs.length * 4) % tabs.length]; if (!t.disabled) break; } t.focus(); pick(t); }); });
['#fc-n', '#fc-start', '#fc-date', '#fc-cap', '#fc-src'].forEach(s => $(s).addEventListener('input', runForecast));
$('#log-form').addEventListener('submit', e => { e.preventDefault(); addLog($('#log-text').value.trim(), $('#log-why').value.trim()); e.target.reset(); });
$('#demo-btn').addEventListener('click', demo);
const loadIllusRamp = () => fetch('/data/illustrative-ramp.csv').then(r => r.text()).then(t => setRamp(t, false));
$('#ramp-reset').addEventListener('click', () => { $('#ramp-file').value = ''; loadIllusRamp(); });
// relative defaults: deadline a week out, forecast window starts today
$('#deadline').value = iso(TODAY + 7 * DAY); $('#fc-start').value = iso(TODAY); $('#fc-date').value = iso(TODAY + 14 * DAY);
renderLog();
Promise.all([fetch('/data/illustrative-tasks.csv').then(r => r.text()).then(t => setTasks(t, false)), loadIllusRamp()]).then(() => document.body.dataset.ready = '1');
