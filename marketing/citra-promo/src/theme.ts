import { continueRender, delayRender, staticFile } from 'remotion';
import { loadFont as loadJakarta } from '@remotion/google-fonts/PlusJakartaSans';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';
import { loadFont as loadSerif } from '@remotion/google-fonts/SourceSerif4';
import timeline from './timeline.json';
import { sec as secBase } from './components/motion';

export const FPS = timeline.fps;
export const sec = (s: number) => secBase(s, FPS);

export const C = {
  // Light Editorial Ivory Palette
  ivory: '#FAF8F3',
  paper: '#FFFDF9',
  sand: '#F1EDE3',
  sandDeep: '#E5DFD1',
  line: 'rgba(32, 31, 27, 0.10)',
  lineStrong: 'rgba(32, 31, 27, 0.18)',
  ink: '#1C1B18',
  inkSoft: '#35342F',
  muted: '#64625A',
  faint: '#949186',

  // Dark Obsidian Cinema Palette
  obsidian: '#0B0E0D',
  obsidianElevated: '#121715',
  obsidianCard: 'rgba(20, 26, 24, 0.84)',
  obsidianLine: 'rgba(235, 245, 240, 0.11)',
  obsidianInk: '#F5F7F5',
  obsidianMuted: '#9BA8A1',

  // Semantic & Brand Accents
  forest: '#2E624A',
  forestBright: '#36B37E',
  emeraldGlow: '#3CE09B',
  mint: '#E4F3EA',
  red: '#C6372D',
  redBright: '#F25549',
  redSoft: '#FDECEB',
  amber: '#C07A1A',
  amberBright: '#F6AD3C',
  amberSoft: '#FEF5E6',
  violet: '#6842D6',
  violetBright: '#9B7BFF',
  violetSoft: '#F1ECFD',
  cyanBright: '#38BDF8',
};

const jakarta = loadJakarta('normal', {
  weights: ['400', '500', '600', '700'],
  subsets: ['latin', 'latin-ext', 'vietnamese'],
});

const mono = loadMono('normal', {
  weights: ['400', '500', '600', '700'],
  subsets: ['latin', 'latin-ext', 'vietnamese'],
});

const serif = loadSerif('normal', {
  weights: ['300', '400', '500', '600'],
  subsets: ['latin', 'latin-ext', 'vietnamese'],
});

loadSerif('italic', {
  weights: ['300', '400'],
  subsets: ['latin', 'latin-ext', 'vietnamese'],
});

export const F = {
  /** English display headlines & numeric figures ONLY (Sentient is Latin-only). */
  display: 'Sentient, "Source Serif 4", Georgia, serif',
  /** Full Vietnamese + English UI, HUD subtitles & architectural labels. */
  sans: jakarta.fontFamily,
  /** Full Vietnamese + English technical badges, rule IDs & telemetry. */
  mono: mono.fontFamily,
  /** Full Vietnamese + English editorial serif & academic citations. */
  serif: serif.fontFamily,
};

if (typeof window !== 'undefined' && typeof FontFace !== 'undefined') {
  const handle = delayRender('Loading Sentient display font');
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
