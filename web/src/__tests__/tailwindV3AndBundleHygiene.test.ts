import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

function collectProductionSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      results.push(...collectProductionSourceFiles(fullPath));
      continue;
    }
    if (!/\.(ts|tsx|css)$/.test(entry.name)) continue;
    if (/\.test\.(ts|tsx)$/.test(entry.name)) continue;
    results.push(fullPath);
  }
  return results.sort();
}

describe('Tailwind CSS v3.4 Token Hygiene & Bundle Split Architecture', () => {
  const srcRoot = path.resolve(__dirname, '..');
  const webRoot = path.resolve(srcRoot, '..');
  const prodFiles = collectProductionSourceFiles(srcRoot);

  it('1. scans all production files in web/src/**/*.{ts,tsx,css} and enforces zero Tailwind v4-only or invalid v3.4 scale utilities', () => {
    expect(prodFiles.length).toBeGreaterThan(80);

    const forbiddenRules: Array<{ name: string; regex: RegExp }> = [
      {
        name: 'Tailwind v4 shadow-xs / shadow-2xs / inset-shadow-*',
        regex: /\b(?:inset-)?shadow-2?xs\b/g,
      },
      {
        name: 'Tailwind v4 drop-shadow-xs / drop-shadow-2xs',
        regex: /\bdrop-shadow-2?xs\b/g,
      },
      {
        name: 'Tailwind v4 backdrop-blur-xs / blur-xs',
        regex: /\b(?:backdrop-)?blur-2?xs\b/g,
      },
      {
        name: 'Tailwind v4 rounded-xs / rounded-2xs',
        regex: /\brounded(?:-[trblse]{1,2})?-2?xs\b/g,
      },
      {
        name: 'Tailwind v4 outline-hidden',
        regex: /\boutline-hidden\b/g,
      },
      {
        name: 'Tailwind v4 bg-linear-to-*',
        regex: /\bbg-linear-to-[a-z]+\b/g,
      },
      {
        name: 'Invalid unbracketed underline-offset-* (v3.4 supports 0,1,2,4,8,auto)',
        regex: /\bunderline-offset-(?!(?:0|1|2|4|8|auto)\b)\d+\b/g,
      },
      {
        name: 'Invalid unbracketed duration-* (e.g. duration-250 / duration-350 without brackets)',
        regex: /\bduration-(?!(?:0|75|100|150|200|300|500|700|1000)\b)\d+\b/g,
      },
      {
        name: 'Invalid unbracketed color opacity modifier (v3.4 supports 0..100 in steps of 5)',
        regex:
          /\b(?:bg|text|border|ring|from|via|to|fill|stroke|divide|placeholder|decoration|shadow|outline)-(?:\[[^\]]+\]|[a-zA-Z0-9_-]+)\/(?!(?:0|5|[1-9]0|[1-9]5|100)\b)\d+\b/g,
      },
      {
        name: 'Invalid unbracketed fractional spacing (v3.4 supports only .5 half-steps: 0.5, 1.5, 2.5, 3.5)',
        regex:
          /\b(?:-?(?:p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y|inset|inset-x|inset-y|top|right|bottom|left|w|h|size))-\d+\.(?!5\b)\d+\b/g,
      },
    ];

    const violations: string[] = [];

    for (const filePath of prodFiles) {
      const relPath = path.relative(webRoot, filePath);
      const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
      lines.forEach((line, idx) => {
        for (const rule of forbiddenRules) {
          rule.regex.lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = rule.regex.exec(line)) !== null) {
            violations.push(`${relPath}:${idx + 1} -> "${match[0]}" (${rule.name})`);
          }
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it('2. keeps LandingPage, LoginPage, and RegisterPage eager for zero-flash first paint while lazy-loading AppLayout with shell-matched skeletons and splitting chunks cleanly', () => {
    const routerSource = fs.readFileSync(path.join(srcRoot, 'router.tsx'), 'utf-8');
    const skeletonSource = fs.readFileSync(
      path.join(srcRoot, 'components', 'PageSkeleton.tsx'),
      'utf-8',
    );
    const viteConfigSource = fs.readFileSync(path.join(webRoot, 'vite.config.ts'), 'utf-8');

    // Public entry routes ("/", "/login", "/register") must render synchronously on frame 0 without Suspense flash
    expect(routerSource).toMatch(
      /import\s*\{\s*LandingPage\s*\}\s*from\s*['"]\.\/pages\/LandingPage['"]/,
    );
    expect(routerSource).toMatch(
      /import\s*\{\s*LoginPage\s*\}\s*from\s*['"]\.\/pages\/LoginPage['"]/,
    );
    expect(routerSource).toMatch(
      /import\s*\{\s*RegisterPage\s*\}\s*from\s*['"]\.\/pages\/RegisterPage['"]/,
    );

    // Authenticated AppLayout shell must be code-split via lazyWithRetry with WorkspaceShellSkeleton
    expect(routerSource).toMatch(/const\s+AppLayout\s*=\s*lazyWithRetry\(/);
    expect(routerSource).toContain('WorkspaceShellSkeleton');
    expect(routerSource).toContain('AuthPageSkeleton');
    expect(routerSource).toContain('EditorialPageSkeleton');
    expect(skeletonSource).toContain('export function WorkspaceShellSkeleton');
    expect(skeletonSource).toContain('export function AuthPageSkeleton');
    expect(skeletonSource).toContain('export function EditorialPageSkeleton');

    // vite.config.ts must not cheat by inflating chunkSizeWarningLimit above Vite's strict 500 kB default
    expect(viteConfigSource).not.toContain('chunkSizeWarningLimit');
    expect(viteConfigSource).toContain('motion');
    expect(viteConfigSource).toContain("return 'auth'");
  });

  it('3. verifies every compiled JS chunk in dist/assets (when built) stays strictly under 500 kB', () => {
    const distAssetsDir = path.join(webRoot, 'dist', 'assets');
    if (!fs.existsSync(distAssetsDir)) {
      return;
    }

    const jsChunks = fs
      .readdirSync(distAssetsDir)
      .filter((name) => name.endsWith('.js'))
      .map((name) => ({
        name,
        bytes: fs.statSync(path.join(distAssetsDir, name)).size,
      }));

    expect(jsChunks.length).toBeGreaterThan(10);

    const oversized = jsChunks.filter((chunk) => chunk.bytes >= 500 * 1000);
    expect(oversized).toEqual([]);
  });
});
