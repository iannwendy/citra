import { continueRender, delayRender, staticFile } from 'remotion';
import { loadFont as loadJakarta } from '@remotion/google-fonts/PlusJakartaSans';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';
import { loadFont as loadSerif } from '@remotion/google-fonts/SourceSerif4';
import timeline from './timeline.json';

export const FPS = timeline.fps;
export const sec = (s: number) => Math.round(s * FPS);

export const C = {
  ivory: '#FAF8F3',
  paper: '#FFFDF8',
  sand: '#F2EEE5',
  line: 'rgba(37,37,35,0.10)',
  ink: '#252523',
  muted: '#6B6A63',
  faint: '#9A988F',
  forest: '#35624D',
  forestLight: '#4F8A6B',
  mint: '#E6F2EA',
  red: '#C0362C',
  redSoft: '#FCEBE9',
  amber: '#B7791F',
  violet: '#6D3FD8',
};

const jakarta = loadJakarta('normal', {
  weights: ['400', '500', '600', '700'],
  subsets: ['latin', 'latin-ext', 'vietnamese'],
});
const mono = loadMono('normal', { weights: ['400', '500', '600'], subsets: ['latin'] });
const serif = loadSerif('normal', {
  weights: ['300', '400', '500'],
  subsets: ['latin', 'latin-ext', 'vietnamese'],
});

loadSerif('italic', { weights: ['300', '400'], subsets: ['latin', 'latin-ext', 'vietnamese'] });

export const F = {
  display: 'Sentient, "Source Serif 4", Georgia, serif',
  sans: jakarta.fontFamily,
  mono: mono.fontFamily,
  serif: serif.fontFamily,
};

// Brand display serif (Sentient) — shipped with the web app.
if (typeof window !== 'undefined' && typeof FontFace !== 'undefined') {
  const handle = delayRender('Loading Sentient');
  const faces = [
    new FontFace('Sentient', `url(${staticFile('fonts/Sentient-Light.woff2')}) format("woff2")`, { weight: '300' }),
    new FontFace('Sentient', `url(${staticFile('fonts/Sentient-Regular.woff2')}) format("woff2")`, { weight: '400' }),
  ];
  Promise.all(faces.map((f) => f.load()))
    .then((loaded) => {
      loaded.forEach((f) => document.fonts.add(f));
      continueRender(handle);
    })
    .catch(() => continueRender(handle));
}
