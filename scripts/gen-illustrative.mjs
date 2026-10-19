// Generates ILLUSTRATIVE (synthetic) data. Seeded, deterministic. Not real contributor data.
import fs from 'fs';
let s = 20261021; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const iso = t => new Date(t).toISOString().slice(0, 10);
const DAY = 864e5, base = Date.UTC(2026, 8, 28);
const pods = ['Pod A', 'Pod B', 'Pod C', 'Pod D'], vendors = ['Direct', 'Vendor North', 'Vendor South'];
let ramp = ['# ILLUSTRATIVE DATA - synthetic, seeded generator, not real contributors'];
ramp.push('Contributor ID,Applied On,Screen Passed (date),Training Completed,1st Accepted Task,Hit Productivity,Pod,Source');
for (let i = 1; i <= 600; i++) {
  const r = base + Math.floor(rnd() * 14) * DAY; const pod = pods[i % 4]; const v = vendors[Math.floor(rnd() * 3)];
  let t = r, row = [`EX-${String(i).padStart(4, '0')}`, iso(r)];
  const p = [0.45, v === 'Vendor South' ? 0.55 : 0.72, 0.8, 0.75], lag = [1.5, 1.2, 0.8, 2.5];
  let alive = true;
  for (let k = 0; k < 4; k++) { if (alive && rnd() < p[k]) { t += Math.round((0.3 + rnd() * 1.4) * lag[k]) * DAY; row.push(iso(t)); } else { alive = false; row.push(''); } }
  row.push(pod, v); ramp.push(row.join(','));
}
fs.writeFileSync('public/data/illustrative-ramp.csv', ramp.join('\n') + '\n');
let tasks = ['# ILLUSTRATIVE DATA - synthetic, seeded generator, not real tasks', 'Task ID,Submitted At,Worker,Team,Vendor,QA Reviewer,Review Outcome'];
const tb = Date.UTC(2026, 9, 1); let id = 0;
for (let d = 0; d < 10; d++) { const n = 280 + Math.floor(rnd() * 80) + d * 6;
  for (let j = 0; j < n; j++) { const c = 1 + Math.floor(rnd() * 80); const v = vendors[c % 3]; const pod = pods[c % 4];
    const rv = rnd() < 0.3 ? 'R3' : 'R' + (1 + Math.floor(rnd() * 6));
    let pa = 0.86; if (v === 'Vendor South') pa = 0.71; if (c === 17 || c === 42) pa = 0.45;
    tasks.push([`T${++id}`, iso(tb + d * DAY), `EX-${String(c).padStart(4, '0')}`, pod, v, rv, rnd() < pa ? 'Accepted' : 'Rejected'].join(',')); } }
fs.writeFileSync('public/data/illustrative-tasks.csv', tasks.join('\n') + '\n');
console.log(ramp.length, tasks.length);
