import { describe, it, expect } from 'vitest';
import * as essayBarrel from '@/pages/essay';
import * as graphBarrel from '@/components/CitationGraph';
import { api } from '@/api/client';

/** Guards against re-introducing removed dead code (task 4.9). */
describe('dead code removal', () => {
  const sources = Object.keys(import.meta.glob('/src/**/*.{ts,tsx}'));

  it.each([
    '/src/App.tsx',
    '/src/pages/essay/EssayTabNav.tsx',
    '/src/pages/essay/EssayStatsGrid.tsx',
    '/src/components/CitationGraphView.tsx',
  ])('%s no longer exists', (path) => {
    expect(sources).not.toContain(path);
  });

  it('pages/essay barrel only exposes live components', () => {
    expect(Object.keys(essayBarrel).sort()).toEqual(['EssayActionBar', 'EssayHeader']);
  });

  it('CitationGraph barrel still exports the graph used by EssayPage', () => {
    expect(typeof graphBarrel.CitationGraphView).toBe('function');
    expect(typeof graphBarrel.EvidenceGraph).toBe('function');
  });

  it.each(['downloadReport', 'getVerdicts', 'listAllEssays', 'getCacheStats', 'getMe', 'health'])(
    'api.%s was removed (unused)',
    (method) => {
      expect(method in api).toBe(false);
    },
  );

  it('api methods used by the app remain', () => {
    for (const method of ['downloadReportFile', 'downloadAutoHealedDocx', 'clearCache', 'getEssayStats']) {
      expect(typeof (api as Record<string, unknown>)[method]).toBe('function');
    }
  });
});
