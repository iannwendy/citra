import React from 'react';
import { useCurrentFrame } from 'remotion';
import { C, F } from '../theme';
import { FeatureScene } from '../components/FeatureScene';
import { Pill, clamp01, easeOut, useSpring } from '../components/primitives';

const N = 0.625; // 1440x900
const T = 1.25; // 1440x1800

/* ---------------------------------------------------------------- 01 upload */
const STAGES = ['GROBID TEI-XML', '15+ Scholarly APIs', 'Sentence-BERT', '28 Symbolic Rules', 'Calibrated Verdict'];

const PipelineStrip: React.FC<{ start: number }> = ({ start }) => {
  const frame = useCurrentFrame();
  const appear = useSpring(start - 10);
  const step = 20;
  const prog = clamp01((frame - start) / (step * (STAGES.length - 1)));
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 54,
        display: 'flex',
        justifyContent: 'center',
        opacity: appear,
        transform: `translateY(${(1 - appear) * 40}px)`,
      }}
    >
      <div style={{ position: 'relative', display: 'flex', gap: 46, alignItems: 'center' }}>
        <div style={{ position: 'absolute', left: 40, right: 40, top: '50%', height: 3, background: C.line }} />
        <div
          style={{
            position: 'absolute',
            left: 40,
            top: '50%',
            height: 3,
            width: `calc((100% - 80px) * ${easeOut(prog)})`,
            background: C.forest,
          }}
        />
        {STAGES.map((s, i) => {
          const on = frame >= start + i * step;
          const p = clamp01((frame - (start + i * step)) / 10);
          return (
            <Pill
              key={s}
              bg={on ? C.forest : C.paper}
              color={on ? '#fff' : C.muted}
              border={on ? C.forest : C.line}
              style={{ position: 'relative', transform: `scale(${1 + 0.08 * Math.sin(p * Math.PI)})`, fontSize: 21 }}
            >
              <span style={{ opacity: 0.7 }}>{`0${i + 1}`}</span>
              {s}
            </Pill>
          );
        })}
      </div>
    </div>
  );
};

const FileDrag: React.FC<{ map: (ix: number, iy: number) => [number, number] }> = ({ map }) => {
  const frame = useCurrentFrame();
  const t = clamp01((frame - 20) / 50);
  const e = 1 - Math.pow(1 - t, 3);
  const [x0, y0] = map(0.95, 0.9);
  const [x1, y1] = map(0.6, 0.62);
  const x = x0 + (x1 - x0) * e;
  const y = y0 + (y1 - y0) * e;
  const drop = clamp01((frame - 72) / 14);
  if (frame < 12 || drop >= 1) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: x - 150,
        top: y - 52,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 22px',
        borderRadius: 14,
        background: C.paper,
        border: `1.5px solid ${C.line}`,
        boxShadow: '0 30px 60px -20px rgba(37,37,35,0.45)',
        transform: `rotate(${(1 - e) * 8 - 3}deg) scale(${1 - drop * 0.5})`,
        opacity: clamp01((frame - 12) / 8) * (1 - drop),
        fontFamily: F.sans,
        fontSize: 20,
        fontWeight: 600,
        color: C.ink,
      }}
    >
      <div
        style={{
          width: 40,
          height: 48,
          borderRadius: 6,
          background: '#FDECEA',
          border: `2px solid ${C.red}`,
          color: C.red,
          fontFamily: F.mono,
          fontSize: 12,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
          paddingBottom: 5,
        }}
      >
        PDF
      </div>
      thesis_final.pdf
    </div>
  );
};

export const Upload: React.FC = () => (
  <FeatureScene
    index="01"
    eyebrow="Upload"
    title="Drop in any *manuscript."
    sub="PDF or DOCX — theses, papers, reports. CITRA parses every citation in seconds."
    side="left"
    painting="feature-1-bg.png"
    url="citra.io.vn/upload"
    shots={[{ src: 'upload', aspect: N, from: 0 }]}
    cams={[
      { f: 0, cx: 0.6, cy: 0.5, w: 0.86 },
      { f: 80, cx: 0.6, cy: 0.58, w: 0.72 },
    ]}
    highlights={[{ rect: [0.312, 0.494, 0.576, 0.301], from: 70, to: 150, color: C.forest, dim: false }]}
    cursor={[
      { f: 20, x: 0.95, y: 0.9 },
      { f: 70, x: 0.6, y: 0.62, click: true },
      { f: 140, x: 0.72, y: 0.72 },
    ]}
    inViewport={(map) => <FileDrag map={map} />}
    overlay={<PipelineStrip start={100} />}
  />
);

/* -------------------------------------------------------- 02 hallucination */
export const Hallucination: React.FC = () => (
  <FeatureScene
    index="02"
    eyebrow="Hallucination detection"
    title="Catch references that *don't *exist."
    sub="Every entry is cross-checked against 15+ scholarly databases — Crossref, OpenAlex, DBLP, arXiv and more."
    side="left"
    accent={C.red}
    painting="sticky-1-bg.png"
    url="citra.io.vn/verification/report/33"
    shots={[
      { src: 'report-halluc', aspect: N, from: 0, to: 210 },
      { src: 'report-halluc-rules', aspect: N, from: 210 },
    ]}
    cams={[
      { f: 0, cx: 0.5, cy: 0.5, w: 1 },
      { f: 40, cx: 0.5, cy: 0.5, w: 1 },
      { f: 115, cx: 0.755, cy: 0.56, w: 0.52 },
      { f: 205, cx: 0.755, cy: 0.6, w: 0.52 },
      { f: 260, cx: 0.755, cy: 0.8, w: 0.5 },
      { f: 360, cx: 0.755, cy: 0.8, w: 0.47 },
    ]}
    highlights={[
      { rect: [0.552, 0.44, 0.405, 0.095], from: 112, to: 160, color: C.red },
      { rect: [0.552, 0.572, 0.405, 0.15], from: 165, to: 212, color: C.red },
      { rect: [0.552, 0.826, 0.405, 0.072], from: 262, color: C.red },
    ]}
  />
);

/* -------------------------------------------------------------- 03 metadata */
export const Metadata: React.FC = () => (
  <FeatureScene
    index="03"
    eyebrow="Retraction watch"
    title="Retracted? Wrong year? *Flagged."
    sub="Field-by-field diffs against canonical records, plus live retraction checks."
    side="right"
    accent={C.amber}
    painting="feature-3-bg.png"
    url="citra.io.vn/verification/report/33"
    shots={[{ src: 'tall-meta', aspect: T, from: 0 }]}
    cams={[
      { f: 0, cx: 0.5, cy: 0.22, w: 1 },
      { f: 55, cx: 0.755, cy: 0.36, w: 0.5 },
      { f: 135, cx: 0.755, cy: 0.37, w: 0.5 },
      { f: 195, cx: 0.755, cy: 0.56, w: 0.5 },
    ]}
    highlights={[
      { rect: [0.557, 0.318, 0.397, 0.074], from: 62, to: 140, color: C.red },
      { rect: [0.868, 0.468, 0.086, 0.218], from: 175, color: C.forest },
    ]}
  />
);

/* ----------------------------------------------------------------- 04 trace */
export const Trace: React.FC = () => (
  <FeatureScene
    index="04"
    eyebrow="Explainable AI"
    title="No black box. Every verdict, *explained."
    sub="A 5-stage neuro-symbolic trace — from GROBID parse to calibrated verdict."
    side="left"
    painting="usecase-1-bg.png"
    url="citra.io.vn/verification/report/33/trace"
    shots={[{ src: 'tall-trace', aspect: T, from: 0 }]}
    cams={[
      { f: 0, cx: 0.6, cy: 0.34, w: 0.74 },
      { f: 230, cx: 0.6, cy: 0.62, w: 0.7 },
    ]}
    highlights={[{ rect: [0.29, 0.613, 0.65, 0.046], from: 150, color: C.red }]}
  />
);

/* --------------------------------------------------------------- 05 autofix */
const FORMATS = ['APA 7th', 'IEEE', 'Harvard / TDTU', 'BibTeX .bib', 'RIS .ris', 'Auto-Healed .DOCX'];

const FormatChips: React.FC<{ start: number }> = ({ start }) => {
  return (
    <div
      style={{
        position: 'absolute',
        left: 120,
        top: 790,
        width: 540,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
      }}
    >
      {FORMATS.map((f, i) => (
        <Chip key={f} label={f} delay={start + i * 5} hero={i === FORMATS.length - 1} />
      ))}
    </div>
  );
};

const Chip: React.FC<{ label: string; delay: number; hero?: boolean }> = ({ label, delay, hero }) => {
  const p = useSpring(delay, { damping: 13, mass: 0.6, stiffness: 170 });
  return (
    <Pill
      bg={hero ? C.forest : C.paper}
      color={hero ? '#fff' : C.ink}
      border={hero ? C.forest : C.line}
      style={{ transform: `scale(${p})`, opacity: clamp01(p * 2), fontSize: 19, padding: '10px 18px' }}
    >
      {hero ? '✦ ' : ''}
      {label}
    </Pill>
  );
};

export const AutoFix: React.FC = () => (
  <FeatureScene
    index="05"
    eyebrow="1-click auto-fix"
    title="Fix every reference in *one *click."
    sub="Canonical metadata from 15+ sources, rewritten in the style you need."
    side="left"
    accent={C.violet}
    painting="sticky-2-bg.png"
    url="citra.io.vn/verification/report/33"
    shots={[
      { src: 'report-ide', aspect: N, from: 0, to: 64 },
      { src: 'tall-autofix', aspect: T, from: 64 },
    ]}
    cams={[
      { f: 0, cx: 0.66, cy: 0.42, w: 0.66 },
      { f: 40, cx: 0.7, cy: 0.4, w: 0.55 },
      { f: 63, cx: 0.7, cy: 0.4, w: 0.55 },
      { f: 64, cx: 0.5, cy: 0.16, w: 0.86 },
      { f: 140, cx: 0.5, cy: 0.25, w: 0.73 },
      { f: 225, cx: 0.5, cy: 0.26, w: 0.73 },
      { f: 285, cx: 0.5, cy: 0.48, w: 0.73 },
      { f: 360, cx: 0.5, cy: 0.5, w: 0.72 },
    ]}
    highlights={[
      { rect: [0.636, 0.378, 0.14, 0.03], from: 38, to: 62, color: C.violet, dim: false },
      { rect: [0.172, 0.213, 0.293, 0.077], from: 148, to: 228, color: C.red },
      { rect: [0.531, 0.213, 0.295, 0.077], from: 178, to: 228, color: C.forest, dim: false },
      { rect: [0.163, 0.418, 0.672, 0.122], from: 290, color: C.red },
    ]}
    cursor={[
      { f: 6, x: 0.82, y: 0.62 },
      { f: 44, x: 0.705, y: 0.393, click: true },
      { f: 64, x: 0.705, y: 0.393 },
    ]}
    overlay={<FormatChips start={250} />}
  />
);

/* ----------------------------------------------------------------- 06 graph */
export const Graph: React.FC = () => (
  <FeatureScene
    index="06"
    eyebrow="Evidence graph"
    title="Trace every *source."
    sub="Follow the evidence — from database hit to semantic match to the final verdict."
    side="right"
    painting="usecase-2-bg.png"
    url="citra.io.vn/verification/report/33"
    shots={[{ src: 'tall-graph', aspect: T, from: 0 }]}
    cams={[
      { f: 0, cx: 0.62, cy: 0.27, w: 0.66 },
      { f: 70, cx: 0.7, cy: 0.38, w: 0.52 },
      { f: 230, cx: 0.73, cy: 0.66, w: 0.5 },
    ]}
    highlights={[{ rect: [0.562, 0.418, 0.384, 0.075], from: 70, to: 150, color: C.amber }]}
  />
);

/* --------------------------------------------------------------- 07 teacher */
export const Teacher: React.FC = () => (
  <FeatureScene
    index="07"
    eyebrow="For educators"
    title="See the whole *cohort at once."
    sub="A shared AI-hallucination radar, cohort integrity analytics and a faculty review queue."
    side="left"
    painting="sticky-3-bg.png"
    url="citra.io.vn/teacher/classes/1"
    shots={[
      { src: 'tall-teacher', aspect: T, from: 0, to: 232 },
      { src: 'teacher-reviews', aspect: N, from: 232 },
    ]}
    cams={[
      { f: 0, cx: 0.58, cy: 0.18, w: 0.86 },
      { f: 40, cx: 0.58, cy: 0.2, w: 0.86 },
      { f: 120, cx: 0.753, cy: 0.3, w: 0.46 },
      { f: 231, cx: 0.753, cy: 0.31, w: 0.44 },
      { f: 232, cx: 0.6, cy: 0.45, w: 0.92 },
      { f: 360, cx: 0.62, cy: 0.42, w: 0.72 },
    ]}
    highlights={[{ rect: [0.557, 0.246, 0.388, 0.048], from: 128, to: 225, color: C.red }]}
  />
);
