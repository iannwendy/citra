import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, F } from '../theme';
import { Grain, Words, clamp01, easeInOut, useSpring } from '../components/primitives';

export const Reveal: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const flashOut = interpolate(frame, [0, 22], [1, 0], { extrapolateRight: 'clamp' });
  const logo = useSpring(2, { damping: 14, mass: 0.8, stiffness: 140 });
  const word = useSpring(10, { damping: 200 });
  const bg = interpolate(frame, [0, durationInFrames], [1.18, 1.04]);
  const exitT = easeInOut(clamp01((frame - (durationInFrames - 16)) / 16));

  const letters = 'CITRA'.split('');
  return (
    <AbsoluteFill style={{ background: C.ivory }}>
      <AbsoluteFill style={{ transform: `scale(${bg + exitT * 0.25})`, filter: `blur(${exitT * 12}px)` }}>
        <Img src={staticFile('brand/feature-2-bg.png')} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </AbsoluteFill>
      {/* ivory bloom for legibility */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(60% 55% at 50% 50%, rgba(250,248,243,0.94) 0%, rgba(250,248,243,0.78) 45%, rgba(250,248,243,0.15) 100%)`,
        }}
      />
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          opacity: 1 - exitT,
          transform: `scale(${1 + exitT * 0.15})`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 38 }}>
          <div
            style={{
              width: 168,
              height: 168,
              borderRadius: 40,
              background: C.paper,
              boxShadow: '0 30px 60px -20px rgba(37,37,35,0.35), 0 0 0 1px rgba(37,37,35,0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transform: `scale(${logo}) rotate(${(1 - logo) * -25}deg)`,
            }}
          >
            <Img src={staticFile('brand/citra-logo.png')} style={{ width: 118, height: 118 }} />
          </div>
          <div style={{ display: 'flex', overflow: 'hidden', paddingBottom: 10 }}>
            {letters.map((l, i) => {
              const p = clamp01(word * 1.6 - i * 0.12);
              return (
                <span
                  key={i}
                  style={{
                    fontFamily: F.sans,
                    fontWeight: 600,
                    fontSize: 220,
                    letterSpacing: '-0.04em',
                    color: C.ink,
                    lineHeight: 1,
                    display: 'inline-block',
                    transform: `translateY(${(1 - easeInOut(p)) * 110}%)`,
                  }}
                >
                  {l}
                </span>
              );
            })}
          </div>
        </div>
        <div
          style={{
            marginTop: 44,
            fontFamily: F.display,
            fontWeight: 300,
            fontSize: 74,
            letterSpacing: '-0.025em',
            color: C.ink,
          }}
        >
          <Words text="Verify every citation. *Trace *every *source." start={68} stagger={4} accent={C.forest} />
        </div>
        <div
          style={{
            marginTop: 28,
            fontFamily: F.mono,
            fontSize: 22,
            letterSpacing: '0.2em',
            color: C.muted,
            opacity: clamp01((frame - 120) / 20),
          }}
        >
          EXPLAINABLE NEURO-SYMBOLIC CITATION VERIFICATION
        </div>
      </AbsoluteFill>
      <Grain />
      <AbsoluteFill style={{ background: '#fff', opacity: flashOut }} />
    </AbsoluteFill>
  );
};
