import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, F } from '../theme';
import { BrowserWindow, Cam, Highlight, Shot, ZoomShot } from './Browser';
import { CursorKey, Eyebrow, Grain, Painting, Paper, Words, clamp01, useSpring } from './primitives';

export type FeatureProps = {
  index: string;
  eyebrow: string;
  title: string;
  sub: string;
  side: 'left' | 'right'; // side of the TEXT column
  painting: string;
  url: string;
  shots: Shot[];
  cams: Cam[];
  highlights?: Highlight[];
  cursor?: CursorKey[];
  accent?: string;
  browserWidth?: number;
  overlay?: React.ReactNode; // rendered in full-frame coordinates
  inViewport?: (map: (ix: number, iy: number) => [number, number]) => React.ReactNode;
};

export const FeatureScene: React.FC<FeatureProps> = ({
  index,
  eyebrow,
  title,
  sub,
  side,
  painting,
  url,
  shots,
  cams,
  highlights,
  cursor,
  accent = C.forest,
  browserWidth = 1180,
  overlay,
  inViewport,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width: W, height: H } = useVideoConfig();
  const enter = useSpring(0, { damping: 26, mass: 0.9, stiffness: 120 });
  const exitT = clamp01((frame - (durationInFrames - 14)) / 14);
  const exitE = exitT * exitT;

  const dir = side === 'left' ? 1 : -1; // browser sits opposite to text
  const vw = browserWidth;
  const vh = Math.round(vw * 0.625);
  const bx = side === 'left' ? W - vw - 80 : 80;
  const by = (H - (vh + 46)) / 2 + 10;

  const textX = side === 'left' ? 110 : W - 110 - 500;
  const rotY = interpolate(enter, [0, 1], [dir * -14, dir * -4]);
  const bShift = (1 - enter) * dir * 160 + exitE * dir * 120;

  return (
    <AbsoluteFill>
      <Paper />
      {/* painterly frame behind the window */}
      <Painting
        src={painting}
        duration={durationInFrames}
        style={{
          left: bx + (side === 'left' ? 90 : -150),
          top: by - 70,
          width: vw + 60,
          height: vh + 46 + 140,
          opacity: interpolate(enter, [0, 1], [0, 1]) * (1 - exitE),
          transform: `translateX(${(1 - enter) * dir * 60}px)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: bx,
          top: by,
          perspective: 2400,
          transform: `translateX(${bShift}px)`,
          opacity: (0.2 + 0.8 * enter) * (1 - exitE),
          filter: `blur(${exitE * 14}px)`,
        }}
      >
        <div style={{ transform: `rotateY(${rotY}deg)`, transformOrigin: side === 'left' ? '100% 50%' : '0% 50%' }}>
          <BrowserWindow width={vw} contentHeight={vh} url={url}>
            <ZoomShot shots={shots} cams={cams} width={vw} height={vh} highlights={highlights} cursor={cursor} render={inViewport} />
          </BrowserWindow>
        </div>
      </div>

      {/* text column */}
      <div
        style={{
          position: 'absolute',
          left: textX,
          top: 0,
          height: H,
          width: 500,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 30,
          opacity: 1 - exitE,
          transform: `translateX(${-exitE * dir * 60}px)`,
          filter: `blur(${exitE * 10}px)`,
        }}
      >
        <Eyebrow index={index} label={eyebrow} start={6} color={accent} />
        <div
          style={{
            fontFamily: F.display,
            fontWeight: 300,
            fontSize: 70,
            lineHeight: 1.04,
            letterSpacing: '-0.025em',
            color: C.ink,
          }}
        >
          <Words text={title} start={12} stagger={3} accent={accent} />
        </div>
        <div style={{ fontFamily: F.sans, fontSize: 25, lineHeight: 1.5, color: C.muted, maxWidth: 480 }}>
          <Words text={sub} start={30} stagger={1} rise={14} blur={6} />
        </div>
      </div>
      {overlay}
      <Grain />
    </AbsoluteFill>
  );
};
