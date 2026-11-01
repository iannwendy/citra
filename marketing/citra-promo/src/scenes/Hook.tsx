import React from 'react';
import { AbsoluteFill, interpolate, random, useCurrentFrame, useVideoConfig } from 'remotion';
import timeline from '../timeline.json';
import { C, F, sec } from '../theme';
import { Grain, Paper, Vignette, Words, clamp01, easeInOut, useSpring } from '../components/primitives';

export const LINE_A = '[1] Vaswani et al. (2017). Attention Is All You Need.';
export const LINE_B = '[2] Robertson & Walker (2024). Quantum Hyper-Graph Reasoning.';

const typed = (frame: number, fps: number, start: number, cps: number, text: string) => {
  const n = Math.floor(((frame / fps) - start) * cps);
  return text.slice(0, Math.max(0, Math.min(text.length, n)));
};

const Stamp: React.FC<{ at: number; color: string; bg: string; children: React.ReactNode }> = ({ at, color, bg, children }) => {
  const p = useSpring(at, { damping: 12, mass: 0.6, stiffness: 180 });
  if (p <= 0.001) return null;
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        marginTop: 16,
        padding: '8px 18px',
        borderRadius: 10,
        border: `2px solid ${color}`,
        background: bg,
        color,
        fontFamily: F.mono,
        fontSize: 20,
        fontWeight: 600,
        letterSpacing: '0.08em',
        transform: `scale(${0.6 + 0.4 * p}) rotate(${(1 - p) * -6}deg)`,
        transformOrigin: 'left center',
        opacity: clamp01(p * 1.5),
      }}
    >
      {children}
    </div>
  );
};

export const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const A = timeline.sfx.typeA;
  const B = timeline.sfx.typeB;
  const G = timeline.sfx.glitch;

  const aText = typed(frame, fps, A.start, A.cps, LINE_A);
  const bText = typed(frame, fps, B.start, B.cps, LINE_B);
  const caretOn = Math.floor(frame / 18) % 2 === 0;
  const aDone = aText.length === LINE_A.length;
  const bDone = bText.length === LINE_B.length;

  // glitch window
  const g = t >= G && t < G + 0.45;
  const gSeed = Math.floor(frame / 2);
  const gx = g ? (random(`gx${gSeed}`) - 0.5) * 26 : 0;
  const isFake = t >= G + 0.1;
  const strike = easeInOut(clamp01((t - (G + 0.25)) / 0.4));

  // card exit 6.1 -> 6.6s
  const cardOut = easeInOut(clamp01((t - 6.1) / 0.5));
  const intro = useSpring(4);

  // kinetic lines
  const l1 = sec(6.35);
  const l2 = sec(7.15);
  const l3 = sec(8.55);
  const linesOut = easeInOut(clamp01((t - 8.3) / 0.3));
  const q = clamp01((t - 8.55) / 1.45);
  const flash = interpolate(t, [9.8, 10.0], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill>
      <Paper />
      {/* reference card */}
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div
          style={{
            width: 1520,
            padding: '56px 72px 64px',
            borderRadius: 26,
            background: C.paper,
            border: `1px solid ${C.line}`,
            boxShadow: '0 50px 100px -40px rgba(37,37,35,0.35)',
            opacity: intro * (1 - cardOut),
            transform: `translateY(${(1 - intro) * 40}px) scale(${1 - cardOut * 0.08})`,
            filter: `blur(${cardOut * 16}px)`,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontFamily: F.mono,
              fontSize: 18,
              letterSpacing: '0.18em',
              color: C.faint,
              marginBottom: 40,
            }}
          >
            <span>REFERENCES</span>
            <span>manuscript_final.pdf · p. 24</span>
          </div>

          <div style={{ fontFamily: F.serif, fontSize: 44, lineHeight: 1.35, color: C.ink, minHeight: 54 }}>
            {aText}
            {!aDone && t >= A.start - 0.3 && <span style={{ opacity: caretOn ? 1 : 0, color: C.forest }}>|</span>}
          </div>
          <div style={{ minHeight: 64 }}>
            <Stamp at={sec(A.start + LINE_A.length / A.cps + 0.15)} color={C.forest} bg={C.mint}>
              ✓ VERIFIED · CROSSREF · OPENALEX
            </Stamp>
          </div>

          <div style={{ height: 34 }} />
          <div style={{ position: 'relative', fontFamily: F.serif, fontSize: 44, lineHeight: 1.35, minHeight: 54 }}>
            {g && (
              <>
                <div style={{ position: 'absolute', inset: 0, color: '#00B3C7', transform: `translateX(${gx + 6}px)`, opacity: 0.7, mixBlendMode: 'multiply' }}>{bText}</div>
                <div style={{ position: 'absolute', inset: 0, color: '#E5484D', transform: `translateX(${-gx - 6}px)`, opacity: 0.7, mixBlendMode: 'multiply' }}>{bText}</div>
              </>
            )}
            <span
              style={{
                position: 'relative',
                color: isFake ? C.red : C.ink,
                transform: `translateX(${gx * 0.4}px)`,
                display: 'inline',
                clipPath: g ? `inset(${random(`c${gSeed}`) * 40}% 0 ${random(`d${gSeed}`) * 40}% 0)` : undefined,
              }}
            >
              {bText}
            </span>
            {!bDone && t >= B.start - 0.3 && <span style={{ opacity: caretOn ? 1 : 0, color: C.forest }}>|</span>}
            {isFake && (
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: '50%',
                  height: 4,
                  width: `${strike * 100}%`,
                  background: C.red,
                  borderRadius: 2,
                }}
              />
            )}
          </div>
          <div style={{ minHeight: 64 }}>
            <Stamp at={sec(G + 0.35)} color={C.red} bg={C.redSoft}>
              ✕ NOT FOUND IN ANY SCHOLARLY INDEX
            </Stamp>
          </div>
        </div>
      </AbsoluteFill>

      {/* kinetic statements */}
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 10,
          opacity: 1 - linesOut,
          transform: `translateY(${-linesOut * 30}px)`,
          filter: `blur(${linesOut * 10}px)`,
        }}
      >
        {frame >= l1 - 2 && (
          <div style={{ fontFamily: F.display, fontWeight: 300, fontSize: 104, letterSpacing: '-0.03em', color: C.ink }}>
            <Words text="AI writes references in seconds." start={l1} stagger={3} />
          </div>
        )}
        {frame >= l2 - 2 && (
          <div style={{ fontFamily: F.display, fontWeight: 300, fontSize: 104, letterSpacing: '-0.03em', color: C.muted }}>
            <Words text="Some of them *never *existed." start={l2} stagger={3} accent={C.red} />
          </div>
        )}
      </AbsoluteFill>

      {frame >= l3 - 2 && (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
          <div
            style={{
              fontFamily: F.display,
              fontWeight: 300,
              fontSize: 132,
              letterSpacing: '-0.035em',
              color: C.ink,
              transform: `scale(${1 + q * 0.12})`,
            }}
          >
            <Words text="So who checks the *sources?" start={l3} stagger={4} accent={C.forest} />
          </div>
        </AbsoluteFill>
      )}

      <Vignette strength={0.12} />
      <Grain />
      <AbsoluteFill style={{ background: C.ivory, opacity: flash }} />
    </AbsoluteFill>
  );
};
