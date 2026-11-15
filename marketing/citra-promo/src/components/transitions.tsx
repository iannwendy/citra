import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { C } from '../theme';
import { computePortalTransform, PortalMode } from './motion';

export const OVERLAP_SEC = 0.44;

export const ScenePortal: React.FC<{
  mode: PortalMode;
  isFirst?: boolean;
  isLast?: boolean;
  darkExit?: boolean;
  children: React.ReactNode;
}> = ({ mode, isFirst = false, isLast = false, darkExit = false, children }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const localSec = frame / fps;
  const totalSec = durationInFrames / fps;

  const tr = computePortalTransform(localSec, totalSec, OVERLAP_SEC, mode, isFirst, isLast);

  return (
    <AbsoluteFill
      style={{
        opacity: tr.opacity,
        transform: `translate3d(${tr.tx}px, ${tr.ty}px, 0) scale(${tr.scale})`,
        filter: tr.blurPx > 0.25 ? `blur(${tr.blurPx.toFixed(2)}px)` : undefined,
        willChange: 'transform, opacity',
      }}
    >
      {children}
      {tr.bloomOpacity > 0.01 && (
        <AbsoluteFill
          style={{
            background: darkExit
              ? `radial-gradient(75% 75% at 50% 50%, rgba(60, 224, 155, ${tr.bloomOpacity * 0.45}) 0%, rgba(250, 248, 243, ${tr.bloomOpacity}) 100%)`
              : `radial-gradient(80% 80% at 50% 50%, rgba(255, 255, 255, ${tr.bloomOpacity}) 0%, rgba(250, 248, 243, ${tr.bloomOpacity * 0.7}) 100%)`,
            pointerEvents: 'none',
          }}
        />
      )}
    </AbsoluteFill>
  );
};
