import React from 'react';
import { random } from 'remotion';
import { C, F } from '../theme';
import { IvoryStage, PainterlyPanel } from '../components/backdrops';
import { CinemaBrowser, ZoomShot3D } from '../components/CinemaBrowser';
import { clamp01 } from '../components/motion';
import {
  BilingualStageHeader,
  TechBadge,
  useSpringSec,
  useTime,
} from '../components/typography';
import { ACT3_LOUPES, ACT3_SCENES } from './sceneData';

const N = 0.625;
const T = 1.25;

/* ============================================================================
 * SCENE 05 — HALLUCINATION DIVE (30.0s – 38.0s) · Full-Bleed Macro + 3D Loupes
 * ========================================================================== */
export const HallucinationScene: React.FC = () => {
  const enterP = useSpringSec(0.06, { damping: 26, stiffness: 145 });
  const loupeRetrieval = ACT3_LOUPES[0];
  const loupeRule = ACT3_LOUPES[1];

  return (
    <IvoryStage glowColor="rgba(198, 55, 45, 0.10)" glowPos="68% 54%">
      <PainterlyPanel
        src="sticky-1-bg.png"
        style={{ right: 48, top: 196, width: 560, height: 810, opacity: 0.28 }}
      />

      <BilingualStageHeader
        index={ACT3_SCENES.hallucination.index}
        eyebrow={ACT3_SCENES.hallucination.eyebrow}
        titleEn={ACT3_SCENES.hallucination.headlinesEn[0]}
        captionVi={ACT3_SCENES.hallucination.captionVi}
        tagVi={ACT3_SCENES.hallucination.tagVi}
        accent={C.red}
        layout="split"
        titleSize={48}
      />

      <div
        style={{
          position: 'absolute',
          left: 72,
          top: 210,
          opacity: clamp01(enterP * 1.25),
          transform: `translate3d(0, ${(1 - enterP) * 32}px, 0)`,
        }}
      >
        <CinemaBrowser
          width={1776}
          contentHeight={768}
          url="citra.io.vn/verification/report/33?tab=debugger&ref=10"
          statusLabel="ALERT · 1 HALLUCINATION FLAGGED"
          cams={[
            { t: 0, cx: 0.5, cy: 0.5, w: 1, rotX: 5.5, rotY: -4.2, rotZ: 0.5 },
            { t: 2.6, cx: 0.5, cy: 0.5, w: 1, rotX: 1.8, rotY: -1.4, rotZ: 0 },
            { t: 5.4, cx: 0.5, cy: 0.5, w: 1, rotX: 0.8, rotY: 0.8, rotZ: 0 },
            { t: 8.0, cx: 0.5, cy: 0.5, w: 1, rotX: 0, rotY: 0, rotZ: 0 },
          ]}
        >
          <ZoomShot3D
            width={1776}
            height={768}
            shots={[
              { src: 'report-halluc', aspect: N, fromSec: 0, toSec: 2.65 },
              { src: 'report-halluc-retrieval', aspect: N, fromSec: 2.65, toSec: 5.05 },
              { src: 'report-halluc-rules', aspect: N, fromSec: 5.05 },
            ]}
            cams={[
              { t: 0, cx: 0.54, cy: 0.48, w: 0.96 },
              { t: 2.2, cx: 0.72, cy: 0.58, w: 0.62 },
              { t: 4.8, cx: 0.74, cy: 0.66, w: 0.58 },
              { t: 6.2, cx: 0.74, cy: 0.78, w: 0.56 },
              { t: 8.0, cx: 0.74, cy: 0.8, w: 0.54 },
            ]}
            loupes={[
              {
                rect: loupeRetrieval.rect,
                fromSec: 2.75,
                toSec: 4.92,
                x: 48,
                y: 165,
                width: 660,
                badge: loupeRetrieval.badge,
                captionVi: loupeRetrieval.captionVi,
                accent: C.red,
                shotSrc: 'report-halluc-retrieval',
                shotAspect: N,
              },
              {
                rect: loupeRule.rect,
                fromSec: 5.18,
                toSec: 7.85,
                x: 48,
                y: 230,
                width: 680,
                badge: loupeRule.badge,
                captionVi: loupeRule.captionVi,
                accent: C.red,
                shotSrc: 'report-halluc-rules',
                shotAspect: N,
              },
            ]}
          />
        </CinemaBrowser>
      </div>
    </IvoryStage>
  );
};

/* ============================================================================
 * SCENE 06 — RETRACTION & WAYBACK (38.0s – 44.0s) · Asymmetric Dual-Plane
 * ========================================================================== */
export const RetractionScene: React.FC = () => {
  const rearP = useSpringSec(0.05, { damping: 26, stiffness: 140 });
  const frontP = useSpringSec(0.24, { damping: 24, stiffness: 155 });
  const cardP = useSpringSec(0.55, { damping: 26, stiffness: 165 });
  const loupeRetract = ACT3_LOUPES[2];

  return (
    <IvoryStage glowColor="rgba(192, 122, 26, 0.11)" glowPos="36% 52%">
      <PainterlyPanel
        src="feature-3-bg.png"
        style={{ left: 48, top: 84, width: 560, height: 860, opacity: 0.34 }}
      />

      {/* Rear Depth Plane: processing.png showing WAYBACK ARCHIVED + METADATA_ERROR */}
      <div
        style={{
          position: 'absolute',
          left: 64,
          top: 68,
          opacity: clamp01(rearP * 1.15) * 0.9,
          transform: `translate3d(${(1 - rearP) * -40}px, 0, 0) scale(0.95)`,
          zIndex: 6,
        }}
      >
        <CinemaBrowser
          width={860}
          contentHeight={520}
          url="citra.io.vn/verification/report/33?filter=wayback"
          statusLabel="WAYBACK CDX · VERIFIED"
          rotX={3.5}
          rotY={10}
          rotZ={-1.2}
        >
          <ZoomShot3D
            width={860}
            height={520}
            shots={[{ src: 'processing', aspect: N, fromSec: 0 }]}
            cams={[
              { t: 0, cx: 0.38, cy: 0.72, w: 0.56 },
              { t: 6, cx: 0.38, cy: 0.75, w: 0.52 },
            ]}
          />
        </CinemaBrowser>
      </div>

      {/* Foreground Hero Plane: tall-meta.png with GlassLoupe on OFFICIALLY RETRACTED */}
      <div
        style={{
          position: 'absolute',
          left: 196,
          top: 224,
          opacity: clamp01(frontP * 1.25),
          transform: `translate3d(0, ${(1 - frontP) * 38}px, 0)`,
          zIndex: 14,
        }}
      >
        <CinemaBrowser
          width={980}
          contentHeight={744}
          url="citra.io.vn/verification/report/33?ref=2"
          statusLabel="RETRACTION WATCH HIT"
          cams={[
            { t: 0, cx: 0.5, cy: 0.5, w: 1, rotX: 3.2, rotY: 6.5, rotZ: -0.4 },
            { t: 6, cx: 0.5, cy: 0.5, w: 1, rotX: 1.2, rotY: 3.2, rotZ: 0 },
          ]}
        >
          <ZoomShot3D
            width={980}
            height={744}
            shots={[{ src: 'tall-meta', aspect: T, fromSec: 0 }]}
            cams={[
              { t: 0, cx: 0.74, cy: 0.28, w: 0.56 },
              { t: 2.6, cx: 0.75, cy: 0.36, w: 0.52 },
              { t: 6.0, cx: 0.75, cy: 0.54, w: 0.52 },
            ]}
            loupes={[
              {
                rect: loupeRetract.rect,
                fromSec: 1.05,
                toSec: 5.55,
                x: 28,
                y: 430,
                width: 580,
                badge: loupeRetract.badge,
                captionVi: loupeRetract.captionVi,
                accent: C.amber,
                shotSrc: 'tall-meta',
                shotAspect: T,
              },
            ]}
          />
        </CinemaBrowser>
      </div>

      {/* Right Keynote Editorial Column */}
      <div
        style={{
          position: 'absolute',
          left: 1236,
          right: 68,
          top: 128,
          display: 'flex',
          flexDirection: 'column',
          gap: 28,
          zIndex: 20,
        }}
      >
        <BilingualStageHeader
          index={ACT3_SCENES.retraction.index}
          eyebrow={ACT3_SCENES.retraction.eyebrow}
          titleEn={ACT3_SCENES.retraction.headlinesEn[0]}
          captionVi={ACT3_SCENES.retraction.captionVi}
          tagVi={ACT3_SCENES.retraction.tagVi}
          accent={C.amber}
          layout="stack"
          titleSize={58}
        />

        {/* Diagnostic Dual Telemetry Cards */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            marginTop: 8,
            opacity: clamp01(cardP * 1.2),
            transform: `translate3d(${(1 - cardP) * 28}px, 0, 0)`,
          }}
        >
          <div
            style={{
              padding: '20px 24px',
              borderRadius: 18,
              background: C.paper,
              border: `1.5px solid ${C.red}44`,
              boxShadow: '0 22px 48px -20px rgba(28, 27, 24, 0.22)',
            }}
          >
            <div
              style={{
                fontFamily: F.mono,
                fontSize: 13,
                fontWeight: 700,
                color: C.red,
                letterSpacing: '0.08em',
              }}
            >
              ⚠ RETRACTION WATCH CROSS-CHECK
            </div>
            <div
              style={{
                fontFamily: F.sans,
                fontSize: 17.5,
                fontWeight: 600,
                color: C.ink,
                marginTop: 6,
              }}
            >
              Mehra et al. (2020) · The Lancet
            </div>
            <div style={{ fontFamily: F.sans, fontSize: 15, color: C.muted, marginTop: 4 }}>
              Ngăn chặn trích dẫn công trình khoa học đã bị thu hồi chính thức.
            </div>
          </div>

          <div
            style={{
              padding: '20px 24px',
              borderRadius: 18,
              background: C.paper,
              border: `1.5px solid ${C.forest}44`,
              boxShadow: '0 22px 48px -20px rgba(28, 27, 24, 0.22)',
            }}
          >
            <div
              style={{
                fontFamily: F.mono,
                fontSize: 13,
                fontWeight: 700,
                color: C.forest,
                letterSpacing: '0.08em',
              }}
            >
              🏛 INTERNET ARCHIVE CDX · LINK ROT GUARD
            </div>
            <div
              style={{
                fontFamily: F.sans,
                fontSize: 17.5,
                fontWeight: 600,
                color: C.ink,
                marginTop: 6,
              }}
            >
              HTTP 404 ≠ Fabricated Source
            </div>
            <div style={{ fontFamily: F.sans, fontSize: 15, color: C.muted, marginTop: 4 }}>
              Tự động khôi phục chứng cứ qua Wayback Machine để không kết oan nguồn thật.
            </div>
          </div>
        </div>
      </div>
    </IvoryStage>
  );
};

/* ============================================================================
 * SCENE 07 — LOGIC TRACE & EVIDENCE DAG (44.0s – 50.0s) · Dual-Scroll Inspector
 * ========================================================================== */
export const TraceScene: React.FC = () => {
  const leftP = useSpringSec(0.06, { damping: 26, stiffness: 145 });
  const rightP = useSpringSec(0.16, { damping: 26, stiffness: 145 });
  const bridgeP = useSpringSec(0.48, { damping: 22, stiffness: 175 });

  return (
    <IvoryStage glowColor="rgba(46, 98, 74, 0.11)" glowPos="50% 56%">
      <PainterlyPanel
        src="usecase-1-bg.png"
        style={{ left: 60, top: 220, width: 440, height: 760, opacity: 0.24 }}
      />
      <PainterlyPanel
        src="usecase-2-bg.png"
        style={{ right: 60, top: 220, width: 440, height: 760, opacity: 0.24 }}
      />

      <BilingualStageHeader
        index={ACT3_SCENES.trace.index}
        eyebrow={ACT3_SCENES.trace.eyebrow}
        titleEn={ACT3_SCENES.trace.headlinesEn[0]}
        captionVi={ACT3_SCENES.trace.captionVi}
        tagVi={ACT3_SCENES.trace.tagVi}
        accent={C.forest}
        layout="split"
        titleSize={48}
      />

      {/* Left Glass Viewport: 5-Stage Logic Trace (gliding DOWN) */}
      <div
        style={{
          position: 'absolute',
          left: 72,
          top: 212,
          opacity: clamp01(leftP * 1.25),
          transform: `translate3d(${(1 - leftP) * -36}px, 0, 0)`,
          zIndex: 12,
        }}
      >
        <CinemaBrowser
          width={864}
          contentHeight={738}
          url="citra.io.vn/report/33/logic-trace"
          statusLabel="5-STAGE SYMBOLIC TRACE"
          rotX={2.2}
          rotY={5.8}
          rotZ={-0.3}
        >
          <ZoomShot3D
            width={864}
            height={738}
            shots={[{ src: 'tall-trace', aspect: T, fromSec: 0 }]}
            cams={[
              { t: 0, cx: 0.6, cy: 0.31, w: 0.75 },
              { t: 3.0, cx: 0.6, cy: 0.5, w: 0.73 },
              { t: 6.0, cx: 0.6, cy: 0.68, w: 0.72 },
            ]}
          />
        </CinemaBrowser>
      </div>

      {/* Right Glass Viewport: Neuro-Symbolic Evidence DAG (gliding UP in counter-parallax) */}
      <div
        style={{
          position: 'absolute',
          right: 72,
          top: 212,
          opacity: clamp01(rightP * 1.25),
          transform: `translate3d(${(1 - rightP) * 36}px, 0, 0)`,
          zIndex: 12,
        }}
      >
        <CinemaBrowser
          width={864}
          contentHeight={738}
          url="citra.io.vn/report/33/evidence-dag"
          statusLabel="EVIDENCE DAG · 15+ APIS"
          rotX={2.2}
          rotY={-5.8}
          rotZ={0.3}
        >
          <ZoomShot3D
            width={864}
            height={738}
            shots={[{ src: 'tall-evgraph', aspect: T, fromSec: 0 }]}
            cams={[
              { t: 0, cx: 0.75, cy: 0.74, w: 0.54 },
              { t: 3.0, cx: 0.75, cy: 0.58, w: 0.54 },
              { t: 6.0, cx: 0.75, cy: 0.46, w: 0.53 },
            ]}
          />
        </CinemaBrowser>
      </div>

      {/* Center Floating Formula Bridge Badge */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          bottom: 44,
          transform: `translate3d(-50%, ${(1 - bridgeP) * 24}px, 0) scale(${0.9 + 0.1 * bridgeP})`,
          opacity: clamp01(bridgeP * 1.3),
          zIndex: 30,
        }}
      >
        <TechBadge
          accent={C.emeraldGlow}
          dark
          style={{
            padding: '13px 28px',
            fontSize: 15.5,
            background: '#131917',
            border: `1.5px solid ${C.emeraldGlow}`,
            boxShadow: '0 26px 54px -14px rgba(0,0,0,0.58)',
          }}
        >
          <span style={{ color: C.emeraldGlow }}>R01–R30 Symbolic Rules</span>
          <span style={{ opacity: 0.45 }}>⊗</span>
          <span style={{ color: C.violetBright }}>16D HybridML</span>
          <span style={{ opacity: 0.45 }}>→</span>
          <span style={{ color: '#FFFFFF' }}>Platt Calibrated Verdict (ECE 0.0433)</span>
        </TechBadge>
      </div>
    </IvoryStage>
  );
};

/* ============================================================================
 * SCENE 08 — AUTO-FIX STUDIO & ISO QR DIGITAL RECEIPT (50.0s – 58.0s)
 * ========================================================================== */
const DeterministicQrMatrix: React.FC<{ size?: number }> = ({ size = 112 }) => {
  const cells = 15;
  const cellSize = size / cells;

  const isFinder = (r: number, c: number, r0: number, c0: number) => {
    const dr = r - r0;
    const dc = c - c0;
    if (dr < 0 || dr > 4 || dc < 0 || dc > 4) return null;
    if (dr === 0 || dr === 4 || dc === 0 || dc === 4) return true;
    if (dr === 2 && dc === 2) return true;
    return false;
  };

  const rects: React.ReactNode[] = [];
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      const f1 = isFinder(r, c, 0, 0);
      const f2 = isFinder(r, c, 0, cells - 5);
      const f3 = isFinder(r, c, cells - 5, 0);
      const finderVal = f1 ?? f2 ?? f3;
      const on = finderVal !== null ? finderVal : random(`qr-${r}-${c}`) > 0.46;
      if (on) {
        rects.push(
          <rect
            key={`${r}-${c}`}
            x={c * cellSize}
            y={r * cellSize}
            width={cellSize + 0.3}
            height={cellSize + 0.3}
            rx={1}
            fill={C.ink}
          />,
        );
      }
    }
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <rect x={0} y={0} width={size} height={size} rx={6} fill="#FFFFFF" />
      {rects}
    </svg>
  );
};

export const AutoFixScene: React.FC = () => {
  const t = useTime();
  const browserP = useSpringSec(0.06, { damping: 26, stiffness: 145 });
  const qrCardP = useSpringSec(1.55, { damping: 22, stiffness: 165 });
  const chipsP = useSpringSec(2.45, { damping: 24, stiffness: 170 });
  const loupeFix = ACT3_LOUPES[3];

  const exportFormats = [
    { label: 'APA 7th', hero: false },
    { label: 'IEEE Numeric', hero: false },
    { label: 'Harvard / TDTU', hero: false },
    { label: 'BibTeX .bib', hero: false },
    { label: 'RIS .ris', hero: false },
    { label: '✦ Auto-Healed .DOCX', hero: true },
  ];

  return (
    <IvoryStage glowColor="rgba(104, 66, 214, 0.11)" glowPos="42% 54%">
      <PainterlyPanel
        src="sticky-2-bg.png"
        style={{ left: 52, top: 204, width: 520, height: 790, opacity: 0.28 }}
      />

      <BilingualStageHeader
        index={ACT3_SCENES.autofix.index}
        eyebrow={ACT3_SCENES.autofix.eyebrow}
        titleEn={ACT3_SCENES.autofix.headlinesEn[0]}
        captionVi={ACT3_SCENES.autofix.captionVi}
        tagVi={ACT3_SCENES.autofix.tagVi}
        accent={C.violet}
        layout="split"
        titleSize={48}
      />

      {/* Left-Center Remediation Studio Browser */}
      <div
        style={{
          position: 'absolute',
          left: 72,
          top: 212,
          opacity: clamp01(browserP * 1.25),
          transform: `translate3d(0, ${(1 - browserP) * 32}px, 0)`,
        }}
      >
        <CinemaBrowser
          width={1188}
          contentHeight={744}
          url={
            t < 1.32
              ? 'citra.io.vn/verification/report/33'
              : 'citra.io.vn/verification/report/33?studio=autofix'
          }
          statusLabel={t < 1.32 ? 'SPLIT-PANE IDE' : 'PRO REMEDIATION STUDIO'}
          cams={[
            { t: 0, cx: 0.5, cy: 0.5, w: 1, rotX: 3.5, rotY: 5.5, rotZ: -0.4 },
            { t: 2.0, cx: 0.5, cy: 0.5, w: 1, rotX: 1.6, rotY: 2.8, rotZ: 0 },
            { t: 8.0, cx: 0.5, cy: 0.5, w: 1, rotX: 0.8, rotY: 1.5, rotZ: 0 },
          ]}
        >
          <ZoomShot3D
            width={1188}
            height={744}
            shots={[
              { src: 'report-ide', aspect: N, fromSec: 0, toSec: 1.32 },
              { src: 'tall-autofix', aspect: T, fromSec: 1.32 },
            ]}
            cams={[
              { t: 0, cx: 0.68, cy: 0.41, w: 0.62 },
              { t: 1.25, cx: 0.705, cy: 0.395, w: 0.54 },
              { t: 1.6, cx: 0.5, cy: 0.16, w: 0.78 },
              { t: 4.5, cx: 0.5, cy: 0.25, w: 0.74 },
              { t: 8.0, cx: 0.5, cy: 0.45, w: 0.73 },
            ]}
            cursor={[
              { t: 0.15, x: 0.83, y: 0.62 },
              { t: 0.92, x: 0.705, y: 0.393, click: true },
              { t: 1.28, x: 0.705, y: 0.393 },
            ]}
            loupes={[
              {
                rect: loupeFix.rect,
                fromSec: 2.05,
                toSec: 5.35,
                x: 34,
                y: 448,
                width: 560,
                badge: loupeFix.badge,
                captionVi: loupeFix.captionVi,
                accent: C.forest,
                shotSrc: 'tall-autofix',
                shotAspect: T,
              },
            ]}
          />
        </CinemaBrowser>
      </div>

      {/* Right Elevated Column: ISO/IEC 18004 QR Digital Verification Receipt + Export Formats */}
      <div
        style={{
          position: 'absolute',
          right: 72,
          top: 214,
          width: 552,
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
          zIndex: 22,
        }}
      >
        {/* Tamper-Evident QR Certificate Card */}
        <div
          style={{
            padding: '28px 30px',
            borderRadius: 24,
            background: 'linear-gradient(160deg, #161C1A 0%, #0E1311 100%)',
            border: `1.5px solid ${C.emeraldGlow}88`,
            boxShadow:
              '0 42px 84px -22px rgba(18, 17, 15, 0.55), 0 0 44px -14px rgba(60, 224, 155, 0.35)',
            color: C.obsidianInk,
            opacity: clamp01(qrCardP * 1.25),
            transform: `translate3d(${(1 - qrCardP) * 44}px, 0, 0) scale(${0.94 + 0.06 * qrCardP})`,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 18,
            }}
          >
            <span
              style={{
                fontFamily: F.mono,
                fontSize: 12.5,
                fontWeight: 700,
                letterSpacing: '0.14em',
                color: C.emeraldGlow,
              }}
            >
              ✓ DIGITAL VERIFICATION RECEIPT
            </span>
            <span
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                background: 'rgba(60, 224, 155, 0.14)',
                color: C.emeraldGlow,
                fontFamily: F.mono,
                fontSize: 11.5,
                fontWeight: 600,
              }}
            >
              ISO/IEC 18004 QR
            </span>
          </div>

          <div style={{ display: 'flex', gap: 22, alignItems: 'center' }}>
            <div
              style={{
                padding: 10,
                borderRadius: 14,
                background: '#FFFFFF',
                boxShadow: '0 12px 28px rgba(0,0,0,0.35)',
                flexShrink: 0,
              }}
            >
              <DeterministicQrMatrix size={116} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <div style={{ fontFamily: F.sans, fontSize: 20, fontWeight: 700 }}>
                Tamper-Evident Audit Seal
              </div>
              <div style={{ fontFamily: F.mono, fontSize: 12.5, color: C.obsidianMuted }}>
                DOC: thesis_se_tdtu_2026_healed.docx
              </div>
              <div style={{ fontFamily: F.mono, fontSize: 12.5, color: C.emeraldGlow }}>
                SHA-256: 9f4c8b1e ··· 72a8e21f
              </div>
              <div style={{ fontFamily: F.sans, fontSize: 14, color: '#D1DCD6', marginTop: 2 }}>
                Quét mã QR trên phụ lục PDF/DOCX để đối chiếu trực tuyến kết quả thẩm định gốc.
              </div>
            </div>
          </div>
        </div>

        {/* Multi-Style Export & Auto-Healed .DOCX Dock */}
        <div
          style={{
            padding: '24px 28px',
            borderRadius: 22,
            background: 'rgba(255, 253, 249, 0.95)',
            border: `1.5px solid ${C.lineStrong}`,
            boxShadow: '0 28px 60px -22px rgba(28, 27, 24, 0.24)',
            opacity: clamp01(chipsP * 1.25),
            transform: `translate3d(0, ${(1 - chipsP) * 24}px, 0)`,
          }}
        >
          <div
            style={{
              fontFamily: F.mono,
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: '0.12em',
              color: C.violet,
              marginBottom: 14,
            }}
          >
            INSTANT BIBLIOGRAPHY & MANUSCRIPT EXPORT
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {exportFormats.map((fmt) => (
              <span
                key={fmt.label}
                style={{
                  padding: fmt.hero ? '10px 18px' : '8px 15px',
                  borderRadius: 999,
                  background: fmt.hero ? C.forest : C.paper,
                  border: `1.5px solid ${fmt.hero ? C.forest : C.lineStrong}`,
                  color: fmt.hero ? '#FFFFFF' : C.ink,
                  fontFamily: fmt.hero ? F.sans : F.mono,
                  fontSize: fmt.hero ? 15.5 : 13.5,
                  fontWeight: 700,
                  boxShadow: fmt.hero ? `0 12px 24px -8px ${C.forest}88` : undefined,
                }}
              >
                {fmt.label}
              </span>
            ))}
          </div>

          <div
            style={{
              marginTop: 14,
              fontFamily: F.sans,
              fontSize: 15.5,
              color: C.muted,
              lineHeight: 1.45,
            }}
          >
            Bảo toàn định dạng gốc của khóa luận khi thay thế trích dẫn chuẩn hóa vào .docx.
          </div>
        </div>
      </div>
    </IvoryStage>
  );
};
