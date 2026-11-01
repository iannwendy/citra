import React from 'react';
import { Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { C, F } from '../theme';
import { Cursor, CursorKey, clamp01, easeInOut, lerp } from './primitives';

/** Camera keyframe: (cx, cy) = image-normalised focus point, w = fraction of image width visible. */
export type Cam = { f: number; cx: number; cy: number; w: number };
export type Shot = { src: string; aspect: number; from: number; to?: number };
/** Rect in image-normalised coords [x, y, w, h]. */
export type Highlight = { rect: [number, number, number, number]; from: number; to?: number; color?: string; dim?: boolean };

export const camAt = (frame: number, keys: Cam[]): Cam => {
  if (frame <= keys[0].f) return keys[0];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (frame <= b.f) {
      const t = easeInOut(clamp01((frame - a.f) / Math.max(1, b.f - a.f)));
      return {
        f: frame,
        cx: lerp(a.cx, b.cx, t),
        cy: lerp(a.cy, b.cy, t),
        // log-space zoom = perceptually uniform
        w: Math.exp(lerp(Math.log(a.w), Math.log(b.w), t)),
      };
    }
  }
  return keys[keys.length - 1];
};

const layout = (cam: Cam, aspect: number, VW: number, VH: number) => {
  const DW = VW / cam.w;
  const DH = DW * aspect;
  let left = VW / 2 - cam.cx * DW;
  let top = VH / 2 - cam.cy * DH;
  left = DW >= VW ? Math.min(0, Math.max(VW - DW, left)) : (VW - DW) / 2;
  top = DH >= VH ? Math.min(0, Math.max(VH - DH, top)) : (VH - DH) / 2;
  return { DW, DH, left, top };
};

export const ZoomShot: React.FC<{
  shots: Shot[];
  cams: Cam[];
  width: number;
  height: number;
  highlights?: Highlight[];
  drift?: number;
  children?: React.ReactNode;
  /** cursor keys in IMAGE-normalised coords; follows the UI as the camera moves */
  cursor?: CursorKey[];
  render?: (map: (ix: number, iy: number) => [number, number]) => React.ReactNode;
}> = ({ shots, cams, width, height, highlights = [], drift = 0.025, children, cursor, render }) => {
  const frame = useCurrentFrame();
  const base = camAt(frame, cams);
  const cam = { ...base, w: base.w * (1 - drift * clamp01(frame / 400)) };

  const XF = 14; // crossfade frames
  return (
    <div style={{ position: 'relative', width, height, overflow: 'hidden', background: C.ivory }}>
      {shots.map((s, i) => {
        const end = s.to ?? Infinity;
        const fadeIn = i === 0 ? 1 : clamp01((frame - s.from) / XF);
        const visible = frame >= s.from && frame < end + XF;
        if (!visible) return null;
        const L = layout(cam, s.aspect, width, height);
        return (
          <Img
            key={s.src + i}
            src={staticFile(`shots/${s.src}.png`)}
            style={{
              position: 'absolute',
              left: L.left,
              top: L.top,
              width: L.DW,
              height: L.DH,
              opacity: fadeIn,
              maxWidth: 'none',
            }}
          />
        );
      })}
      {highlights.map((h, i) => {
        const s = [...shots].reverse().find((sh) => frame >= sh.from) ?? shots[0];
        const L = layout(cam, s.aspect, width, height);
        const pIn = clamp01((frame - h.from) / 14);
        const pOut = h.to !== undefined ? 1 - clamp01((frame - h.to) / 10) : 1;
        const p = easeInOut(pIn) * pOut;
        if (p <= 0) return null;
        const color = h.color ?? C.forest;
        const pad = 6;
        const x = L.left + h.rect[0] * L.DW - pad;
        const y = L.top + h.rect[1] * L.DH - pad;
        const w = h.rect[2] * L.DW + pad * 2;
        const hh = h.rect[3] * L.DH + pad * 2;
        const grow = interpolate(p, [0, 1], [1.06, 1]);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: w,
              height: hh,
              borderRadius: 14,
              border: `3px solid ${color}`,
              opacity: p,
              transform: `scale(${grow})`,
              boxShadow: `0 0 0 6px ${color}22, 0 0 48px ${color}55${
                h.dim === false ? '' : `, 0 0 0 4000px rgba(37,37,35,${0.32 * p})`
              }`,
            }}
          />
        );
      })}
      {(() => {
        const s = [...shots].reverse().find((sh) => frame >= sh.from) ?? shots[0];
        const L = layout(cam, s.aspect, width, height);
        const map = (ix: number, iy: number): [number, number] => [L.left + ix * L.DW, L.top + iy * L.DH];
        return (
          <>
            {render?.(map)}
            {cursor && <Cursor keys={cursor.map((k) => ({ ...k, x: map(k.x, k.y)[0], y: map(k.x, k.y)[1] }))} />}
          </>
        );
      })()}
      {children}
    </div>
  );
};

export const BrowserWindow: React.FC<{
  width: number;
  url?: string;
  children: React.ReactNode;
  contentHeight: number;
  style?: React.CSSProperties;
}> = ({ width, url = 'citra.io.vn', children, contentHeight, style }) => {
  const bar = 46;
  return (
    <div
      style={{
        width,
        height: contentHeight + bar,
        borderRadius: 18,
        overflow: 'hidden',
        background: C.paper,
        boxShadow:
          '0 60px 120px -30px rgba(37,37,35,0.45), 0 24px 48px -24px rgba(37,37,35,0.30), 0 0 0 1px rgba(37,37,35,0.10)',
        ...style,
      }}
    >
      <div
        style={{
          height: bar,
          display: 'flex',
          alignItems: 'center',
          padding: '0 18px',
          gap: 9,
          background: '#F4F1EA',
          borderBottom: `1px solid ${C.line}`,
          position: 'relative',
        }}
      >
        {['#EC6A5E', '#F4BF4F', '#61C554'].map((c) => (
          <div key={c} style={{ width: 13, height: 13, borderRadius: '50%', background: c }} />
        ))}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 18px',
            borderRadius: 9,
            background: C.paper,
            border: `1px solid ${C.line}`,
            fontFamily: F.mono,
            fontSize: 15,
            color: C.muted,
            minWidth: 360,
            justifyContent: 'center',
          }}
        >
          <svg width="12" height="14" viewBox="0 0 12 14">
            <rect x="1" y="6" width="10" height="7.5" rx="1.6" fill={C.forest} />
            <path d="M3.3 6 V4.2 a2.7 2.7 0 0 1 5.4 0 V6" stroke={C.forest} strokeWidth="1.6" fill="none" />
          </svg>
          {url}
        </div>
      </div>
      <div style={{ height: contentHeight, position: 'relative' }}>{children}</div>
    </div>
  );
};
