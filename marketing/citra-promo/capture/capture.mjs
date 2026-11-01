// CITRA promo — UI capture script (Playwright, 1440x900 @3x = 4320x2700)
// Usage: node capture/capture.mjs [onlyShotName ...]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.CITRA_URL || 'http://localhost:5173';
const OUT = path.resolve('public/shots');
const ONLY = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });

const REPORT = process.env.REPORT_ID || '33';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const want = (n) => ONLY.length === 0 || ONLY.some((o) => n.startsWith(o));

async function snap(page, name, { fullPage = false, clip } = {}) {
  if (!want(name)) return;
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage, clip, animations: 'allow' });
  console.log('✓', name);
}

async function go(page, url, wait = 2500) {
  await page.goto(BASE + url, { waitUntil: 'networkidle' }).catch(() => {});
  await sleep(wait);
}

async function clickText(page, text, { exact = false, timeout = 4000 } = {}) {
  try {
    const loc = page.getByText(text, { exact }).first();
    await loc.click({ timeout });
    await sleep(1200);
    return true;
  } catch (e) {
    console.warn('  ! could not click', text);
    return false;
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 3,
  colorScheme: 'light',
  locale: 'en-US',
});
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('theme', 'light');
    localStorage.setItem('language', 'en');
    localStorage.setItem('i18nextLng', 'en');
  } catch {}
});
const page = await ctx.newPage();

// ---------- Public pages ----------
if (want('landing') || want('pricing')) {
  await go(page, '/', 4000);
  await snap(page, 'landing-hero');
  // scroll stops on landing
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  console.log('  landing height', h);
  let i = 0;
  for (let y = 900; y < h - 400 && i < 14; y += 900, i++) {
    await page.evaluate((yy) => window.scrollTo({ top: yy, behavior: 'instant' }), y);
    await sleep(1800);
    await snap(page, `landing-s${String(i + 1).padStart(2, '0')}`);
  }
  await go(page, '/pricing', 3500);
  await snap(page, 'pricing');
}

// ---------- Login as admin ----------
await go(page, '/login', 1500);
await page.fill('#username', 'admin@example.com');
await page.fill('#password', 'admin123');
await page.click('button[type=submit]');
await page.waitForURL(/dashboard|home|verification|history/, { timeout: 15000 }).catch(() => {});
await sleep(2500);

await go(page, '/dashboard', 3500);
await snap(page, 'dashboard');

await go(page, '/upload', 2500);
await snap(page, 'upload');

await go(page, '/batch-upload', 2500);
await snap(page, 'batch');

await go(page, '/sandbox', 3000);
await snap(page, 'sandbox');

await go(page, `/verification/processing/${REPORT}`, 3500);
await snap(page, 'processing');

// ---------- Report IDE ----------
await go(page, `/verification/report/${REPORT}`, 4000);
await snap(page, 'report-ide');
if (want('report-halluc')) {
  if (await clickText(page, /^.?\s*Hallucination \(\d+\)/)) {
    await page.locator('[class*=cursor-pointer]').filter({ hasText: /HALLUCINATION/ }).first().click().catch(() => {});
    await sleep(1500);
    await snap(page, 'report-halluc');
    await clickText(page, /Symbolic Rules/);
    await snap(page, 'report-halluc-rules');
    await clickText(page, /Source Retrieval/);
    await snap(page, 'report-halluc-retrieval');
    await clickText(page, /Evidence Graph/);
    await snap(page, 'report-halluc-evgraph');
  }
}
if (want('report-meta')) {
  await go(page, `/verification/report/${REPORT}`, 3500);
  if (await clickText(page, /Metadata \(\d+\)/)) {
    await sleep(1200);
    await snap(page, 'report-meta');
  }
}
if (want('report-graph')) {
  await go(page, `/verification/report/${REPORT}`, 3500);
  if (await clickText(page, 'Citation Graph', { exact: true })) {
    await sleep(3500);
    await snap(page, 'report-graph');
  }
}
if (want('report-autofix')) {
  await go(page, `/verification/report/${REPORT}`, 3500);
  if (await clickText(page, /1-Click Auto-Fix/)) {
    await sleep(2500);
    await snap(page, 'report-autofix');
  }
}

for (const tab of ['issues', 'document', 'consistency', 'trace']) {
  if (!want(`report-${tab}`)) continue;
  await go(page, `/verification/report/${REPORT}/${tab}`, 4000);
  await snap(page, `report-${tab}`);
}

// ---------- Teacher & Admin ----------
await go(page, '/teacher/classes', 3000);
await snap(page, 'teacher-classes');
await go(page, '/teacher/classes/1', 4000);
await snap(page, 'teacher-class');
await go(page, '/teacher/reviews', 3000);
await snap(page, 'teacher-reviews');
await go(page, '/admin/system', 4000);
await snap(page, 'admin-system');
await go(page, '/admin/users', 3000);
await snap(page, 'admin-users');
await go(page, '/history', 3000);
await snap(page, 'history');

await browser.close();
