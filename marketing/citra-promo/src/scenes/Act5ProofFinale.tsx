import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useVideoConfig } from 'remotion';
import { C, F } from '../theme';
import { IvoryStage, ObsidianStage, PainterlyPanel } from '../components/backdrops';
import { clamp01, easeOutQuart, smootherstep } from '../components/motion';
import {
  BilingualStageHeader,
  EyebrowTag,
  KineticWords,
  MetricCounter,
  TechBadge,
  useSpringSec,
  useTime,
} from '../components/typography';
import { ABLATION_BENCHMARK, ACT5_SCENES, ENGINEERING_SCALE } from './sceneData';

/* ============================================================================
 * SCENE 11 — 120,000-PAPER ABLATION ARENA (72.0s – 80.0s) · Dark Obsidian
 * ========================================================================== */
export const AblationScene: React.FC = () => {
  const t = useTime();
  const cardLeftP = useSpringSec(0.12, { damping: 26, stiffness: 150 });
  const kpi1P = useSpringSec(0.85, { damping: 24, stiffness: 165 });
  const kpi2P = useSpringSec(1.35, { damping: 24, stiffness: 165 });
  const kpi3P = useSpringSec(1.85, { damping: 24, stiffness: 165 });

  return (
    <ObsidianStage
      primaryGlow="rgba(60, 224, 155, 0.18)"
      secondaryGlow="rgba(155, 123, 255, 0.13)"
      hudLabel="ACT V · STRICT PAPER-DISJOINT EMPIRICAL BENCHMARK (TRAIN 84K · VAL 18K · HELD-OUT TEST 18K)"
    >
      <BilingualStageHeader
        index={ACT5_SCENES.ablation.index}
        eyebrow={ACT5_SCENES.ablation.eyebrow}
        titleEn={ACT5_SCENES.ablation.headlinesEn[0]}
        captionVi={ACT5_SCENES.ablation.captionVi}
        tagVi={ACT5_SCENES.ablation.tagVi}
        accent={C.emeraldGlow}
        dark
        layout="split"
        titleSize={47}
      />

      {/* Left Arena: Racing Horizontal Ablation Bars */}
      <div
        style={{
          position: 'absolute',
          left: 68,
          top: 214,
          width: 1124,
          padding: '28px 34px 30px',
          borderRadius: 24,
          background: 'rgba(18, 24, 22, 0.88)',
          border: `1.5px solid ${C.obsidianLine}`,
          boxShadow: '0 40px 90px -24px rgba(0,0,0,0.8)',
          opacity: clamp01(cardLeftP * 1.25),
          transform: `translate3d(0, ${(1 - cardLeftP) * 28}px, 0)`,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
            paddingBottom: 14,
            borderBottom: `1px solid ${C.obsidianLine}`,
          }}
        >
          <span
            style={{
              fontFamily: F.mono,
              fontSize: 13.5,
              fontWeight: 700,
              letterSpacing: '0.12em',
              color: C.emeraldGlow,
            }}
          >
            3-CLASS VERIFICATION ACCURACY · 120,000 DISTINCT PAPERS (0% LEAKAGE)
          </span>
          <span
            style={{
              padding: '4px 12px',
              borderRadius: 999,
              background: 'rgba(60, 224, 155, 0.14)',
              color: C.emeraldGlow,
              fontFamily: F.mono,
              fontSize: 12.5,
              fontWeight: 700,
            }}
          >
            +33.73% VS PURE SBERT
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 17 }}>
          {ABLATION_BENCHMARK.bars.map((bar, idx) => {
            const startAt = 0.32 + idx * 0.22;
            const fillP = easeOutQuart(clamp01((t - startAt) / 1.45));
            const curVal = (bar.acc * fillP).toFixed(2);

            return (
              <div key={bar.code} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span
                      style={{
                        padding: '2px 9px',
                        borderRadius: 6,
                        background: bar.hero ? 'rgba(60, 224, 155, 0.2)' : 'rgba(255,255,255,0.08)',
                        color: bar.hero ? C.emeraldGlow : C.obsidianMuted,
                        fontFamily: F.mono,
                        fontSize: 12.5,
                        fontWeight: 700,
                      }}
                    >
                      {bar.code}
                    </span>
                    <span
                      style={{
                        fontFamily: F.sans,
                        fontSize: bar.hero ? 18 : 16,
                        fontWeight: bar.hero ? 700 : 500,
                        color: bar.hero ? '#FFFFFF' : '#D2DDD7',
                      }}
                    >
                      {bar.label}
                    </span>
                    <span
                      style={{
                        fontFamily: F.mono,
                        fontSize: 12,
                        color: bar.hero ? C.emeraldGlow : C.obsidianMuted,
                      }}
                    >
                      — {bar.note}
                    </span>
                  </div>

                  <span
                    style={{
                      fontFamily: F.mono,
                      fontSize: bar.hero ? 22 : 17,
                      fontWeight: 700,
                      color: bar.hero ? C.emeraldGlow : C.obsidianInk,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {curVal}%
                  </span>
                </div>

                {/* Progress Track */}
                <div
                  style={{
                    height: bar.hero ? 18 : 12,
                    borderRadius: 999,
                    background: 'rgba(255, 255, 255, 0.07)',
                    overflow: 'hidden',
                    position: 'relative',
                  }}
                >
                  <div
                    style={{
                      width: `${bar.acc * fillP}%`,
                      height: '100%',
                      borderRadius: 999,
                      background:
                        bar.code === 'ML'
                          ? `linear-gradient(90deg, ${C.emeraldGlow} 0%, ${C.cyanBright} 100%)`
                          : bar.hero
                            ? `linear-gradient(90deg, #279E6D 0%, ${C.emeraldGlow} 100%)`
                            : bar.color,
                      boxShadow: bar.hero ? `0 0 22px ${C.emeraldGlow}88` : undefined,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right Arena: 3 Glowing Empirical Proof Monoliths */}
      <div
        style={{
          position: 'absolute',
          right: 68,
          top: 214,
          width: 628,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {/* Monolith 1: 100.0% Hallucination F1 · 0 False Accusations */}
        <div
          style={{
            padding: '24px 28px',
            borderRadius: 22,
            background: 'linear-gradient(155deg, rgba(22, 38, 31, 0.95) 0%, rgba(15, 22, 19, 0.95) 100%)',
            border: `1.5px solid ${C.emeraldGlow}77`,
            boxShadow: '0 28px 60px -20px rgba(0,0,0,0.75), 0 0 36px -14px rgba(60, 224, 155, 0.32)',
            opacity: clamp01(kpi1P * 1.25),
            transform: `translate3d(${(1 - kpi1P) * 38}px, 0, 0)`,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <MetricCounter
              value={ABLATION_BENCHMARK.hallucinationF1}
              decimals={1}
              suffix="%"
              delaySec={0.9}
              durationSec={1.2}
              accent={C.emeraldGlow}
              dark
              fontSize={74}
            />
            <span
              style={{
                padding: '6px 14px',
                borderRadius: 999,
                background: 'rgba(60, 224, 155, 0.16)',
                color: C.emeraldGlow,
                fontFamily: F.mono,
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              0 FALSE ACCUSATIONS
            </span>
          </div>
          <div
            style={{
              fontFamily: F.sans,
              fontSize: 18,
              fontWeight: 700,
              color: C.obsidianInk,
              marginTop: 8,
            }}
          >
            Hallucination Detection F1 ({ABLATION_BENCHMARK.hallucinationCaught} Caught)
          </div>
          <div style={{ fontFamily: F.sans, fontSize: 14.5, color: C.obsidianMuted, marginTop: 4 }}>
            Không kết oan bất kỳ bài báo khoa học hợp lệ nào trên tập kiểm thử độc lập.
          </div>
        </div>

        {/* Monolith 2: 0.0433 Platt Calibrated ECE */}
        <div
          style={{
            padding: '22px 28px',
            borderRadius: 22,
            background: 'rgba(18, 24, 22, 0.92)',
            border: `1.5px solid ${C.cyanBright}55`,
            boxShadow: '0 24px 52px -20px rgba(0,0,0,0.72)',
            opacity: clamp01(kpi2P * 1.25),
            transform: `translate3d(${(1 - kpi2P) * 38}px, 0, 0)`,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <MetricCounter
              value={ABLATION_BENCHMARK.plattEce}
              decimals={4}
              delaySec={1.4}
              durationSec={1.2}
              accent={C.cyanBright}
              dark
              fontSize={68}
            />
            <span
              style={{
                padding: '5px 12px',
                borderRadius: 999,
                background: 'rgba(56, 189, 248, 0.15)',
                color: C.cyanBright,
                fontFamily: F.mono,
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              ↓ 4.9× CALIBRATION ERROR
            </span>
          </div>
          <div
            style={{
              fontFamily: F.sans,
              fontSize: 17.5,
              fontWeight: 700,
              color: C.obsidianInk,
              marginTop: 6,
            }}
          >
            Platt-Scaled Expected Calibration Error (from 0.2124)
          </div>
          <div style={{ fontFamily: F.sans, fontSize: 14.5, color: C.obsidianMuted, marginTop: 3 }}>
            Điểm tin cậy phản ánh đúng xác suất thực nghiệm phục vụ ra quyết định.
          </div>
        </div>

        {/* Monolith 3: Paper-Disjoint Rigor */}
        <div
          style={{
            padding: '18px 28px',
            borderRadius: 20,
            background: 'rgba(18, 24, 22, 0.9)',
            border: `1px solid ${C.obsidianLine}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            opacity: clamp01(kpi3P * 1.25),
            transform: `translate3d(${(1 - kpi3P) * 38}px, 0, 0)`,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: F.mono,
                fontSize: 12.5,
                fontWeight: 700,
                color: C.violetBright,
                letterSpacing: '0.1em',
              }}
            >
              STRICT PAPER-DISJOINT PROTOCOL
            </div>
            <div
              style={{
                fontFamily: F.sans,
                fontSize: 16.5,
                fontWeight: 600,
                color: C.obsidianInk,
                marginTop: 4,
              }}
            >
              Train 84,000 · Val 18,000 · Held-Out Test 18,000
            </div>
          </div>
          <span
            style={{
              fontFamily: F.mono,
              fontSize: 15,
              fontWeight: 700,
              color: C.emeraldGlow,
            }}
          >
            0% OVERLAP
          </span>
        </div>
      </div>
    </ObsidianStage>
  );
};

/* ============================================================================
 * SCENE 12 — ENGINEERING SCALE MONUMENT (80.0s – 86.0s) · Swiss-Grid Ivory
 * ========================================================================== */
export const ScaleScene: React.FC = () => {
  const cards = [
    {
      num: ENGINEERING_SCALE.auditedPdfs,
      suffix: '',
      tag: 'REAL-WORLD CORPUS AUDIT',
      title: 'Real Academic PDFs Audited',
      descVi:
        '38.317 tài liệu tham khảo thực tế từ IEEE, Springer, ACM, Elsevier, MDPI & khóa luận VN — 100% HTTP 200 không sập luồng.',
      pills: ['38,317 Refs', '100% Zero-Crash', 'Multi-Publisher'],
      accent: C.forest,
    },
    {
      num: ENGINEERING_SCALE.locThousands,
      suffix: 'K+',
      tag: 'FULL-STACK CODEBASE',
      title: 'Lines of Production Code',
      descVi:
        'Kiến trúc phân tầng sạch: FastAPI bất đồng bộ, GROBID TEI, ONNX Cross-Lingual, SQLite FTS5 & React 18 TypeScript.',
      pills: ['Python FastAPI', 'React 18 + TS', 'ONNX Runtime'],
      accent: C.violet,
    },
    {
      num: ENGINEERING_SCALE.automatedTests,
      suffix: '+',
      tag: 'CONTINUOUS VERIFICATION',
      title: 'Automated Tests Passing',
      descVi:
        'Đảm bảo chất lượng phần mềm nghiêm ngặt qua Unit Test, Integration Test, Giao diện Vitest và kiểm thử đầu-cuối Playwright E2E.',
      pills: ['Pytest Suite', 'Vitest UI', 'Playwright E2E'],
      accent: C.forest,
    },
    {
      num: ENGINEERING_SCALE.ruleFamilies,
      prefix: 'R01–R',
      suffix: '',
      useCommas: false,
      tag: 'SYMBOLIC KNOWLEDGE BASE',
      title: 'Formal Rule Families & 12 Styles',
      descVi:
        '30 họ luật suy diễn hình thức (55+ mã lỗi chuyên sâu), 12 chuẩn trích dẫn quốc tế & văn bản quy phạm pháp luật Việt Nam.',
      pills: ['12 Citation Styles', '128K+ FTS5 Papers', 'VN Legal Statutes'],
      accent: C.amber,
    },
  ];

  return (
    <IvoryStage glowColor="rgba(46, 98, 74, 0.10)" glowPos="50% 48%">
      <PainterlyPanel
        src="pricing-floral.png"
        radius={0}
        style={{ inset: 0, opacity: 0.14 }}
      />

      <BilingualStageHeader
        index={ACT5_SCENES.scale.index}
        eyebrow={ACT5_SCENES.scale.eyebrow}
        titleEn={ACT5_SCENES.scale.headlinesEn[0]}
        captionVi={ACT5_SCENES.scale.captionVi}
        tagVi={ACT5_SCENES.scale.tagVi}
        accent={C.forest}
        layout="split"
        titleSize={48}
      />

      {/* 4-Column Architectural Swiss Monument Grid */}
      <div
        style={{
          position: 'absolute',
          left: 72,
          right: 72,
          top: 234,
          height: 726,
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 24,
        }}
      >
        {cards.map((c, idx) => {
          const p = useSpringSec(0.14 + idx * 0.12, { damping: 26, stiffness: 155 });
          return (
            <div
              key={c.tag}
              style={{
                padding: '38px 32px 34px',
                borderRadius: 26,
                background: 'rgba(255, 253, 249, 0.94)',
                border: `1.5px solid ${C.lineStrong}`,
                boxShadow: '0 34px 72px -26px rgba(28, 27, 24, 0.24)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                opacity: clamp01(p * 1.25),
                transform: `translate3d(0, ${(1 - p) * 34}px, 0)`,
              }}
            >
              <div>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    fontFamily: F.mono,
                    fontSize: 12.5,
                    fontWeight: 700,
                    letterSpacing: '0.12em',
                    color: c.accent,
                    marginBottom: 28,
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: c.accent,
                    }}
                  />
                  {c.tag}
                </div>

                <div>
                  <MetricCounter
                    value={c.num}
                    prefix={c.prefix ?? ''}
                    suffix={c.suffix}
                    useCommas={c.useCommas ?? true}
                    delaySec={0.2 + idx * 0.12}
                    durationSec={1.3}
                    accent={c.accent}
                    fontSize={c.prefix ? 86 : 104}
                  />
                </div>

                <div
                  style={{
                    fontFamily: F.sans,
                    fontSize: 23,
                    fontWeight: 700,
                    color: C.ink,
                    marginTop: 22,
                    lineHeight: 1.25,
                  }}
                >
                  {c.title}
                </div>

                <div
                  style={{
                    fontFamily: F.sans,
                    fontSize: 16.5,
                    fontWeight: 500,
                    color: C.muted,
                    lineHeight: 1.52,
                    marginTop: 14,
                  }}
                >
                  {c.descVi}
                </div>
              </div>

              {/* Bottom Engineering Breakdown Chips */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 8,
                  paddingTop: 20,
                  borderTop: `1px solid ${C.line}`,
                }}
              >
                {c.pills.map((pill) => (
                  <span
                    key={pill}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 999,
                      background: C.ivory,
                      border: `1px solid ${C.lineStrong}`,
                      fontFamily: F.mono,
                      fontSize: 12,
                      fontWeight: 600,
                      color: C.inkSoft,
                    }}
                  >
                    {pill}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </IvoryStage>
  );
};

/* ============================================================================
 * SCENE 13 — GRAND FINALE KEYNOTE LOCKUP (86.0s – 90.0s)
 * ========================================================================== */
export const EndCardScene: React.FC = () => {
  const t = useTime();
  const { durationInFrames, fps } = useVideoConfig();
  const totalSec = durationInFrames / fps;

  const logoP = useSpringSec(0.05, { damping: 20, mass: 0.8, stiffness: 150 });
  const wordP = useSpringSec(0.14, { damping: 26, stiffness: 165 });
  const viP = useSpringSec(0.55, { damping: 28, stiffness: 165 });
  const ctaP = useSpringSec(0.85, { damping: 22, stiffness: 170 });

  // Gentle clean resolve in the final 0.24s so frame 10799 rests gracefully
  const endFade = smootherstep(clamp01((t - (totalSec - 0.24)) / 0.24)) * 0.15;
  const bgScale = interpolate(t, [0, totalSec], [1.1, 1.01], { extrapolateRight: 'clamp' });

  return (
    <IvoryStage glowColor="rgba(46, 98, 74, 0.14)" glowPos="50% 45%" showGrid={false}>
      <AbsoluteFill style={{ transform: `scale(${bgScale})` }}>
        <Img
          src={staticFile('brand/hero-bg.png')}
          style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.9 }}
        />
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          background:
            'radial-gradient(64% 60% at 50% 48%, rgba(250, 248, 243, 0.96) 0%, rgba(250, 248, 243, 0.85) 52%, rgba(250, 248, 243, 0.30) 100%)',
        }}
      />

      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
        }}
      >
        <div style={{ marginBottom: 24 }}>
          <EyebrowTag label={ACT5_SCENES.endcard.eyebrow} delaySec={0.08} accent={C.forest} />
        </div>

        {/* 3D Specular CITRA Emblem + Wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
          <div
            style={{
              width: 140,
              height: 140,
              borderRadius: 34,
              background: 'linear-gradient(145deg, #FFFFFF 0%, #F3EFE5 100%)',
              boxShadow:
                '0 32px 64px -18px rgba(28, 27, 24, 0.34), 0 0 0 1.5px rgba(28, 27, 24, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transform: `scale(${logoP})`,
            }}
          >
            <Img src={staticFile('brand/citra-logo.png')} style={{ width: 96, height: 96 }} />
          </div>

          <div
            style={{
              fontFamily: F.sans,
              fontWeight: 700,
              fontSize: 176,
              letterSpacing: '-0.045em',
              lineHeight: 0.96,
              color: C.ink,
              opacity: clamp01(wordP * 1.25),
              transform: `translate3d(${(1 - wordP) * -24}px, 0, 0)`,
            }}
          >
            CITRA
          </div>
        </div>

        {/* English Keynote Motto */}
        <div style={{ marginTop: 30, fontSize: 66, textAlign: 'center' }}>
          <KineticWords
            text={ACT5_SCENES.endcard.headlinesEn[0]}
            delaySec={0.28}
            staggerSec={0.042}
            accent={C.forest}
          />
        </div>

        {/* Vietnamese Editorial Serif Subtitle (Source Serif 4 — full Vietnamese diacritics!) */}
        <div
          style={{
            marginTop: 14,
            fontFamily: F.serif,
            fontStyle: 'italic',
            fontWeight: 400,
            fontSize: 34,
            color: C.inkSoft,
            opacity: clamp01(viP * 1.25),
            transform: `translate3d(0, ${(1 - viP) * 14}px, 0)`,
          }}
        >
          {ACT5_SCENES.endcard.captionVi}
        </div>

        {/* Live Platform CTA Pill */}
        <div
          style={{
            marginTop: 42,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '18px 38px',
            borderRadius: 18,
            background: '#151B19',
            border: `1.5px solid ${C.emeraldGlow}`,
            color: '#FFFFFF',
            fontFamily: F.sans,
            fontSize: 28,
            fontWeight: 600,
            boxShadow: '0 32px 64px -22px rgba(0, 0, 0, 0.58)',
            opacity: clamp01(ctaP * 1.25),
            transform: `scale(${0.88 + 0.12 * ctaP})`,
          }}
        >
          <span>Experience CITRA Live</span>
          <span style={{ opacity: 0.4 }}>—</span>
          <span style={{ fontFamily: F.mono, fontWeight: 600, color: C.emeraldGlow }}>
            citra.io.vn
          </span>
        </div>
      </AbsoluteFill>

      {/* Graduation Thesis Committee Footer */}
      <div
        style={{
          position: 'absolute',
          bottom: 38,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontFamily: F.mono,
          fontSize: 15.5,
          fontWeight: 600,
          letterSpacing: '0.18em',
          color: C.muted,
        }}
      >
        SOFTWARE ENGINEERING GRADUATION THESIS · TON DUC THANG UNIVERSITY · 2026
      </div>

      {endFade > 0.005 && (
        <AbsoluteFill
          style={{ background: C.ivory, opacity: endFade, pointerEvents: 'none' }}
        />
      )}
    </IvoryStage>
  );
};
