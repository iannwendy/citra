import { useState, useEffect, useRef, type CSSProperties } from 'react';
import {
  CheckCircle2,
  FileText,
  Database,
  GitBranch,
  Scale,
  Check,
  Layers,
  Sparkles,
  ArrowRight,
  GraduationCap,
} from 'lucide-react';
import { type Lang } from './SolvaPrimitives';
import {
  getPlainVerdictLabel,
  getPlainMappingLabel,
} from '@/lib/verdictExplanation';
import { ScholarlySourceLogo, getScholarlySourceUrl } from './ScholarlySourceLogos';
import { SubtleNumber } from '@/components/ui/transitions';

/* ============================================================
   SOLVA FLOATING UI MOCKUP CARDS (WITH 8PX FROSTED GLASS RING)
   Placed over Impressionist Oil Paintings + 5% Film Grain Noise
   With Latched One-Shot Entrance & Honest Live Micro-Telemetry
   ============================================================ */

function isOSReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Shared One-Shot IntersectionObserver Hook for Floral Demo Cards.
 * - Latches permanently on first viewport intersection (`replayIntervalMs = 0` by default)
 *   so metrics count up once on arrival and never zero-reset while the user reads.
 */
export function useFloralCardAnimation(replayIntervalMs = 0) {
  const reduced = isOSReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const hasEnteredRef = useRef<boolean>(reduced);
  const [isVisible, setIsVisible] = useState<boolean>(reduced);
  const [replaySeed, setReplaySeed] = useState<number>(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      hasEnteredRef.current = true;
      setIsVisible(true);
      setReplaySeed(1);
      return;
    }

    const el = containerRef.current;
    if (!el || typeof window === 'undefined') return;

    if (typeof IntersectionObserver === 'undefined') {
      hasEnteredRef.current = true;
      setIsVisible(true);
      setReplaySeed(1);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          if (!hasEnteredRef.current) {
            hasEnteredRef.current = true;
            setIsVisible(true);
            setReplaySeed(1);
            if (replayIntervalMs <= 0) {
              observer.disconnect();
            }
          } else if (replayIntervalMs > 0) {
            setIsVisible(true);
          }
        } else if (replayIntervalMs > 0) {
          setIsVisible(false);
        }
      },
      { threshold: 0.14 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [replayIntervalMs, reduced]);

  useEffect(() => {
    if (reduced || !isVisible || replayIntervalMs <= 0) return;
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      setReplaySeed((prev) => prev + 1);
    }, replayIntervalMs);
    return () => window.clearInterval(timer);
  }, [isVisible, replayIntervalMs, reduced]);

  const getStaggerStyle = (delayMs = 0): CSSProperties => ({
    opacity: isVisible ? 1 : 0.001,
    transform: isVisible ? 'translate3d(0, 0, 0)' : 'translate3d(0, 14px, 0)',
    filter: isVisible ? 'none' : 'blur(2.5px)',
    transitionProperty: reduced
      ? 'none'
      : 'opacity, transform, filter, background-color, border-color',
    transitionDuration: isVisible ? '620ms' : '320ms',
    transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
    transitionDelay: isVisible ? `${delayMs}ms` : '0ms',
  });

  return { containerRef, isVisible, replaySeed, getStaggerStyle };
}

function formatSolvaLiveNumber(
  num: number,
  decimals: number,
  padDigits: number,
  formatThousands: boolean,
  thousandSeparator: string,
  decimalSeparator: string,
  prefix: string,
  suffix: string
): string {
  const safeNum = Math.abs(num) < 1e-9 ? 0 : num;
  const fixed = safeNum.toFixed(decimals);
  let body: string;
  if (padDigits > 0 && decimals === 0) {
    body = Math.round(safeNum).toString().padStart(padDigits, '0');
  } else if (!formatThousands) {
    body = decimalSeparator !== '.' ? fixed.replace('.', decimalSeparator) : fixed;
  } else {
    const [intPart, decPart] = fixed.split('.');
    const withSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousandSeparator);
    body = decPart !== undefined ? `${withSep}${decimalSeparator}${decPart}` : withSep;
  }
  return `${prefix}${body}${suffix}`;
}

/**
 * Smooth Quartic Ease-Out Animated Number (`SolvaLiveNumber`)
 * One-shot count-up on initial floral card entrance (`replaySeed: 0 -> 1`).
 * Updates DOM `textContent` directly in `requestAnimationFrame` to avoid React re-renders.
 */
export function SolvaLiveNumber({
  value,
  startValue = 0,
  decimals = 0,
  padDigits = 0,
  prefix = '',
  suffix = '',
  durationMs = 1450,
  replaySeed = 0,
  formatThousands = false,
  thousandSeparator = ',',
  decimalSeparator = '.',
  className = '',
}: {
  value: number;
  startValue?: number;
  decimals?: number;
  padDigits?: number;
  prefix?: string;
  suffix?: string;
  durationMs?: number;
  replaySeed?: number;
  formatThousands?: boolean;
  thousandSeparator?: string;
  decimalSeparator?: string;
  className?: string;
}) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const currentValRef = useRef<number>(value);
  const prevSeedRef = useRef<number>(replaySeed);
  const prevTargetRef = useRef<number>(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || isOSReducedMotion()) {
      currentValRef.current = value;
      return;
    }

    const seedChanged = replaySeed !== prevSeedRef.current;
    const targetChanged = value !== prevTargetRef.current;
    prevSeedRef.current = replaySeed;
    prevTargetRef.current = value;

    if (!seedChanged && !targetChanged && replaySeed === 0) {
      currentValRef.current = value;
      return;
    }

    const fromVal = seedChanged
      ? startValue
      : targetChanged
        ? currentValRef.current
        : startValue;
    const activeDuration =
      seedChanged && !targetChanged ? durationMs : Math.min(durationMs, 1050);

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }

    const clock = () => Date.now();
    let startTime: number | null = null;
    let lastText = '';

    const tick = () => {
      const now = clock();
      if (startTime === null) {
        startTime = now;
      }
      const elapsed = Math.max(0, now - startTime);
      const progress = Math.max(0, Math.min(1, elapsed / Math.max(140, activeDuration)));
      const eased = 1 - Math.pow(1 - progress, 4);
      const next = progress < 1 ? fromVal + (value - fromVal) * eased : value;
      currentValRef.current = next;

      if (spanRef.current) {
        const text = formatSolvaLiveNumber(
          next,
          decimals,
          padDigits,
          formatThousands,
          thousandSeparator,
          decimalSeparator,
          prefix,
          suffix
        );
        if (text !== lastText) {
          spanRef.current.textContent = text;
          lastText = text;
        }
      }

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [
    value,
    startValue,
    durationMs,
    replaySeed,
    decimals,
    padDigits,
    formatThousands,
    thousandSeparator,
    decimalSeparator,
    prefix,
    suffix,
  ]);

  const formattedTarget = formatSolvaLiveNumber(
    value,
    decimals,
    padDigits,
    formatThousands,
    thousandSeparator,
    decimalSeparator,
    prefix,
    suffix
  );

  return (
    <span ref={spanRef} className={`tabular-nums ${className}`}>
      {formattedTarget}
    </span>
  );
}

/**
 * 1. HERO DASHBOARD MOCKUP
 * Fully framed on all 4 sides inside the padded `SolvaPainterlyFrame` oil painting backdrop,
 * surrounded by Solva's signature `0 0 0 8px rgba(255,255,255,0.5)` frosted glass ring.
 */
export function HeroVerificationMockup({
  lang,
  activeStep,
  onSelectStep,
}: {
  lang: Lang;
  activeStep: number;
  onSelectStep?: (step: number) => void;
}) {
  const { containerRef, isVisible, replaySeed } = useFloralCardAnimation();
  const [activeApiPulse, setActiveApiPulse] = useState(0);

  useEffect(() => {
    if (!isVisible) return;
    const timer = window.setInterval(() => {
      setActiveApiPulse((prev) => (prev + 1) % 3);
    }, 1050);
    return () => window.clearInterval(timer);
  }, [isVisible]);

  const citations = [
    {
      marker: '[1]',
      ref: 'Vaswani et al. (2017)',
      title: 'Attention Is All You Need',
      doi: '10.48550/arXiv.1706.03762',
      l1: 'MATCHED',
      l2: 'VERIFIED',
      confNum: 99,
      nliScore: 0.96,
      cisScore: 92.4,
      latencies: [38, 52, 61],
      tone: 'emerald' as const,
    },
    {
      marker: '[2]',
      ref: 'Devlin et al. (2018)',
      title: 'BERT: Pre-training of Deep Bidirectional Transformers',
      doi: '10.18653/v1/N19-1423',
      l1: 'MATCHED',
      l2: 'METADATA_ERROR',
      confNum: 84,
      nliScore: 0.94,
      cisScore: 88.6,
      latencies: [44, 57, 68],
      tone: 'amber' as const,
    },
    {
      marker: '[3]',
      ref: 'Robertson & Walker (2024)',
      title: 'Quantum Hyper-Graphs in Zero-Shot Hallucination',
      doi: '10.1038/s41586-024-99999-z',
      l1: 'MATCHED',
      l2: 'SUSPECTED_HALLUCINATION',
      confNum: 11,
      nliScore: 0.0,
      cisScore: 92.4,
      latencies: [51, 63, 79],
      tone: 'red' as const,
    },
  ];

  const selected = citations[activeStep % citations.length];
  const apiSources = [
    { name: 'Crossref', ms: selected.latencies[0] },
    { name: 'OpenAlex', ms: selected.latencies[1] },
    { name: 'Semantic Scholar', ms: selected.latencies[2] },
  ];

  return (
    <div
      ref={containerRef}
      style={{
        backgroundColor: 'var(--solva-card-elevated)',
      }}
      className="solva-glass-ring rounded-[10px] w-full max-w-full border border-[#E7E3D9]/80 dark:border-[#332F26] overflow-visible text-left select-none"
    >
      {/* Top Window Chrome (Row 1: Title Bar with dedicated unobstructed right slot for scan badge) */}
      <div
        data-testid="hero-mockup-titlebar"
        style={{ borderColor: 'var(--solva-border)' }}
        className="px-2.5 sm:px-3.5 py-2 border-b rounded-t-[10px] flex items-center justify-between gap-2 bg-[#FBFAF6]/90 dark:bg-[#1E1C17] min-h-[36px] min-w-0"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5 shrink-0" aria-label="macOS window controls">
            <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-[#FF5F56] border border-[#E0443E]/60 shadow-sm" />
            <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123]/60 shadow-sm" />
            <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-[#27C93F] border border-[#1AAB29]/60 shadow-sm" />
          </div>
          <span
            style={{ color: 'var(--solva-ink)' }}
            className="text-[11px] sm:text-[12px] font-medium leading-tight break-all sm:break-normal min-w-0 ml-0.5"
          >
            thesis_citation_audit_2026.pdf
          </span>
        </div>
      </div>

      {/* Row 2: Dedicated Non-Overlapping Workspace Meta Bar (Libraries + Score) */}
      <div
        data-testid="hero-mockup-metabar"
        style={{ borderColor: 'var(--solva-border)' }}
        className="px-2.5 sm:px-3.5 py-1.5 border-b flex flex-wrap items-center justify-between gap-x-2 gap-y-1 bg-[#F4F2EC]/65 dark:bg-[#181612]/90 min-w-0"
      >
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[5px] bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300 font-mono text-[10px] font-medium shrink-0 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>
            {lang === 'vi' ? 'PDF · DOCX · 15+ Thư viện' : 'PDF · DOCX · 15+ Libraries'}
          </span>
        </span>
        <span
          style={{
            backgroundColor: 'var(--solva-card-elevated)',
            color: 'var(--solva-ink)',
            borderColor: 'var(--solva-border)',
          }}
          className="px-2 py-0.5 rounded-[5px] border font-mono text-[10px] font-semibold shrink-0 whitespace-nowrap"
        >
          {lang === 'vi' ? 'Điểm:' : 'Score:'}{' '}
          <SubtleNumber
            value={
              lang === 'vi'
                ? selected.cisScore.toFixed(1).replace('.', ',')
                : selected.cisScore.toFixed(1)
            }
          />
        </span>
      </div>

      {/* Two-Column Workspace Preview */}
      <div className="grid sm:grid-cols-12 min-w-0">
        {/* Left Queue */}
        <div
          style={{ borderColor: 'var(--solva-border)' }}
          className="sm:col-span-5 min-w-0 p-2.5 sm:p-3 border-b sm:border-b-0 sm:border-r space-y-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-1.5 text-[10px] font-mono">
            <span style={{ color: 'var(--solva-muted)' }} className="leading-tight">
              {lang === 'vi' ? 'TÀI LIỆU TRONG BÀI' : 'REFERENCES IN PAPER'}
            </span>
            <span
              style={{ color: 'var(--solva-ink)' }}
              className="font-semibold shrink-0 whitespace-nowrap"
            >
              <SolvaLiveNumber value={24} replaySeed={replaySeed} durationMs={1350} />{' '}
              {lang === 'vi' ? 'mục' : 'refs'}
            </span>
          </div>

          {citations.map((item, idx) => {
            const isActive = idx === activeStep % citations.length;
            const plainVerdict = getPlainVerdictLabel(item.l2, lang);
            return (
              <div
                key={item.marker}
                role="button"
                tabIndex={0}
                aria-pressed={isActive}
                onClick={() => onSelectStep?.(idx)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectStep?.(idx);
                  }
                }}
                style={{
                  backgroundColor: isActive ? 'var(--solva-surface)' : 'transparent',
                  borderColor: isActive ? 'var(--solva-ink)' : 'var(--solva-border)',
                }}
                className="p-2 sm:p-2.5 rounded-[8px] border transition-[background-color,border-color,opacity,box-shadow] duration-300 cursor-pointer hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1C1A15] dark:focus-visible:ring-[#FBFAF6]"
              >
                <div className="flex items-start justify-between gap-1.5 mb-1">
                  <span
                    style={{ color: 'var(--solva-ink)' }}
                    className="text-[11.5px] sm:text-[12px] font-medium leading-snug min-w-0"
                  >
                    {item.marker} {item.ref}
                  </span>
                  <span className="font-mono text-[10px] font-semibold text-[#56524A] dark:text-[#A8A296] shrink-0 whitespace-nowrap">
                    <SolvaLiveNumber
                      value={item.confNum}
                      suffix="%"
                      replaySeed={replaySeed}
                      durationMs={1250 + idx * 140}
                    />
                  </span>
                </div>
                <p
                  style={{ color: 'var(--solva-muted)' }}
                  className="text-[11px] leading-snug mb-1.5"
                >
                  {item.title}
                </p>
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <span
                    className={`text-[9.5px] font-medium px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap ${
                      item.tone === 'emerald'
                        ? 'bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300'
                        : item.tone === 'amber'
                          ? 'bg-amber-500/[0.12] text-amber-800 dark:text-amber-300'
                          : 'bg-red-500/[0.12] text-red-700 dark:text-red-300'
                    }`}
                  >
                    {plainVerdict.label}
                  </span>
                  {isActive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Right Live Verdict Trace */}
        <div
          key={selected.marker}
          className="sm:col-span-7 min-w-0 p-3 sm:p-3.5 xl:p-4 space-y-2.5 sm:space-y-3 animate-debugger-switch"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div
                style={{ color: 'var(--solva-muted)' }}
                className="text-[10px] font-mono uppercase tracking-wider"
              >
                {lang === 'vi' ? 'CHI TIẾT KIỂM TRA' : 'CITATION CHECK'}{' '}
                {selected.marker}
              </div>
              <div
                style={{ color: 'var(--solva-ink)' }}
                className="text-[13px] sm:text-[14px] font-medium leading-snug mt-0.5"
              >
                {selected.title}
              </div>
            </div>
            <span
              style={{
                backgroundColor: 'var(--solva-btn-bg)',
                color: 'var(--solva-btn-fg)',
              }}
              className="px-2 py-0.5 rounded-[5px] text-[10px] font-medium shrink-0 whitespace-nowrap"
            >
              {getPlainMappingLabel(selected.l1, lang).label}
            </span>
          </div>

          {/* Field-by-field mini diff */}
          <div
            style={{
              backgroundColor: 'var(--solva-surface)',
              borderColor: 'var(--solva-border)',
            }}
            className="rounded-[8px] p-2.5 border space-y-1.5 text-[11px]"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <div className="inline-flex items-center gap-1.5 min-w-0">
                <span style={{ color: 'var(--solva-muted)' }} className="font-mono shrink-0">
                  DOI:
                </span>
                <span
                  style={{ color: 'var(--solva-ink)' }}
                  className="font-mono break-all sm:break-normal min-w-0"
                >
                  {selected.doi}
                </span>
              </div>
              <span
                className={`font-mono text-[10px] font-semibold shrink-0 whitespace-nowrap ${
                  selected.tone === 'red'
                    ? 'text-red-700 dark:text-red-300'
                    : 'text-emerald-700 dark:text-emerald-300'
                }`}
              >
                {selected.tone === 'red'
                  ? lang === 'vi'
                    ? '404 Không tồn tại'
                    : 'Not Found (404)'
                  : lang === 'vi'
                    ? '100% Khớp chuẩn'
                    : '100% Match'}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
              <span style={{ color: 'var(--solva-muted)' }} className="shrink-0">
                {lang === 'vi' ? 'Chi tiết:' : 'Finding:'}
              </span>
              <span style={{ color: 'var(--solva-ink)' }} className="font-medium">
                {selected.tone === 'emerald' ? (
                  lang === 'vi' ? (
                    'Khớp tên bài, tác giả & năm'
                  ) : (
                    'Title, authors & year match'
                  )
                ) : selected.tone === 'amber' ? (
                  lang === 'vi' ? (
                    <>
                      Lệch năm xuất bản{' '}
                      <span className="citra-nowrap-tail whitespace-nowrap">(ghi 2018 · gốc 2019)</span>
                    </>
                  ) : (
                    <>
                      Year differs{' '}
                      <span className="citra-nowrap-tail whitespace-nowrap">(cited 2018 vs. 2019)</span>
                    </>
                  )
                ) : lang === 'vi' ? (
                  'Không có trên 15+ thư viện'
                ) : (
                  'Not found in 15+ libraries'
                )}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
              <span style={{ color: 'var(--solva-muted)' }} className="shrink-0">
                {lang === 'vi' ? 'Nội dung trích dẫn:' : 'Content match:'}
              </span>
              <span
                className={`font-medium ${
                  selected.tone === 'red'
                    ? 'text-red-700 dark:text-red-300'
                    : 'text-emerald-700 dark:text-emerald-300'
                }`}
              >
                {selected.tone === 'red' ? (
                  lang === 'vi' ? (
                    <>
                      Chưa đối chiếu{' '}
                      <span className="citra-nowrap-tail whitespace-nowrap">(Thiếu nguồn)</span>
                    </>
                  ) : (
                    <>
                      Cannot check{' '}
                      <span className="citra-nowrap-tail whitespace-nowrap">(No source)</span>
                    </>
                  )
                ) : (
                  <span className="citra-nowrap-tail whitespace-nowrap">
                    {lang === 'vi' ? 'Khớp nội dung (' : 'Matches claim ('}
                    <SubtleNumber value={Math.round(selected.nliScore * 100)} suffix="%" />)
                  </span>
                )}
              </span>
            </div>
          </div>

          {/* Source pills */}
          <div className="space-y-1.5">
            <div
              style={{ color: 'var(--solva-muted)' }}
              className="text-[10px] font-mono uppercase"
            >
              {lang === 'vi'
                ? 'ĐỐI CHIẾU TRÊN 15+ THƯ VIỆN HỌC THUẬT'
                : 'CHECKED ACROSS 15+ ACADEMIC LIBRARIES'}
            </div>
            <div className="flex flex-wrap gap-1.5 text-[10px] font-mono">
              {apiSources.map((s, idx) => {
                const isPulsing = idx === activeApiPulse;
                const liveMs = isPulsing ? Math.max(1, s.ms - 1) : s.ms;
                const href = getScholarlySourceUrl(s.name) ?? '#';
                return (
                  <a
                    key={s.name}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${s.name} official website`}
                    style={{
                      backgroundColor: isPulsing
                        ? 'var(--solva-surface)'
                        : 'var(--solva-bg)',
                      borderColor: isPulsing
                        ? 'var(--solva-ink)'
                        : 'var(--solva-border)',
                    }}
                    className="group flex-1 min-w-fit px-2 py-1.5 rounded-[6px] border inline-flex items-center justify-between gap-1.5 shrink-0 whitespace-nowrap transition-[background-color,border-color] duration-300 hover:border-[#1C1A15]/60 dark:hover:border-[#FBFAF6]/50 cursor-pointer"
                  >
                    <span
                      style={{ color: 'var(--solva-ink)' }}
                      className="inline-flex items-center gap-1 whitespace-nowrap group-hover:underline underline-offset-2"
                    >
                      <ScholarlySourceLogo name={s.name} size={11} />
                      <span>{s.name}</span>
                    </span>
                    <span
                      style={{ color: 'var(--solva-muted)' }}
                      className="shrink-0 whitespace-nowrap"
                    >
                      <SubtleNumber value={liveMs} suffix="ms" />
                    </span>
                  </a>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 2. THREE FEATURE CARD FLOATING WIDGETS (288x288px inside 384x336px oil painting frame)
 */
export function FeatureCardWidget({
  index,
  lang,
}: {
  index: 0 | 1 | 2;
  lang: Lang;
}) {
  const { containerRef, isVisible, replaySeed, getStaggerStyle } = useFloralCardAnimation();
  const [cycleStep, setCycleStep] = useState(0);

  useEffect(() => {
    if (!isVisible) return;
    const intervalMs = index === 1 ? 1100 : 2300;
    const maxSteps = index === 1 ? 5 : 3;
    const timer = window.setInterval(() => {
      setCycleStep((prev) => (prev + 1) % maxSteps);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [index, isVisible]);

  if (index === 0) {
    // Widget 1: Two-Part Check (In-text <-> Reference List & Library Existence)
    const refNums = [14, 18, 14];
    const activeRefNum = refNums[cycleStep % refNums.length];
    const highlightL1 = cycleStep === 0 || cycleStep === 2;
    const highlightL2 = cycleStep === 1 || cycleStep === 2;

    return (
      <div
        ref={containerRef}
        style={{
          backgroundColor: 'var(--solva-card-elevated)',
          ...getStaggerStyle(0),
        }}
        className="solva-glass-ring w-full max-w-[296px] min-h-[272px] sm:min-h-[288px] h-auto rounded-[16px] p-3.5 sm:p-4 flex flex-col justify-between gap-2.5 text-left border border-[#E7E3D9]/70 dark:border-[#332F26]"
      >
        <div
          style={getStaggerStyle(40)}
          className="flex flex-wrap items-center justify-between gap-1.5"
        >
          <span
            style={{ color: 'var(--solva-ink)' }}
            className="text-[12px] font-medium flex items-center gap-1.5 min-w-0"
          >
            <Layers className="w-3.5 h-3.5 shrink-0" />
            <span>
              {lang === 'vi' ? 'Kiểm tra 2 phần rõ ràng' : 'Two-Part Citation Check'}
            </span>
          </span>
          <span className="citra-nowrap-tail whitespace-nowrap shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#F4F2EC] dark:bg-[#29261F] text-[#56524A] dark:text-[#A8A296]">
            {lang === 'vi' ? 'Phần 1 + 2' : 'Part 1 + 2'}
          </span>
        </div>

        <div className="space-y-2 my-auto">
          <div
            style={{
              ...getStaggerStyle(110),
              backgroundColor: 'var(--solva-surface)',
              borderColor: highlightL1 ? 'var(--solva-ink)' : 'transparent',
            }}
            className="p-2.5 rounded-[10px] border space-y-1 transition-[border-color,background-color] duration-500"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[10px] font-mono">
              <span style={{ color: 'var(--solva-muted)' }}>
                {lang === 'vi' ? 'PHẦN 1 · TRONG BÀI VIẾT' : 'PART 1 · IN YOUR PAPER'}
              </span>
              <span className="whitespace-nowrap shrink-0 text-emerald-700 dark:text-emerald-300 font-semibold inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {lang === 'vi' ? 'Đã khớp' : 'Linked'}
              </span>
            </div>
            <p style={{ color: 'var(--solva-ink)' }} className="text-[12px] font-medium leading-snug">
              {lang === 'vi' ? 'Trong bài ' : 'In-text '}
              <span className="citra-nowrap-tail whitespace-nowrap">
                [<SubtleNumber value={activeRefNum} />]
              </span>
              {lang === 'vi' ? ' ↔ Danh mục ' : ' ↔ Bibliography '}
              <span className="citra-nowrap-tail whitespace-nowrap">
                #<SubtleNumber value={activeRefNum} />
              </span>
            </p>
          </div>

          <div
            style={{
              ...getStaggerStyle(190),
              backgroundColor: 'var(--solva-surface)',
              borderColor: highlightL2 ? 'var(--solva-ink)' : 'transparent',
            }}
            className="p-2.5 rounded-[10px] border space-y-1 transition-[border-color,background-color] duration-500"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[10px] font-mono">
              <span style={{ color: 'var(--solva-muted)' }}>
                {lang === 'vi' ? 'PHẦN 2 · TRÊN THƯ VIỆN' : 'PART 2 · LIBRARY RECORD'}
              </span>
              <span className="citra-nowrap-tail whitespace-nowrap shrink-0 text-amber-800 dark:text-amber-300 font-semibold">
                {lang === 'vi' ? 'Lệch thông tin' : 'Details Mismatch'}
              </span>
            </div>
            <p style={{ color: 'var(--solva-ink)' }} className="text-[12px] font-medium leading-snug">
              {lang === 'vi' ? 'Có bài thật · Lệch năm ' : 'Paper found · Year differs '}
              <span className="citra-nowrap-tail whitespace-nowrap">(2020 → 2021)</span>
            </p>
          </div>
        </div>

        <div
          style={{
            ...getStaggerStyle(260),
            borderColor: 'var(--solva-border)',
          }}
          className="pt-2.5 border-t flex flex-wrap items-center justify-between gap-1.5 text-[11px]"
        >
          <span style={{ color: 'var(--solva-muted)' }}>
            {lang === 'vi' ? 'Gợi ý cách sửa từng mục' : 'Clear, actionable fix hints'}
          </span>
          <span
            style={{ color: 'var(--solva-ink)' }}
            className="citra-nowrap-tail whitespace-nowrap shrink-0 font-mono font-semibold"
          >
            {lang === 'vi' ? 'Rõ ràng 100%' : 'Zero Guesswork'}
          </span>
        </div>
      </div>
    );
  }

  if (index === 1) {
    // Widget 2: 15+ Academic Libraries Parallel Lookup
    const apis = [
      {
        name: 'Crossref',
        status: lang === 'vi' ? 'Khớp DOI' : 'DOI Match',
        baseMs: 38,
        delta: 2,
      },
      {
        name: 'OpenAlex',
        status: lang === 'vi' ? 'Ấn phẩm' : 'Verified',
        baseMs: 49,
        delta: -2,
      },
      {
        name: 'Semantic Scholar',
        status: lang === 'vi' ? 'Khớp' : 'Match',
        score: 0.96,
        baseMs: 62,
        delta: 3,
      },
      {
        name: 'PubMed / Europe PMC',
        status: lang === 'vi' ? 'Y sinh' : 'Indexed',
        baseMs: 54,
        delta: -1,
      },
      {
        name: 'DOAJ / OpenLibrary',
        status: lang === 'vi' ? 'Sách & Mở' : 'Books & OA',
        baseMs: 41,
        delta: -1,
      },
    ];
    return (
      <div
        ref={containerRef}
        style={{
          backgroundColor: 'var(--solva-card-elevated)',
          ...getStaggerStyle(0),
        }}
        className="solva-glass-ring w-full max-w-[296px] min-h-[272px] sm:min-h-[288px] h-auto rounded-[16px] p-3.5 sm:p-4 flex flex-col justify-between gap-2.5 text-left border border-[#E7E3D9]/70 dark:border-[#332F26]"
      >
        <div
          style={getStaggerStyle(40)}
          className="flex flex-wrap items-center justify-between gap-1.5"
        >
          <span
            style={{ color: 'var(--solva-ink)' }}
            className="text-[12px] font-medium flex items-center gap-1.5 min-w-0"
          >
            <Database className="w-3.5 h-3.5 shrink-0" />
            <span>15+ {lang === 'vi' ? 'Thư viện Học thuật' : 'Academic Libraries'}</span>
          </span>
          <span className="whitespace-nowrap shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300 font-semibold inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {lang === 'vi' ? 'CÙNG LÚC' : 'AT ONCE'}
          </span>
        </div>

        <div className="space-y-1.5 my-auto">
          {apis.map((api, idx) => {
            const isWaveActive = idx === cycleStep;
            const liveMs = isWaveActive ? api.baseMs + api.delta : api.baseMs;
            const href = getScholarlySourceUrl(api.name) ?? '#';
            return (
              <a
                key={api.name}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${api.name} official website`}
                style={{
                  ...getStaggerStyle(80 + idx * 45),
                  backgroundColor: 'var(--solva-surface)',
                  borderColor: isWaveActive ? 'var(--solva-ink)' : 'transparent',
                }}
                className="group px-2 py-1.5 rounded-[8px] border flex flex-wrap items-center justify-between gap-x-1.5 gap-y-0.5 text-[11px] transition-[border-color,background-color] duration-300 hover:border-[#1C1A15]/50 dark:hover:border-[#FBFAF6]/40 cursor-pointer"
              >
                <span
                  style={{ color: 'var(--solva-ink)' }}
                  className="font-medium inline-flex items-center gap-1.5 whitespace-nowrap group-hover:underline underline-offset-2"
                >
                  <ScholarlySourceLogo
                    name={api.name}
                    size={13}
                    className="opacity-85 group-hover:opacity-100"
                  />
                  <span>{api.name}</span>
                </span>
                <span className="citra-nowrap-tail whitespace-nowrap shrink-0 font-mono text-[10px] text-emerald-700 dark:text-emerald-300">
                  {api.score !== undefined ? `${api.status} ${api.score.toFixed(2)}` : api.status} ·{' '}
                  <SubtleNumber value={liveMs} suffix="ms" />
                </span>
              </a>
            );
          })}
        </div>

        <div
          style={{
            ...getStaggerStyle(310),
            borderColor: 'var(--solva-border)',
          }}
          className="pt-2 border-t flex flex-wrap items-center justify-between gap-1.5 text-[11px]"
        >
          <span style={{ color: 'var(--solva-muted)' }}>
            {lang === 'vi' ? '+ arXiv, DBLP, ORCID, Pháp luật VN' : '+ arXiv, DBLP, ORCID, VN Laws'}
          </span>
          <span
            style={{ color: 'var(--solva-ink)' }}
            className="citra-nowrap-tail whitespace-nowrap shrink-0 font-mono font-semibold"
          >
            <SolvaLiveNumber
              value={200}
              suffix={lang === 'vi' ? 'Tr+ Ấn phẩm' : 'M+ Works'}
              replaySeed={replaySeed}
              durationMs={1500}
            />
          </span>
        </div>
      </div>
    );
  }

  // Widget 3: Details & Abstract Meaning Verification
  const simScores = [0.97, 0.98, 0.97];
  const stancePercents = [94, 96, 94];
  const currentSim = simScores[cycleStep % simScores.length];
  const currentStance = stancePercents[cycleStep % stancePercents.length];

  return (
    <div
      ref={containerRef}
      style={{
        backgroundColor: 'var(--solva-card-elevated)',
        ...getStaggerStyle(0),
      }}
      className="solva-glass-ring w-full max-w-[296px] min-h-[272px] sm:min-h-[288px] h-auto rounded-[16px] p-3.5 sm:p-4 flex flex-col justify-between gap-2.5 text-left border border-[#E7E3D9]/70 dark:border-[#332F26]"
    >
      <div
        style={getStaggerStyle(40)}
        className="flex flex-wrap items-center justify-between gap-1.5"
      >
        <span
          style={{ color: 'var(--solva-ink)' }}
          className="text-[12px] font-medium flex items-center gap-1.5 min-w-0"
        >
          <Scale className="w-3.5 h-3.5 shrink-0" />
          <span>
            {lang === 'vi' ? 'Chi tiết & Nội dung bài gốc' : 'Details & Content Match'}
          </span>
        </span>
        <span className="citra-nowrap-tail whitespace-nowrap shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#1C1A15] text-[#FBFAF6] dark:bg-[#FBFAF6] dark:text-[#1C1A15]">
          {lang === 'vi' ? '30+ Kiểm tra' : '30+ Checks'}
        </span>
      </div>

      <div className="space-y-2 my-auto">
        <div
          style={{
            ...getStaggerStyle(110),
            backgroundColor: 'var(--solva-surface)',
            borderColor: cycleStep === 0 ? 'var(--solva-ink)' : 'transparent',
          }}
          className="p-2.5 rounded-[10px] border space-y-1 transition-[border-color,background-color] duration-500"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[10px] font-mono">
            <span style={{ color: 'var(--solva-muted)' }}>
              {lang === 'vi' ? 'KIỂM TRA THÔNG TIN' : 'DETAILS CHECK'}
            </span>
            <span className="whitespace-nowrap shrink-0 text-emerald-700 dark:text-emerald-300 font-semibold inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {lang === 'vi' ? 'ĐẠT CHUẨN' : 'PASSED'}
            </span>
          </div>
          <p style={{ color: 'var(--solva-ink)' }} className="text-[11.5px] font-medium leading-snug">
            {lang === 'vi' ? 'Khớp mã DOI & Tiêu đề ' : 'DOI & Title Match '}
            <span className="citra-nowrap-tail whitespace-nowrap font-mono">
              (<SubtleNumber value={currentSim.toFixed(2)} />)
            </span>
          </p>
        </div>

        <div
          style={{
            ...getStaggerStyle(190),
            backgroundColor: 'var(--solva-surface)',
            borderColor: cycleStep === 1 ? 'var(--solva-ink)' : 'transparent',
          }}
          className="p-2.5 rounded-[10px] border space-y-1.5 transition-[border-color,background-color] duration-500"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[10px] font-mono">
            <span style={{ color: 'var(--solva-muted)' }}>
              {lang === 'vi' ? 'NỘI DUNG TÓM TẮT' : 'ABSTRACT MEANING'}
            </span>
            <span className="citra-nowrap-tail whitespace-nowrap shrink-0 text-emerald-700 dark:text-emerald-300 font-semibold">
              {lang === 'vi' ? 'KHỚP (' : 'ALIGNED ('}
              <SubtleNumber value={currentStance} suffix="%" />)
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-[#ECE9E0] dark:bg-[#29261F] overflow-hidden">
            <div
              style={{ width: `${currentStance}%` }}
              className="h-full rounded-full bg-[#1C1A15] dark:bg-[#FBFAF6] transition-[width] duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)]"
            />
          </div>
        </div>
      </div>

      <div
        style={{
          ...getStaggerStyle(260),
          borderColor: 'var(--solva-border)',
        }}
        className="pt-2 border-t flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[10.5px] sm:text-[11px]"
      >
        <span style={{ color: 'var(--solva-muted)' }}>
          {lang === 'vi' ? 'Hỗ trợ bài viết Việt ↔ Anh' : 'English & Vietnamese'}
        </span>
        <span
          style={{ color: 'var(--solva-ink)' }}
          className="citra-nowrap-tail whitespace-nowrap shrink-0 font-mono font-semibold"
        >
          {lang === 'vi' ? 'Giải thích rõ' : 'Clear Reasons'}
        </span>
      </div>
    </div>
  );
}

/**
 * 3. STICKY CARD FLOATING WIDGETS (340x340px inside 667x548px oil painting frame)
 * Exact 1:1 visual layout of Screenshots 0, 1, 2 with honest static identifiers & subtle telemetry.
 */
export function StickyCardWidget({
  index,
  lang,
}: {
  index: 0 | 1 | 2;
  lang: Lang;
}) {
  const { containerRef, isVisible, replaySeed } = useFloralCardAnimation();
  const [activePhase, setActivePhase] = useState(0);
  const [showXmlSchema, setShowXmlSchema] = useState(false);

  useEffect(() => {
    if (!isVisible) return;
    const intervalMs = index === 0 ? 1500 : index === 1 ? 2000 : 2200;
    const steps = index === 0 ? 4 : 3;
    const timer = window.setInterval(() => {
      setActivePhase((prev) => (prev + 1) % steps);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [index, isVisible]);

  if (index === 0) {
    // Card 0: Human-readable Extracted Citation Preview + Optional XML Schema Toggle
    const xmlIds = [12, 15, 18, 12];
    const currentXmlId = xmlIds[activePhase % xmlIds.length];

    const styleItems = [
      {
        key: 'ieee',
        prefix: 'IEEE ',
        tail: '[1]–[N]',
      },
      {
        key: 'apa',
        prefix: 'APA 7th ',
        tail: '(Author, Yr)',
      },
      {
        key: 'vancouver',
        prefix: 'Vancouver ',
        tail: '(1)',
      },
      {
        key: 'acm',
        prefix: 'ACM / Harvard',
        tail: null,
      },
    ] as const;

    return (
      <div
        ref={containerRef}
        style={{
          backgroundColor: 'var(--solva-card-elevated)',
        }}
        className="solva-glass-ring w-full max-w-[348px] rounded-[12px] p-4 sm:p-5 space-y-3.5 text-left border border-[#E7E3D9]/80 dark:border-[#332F26]"
      >
        <div className="flex flex-nowrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <FileText className="w-4 h-4 shrink-0 text-[#1C1A15] dark:text-[#FBFAF6]" />
            <span
              style={{ color: 'var(--solva-ink)' }}
              className="text-[12.5px] sm:text-[13px] font-medium leading-snug"
            >
              {lang === 'vi'
                ? 'Thẻ tài liệu bóc tách'
                : 'Extracted Reference Preview'}
            </span>
          </div>
          <button
            type="button"
            data-testid="xml-schema-preview-toggle"
            aria-expanded={showXmlSchema}
            aria-controls="xml-schema-preview-panel"
            onClick={() => setShowXmlSchema((prev) => !prev)}
            style={{
              backgroundColor: 'var(--solva-surface)',
              borderColor: showXmlSchema ? 'var(--solva-ink)' : 'var(--solva-border)',
              color: showXmlSchema ? 'var(--solva-ink)' : 'var(--solva-muted)',
            }}
            className="inline-flex items-center justify-center gap-1 min-h-[36px] sm:min-h-[32px] px-2.5 py-1 text-[11px] font-mono whitespace-nowrap shrink-0 rounded-[6px] border hover:opacity-85 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1C1A15] dark:focus-visible:ring-[#FBFAF6]"
          >
            <span className="whitespace-nowrap">
              {showXmlSchema
                ? lang === 'vi'
                  ? 'Xem dạng thẻ'
                  : 'Card view'
                : lang === 'vi'
                  ? 'Mã XML'
                  : 'Raw XML'}
            </span>
          </button>
        </div>

        {showXmlSchema ? (
          <div
            id="xml-schema-preview-panel"
            style={{
              backgroundColor: 'var(--solva-surface)',
            }}
            className="p-2.5 sm:p-3 rounded-[8px] font-mono text-[10px] sm:text-[11px] space-y-1.5 break-all sm:break-normal"
          >
            <div
              style={{
                color: activePhase === 0 ? 'var(--solva-ink)' : 'var(--solva-muted)',
                transform: activePhase === 0 ? 'translateX(2px)' : 'translateX(0px)',
              }}
              className="transition-[color,transform] duration-300"
            >
              &lt;biblStruct xml:id=&quot;b
              <SubtleNumber value={String(currentXmlId).padStart(2, '0')} />
              &quot;&gt;
            </div>
            <div
              style={{
                color: 'var(--solva-ink)',
                transform: activePhase === 1 ? 'translateX(3px)' : 'translateX(0px)',
              }}
              className="pl-2.5 sm:pl-3 transition-transform duration-300"
            >
              &lt;title&gt;Deep Residual Learning&lt;/title&gt;
            </div>
            <div
              style={{
                color: 'var(--solva-ink)',
                transform: activePhase === 2 ? 'translateX(3px)' : 'translateX(0px)',
              }}
              className="pl-2.5 sm:pl-3 transition-transform duration-300"
            >
              &lt;idno type=&quot;DOI&quot;&gt;10.1109/CVPR.2016.90&lt;/idno&gt;
            </div>
            <div
              style={{
                color: activePhase === 3 ? 'var(--solva-ink)' : 'var(--solva-muted)',
                transform: activePhase === 3 ? 'translateX(2px)' : 'translateX(0px)',
              }}
              className="transition-[color,transform] duration-300"
            >
              &lt;/biblStruct&gt;
            </div>
          </div>
        ) : (
          <div
            id="xml-schema-preview-panel"
            style={{
              backgroundColor: 'var(--solva-surface)',
              borderColor: 'var(--solva-border)',
            }}
            className="p-3 rounded-[8px] border space-y-1.5 text-[11px]"
          >
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <span
                style={{ color: 'var(--solva-muted)' }}
                className="font-mono text-[10px]"
              >
                {lang === 'vi' ? 'Mục tham khảo #' : 'Reference #'}
                <SubtleNumber value={String(currentXmlId).padStart(2, '0')} />
              </span>
              <span className="whitespace-nowrap shrink-0 text-[10px] font-medium text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {lang === 'vi' ? 'Đã khớp trong bài' : 'Linked in text'}
              </span>
            </div>
            <div
              style={{ color: 'var(--solva-ink)' }}
              className="font-medium text-[12px] leading-snug"
            >
              Deep Residual Learning for Image Recognition
            </div>
            <div style={{ color: 'var(--solva-muted)' }} className="leading-snug">
              K. He, X. Zhang, S. Ren, J. Sun · CVPR 2016
            </div>
            <div className="flex flex-wrap items-center justify-between gap-1 pt-1 border-t border-[#E7E3D9] dark:border-[#332F26] font-mono text-[10px]">
              <span style={{ color: 'var(--solva-muted)' }}>DOI:</span>
              <span style={{ color: 'var(--solva-ink)' }}>10.1109/CVPR.2016.90</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-1.5 sm:gap-2 text-[10.5px] sm:text-[11px]">
          {styleItems.map((item, idx) => {
            const isStyleActive = idx === activePhase;
            return (
              <div
                key={item.key}
                style={{
                  backgroundColor: isStyleActive
                    ? 'var(--solva-surface)'
                    : 'var(--solva-bg)',
                  borderColor: isStyleActive
                    ? 'var(--solva-ink)'
                    : 'var(--solva-border)',
                  transform: isStyleActive ? 'translateY(-1px)' : 'translateY(0px)',
                }}
                className="px-2 py-1.5 rounded-[6px] border flex items-center gap-1.5 min-w-0 transition-[background-color,border-color,transform] duration-300"
              >
                <Check
                  className={`w-3 h-3 text-emerald-700 dark:text-emerald-300 shrink-0 transition-transform duration-300 ${
                    isStyleActive ? 'scale-125' : 'scale-100'
                  }`}
                />
                <span style={{ color: 'var(--solva-ink)' }} className="leading-snug min-w-0">
                  {item.prefix}
                  {item.tail && (
                    <span className="citra-nowrap-tail whitespace-nowrap">{item.tail}</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (index === 1) {
    // Card 1: Explainable Checks & Advisor Sign-Off
    const stanceValues = [0.93, 0.96, 0.93];
    const currentStance = stanceValues[activePhase % stanceValues.length];

    return (
      <div
        ref={containerRef}
        style={{
          backgroundColor: 'var(--solva-card-elevated)',
        }}
        className="solva-glass-ring w-full max-w-[348px] rounded-[12px] p-4 sm:p-5 space-y-3.5 text-left border border-[#E7E3D9]/80 dark:border-[#332F26]"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <GitBranch className="w-4 h-4 shrink-0 text-[#1C1A15] dark:text-[#FBFAF6]" />
            <span
              style={{ color: 'var(--solva-ink)' }}
              className="text-[12.5px] sm:text-[13px] font-medium leading-snug"
            >
              {lang === 'vi'
                ? 'Giải thích rõ ràng & Giảng viên duyệt'
                : 'Clear Reasons & Advisor Review'}
            </span>
          </div>
        </div>

        <div className="space-y-2">
          {/* Check 1: Exact DOI */}
          <div
            style={{
              backgroundColor: 'var(--solva-surface)',
              borderColor: activePhase === 0 ? 'var(--solva-ink)' : 'transparent',
              transform: activePhase === 0 ? 'translateY(-1px)' : 'translateY(0px)',
            }}
            className="p-2.5 rounded-[8px] border flex items-start sm:items-center justify-between gap-2 transition-[border-color,transform] duration-300"
          >
            <div className="min-w-0">
              <div
                style={{ color: 'var(--solva-ink)' }}
                className="text-[11.5px] font-medium leading-snug"
              >
                {lang === 'vi'
                  ? 'Đã xác nhận mã DOI gốc trên Crossref'
                  : 'Official DOI confirmed via Crossref'}
              </div>
              <div
                style={{ color: 'var(--solva-muted)' }}
                className="text-[10px] font-mono leading-snug mt-0.5"
              >
                {lang === 'vi' ? 'Đối chiếu mã DOI chính thức' : 'R01_DOI_EXACT'}
              </div>
            </div>
            <span className="citra-nowrap-tail whitespace-nowrap shrink-0 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300">
              {lang === 'vi' ? 'ĐẠT' : 'PASS'}
            </span>
          </div>

          {/* Check 2: Year comparison */}
          <div
            style={{
              backgroundColor: 'var(--solva-surface)',
              borderColor: activePhase === 1 ? 'var(--solva-ink)' : 'transparent',
              transform: activePhase === 1 ? 'translateY(-1px)' : 'translateY(0px)',
            }}
            className="p-2.5 rounded-[8px] border flex items-start sm:items-center justify-between gap-2 transition-[border-color,transform] duration-300"
          >
            <div className="min-w-0">
              <div
                style={{ color: 'var(--solva-ink)' }}
                className="text-[11.5px] font-medium leading-snug"
              >
                {lang === 'vi' ? (
                  <>
                    Ghi trong bài 2018 · Xuất bản 2019{' '}
                    <span className="citra-nowrap-tail whitespace-nowrap">(Δ=1 năm)</span>
                  </>
                ) : (
                  <>
                    Cited 2018 · Published 2019{' '}
                    <span className="citra-nowrap-tail whitespace-nowrap">(Δ=1yr)</span>
                  </>
                )}
              </div>
              <div
                style={{ color: 'var(--solva-muted)' }}
                className="text-[10px] font-mono leading-snug mt-0.5"
              >
                {lang === 'vi' ? 'So sánh năm bản nháp & năm công bố' : 'R05_YEAR_DRIFT'}
              </div>
            </div>
            <span className="citra-nowrap-tail whitespace-nowrap shrink-0 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-amber-500/[0.12] text-amber-800 dark:text-amber-300">
              {lang === 'vi' ? 'LƯU Ý' : 'REVIEW'}
            </span>
          </div>

          {/* Check 3: Abstract support */}
          <div
            style={{
              backgroundColor: 'var(--solva-surface)',
              borderColor: activePhase === 2 ? 'var(--solva-ink)' : 'transparent',
              transform: activePhase === 2 ? 'translateY(-1px)' : 'translateY(0px)',
            }}
            className="p-2.5 rounded-[8px] border flex items-start sm:items-center justify-between gap-2 transition-[border-color,transform] duration-300"
          >
            <div className="min-w-0">
              <div
                style={{ color: 'var(--solva-ink)' }}
                className="text-[11.5px] font-medium leading-snug"
              >
                {lang === 'vi'
                  ? 'Câu trích dẫn khớp tóm tắt bài báo gốc'
                  : 'Claim supported by paper abstract'}
              </div>
              <div
                style={{ color: 'var(--solva-muted)' }}
                className="text-[10px] leading-snug mt-0.5"
              >
                {lang === 'vi' ? 'Đối chiếu nội dung trích dẫn' : 'Abstract content alignment'}
              </div>
            </div>
            <span className="citra-nowrap-tail whitespace-nowrap shrink-0 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300">
              <SubtleNumber value={currentStance.toFixed(2)} />
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Card 2: Revision Progress & Integrity Score (Screenshot 2)
  const draftV2Targets = [95.6, 94.5, 95.6];
  const cisDeltaTargets = [27.6, 26.5, 27.6];
  const currentV2 = draftV2Targets[activePhase % draftV2Targets.length];
  const currentCisDelta = cisDeltaTargets[activePhase % cisDeltaTargets.length];

  return (
    <div
      ref={containerRef}
      style={{
        backgroundColor: 'var(--solva-card-elevated)',
      }}
      className="solva-glass-ring w-full max-w-[348px] rounded-[12px] p-4 sm:p-5 space-y-3.5 text-left border border-[#E7E3D9]/80 dark:border-[#332F26]"
    >
      <div className="flex items-center justify-between gap-2">
        <span
          style={{ color: 'var(--solva-ink)' }}
          className="text-[12.5px] sm:text-[13px] font-medium flex items-center gap-1.5 min-w-0"
        >
          <Sparkles className="w-4 h-4 shrink-0" />
          <span className="leading-snug">
            {lang === 'vi'
              ? 'Tiến bộ chất lượng qua từng bản nháp'
              : 'Draft-to-Submission Progress'}
          </span>
        </span>
        <span className="citra-nowrap-tail whitespace-nowrap shrink-0 text-[11px] font-mono font-bold text-emerald-700 dark:text-emerald-300">
          <SubtleNumber
            prefix="+"
            value={
              lang === 'vi'
                ? currentCisDelta.toFixed(1).replace('.', ',')
                : currentCisDelta.toFixed(1)
            }
            suffix={lang === 'vi' ? ' điểm' : ' pts'}
          />
        </span>
      </div>

      <div
        style={{
          backgroundColor: 'var(--solva-surface)',
        }}
        className="p-3 sm:p-3.5 rounded-[10px] flex items-center justify-between gap-2"
      >
        <div className="min-w-0">
          <div style={{ color: 'var(--solva-muted)' }} className="text-[11px] leading-snug">
            {lang === 'vi' ? 'Bản nháp v1 ' : 'Draft v1 '}
            <span className="citra-nowrap-tail whitespace-nowrap">
              {lang === 'vi' ? '(Trước rà soát)' : '(Before Audit)'}
            </span>
          </div>
          <div
            style={{ color: 'var(--solva-ink)' }}
            className="font-solva-serif text-[22px] sm:text-[24px] leading-tight mt-0.5 whitespace-nowrap"
          >
            <SolvaLiveNumber
              value={68.0}
              decimals={1}
              decimalSeparator={lang === 'vi' ? ',' : '.'}
              replaySeed={replaySeed}
              durationMs={1350}
            />{' '}
            <span
              style={{ color: 'var(--solva-muted)' }}
              className="font-mono text-[11px]"
            >
              / 100
            </span>
          </div>
        </div>
        <div
          style={{
            color: 'var(--solva-muted)',
            transform: activePhase === 1 ? 'translateX(3px)' : 'translateX(0px)',
          }}
          className="font-mono text-sm shrink-0 transition-transform duration-500"
        >
          →
        </div>
        <div className="text-right min-w-0">
          <div style={{ color: 'var(--solva-muted)' }} className="text-[11px] leading-snug">
            {lang === 'vi' ? 'Bản nộp v2 ' : 'Draft v2 '}
            <span className="citra-nowrap-tail whitespace-nowrap">
              {lang === 'vi' ? '(Đã chuẩn hóa)' : '(Verified)'}
            </span>
          </div>
          <div className="font-solva-serif text-[22px] sm:text-[24px] leading-tight mt-0.5 text-emerald-700 dark:text-emerald-300 whitespace-nowrap">
            <SubtleNumber
              value={
                lang === 'vi'
                  ? currentV2.toFixed(1).replace('.', ',')
                  : currentV2.toFixed(1)
              }
            />{' '}
            <span
              style={{ color: 'var(--solva-muted)' }}
              className="font-mono text-[11px]"
            >
              / 100
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-1.5 text-[11px]">
        <div className="flex items-center justify-between gap-2">
          <span style={{ color: 'var(--solva-muted)' }} className="leading-snug">
            {lang === 'vi'
              ? 'Nguồn không tồn tại / DOI sai đã thay thế'
              : 'Unverified / fake DOIs replaced'}
          </span>
          <span
            style={{ color: 'var(--solva-ink)' }}
            className="citra-nowrap-tail whitespace-nowrap shrink-0 font-mono font-semibold"
          >
            3 →{' '}
            <SolvaLiveNumber
              value={0}
              startValue={3}
              replaySeed={replaySeed}
              durationMs={1400}
            />
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span style={{ color: 'var(--solva-muted)' }} className="leading-snug">
            {lang === 'vi'
              ? 'Mục tham khảo còn thiếu đã bổ sung'
              : 'Missing bibliography entries added'}
          </span>
          <span
            style={{ color: 'var(--solva-ink)' }}
            className="citra-nowrap-tail whitespace-nowrap shrink-0 font-mono font-semibold"
          >
            4 →{' '}
            <SolvaLiveNumber
              value={0}
              startValue={4}
              replaySeed={replaySeed}
              durationMs={1500}
            />
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * 4. USE CASES / PIPELINE 4-TAB STAGE VISUAL (`668x446px` style with 8px glass ring)
 */
export function PipelineStageVisual({
  tabIndex,
  lang,
}: {
  tabIndex: number;
  lang: Lang;
}) {
  const { containerRef, isVisible, replaySeed } = useFloralCardAnimation();
  const [activeRow, setActiveRow] = useState(0);

  useEffect(() => {
    if (!isVisible) return;
    const timer = window.setInterval(() => {
      setActiveRow((prev) => (prev + 1) % 3);
    }, 1600);
    return () => window.clearInterval(timer);
  }, [tabIndex, isVisible]);

  const stages = [
    {
      badge:
        lang === 'vi'
          ? 'BƯỚC 01 · ĐỌC BÀI VIẾT & ĐỊNH DẠNG'
          : 'STAGE 01 · DOCUMENT & STYLE READER',
      title:
        lang === 'vi'
          ? 'Nhận diện trích dẫn trong bài & Danh mục tài liệu cuối bài'
          : 'Reads In-Text Citations & Reference Lists Automatically',
      metrics: [
        {
          k: lang === 'vi' ? 'Định dạng tệp' : 'File Formats',
          v: 'PDF, Word (.docx), BibTeX, RIS',
        },
        {
          k: lang === 'vi' ? 'Chuẩn trình bày' : 'Supported Styles',
          v: 'IEEE, APA 7th, Vancouver, Harvard, ACM',
        },
        {
          k: lang === 'vi' ? 'Tách bố cục' : 'Section Check',
          v: lang === 'vi' ? 'Tách riêng phần thân bài & Danh mục cuối bài' : 'Cleanly separates body text & bibliography',
        },
      ],
    },
    {
      badge:
        lang === 'vi'
          ? 'BƯỚC 02 · TRA CỨU 15+ THƯ VIỆN HỌC THUẬT'
          : 'STAGE 02 · 15+ ACADEMIC LIBRARIES',
      title:
        lang === 'vi'
          ? 'Đối chiếu song song trên hơn 15 cơ sở dữ liệu uy tín toàn cầu'
          : 'Simultaneous Lookup Across 15+ Trusted Academic Libraries',
      metrics: [
        {
          k: lang === 'vi' ? 'Thư viện quốc tế' : 'Global Libraries',
          v: 'Crossref, OpenAlex, Semantic Scholar, PubMed',
        },
        {
          k: lang === 'vi' ? 'Sách & Tạp chí mở' : 'Books & Open Access',
          v: 'DOAJ, OpenLibrary, arXiv, DBLP, ORCID',
        },
        {
          k: lang === 'vi' ? 'Tốc độ tra cứu' : 'Lookup Speed',
          v: lang === 'vi' ? '~40 ms đối chiếu song song' : '~40 ms parallel library lookup',
        },
      ],
    },
    {
      badge:
        lang === 'vi'
          ? 'BƯỚC 03 · ĐỐI CHIẾU CHI TIẾT TỪNG TRƯỜNG'
          : 'STAGE 03 · TRANSPARENT VERIFICATION CHECKS',
      title:
        lang === 'vi'
          ? 'So sánh tên bài, tác giả, năm xuất bản, tạp chí và mã DOI'
          : 'Side-by-Side Title, Author, Year, Journal & DOI Verification',
      metrics: [
        {
          k: lang === 'vi' ? 'Tên công trình' : 'Title Check',
          v: lang === 'vi' ? 'Đối chiếu chính xác & nhận diện lỗi đánh máy' : 'Exact & typo-tolerant title comparison',
        },
        {
          k: lang === 'vi' ? 'Tác giả & Năm XB' : 'Authors & Year',
          v: lang === 'vi' ? 'Kiểm tra họ tên tác giả · nhận biết lệch ±1 năm bản nháp' : 'Author surname check · ±1 year preprint awareness',
        },
        {
          k: lang === 'vi' ? 'Kiểm tra mã DOI' : 'Link & DOI Safety',
          v: lang === 'vi' ? 'Xác nhận đường dẫn & mã DOI trỏ đúng tới bài báo thật' : 'Confirms DOIs & web links open real publications',
        },
      ],
    },
    {
      badge:
        lang === 'vi'
          ? 'BƯỚC 04 · ĐỐI CHIẾU NỘI DUNG & CHUẨN HÓA'
          : 'STAGE 04 · CONTENT ALIGNMENT & CLEANUP',
      title:
        lang === 'vi'
          ? 'Đảm bảo bài báo gốc đúng với ý trích dẫn & chuẩn hóa danh mục'
          : 'Verifies Paper Abstracts Support Your Claim & Formats Cleanly',
      metrics: [
        {
          k: lang === 'vi' ? 'Tóm tắt bài gốc' : 'Abstract Match',
          v: lang === 'vi' ? 'So sánh câu trích dẫn trong bài với tóm tắt ấn phẩm gốc' : 'Compares your cited sentence with the source abstract',
        },
        {
          k: lang === 'vi' ? 'Đa ngôn ngữ' : 'Bilingual Support',
          v: lang === 'vi' ? 'Hiểu chính xác bài viết tiếng Việt trích dẫn nguồn tiếng Anh' : 'Works seamlessly across Vietnamese & English papers',
        },
        {
          k: lang === 'vi' ? 'Chuẩn hóa nhanh' : 'Clean Export',
          v: lang === 'vi' ? 'Xuất danh mục chuẩn APA 7th, IEEE, BibTeX & báo cáo Word/PDF' : 'One-click APA 7th, IEEE, BibTeX & Word/PDF report',
        },
      ],
    },
  ];

  const active = stages[tabIndex] || stages[0];

  return (
    <div
      ref={containerRef}
      style={{
        backgroundColor: 'var(--solva-card-elevated)',
      }}
      className="solva-glass-ring w-full rounded-[8px] p-5 sm:p-6 space-y-4 text-left border border-[#E7E3D9]/80 dark:border-[#332F26]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E7E3D9] dark:border-[#332F26]">
        <span
          style={{ color: 'var(--solva-muted)' }}
          className="font-mono text-[11px] font-semibold tracking-wider"
        >
          {active.badge}
        </span>
        <span className="whitespace-nowrap shrink-0 px-2 py-0.5 rounded bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300 font-mono text-[10px] font-semibold inline-flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          {lang === 'vi' ? 'TỰ ĐỘNG' : 'LIVE CHECK'}
        </span>
      </div>

      <h5
        style={{ color: 'var(--solva-ink)' }}
        className="font-solva-serif font-light text-[22px] sm:text-[26px] leading-[1.2] tracking-[-0.04em]"
      >
        {active.title}
      </h5>

      <div className="space-y-2">
        {active.metrics.map((m, idx) => {
          const isRowActive = idx === activeRow;
          return (
            <div
              key={m.k}
              style={{
                backgroundColor: 'var(--solva-surface)',
                borderColor: isRowActive ? 'var(--solva-ink)' : 'transparent',
              }}
              className="px-3.5 py-2.5 rounded-[8px] border flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[12px] transition-[border-color,background-color] duration-300"
            >
              <span style={{ color: 'var(--solva-muted)' }} className="font-mono">
                {m.k}
              </span>
              <span
                style={{ color: 'var(--solva-ink)' }}
                className="font-medium sm:text-right"
              >
                {m.v}
              </span>
            </div>
          );
        })}
      </div>

      <div
        style={{
          backgroundColor: 'var(--solva-bg)',
          borderColor: 'var(--solva-border)',
        }}
        className="p-3 rounded-[8px] border font-mono text-[11px] flex items-center gap-2"
      >
        <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-300 shrink-0" />
        <span style={{ color: 'var(--solva-ink)' }}>
          {tabIndex === 0 && (
            <>
              {lang === 'vi'
                ? 'Đã nhận diện 28 trích dẫn trong bài ([1]–[28]) và nối khớp 27 mục tài liệu cuối bài trong '
                : 'Found 28 in-text citations ([1]–[28]) and linked 27 bibliography entries in '}
              <SolvaLiveNumber
                value={340}
                suffix="ms."
                replaySeed={replaySeed}
                durationMs={1250}
              />
            </>
          )}
          {tabIndex === 1 && (
            <>
              {lang === 'vi'
                ? 'Tra cứu đồng thời 15+ thư viện · Gộp 64 bản ghi trùng lặp · Chọn ra hồ sơ gốc chuẩn nhất.'
                : 'Checked 15+ libraries at once · Merged 64 duplicate records · Matched official publication.'}
            </>
          )}
          {tabIndex === 2 && (
            <>
              {lang === 'vi' ? (
                <>
                  Xác nhận khớp mã DOI, tác giả &amp; năm xuất bản → Nguồn trích dẫn hợp lệ{' '}
                  <span className="citra-nowrap-tail whitespace-nowrap">(Độ tin cậy: 98,4%).</span>
                </>
              ) : (
                <>
                  Confirmed DOI, author &amp; year match → Verified Source{' '}
                  <span className="citra-nowrap-tail whitespace-nowrap">(Confidence: 98.4%).</span>
                </>
              )}
            </>
          )}
          {tabIndex === 3 && (
            <>
              {lang === 'vi' ? (
                <>
                  Câu trích dẫn phù hợp chặt chẽ với tóm tắt bài báo gốc{' '}
                  <span className="citra-nowrap-tail whitespace-nowrap">(Độ khớp nội dung: 94%).</span>
                </>
              ) : (
                <>
                  Cited sentence aligns closely with paper abstract{' '}
                  <span className="citra-nowrap-tail whitespace-nowrap">(Content match: 94%).</span>
                </>
              )}
            </>
          )}
        </span>
      </div>
    </div>
  );
}

/**
 * 5. BOTTOM CTA MOCKUP CARD (`800x533px` cropped style inside 588x376px painterly frame)
 */
export function BottomCTAMockup({ lang }: { lang: Lang }) {
  const { containerRef, isVisible, replaySeed, getStaggerStyle } = useFloralCardAnimation();
  const [activeBox, setActiveBox] = useState(0);

  useEffect(() => {
    if (!isVisible) return;
    const timer = window.setInterval(() => {
      setActiveBox((prev) => (prev + 1) % 3);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [isVisible]);

  const stats = [
    {
      label: lang === 'vi' ? 'HỢP LỆ' : 'VERIFIED',
      val: 34,
      startVal: 0,
      color: 'text-emerald-700 dark:text-emerald-300',
    },
    {
      label: lang === 'vi' ? 'LỆCH THÔNG TIN' : 'DETAILS MISMATCH',
      val: 2,
      startVal: 0,
      color: 'text-amber-800 dark:text-amber-300',
    },
    {
      label: lang === 'vi' ? 'KHÔNG TÌM THẤY' : 'NOT FOUND',
      val: 0,
      startVal: 3,
      color: 'text-[#1C1A15] dark:text-[#FBFAF6]',
    },
  ];

  return (
    <div
      ref={containerRef}
      style={{
        backgroundColor: 'var(--solva-card-elevated)',
        ...getStaggerStyle(0),
      }}
      className="solva-glass-ring rounded-[8px] p-5 space-y-3.5 text-left border border-[#E7E3D9]/80 dark:border-[#332F26]"
    >
      <div
        style={getStaggerStyle(40)}
        className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E7E3D9] dark:border-[#332F26] pb-3"
      >
        <div className="min-w-0">
          <div
            style={{ color: 'var(--solva-muted)' }}
            className="text-[10px] font-mono uppercase leading-tight"
          >
            {lang === 'vi'
              ? 'BÁO CÁO KIỂM CHỨNG TOÀN DIỆN'
              : 'CITATION INTEGRITY REPORT'}
          </div>
          <div
            style={{ color: 'var(--solva-ink)' }}
            className="text-[13px] sm:text-[15px] font-medium mt-0.5 break-all sm:break-normal"
          >
            thesis_final_v3.pdf
          </div>
        </div>
        <span
          style={{
            backgroundColor: 'var(--solva-btn-bg)',
            color: 'var(--solva-btn-fg)',
          }}
          className="px-2.5 py-1 rounded-[6px] font-mono text-[11px] font-semibold shrink-0 whitespace-nowrap"
        >
          {lang === 'vi' ? 'Điểm' : 'Score'}{' '}
          <SolvaLiveNumber
            value={96.2}
            decimals={1}
            decimalSeparator={lang === 'vi' ? ',' : '.'}
            replaySeed={replaySeed}
            durationMs={1450}
          />{' '}
          / 100
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        {stats.map((stat, idx) => {
          const isHighlighted = idx === activeBox;
          return (
            <div
              key={stat.label}
              style={{
                ...getStaggerStyle(110 + idx * 65),
                backgroundColor: 'var(--solva-surface)',
                borderColor: isHighlighted ? 'var(--solva-ink)' : 'transparent',
                transform: isHighlighted ? 'translateY(-1px)' : 'translateY(0px)',
              }}
              className="p-2.5 rounded-[8px] border transition-[border-color,transform] duration-300"
            >
              <div className={`font-solva-serif text-[24px] leading-none ${stat.color}`}>
                <SolvaLiveNumber
                  value={stat.val}
                  startValue={stat.startVal}
                  replaySeed={replaySeed}
                  durationMs={1350 + idx * 120}
                />
              </div>
              <div
                style={{ color: 'var(--solva-muted)' }}
                className="text-[9px] font-mono mt-1"
              >
                {stat.label}
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          ...getStaggerStyle(260),
          backgroundColor: 'var(--solva-surface)',
        }}
        className="p-3 rounded-[8px] flex items-center justify-between text-[11px]"
      >
        <span style={{ color: 'var(--solva-ink)' }} className="font-medium">
          {lang === 'vi'
            ? 'Sẵn sàng xuất báo cáo Word / PDF & trình giảng viên'
            : 'Ready for Word / PDF export & advisor sign-off'}
        </span>
        <span className="font-mono text-emerald-700 dark:text-emerald-300 font-semibold shrink-0 ml-2">
          {lang === 'vi' ? '100% Minh bạch' : '100% Clear'}
        </span>
      </div>
    </div>
  );
}

/**
 * 6. COHORT BATCH AUDIT CASE STUDY WIDGET (`442x476px` left frame in Client Results Section)
 * Replaces the generic stock video portrait with an interactive live cohort audit card
 * directly illustrating the "120 graduation theses on Monday morning" case study.
 */
export function CohortBatchAuditWidget({ lang }: { lang: Lang }) {
  const { containerRef, isVisible, replaySeed, getStaggerStyle } = useFloralCardAnimation();
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!isVisible) return;
    const timer = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % 3);
    }, 3400);
    return () => window.clearInterval(timer);
  }, [activeIndex, isVisible]);

  const theses = [
    {
      id: '#018',
      file: 'Thesis_018_Neural_RAG.pdf',
      verdict: lang === 'vi' ? 'DOI KHÔNG TỒN TẠI' : 'DOI NOT FOUND',
      tone: 'red' as const,
      rule:
        lang === 'vi'
          ? 'Không tìm thấy mã DOI trên Crossref (404)'
          : 'DOI Not Found on Crossref (404)',
      detail:
        lang === 'vi' ? (
          <>
            Phát hiện mã DOI không có thật 10.1038/s42256-024-99812-x{' '}
            <span className="citra-nowrap-tail whitespace-nowrap">(Mục{'\u00A0'}[14])</span>
          </>
        ) : (
          <>
            Caught non-existent DOI 10.1038/s42256-024-99812-x{' '}
            <span className="citra-nowrap-tail whitespace-nowrap">(Ref{'\u00A0'}[14])</span>
          </>
        ),
      cisNum: 74.2,
    },
    {
      id: '#047',
      file: 'Thesis_047_Legal_NLP.pdf',
      verdict: lang === 'vi' ? 'LỆCH NĂM XB' : 'WRONG YEAR',
      tone: 'amber' as const,
      rule:
        lang === 'vi'
          ? 'Lệch 1 năm xuất bản so với bản gốc'
          : 'Publication Year Off by 1 Year',
      detail:
        lang === 'vi'
          ? 'Ghi nhầm năm bản nháp (2018) thay vì năm công bố chính thức (2019)'
          : 'Cites draft year (2018) instead of official proceedings year (2019)',
      cisNum: 88.5,
    },
    {
      id: '#104',
      file: 'Thesis_104_BioMed_VLM.pdf',
      verdict: lang === 'vi' ? 'HỢP LỆ' : 'VERIFIED',
      tone: 'emerald' as const,
      rule:
        lang === 'vi'
          ? 'Khớp toàn bộ thông tin & tóm tắt bài gốc'
          : 'All Details & Abstract Verified',
      detail:
        lang === 'vi'
          ? 'Đồng nhất 38/38 tài liệu tham khảo trên Crossref, PubMed & OpenAlex'
          : '38/38 references verified across Crossref, PubMed & OpenAlex',
      cisNum: 98.4,
    },
  ];

  const activeThesis = theses[activeIndex] || theses[0];
  const sep = lang === 'vi' ? '.' : ',';

  return (
    <div
      ref={containerRef}
      style={{
        backgroundColor: 'var(--solva-card-elevated)',
        ...getStaggerStyle(0),
      }}
      className="solva-glass-ring w-full max-w-[392px] rounded-[12px] p-4 sm:p-5 space-y-3.5 text-left border border-[#E7E3D9]/80 dark:border-[#332F26] select-none"
    >
      {/* Top Header: Cohort Batch Info */}
      <div
        style={{
          ...getStaggerStyle(40),
          borderColor: 'var(--solva-border)',
        }}
        className="flex items-start sm:items-center justify-between gap-2 pb-3 border-b"
      >
        <div className="min-w-0">
          <div
            style={{ color: 'var(--solva-muted)' }}
            className="text-[10px] font-mono uppercase tracking-wider flex items-center gap-1.5"
          >
            <GraduationCap className="w-3.5 h-3.5 shrink-0" />
            <span>
              {lang === 'vi'
                ? 'HỘI ĐỒNG KHÓA LUẬN · ĐỢT 1'
                : 'THESIS COMMITTEE · COHORT RUN'}
            </span>
          </div>
          <div
            style={{ color: 'var(--solva-ink)' }}
            className="text-[13.5px] sm:text-[15px] font-medium leading-snug mt-0.5"
          >
            <SolvaLiveNumber value={120} replaySeed={replaySeed} durationMs={1300} />{' '}
            {lang === 'vi' ? 'Khóa luận Tốt nghiệp ' : 'Graduation Theses '}
            <span className="citra-nowrap-tail whitespace-nowrap">
              (
              <SolvaLiveNumber
                value={4380}
                formatThousands
                thousandSeparator={sep}
                replaySeed={replaySeed}
                durationMs={1500}
              />{' '}
              {lang === 'vi' ? 'trích dẫn)' : 'refs)'}
            </span>
          </div>
        </div>
        <span className="citra-nowrap-tail whitespace-nowrap px-2 py-0.5 rounded-[6px] bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300 font-mono text-[10px] font-semibold shrink-0">
          <SolvaLiveNumber value={48} replaySeed={replaySeed} durationMs={1200} />
          {lang === 'vi' ? ' phút ' : 'm '}
          <SolvaLiveNumber value={12} replaySeed={replaySeed} durationMs={1350} />
          {lang === 'vi' ? ' giây' : 's'}
        </span>
      </div>

      {/* Cohort Breakdown Mini-Metrics */}
      <div style={getStaggerStyle(110)} className="grid grid-cols-3 gap-2 text-center">
        {[
          {
            label: lang === 'vi' ? 'HỢP LỆ' : 'VERIFIED',
            val: 4192,
            format: true,
            color: 'text-emerald-700 dark:text-emerald-300',
          },
          {
            label: lang === 'vi' ? 'LỆCH NĂM' : 'WRONG YEAR',
            val: 146,
            format: false,
            color: 'text-amber-800 dark:text-amber-300',
          },
          {
            label: lang === 'vi' ? 'KHÔNG TỒN TẠI' : 'NOT FOUND',
            val: 42,
            format: false,
            color: 'text-red-700 dark:text-red-300',
          },
        ].map((stat, idx) => (
          <div
            key={stat.label}
            style={{ backgroundColor: 'var(--solva-surface)' }}
            className="p-2 rounded-[8px]"
          >
            <div className={`font-solva-serif text-[20px] sm:text-[22px] leading-none ${stat.color}`}>
              <SolvaLiveNumber
                value={stat.val}
                formatThousands={stat.format}
                thousandSeparator={sep}
                replaySeed={replaySeed}
                durationMs={1400 + idx * 120}
              />
            </div>
            <div
              style={{ color: 'var(--solva-muted)' }}
              className="text-[9px] font-mono mt-1 leading-tight"
            >
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* Interactive Thesis Queue (3 selectable rows) */}
      <div style={getStaggerStyle(180)} className="space-y-1.5">
        {theses.map((item, idx) => {
          const isSelected = idx === activeIndex;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveIndex(idx)}
              style={{
                backgroundColor: isSelected
                  ? 'var(--solva-surface)'
                  : 'transparent',
                borderColor: isSelected
                  ? 'var(--solva-ink)'
                  : 'var(--solva-border)',
              }}
              className="w-full text-left px-3 py-2 rounded-[8px] border transition-[background-color,border-color] duration-200 cursor-pointer flex flex-wrap items-center justify-between gap-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  style={{
                    backgroundColor: isSelected
                      ? 'var(--solva-btn-bg)'
                      : 'var(--solva-surface)',
                    color: isSelected
                      ? 'var(--solva-btn-fg)'
                      : 'var(--solva-ink)',
                  }}
                  className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0"
                >
                  {item.id}
                </span>
                <span
                  style={{ color: 'var(--solva-ink)' }}
                  className="text-[12px] font-medium break-all sm:break-normal min-w-0"
                >
                  {item.file}
                </span>
              </div>
              <span
                className={`citra-nowrap-tail whitespace-nowrap text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded shrink-0 ${
                  item.tone === 'emerald'
                    ? 'bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300'
                    : item.tone === 'amber'
                      ? 'bg-amber-500/[0.12] text-amber-800 dark:text-amber-300'
                      : 'bg-red-500/[0.12] text-red-700 dark:text-red-300'
                }`}
              >
                {item.verdict}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active Thesis Summary Footer */}
      <div
        key={activeThesis.id}
        style={{
          backgroundColor: 'var(--solva-surface)',
          borderColor: 'var(--solva-border)',
        }}
        className="p-2.5 rounded-[8px] border space-y-1 animate-debugger-switch"
      >
        <div className="flex flex-wrap items-center justify-between gap-1.5 text-[10.5px]">
          <span style={{ color: 'var(--solva-ink)' }} className="font-semibold">
            {activeThesis.rule}
          </span>
          <span style={{ color: 'var(--solva-muted)' }} className="font-mono shrink-0 whitespace-nowrap">
            {lang === 'vi' ? 'Điểm:' : 'Score:'}{' '}
            <strong style={{ color: 'var(--solva-ink)' }}>
              <SubtleNumber
                value={
                  lang === 'vi'
                    ? activeThesis.cisNum.toFixed(1).replace('.', ',')
                    : activeThesis.cisNum.toFixed(1)
                }
              />
            </strong>
          </span>
        </div>
        <p
          style={{ color: 'var(--solva-muted)' }}
          className="text-[11px] leading-snug"
        >
          {activeThesis.detail}
        </p>
      </div>

      {/* Bottom Action Link to Live Check */}
      <div
        style={getStaggerStyle(250)}
        className="pt-0.5 flex flex-wrap items-center justify-between gap-2 text-[11px]"
      >
        <span style={{ color: 'var(--solva-muted)' }} className="font-mono text-[10px]">
          {lang === 'vi' ? '15+ Thư viện học thuật' : '15+ Academic Libraries'}
        </span>
        <a
          href="/#interactive-demo"
          style={{ color: 'var(--solva-ink)' }}
          className="whitespace-nowrap shrink-0 inline-flex items-center gap-1 font-medium hover:underline"
        >
          <span>
            {lang === 'vi' ? 'Kiểm tra thử ngay' : 'Try live check'}
          </span>
          <ArrowRight className="w-3 h-3 shrink-0" />
        </a>
      </div>
    </div>
  );
}
