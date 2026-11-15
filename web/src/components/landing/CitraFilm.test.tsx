import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  FILM_MEDIA_BASE,
  FILM_VARIANTS,
  SolvaFilmSection,
  pickVariant,
} from './CitraFilm';

describe('CitraFilm 90s · 120fps hybrid ladder & landing section', () => {
  it('points to /media/citra-film-v2 and provides both 120fps high-tier and 60fps fallback variants', () => {
    expect(FILM_MEDIA_BASE).toBe('/media/citra-film-v2');
    expect(FILM_VARIANTS.every((v) => v.src.startsWith('/media/citra-film-v2/'))).toBe(true);
    expect(FILM_VARIANTS.some((v) => v.fps === 120 && v.width === 2560)).toBe(true);
    expect(FILM_VARIANTS.some((v) => v.fps === 120 && v.width === 1920)).toBe(true);
    expect(FILM_VARIANTS.some((v) => v.fps === 60 && v.width === 1920)).toBe(true);
    expect(FILM_VARIANTS.some((v) => v.fps === 60 && v.width === 1280)).toBe(true);
  });

  it('probes MediaCapabilities with actual variant framerate (120 vs 60) and falls back cleanly on 60Hz decoders', async () => {
    const origCreate = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'video') {
        Object.defineProperty(el, 'canPlayType', {
          value: () => 'probably',
        });
      }
      return el;
    }) as typeof document.createElement);

    const seenFramerates: number[] = [];
    const origMc = navigator.mediaCapabilities;
    Object.defineProperty(navigator, 'mediaCapabilities', {
      configurable: true,
      value: {
        decodingInfo: vi.fn(async (cfg: { video: { framerate: number } }) => {
          seenFramerates.push(cfg.video.framerate);
          const is120 = cfg.video.framerate === 120;
          return {
            supported: true,
            smooth: !is120,
            powerEfficient: !is120,
          };
        }),
      },
    });

    try {
      const chosen = await pickVariant(FILM_VARIANTS, 1920);
      expect(seenFramerates).toContain(120);
      expect(seenFramerates).toContain(60);
      expect(chosen.fps).toBe(60);
      expect(chosen.width).toBe(1920);
    } finally {
      createSpy.mockRestore();
      Object.defineProperty(navigator, 'mediaCapabilities', {
        configurable: true,
        value: origMc,
      });
    }
  });

  it('renders updated 90-second / 1:30 · 120fps bilingual labels and mounts v2 fallback stream on play', () => {
    const playStub = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => Promise.resolve());

    try {
      const { unmount } = render(<SolvaFilmSection lang="vi" />);
      expect(screen.getByText(/90 giây/i)).toBeTruthy();
      expect(screen.getByText(/1:30/)).toBeTruthy();

      fireEvent.click(screen.getByTestId('citra-film-play'));
      const video = screen.getByLabelText('Xem phim giới thiệu CITRA') as HTMLVideoElement;
      expect(video.getAttribute('src')).toContain('/media/citra-film-v2/');
      unmount();

      render(<SolvaFilmSection lang="en" />);
      expect(screen.getByText(/90-second film/i)).toBeTruthy();
      expect(screen.getByTestId('citra-film-section').textContent).toMatch(/ninety seconds/i);
    } finally {
      playStub.mockRestore();
    }
  });

  it('ships every citra-film-v2 video stream, teaser, and responsive poster non-empty on disk and removes citra-film-v1', () => {
    const publicDir = path.resolve(__dirname, '../../../public');
    expect(fs.existsSync(path.join(publicDir, 'media/citra-film-v1'))).toBe(false);

    const expectedAssets = [
      ...FILM_VARIANTS.map((v) => v.src),
      `${FILM_MEDIA_BASE}/teaser-1080p.av1.mp4`,
      `${FILM_MEDIA_BASE}/teaser-1080p.h264.mp4`,
      `${FILM_MEDIA_BASE}/poster-2560.avif`,
      `${FILM_MEDIA_BASE}/poster-2560.webp`,
      `${FILM_MEDIA_BASE}/poster-1280.avif`,
      `${FILM_MEDIA_BASE}/poster-1280.webp`,
      `${FILM_MEDIA_BASE}/poster-1280.jpg`,
    ];

    for (const rel of expectedAssets) {
      const abs = path.join(publicDir, rel.replace(/^\//, ''));
      expect(fs.existsSync(abs), `missing asset: ${abs}`).toBe(true);
      expect(fs.statSync(abs).size, `empty asset: ${abs}`).toBeGreaterThan(10_000);
    }
  });
});
