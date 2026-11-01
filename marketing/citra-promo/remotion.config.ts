import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Config } from '@remotion/cli/config';

Config.setEntryPoint('src/index.ts');
Config.setVideoImageFormat('png');
Config.setPixelFormat('yuv420p');
Config.setCodec('h264');

// On some macOS setups Remotion's downloaded headless shell stalls on "Waiting for root component".
// If Playwright's Chromium headless shell is installed, use it instead.
const playwrightShell = path.join(
  os.homedir(),
  'Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell',
);
if (fs.existsSync(playwrightShell)) Config.setBrowserExecutable(playwrightShell);
