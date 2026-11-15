import React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  random,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import timeline from '../timeline.json';
import { C, F } from '../theme';
import { IvoryStage, ObsidianStage, PainterlyPanel } from '../components/backdrops';
import { clamp01, easeOutExpo, easeOutQuart, smootherstep } from '../components/motion';
import {
  EditorialCaptionVi,
  EyebrowTag,
  KineticWords,
  TechBadge,
  useSpringSec,
  useTime,
} from '../components/typography';
import { ACT1_SCENES } from './sceneData';

const CIT_A = '[1] Vaswani, A., et al. (2017). Attention Is All You Need. NeurIPS 30.';
const CIT_B = '[2] Mehra, M. R., et al. (2020). Hydroxychloroquine in COVID-19. The Lancet.';
const CIT_C = '[3] Kowalski, M. (2024). Quantum Hyper-Graph Reasoning. doi:10.9999/fake.2024';

const typedSlice = (t: number, startSec: number, cps: number, text: string): string => {
  const count = Math.floor((t - startSec) * cps);
  return text.slice(0, Math.max(0, Math.min(text.length, count)));
};

const VerdictChip: React.FC<{
  appearSec: number;
  color: string;
  bg: string;
  children: React.ReactNode;
}> = ({ appearSec, color, bg, children }) => {
  const p = useSpringSec(appearSec, { damping: 18, mass: 0.65, stiffness: 210 });
  if (p <= 0.005) return null;
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        marginTop: 10,
        padding: '7px 16px',
        borderRadius: 9,
        background: bg,
        border: `1.5px solid ${color}`,
        boxShadow: `0 0 24px -6px ${color}66`,
        color,
        fontFamily: F.mono,
        fontSize: 15.5,
        fontWeight: 600,
        letterSpacing: '0.07em',
        opacity: clamp01(p * 1.35),
        transform: `translate3d(${(1 - p) * -14}px, 0, 0) scale(${0.86 + 0.14 * p})`,
      }}
    >
      {children}
    </div>
  );
};

/* ============================================================================
 * SCENE 01 — HOOK (00.0s – 10.0s) · Dark Obsidian 3D Manuscript Laser Scanner
 * ========================================================================== */
export const HookScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const sA = timeline.sfx.typeA;
  const sB = timeline.sfx.typeB;
  const sC = timeline.sfx.typeC;
  const glitchAt = timeline.sfx.glitch;

  const aText = typedSlice(t, sA.start, sA.cps, CIT_A);
  const bText = typedSlice(t, sB.start, sB.cps, CIT_B);
  const cText = typedSlice(t, sC.start, sC.cps, CIT_C);
  const caretOn = Math.floor(t * 3.5) % 2 === 0;

  // Optical laser Y position sweeping seamlessly across the 3 citation rows
  const laserProgress = clamp01((t - 0.25) / 5.1);
  const laserY = interpolate(laserProgress, [0, 0.32, 0.64, 1], [110, 205, 365, 520], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const laserOpacity = clamp01((t - 0.2) / 0.25) * (1 - clamp01((t - 5.65) / 0.4));

  // Chromatic aberration glitch on Citation [3] (snappy 0.26s burst, then razor-sharp crimson)
  const inGlitch = t >= glitchAt && t < glitchAt + 0.26;
  const gBucket = Math.floor(frame / 3);
  const gx = inGlitch ? (random(`hk-gx-${gBucket}`) - 0.5) * 26 : 0;
  const isHallucinated = t >= glitchAt + 0.08;
  const strikeP = smootherstep(clamp01((t - (glitchAt + 0.16)) / 0.34));

  // 3D Manuscript camera entrance & fly-through at 6.15s -> 6.68s
  const cardEnter = useSpringSec(0.05, { damping: 26, stiffness: 135 });
  const flyThrough = smootherstep(clamp01((t - 6.12) / 0.56));
  const rotX = interpolate(t, [0, 6.2], [7.5, 2.0], { extrapolateRight: 'clamp' });
  const rotY = interpolate(t, [0, 6.2], [-6.5, 1.5], { extrapolateRight: 'clamp' });
  const cardScale = (0.92 + 0.08 * cardEnter) * (1 + flyThrough * 0.42);
  const cardOpacity = clamp01(cardEnter * 1.3) * (1 - flyThrough);

  // Keynote Statement Stage (6.40s -> 10.0s)
  const stmtPhase1Visible = t >= 6.36 && t < 8.62;
  const stmtPhase1Exit = smootherstep(clamp01((t - 8.28) / 0.32));
  const stmtPhase2Visible = t >= 8.44;
  const stmtPhase2Zoom = easeOutQuart(clamp01((t - 8.44) / 1.55));

  // Optical Iris Bloom into Warm Ivory at 9.76s -> 10.0s
  const irisP = easeOutExpo(clamp01((t - 9.74) / 0.26));

  return (
    <ObsidianStage
      primaryGlow={isHallucinated ? 'rgba(242, 85, 73, 0.17)' : 'rgba(60, 224, 155, 0.14)'}
      secondaryGlow="rgba(56, 189, 248, 0.11)"
      hudLabel="ACT I · OPTICAL CITATION FORENSICS"
    >
      {/* Top Precision Telemetry Bar */}
      <div
        style={{
          position: 'absolute',
          left: 64,
          right: 64,
          top: 38,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          opacity: 1 - flyThrough * 0.85,
          fontFamily: F.mono,
          fontSize: 14,
          letterSpacing: '0.14em',
          color: C.obsidianMuted,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: isHallucinated ? C.redBright : C.emeraldGlow,
              boxShadow: `0 0 14px ${isHallucinated ? C.redBright : C.emeraldGlow}`,
            }}
          />
          <span>LIVE BIBLIOGRAPHY SCANNER · STREAM #033</span>
        </div>
        <div style={{ display: 'flex', gap: 28 }}>
          <span>INDEXES: 15+ EXTERNAL + 128K LOCAL</span>
          <span style={{ color: isHallucinated ? C.redBright : C.emeraldGlow }}>
            {isHallucinated ? 'ALERT: FABRICATED DOI DETECTED' : 'STATUS: SCANNING MANUSCRIPT'}
          </span>
        </div>
      </div>

      {/* 3D Floating Obsidian Manuscript Card */}
      {cardOpacity > 0.004 && (
        <AbsoluteFill
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            perspective: 2400,
          }}
        >
          <div
            style={{
              position: 'relative',
              width: 1560,
              padding: '46px 68px 54px',
              borderRadius: 26,
              background:
                'linear-gradient(165deg, rgba(24, 31, 28, 0.94) 0%, rgba(13, 17, 16, 0.96) 100%)',
              border: `1.5px solid ${isHallucinated ? 'rgba(242, 85, 73, 0.35)' : C.obsidianLine}`,
              boxShadow: isHallucinated
                ? '0 60px 130px -30px rgba(0,0,0,0.82), 0 0 70px -20px rgba(242, 85, 73, 0.28)'
                : '0 60px 130px -30px rgba(0,0,0,0.82), 0 0 60px -22px rgba(60, 224, 155, 0.18)',
              opacity: cardOpacity,
              transform: `scale(${cardScale}) rotateX(${rotX}deg) rotateY(${rotY}deg)`,
              filter: flyThrough > 0.02 ? `blur(${(flyThrough * 16).toFixed(1)}px)` : undefined,
              overflow: 'hidden',
            }}
          >
            {/* Sweeping Volumetric Optical Laser Line */}
            {laserOpacity > 0.01 && (
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: laserY,
                  height: 2,
                  background: `linear-gradient(90deg, transparent 0%, ${
                    isHallucinated ? C.redBright : C.emeraldGlow
                  } 20%, #FFFFFF 50%, ${
                    isHallucinated ? C.redBright : C.emeraldGlow
                  } 80%, transparent 100%)`,
                  boxShadow: `0 0 28px 6px ${isHallucinated ? C.redBright : C.emeraldGlow}`,
                  opacity: laserOpacity,
                  pointerEvents: 'none',
                }}
              />
            )}

            {/* Manuscript Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingBottom: 22,
                marginBottom: 26,
                borderBottom: `1px solid ${C.obsidianLine}`,
                fontFamily: F.mono,
                fontSize: 15,
                letterSpacing: '0.16em',
                color: C.obsidianMuted,
              }}
            >
              <span>SECTION 7 · REFERENCES & BIBLIOGRAPHY</span>
              <span>graduation_thesis_se_2026.pdf · p. 78</span>
            </div>

            {/* Citation [1] — Verified */}
            <div style={{ minHeight: 112, marginBottom: 22 }}>
              <div
                style={{
                  fontFamily: F.serif,
                  fontSize: 33,
                  lineHeight: 1.35,
                  color: C.obsidianInk,
                }}
              >
                {aText}
                {aText.length < CIT_A.length && t >= sA.start - 0.15 && (
                  <span style={{ opacity: caretOn ? 1 : 0, color: C.emeraldGlow }}>▋</span>
                )}
              </div>
              <VerdictChip appearSec={1.72} color={C.emeraldGlow} bg="rgba(60, 224, 155, 0.12)">
                ✓ VERIFIED · CROSSREF + OPENALEX + ARXIV · 12ms
              </VerdictChip>
            </div>

            {/* Citation [2] — Retracted Paper */}
            <div style={{ minHeight: 112, marginBottom: 22 }}>
              <div
                style={{
                  fontFamily: F.serif,
                  fontSize: 33,
                  lineHeight: 1.35,
                  color: t >= 3.4 ? '#FDE68A' : C.obsidianInk,
                }}
              >
                {bText}
                {bText.length < CIT_B.length && t >= sB.start - 0.1 && (
                  <span style={{ opacity: caretOn ? 1 : 0, color: C.amberBright }}>▋</span>
                )}
              </div>
              <VerdictChip appearSec={3.42} color={C.amberBright} bg="rgba(246, 173, 60, 0.13)">
                ⚠ OFFICIALLY RETRACTED · RETRACTION WATCH DATABASE
              </VerdictChip>
            </div>

            {/* Citation [3] — Fabricated AI Hallucination */}
            <div style={{ minHeight: 116, position: 'relative' }}>
              <div
                style={{
                  position: 'relative',
                  fontFamily: F.serif,
                  fontSize: 33,
                  lineHeight: 1.35,
                }}
              >
                {inGlitch && (
                  <>
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        color: C.cyanBright,
                        transform: `translateX(${gx + 7}px)`,
                        opacity: 0.78,
                      }}
                    >
                      {cText}
                    </div>
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        color: C.redBright,
                        transform: `translateX(${-gx - 7}px)`,
                        opacity: 0.82,
                      }}
                    >
                      {cText}
                    </div>
                  </>
                )}
                <span
                  style={{
                    position: 'relative',
                    color: isHallucinated ? C.redBright : C.obsidianInk,
                    display: 'inline-block',
                    transform: `translateX(${gx * 0.35}px)`,
                  }}
                >
                  {cText}
                </span>
                {cText.length < CIT_C.length && t >= sC.start - 0.1 && (
                  <span style={{ opacity: caretOn ? 1 : 0, color: C.redBright }}>▋</span>
                )}
                {isHallucinated && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: '52%',
                      height: 3.5,
                      width: `${strikeP * 96}%`,
                      background: C.redBright,
                      boxShadow: `0 0 16px ${C.redBright}`,
                      borderRadius: 2,
                    }}
                  />
                )}
              </div>
              <VerdictChip appearSec={glitchAt + 0.22} color={C.redBright} bg="rgba(242, 85, 73, 0.15)">
                ✕ AI HALLUCINATION · R-FABRICATED-DOI · 0 / 15+ SCHOLARLY INDEXES
              </VerdictChip>
            </div>
          </div>
        </AbsoluteFill>
      )}

      {/* Keynote Bilingual Statement Phase 1 (6.36s – 8.60s) */}
      {stmtPhase1Visible && (
        <AbsoluteFill
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 22,
            opacity: 1 - stmtPhase1Exit,
            transform: `translate3d(0, ${-stmtPhase1Exit * 26}px, 0) scale(${1 + stmtPhase1Exit * 0.04})`,
            filter: stmtPhase1Exit > 0.02 ? `blur(${(stmtPhase1Exit * 10).toFixed(1)}px)` : undefined,
          }}
        >
          <EyebrowTag
            label={ACT1_SCENES.hook.eyebrow}
            delaySec={6.38}
            accent={C.redBright}
            dark
          />
          <div style={{ textAlign: 'center', fontSize: 88, maxWidth: 1560, lineHeight: 1.08 }}>
            <div>
              <KineticWords
                text={ACT1_SCENES.hook.headlinesEn[0]}
                delaySec={6.42}
                staggerSec={0.045}
                dark
              />
            </div>
            <div style={{ marginTop: 8 }}>
              <KineticWords
                text={ACT1_SCENES.hook.headlinesEn[1]}
                delaySec={7.05}
                staggerSec={0.055}
                accent={C.redBright}
                dark
              />
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <EditorialCaptionVi
              text={ACT1_SCENES.hook.captionVi}
              tag={ACT1_SCENES.hook.tagVi}
              delaySec={7.35}
              accent={C.redBright}
              dark
              align="center"
              maxWidth={1120}
              fontSize={22}
            />
          </div>
        </AbsoluteFill>
      )}

      {/* Keynote Climax Question Phase 2 (8.44s – 10.0s) */}
      {stmtPhase2Visible && (
        <AbsoluteFill
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 24,
            transform: `scale(${1 + stmtPhase2Zoom * 0.085})`,
          }}
        >
          <div style={{ fontSize: 112, textAlign: 'center' }}>
            <KineticWords
              text={ACT1_SCENES.hook.headlinesEn[2]}
              delaySec={8.48}
              staggerSec={0.055}
              accent={C.emeraldGlow}
              dark
            />
          </div>
          <EditorialCaptionVi
            text="Ai sẽ kiểm chứng sự thật học thuật trước Hội đồng?"
            tag="CÂU HỎI CỐT LÕI"
            delaySec={8.72}
            accent={C.emeraldGlow}
            dark
            align="center"
            fontSize={23}
          />
        </AbsoluteFill>
      )}

      {/* Optical Iris Bloom Portal into Scene 02 */}
      {irisP > 0.005 && (
        <AbsoluteFill
          style={{
            background: `radial-gradient(circle at 50% 50%, #FFFFFF 0%, ${C.ivory} ${Math.round(
              irisP * 75,
            )}%, rgba(250,248,243,0) ${Math.round(irisP * 125 + 10)}%)`,
            opacity: irisP,
            pointerEvents: 'none',
          }}
        />
      )}
    </ObsidianStage>
  );
};

/* ============================================================================
 * SCENE 02 — BRAND REVEAL (10.0s – 16.0s) · Optical Iris & 3D Brand Emblem
 * ========================================================================== */
export const RevealScene: React.FC = () => {
  const t = useTime();
  const logoSpring = useSpringSec(0.06, { damping: 20, mass: 0.78, stiffness: 150 });
  const wordSpring = useSpringSec(0.16, { damping: 28, mass: 0.75, stiffness: 165 });
  const badgeSpring = useSpringSec(0.56, { damping: 26, stiffness: 170 });
  const initialBloomOut = 1 - smootherstep(clamp01(t / 0.36));

  const letters = 'CITRA'.split('');
  const archPills = [
    { label: 'v3.75.2 RELEASE', filled: true },
    { label: 'NEURO-SYMBOLIC AI', filled: false },
    { label: '15+ SCHOLARLY INDEXES', filled: false },
    { label: 'R01–R30 EXPLAINABLE RULES', filled: false },
  ];

  return (
    <IvoryStage glowColor="rgba(46, 98, 74, 0.14)" glowPos="50% 44%" showGrid={false}>
      {/* Multi-plane Painterly Depth Backdrop */}
      <PainterlyPanel
        src="feature-2-bg.png"
        zoomFrom={1.14}
        zoomTo={1.02}
        radius={0}
        style={{ inset: 0, opacity: 0.88 }}
      />
      <PainterlyPanel
        src="hero-bg.png"
        zoomFrom={1.08}
        zoomTo={1.0}
        radius={0}
        style={{ inset: 0, opacity: 0.36, mixBlendMode: 'multiply' }}
      />
      {/* Luminous Warm Ivory Editorial Veil for 100% Razor-Sharp Legibility */}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(64% 58% at 50% 48%, rgba(250, 248, 243, 0.95) 0%, rgba(250, 248, 243, 0.82) 52%, rgba(250, 248, 243, 0.25) 100%)',
        }}
      />

      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
        }}
      >
        {/* Top Eyebrow */}
        <div style={{ marginBottom: 26 }}>
          <EyebrowTag
            label={ACT1_SCENES.reveal.eyebrow}
            delaySec={0.14}
            accent={C.forest}
          />
        </div>

        {/* 3D Glass Emblem + Kinetic Wordmark Lockup */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 38 }}>
          <div
            style={{
              width: 168,
              height: 168,
              borderRadius: 42,
              background: 'linear-gradient(145deg, #FFFFFF 0%, #F4F0E6 100%)',
              boxShadow:
                '0 38px 75px -20px rgba(28, 27, 24, 0.34), 0 0 0 1.5px rgba(28, 27, 24, 0.08), inset 0 2px 4px rgba(255,255,255,0.9)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transform: `scale(${logoSpring}) rotate(${(1 - logoSpring) * -18}deg)`,
            }}
          >
            <Img src={staticFile('brand/citra-logo.png')} style={{ width: 116, height: 116 }} />
          </div>

          <div style={{ display: 'flex', overflow: 'hidden', padding: '4px 8px 12px 0' }}>
            {letters.map((ch, idx) => {
              const p = clamp01(wordSpring * 1.45 - idx * 0.1);
              const eased = smootherstep(p);
              return (
                <span
                  key={idx}
                  style={{
                    fontFamily: F.sans,
                    fontWeight: 700,
                    fontSize: 204,
                    letterSpacing: '-0.045em',
                    lineHeight: 0.96,
                    color: C.ink,
                    display: 'inline-block',
                    transform: `translate3d(0, ${(1 - eased) * 108}%, 0)`,
                    opacity: eased,
                  }}
                >
                  {ch}
                </span>
              );
            })}
          </div>
        </div>

        {/* Keynote English Motto */}
        <div style={{ marginTop: 30, fontSize: 72, textAlign: 'center' }}>
          <KineticWords
            text={ACT1_SCENES.reveal.headlinesEn[0]}
            delaySec={0.52}
            staggerSec={0.048}
            accent={C.forest}
          />
        </div>

        {/* Vietnamese Editorial HUD Subtitle */}
        <div style={{ marginTop: 22 }}>
          <EditorialCaptionVi
            text={ACT1_SCENES.reveal.captionVi}
            tag={ACT1_SCENES.reveal.tagVi}
            delaySec={0.78}
            accent={C.forest}
            align="center"
            maxWidth={1060}
            fontSize={22}
          />
        </div>

        {/* Architecture Capability Pills */}
        <div
          style={{
            marginTop: 32,
            display: 'flex',
            gap: 14,
            opacity: clamp01(badgeSpring * 1.25),
            transform: `translate3d(0, ${(1 - badgeSpring) * 16}px, 0)`,
          }}
        >
          {archPills.map((pill) => (
            <TechBadge
              key={pill.label}
              accent={C.forest}
              filled={pill.filled}
              style={{ fontSize: 14.5, padding: '8px 18px' }}
            >
              {pill.label}
            </TechBadge>
          ))}
        </div>
      </AbsoluteFill>

      {/* Initial Sub-Drop White Flash Decay */}
      {initialBloomOut > 0.01 && (
        <AbsoluteFill
          style={{
            background: '#FFFFFF',
            opacity: initialBloomOut * 0.85,
            pointerEvents: 'none',
          }}
        />
      )}
    </IvoryStage>
  );
};
