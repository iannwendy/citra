import React from 'react';
import { Img, staticFile } from 'remotion';
import { C, F } from '../theme';
import { IvoryStage, PainterlyPanel } from '../components/backdrops';
import { CinemaBrowser, ZoomShot3D } from '../components/CinemaBrowser';
import {
  clamp01,
  computeViewportLayout,
  lerp,
  monotoneHermite,
  smootherstep,
} from '../components/motion';
import {
  BilingualStageHeader,
  TechBadge,
  useSpringSec,
  useTime,
} from '../components/typography';
import { ACT4_SCENES, BENTO_TILES } from './sceneData';

const N = 0.625;
const T = 1.25;

/* ============================================================================
 * SCENE 09 — EDUCATOR & COMMITTEE COMMAND CENTER (58.0s – 66.0s)
 * ========================================================================== */
export const EducatorScene: React.FC = () => {
  const t = useTime();
  const plane1Enter = useSpringSec(0.06, { damping: 26, stiffness: 145 });
  const plane2Enter = useSpringSec(3.85, { damping: 24, stiffness: 155 });
  const ribbonEnter = useSpringSec(4.35, { damping: 24, stiffness: 170 });

  // Smooth shift of Plane 1 when Plane 2 cascades into the right foreground
  const cascadeShift = smootherstep(clamp01((t - 3.82) / 0.65));

  return (
    <IvoryStage glowColor="rgba(46, 98, 74, 0.11)" glowPos="35% 55%">
      <PainterlyPanel
        src="sticky-3-bg.png"
        style={{ right: 48, top: 206, width: 540, height: 780, opacity: 0.28 }}
      />

      <BilingualStageHeader
        index={ACT4_SCENES.educator.index}
        eyebrow={ACT4_SCENES.educator.eyebrow}
        titleEn={ACT4_SCENES.educator.headlinesEn[0]}
        captionVi={ACT4_SCENES.educator.captionVi}
        tagVi={ACT4_SCENES.educator.tagVi}
        accent={C.forest}
        layout="split"
        titleSize={48}
      />

      {/* Plane 1: Cohort Analytics & Shared AI Hallucination Radar (Đồ án Tốt nghiệp CNTT 2026) */}
      <div
        style={{
          position: 'absolute',
          left: lerp(140, 64, cascadeShift),
          top: lerp(212, 206, cascadeShift),
          opacity: clamp01(plane1Enter * 1.25) * lerp(1, 0.92, cascadeShift),
          transform: `translate3d(0, ${(1 - plane1Enter) * 32}px, 0) scale(${lerp(
            1,
            0.91,
            cascadeShift,
          )})`,
          transformOrigin: 'left top',
          zIndex: 10,
        }}
      >
        <CinemaBrowser
          width={1220}
          contentHeight={738}
          url="citra.io.vn/teacher/classes/1 · Đồ án Tốt nghiệp CNTT 2026"
          statusLabel="COHORT CIS: 89.3"
          cams={[
            { t: 0, cx: 0.5, cy: 0.5, w: 1, rotX: 3.5, rotY: 4.5, rotZ: -0.3 },
            { t: 4.2, cx: 0.5, cy: 0.5, w: 1, rotX: 2.2, rotY: 7.5, rotZ: -0.6 },
            { t: 8.0, cx: 0.5, cy: 0.5, w: 1, rotX: 2.0, rotY: 8.0, rotZ: -0.6 },
          ]}
        >
          <ZoomShot3D
            width={1220}
            height={738}
            shots={[{ src: 'tall-teacher', aspect: T, fromSec: 0 }]}
            cams={[
              { t: 0, cx: 0.58, cy: 0.17, w: 0.86 },
              { t: 1.5, cx: 0.68, cy: 0.25, w: 0.64 },
              { t: 4.0, cx: 0.68, cy: 0.27, w: 0.62 },
              { t: 8.0, cx: 0.56, cy: 0.34, w: 0.72 },
            ]}
            loupes={[
              {
                rect: [0.548, 0.218, 0.405, 0.082],
                fromSec: 1.35,
                toSec: 3.85,
                x: 36,
                y: 416,
                width: 600,
                badge: 'SHARED AI HALLUCINATION RADAR · 3 SUBMISSIONS',
                captionVi:
                  'Phát hiện tức thì nhiều đồ án nộp chung một tài liệu tham khảo AI bịa đặt.',
                accent: C.red,
                shotSrc: 'tall-teacher',
                shotAspect: T,
              },
            ]}
          />
        </CinemaBrowser>
      </div>

      {/* Plane 2: Cascading Faculty Adjudication Queue & Human-in-the-Loop Override */}
      {plane2Enter > 0.005 && (
        <div
          style={{
            position: 'absolute',
            right: 68,
            top: 238,
            opacity: clamp01(plane2Enter * 1.25),
            transform: `translate3d(${(1 - plane2Enter) * 90}px, ${(1 - plane2Enter) * 24}px, 0)`,
            zIndex: 20,
          }}
        >
          <CinemaBrowser
            width={990}
            contentHeight={650}
            url="citra.io.vn/teacher/reviews · Faculty Adjudication Queue"
            statusLabel="16 FLAGGED · OVERRIDE READY"
            rotX={2.2}
            rotY={-6.2}
            rotZ={0.4}
          >
            <ZoomShot3D
              width={990}
              height={650}
              shots={[{ src: 'teacher-reviews', aspect: N, fromSec: 0 }]}
              cams={[
                { t: 3.8, cx: 0.58, cy: 0.44, w: 0.88 },
                { t: 8.0, cx: 0.6, cy: 0.52, w: 0.74 },
              ]}
            />
          </CinemaBrowser>
        </div>
      )}

      {/* Plane 3: Governance & Immutable Audit Log Pill */}
      {ribbonEnter > 0.01 && (
        <div
          style={{
            position: 'absolute',
            left: 72,
            bottom: 42,
            opacity: clamp01(ribbonEnter * 1.3),
            transform: `translate3d(0, ${(1 - ribbonEnter) * 20}px, 0)`,
            zIndex: 28,
          }}
        >
          <TechBadge
            accent={C.emeraldGlow}
            dark
            style={{
              background: '#141A18',
              border: `1.5px solid ${C.emeraldGlow}`,
              padding: '12px 24px',
              fontSize: 14.5,
            }}
          >
            <span style={{ color: C.emeraldGlow }}>● GOVERNANCE</span>
            <span>HUMAN-IN-THE-LOOP VERDICT OVERRIDE · MANDATORY JUSTIFICATION · AUDIT LOG</span>
          </TechBadge>
        </div>
      )}
    </IvoryStage>
  );
};

/* ============================================================================
 * SCENE 10 — 3D SPATIAL BENTO ECOSYSTEM (66.0s – 72.0s) · 8 Live Screens
 * ========================================================================== */
export const EcosystemScene: React.FC = () => {
  const t = useTime();

  // Continuous C1 camera pull-back from Tile 01 (Live Sandbox) to full 8-tile 3D Bento Wall
  const camTs = [0, 1.85, 6.0];
  const wallScale = monotoneHermite(camTs, [1.95, 1.02, 0.98], t);
  const wallTx = monotoneHermite(camTs, [580, 0, 0], t);
  const wallTy = monotoneHermite(camTs, [175, 0, 0], t);
  const rotX = monotoneHermite(camTs, [2, 10.5, 6.5], t);
  const rotY = monotoneHermite(camTs, [0, -5.5, 2.5], t);
  const rotZ = monotoneHermite(camTs, [0, -1.2, 0.4], t);

  // Beat-synced spotlight index across the 8 Bento tiles (0.5s = 1 beat @ 120 BPM)
  const activeTileIdx = Math.min(7, Math.max(0, Math.floor((t - 0.45) / 0.62)));
  const tileW = 420;
  const imgH = 236;

  return (
    <IvoryStage glowColor="rgba(46, 98, 74, 0.12)" glowPos="50% 56%">
      <BilingualStageHeader
        index={ACT4_SCENES.ecosystem.index}
        eyebrow={ACT4_SCENES.ecosystem.eyebrow}
        titleEn={ACT4_SCENES.ecosystem.headlinesEn[0]}
        captionVi={ACT4_SCENES.ecosystem.captionVi}
        tagVi={ACT4_SCENES.ecosystem.tagVi}
        accent={C.forest}
        layout="split"
        titleSize={48}
      />

      {/* 3D Perspective Bento Matrix */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 214,
          bottom: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          perspective: 2500,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(4, ${tileW}px)`,
            gap: 22,
            transform: `translate3d(${wallTx}px, ${wallTy}px, 0) scale(${wallScale}) rotateX(${rotX}deg) rotateY(${rotY}deg) rotateZ(${rotZ}deg)`,
            transformStyle: 'preserve-3d',
          }}
        >
          {BENTO_TILES.map((tile, idx) => {
            const isSpotlight = idx === activeTileIdx;
            const L = computeViewportLayout(
              { cx: tile.cx, cy: tile.cy, w: tile.w },
              N,
              tileW,
              imgH,
            );
            return (
              <div
                key={tile.code}
                style={{
                  width: tileW,
                  borderRadius: 18,
                  overflow: 'hidden',
                  background: C.paper,
                  border: `2px solid ${isSpotlight ? C.forestBright : C.lineStrong}`,
                  boxShadow: isSpotlight
                    ? `0 32px 64px -18px rgba(28, 27, 24, 0.38), 0 0 0 4px rgba(54, 179, 126, 0.22)`
                    : '0 22px 46px -20px rgba(28, 27, 24, 0.24)',
                  transform: isSpotlight ? 'translate3d(0, -6px, 18px)' : 'translate3d(0, 0, 0)',
                }}
              >
                {/* Mini Chrome Bar */}
                <div
                  style={{
                    height: 30,
                    padding: '0 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: isSpotlight ? '#151D1A' : '#F3EFE6',
                    color: isSpotlight ? '#F5F7F5' : C.muted,
                    fontFamily: F.mono,
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  <span style={{ color: isSpotlight ? C.emeraldGlow : C.forest }}>
                    {tile.code} · {tile.url}
                  </span>
                  <span>● LIVE</span>
                </div>

                {/* Crisp Retina Screenshot Crop */}
                <div
                  style={{
                    position: 'relative',
                    width: tileW,
                    height: imgH,
                    overflow: 'hidden',
                    background: C.ivory,
                  }}
                >
                  <Img
                    src={staticFile(`shots/${tile.src}.png`)}
                    style={{
                      position: 'absolute',
                      left: L.left,
                      top: L.top,
                      width: L.DW,
                      height: L.DH,
                      maxWidth: 'none',
                    }}
                  />
                </div>

                {/* Bilingual Tile Caption Footer */}
                <div
                  style={{
                    padding: '10px 14px 12px',
                    background: C.paper,
                    borderTop: `1px solid ${C.line}`,
                  }}
                >
                  <div
                    style={{
                      fontFamily: F.sans,
                      fontSize: 15.5,
                      fontWeight: 700,
                      color: C.ink,
                    }}
                  >
                    {tile.title}
                  </div>
                  <div
                    style={{
                      fontFamily: F.sans,
                      fontSize: 12.5,
                      fontWeight: 500,
                      color: C.muted,
                      marginTop: 2,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {tile.subtitleVi.trim()}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </IvoryStage>
  );
};
