// Render preview stills for QA: node scripts-stills.mjs <outDir> <scale> frame1 frame2 ...
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const [outDir, scale, ...frames] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });

const pwShell = path.join(
  os.homedir(),
  'Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell',
);
const browserExecutable = fs.existsSync(pwShell) ? pwShell : null;

const serveUrl = await bundle({ entryPoint: path.resolve('src/index.ts') });
const composition = await selectComposition({ serveUrl, id: 'CitraPromo', browserExecutable });

for (const f of frames) {
  const frameNum = Number(f);
  const outFile = path.join(outDir, `f${String(frameNum).padStart(5, '0')}.jpg`);
  await renderStill({
    serveUrl,
    composition,
    frame: frameNum,
    output: outFile,
    imageFormat: 'jpeg',
    jpegQuality: 90,
    scale: Number(scale),
    browserExecutable,
  });
  console.log('still', frameNum, outFile);
}
