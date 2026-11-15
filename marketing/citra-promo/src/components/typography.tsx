import React from 'react';
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, F } from '../theme';
import { assertSentientSafe, clamp01, easeOutQuart, sec } from './motion';

/** Current local scene time in exact seconds. */
export const useTime = (): number => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return frame / fps;
};

/** FPS-agnostic spring helper taking delay in seconds. */
export const useSpringSec = (
  delaySec = 0,
  config: Partial<{ damping: number; mass: number; stiffness: number; overshootClamping: boolean }> = {},
): number => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({
    frame: frame - sec(delaySec, fps),
    fps,
    config: { damping: 28, mass: 0.75, stiffness: 160, ...config },
  });
};

export const EyebrowTag: React.FC<{
  index?: string;
  label: string;
  delaySec?: number;
  accent?: string;
  dark?: boolean;
}> = ({ index, label, delaySec = 0.04, accent = C.forest, dark = false }) => {
  const p = useSpringSec(delaySec, { damping: 32, stiffness: 180 });
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        padding: '7px 16px 7px 12px',
        borderRadius: 999,
        background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,253,249,0.88)',
        border: `1px solid ${dark ? C.obsidianLine : C.lineStrong}`,
        boxShadow: dark ? '0 8px 24px rgba(0,0,0,0.35)' : '0 8px 24px -10px rgba(28,27,24,0.12)',
        fontFamily: F.mono,
        fontSize: 15,
        fontWeight: 600,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        opacity: clamp01(p * 1.2),
        transform: `translate3d(0, ${(1 - p) * 14}px, 0)`,
        width: 'fit-content',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: accent,
          boxShadow: `0 0 12px ${accent}`,
        }}
      />
      {index && <span style={{ color: accent }}>{index}</span>}
      {index && <span style={{ opacity: 0.35, color: dark ? C.obsidianInk : C.ink }}>·</span>}
      <span style={{ color: dark ? C.obsidianMuted : C.inkSoft }}>{label}</span>
    </div>
  );
};

/**
 * Word-by-word Keynote reveal in `Sentient` (`F.display`).
 * Automatically validates `assertSentientSafe(text)` so Vietnamese glyphs never break font metrics.
 * Prefix any word with `*` to highlight in `accent` color; use `\n` token for forced line break.
 */
export const KineticWords: React.FC<{
  text: string;
  delaySec?: number;
  staggerSec?: number;
  accent?: string;
  dark?: boolean;
  risePx?: number;
  style?: React.CSSProperties;
}> = ({
  text,
  delaySec = 0.08,
  staggerSec = 0.042,
  accent = C.forest,
  dark = false,
  risePx = 28,
  style,
}) => {
  assertSentientSafe(text);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tokens = text.split(' ');

  return (
    <span
      style={{
        fontFamily: F.display,
        fontWeight: 300,
        letterSpacing: '-0.028em',
        lineHeight: 1.04,
        color: dark ? C.obsidianInk : C.ink,
        display: 'inline',
        ...style,
      }}
    >
      {tokens.map((tok, i) => {
        if (tok === '\n' || tok === '\\n') return <br key={i} />;
        const p = spring({
          frame: frame - sec(delaySec + i * staggerSec, fps),
          fps,
          config: { damping: 30, mass: 0.65, stiffness: 190 },
        });
        const isAccent = tok.startsWith('*');
        const clean = isAccent ? tok.slice(1) : tok;
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              transform: `translate3d(0, ${(1 - p) * risePx}px, 0)`,
              opacity: clamp01(p * 1.15),
              color: isAccent ? accent : undefined,
              whiteSpace: 'pre',
            }}
          >
            {clean}
            {i < tokens.length - 1 && tokens[i + 1] !== '\n' && tokens[i + 1] !== '\\n' ? ' ' : ''}
          </span>
        );
      })}
    </span>
  );
};

/**
 * Vietnamese Editorial HUD Caption bar rendered strictly in `Plus Jakarta Sans` (`F.sans`)
 * with full Vietnamese diacritic support and glowing semantic indicator rail.
 */
export const EditorialCaptionVi: React.FC<{
  text: string;
  tag?: string;
  delaySec?: number;
  accent?: string;
  dark?: boolean;
  maxWidth?: number;
  fontSize?: number;
  align?: 'left' | 'center';
}> = ({
  text,
  tag,
  delaySec = 0.24,
  accent = C.forest,
  dark = false,
  maxWidth = 680,
  fontSize = 21,
  align = 'left',
}) => {
  const p = useSpringSec(delaySec, { damping: 32, stiffness: 165 });

  if (align === 'center') {
    return (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 14,
          padding: '12px 24px',
          borderRadius: 16,
          background: dark ? 'rgba(20, 26, 24, 0.78)' : 'rgba(255, 253, 249, 0.86)',
          border: `1px solid ${dark ? C.obsidianLine : C.line}`,
          boxShadow: dark
            ? '0 18px 40px -16px rgba(0,0,0,0.55)'
            : '0 16px 36px -18px rgba(28,27,24,0.16)',
          maxWidth,
          opacity: clamp01(p * 1.2),
          transform: `translate3d(0, ${(1 - p) * 16}px, 0)`,
        }}
      >
        {tag && (
          <span
            style={{
              padding: '4px 10px',
              borderRadius: 8,
              background: `${accent}1F`,
              color: accent,
              fontFamily: F.mono,
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '0.08em',
              whiteSpace: 'nowrap',
            }}
          >
            {tag}
          </span>
        )}
        <span
          style={{
            fontFamily: F.sans,
            fontSize,
            fontWeight: 500,
            lineHeight: 1.45,
            color: dark ? C.obsidianMuted : C.inkSoft,
          }}
        >
          {text}
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 16,
        maxWidth,
        opacity: clamp01(p * 1.2),
        transform: `translate3d(0, ${(1 - p) * 16}px, 0)`,
      }}
    >
      <div
        style={{
          width: 3.5,
          borderRadius: 4,
          background: accent,
          boxShadow: dark ? `0 0 14px ${accent}` : undefined,
          flexShrink: 0,
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {tag && (
          <span
            style={{
              fontFamily: F.mono,
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '0.12em',
              color: accent,
              textTransform: 'uppercase',
            }}
          >
            {tag}
          </span>
        )}
        <div
          style={{
            fontFamily: F.sans,
            fontSize,
            fontWeight: 500,
            lineHeight: 1.48,
            color: dark ? C.obsidianMuted : C.inkSoft,
          }}
        >
          {text}
        </div>
      </div>
    </div>
  );
};

/**
 * Reusable Keynote Bilingual Stage Header supporting `split` (compact horizontal top bar for
 * full-bleed UI dives), `left` (editorial stack), and `center` (hero monument).
 */
export const BilingualStageHeader: React.FC<{
  index: string;
  eyebrow: string;
  titleEn: string;
  captionVi: string;
  tagVi?: string;
  accent?: string;
  dark?: boolean;
  layout?: 'split' | 'stack' | 'center';
  titleSize?: number;
  style?: React.CSSProperties;
}> = ({
  index,
  eyebrow,
  titleEn,
  captionVi,
  tagVi,
  accent = C.forest,
  dark = false,
  layout = 'split',
  titleSize,
  style,
}) => {
  if (layout === 'split') {
    return (
      <div
        style={{
          position: 'absolute',
          left: 72,
          right: 72,
          top: 34,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 36,
          zIndex: 20,
          ...style,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11, maxWidth: 1120 }}>
          <EyebrowTag index={index} label={eyebrow} accent={accent} dark={dark} />
          <div style={{ fontSize: titleSize ?? 48 }}>
            <KineticWords text={titleEn} accent={accent} dark={dark} />
          </div>
        </div>
        <div style={{ paddingBottom: 2 }}>
          <EditorialCaptionVi
            text={captionVi}
            tag={tagVi}
            accent={accent}
            dark={dark}
            maxWidth={580}
            fontSize={18.5}
          />
        </div>
      </div>
    );
  }

  if (layout === 'center') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: 18,
          zIndex: 20,
          ...style,
        }}
      >
        <EyebrowTag index={index} label={eyebrow} accent={accent} dark={dark} />
        <div style={{ fontSize: titleSize ?? 66 }}>
          <KineticWords text={titleEn} accent={accent} dark={dark} />
        </div>
        <EditorialCaptionVi
          text={captionVi}
          tag={tagVi}
          accent={accent}
          dark={dark}
          align="center"
          maxWidth={980}
          fontSize={21}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 20,
        zIndex: 20,
        ...style,
      }}
    >
      <EyebrowTag index={index} label={eyebrow} accent={accent} dark={dark} />
      <div style={{ fontSize: titleSize ?? 64 }}>
        <KineticWords text={titleEn} accent={accent} dark={dark} />
      </div>
      <EditorialCaptionVi
        text={captionVi}
        tag={tagVi}
        accent={accent}
        dark={dark}
        maxWidth={540}
        fontSize={21}
      />
    </div>
  );
};

export const TechBadge: React.FC<{
  children: React.ReactNode;
  accent?: string;
  dark?: boolean;
  filled?: boolean;
  style?: React.CSSProperties;
}> = ({ children, accent = C.forest, dark = false, filled = false, style }) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 9,
      padding: '9px 18px',
      borderRadius: 999,
      background: filled ? accent : dark ? 'rgba(20, 26, 24, 0.88)' : C.paper,
      border: `1.5px solid ${filled ? accent : dark ? C.obsidianLine : C.lineStrong}`,
      color: filled ? '#FFFFFF' : dark ? C.obsidianInk : C.ink,
      fontFamily: F.mono,
      fontSize: 16,
      fontWeight: 600,
      letterSpacing: '0.03em',
      whiteSpace: 'nowrap',
      boxShadow: dark
        ? '0 14px 32px -12px rgba(0,0,0,0.6)'
        : '0 12px 28px -12px rgba(28,27,24,0.20)',
      ...style,
    }}
  >
    {children}
  </div>
);

export const MetricCounter: React.FC<{
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  delaySec?: number;
  durationSec?: number;
  accent?: string;
  dark?: boolean;
  fontSize?: number;
  useCommas?: boolean;
}> = ({
  value,
  decimals = 0,
  prefix = '',
  suffix = '',
  delaySec = 0.15,
  durationSec = 1.25,
  accent = C.forest,
  dark = false,
  fontSize = 96,
  useCommas = true,
}) => {
  assertSentientSafe(`${prefix}${suffix}`);
  const t = useTime();
  const p = easeOutQuart(clamp01((t - delaySec) / Math.max(0.1, durationSec)));
  const cur = value * p;
  const formatted =
    decimals > 0
      ? cur.toFixed(decimals)
      : useCommas
        ? Math.round(cur).toLocaleString('en-US')
        : String(Math.round(cur));

  return (
    <span
      style={{
        fontFamily: F.display,
        fontWeight: 300,
        fontSize,
        lineHeight: 1,
        letterSpacing: '-0.035em',
        color: dark ? C.obsidianInk : C.ink,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {prefix}
      {formatted}
      {suffix && <span style={{ color: accent }}>{suffix}</span>}
    </span>
  );
};
