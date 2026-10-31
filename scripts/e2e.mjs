// End-to-end check in headless Chromium: upload test MP3s, wait for analysis + beatmatching, export WAV.
// Usage: npm run build && npx vite preview --port 4173 & node scripts/e2e.mjs [outDir]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'); // pre-installed globally, not a dependency
import { readdirSync, mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'test-audio/out';
mkdirSync(out, { recursive: true });
const files = readdirSync('test-audio').filter((f) => f.endsWith('.mp3')).map((f) => `test-audio/${f}`);
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
page.on('console', (m) => m.type() === 'error' && console.log('console:', m.text()));
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto('http://localhost:4173');
await page.setInputFiles('input[type=file]', files);
const t0 = Date.now();
await page.waitForSelector('.list li', { timeout: 120000 });
await page.waitForFunction(() => !document.querySelector('.pending'), null, { timeout: 120000 });
console.log('analysed in', Date.now() - t0, 'ms');
await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 120000 });
console.log('beatmatched in', Date.now() - t0, 'ms');
console.log((await page.$$eval('.list li', (ls) => ls.map((l) => l.innerText.replace(/\s+/g, ' ')))).join('\n'));
await page.screenshot({ path: `${out}/ui.png`, fullPage: true });
await page.click('.play');
await page.waitForTimeout(1500);
console.log('time after play:', await page.$eval('.time', (e) => e.textContent));
await page.click('.play');
// transition editor: click the first zone label, switch to echo out, then back to auto
const zone = await page.$eval('.timeline', (c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; });
await page.mouse.click(zone.x + zone.w * 0.215, zone.y + 8);
await page.waitForSelector('.editor');
console.log('editor:', (await page.$eval('.editor', (e) => e.innerText)).replace(/\s+/g, ' ').slice(0, 160));
await page.selectOption('.editor select', 'echo');
await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 });
console.log('after edit:', (await page.$eval('.editor', (e) => e.innerText)).replace(/\s+/g, ' ').slice(0, 160));
await page.click('.editor >> text=Auto');
// lock track 5, move track 1 down, auto-order: track at position 5 must stay
const fifth = await page.$eval('.list li:nth-child(5) .name', (e) => e.textContent);
await page.click('.list li:nth-child(5) button[title="Lock position"]');
await page.click('.list li:nth-child(1) button[title="Move down"]');
await page.click('text=Auto-order');
const fifthAfter = await page.$eval('.list li:nth-child(5) .name', (e) => e.textContent);
console.log('locked track stays:', fifth === fifthAfter, fifthAfter);
await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 });
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 300000 }), page.click('text=Export WAV')]);
await dl.saveAs(`${out}/mix.wav`);
const [tl] = await Promise.all([page.waitForEvent('download'), page.click('text=Tracklist')]);
await tl.saveAs(`${out}/tracklist.txt`);
const [mp3] = await Promise.all([page.waitForEvent('download', { timeout: 300000 }), page.click('text=Export MP3')]);
await mp3.saveAs(`${out}/mix.mp3`);
console.log('exported in', Date.now() - t0, 'ms');
// mashup mode: best ~50 s of each song
await page.click('text=Highlights');
await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 120000 });
console.log('mashup length:', await page.$eval('.time', (e) => e.textContent));
await page.screenshot({ path: `${out}/mashup.png` });
const [mw] = await Promise.all([page.waitForEvent('download', { timeout: 300000 }), page.click('text=Export WAV')]);
await mw.saveAs(`${out}/mashup.wav`);
const [mt] = await Promise.all([page.waitForEvent('download'), page.click('text=Tracklist')]);
await mt.saveAs(`${out}/mashup-tracklist.txt`);
// A × B: song 3's top over song 1's beat
await page.click('text=A × B');
await page.selectOption('section.row select >> nth=0', { index: 3 });
await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 120000 });
console.log('A×B:', await page.$eval('section.row span', (e) => e.textContent), '|', await page.$eval('.time', (e) => e.textContent));
await page.screenshot({ path: `${out}/axb.png` });
const [xw] = await Promise.all([page.waitForEvent('download', { timeout: 300000 }), page.click('text=Export WAV')]);
await xw.saveAs(`${out}/axb.wav`);
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: `${out}/mobile.png`, fullPage: true });
await browser.close();
