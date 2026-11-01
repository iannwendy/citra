import React from 'react';
import {
  AbsoluteFill,
  Easing,
  getInputProps,
  Img,
  interpolate,
  random,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { C, F } from '../theme';

/* ------------------------------------------------------------------ easing */
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);
export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const useSpring = (delay = 0, config: Partial<{ damping: number; mass: number; stiffness: number }> = {}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping: 200, mass: 0.7, ...config } });
};

/* --------------------------------------------------------------- backdrops */
export const Paper: React.FC<{ children?: React.ReactNode; tint?: string }> = ({ children, tint }) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(120% 90% at 50% 40%, ${tint ?? C.ivory} 0%, ${C.ivory} 60%, #F2EEE6 100%)`,
    }}
  >
    {children}
  </AbsoluteFill>
);

/** Pass `--props='{"grain":false}'` for the web encode: animated grain wastes bitrate,
 *  the landing page overlays a static CSS grain instead. */
const GRAIN_ENABLED = (getInputProps() as { grain?: boolean }).grain !== false;

export const Grain: React.FC<{ opacity?: number }> = ({ opacity = 0.035 }) => {
  const frame = useCurrentFrame();
  if (!GRAIN_ENABLED) return null;
  const x = Math.floor(random(`gx${Math.floor(frame / 2)}`) * 256);
  const y = Math.floor(random(`gy${Math.floor(frame / 2)}`) * 256);
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `url(${staticFile('brand/noise.png')})`,
        backgroundSize: '256px 256px',
        backgroundPosition: `${x}px ${y}px`,
        opacity,
        mixBlendMode: 'multiply',
        pointerEvents: 'none',
      }}
    />
  );
};

export const Vignette: React.FC<{ strength?: number }> = ({ strength = 0.18 }) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(140% 100% at 50% 50%, transparent 55%, rgba(37,37,35,${strength}) 100%)`,
      pointerEvents: 'none',
    }}
  />
);

/** Painterly brand artwork panel (as used on the landing page). */
export const Painting: React.FC<{
  src: string;
  style?: React.CSSProperties;
  radius?: number;
  zoomFrom?: number;
  zoomTo?: number;
  duration?: number;
}> = ({ src, style, radius = 28, zoomFrom = 1.12, zoomTo = 1.0, duration = 300 }) => {
  const frame = useCurrentFrame();
  const z = interpolate(frame, [0, duration], [zoomFrom, zoomTo], { extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', overflow: 'hidden', borderRadius: radius, ...style }}>
      <Img
        src={staticFile(`brand/${src}`)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${z})` }}
      />
    </div>
  );
};

/* ------------------------------------------------------------------- text */
type WordsProps = {
  text: string;
  start?: number;
  stagger?: number;
  style?: React.CSSProperties;
  accent?: string;
  rise?: number;
  blur?: number;
};

/** Word-by-word editorial reveal. Prefix a word with * to colour it with `accent`. */
export const Words: React.FC<WordsProps> = ({ text, start = 0, stagger = 3, style, accent = C.forest, rise = 36, blur = 10 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(' ');
  return (
    <span style={{ display: 'inline', ...style }}>
      {words.map((w, i) => {
        if (w === '\\n') return <br key={i} />;
        const p = spring({ frame: frame - start - i * stagger, fps, config: { damping: 200, mass: 0.6 } });
        const isAccent = w.startsWith('*');
        const word = isAccent ? w.slice(1) : w;
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              transform: `translateY(${(1 - p) * rise}px)`,
              opacity: p,
              filter: `blur(${(1 - p) * blur}px)`,
              color: isAccent ? accent : undefined,
              whiteSpace: 'pre',
            }}
          >
            {word}
            {i < words.length - 1 ? ' ' : ''}
          </span>
        );
      })}
    </span>
  );
};

export const Eyebrow: React.FC<{ index?: string; label: string; start?: number; color?: string }> = ({
  index,
  label,
  start = 0,
  color = C.forest,
}) => {
  const p = useSpring(start);
  const lineW = interpolate(p, [0, 1], [0, 48]);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        fontFamily: F.mono,
        fontSize: 19,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        color,
        opacity: p,
        transform: `translateY(${(1 - p) * 14}px)`,
      }}
    >
      {index && <span style={{ fontWeight: 600 }}>{index}</span>}
      <span style={{ width: lineW, height: 2, background: color, display: 'inline-block' }} />
      <span style={{ color: C.muted }}>{label}</span>
    </div>
  );
};

export const Pill: React.FC<{
  children: React.ReactNode;
  color?: string;
  bg?: string;
  border?: string;
  style?: React.CSSProperties;
}> = ({ children, color = C.ink, bg = C.paper, border = C.line, style }) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      padding: '12px 22px',
      borderRadius: 999,
      background: bg,
      border: `1.5px solid ${border}`,
      color,
      fontFamily: F.mono,
      fontSize: 20,
      fontWeight: 500,
      letterSpacing: '0.02em',
      whiteSpace: 'nowrap',
      boxShadow: '0 10px 30px -12px rgba(37,37,35,0.25)',
      ...style,
    }}
  >
    {children}
  </div>
);

/* ----------------------------------------------------------------- cursor */
export type CursorKey = { f: number; x: number; y: number; click?: boolean };

export const Cursor: React.FC<{ keys: CursorKey[]; scale?: number }> = ({ keys, scale = 1.5 }) => {
  const frame = useCurrentFrame();
  if (keys.length === 0) return null;
  let x = keys[0].x;
  let y = keys[0].y;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (frame >= a.f && frame <= b.f) {
      const t = easeInOut(clamp01((frame - a.f) / Math.max(1, b.f - a.f)));
      x = lerp(a.x, b.x, t);
      y = lerp(a.y, b.y, t);
      break;
    }
    if (frame > b.f) {
      x = b.x;
      y = b.y;
    }
  }
  const lastF = keys[keys.length - 1].f;
  const visible =
    interpolate(frame, [keys[0].f - 8, keys[0].f], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) *
    interpolate(frame, [lastF + 4, lastF + 12], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const clicks = keys.filter((k) => k.click);
  let press = 1;
  for (const c of clicks) {
    const d = frame - c.f;
    if (d >= 0 && d < 10) press = 1 - 0.18 * Math.sin((d / 10) * Math.PI);
  }
  return (
    <>
      {clicks.map((c, i) => {
        const d = frame - c.f;
        if (d < 0 || d > 34) return null;
        const t = d / 34;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: c.x - 60,
              top: c.y - 60,
              width: 120,
              height: 120,
              borderRadius: '50%',
              border: `3px solid ${C.forest}`,
              transform: `scale(${0.2 + t * 0.9})`,
              opacity: 1 - t,
            }}
          />
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
          filter: 'drop-shadow(0 6px 10px rgba(0,0,0,0.28))',
        }}
      >
        <path
          d="M2 1.5 L2 27 L8.2 21.2 L12.4 31 L16.6 29.2 L12.5 19.6 L21 19.6 Z"
          fill="#111"
          stroke="#fff"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    </>
  );
};
