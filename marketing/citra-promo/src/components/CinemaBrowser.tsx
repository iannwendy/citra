import React from 'react';
import { Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, F } from '../theme';
import {
  CamKey,
  camSplineAt,
  clamp01,
  computeConnectorEndpoints,
  computeLoupeCrop,
  computeViewportLayout,
  lerp,
  sec,
  smootherstep,
} from './motion';

export type ShotSpec = {
  src: string;
  /** H / W aspect ratio: 0.625 for 4320x2700, 1.25 for 4320x5400 */
  aspect: number;
  fromSec: number;
  toSec?: number;
};

export type CursorWaypoint = {
  t: number;
  /** Image-normalized [0..1] coordinates */
  x: number;
  y: number;
  click?: boolean;
};

export type LoupeSpec = {
  /** Image-normalized [rx, ry, rw, rh] region to magnify */
  rect: [number, number, number, number];
  fromSec: number;
  toSec?: number;
  /** Viewport pixel coordinates (x, y) of top-left corner of the floating Loupe card */
  x: number;
  y: number;
  width: number;
  badge: string;
  captionVi?: string;
  accent?: string;
  /** Optional explicit shot override if different from active shot */
  shotSrc?: string;
  shotAspect?: number;
};

export const SmoothCursor: React.FC<{ keys: readonly CursorWaypoint[]; scale?: number }> = ({
  keys,
  scale = 1.45,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  if (keys.length === 0) return null;

  let x = keys[0].x;
  let y = keys[0].y;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t >= a.t && t <= b.t) {
      const u = smootherstep(clamp01((t - a.t) / Math.max(0.02, b.t - a.t)));
      x = lerp(a.x, b.x, u);
      y = lerp(a.y, b.y, u);
      break;
    }
    if (t > b.t) {
      x = b.x;
      y = b.y;
    }
  }

  const lastT = keys[keys.length - 1].t;
  const visible =
    clamp01((t - (keys[0].t - 0.16)) / 0.16) *
    (1 - clamp01((t - (lastT + 0.12)) / 0.22));
  if (visible <= 0.001) return null;

  const clicks = keys.filter((k) => k.click);
  let press = 1;
  for (const c of clicks) {
    const dt = t - c.t;
    if (dt >= 0 && dt < 0.18) {
      press = 1 - 0.2 * Math.sin((dt / 0.18) * Math.PI);
    }
  }

  return (
    <>
      {clicks.map((c, i) => {
        const dt = t - c.t;
        if (dt < 0 || dt > 0.65) return null;
        const p = dt / 0.65;
        return (
          <React.Fragment key={i}>
            <div
              style={{
                position: 'absolute',
                left: c.x - 58,
                top: c.y - 58,
                width: 116,
                height: 116,
                borderRadius: '50%',
                border: `2.5px solid ${C.forestBright}`,
                transform: `scale(${0.22 + p * 0.95})`,
                opacity: (1 - p) * 0.9,
                pointerEvents: 'none',
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: c.x - 34,
                top: c.y - 34,
                width: 68,
                height: 68,
                borderRadius: '50%',
                background: 'rgba(54, 179, 126, 0.22)',
                transform: `scale(${0.3 + p * 0.8})`,
                opacity: (1 - p) * 0.7,
                pointerEvents: 'none',
              }}
            />
          </React.Fragment>
        );
      })}
      <svg
        width={26 * scale}
        height={36 * scale}
        viewBox="0 0 26 36"
        style={{
          position: 'absolute',
          left: x - 3,
          top: y - 2,
          opacity: visible,
          transform: `scale(${press})`,
          transformOrigin: '3px 2px',
          filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.32))',
          pointerEvents: 'none',
          zIndex: 30,
        }}
      >
        <path
          d="M2 1.5 L2 27 L8.2 21.2 L12.4 31 L16.6 29.2 L12.5 19.6 L21 19.6 Z"
          fill="#141413"
          stroke="#FFFFFF"
          strokeWidth="2.1"
          strokeLinejoin="round"
        />
      </svg>
    </>
  );
};

/**
 * Continuous C1 Hermite camera viewport with elevated 3D `GlassLoupe` magnifiers,
 * target reticles, Bezier connector beams, and inertial cursor choreography.
 */
export const ZoomShot3D: React.FC<{
  shots: readonly ShotSpec[];
  cams: readonly CamKey[];
  width: number;
  height: number;
  loupes?: readonly LoupeSpec[];
  cursor?: readonly CursorWaypoint[];
  drift?: number;
  crossfadeSec?: number;
  renderOverlay?: (map: (ix: number, iy: number) => [number, number]) => React.ReactNode;
}> = ({
  shots,
  cams,
  width,
  height,
  loupes = [],
  cursor,
  drift = 0.022,
  crossfadeSec = 0.26,
  renderOverlay,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = frame / fps;
  const totalSec = durationInFrames / fps;

  const baseCam = camSplineAt(t, cams);
  const cam = {
    ...baseCam,
    w: baseCam.w * (1 - drift * clamp01(t / Math.max(1, totalSec))),
  };

  const activeShot = [...shots].reverse().find((s) => t >= s.fromSec) ?? shots[0];
  const activeLayout = computeViewportLayout(cam, activeShot.aspect, width, height);
  const mapPoint = (ix: number, iy: number): [number, number] => [
    activeLayout.left + ix * activeLayout.DW,
    activeLayout.top + iy * activeLayout.DH,
  ];

  // Subtle ambient dim when any GlassLoupe is active so the Loupe pops effortlessly
  let maxLoupeFocus = 0;
  const activeLoupes = loupes.map((l) => {
    const enter = spring({
      frame: frame - sec(l.fromSec, fps),
      fps,
      config: { damping: 24, mass: 0.7, stiffness: 185 },
    });
    const exit =
      l.toSec !== undefined
        ? 1 - smootherstep(clamp01((t - l.toSec) / 0.22))
        : 1;
    const p = clamp01(enter) * exit;
    if (p > maxLoupeFocus) maxLoupeFocus = p;
    return { spec: l, p };
  });

  return (
    <div style={{ position: 'relative', width, height, overflow: 'hidden', background: C.ivory }}>
      {shots.map((s, idx) => {
        const endSec = s.toSec ?? Infinity;
        const visible = t >= s.fromSec - 0.02 && t < endSec + crossfadeSec;
        if (!visible) return null;
        const fadeIn = idx === 0 ? 1 : smootherstep(clamp01((t - s.fromSec) / crossfadeSec));
        const L = computeViewportLayout(cam, s.aspect, width, height);
        return (
          <Img
            key={`${s.src}-${idx}`}
            src={staticFile(`shots/${s.src}.png`)}
            style={{
              position: 'absolute',
              left: L.left,
              top: L.top,
              width: L.DW,
              height: L.DH,
              opacity: fadeIn,
              maxWidth: 'none',
              transform: 'translateZ(0)',
            }}
          />
        );
      })}

      {/* Gentle optical backdrop dim (never harsh) when a GlassLoupe inspects a region */}
      {maxLoupeFocus > 0.01 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `rgba(22, 21, 18, ${0.15 * maxLoupeFocus})`,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Target reticles + Bezier connector beams + Elevated 3D GlassLoupe cards */}
      {activeLoupes.map(({ spec: l, p }, idx) => {
        if (p <= 0.005) return null;
        const accent = l.accent ?? C.forest;
        const srcShot = l.shotSrc ?? activeShot.src;
        const srcAspect = l.shotAspect ?? activeShot.aspect;
        const L = computeViewportLayout(cam, srcAspect, width, height);

        const targetBox = {
          x: L.left + l.rect[0] * L.DW - 4,
          y: L.top + l.rect[1] * L.DH - 4,
          w: l.rect[2] * L.DW + 8,
          h: l.rect[3] * L.DH + 8,
        };

        const crop = computeLoupeCrop(l.rect, srcAspect, l.width);
        const headerH = 38;
        const footerH = l.captionVi ? 38 : 0;
        const loupeBox = {
          x: l.x,
          y: l.y,
          w: l.width,
          h: crop.cardHeight + headerH + footerH,
        };
        const conn = computeConnectorEndpoints(targetBox, loupeBox);

        return (
          <React.Fragment key={idx}>
            {/* Subtle precision reticle on the underlying UI */}
            <div
              style={{
                position: 'absolute',
                left: targetBox.x,
                top: targetBox.y,
                width: targetBox.w,
                height: targetBox.h,
                borderRadius: 10,
                border: `2px solid ${accent}`,
                boxShadow: `0 0 0 4px ${accent}22, 0 0 28px ${accent}44`,
                opacity: p,
                pointerEvents: 'none',
              }}
            />
            {/* Smooth Bezier callout beam */}
            <svg
              width={width}
              height={height}
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: p }}
            >
              <path
                d={`M ${conn.x1} ${conn.y1} C ${conn.cx1} ${conn.cy1}, ${conn.cx2} ${conn.cy2}, ${conn.x2} ${conn.y2}`}
                fill="none"
                stroke={accent}
                strokeWidth={2.2}
                strokeDasharray="6 5"
              />
              <circle cx={conn.x1} cy={conn.y1} r={4.5} fill={accent} />
              <circle cx={conn.x2} cy={conn.y2} r={5} fill={accent} />
            </svg>
            {/* Elevated 3D Glass Magnifier Card */}
            <div
              style={{
                position: 'absolute',
                left: loupeBox.x,
                top: loupeBox.y,
                width: loupeBox.w,
                borderRadius: 16,
                overflow: 'hidden',
                background: C.paper,
                border: `1.5px solid ${accent}66`,
                boxShadow: `0 34px 70px -18px rgba(18, 17, 15, 0.46), 0 0 0 1px rgba(255,255,255,0.75) inset, 0 0 36px -8px ${accent}40`,
                opacity: p,
                transform: `translate3d(0, ${(1 - p) * 20}px, 0) scale(${0.92 + 0.08 * p})`,
                zIndex: 25,
              }}
            >
              {/* Frosted Loupe Header */}
              <div
                style={{
                  height: headerH,
                  padding: '0 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: '#171918',
                  color: '#F5F7F5',
                  fontFamily: F.mono,
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: '0.07em',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: accent,
                      boxShadow: `0 0 10px ${accent}`,
                    }}
                  />
                  {l.badge}
                </span>
                <span style={{ opacity: 0.55, fontSize: 11 }}>MAGNIFIED 3× RETINA</span>
              </div>
              {/* Cropped crisp Retina UI region */}
              <div
                style={{
                  position: 'relative',
                  width: l.width,
                  height: crop.cardHeight,
                  overflow: 'hidden',
                  background: C.paper,
                }}
              >
                <Img
                  src={staticFile(`shots/${srcShot}.png`)}
                  style={{
                    position: 'absolute',
                    left: crop.imgLeft,
                    top: crop.imgTop,
                    width: crop.imgWidth,
                    height: crop.imgHeight,
                    maxWidth: 'none',
                  }}
                />
              </div>
              {/* Optional Vietnamese insight strip */}
              {l.captionVi && (
                <div
                  style={{
                    minHeight: footerH,
                    padding: '8px 14px',
                    background: '#F5F2EA',
                    borderTop: `1px solid ${C.line}`,
                    fontFamily: F.sans,
                    fontSize: 14,
                    fontWeight: 600,
                    color: C.inkSoft,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {l.captionVi}
                </div>
              )}
            </div>
          </React.Fragment>
        );
      })}

      {renderOverlay?.(mapPoint)}
      {cursor && (
        <SmoothCursor
          keys={cursor.map((k) => {
            const [px, py] = mapPoint(k.x, k.y);
            return { ...k, x: px, y: py };
          })}
        />
      )}
    </div>
  );
};

/**
 * Studio macOS Browser Window with 3D gimbal tilt driven either by `cams` or static angles.
 */
export const CinemaBrowser: React.FC<{
  width: number;
  contentHeight: number;
  url?: string;
  statusLabel?: string;
  cams?: readonly CamKey[];
  rotX?: number;
  rotY?: number;
  rotZ?: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({
  width,
  contentHeight,
  url = 'citra.io.vn',
  statusLabel = 'v3.75.2 · LIVE',
  cams,
  rotX = 0,
  rotY = 0,
  rotZ = 0,
  style,
  children,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const pose = cams ? camSplineAt(t, cams) : null;
  const rx = pose ? pose.rotX : rotX;
  const ry = pose ? pose.rotY : rotY;
  const rz = pose ? pose.rotZ : rotZ;
  const barH = 44;

  return (
    <div style={{ perspective: 2600, ...style }}>
      <div
        style={{
          width,
          height: contentHeight + barH,
          borderRadius: 20,
          overflow: 'hidden',
          background: C.paper,
          transform: `rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg)`,
          transformStyle: 'preserve-3d',
          boxShadow:
            '0 54px 110px -28px rgba(24, 23, 20, 0.42), 0 22px 44px -20px rgba(24, 23, 20, 0.25), 0 0 0 1.5px rgba(28, 27, 24, 0.11)',
        }}
      >
        {/* Top Browser Chrome */}
        <div
          style={{
            height: barH,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 18px',
            background: 'linear-gradient(180deg, #F8F5EE 0%, #EFECE3 100%)',
            borderBottom: `1px solid ${C.line}`,
            position: 'relative',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {['#EC6A5E', '#F4BF4F', '#61C554'].map((dot) => (
              <div
                key={dot}
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: dot,
                  boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.12)',
                }}
              />
            ))}
          </div>

          <div
            style={{
              position: 'absolute',
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 20px',
              borderRadius: 9,
              background: C.paper,
              border: `1px solid ${C.line}`,
              fontFamily: F.mono,
              fontSize: 13.5,
              fontWeight: 500,
              color: C.muted,
              minWidth: Math.min(380, Math.round(width * 0.42)),
              justifyContent: 'center',
            }}
          >
            <svg width="11" height="13" viewBox="0 0 12 14">
              <rect x="1" y="6" width="10" height="7.5" rx="1.6" fill={C.forest} />
              <path
                d="M3.3 6 V4.2 a2.7 2.7 0 0 1 5.4 0 V6"
                stroke={C.forest}
                strokeWidth="1.6"
                fill="none"
              />
            </svg>
            <span>{url}</span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: F.mono,
              fontSize: 11.5,
              fontWeight: 600,
              color: C.forest,
              letterSpacing: '0.06em',
            }}
          >
            <span
              style={{
                width: 6.5,
                height: 6.5,
                borderRadius: '50%',
                background: C.forestBright,
              }}
            />
            {statusLabel}
          </div>
        </div>

        <div style={{ width, height: contentHeight, position: 'relative' }}>{children}</div>
      </div>
    </div>
  );
};
