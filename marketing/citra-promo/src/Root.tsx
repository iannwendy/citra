import React from 'react';
import { Composition } from 'remotion';
import { CitraPromo } from './Video';
import timeline from './timeline.json';
import './theme';

export const RemotionRoot: React.FC = () => (
  <Composition
    id="CitraPromo"
    component={CitraPromo}
    durationInFrames={timeline.durationSec * timeline.fps}
    fps={timeline.fps}
    width={1920}
    height={1080}
  />
);
