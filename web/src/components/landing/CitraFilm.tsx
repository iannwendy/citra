import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Play, RotateCcw } from 'lucide-react';
import { SolvaEyebrow, SolvaPainterlyFrame, SolvaScrollReveal, SolvaTwoToneHeading, type Lang } from './SolvaPrimitives';

/* ============================================================
   CITRA 60-SECOND FILM — zero-cost-until-needed video embed
   ------------------------------------------------------------
   Performance contract (keeps the landing page at 120fps):
   1. Zero media bytes on the critical path: a CSS placeholder in a fixed 16:9 box
      (no CLS); the AVIF/WebP poster is requested only after window load + idle.
      The section opts into content-visibility:auto.
   2. A 4s muted 30fps teaser loop (~0.6MB AV1) is fetched only when the player is about one
      viewport away, plays only while >=35% visible, and is skipped entirely on
      Save-Data, slow connections and prefers-reduced-motion.
   3. The full film (with sound) is fetched only after the user clicks Play
      (hover/focus pre-fetches just the moov atom thanks to +faststart).
   4. Codec + resolution are picked at runtime with MediaCapabilities so we only
      choose a variant the device decodes smoothly AND power-efficiently
      (AV1 -> HEVC -> H.264), sized to rendered width x devicePixelRatio.
   5. No scroll listeners and no React state updates while scrolling — only
      IntersectionObserver callbacks. Every video pauses when off-screen.
   ============================================================ */

const BASE = '/media/citra-film-v1';

type Variant = { src: string; codecs: string; audio: boolean; width: number; height: number; bitrate: number };

const AAC = 'mp4a.40.2';

// Codec preference order within a resolution tier: AV1 -> HEVC -> H.264.
// Bitrates = measured average video bitrate (fed to MediaCapabilities.decodingInfo).
// Files: marketing/citra-promo/scripts/encode_web.sh (bump the -vN folder on re-encode: immutable cache).
const FILM_VARIANTS: Variant[] = [
  { src: `${BASE}/film-1440p.av1.mp4`, codecs: 'av01.0.12M.08', audio: true, width: 2560, height: 1440, bitrate: 1_950_000 },
  { src: `${BASE}/film-1080p.av1.mp4`, codecs: 'av01.0.09M.08', audio: true, width: 1920, height: 1080, bitrate: 1_300_000 },
  { src: `${BASE}/film-1080p.hevc.mp4`, codecs: 'hvc1.1.6.L123.B0', audio: true, width: 1920, height: 1080, bitrate: 1_600_000 },
  { src: `${BASE}/film-1080p.h264.mp4`, codecs: 'avc1.64002A', audio: true, width: 1920, height: 1080, bitrate: 2_250_000 },
  { src: `${BASE}/film-720p.av1.mp4`, codecs: 'av01.0.08M.08', audio: true, width: 1280, height: 720, bitrate: 730_000 },
  { src: `${BASE}/film-720p.h264.mp4`, codecs: 'avc1.640020', audio: true, width: 1280, height: 720, bitrate: 1_100_000 },
];

const TEASER_VARIANTS: Variant[] = [
  { src: `${BASE}/teaser-1080p.av1.mp4`, codecs: 'av01.0.08M.08', audio: false, width: 1920, height: 1080, bitrate: 1_250_000 },
  { src: `${BASE}/teaser-1080p.h264.mp4`, codecs: 'avc1.640028', audio: false, width: 1920, height: 1080, bitrate: 2_200_000 },
];

const mime = (v: Variant, withAudio = v.audio) => `video/mp4; codecs="${v.codecs}${withAudio ? `, ${AAC}` : ''}"`;

type NetworkInformationLike = { saveData?: boolean; effectiveType?: string };

function isConstrainedNetwork(): boolean {
  if (typeof navigator === 'undefined') return false;
  const conn = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  return Boolean(conn?.saveData) || ['slow-2g', '2g', '3g'].includes(conn?.effectiveType ?? '');
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * Choose the best variant for this device:
 *  - resolution tier = smallest tier covering ~85% of the physical pixels drawn,
 *    then fall back to lower tiers, then higher ones;
 *  - inside a tier keep codec preference, but only accept what MediaCapabilities
 *    reports as smooth + powerEfficient (hardware decode), else smooth, else supported.
 */
async function pickVariant(variants: Variant[], physicalWidth: number): Promise<Variant> {
  const tiers = [...new Set(variants.map((v) => v.width))].sort((a, b) => a - b);
  const wanted = tiers.find((w) => w >= physicalWidth * 0.85) ?? tiers[tiers.length - 1];
  const tierOrder = [...tiers.filter((w) => w <= wanted).reverse(), ...tiers.filter((w) => w > wanted)];
  const ordered = tierOrder.flatMap((w) => variants.filter((v) => v.width === w));

  const probe = typeof document !== 'undefined' ? document.createElement('video') : null;
  const mc = typeof navigator !== 'undefined' ? navigator.mediaCapabilities : undefined;

  let firstSmooth: Variant | null = null;
  let firstSupported: Variant | null = null;
  for (const v of ordered) {
    if (probe && probe.canPlayType(mime(v)) === '') continue;
    if (!mc?.decodingInfo) return v;
    try {
      const info = await mc.decodingInfo({
        type: 'file',
        video: { contentType: mime(v, false), width: v.width, height: v.height, bitrate: v.bitrate, framerate: 60 },
      });
      if (!info.supported) continue;
      if (info.smooth && info.powerEfficient) return v;
      if (info.smooth) firstSmooth ??= v;
      firstSupported ??= v;
    } catch {
      firstSupported ??= v;
    }
  }
  return firstSmooth ?? firstSupported ?? variants[variants.length - 1];
}

/** Run non-urgent media work (decoder init, first-frame decode) outside busy scroll frames. */
function whenIdle(fn: () => void) {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) window.requestIdleCallback(fn, { timeout: 400 });
  else setTimeout(fn, 120);
}

type Mode = 'poster' | 'film' | 'ended';

function CitraFilmPlayer({ lang }: { lang: Lang }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const teaserRef = useRef<HTMLVideoElement>(null);
  const filmRef = useRef<HTMLVideoElement>(null);
  const visibleRef = useRef(false);
  const autoPausedRef = useRef(false);

  const [mode, setMode] = useState<Mode>('poster');
  const [near, setNear] = useState(false);
  const [warm, setWarm] = useState(false);
  const [teaserSrc, setTeaserSrc] = useState<string | null>(null);
  const [teaserReady, setTeaserReady] = useState(false);
  const [filmSrc, setFilmSrc] = useState<string | null>(null);

  // 1) Proximity (one viewport ahead): resolve which files this device should use.
  //    MediaCapabilities queries cost no network; the teaser starts streaming here.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: '100% 0px' },
    );
    // Never compete with the critical path: start observing only after window `load` + idle,
    // so the teaser can't steal bandwidth from hero images/fonts/JS (LCP).
    let cancelled = false;
    const arm = () => whenIdle(() => !cancelled && io.observe(el));
    if (document.readyState === 'complete') arm();
    else window.addEventListener('load', arm, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener('load', arm);
      io.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    const physical = (boxRef.current?.clientWidth ?? 1120) * Math.min(window.devicePixelRatio || 1, 2);
    const constrained = isConstrainedNetwork();
    void pickVariant(constrained ? FILM_VARIANTS.filter((v) => v.width <= 1280) : FILM_VARIANTS, physical).then(
      (v) => !cancelled && setFilmSrc(v.src),
    );
    if (!constrained && !prefersReducedMotion()) {
      void pickVariant(TEASER_VARIANTS, physical).then((v) => whenIdle(() => !cancelled && setTeaserSrc(v.src)));
    }
    return () => {
      cancelled = true;
    };
  }, [near]);

  // 2) Visibility: teaser / film only play while on screen.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => {
        const visible = entry.isIntersecting && entry.intersectionRatio >= 0.35;
        visibleRef.current = visible;
        const teaser = teaserRef.current;
        if (teaser && mode === 'poster') {
          if (visible) whenIdle(() => visibleRef.current && void teaser.play().catch(() => undefined));
          else teaser.pause();
        }
        const film = filmRef.current;
        if (film && mode === 'film') {
          if (!visible && !film.paused) {
            film.pause();
            autoPausedRef.current = true;
          } else if (visible && autoPausedRef.current) {
            autoPausedRef.current = false;
            void film.play().catch(() => undefined);
          }
        }
      },
      { threshold: [0, 0.35] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mode, teaserSrc]);

  // 3) Start the film synchronously inside the click's commit (layout effect),
  //    so Safari/iOS still treat play() as user-initiated (sound allowed).
  useLayoutEffect(() => {
    if (mode !== 'film') return;
    const film = filmRef.current;
    if (!film) return;
    autoPausedRef.current = false;
    void film.play().catch(() => undefined);
  }, [mode]);

  const startFilm = () => {
    teaserRef.current?.pause();
    if (!filmSrc) setFilmSrc(`${BASE}/film-1080p.h264.mp4`); // universal safety net
    setMode('film');
  };

  const label = lang === 'vi' ? 'Xem phim giới thiệu CITRA' : 'Watch the CITRA film';

  return (
    <div
      ref={boxRef}
      onPointerEnter={() => setWarm(true)}
      onFocusCapture={() => setWarm(true)}
      className="relative w-full overflow-hidden rounded-[12px] sm:rounded-[14px] bg-[#FAF8F3] shadow-[0_40px_80px_-32px_rgba(28,26,21,0.45),0_0_0_1px_rgba(28,26,21,0.08)]"
      style={{ aspectRatio: '16 / 9', contain: 'layout paint', isolation: 'isolate' }}
    >
      {mode !== 'film' && (
        <>
          {/* Until armed (window load + idle) render only a CSS placeholder: on mobile, Chrome's lazy-load
              distance is large enough that even a lazy <img> here would compete with the hero LCP image. */}
          {!near && (
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={{ background: 'radial-gradient(60% 60% at 50% 45%, #FBFAF6 0%, #EEF1EA 55%, #C9DCD8 100%)' }}
            />
          )}
          {near && (
          <picture>
            <source
              type="image/avif"
              srcSet={`${BASE}/poster-1280.avif 1280w, ${BASE}/poster-2560.avif 2560w`}
              sizes="(min-width: 1280px) 1120px, 92vw"
            />
            <source
              type="image/webp"
              srcSet={`${BASE}/poster-1280.webp 1280w, ${BASE}/poster-2560.webp 2560w`}
              sizes="(min-width: 1280px) 1120px, 92vw"
            />
            <img
              src={`${BASE}/poster-1280.jpg`}
              alt=""
              width={1280}
              height={720}
              loading="lazy"
              decoding="async"
              {...{ fetchpriority: 'low' }}
              className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none"
            />
          </picture>
          )}

          {teaserSrc && mode === 'poster' && (
            <video
              ref={teaserRef}
              src={teaserSrc}
              muted
              loop
              playsInline
              preload="auto"
              disablePictureInPicture
              disableRemotePlayback
              aria-hidden="true"
              tabIndex={-1}
              onCanPlay={(e) => {
                const el = e.currentTarget;
                whenIdle(() => visibleRef.current && void el.play().catch(() => undefined));
              }}
              onPlaying={() => setTeaserReady(true)}
              className="absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-500 ease-out"
              style={{ opacity: teaserReady ? 1 : 0 }}
            />
          )}

          <div className="solva-noise-overlay" aria-hidden="true" />
          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'radial-gradient(75% 75% at 50% 55%, rgba(28,26,21,0) 45%, rgba(28,26,21,0.32) 100%)' }}
          />

          <button
            type="button"
            onClick={startFilm}
            aria-label={label}
            data-testid="citra-film-play"
            className="group absolute inset-0 flex items-center justify-center focus-visible:outline-none"
          >
            <span className="flex items-center gap-3 sm:gap-4 rounded-full bg-[#1C1A15]/90 text-[#FBFAF6] pl-2 pr-5 sm:pl-2.5 sm:pr-7 py-2 sm:py-2.5 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.6)] ring-1 ring-white/10 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.04] group-active:scale-[0.98] group-focus-visible:ring-2 group-focus-visible:ring-[#9FD3B5]">
              <span className="flex h-10 w-10 sm:h-14 sm:w-14 items-center justify-center rounded-full bg-[#FBFAF6] text-[#1C1A15]">
                {mode === 'ended' ? (
                  <RotateCcw className="h-5 w-5 sm:h-6 sm:w-6" />
                ) : (
                  <Play className="h-5 w-5 sm:h-6 sm:w-6 translate-x-[1px] fill-current" />
                )}
              </span>
              <span className="flex flex-col items-start leading-tight">
                <span className="font-solva-sans text-[15px] sm:text-[18px] font-medium">
                  {mode === 'ended'
                    ? lang === 'vi'
                      ? 'Xem lại'
                      : 'Watch again'
                    : lang === 'vi'
                      ? 'Xem phim'
                      : 'Watch the film'}
                </span>
                <span className="font-mono text-[10px] sm:text-[11px] tracking-[0.12em] text-[#FBFAF6]/60 uppercase">
                  1:00 · {lang === 'vi' ? 'bật âm thanh' : 'sound on'}
                </span>
              </span>
            </span>
          </button>
        </>
      )}

      {mode === 'film' && filmSrc && (
        <video
          ref={filmRef}
          src={filmSrc}
          controls
          playsInline
          preload="auto"
          aria-label={label}
          onEnded={() => setMode('ended')}
          className="absolute inset-0 w-full h-full bg-[#FAF8F3] object-contain"
        />
      )}

      {/* Hover/focus warm-up: fetch only the moov atom (+faststart) so Play starts instantly. */}
      {mode === 'poster' && warm && filmSrc && (
        <video src={filmSrc} preload="metadata" muted className="hidden" aria-hidden="true" tabIndex={-1} />
      )}
    </div>
  );
}

export function SolvaFilmSection({ lang }: { lang: Lang }) {
  return (
    <section
      id="film"
      data-testid="citra-film-section"
      className="scroll-mt-[84px] lg:scroll-mt-[108px] py-[32px] sm:py-[48px] lg:py-[96px] px-5 sm:px-6 lg:px-[40px]"
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 960px' }}
    >
      <div className="max-w-[1200px] mx-auto flex flex-col gap-[24px] sm:gap-[32px] lg:gap-[56px]">
        <div className="flex flex-col items-start gap-[12px] sm:gap-[16px] max-w-[680px]">
          <SolvaEyebrow>{lang === 'vi' ? 'Phim giới thiệu · 60 giây' : 'The 60-second film'}</SolvaEyebrow>
          <SolvaTwoToneHeading
            primary={lang === 'vi' ? 'Khám phá CITRA trong 60 giây.' : 'See CITRA in sixty seconds.'}
            secondary={lang === 'vi' ? 'Từ lúc tải lên đến phán quyết có giải thích.' : 'From upload to an explained verdict.'}
          />
        </div>

        {/* blurPx=0: a CSS filter on an ancestor of a playing <video> forces re-rasterisation every frame. */}
        <SolvaScrollReveal yOffset={28} scaleFrom={0.985} blurPx={0}>
          <SolvaPainterlyFrame paintingSrc="/solva/usecase-2-bg.webp" alt="" className="w-full p-3 sm:p-6 lg:p-[40px]">
            <CitraFilmPlayer lang={lang} />
          </SolvaPainterlyFrame>
        </SolvaScrollReveal>
      </div>
    </section>
  );
}
