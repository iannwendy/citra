import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isSentientSafe } from '../components/motion.ts';
import {
  ACT1_SCENES,
  ACT2_SCENES,
  ACT3_SCENES,
  ACT4_SCENES,
  ACT5_SCENES,
  ACT3_LOUPES,
  PIPELINE_STAGES,
  SCHOLARLY_APIS,
  BENTO_TILES,
  ABLATION_BENCHMARK,
  ENGINEERING_SCALE,
} from '../scenes/sceneData.ts';

const timeline = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, '..', 'timeline.json'), 'utf8'),
);

test('Act I & Act II English display headlines pass Sentient font safety and Vietnamese captions are non-empty', () => {
  for (const scene of [...Object.values(ACT1_SCENES), ...Object.values(ACT2_SCENES)]) {
    for (const headline of scene.headlinesEn) {
      assert.equal(
        isSentientSafe(headline),
        true,
        `Headline "${headline}" in scene ${scene.id} violates Sentient Latin-only glyph safety`,
      );
    }
    assert.ok(scene.captionVi.length > 16, `Scene ${scene.id} must have a descriptive Vietnamese HUD caption`);
  }
});

test('Act II defines all 8 real-time SSE pipeline stages and 16 federated scholarly/local index nodes (15+ external + 128K+ local FTS5)', () => {
  assert.equal(PIPELINE_STAGES.length, 8);
  assert.ok(PIPELINE_STAGES.some((s) => s.code.includes('R01–R30')));
  assert.ok(PIPELINE_STAGES.some((s) => s.code.includes('16D HybridML')));
  assert.equal(SCHOLARLY_APIS.length, 16);
  assert.ok(SCHOLARLY_APIS.some((a) => a.name.includes('128K+')));
  assert.ok(SCHOLARLY_APIS.some((a) => a.name.includes('Crossref')));
  assert.ok(SCHOLARLY_APIS.some((a) => a.name.includes('Retraction Watch')));
});

test('Act III scenes pass Sentient headline safety and every GlassLoupe crop rectangle stays strictly inside [0..1]', () => {
  const act3List = Object.values(ACT3_SCENES);
  assert.equal(act3List.length, 4);
  for (const scene of act3List) {
    for (const h of scene.headlinesEn) {
      assert.equal(isSentientSafe(h), true, `Act III headline "${h}" failed Sentient safety`);
    }
    assert.ok(scene.captionVi.length > 16);
  }

  assert.ok(ACT3_LOUPES.length >= 3);
  for (const loupe of ACT3_LOUPES) {
    const [rx, ry, rw, rh] = loupe.rect;
    assert.ok(rx >= 0 && ry >= 0 && rw > 0.04 && rh > 0.02, `Invalid loupe rect: ${loupe.badge}`);
    assert.ok(rx + rw <= 1.001 && ry + rh <= 1.001, `Loupe rect overflows image: ${loupe.badge}`);
  }
});

test('All 13 timeline scenes have Sentient-safe English headlines and canonical v3.75.2 benchmark + scale figures', () => {
  const allCopy: Record<string, { id: string; headlinesEn: readonly string[]; captionVi: string }> = {
    ...ACT1_SCENES,
    ...ACT2_SCENES,
    ...ACT3_SCENES,
    ...ACT4_SCENES,
    ...ACT5_SCENES,
  };

  for (const s of timeline.scenes) {
    const def = allCopy[s.id];
    assert.ok(def, `Missing scene copy definition for timeline scene "${s.id}"`);
    for (const h of def.headlinesEn) {
      assert.equal(isSentientSafe(h), true, `Headline "${h}" in ${s.id} is not Sentient-safe`);
    }
    assert.ok(def.captionVi.length > 12, `Scene ${s.id} missing Vietnamese caption`);
  }

  assert.equal(BENTO_TILES.length, 8);
  assert.equal(ABLATION_BENCHMARK.totalPapers, 120000);
  assert.equal(ABLATION_BENCHMARK.heldOutTest, 18000);
  assert.equal(ABLATION_BENCHMARK.neuroSymbolicAcc, 98.58);
  assert.equal(ABLATION_BENCHMARK.hybridMlAcc, 99.86);
  assert.equal(ABLATION_BENCHMARK.pureSbertAcc, 64.85);
  assert.equal(ABLATION_BENCHMARK.hallucinationF1, 100.0);
  assert.equal(ABLATION_BENCHMARK.falseAccusations, 0);
  assert.equal(ABLATION_BENCHMARK.plattEce, 0.0433);

  assert.equal(ENGINEERING_SCALE.auditedPdfs, 1064);
  assert.equal(ENGINEERING_SCALE.locThousands, 228);
  assert.equal(ENGINEERING_SCALE.automatedTests, 2205);
  assert.equal(ENGINEERING_SCALE.ruleRange, 'R01–R30');
  assert.equal(ENGINEERING_SCALE.citationStyles, 12);
});
