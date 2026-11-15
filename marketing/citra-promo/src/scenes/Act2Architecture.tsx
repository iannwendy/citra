import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, F } from '../theme';
import { IvoryStage, ObsidianStage, PainterlyPanel } from '../components/backdrops';
import { CinemaBrowser, ZoomShot3D } from '../components/CinemaBrowser';
import { clamp01, easeOutQuart, lerp, smootherstep } from '../components/motion';
import {
  BilingualStageHeader,
  TechBadge,
  useSpringSec,
  useTime,
} from '../components/typography';
import { ACT2_SCENES, PIPELINE_STAGES, SCHOLARLY_APIS } from './sceneData';

const N = 0.625;

/* ============================================================================
 * SCENE 03 — INGEST & L1 LINKER (16.0s – 22.0s) · Isometric Split Stage
 * ========================================================================== */
const FileDropOverlay: React.FC<{ map: (ix: number, iy: number) => [number, number] }> = ({
  map,
}) => {
  const t = useTime();
  if (t < 0.22 || t > 1.85) return null;
  const moveP = easeOutQuart(clamp01((t - 0.25) / 0.95));
  const absorbP = smootherstep(clamp01((t - 1.38) / 0.35));
  const [x0, y0] = map(0.92, 0.86);
  const [x1, y1] = map(0.58, 0.6);
  const x = lerp(x0, x1, moveP);
  const y = lerp(y0, y1, moveP);

  return (
    <div
      style={{
        position: 'absolute',
        left: x - 148,
        top: y - 42,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '12px 20px',
        borderRadius: 14,
        background: C.paper,
        border: `1.5px solid ${C.forest}`,
        boxShadow: '0 28px 56px -18px rgba(28, 27, 24, 0.42)',
        transform: `rotate(${(1 - moveP) * 7 - 2}deg) scale(${1 - absorbP * 0.42})`,
        opacity: clamp01((t - 0.22) / 0.16) * (1 - absorbP),
        zIndex: 24,
      }}
    >
      <div
        style={{
          width: 38,
          height: 46,
          borderRadius: 7,
          background: C.redSoft,
          border: `1.8px solid ${C.red}`,
          color: C.red,
          fontFamily: F.mono,
          fontSize: 11.5,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
          paddingBottom: 5,
        }}
      >
        PDF
      </div>
      <div>
        <div style={{ fontFamily: F.sans, fontSize: 17, fontWeight: 700, color: C.ink }}>
          thesis_se_tdtu_2026.pdf
        </div>
        <div style={{ fontFamily: F.mono, fontSize: 12, color: C.forest }}>
          2-Column Academic · 38 Refs
        </div>
      </div>
    </div>
  );
};

export const IngestScene: React.FC = () => {
  const t = useTime();
  const browserEnter = useSpringSec(0.08, { damping: 26, stiffness: 145 });
  const cardAEnter = useSpringSec(0.45, { damping: 25, stiffness: 165 });
  const cardBEnter = useSpringSec(1.75, { damping: 25, stiffness: 165 });

  const stylesList = [
    'APA 7th',
    'IEEE',
    'Vancouver',
    'Harvard / TDTU',
    'ACM',
    'Springer',
    'VN Legal Statutes',
    '+6 Styles',
  ];

  return (
    <IvoryStage glowColor="rgba(46, 98, 74, 0.11)" glowPos="34% 58%">
      <PainterlyPanel
        src="feature-1-bg.png"
        style={{ left: 52, top: 208, width: 520, height: 790, opacity: 0.34 }}
      />

      <BilingualStageHeader
        index={ACT2_SCENES.ingest.index}
        eyebrow={ACT2_SCENES.ingest.eyebrow}
        titleEn={ACT2_SCENES.ingest.headlinesEn[0]}
        captionVi={ACT2_SCENES.ingest.captionVi}
        tagVi={ACT2_SCENES.ingest.tagVi}
        accent={C.forest}
        layout="split"
        titleSize={48}
      />

      {/* Left-Center Isometric 3D CinemaBrowser */}
      <div
        style={{
          position: 'absolute',
          left: 72,
          top: 214,
          opacity: clamp01(browserEnter * 1.2),
          transform: `translate3d(0, ${(1 - browserEnter) * 34}px, 0)`,
        }}
      >
        <CinemaBrowser
          width={1110}
          contentHeight={732}
          url={t < 2.75 ? 'citra.io.vn/upload' : 'citra.io.vn/verification/report/33/consistency'}
          statusLabel={t < 2.75 ? 'GROBID TEI-XML READY' : 'L1 BIPARTITE LINKED'}
          cams={[
            { t: 0, cx: 0.5, cy: 0.5, w: 1, rotX: 4.5, rotY: 8.5, rotZ: -0.8 },
            { t: 2.8, cx: 0.5, cy: 0.5, w: 1, rotX: 2.5, rotY: 5.5, rotZ: -0.4 },
            { t: 6.0, cx: 0.5, cy: 0.5, w: 1, rotX: 1.5, rotY: 3.5, rotZ: 0 },
          ]}
        >
          <ZoomShot3D
            width={1110}
            height={732}
            shots={[
              { src: 'upload', aspect: N, fromSec: 0, toSec: 2.75 },
              { src: 'report-consistency', aspect: N, fromSec: 2.75 },
            ]}
            cams={[
              { t: 0, cx: 0.58, cy: 0.52, w: 0.86 },
              { t: 2.6, cx: 0.58, cy: 0.58, w: 0.74 },
              { t: 3.1, cx: 0.59, cy: 0.52, w: 0.82 },
              { t: 6.0, cx: 0.6, cy: 0.57, w: 0.74 },
            ]}
            cursor={[
              { t: 0.3, x: 0.9, y: 0.85 },
              { t: 1.25, x: 0.58, y: 0.6, click: true },
              { t: 2.4, x: 0.68, y: 0.68 },
            ]}
            renderOverlay={(map) => <FileDropOverlay map={map} />}
          />
        </CinemaBrowser>
      </div>

      {/* Right Spatial Telemetry Stack: GROBID TEI-XML + Layer 1 Bidirectional Linker */}
      <div
        style={{
          position: 'absolute',
          right: 72,
          top: 218,
          width: 616,
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        }}
      >
        {/* Card A — GROBID 0.9.1-crf TEI-XML Segmentation */}
        <div
          style={{
            padding: '26px 28px',
            borderRadius: 22,
            background: 'rgba(255, 253, 249, 0.94)',
            border: `1.5px solid ${C.lineStrong}`,
            boxShadow: '0 32px 68px -22px rgba(28, 27, 24, 0.24)',
            opacity: clamp01(cardAEnter * 1.2),
            transform: `translate3d(${(1 - cardAEnter) * 40}px, 0, 0)`,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 14,
            }}
          >
            <span
              style={{
                fontFamily: F.mono,
                fontSize: 13.5,
                fontWeight: 700,
                letterSpacing: '0.1em',
                color: C.forest,
              }}
            >
              STAGE 01 · GROBID 0.9.1-crf TEI-XML
            </span>
            <span
              style={{
                padding: '3px 10px',
                borderRadius: 999,
                background: C.mint,
                color: C.forest,
                fontFamily: F.mono,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              OCR + TCVN3/VNI READY
            </span>
          </div>

          <div
            style={{
              padding: '16px 18px',
              borderRadius: 14,
              background: '#141917',
              color: '#E6F2EC',
              fontFamily: F.mono,
              fontSize: 13.5,
              lineHeight: 1.62,
              border: '1px solid rgba(60, 224, 155, 0.22)',
            }}
          >
            <div style={{ color: '#9BA8A1' }}>{'<biblStruct xml:id="b14" status="parsed">'}</div>
            <div style={{ paddingLeft: 18 }}>
              <span style={{ color: C.emeraldGlow }}>{'<title>'}</span>
              Attention Is All You Need
              <span style={{ color: C.emeraldGlow }}>{'</title>'}</span>
            </div>
            <div style={{ paddingLeft: 18 }}>
              <span style={{ color: C.cyanBright }}>{'<author>'}</span>
              Vaswani, A. · Shazeer, N.
              <span style={{ color: C.cyanBright }}>{'</author>'}</span>
            </div>
            <div style={{ paddingLeft: 18 }}>
              <span style={{ color: C.amberBright }}>{'<idno type="DOI">'}</span>
              10.48550/arXiv.1706.03762
              <span style={{ color: C.amberBright }}>{'</idno>'}</span>
            </div>
            <div style={{ color: '#9BA8A1' }}>{'</biblStruct>'}</div>
          </div>

          <div
            style={{
              marginTop: 14,
              fontFamily: F.sans,
              fontSize: 16,
              fontWeight: 500,
              color: C.inkSoft,
            }}
          >
            Tách cấu trúc tự động PDF 2 cột IEEE/Springer, .docx, .bib & .ris.
          </div>
        </div>

        {/* Card B — Layer 1 Bidirectional Consistency & 12 Citation Styles */}
        <div
          style={{
            padding: '26px 28px',
            borderRadius: 22,
            background: 'rgba(255, 253, 249, 0.96)',
            border: `1.5px solid ${C.forest}44`,
            boxShadow: '0 34px 72px -22px rgba(28, 27, 24, 0.26)',
            opacity: clamp01(cardBEnter * 1.2),
            transform: `translate3d(${(1 - cardBEnter) * 40}px, 0, 0)`,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 14,
            }}
          >
            <span
              style={{
                fontFamily: F.mono,
                fontSize: 13.5,
                fontWeight: 700,
                letterSpacing: '0.1em',
                color: C.forest,
              }}
            >
              LAYER 1 · BIDIRECTIONAL CONSISTENCY
            </span>
            <span
              style={{
                fontFamily: F.mono,
                fontSize: 12.5,
                fontWeight: 700,
                color: C.forest,
              }}
            >
              12 STYLES + VN LEGAL
            </span>
          </div>

          {/* Animated In-Text <-> Bibliography Bridge */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 18px',
              borderRadius: 14,
              background: C.ivory,
              border: `1px solid ${C.line}`,
              marginBottom: 16,
              fontFamily: F.mono,
              fontSize: 13.5,
            }}
          >
            <span style={{ color: C.ink, fontWeight: 600 }}>In-Text: (Vaswani, 2017)</span>
            <span
              style={{
                padding: '4px 12px',
                borderRadius: 999,
                background: C.forest,
                color: '#FFFFFF',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              ⇄ MATCHED
            </span>
            <span style={{ color: C.forest, fontWeight: 700 }}>Bib #14 · Zero Orphans</span>
          </div>

          {/* 12 Citation Style Chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {stylesList.map((st, idx) => (
              <span
                key={st}
                style={{
                  padding: '6px 12px',
                  borderRadius: 999,
                  background: idx === 6 ? C.mint : C.paper,
                  border: `1px solid ${idx === 6 ? C.forest : C.lineStrong}`,
                  color: idx === 6 ? C.forest : C.inkSoft,
                  fontFamily: F.mono,
                  fontSize: 12.5,
                  fontWeight: 600,
                }}
              >
                {st}
              </span>
            ))}
          </div>
        </div>
      </div>
    </IvoryStage>
  );
};

/* ============================================================================
 * SCENE 04 — ARCHITECTURE (22.0s – 30.0s) · Dark Obsidian 8-Stage + 15+ APIs
 * ========================================================================== */
export const ArchitectureScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  // 8-Stage Pipeline activation sweep (0.25s -> 3.05s)
  const stageProgress = clamp01((t - 0.25) / 2.8);

  // Central Hub & Constellation layout coordinates inside 1920x1080
  const hubX = 960;
  const hubY = 668;
  const innerRx = 350;
  const innerRy = 158;
  const outerRx = 736;
  const outerRy = 266;

  const nodesWithCoords = SCHOLARLY_APIS.map((node, i) => {
    const rad = (node.angleDeg * Math.PI) / 180;
    const rx = node.ring === 'inner' ? innerRx : outerRx;
    const ry = node.ring === 'inner' ? innerRy : outerRy;
    const nx = hubX + Math.cos(rad) * rx;
    const ny = hubY + Math.sin(rad) * ry;
    const appearAt = 0.75 + i * 0.14;
    return { ...node, nx, ny, appearAt, index: i };
  });

  return (
    <ObsidianStage
      primaryGlow="rgba(60, 224, 155, 0.16)"
      secondaryGlow="rgba(56, 189, 248, 0.14)"
      hudLabel="ACT II · DOMAIN-AWARE FEDERATED QUERY ROUTER & 8-STAGE SSE PIPELINE"
    >
      <BilingualStageHeader
        index={ACT2_SCENES.architecture.index}
        eyebrow={ACT2_SCENES.architecture.eyebrow}
        titleEn={ACT2_SCENES.architecture.headlinesEn[0]}
        captionVi={ACT2_SCENES.architecture.captionVi}
        tagVi={ACT2_SCENES.architecture.tagVi}
        accent={C.emeraldGlow}
        dark
        layout="split"
        titleSize={47}
      />

      {/* Upper Track: 8-Stage Real-Time SSE Pipeline */}
      <div
        style={{
          position: 'absolute',
          left: 64,
          right: 64,
          top: 204,
          padding: '18px 22px',
          borderRadius: 20,
          background: 'rgba(18, 24, 22, 0.82)',
          border: `1px solid ${C.obsidianLine}`,
          boxShadow: '0 24px 60px -20px rgba(0,0,0,0.65)',
        }}
      >
        {/* Connecting glowing rail */}
        <div
          style={{
            position: 'absolute',
            left: 90,
            right: 90,
            top: '50%',
            height: 2,
            background: 'rgba(255,255,255,0.08)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 90,
            top: '50%',
            height: 2.5,
            width: `calc((100% - 180px) * ${easeOutQuart(stageProgress)})`,
            background: `linear-gradient(90deg, ${C.emeraldGlow}, ${C.cyanBright}, ${C.violetBright}, ${C.emeraldGlow})`,
            boxShadow: `0 0 16px ${C.emeraldGlow}`,
          }}
        />

        <div
          style={{
            position: 'relative',
            display: 'grid',
            gridTemplateColumns: 'repeat(8, 1fr)',
            gap: 12,
          }}
        >
          {PIPELINE_STAGES.map((st, idx) => {
            const trig = 0.25 + idx * 0.34;
            const active = t >= trig;
            const pulse = clamp01((t - trig) / 0.35);
            return (
              <div
                key={st.step}
                style={{
                  padding: '12px 12px',
                  borderRadius: 14,
                  background: active ? 'rgba(26, 36, 32, 0.96)' : 'rgba(16, 20, 19, 0.86)',
                  border: `1.5px solid ${active ? st.color : 'rgba(255,255,255,0.08)'}`,
                  boxShadow: active ? `0 0 24px -8px ${st.color}66` : undefined,
                  transform: `translate3d(0, ${active ? -2 * Math.sin(pulse * Math.PI) : 4}px, 0)`,
                  transition: 'none',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontFamily: F.mono,
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: active ? st.color : 'rgba(255,255,255,0.35)',
                    marginBottom: 4,
                  }}
                >
                  <span>STAGE {st.step}</span>
                  <span>{active ? '● SSE' : '○'}</span>
                </div>
                <div
                  style={{
                    fontFamily: F.sans,
                    fontSize: 15,
                    fontWeight: 700,
                    color: C.obsidianInk,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {st.code}
                </div>
                <div
                  style={{
                    fontFamily: F.mono,
                    fontSize: 11,
                    color: C.obsidianMuted,
                    marginTop: 3,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {st.detail}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Lower Arena: SVG Orbital Rings + 120fps Bezier Query Pulses */}
      <svg
        width={1920}
        height={1080}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        {/* Subtle orbital guides */}
        <ellipse
          cx={hubX}
          cy={hubY}
          rx={innerRx}
          ry={innerRy}
          fill="none"
          stroke="rgba(60, 224, 155, 0.12)"
          strokeDasharray="5 7"
        />
        <ellipse
          cx={hubX}
          cy={hubY}
          rx={outerRx}
          ry={outerRy}
          fill="none"
          stroke="rgba(56, 189, 248, 0.10)"
          strokeDasharray="6 8"
        />

        {nodesWithCoords.map((n) => {
          const lineP = smootherstep(clamp01((t - n.appearAt) / 0.45));
          if (lineP <= 0.01) return null;
          const cx = (hubX + n.nx) / 2;
          const cy = lerp(hubY, n.ny, 0.35) - 24;
          // Continuous 120fps traveling light packet along quadratic Bezier
          const packetU = ((t * 0.85 + n.index * 0.19) % 1 + 1) % 1;
          const inv = 1 - packetU;
          const px = inv * inv * hubX + 2 * inv * packetU * cx + packetU * packetU * n.nx;
          const py = inv * inv * hubY + 2 * inv * packetU * cy + packetU * packetU * n.ny;

          return (
            <g key={n.name} opacity={lineP}>
              <path
                d={`M ${hubX} ${hubY} Q ${cx} ${cy} ${n.nx} ${n.ny}`}
                fill="none"
                stroke={n.accent}
                strokeOpacity={0.28}
                strokeWidth={1.6}
              />
              {t >= n.appearAt + 0.2 && (
                <>
                  <circle cx={px} cy={py} r={4.2} fill="#FFFFFF" />
                  <circle cx={px} cy={py} r={9} fill={n.accent} opacity={0.38} />
                </>
              )}
            </g>
          );
        })}
      </svg>

      {/* 16 Federated Scholarly & Local Index Cards */}
      {nodesWithCoords.map((n) => {
        const p = smootherstep(clamp01((t - n.appearAt) / 0.38));
        if (p <= 0.01) return null;
        const cardW = n.ring === 'inner' ? 204 : 186;
        return (
          <div
            key={n.name}
            style={{
              position: 'absolute',
              left: n.nx - cardW / 2,
              top: n.ny - 30,
              width: cardW,
              padding: '9px 14px',
              borderRadius: 13,
              background: 'rgba(18, 25, 23, 0.93)',
              border: `1.5px solid ${n.accent}66`,
              boxShadow: `0 16px 34px -14px rgba(0,0,0,0.75), 0 0 22px -10px ${n.accent}55`,
              opacity: p,
              transform: `scale(${0.86 + 0.14 * p})`,
              zIndex: n.ring === 'inner' ? 12 : 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  width: 7.5,
                  height: 7.5,
                  borderRadius: '50%',
                  background: n.accent,
                  boxShadow: `0 0 10px ${n.accent}`,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontFamily: F.sans,
                  fontSize: 14,
                  fontWeight: 700,
                  color: C.obsidianInk,
                  whiteSpace: 'nowrap',
                }}
              >
                {n.name}
              </span>
            </div>
            <div
              style={{
                fontFamily: F.mono,
                fontSize: 11,
                color: C.obsidianMuted,
                marginTop: 3,
                paddingLeft: 15,
                whiteSpace: 'nowrap',
              }}
            >
              {n.domain}
            </div>
          </div>
        );
      })}

      {/* Central CITRA Domain-Aware Query Router Hub */}
      <div
        style={{
          position: 'absolute',
          left: hubX - 155,
          top: hubY - 68,
          width: 310,
          height: 136,
          borderRadius: 26,
          background: 'linear-gradient(155deg, #1A2621 0%, #0F1513 100%)',
          border: `2px solid ${C.emeraldGlow}`,
          boxShadow: `0 30px 70px -18px rgba(0,0,0,0.85), 0 0 60px -12px rgba(60, 224, 155, 0.42)`,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '0 22px',
          zIndex: 16,
        }}
      >
        <div
          style={{
            width: 68,
            height: 68,
            borderRadius: 18,
            background: C.paper,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Img src={staticFile('brand/citra-logo.png')} style={{ width: 48, height: 48 }} />
        </div>
        <div>
          <div
            style={{
              fontFamily: F.mono,
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: '0.12em',
              color: C.emeraldGlow,
            }}
          >
            DOMAIN-AWARE HUB
          </div>
          <div
            style={{
              fontFamily: F.sans,
              fontSize: 21,
              fontWeight: 700,
              color: C.obsidianInk,
              lineHeight: 1.15,
              marginTop: 2,
            }}
          >
            CITRA Router
          </div>
          <div
            style={{
              fontFamily: F.mono,
              fontSize: 11.5,
              color: C.obsidianMuted,
              marginTop: 4,
            }}
          >
            Async Pool · Circuit Breaker
          </div>
        </div>
      </div>

      {/* Bottom Right Live Telemetry Pill */}
      <div style={{ position: 'absolute', right: 56, bottom: 62, zIndex: 18 }}>
        <TechBadge accent={C.emeraldGlow} dark style={{ fontSize: 13, padding: '8px 16px' }}>
          <span style={{ color: C.emeraldGlow }}>●</span>
          ONNX VI↔EN BRIDGE · CIRCUIT BREAKER RESILIENCE
        </TechBadge>
      </div>
    </ObsidianStage>
  );
};
