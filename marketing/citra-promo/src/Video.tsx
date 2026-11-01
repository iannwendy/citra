import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion';
import timeline from './timeline.json';
import { sec } from './theme';
import { Hook } from './scenes/Hook';
import { Reveal } from './scenes/Reveal';
import { AutoFix, Graph, Hallucination, Metadata, Teacher, Trace, Upload } from './scenes/Features';
import { EndCard, Montage, Stats } from './scenes/Closing';

const SCENES: Record<string, React.FC> = {
  hook: Hook,
  reveal: Reveal,
  pipeline: Upload,
  hallucination: Hallucination,
  metadata: Metadata,
  trace: Trace,
  autofix: AutoFix,
  graph: Graph,
  teacher: Teacher,
  montage: Montage,
  stats: Stats,
  endcard: EndCard,
};

export const CitraPromo: React.FC = () => (
  <AbsoluteFill style={{ background: '#FAF8F3' }}>
    {timeline.scenes.map((s) => {
      const Comp = SCENES[s.id];
      return (
        <Sequence key={s.id} from={sec(s.start)} durationInFrames={sec(s.end - s.start)} name={s.id}>
          <Comp />
        </Sequence>
      );
    })}
    <Audio src={staticFile('audio/soundtrack.wav')} />
  </AbsoluteFill>
);
