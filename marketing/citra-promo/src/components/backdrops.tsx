import React from 'react';
import {
  AbsoluteFill,
  getInputProps,
  Img,
  interpolate,
  random,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { C, F } from '../theme';
import { clamp01 } from './motion';

const GRAIN_ENABLED = (getInputProps() as { grain?: boolean }).grain !== false;

export const FilmGrain: React.FC<{ opacity?: number; dark?: boolean }> = ({
  opacity = 0.028,
  dark = false,
}) => {
  const frame = useCurrentFrame();
  if (!GRAIN_ENABLED) return null;
  // Step grain every 4 frames at 120fps (= 30Hz film cadence)
  const bucket = Math.floor(frame / 4);
  const x = Math.floor(random(`gx-${bucket}`) * 256);
  const y = Math.floor(random(`gy-${bucket}`) * 256);
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `url(${staticFile('brand/noise.png')})`,
        backgroundSize: '256px 256px',
        backgroundPosition: `${x}px ${y}px`,
        opacity,
        mixBlendMode: dark ? 'screen' : 'multiply',
        pointerEvents: 'none',
      }}
    />
  );
};

export const Vignette: React.FC<{ strength?: number; color?: string }> = ({
  strength = 0.16,
  color = '28, 27, 24',
}) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(130% 100% at 50% 50%, transparent 56%, rgba(${color}, ${strength}) 100%)`,
      pointerEvents: 'none',
    }}
  />
);

/**
 * Warm Academic Editorial Stage (`#FAF8F3`) with ultra-subtle architectural grid hairlines
 * and ambient semantic tinting.
 */
export const IvoryStage: React.FC<{
  children?: React.ReactNode;
  glowColor?: string;
  glowPos?: string;
  showGrid?: boolean;
}> = ({ children, glowColor = 'rgba(46, 98, 74, 0.08)', glowPos = '72% 38%', showGrid = true }) => {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(95% 85% at ${glowPos}, ${glowColor} 0%, transparent 62%), radial-gradient(125% 100% at 50% 42%, ${C.paper} 0%, ${C.ivory} 62%, ${C.sand} 100%)`,
      }}
    >
      {showGrid && (
        <AbsoluteFill
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(28,27,24,0.032) 1px, transparent 1px), linear-gradient(to bottom, rgba(28,27,24,0.032) 1px, transparent 1px)',
            backgroundSize: '96px 96px',
            maskImage: 'radial-gradient(85% 80% at 50% 50%, black 25%, transparent 90%)',
            WebkitMaskImage: 'radial-gradient(85% 80% at 50% 50%, black 25%, transparent 90%)',
            pointerEvents: 'none',
          }}
        />
      )}
      {children}
      <Vignette strength={0.13} />
      <FilmGrain opacity={0.024} />
    </AbsoluteFill>
  );
};

/**
 * High-Contrast Dark Obsidian Cinema Stage (`#0B0E0D`) for technical/empirical showpieces.
 */
export const ObsidianStage: React.FC<{
  children?: React.ReactNode;
  primaryGlow?: string;
  secondaryGlow?: string;
  hudLabel?: string;
}> = ({
  children,
  primaryGlow = 'rgba(60, 224, 155, 0.15)',
  secondaryGlow = 'rgba(104, 66, 214, 0.12)',
  hudLabel,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const shiftX = Math.sin(t * 0.45) * 4;
  const shiftY = Math.cos(t * 0.35) * 3;

  return (
    <AbsoluteFill style={{ backgroundColor: C.obsidian, overflow: 'hidden' }}>
      {/* Ambient volumetric auroras */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(65% 58% at ${32 + shiftX}% ${36 + shiftY}%, ${primaryGlow} 0%, transparent 68%), radial-gradient(60% 55% at ${72 - shiftX}% ${66 - shiftY}%, ${secondaryGlow} 0%, transparent 68%)`,
          pointerEvents: 'none',
        }}
      />
      {/* Precision engineering coordinate grid */}
      <AbsoluteFill
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(235,245,240,0.045) 1px, transparent 1px), linear-gradient(to bottom, rgba(235,245,240,0.045) 1px, transparent 1px)',
          backgroundSize: '80px 80px',
          maskImage: 'radial-gradient(88% 82% at 50% 50%, black 20%, transparent 88%)',
          WebkitMaskImage: 'radial-gradient(88% 82% at 50% 50%, black 20%, transparent 88%)',
          pointerEvents: 'none',
        }}
      />
      {/* Subtle corner registration telemetry */}
      {hudLabel && (
        <div
          style={{
            position: 'absolute',
            left: 56,
            right: 56,
            bottom: 30,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontFamily: F.mono,
            fontSize: 13,
            letterSpacing: '0.18em',
            color: 'rgba(245,247,245,0.34)',
            textTransform: 'uppercase',
            pointerEvents: 'none',
          }}
        >
          <span>{hudLabel}</span>
          <span>CITRA v3.75.2 · 120 FPS TELEMETRY</span>
        </div>
      )}
      {children}
      <Vignette strength={0.42} color="0, 0, 0" />
      <FilmGrain opacity={0.022} dark />
    </AbsoluteFill>
  );
};

/**
 * Painterly brand artwork card with smooth slow optical zoom & glass specular rim.
 */
export const PainterlyPanel: React.FC<{
  src: string;
  style?: React.CSSProperties;
  radius?: number;
  zoomFrom?: number;
  zoomTo?: number;
}> = ({ src, style, radius = 28, zoomFrom = 1.12, zoomTo = 1.0 }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = clamp01(frame / Math.max(1, durationInFrames));
  const z = interpolate(progress, [0, 1], [zoomFrom, zoomTo]);

  return (
    <div
      style={{
        position: 'absolute',
        overflow: 'hidden',
        borderRadius: radius,
        boxShadow:
          '0 36px 80px -28px rgba(28, 27, 24, 0.26), inset 0 0 0 1px rgba(255, 255, 255, 0.5)',
        ...style,
      }}
    >
      <Img
        src={staticFile(`brand/${src}`)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${z})`,
        }}
      />
    </div>
  );
};
