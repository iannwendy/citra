import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, F } from '../theme';
import { BrowserWindow, ZoomShot } from '../components/Browser';
import { Grain, Painting, Paper, Words, clamp01, easeInOut, easeOut, useSpring } from '../components/primitives';

/* ------------------------------------------------------------- montage 4s */
const CUTS: { src: string; label: string; url: string; cx: number; cy: number; w: number }[] = [
  { src: 'sandbox-loaded', label: 'Live Citation Sandbox', url: 'citra.io.vn/sandbox', cx: 0.6, cy: 0.45, w: 0.8 },
  { src: 'report-consistency', label: 'Bidirectional Consistency', url: 'citra.io.vn/report/33/consistency', cx: 0.6, cy: 0.45, w: 0.8 },
  { src: 'report-document', label: 'Document Inspector', url: 'citra.io.vn/report/33/document', cx: 0.6, cy: 0.5, w: 0.8 },
  { src: 'report-issues', label: 'Issue Triage', url: 'citra.io.vn/report/33/issues', cx: 0.6, cy: 0.45, w: 0.8 },
  { src: 'dashboard', label: 'Workspace Dashboard', url: 'citra.io.vn/dashboard', cx: 0.6, cy: 0.45, w: 0.8 },
  { src: 'batch', label: 'Batch Verification', url: 'citra.io.vn/batch-upload', cx: 0.6, cy: 0.5, w: 0.8 },
  { src: 'admin-system', label: 'System Health', url: 'citra.io.vn/admin/system', cx: 0.6, cy: 0.45, w: 0.8 },
  { src: 'pricing', label: 'Plans for every scale', url: 'citra.io.vn/pricing', cx: 0.5, cy: 0.45, w: 0.9 },
];

export const Montage: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames, width: W } = useVideoConfig();
  const per = durationInFrames / CUTS.length; // 30 frames = 1 beat at 120bpm
  const idx = Math.min(CUTS.length - 1, Math.floor(frame / per));
  const local = frame - idx * per;
  const cut = CUTS[idx];
  const vw = 1360;
  const vh = Math.round(vw * 0.625);
  const punch = interpolate(local, [0, 6, per], [1.035, 1, 0.985], { extrapolateRight: 'clamp' });
  const head = useSpring(0);
  const exitT = easeInOut(clamp01((frame - (durationInFrames - 12)) / 12));
  const labelP = easeOut(clamp01(local / 8));

  return (
    <AbsoluteFill>
      <Paper />
      <Painting
        src={['sticky-1-bg.png', 'feature-1-bg.png', 'usecase-1-bg.png', 'sticky-3-bg.png'][idx % 4]}
        zoomFrom={1.08}
        zoomTo={1.0}
        duration={per}
        radius={0}
        style={{ left: 0, top: 0, width: W, height: 1080, opacity: 0.55 }}
      />
      <AbsoluteFill style={{ background: 'rgba(250,248,243,0.35)' }} />
      <div
        style={{
          position: 'absolute',
          top: 52,
          width: '100%',
          textAlign: 'center',
          fontFamily: F.display,
          fontWeight: 300,
          fontSize: 64,
          letterSpacing: '-0.025em',
          color: C.ink,
          opacity: head * (1 - exitT),
        }}
      >
        <Words text="One workspace. *Every *check." start={0} stagger={3} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: (W - vw) / 2,
          top: 160,
          transform: `scale(${punch * (1 - exitT * 0.04)})`,
          opacity: 1 - exitT,
          filter: `blur(${exitT * 10}px)`,
        }}
      >
        <BrowserWindow width={vw} contentHeight={vh} url={cut.url}>
          <ZoomShot
            key={cut.src}
            shots={[{ src: cut.src, aspect: 0.625, from: 0 }]}
            cams={[{ f: 0, cx: cut.cx, cy: cut.cy, w: cut.w }]}
            width={vw}
            height={vh}
            drift={0}
          />
        </BrowserWindow>
        <div
          style={{
            position: 'absolute',
            left: -30,
            bottom: 60,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '18px 30px',
            borderRadius: 16,
            background: C.ink,
            color: '#fff',
            fontFamily: F.sans,
            fontSize: 34,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            boxShadow: '0 30px 60px -20px rgba(0,0,0,0.5)',
            transform: `translateX(${(1 - labelP) * -40}px)`,
            opacity: labelP,
          }}
        >
          <span style={{ fontFamily: F.mono, fontSize: 22, color: '#9FD3B5' }}>{String(idx + 1).padStart(2, '0')}</span>
          {cut.label}
        </div>
      </div>
      <Grain />
    </AbsoluteFill>
  );
};

/* --------------------------------------------------------------- stats 4s */
const STATS = [
  { value: 15, suffix: '+', label: 'scholarly & technical databases' },
  { value: 128, suffix: 'K+', label: 'papers in the local index' },
  { value: 28, suffix: '', label: 'symbolic verification rules' },
  { value: 98.58, suffix: '%', label: 'accuracy on a 120K-paper benchmark', decimals: 2 },
];

export const Stats: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const exitT = easeInOut(clamp01((frame - (durationInFrames - 14)) / 14));
  const head = useSpring(0);
  return (
    <AbsoluteFill>
      <Paper />
      <Painting
        src="pricing-floral.png"
        zoomFrom={1.1}
        zoomTo={1.0}
        duration={durationInFrames}
        radius={0}
        style={{ left: 0, top: 0, width: 1920, height: 1080, opacity: 0.16 }}
      />
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          opacity: 1 - exitT,
          filter: `blur(${exitT * 10}px)`,
        }}
      >
        <div
          style={{
            fontFamily: F.mono,
            fontSize: 22,
            letterSpacing: '0.22em',
            color: C.forest,
            opacity: head,
            marginBottom: 80,
          }}
        >
          BUILT ON EVIDENCE, NOT GUESSWORK
        </div>
        <div style={{ display: 'flex', gap: 0 }}>
          {STATS.map((s, i) => {
            const d = 8 + i * 8;
            const p = clamp01((frame - d) / 70);
            const e = 1 - Math.pow(1 - p, 4);
            const v = s.value * e;
            const appear = clamp01((frame - d) / 16);
            return (
              <div
                key={s.label}
                style={{
                  width: 430,
                  padding: '0 40px',
                  borderLeft: i === 0 ? 'none' : `1.5px solid ${C.line}`,
                  opacity: appear,
                  transform: `translateY(${(1 - appear) * 40}px)`,
                }}
              >
                <div
                  style={{
                    fontFamily: F.display,
                    fontWeight: 300,
                    fontSize: 124,
                    lineHeight: 1,
                    letterSpacing: '-0.04em',
                    color: C.ink,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {s.decimals ? v.toFixed(s.decimals) : Math.round(v)}
                  <span style={{ color: C.forest }}>{s.suffix}</span>
                </div>
                <div style={{ marginTop: 22, fontFamily: F.sans, fontSize: 26, lineHeight: 1.4, color: C.muted }}>{s.label}</div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
      <Grain />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------- end card 4s */
export const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const logo = useSpring(0, { damping: 14, mass: 0.8, stiffness: 140 });
  const word = useSpring(6);
  const cta = useSpring(70, { damping: 15, stiffness: 150 });
  const bgZoom = interpolate(frame, [0, durationInFrames], [1.12, 1.02]);
  const flash = interpolate(frame, [0, 18], [0.9, 0], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 30, durationInFrames - 2], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{ background: C.ivory }}>
      <AbsoluteFill style={{ transform: `scale(${bgZoom})` }}>
        <Img src={staticFile('brand/hero-bg.png')} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.9 }} />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(62% 60% at 50% 50%, rgba(250,248,243,0.96) 0%, rgba(250,248,243,0.85) 50%, rgba(250,248,243,0.3) 100%)',
        }}
      />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 30 }}>
          <div
            style={{
              width: 128,
              height: 128,
              borderRadius: 32,
              background: C.paper,
              boxShadow: '0 24px 48px -16px rgba(37,37,35,0.35), 0 0 0 1px rgba(37,37,35,0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transform: `scale(${logo})`,
            }}
          >
            <Img src={staticFile('brand/citra-logo.png')} style={{ width: 90, height: 90 }} />
          </div>
          <div
            style={{
              fontFamily: F.sans,
              fontWeight: 600,
              fontSize: 168,
              letterSpacing: '-0.04em',
              color: C.ink,
              lineHeight: 1,
              opacity: word,
              transform: `translateX(${(1 - word) * -30}px)`,
            }}
          >
            CITRA
          </div>
        </div>
        <div style={{ marginTop: 40, fontFamily: F.display, fontWeight: 300, fontSize: 66, letterSpacing: '-0.025em', color: C.ink }}>
          <Words text="Verify every citation. *Trace *every *source." start={16} stagger={3} />
        </div>
        <div style={{ marginTop: 16, fontFamily: F.serif, fontWeight: 300, fontSize: 38, color: C.muted, fontStyle: 'italic' }}>
          <Words text="Kiểm chứng mọi trích dẫn. Truy vết mọi nguồn." start={40} stagger={2} rise={16} />
        </div>
        <div
          style={{
            marginTop: 56,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '22px 44px',
            borderRadius: 16,
            background: C.ink,
            color: '#fff',
            fontFamily: F.sans,
            fontSize: 34,
            fontWeight: 600,
            transform: `scale(${0.85 + 0.15 * cta})`,
            opacity: cta,
            boxShadow: '0 30px 60px -24px rgba(0,0,0,0.55)',
          }}
        >
          Try CITRA free <span style={{ opacity: 0.5 }}>—</span>
          <span style={{ fontFamily: F.mono, fontWeight: 500, color: '#9FD3B5' }}>citra.io.vn</span>
        </div>
      </AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          bottom: 48,
          width: '100%',
          textAlign: 'center',
          fontFamily: F.mono,
          fontSize: 18,
          letterSpacing: '0.16em',
          color: C.muted,
          opacity: clamp01((frame - 90) / 20),
        }}
      >
        DECISION-SUPPORT FOR ACADEMIC INTEGRITY · TON DUC THANG UNIVERSITY · 2026
      </div>
      <Grain />
      <AbsoluteFill style={{ background: '#fff', opacity: flash }} />
      <AbsoluteFill style={{ background: C.ivory, opacity: fadeOut }} />
    </AbsoluteFill>
  );
};
