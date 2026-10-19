// Screenshots at 1440 and 375. Run: node test/shots.mjs <url> [prefix]   -> shots/<prefix>-*.png
import p from 'puppeteer-core'; import fs from 'fs';
const U = process.argv[2] || 'http://localhost:47311/', pre = process.argv[3] || 'local';
fs.mkdirSync('shots', { recursive: true });
const b = await p.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ready = async g => { await g.goto(U, { waitUntil: 'networkidle0' }); await g.evaluate(() => localStorage.clear()); await g.reload({ waitUntil: 'networkidle0' }); await g.waitForSelector('body[data-ready="1"]'); await g.evaluate(() => document.fonts.ready); };
const g = await b.newPage(); await g.setViewport({ width: 1440, height: 900 }); await ready(g);
await g.screenshot({ path: `shots/${pre}-1440-1-hero.png` });
await (await g.$('#rate')).screenshot({ path: `shots/${pre}-1440-2-rate-chart.png` });
await g.click('#demo-btn'); await new Promise(r => setTimeout(r, 1200)); await g.screenshot({ path: `shots/${pre}-1440-3-demo-verdict.png` });
await g.screenshot({ path: `shots/${pre}-1440-4-full.png`, fullPage: true });
const m = await b.newPage(); await m.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }); await ready(m);
await m.screenshot({ path: `shots/${pre}-375-1-hero.png` });
await m.click('#demo-btn'); await new Promise(r => setTimeout(r, 1200)); await m.screenshot({ path: `shots/${pre}-375-2-demo-verdict.png` });
await m.screenshot({ path: `shots/${pre}-375-3-full.png`, fullPage: true });
console.log(JSON.stringify(await m.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]))); await b.close();
