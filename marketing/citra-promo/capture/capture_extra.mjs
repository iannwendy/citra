// Extra captures: interactive states + tall viewports for vertical pans.
import { chromium } from 'playwright';
import path from 'node:path';

const BASE = process.env.CITRA_URL || 'http://localhost:5173';
const OUT = path.resolve('public/shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ONLY = process.argv.slice(2);
const want = (n) => ONLY.length === 0 || ONLY.some((o) => n.startsWith(o));

const browser = await chromium.launch();

async function newPage(h = 900) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: h },
    deviceScaleFactor: 3,
    colorScheme: 'light',
    locale: 'en-US',
  });
  await ctx.addInitScript(() => {
    localStorage.setItem('theme', 'light');
    localStorage.setItem('language', 'en');
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('#username', 'admin@example.com');
  await page.fill('#password', 'admin123');
  await page.click('button[type=submit]');
  await page.waitForURL(/dashboard/, { timeout: 15000 }).catch(() => {});
  await sleep(1500);
  return page;
}
async function go(page, url, wait = 3500) {
  await page.goto(BASE + url, { waitUntil: 'networkidle' }).catch(() => {});
  await sleep(wait);
}
async function snap(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('✓', name);
}

const page = await newPage(900);

if (want('sandbox-loaded')) {
  await go(page, '/sandbox');
  await page.getByText(/Sample 12 Random ACL Papers/).first().click().catch((e) => console.warn(e.message));
  await sleep(5000);
  await snap(page, 'sandbox-loaded');
}

if (want('report-thesis')) {
  await go(page, '/verification/report/14', 4000);
  await snap(page, 'report-thesis');
}

const tall = await newPage(1800);
if (want('tall-trace')) {
  await go(tall, '/verification/report/33/trace', 4000);
  await snap(tall, 'tall-trace');
}
if (want('tall-teacher')) {
  await go(tall, '/teacher/classes/1', 4000);
  await snap(tall, 'tall-teacher');
}
if (want('tall-landing-pipeline')) {
  await go(tall, '/', 3000);
}
if (want('tall-rules')) {
  await go(tall, '/verification/report/33', 4000);
  await tall.getByText(/Hallucination \(\d+\)/).first().click().catch(() => {});
  await sleep(1500);
  await tall.getByText(/Symbolic Rules/).first().click().catch(() => {});
  await sleep(1500);
  await snap(tall, 'tall-rules');
  await tall.getByText(/Evidence Graph/).first().click().catch(() => {});
  await sleep(2500);
  await snap(tall, 'tall-evgraph');
}
if (want('tall-graph')) {
  await go(tall, '/verification/report/33', 4000);
  await tall.getByText('Citation Graph', { exact: true }).first().click().catch(() => {});
  await sleep(3500);
  await snap(tall, 'tall-graph');
}
if (want('tall-autofix')) {
  await go(tall, '/verification/report/33', 4000);
  await tall.getByText(/1-Click Auto-Fix/).first().click().catch(() => {});
  await sleep(3000);
  await snap(tall, 'tall-autofix');
}
if (want('tall-meta')) {
  await go(tall, '/verification/report/33', 4000);
  await tall.getByText(/Metadata \(\d+\)/).first().click().catch(() => {});
  await sleep(2000);
  await snap(tall, 'tall-meta');
}
await browser.close();
