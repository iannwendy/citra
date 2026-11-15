import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion';
import timeline from './timeline.json';
import { C, sec } from './theme';
import { PortalMode } from './components/motion';
import { OVERLAP_SEC, ScenePortal } from './components/transitions';
import { HookScene, RevealScene } from './scenes/Act1HookReveal';
import { ArchitectureScene, IngestScene } from './scenes/Act2Architecture';
import {
  AutoFixScene,
  HallucinationScene,
  RetractionScene,
  TraceScene,
} from './scenes/Act3Inspection';
import { EcosystemScene, EducatorScene } from './scenes/Act4Ecosystem';
import { AblationScene, EndCardScene, ScaleScene } from './scenes/Act5ProofFinale';

export const SCENE_COMPONENTS: Record<string, React.FC> = {
  hook: HookScene,
  reveal: RevealScene,
  ingest: IngestScene,
  architecture: ArchitectureScene,
  hallucination: HallucinationScene,
  retraction: RetractionScene,
  trace: TraceScene,
  autofix: AutoFixScene,
  educator: EducatorScene,
  ecosystem: EcosystemScene,
  ablation: AblationScene,
  scale: ScaleScene,
  endcard: EndCardScene,
};

export const CitraPromo: React.FC = () => {
  const totalScenes = timeline.scenes.length;

  return (
    <AbsoluteFill style={{ backgroundColor: C.obsidian }}>
      {timeline.scenes.map((s, idx) => {
        const Comp = SCENE_COMPONENTS[s.id];
        const isFirst = idx === 0;
        const isLast = idx === totalScenes - 1;
        const baseDurSec = s.end - s.start;
        const renderDurSec = isLast ? baseDurSec : baseDurSec + OVERLAP_SEC;

        return (
          <Sequence
            key={s.id}
            from={sec(s.start)}
            durationInFrames={sec(renderDurSec)}
            name={`${String(idx + 1).padStart(2, '0')}-${s.id}`}
          >
            <ScenePortal
              mode={s.transition as PortalMode}
              isFirst={isFirst}
              isLast={isLast}
              darkExit={s.theme === 'dark'}
            >
              <Comp />
            </ScenePortal>
          </Sequence>
        );
      })}
      <Audio src={staticFile('audio/soundtrack.wav')} />
    </AbsoluteFill>
  );
};
