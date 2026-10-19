import { loadRamp, funnel, forecast, intakePerDay, loadTasks, acceptanceBy, reviewerLoad, dailyRate, median, STAGES, RAMP_FIELDS } from './lib.js';
const $ = s => document.querySelector(s);
const DAY = 864e5;
const pct = x => (x * 100).toFixed(x < 0.1 && x > 0 ? 1 : 0) + '%';
const fmt = x => isFinite(x) ? Math.round(x).toLocaleString('en-US') : '∞';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dateVal = id => Date.parse($(id).value + 'T00:00:00Z');
const state = { tasks: [], ramp: null, accKey: 'vendor', taskUser: false, rampUser: false };

function kpi(l, v, cls = '') { return `<div class="kpi ${cls}"><div class="l">${l}</div><div class="v">${v}</div></div>`; }
function tag(sec, user) { const t = document.querySelector(`#${sec} .illus-tag`); if (t) { t.textContent = user ? 'YOUR UPLOADED DATA' : 'ILLUSTRATIVE DATA'; t.classList.toggle('user', user); } }
function mapLine(map, el, need) {
  const parts = Object.entries(map).map(([k, h]) => `${k} ← <code>${esc(h)}</code>`);
  const miss = need.filter(k => !map[k]);
  el.innerHTML = 'Matched columns: ' + (parts.join(' · ') || 'none') + (miss.length ? ` · <b style="color:var(--bad)">not found: ${miss.join(', ')}</b>` : '');
}

// ---------- tasks ----------
function setTasks(text, user) {
  const r = loadTasks(text); state.tasks = r.tasks; state.taskUser = user;
  mapLine(r.map, $('#task-map'), ['contributor', 'status']);
  ['rate', 'quality', 'reviewers'].forEach(s => tag(s, user));
  renderTasks();
}
function renderTasks() {
  const t = state.tasks, dated = t.filter(x => x.date != null);
  // Daily rate
  if (dated.length) {
    const start = Math.min(...dated.map(x => x.date)), asOf = Math.max(...dated.map(x => x.date));
    const target = +$('#target').value || 0, deadline = dateVal('#deadline');
    const d = dailyRate(t, { target, start, deadline, asOf });
    $('#rate-kpis').innerHTML = kpi('Accepted so far', fmt(d.delivered)) + kpi('Actual / day', fmt(d.actualPerDay)) +
      kpi('Required / day from here', fmt(d.requiredPerDay), d.requiredPerDay > d.actualPerDay ? 'bad' : 'ok') +
      kpi('Projected at deadline', `${fmt(d.projected)} <span style="font-size:13px">${d.onTrack ? 'on track' : 'short ' + fmt(target - d.projected)}</span>`, d.onTrack ? 'ok' : 'bad');
    drawChart(d, start, deadline, target);
  } else { $('#rate-kpis').innerHTML = '<p class="note">No date column found, so daily rate can’t be computed.</p>'; $('#rate-chart').innerHTML = ''; }
  renderAcc();
  const rl = reviewerLoad(t), med = median(rl.map(r => r.perDay)) || 0, mx = Math.max(1, ...rl.map(r => r.perDay));
  $('#rev-bars').innerHTML = rl.length ? rl.map(r => bar(r.reviewer, r.perDay / mx, `${r.perDay.toFixed(0)}/day`, r.perDay > 1.5 * med)).join('') : '<p class="note">No reviewer column found.</p>';
}
function renderAcc() {
  const th = (+$('#thresh').value || 0) / 100;
  let rows = acceptanceBy(state.tasks, state.accKey);
  if (state.accKey === 'contributor') rows = rows.filter(r => r.n >= 10).slice(0, 12);
  $('#acc-bars').innerHTML = rows.length ? rows.map(r => bar(r.key, r.rate, `${pct(r.rate)} · ${r.n}`, r.rate < th)).join('') + (state.accKey === 'contributor' ? '<p class="note">Lowest 12 contributors with ≥10 reviewed tasks.</p>' : '') : '<p class="note">No rows with that column.</p>';
}
function bar(label, frac, n, flag, extra = '') {
  return `<div class="bar ${flag ? 'flag' : ''} ${extra}"><span title="${esc(label)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(label)}</span><div class="t"><div class="f" style="width:${Math.max(0, Math.min(1, frac)) * 100}%"></div></div><span class="n">${n}</span></div>`;
}
function drawChart(d, start, deadline, target) {
  const W = 800, H = 220, P = 36, end = Math.max(deadline, start + DAY);
  const x = t => P + (t - start) / (end - start) * (W - 2 * P), y = v => H - P + 10 - v / Math.max(target, d.projected, 1) * (H - 2 * P);
  let cum = 0; const pts = d.series.map(([t, n]) => (cum += n, `${x(t).toFixed(1)},${y(cum).toFixed(1)}`));
  const last = d.series.length ? d.series[d.series.length - 1][0] : start;
  $('#rate-chart').innerHTML = `<line x1="${P}" y1="${y(0)}" x2="${x(end)}" y2="${y(target)}" stroke="#9ca3af" stroke-dasharray="5 4"/>
  <line x1="${x(last)}" y1="${y(cum)}" x2="${x(end)}" y2="${y(d.projected)}" stroke="${d.onTrack ? '#047857' : '#b91c1c'}" stroke-dasharray="2 3"/>
  <polyline fill="none" stroke="#4f46e5" stroke-width="2.5" points="${pts.join(' ')}"/>
  <line x1="${x(end)}" y1="${P - 20}" x2="${x(end)}" y2="${H - P + 10}" stroke="#e5e7eb"/>
  <text x="${x(end) - 4}" y="${P - 8}" text-anchor="end" font-size="12" fill="#6b7280">deadline · target ${fmt(target)}</text>
  <text x="${P}" y="${P - 8}" font-size="12" fill="#4f46e5">accepted (cumulative)</text><text x="${P + 160}" y="${P - 8}" font-size="12" fill="#9ca3af">straight-line pace to target</text>`;
}

// ---------- ramp ----------
function setRamp(text, user) {
  const r = loadRamp(text); state.ramp = r; state.rampUser = user; tag('ramp', user);
  mapLine(r.map, $('#ramp-map'), STAGES);
  if (r.skipped) $('#ramp-map').innerHTML += ` · ${r.skipped} row(s) skipped (no recruit date)`;
  if (r.people.length) $('#fc-cap').value = Math.max(1, Math.round(intakePerDay(r.people) * 2.5));
  renderRamp();
}
function renderRamp() {
  const r = state.ramp; if (!r || !r.people.length) { $('#funnel').innerHTML = '<p class="note">No rows with a recruit date. Check the matched columns above.</p>'; $('#ramp-kpis').innerHTML = ''; $('#fc-out').innerHTML = ''; return; }
  const f = funnel(r.people); state.funnel = f;
  $('#ramp-kpis').innerHTML = kpi('Recruited', fmt(f.stages[0].count)) + kpi('Recruit → productive', pct(f.overall)) +
    kpi('Median time to productive', f.ttpMedian == null ? '—' : f.ttpMedian.toFixed(1) + ' d') + kpi('P80 time to productive', f.ttpP80 == null ? '—' : f.ttpP80.toFixed(1) + ' d');
  const top = f.stages[0].count || 1;
  $('#funnel').innerHTML = f.stages.map((s, i) => bar(s.label, s.count / top,
    i ? `${fmt(s.count)} · ${pct(s.convFromPrev)} · −${fmt(s.dropOff)}${s.medianDaysFromPrev != null ? ` · ${s.medianDaysFromPrev.toFixed(1)}d` : ''}` : fmt(s.count), false, f.bottleneck && s.key === f.bottleneck.key ? 'worst' : '')).join('') +
    `<p class="note">Each row: count · conversion from previous stage · people lost · median days from previous stage. Red = biggest proportional drop-off (${f.bottleneck ? esc(f.bottleneck.label) : '—'}).</p>`;
  runForecast();
}
function stageRates() {
  const f = state.funnel; const rates = f.stages.slice(1).map(s => s.convFromPrev);
  if ($('#fc-src').value === 'published') { rates[0] = 0.13; rates[1] = 0.20; }
  return rates;
}
function runForecast() {
  const f = state.funnel; if (!f) return;
  const start = dateVal('#fc-start'), deadline = dateVal('#fc-date');
  const res = forecast({ n: +$('#fc-n').value || 0, start, deadline, rates: stageRates(), ttpDays: f.ttpP80 ?? 0, capacity: +$('#fc-cap').value || 0 });
  const earliest = isFinite(res.earliestDays) ? new Date(start + Math.ceil(res.earliestDays) * DAY).toISOString().slice(0, 10) : 'never at these rates';
  $('#fc-out').innerHTML = `<div class="verdict ${res.feasible ? 'yes' : 'no'}" id="verdict"><strong>${res.feasible ? 'Yes' : 'No'}: ${fmt(+$('#fc-n').value)} productive by ${$('#fc-date').value}</strong>
  ${esc(res.reason)}<br>Recruits needed at ${pct(res.overall)} end-to-end conversion: <b>${fmt(res.needRecruits)}</b>. Earliest date at this capacity: <b>${earliest}</b>.</div>`;
  $('#fc-src-note').textContent = $('#fc-src').value === 'published'
    ? 'Screen 13% (Zhang et al. 2023) and train 20% (Nangia et al. 2021) replace the data’s rates; later stages still come from the loaded data. See sources below.'
    : `Stage rates from the loaded ${state.rampUser ? 'upload' : 'ILLUSTRATIVE data'}.`;
  return res;
}

// ---------- decision log ----------
const LOG = 'dc-log-v1';
const getLog = () => { try { return JSON.parse(localStorage.getItem(LOG)) || []; } catch { return []; } };
function addLog(text, why) { const l = getLog(); l.unshift({ at: new Date().toISOString(), text, why }); localStorage.setItem(LOG, JSON.stringify(l.slice(0, 200))); renderLog(); }
function renderLog() { const l = getLog(); $('#log-body').innerHTML = l.length ? l.map(e => `<tr><td style="white-space:nowrap">${esc(new Date(e.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</td><td>${esc(e.text)}</td><td>${esc(e.why || '')}</td></tr>`).join('') : '<tr><td colspan="3" class="note">Nothing logged yet.</td></tr>'; }

// ---------- demo ----------
function demo() {
  const start = $('#fc-start').value; const s = Date.parse(start + 'T00:00:00Z');
  $('#fc-n').value = 1000; $('#fc-date').value = new Date(s + 3 * DAY).toISOString().slice(0, 10);
  const res = runForecast();
  const f = state.funnel;
  addLog(`1,000-in-3-days check: ${res.feasible ? 'feasible' : 'NOT feasible'} at current funnel`,
    `${res.reason} Biggest drop-off: ${f.bottleneck ? f.bottleneck.label + ' (' + pct(f.bottleneck.convFromPrev) + ')' : '—'}. Earliest at capacity: ${Math.ceil(res.earliestDays)} days.`);
  const v = $('#verdict'); document.querySelector('#funnel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => { v.classList.add('hl'); document.querySelector('.funnel .worst')?.classList.add('hl'); }, 400);
}

// ---------- wiring ----------
const readFile = (inp, cb) => inp.addEventListener('change', () => { const f = inp.files[0]; if (f) f.text().then(t => cb(t, true)); });
readFile($('#task-file'), setTasks); readFile($('#ramp-file'), setRamp);
['#target', '#deadline'].forEach(s => $(s).addEventListener('input', renderTasks));
$('#thresh').addEventListener('input', renderAcc);
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', x === b)); state.accKey = b.dataset.k; renderAcc(); }));
['#fc-n', '#fc-start', '#fc-date', '#fc-cap', '#fc-src'].forEach(s => $(s).addEventListener('input', runForecast));
$('#log-form').addEventListener('submit', e => { e.preventDefault(); addLog($('#log-text').value.trim(), $('#log-why').value.trim()); e.target.reset(); });
$('#demo-btn').addEventListener('click', demo);
const loadIllusRamp = () => fetch('/data/illustrative-ramp.csv').then(r => r.text()).then(t => setRamp(t, false));
$('#ramp-reset').addEventListener('click', () => { $('#ramp-file').value = ''; loadIllusRamp(); });
renderLog();
Promise.all([fetch('/data/illustrative-tasks.csv').then(r => r.text()).then(t => setTasks(t, false)), loadIllusRamp()]).then(() => document.body.dataset.ready = '1');
