import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  sec,
  monotoneHermite,
  camSplineAt,
  isSentientSafe,
  assertSentientSafe,
  type CamKey,
} from '../components/motion.ts';

const timelinePath = path.resolve(import.meta.dirname, '..', 'timeline.json');
const timeline = JSON.parse(fs.readFileSync(timelinePath, 'utf8'));

test('timeline.json enforces 90s at 120fps and 13 bar-locked scenes', () => {
  assert.equal(timeline.fps, 120);
  assert.equal(timeline.bpm, 120);
  assert.equal(timeline.durationSec, 90);
  assert.equal(timeline.scenes.length, 13);

  const expectedIds = [
    'hook',
    'reveal',
    'ingest',
    'architecture',
    'hallucination',
    'retraction',
    'trace',
    'autofix',
    'educator',
    'ecosystem',
    'ablation',
    'scale',
    'endcard',
  ];
  assert.deepEqual(
    timeline.scenes.map((s: { id: string }) => s.id),
    expectedIds,
  );

  let cursor = 0;
  for (const scene of timeline.scenes) {
    assert.equal(scene.start, cursor, `scene ${scene.id} must start at ${cursor}`);
    assert.ok(scene.end > scene.start, `scene ${scene.id} must have positive duration`);
    assert.equal(scene.start % 2, 0, `scene ${scene.id} start must land on 2s bar downbeat`);
    assert.equal(scene.end % 2, 0, `scene ${scene.id} end must land on 2s bar downbeat`);
    cursor = scene.end;
  }
  assert.equal(cursor, 90);
});

test('sec() converts seconds to 120fps frame counts accurately', () => {
  assert.equal(sec(0), 0);
  assert.equal(sec(1), 120);
  assert.equal(sec(0.45), 54);
  assert.equal(sec(90), 10800);
});

test('monotoneHermite preserves exact waypoints, zero overshoot, and non-zero C1 velocity at interior monotonic knots', () => {
  const xs = [0, 2, 5];
  const ys = [0.2, 0.5, 0.9];

  assert.ok(Math.abs(monotoneHermite(xs, ys, 0) - 0.2) < 1e-9);
  assert.ok(Math.abs(monotoneHermite(xs, ys, 2) - 0.5) < 1e-9);
  assert.ok(Math.abs(monotoneHermite(xs, ys, 5) - 0.9) < 1e-9);

  // Clamping outside domain
  assert.equal(monotoneHermite(xs, ys, -3), 0.2);
  assert.equal(monotoneHermite(xs, ys, 9), 0.9);

  // Non-zero velocity right through interior waypoint x=2 (no stop-and-go hitch!)
  const dt = 1 / 120;
  const vAtMid = (monotoneHermite(xs, ys, 2 + dt) - monotoneHermite(xs, ys, 2 - dt)) / (2 * dt);
  assert.ok(vAtMid > 0.05, `expected smooth positive velocity at interior knot, got ${vAtMid}`);

  // Monotonicity & no overshoot across dense samples
  let prev = ys[0];
  for (let i = 1; i <= 600; i++) {
    const v = monotoneHermite(xs, ys, (i / 600) * 5);
    assert.ok(v >= prev - 1e-9 && v <= 0.9 + 1e-9, `overshoot or reversal at step ${i}: ${v}`);
    prev = v;
  }
});

test('camSplineAt interpolates log-zoom strictly positive and 3D gimbal angles smoothly', () => {
  const keys: CamKey[] = [
    { t: 0, cx: 0.5, cy: 0.5, w: 1.0, rotX: 6, rotY: -10, rotZ: -1 },
    { t: 3, cx: 0.72, cy: 0.58, w: 0.52, rotX: 2, rotY: -4, rotZ: 0 },
    { t: 7, cx: 0.75, cy: 0.78, w: 0.44, rotX: 0, rotY: 0, rotZ: 0 },
  ];

  const start = camSplineAt(0, keys);
  assert.ok(Math.abs(start.w - 1.0) < 1e-9);
  assert.equal(start.rotY, -10);

  const mid = camSplineAt(3, keys);
  assert.ok(Math.abs(mid.w - 0.52) < 1e-9);

  for (let step = 0; step <= 840; step++) {
    const pose = camSplineAt(step / 120, keys);
    assert.ok(pose.w >= 0.439 && pose.w <= 1.001, `invalid zoom width ${pose.w}`);
    assert.ok(Number.isFinite(pose.cx) && Number.isFinite(pose.cy));
  }
});

test('Sentient font safety rejects unsupported Vietnamese diacritics while allowing English & punctuation', () => {
  assert.equal(isSentientSafe('Verify every citation. *Trace *every *source.'), true);
  assert.equal(isSentientSafe('Proven on 120,000 papers — R01–R30 · 98.58%'), true);
  assert.equal(isSentientSafe('Kiểm chứng mọi trích dẫn'), false);
  assert.equal(isSentientSafe('Hệ thống Neuro-Symbolic'), false);
  assert.equal(isSentientSafe('Tư duy & Phương pháp'), false);
  assert.throws(() => assertSentientSafe('Đồ án tốt nghiệp hệ thống'));
});

import {
  computeViewportLayout,
  computeLoupeCrop,
  computeConnectorEndpoints,
  computePortalTransform,
} from '../components/motion.ts';

test('computeViewportLayout and computeLoupeCrop produce exact bounded crops and connector endpoints', () => {
  const L = computeViewportLayout({ cx: 0.75, cy: 0.5, w: 0.5 }, 0.625, 1200, 750);
  assert.equal(L.DW, 2400);
  assert.equal(L.DH, 1500);
  assert.ok(L.left <= 0 && L.left >= -1200);

  const crop = computeLoupeCrop([0.55, 0.44, 0.4, 0.1], 0.625, 480);
  assert.ok(crop.cardHeight >= 76 && crop.cardHeight <= 360);
  assert.equal(crop.imgWidth, 1200);

  const pts = computeConnectorEndpoints(
    { x: 200, y: 180, w: 160, h: 60 },
    { x: 520, y: 120, w: 420, h: 180 },
  );
  assert.equal(pts.x1, 360);
  assert.equal(pts.x2, 520);
});

test('computePortalTransform returns identity in steady-state middle of scene and smooth fades on enter/exit', () => {
  const mid = computePortalTransform(3.0, 6.0, 0.45, 'bloom', false);
  assert.equal(mid.opacity, 1);
  assert.equal(mid.scale, 1);
  assert.equal(mid.bloomOpacity, 0);

  const entering = computePortalTransform(0.0, 6.0, 0.45, 'bloom', false);
  assert.ok(entering.opacity < 0.05);
  assert.ok(entering.bloomOpacity > 0);
});
