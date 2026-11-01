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
import { ScholarlySourceLogo, getScholarlySourceUrl } from './ScholarlySourceLogos';

/* ============================================================
   SOLVA FLOATING UI MOCKUP CARDS (WITH 8PX FROSTED GLASS RING)
   Placed over Impressionist Oil Paintings + 5% Film Grain Noise
   With Smooth Viewport-Aware Count-Up & Autonomous Live Animations
   ============================================================ */

/**
 * Shared IntersectionObserver + Periodic Replay Hook for Floral Demo Cards.
 * - Detects when any floral-box demo card enters or leaves the viewport.
 * - Triggers an immediate count-up from 0 + staggered entrance on scroll-in,
 *   and periodically replays the smooth number & state animation while in view.
 */
export function useFloralCardAnimation(replayIntervalMs = 5200) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [replaySeed, setReplaySeed] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof window === 'undefined') return;

    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      setReplaySeed(1);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          setIsVisible(true);
          setReplaySeed((prev) => prev + 1);
        } else {
          setIsVisible(false);
        }
      },
      { threshold: 0.14 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible || replayIntervalMs <= 0) return;
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      setReplaySeed((prev) => prev + 1);
    }, replayIntervalMs);
    return () => window.clearInterval(timer);
  }, [isVisible, replayIntervalMs]);

  const getStaggerStyle = (delayMs = 0): CSSProperties => ({
    opacity: isVisible ? 1 : 0.001,
    transform: isVisible ? 'translate3d(0, 0, 0)' : 'translate3d(0, 14px, 0)',
    filter: isVisible ? 'none' : 'blur(2.5px)',
    transitionProperty: 'opacity, transform, filter, background-color, border-color',
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
  prefix: string,
  suffix: string
): string {
  const fixed = num.toFixed(decimals);
  let body: string;
  if (padDigits > 0 && decimals === 0) {
    body = Math.round(num).toString().padStart(padDigits, '0');
  } else if (!formatThousands) {
    body = fixed;
  } else {
    const [intPart, decPart] = fixed.split('.');
    const withSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousandSeparator);
    body = decPart !== undefined ? `${withSep}.${decPart}` : withSep;
  }
  return `${prefix}${body}${suffix}`;
}

/**
 * Smooth Quartic Ease-Out Animated Number (`SolvaLiveNumber`)
 * Replicates and extends the smooth count-up feel of `SolvaAnimatedMetric` (15+, 96.4%, 4.9/5)
 * inside every floral demo card.
 * Updates DOM `textContent` directly in `requestAnimationFrame` to avoid ~4,200 React re-renders/sec.
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
  className?: string;
}) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const currentValRef = useRef<number>(value);
  const prevSeedRef = useRef<number>(replaySeed);
  const prevTargetRef = useRef<number>(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
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

    const startTime = performance.now();
    let lastText = '';

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / Math.max(140, activeDuration));
      // Quartic ease-out for silky deceleration matching SolvaAnimatedMetric
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
    prefix,
    suffix,
  ]);

  const formattedTarget = formatSolvaLiveNumber(
    value,
    decimals,
    padDigits,
    formatThousands,
    thousandSeparator,
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
 * Cropped off the right and bottom edge of the 660x521px oil painting frame,
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
  const { containerRef, isVisible, replaySeed, getStaggerStyle } = useFloralCardAnimation(5800);
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
      title: 'Attention Is All You Need · NeurIPS',
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
      ref: 'Devlin et al. (2019)',
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
    { name: 'SemanticSch', ms: selected.latencies[2] },
  ];

  return (
    <div
      ref={containerRef}
      style={{
        backgroundColor: 'var(--solva-card-elevated)',
        ...getStaggerStyle(0),
      }}
      className="solva-glass-ring rounded-[10px] w-full max-w-full lg:w-[640px] border border-[#E7E3D9]/80 dark:border-[#332F26] overflow-hidden text-left select-none"
    >
      {/* Top Window Chrome */}
      <div
        style={{ borderColor: 'var(--solva-border)' }}
        className="px-3 sm:px-4 py-2.5 sm:py-3 border-b flex items-center justify-between gap-2 bg-[#FBFAF6]/90 dark:bg-[#1E1C17] min-w-0"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5 shrink-0" aria-label="macOS window controls">
            <span className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E]/60 shadow-2xs" />
            <span className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123]/60 shadow-2xs" />
            <span className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29]/60 shadow-2xs" />
          </div>
          <span
            style={{ color: 'var(--solva-ink)' }}
            className="text-[11px] sm:text-[12px] font-medium truncate ml-1"
          >
            thesis_citation_audit_2026.pdf
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[5px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-mono text-[10px] font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>
              GROBID TEI ·{' '}
              <SolvaLiveNumber value={15} replaySeed={replaySeed} durationMs={1250} /> APIs
            </span>
          </span>
          <span
            style={{
              backgroundColor: 'var(--solva-surface)',
              color: 'var(--solva-ink)',
            }}
            className="px-2 py-0.5 rounded-[5px] font-mono text-[10px] font-semibold"
          >
            CIS:{' '}
            <SolvaLiveNumber
              value={selected.cisScore}
              decimals={1}
              replaySeed={replaySeed}
              durationMs={1400}
            />
          </span>
        </div>
      </div>

      {/* Two-Column Workspace Preview */}
      <div className="grid sm:grid-cols-12 min-w-0">
        {/* Left Queue */}
        <div
          style={{ borderColor: 'var(--solva-border)' }}
          className="sm:col-span-5 min-w-0 p-3 sm:p-3.5 border-b sm:border-b-0 sm:border-r space-y-2"
        >
          <div className="flex items-center justify-between gap-2 text-[10px] sm:text-[11px] font-mono">
            <span style={{ color: 'var(--solva-muted)' }} className="truncate">
              {lang === 'vi' ? 'DANH SÁCH TRÍCH DẪN' : 'EXTRACTED QUEUE'}
            </span>
            <span style={{ color: 'var(--solva-ink)' }} className="font-semibold shrink-0">
              <SolvaLiveNumber value={24} replaySeed={replaySeed} durationMs={1350} />{' '}
              {lang === 'vi' ? 'mục' : 'refs'}
            </span>
          </div>

          {citations.map((item, idx) => {
            const isActive = idx === activeStep % citations.length;
            return (
              <div
                key={item.marker}
                onClick={() => onSelectStep?.(idx)}
                style={{
                  ...getStaggerStyle(70 + idx * 65),
                  backgroundColor: isActive ? 'var(--solva-surface)' : 'transparent',
                  borderColor: isActive ? 'var(--solva-ink)' : 'var(--solva-border)',
                }}
                className="p-2.5 rounded-[8px] border transition-all duration-300 cursor-pointer hover:opacity-90"
              >
                <div className="flex items-center justify-between gap-1.5 mb-1">
                  <span
                    style={{ color: 'var(--solva-ink)' }}
                    className="text-[12px] font-medium truncate"
                  >
                    {item.marker} {item.ref}
                  </span>
                  <span className="font-mono text-[10px] font-semibold text-[#56524A] dark:text-[#A8A296]">
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
                  className="text-[11px] truncate mb-1.5"
                >
                  {item.title}
                </p>
                <div className="flex items-center justify-between gap-1.5">
                  <span
                    className={`text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded ${
                      item.tone === 'emerald'
                        ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                        : item.tone === 'amber'
                          ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
                          : 'bg-red-500/12 text-red-700 dark:text-red-300'
                    }`}
                  >
                    {item.l2}
                  </span>
                  {isActive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Right Live Verdict Trace */}
        <div
          key={selected.marker}
          className="sm:col-span-7 p-4 space-y-3 animate-debugger-switch"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div
                style={{ color: 'var(--solva-muted)' }}
                className="text-[10px] font-mono uppercase tracking-wider"
              >
                {lang === 'vi' ? 'HỒ SƠ THẨM ĐỊNH TRỰC TIẾP' : 'LIVE VERDICT TRACE'}{' '}
                {selected.marker}
              </div>
              <div
                style={{ color: 'var(--solva-ink)' }}
                className="text-[14px] font-medium leading-snug mt-0.5"
              >
                {selected.title}
              </div>
            </div>
            <span
              style={{
                backgroundColor: 'var(--solva-btn-bg)',
                color: 'var(--solva-btn-fg)',
              }}
              className="px-2 py-0.5 rounded-[5px] text-[10px] font-mono shrink-0"
            >
              {selected.l1}
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
            <div className="flex items-center justify-between">
              <span style={{ color: 'var(--solva-muted)' }} className="font-mono">
                DOI:
              </span>
              <span
                style={{ color: 'var(--solva-ink)' }}
                className="font-mono truncate max-w-[180px]"
              >
                {selected.doi}
              </span>
              <span
                className={`font-mono text-[10px] font-semibold ${
                  selected.tone === 'red'
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {selected.tone === 'red' ? (
                  lang === 'vi' ? '404 Không tồn tại' : '404 Ghost'
                ) : (
                  <SolvaLiveNumber
                    value={100}
                    suffix={lang === 'vi' ? '% Khớp chuẩn' : '% Match'}
                    replaySeed={replaySeed}
                    durationMs={1150}
                  />
                )}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span style={{ color: 'var(--solva-muted)' }} className="font-mono">
                {lang === 'vi' ? 'Quy tắc:' : 'Rule:'}
              </span>
              <span style={{ color: 'var(--solva-ink)' }} className="font-mono">
                {selected.tone === 'emerald'
                  ? 'R01_EXACT_DOI_VERIFIED'
                  : selected.tone === 'amber'
                    ? 'R05_YEAR_DRIFT (2018 vs 2019)'
                    : 'R14_HALLUCINATED_SOURCE'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span style={{ color: 'var(--solva-muted)' }} className="font-mono">
                {lang === 'vi' ? 'Ngữ cảnh NLI:' : 'NLI Stance:'}
              </span>
              <span className="font-mono text-emerald-700 dark:text-emerald-300 font-medium">
                {selected.tone === 'red' ? (
                  lang === 'vi' ? 'KHÔNG THỂ XÁC THỰC (Thiếu bài gốc)' : 'UNVERIFIABLE (No Abstract)'
                ) : (
                  <>
                    {lang === 'vi' ? 'ĐỒNG THUẬN (DeBERTa ' : 'SUPPORTS (DeBERTa '}
                    <SolvaLiveNumber
                      value={selected.nliScore}
                      decimals={2}
                      replaySeed={replaySeed}
                      durationMs={1250}
                    />
                    )
                  </>
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
                ? 'ĐỐI CHIẾU CHÉO TRÊN 15+ CSDL HỌC THUẬT QUỐC TẾ'
                : 'FEDERATED SCHOLARLY API WATERFALL'}
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono">
              {apiSources.map((s, idx) => {
                const isPulsing = idx === activeApiPulse;
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
                    className="group px-2 py-1.5 rounded-[6px] border flex items-center justify-between gap-1 transition-all duration-300 hover:border-[#1C1A15]/60 dark:hover:border-[#FBFAF6]/50 cursor-pointer"
                  >
                    <span
                      style={{ color: 'var(--solva-ink)' }}
                      className="inline-flex items-center gap-1 truncate group-hover:underline underline-offset-2"
                    >
                      <ScholarlySourceLogo name={s.name} size={11} />
                      <span className="truncate">{s.name}</span>
                    </span>
                    <span style={{ color: 'var(--solva-muted)' }} className="shrink-0">
                      <SolvaLiveNumber
                        value={s.ms}
                        suffix="ms"
                        replaySeed={replaySeed}
                        durationMs={1050 + idx * 140}
                      />
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
  const { containerRef, isVisible, replaySeed, getStaggerStyle } = useFloralCardAnimation(5000);
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
    // Widget 1: Two-Layer Orthogonal Matrix
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
        className="solva-glass-ring w-[272px] sm:w-[288px] h-[272px] sm:h-[288px] rounded-[16px] p-4 flex flex-col justify-between text-left border border-[#E7E3D9]/70 dark:border-[#332F26]"
      >
        <div style={getStaggerStyle(40)} className="flex items-center justify-between">
          <span
            style={{ color: 'var(--solva-ink)' }}
            className="text-[12px] font-medium flex items-center gap-1.5"
          >
            <Layers className="w-3.5 h-3.5" />
            {lang === 'vi' ? 'Kiến trúc 2 Tầng Độc lập' : '2-Layer Orthogonal Output'}
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#F4F2EC] dark:bg-[#29261F] text-[#56524A] dark:text-[#A8A296]">
            L1 × L2
          </span>
        </div>

        <div className="space-y-2 my-auto">
          <div
            style={{
              ...getStaggerStyle(110),
              backgroundColor: 'var(--solva-surface)',
              borderColor: highlightL1 ? 'var(--solva-ink)' : 'transparent',
            }}
            className="p-2.5 rounded-[10px] border space-y-1 transition-all duration-500"
          >
            <div className="flex items-center justify-between text-[10px] font-mono">
              <span style={{ color: 'var(--solva-muted)' }}>
                {lang === 'vi' ? 'TẦNG 1 · ĐỐI CHIẾU NỘI BỘ' : 'LAYER 1 · MAPPING'}
              </span>
              <span className="text-emerald-700 dark:text-emerald-400 font-semibold inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                MATCHED
              </span>
            </div>
            <p style={{ color: 'var(--solva-ink)' }} className="text-[12px] font-medium">
              {lang === 'vi' ? 'Trong bài [' : 'In-text ['}
              <SolvaLiveNumber value={activeRefNum} replaySeed={replaySeed} durationMs={1150} />
              {lang === 'vi' ? '] ↔ Danh mục #' : '] ↔ Bibliography #'}
              <SolvaLiveNumber value={activeRefNum} replaySeed={replaySeed} durationMs={1150} />
            </p>
          </div>

          <div
            style={{
              ...getStaggerStyle(190),
              backgroundColor: 'var(--solva-surface)',
              borderColor: highlightL2 ? 'var(--solva-ink)' : 'transparent',
            }}
            className="p-2.5 rounded-[10px] border space-y-1 transition-all duration-500"
          >
            <div className="flex items-center justify-between text-[10px] font-mono">
              <span style={{ color: 'var(--solva-muted)' }}>
                {lang === 'vi' ? 'TẦNG 2 · XÁC THỰC NGUỒN GỐC' : 'LAYER 2 · EXISTENCE'}
              </span>
              <span className="text-amber-700 dark:text-amber-400 font-semibold">
                METADATA_ERROR
              </span>
            </div>
            <p style={{ color: 'var(--solva-ink)' }} className="text-[12px] font-medium">
              {lang === 'vi' ? 'DOI hợp lệ · Lệch năm (' : 'DOI valid · Year drift ('}
              <SolvaLiveNumber
                value={2020}
                startValue={2000}
                replaySeed={replaySeed}
                durationMs={1200}
              />{' '}
              →{' '}
              <SolvaLiveNumber
                value={2021}
                startValue={2000}
                replaySeed={replaySeed}
                durationMs={1350}
              />
              )
            </p>
          </div>
        </div>

        <div
          style={{
            ...getStaggerStyle(260),
            borderColor: 'var(--solva-border)',
          }}
          className="pt-2.5 border-t flex items-center justify-between text-[11px]"
        >
          <span style={{ color: 'var(--solva-muted)' }}>
            <SolvaLiveNumber value={7} replaySeed={replaySeed} durationMs={1100} />{' '}
            {lang === 'vi' ? 'trạng thái T1 · ' : 'L1 states · '}
            <SolvaLiveNumber value={8} replaySeed={replaySeed} durationMs={1250} />{' '}
            {lang === 'vi' ? 'nhãn T2' : 'L2 verdicts'}
          </span>
          <span
            style={{ color: 'var(--solva-ink)' }}
            className="font-mono font-semibold"
          >
            <SolvaLiveNumber
              value={100}
              suffix={lang === 'vi' ? '% Độc lập' : '% Orthogonal'}
              replaySeed={replaySeed}
              durationMs={1450}
            />
          </span>
        </div>
      </div>
    );
  }

  if (index === 1) {
    // Widget 2: 15+ Scholarly APIs Waterfall
    const apis = [
      {
        name: 'Crossref REST API',
        status: lang === 'vi' ? 'Khớp DOI' : 'DOI Exact',
        baseMs: 38,
        delta: 2,
      },
      {
        name: 'OpenAlex Works',
        status: lang === 'vi' ? 'Khớp Work ID' : 'Work ID Match',
        baseMs: 49,
        delta: -2,
      },
      {
        name: 'Semantic Scholar',
        status: lang === 'vi' ? 'Ngữ nghĩa' : 'Embedding',
        score: 0.96,
        baseMs: 62,
        delta: 3,
      },
      {
        name: 'PubMed / EuropePMC',
        status: lang === 'vi' ? 'Xác thực PMID' : 'PMID Verified',
        baseMs: 54,
        delta: -1,
      },
      {
        name: 'SQLite FTS5 Cache',
        status: lang === 'vi' ? 'Đệm cục bộ' : 'Local Hit',
        baseMs: 3,
        delta: 0,
      },
    ];
    return (
      <div
        ref={containerRef}
        style={{
          backgroundColor: 'var(--solva-card-elevated)',
          ...getStaggerStyle(0),
        }}
        className="solva-glass-ring w-[272px] sm:w-[288px] h-[272px] sm:h-[288px] rounded-[16px] p-4 flex flex-col justify-between text-left border border-[#E7E3D9]/70 dark:border-[#332F26]"
      >
        <div style={getStaggerStyle(40)} className="flex items-center justify-between">
          <span
            style={{ color: 'var(--solva-ink)' }}
            className="text-[12px] font-medium flex items-center gap-1.5"
          >
            <Database className="w-3.5 h-3.5" />
            <SolvaLiveNumber value={15} suffix="+" replaySeed={replaySeed} durationMs={1200} />{' '}
            {lang === 'vi' ? 'CSDL Khoa học' : 'Scholarly Indexes'}
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-semibold inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {lang === 'vi' ? 'SONG SONG' : 'PARALLEL'}
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
                className="group px-2.5 py-1.5 rounded-[8px] border flex items-center justify-between text-[11px] transition-all duration-300 hover:border-[#1C1A15]/50 dark:hover:border-[#FBFAF6]/40 cursor-pointer"
              >
                <span
                  style={{ color: 'var(--solva-ink)' }}
                  className="font-medium truncate inline-flex items-center gap-1.5 group-hover:underline underline-offset-2"
                >
                  <ScholarlySourceLogo name={api.name} size={13} className="opacity-85 group-hover:opacity-100" />
                  <span className="truncate">{api.name}</span>
                </span>
                <span className="font-mono text-[10px] text-emerald-700 dark:text-emerald-300 shrink-0 ml-2">
                  {api.score !== undefined ? (
                    <>
                      {api.status}{' '}
                      <SolvaLiveNumber
                        value={api.score}
                        decimals={2}
                        replaySeed={replaySeed}
                        durationMs={1200}
                      />
                    </>
                  ) : (
                    api.status
                  )}{' '}
                  ·{' '}
                  <SolvaLiveNumber
                    value={liveMs}
                    suffix="ms"
                    replaySeed={replaySeed}
                    durationMs={1050 + idx * 110}
                  />
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
          className="pt-2 border-t flex items-center justify-between text-[11px]"
        >
          <span style={{ color: 'var(--solva-muted)' }}>
            + arXiv, DBLP, DOAJ, ORCID
          </span>
          <span style={{ color: 'var(--solva-ink)' }} className="font-mono font-semibold">
            <SolvaLiveNumber
              value={200}
              suffix={lang === 'vi' ? 'M+ Công trình' : 'M+ Works'}
              replaySeed={replaySeed}
              durationMs={1500}
            />
          </span>
        </div>
      </div>
    );
  }

  // Widget 3: Neuro-Symbolic + DeBERTa NLI Stance
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
      className="solva-glass-ring w-[272px] sm:w-[288px] h-[272px] sm:h-[288px] rounded-[16px] p-4 flex flex-col justify-between text-left border border-[#E7E3D9]/70 dark:border-[#332F26]"
    >
      <div style={getStaggerStyle(40)} className="flex items-center justify-between">
        <span
          style={{ color: 'var(--solva-ink)' }}
          className="text-[12px] font-medium flex items-center gap-1.5"
        >
          <Scale className="w-3.5 h-3.5" />
          {lang === 'vi' ? 'Suy luận Logic & Ngữ nghĩa NLI' : 'Neuro-Symbolic & NLI'}
        </span>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#1C1A15] text-[#FBFAF6] dark:bg-[#FBFAF6] dark:text-[#1C1A15]">
          R01–R<SolvaLiveNumber value={20} padDigits={2} replaySeed={replaySeed} durationMs={1200} />
        </span>
      </div>

      <div className="space-y-2 my-auto">
        <div
          style={{
            ...getStaggerStyle(110),
            backgroundColor: 'var(--solva-surface)',
            borderColor: cycleStep === 0 ? 'var(--solva-ink)' : 'transparent',
          }}
          className="p-2.5 rounded-[10px] border space-y-1 transition-all duration-500"
        >
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span style={{ color: 'var(--solva-muted)' }}>
              {lang === 'vi' ? 'ĐỒ THỊ QUY TẮC HÌNH THỨC' : 'SYMBOLIC RULE GRAPH'}
            </span>
            <span className="text-emerald-700 dark:text-emerald-300 font-semibold inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {lang === 'vi' ? 'ĐẠT CHUẨN' : 'PASSED'}
            </span>
          </div>
          <p style={{ color: 'var(--solva-ink)' }} className="text-[11px] font-mono">
            R<SolvaLiveNumber value={1} padDigits={2} replaySeed={replaySeed} durationMs={900} />
            _DOI ∧ R
            <SolvaLiveNumber value={3} padDigits={2} replaySeed={replaySeed} durationMs={1050} />
            _TITLE_SIM (
            <SolvaLiveNumber
              value={currentSim}
              decimals={2}
              replaySeed={replaySeed}
              durationMs={1350}
            />
            )
          </p>
        </div>

        <div
          style={{
            ...getStaggerStyle(190),
            backgroundColor: 'var(--solva-surface)',
            borderColor: cycleStep === 1 ? 'var(--solva-ink)' : 'transparent',
          }}
          className="p-2.5 rounded-[10px] border space-y-1.5 transition-all duration-500"
        >
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span style={{ color: 'var(--solva-muted)' }}>
              {lang === 'vi' ? 'NGỮ CẢNH DeBERTa-v3 NLI' : 'DeBERTa-v3 CLAIM STANCE'}
            </span>
            <span className="text-emerald-700 dark:text-emerald-300 font-semibold">
              {lang === 'vi' ? 'ĐỒNG THUẬN (' : 'SUPPORTS ('}
              <SolvaLiveNumber
                value={currentStance}
                suffix="%"
                replaySeed={replaySeed}
                durationMs={1400}
              />
              )
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-[#ECE9E0] dark:bg-[#29261F] overflow-hidden">
            <div
              style={{ width: `${currentStance}%` }}
              className="h-full rounded-full bg-[#1C1A15] dark:bg-[#FBFAF6] transition-all duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)]"
            />
          </div>
        </div>
      </div>

      <div
        style={{
          ...getStaggerStyle(260),
          borderColor: 'var(--solva-border)',
        }}
        className="pt-2 border-t flex items-center justify-between text-[11px]"
      >
        <span style={{ color: 'var(--solva-muted)' }}>MiniLM-L6 + CrossEncoder</span>
        <span style={{ color: 'var(--solva-ink)' }} className="font-mono font-semibold">
          {lang === 'vi' ? 'AI Giải thích được' : 'Explainable AI'}
        </span>
      </div>
    </div>
  );
}

/**
 * 3. STICKY CARD FLOATING WIDGETS (340x340px inside 667x548px oil painting frame)
 * Exact 1:1 visual layout of Screenshots 0, 1, 2 with smooth staggered entrance & auto-running numbers.
 */
export function StickyCardWidget({
  index,
  lang,
}: {
  index: 0 | 1 | 2;
  lang: Lang;
}) {
  const { containerRef, isVisible, replaySeed } = useFloralCardAnimation(4800);
  const [activePhase, setActivePhase] = useState(0);

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
    // Card 0: GROBID TEI-XML + Cross-Validator (Screenshot 0)
    const xmlIds = [12, 15, 18, 12];
    const currentXmlId = xmlIds[activePhase % xmlIds.length];

    return (
      <div
        ref={containerRef}
        style={{
          backgroundColor: 'var(--solva-card-elevated)',
        }}
        className="solva-glass-ring w-full max-w-[340px] rounded-[12px] p-5 space-y-3.5 text-left border border-[#E7E3D9]/80 dark:border-[#332F26]"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#1C1A15] dark:text-[#FBFAF6]" />
            <span
              style={{ color: 'var(--solva-ink)' }}
              className="text-[13px] font-medium"
            >
              {lang === 'vi'
                ? 'GROBID TEI-XML + Đối soát đa chuẩn'
                : 'GROBID TEI-XML + Cross-Validator'}
            </span>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 font-semibold inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {lang === 'vi' ? 'HOẠT ĐỘNG' : 'ACTIVE'}
          </span>
        </div>

        <div
          style={{
            backgroundColor: 'var(--solva-surface)',
          }}
          className="p-3 rounded-[8px] font-mono text-[11px] space-y-1.5"
        >
          <div
            style={{
              color: activePhase === 0 ? 'var(--solva-ink)' : 'var(--solva-muted)',
              transform: activePhase === 0 ? 'translateX(2px)' : 'translateX(0px)',
            }}
            className="transition-all duration-300"
          >
            &lt;biblStruct xml:id=&quot;b
            <SolvaLiveNumber
              value={currentXmlId}
              padDigits={2}
              replaySeed={replaySeed}
              durationMs={1250}
            />
            &quot;&gt;
          </div>
          <div
            style={{
              color: 'var(--solva-ink)',
              transform: activePhase === 1 ? 'translateX(3px)' : 'translateX(0px)',
            }}
            className="pl-3 transition-all duration-300"
          >
            &lt;title&gt;Deep Residual Learning&lt;/title&gt;
          </div>
          <div
            style={{
              color: 'var(--solva-ink)',
              transform: activePhase === 2 ? 'translateX(3px)' : 'translateX(0px)',
            }}
            className="pl-3 transition-all duration-300"
          >
            &lt;idno type=&quot;DOI&quot;&gt;10.
            <SolvaLiveNumber value={1109} replaySeed={replaySeed} durationMs={1300} />
            /CVPR.
            <SolvaLiveNumber
              value={2016}
              startValue={2000}
              replaySeed={replaySeed}
              durationMs={1350}
            />
            .
            <SolvaLiveNumber value={90} replaySeed={replaySeed} durationMs={1400} />
            &lt;/idno&gt;
          </div>
          <div
            style={{
              color: activePhase === 3 ? 'var(--solva-ink)' : 'var(--solva-muted)',
              transform: activePhase === 3 ? 'translateX(2px)' : 'translateX(0px)',
            }}
            className="transition-all duration-300"
          >
            &lt;/biblStruct&gt;
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px]">
          {[
            {
              key: 'ieee',
              node: (
                <>
                  IEEE [
                  <SolvaLiveNumber value={1} replaySeed={replaySeed} durationMs={900} />
                  ]–[N]
                </>
              ),
            },
            {
              key: 'apa',
              node: (
                <>
                  APA{' '}
                  <SolvaLiveNumber value={7} replaySeed={replaySeed} durationMs={1100} />
                  th (Author, Yr)
                </>
              ),
            },
            {
              key: 'vancouver',
              node: (
                <>
                  Vancouver (
                  <SolvaLiveNumber value={1} replaySeed={replaySeed} durationMs={1000} />)
                </>
              ),
            },
            {
              key: 'acm',
              node: <>ACM / Harvard</>,
            },
          ].map((item, idx) => {
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
                className="px-2.5 py-1.5 rounded-[6px] border flex items-center gap-1.5 transition-all duration-300"
              >
                <Check
                  className={`w-3 h-3 text-emerald-600 shrink-0 transition-transform duration-300 ${
                    isStyleActive ? 'scale-125' : 'scale-100'
                  }`}
                />
                <span style={{ color: 'var(--solva-ink)' }} className="truncate">
                  {item.node}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (index === 1) {
    // Card 1: Symbolic Trace & Instructor Override (Screenshot 1)
    const stanceValues = [0.93, 0.96, 0.93];
    const currentStance = stanceValues[activePhase % stanceValues.length];

    return (
      <div
        ref={containerRef}
        style={{
          backgroundColor: 'var(--solva-card-elevated)',
        }}
        className="solva-glass-ring w-full max-w-[340px] rounded-[12px] p-5 space-y-3.5 text-left border border-[#E7E3D9]/80 dark:border-[#332F26]"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-[#1C1A15] dark:text-[#FBFAF6]" />
            <span
              style={{ color: 'var(--solva-ink)' }}
              className="text-[13px] font-medium"
            >
              {lang === 'vi'
                ? 'Chuỗi suy luận & Quyền thẩm định Giảng viên'
                : 'Symbolic Trace & Instructor Override'}
            </span>
          </div>
        </div>

        <div className="space-y-2">
          {/* Rule 1: R01_DOI_EXACT */}
          <div
            style={{
              backgroundColor: 'var(--solva-surface)',
              borderColor: activePhase === 0 ? 'var(--solva-ink)' : 'transparent',
              transform: activePhase === 0 ? 'translateY(-1px)' : 'translateY(0px)',
            }}
            className="p-2.5 rounded-[8px] border flex items-center justify-between gap-2 transition-all duration-300"
          >
            <div className="min-w-0">
              <div
                style={{ color: 'var(--solva-ink)' }}
                className="text-[11px] font-mono font-semibold"
              >
                R<SolvaLiveNumber value={1} padDigits={2} replaySeed={replaySeed} durationMs={1000} />
                _DOI_EXACT
              </div>
              <div
                style={{ color: 'var(--solva-muted)' }}
                className="text-[11px] truncate"
              >
                {lang === 'vi'
                  ? 'Đã xác thực mã DOI chuẩn trên Crossref'
                  : 'Canonical DOI verified via Crossref'}
              </div>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold shrink-0 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
              {lang === 'vi' ? 'ĐẠT' : 'PASS'}
            </span>
          </div>

          {/* Rule 2: R05_YEAR_DRIFT */}
          <div
            style={{
              backgroundColor: 'var(--solva-surface)',
              borderColor: activePhase === 1 ? 'var(--solva-ink)' : 'transparent',
              transform: activePhase === 1 ? 'translateY(-1px)' : 'translateY(0px)',
            }}
            className="p-2.5 rounded-[8px] border flex items-center justify-between gap-2 transition-all duration-300"
          >
            <div className="min-w-0">
              <div
                style={{ color: 'var(--solva-ink)' }}
                className="text-[11px] font-mono font-semibold"
              >
                R<SolvaLiveNumber value={5} padDigits={2} replaySeed={replaySeed} durationMs={1150} />
                _YEAR_DRIFT
              </div>
              <div
                style={{ color: 'var(--solva-muted)' }}
                className="text-[11px] truncate"
              >
                {lang === 'vi' ? 'Ghi trong bài ' : 'Cited '}
                <SolvaLiveNumber
                  value={2018}
                  startValue={2000}
                  replaySeed={replaySeed}
                  durationMs={1250}
                />{' '}
                {lang === 'vi' ? '· Công bố ' : '· Published '}
                <SolvaLiveNumber
                  value={2019}
                  startValue={2000}
                  replaySeed={replaySeed}
                  durationMs={1350}
                />{' '}
                (Δ=
                <SolvaLiveNumber value={1} replaySeed={replaySeed} durationMs={1050} />
                {lang === 'vi' ? ' năm)' : 'yr)'}
              </div>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold shrink-0 bg-amber-500/12 text-amber-700 dark:text-amber-300">
              {lang === 'vi' ? 'LƯU Ý' : 'WARN'}
            </span>
          </div>

          {/* Rule 3: NLI_CLAIM_STANCE */}
          <div
            style={{
              backgroundColor: 'var(--solva-surface)',
              borderColor: activePhase === 2 ? 'var(--solva-ink)' : 'transparent',
              transform: activePhase === 2 ? 'translateY(-1px)' : 'translateY(0px)',
            }}
            className="p-2.5 rounded-[8px] border flex items-center justify-between gap-2 transition-all duration-300"
          >
            <div className="min-w-0">
              <div
                style={{ color: 'var(--solva-ink)' }}
                className="text-[11px] font-mono font-semibold"
              >
                NLI_CLAIM_STANCE
              </div>
              <div
                style={{ color: 'var(--solva-muted)' }}
                className="text-[11px] truncate"
              >
                {lang === 'vi'
                  ? 'Luận điểm trích dẫn được bài gốc củng cố'
                  : 'Manuscript claim supported by abstract'}
              </div>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold shrink-0 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
              <SolvaLiveNumber
                value={currentStance}
                decimals={2}
                replaySeed={replaySeed}
                durationMs={1450}
              />
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Card 2: Revision Progress & Integrity Score (Screenshot 2)
  const draftV2Targets = [94.5, 95.6, 94.5];
  const cisDeltaTargets = [26.5, 27.6, 26.5];
  const currentV2 = draftV2Targets[activePhase % draftV2Targets.length];
  const currentCisDelta = cisDeltaTargets[activePhase % cisDeltaTargets.length];

  return (
    <div
      ref={containerRef}
      style={{
        backgroundColor: 'var(--solva-card-elevated)',
      }}
      className="solva-glass-ring w-full max-w-[340px] rounded-[12px] p-5 space-y-3.5 text-left border border-[#E7E3D9]/80 dark:border-[#332F26]"
    >
      <div className="flex items-center justify-between gap-2">
        <span
          style={{ color: 'var(--solva-ink)' }}
          className="text-[13px] font-medium flex items-center gap-1.5 min-w-0"
        >
          <Sparkles className="w-4 h-4 shrink-0" />
          <span className="leading-snug">
            {lang === 'vi'
              ? 'Hành trình Hoàn thiện Chất lượng Bản thảo'
              : 'Revision Progress & Integrity Score'}
          </span>
        </span>
        <span className="text-[11px] font-mono font-bold text-emerald-700 dark:text-emerald-300 shrink-0 whitespace-nowrap">
          <SolvaLiveNumber
            value={currentCisDelta}
            prefix="+"
            suffix=" CIS"
            decimals={1}
            replaySeed={replaySeed}
            durationMs={1500}
          />
        </span>
      </div>

      <div
        style={{
          backgroundColor: 'var(--solva-surface)',
        }}
        className="p-3.5 rounded-[10px] flex items-center justify-between"
      >
        <div>
          <div style={{ color: 'var(--solva-muted)' }} className="text-[11px]">
            {lang === 'vi' ? 'Bản nháp v1 (Trước rà soát)' : 'Draft v1 (Before Audit)'}
          </div>
          <div
            style={{ color: 'var(--solva-ink)' }}
            className="font-solva-serif text-[26px] leading-tight"
          >
            <SolvaLiveNumber
              value={68.0}
              decimals={1}
              suffix="%"
              replaySeed={replaySeed}
              durationMs={1350}
            />
          </div>
        </div>
        <div
          style={{
            color: 'var(--solva-muted)',
            transform: activePhase === 1 ? 'translateX(3px)' : 'translateX(0px)',
          }}
          className="font-mono text-sm transition-transform duration-500"
        >
          →
        </div>
        <div className="text-right">
          <div style={{ color: 'var(--solva-muted)' }} className="text-[11px]">
            {lang === 'vi' ? 'Bản nộp v2 (Đã chuẩn hóa)' : 'Draft v2 (Verified)'}
          </div>
          <div className="font-solva-serif text-[26px] leading-tight text-emerald-700 dark:text-emerald-300">
            <SolvaLiveNumber
              value={currentV2}
              decimals={1}
              suffix="%"
              replaySeed={replaySeed}
              durationMs={1550}
            />
          </div>
        </div>
      </div>

      <div className="space-y-1.5 text-[11px]">
        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--solva-muted)' }}>
            {lang === 'vi'
              ? 'Trích dẫn ảo / DOI hư cấu đã loại bỏ'
              : 'Hallucinated / Ghost DOIs resolved'}
          </span>
          <span style={{ color: 'var(--solva-ink)' }} className="font-mono font-semibold">
            <SolvaLiveNumber value={3} replaySeed={replaySeed} durationMs={1050} /> →{' '}
            <SolvaLiveNumber
              value={0}
              startValue={3}
              replaySeed={replaySeed}
              durationMs={1400}
            />
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--solva-muted)' }}>
            {lang === 'vi'
              ? 'Mục tham khảo bị khuyết đã bổ sung'
              : 'Missing bibliography entries fixed'}
          </span>
          <span style={{ color: 'var(--solva-ink)' }} className="font-mono font-semibold">
            <SolvaLiveNumber value={4} replaySeed={replaySeed} durationMs={1100} /> →{' '}
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
  const { containerRef, isVisible, replaySeed, getStaggerStyle } = useFloralCardAnimation(5200);
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
          ? 'GIAI ĐOẠN 01 · GROBID TEI-XML & ĐỐI SOÁT ĐA CHUẨN'
          : 'STAGE 01 · GROBID TEI-XML & CROSS-VALIDATOR',
      title:
        lang === 'vi'
          ? 'Phân tách cấu trúc bản thảo & Chuẩn hóa trích dẫn đa quy cách'
          : 'Structural Manuscript Segmentation & Multi-Style Reference Parsing',
      metrics: [
        {
          k: lang === 'vi' ? 'Bộ máy phân tích' : 'Engine',
          v: lang === 'vi' ? 'GROBID Học sâu + Bộ đối soát đa chuẩn' : 'GROBID CRF/DL + Regex Cross-Validator',
        },
        {
          k: lang === 'vi' ? 'Quy chuẩn hỗ trợ' : 'Supported Styles',
          v: 'IEEE, APA 7th, Vancouver, Harvard, ACM',
        },
        {
          k: lang === 'vi' ? 'Khoanh vùng bố cục' : 'Section Filtering',
          v: lang === 'vi' ? 'Tách biệt Thân bài & Danh mục tham khảo' : 'Body vs. Bibliography Boundary Lock',
        },
      ],
    },
    {
      badge:
        lang === 'vi'
          ? 'GIAI ĐOẠN 02 · LIÊN HỢP 15+ CSDL HỌC THUẬT QUỐC TẾ'
          : 'STAGE 02 · 15+ FEDERATED SCHOLARLY INDEXES',
      title:
        lang === 'vi'
          ? 'Truy vấn song song bất đồng bộ kết hợp bộ nhớ đệm SQLite FTS5'
          : 'Async Parallel Bibliographic Retrieval with SQLite FTS5 Cache',
      metrics: [
        {
          k: lang === 'vi' ? 'Tầng CSDL chủ lực' : 'Primary Tier',
          v: 'Crossref, OpenAlex, Semantic Scholar, PubMed',
        },
        {
          k: lang === 'vi' ? 'Tầng chuyên ngành' : 'Specialized Tier',
          v: 'arXiv, DBLP, Europe PMC, DOAJ, ORCID',
        },
        {
          k: 'Cache Hit Latency',
          label: lang === 'vi' ? 'Độ trễ bộ nhớ đệm' : 'Cache Hit Latency',
          v: '3.2 ms (BM25 + Trigram FTS5)',
        },
      ],
    },
    {
      badge:
        lang === 'vi'
          ? 'GIAI ĐOẠN 03 · ĐỒ THỊ QUY TẮC NEURO-SYMBOLIC (R01–R20)'
          : 'STAGE 03 · NEURO-SYMBOLIC RULE GRAPH (R01–R20)',
      title:
        lang === 'vi'
          ? 'Đối sánh chi tiết từng trường thư mục & Suy luận quy tắc hình thức'
          : 'Field-Level Metadata Verification & Deterministic Rule Graph',
      metrics: [
        {
          k: 'Title Similarity',
          label: lang === 'vi' ? 'Độ tương đồng tiêu đề' : 'Title Similarity',
          v: 'Token Jaccard + Levenshtein + MiniLM (0.98)',
        },
        {
          k: lang === 'vi' ? 'Đối chiếu Tác giả & Năm' : 'Author & Year Check',
          v: lang === 'vi' ? 'So khớp mờ họ tác giả · Độ lệch chuẩn ±1 năm' : 'Surname Fuzzy Match · ΔYear Tolerance ±1',
        },
        {
          k: lang === 'vi' ? 'Nhận diện DOI giả mạo' : 'Ghost DOI Detection',
          v: lang === 'vi' ? 'Phân giải định danh HTTP/Handle + Đối chiếu chéo' : 'HTTP/Handle Resolution + Metadata Cross-Check',
        },
      ],
    },
    {
      badge:
        lang === 'vi'
          ? 'GIAI ĐOẠN 04 · NGỮ NGHĨA SENTENCE-BERT & DeBERTa-v3 NLI'
          : 'STAGE 04 · SENTENCE-BERT & DeBERTa-v3 NLI STANCE',
      title:
        lang === 'vi'
          ? 'Thẩm định sự tương thích ngữ nghĩa & Mức độ đồng thuận của bài gốc'
          : 'Contextual Claim-to-Abstract Semantic & Stance Verification',
      metrics: [
        {
          k: 'Bi-Encoder',
          v: lang === 'vi' ? 'Độ tương đồng Cosine sâu all-MiniLM-L6-v2' : 'all-MiniLM-L6-v2 Dense Cosine Similarity',
        },
        {
          k: 'Cross-Encoder',
          v: lang === 'vi' ? 'Bộ tái xếp hạng chuẩn xác ms-marco-MiniLM-L-6-v2' : 'ms-marco-MiniLM-L-6-v2 Precision Re-ranker',
        },
        {
          k: lang === 'vi' ? 'Phân tích ngữ cảnh NLI' : 'Stance Classifier',
          v: lang === 'vi' ? 'DeBERTa-v3 NLI (ĐỒNG THUẬN / BÁC BỎ / TRUNG LẬP)' : 'DeBERTa-v3 NLI (SUPPORTS / REFUTES / NEUTRAL)',
        },
      ],
    },
  ];

  const active = stages[tabIndex] || stages[0];
  const combinedSeed = replaySeed + tabIndex * 100;

  return (
    <div
      ref={containerRef}
      key={tabIndex}
      style={{
        backgroundColor: 'var(--solva-card-elevated)',
        ...getStaggerStyle(0),
      }}
      className="solva-glass-ring w-full rounded-[8px] p-5 sm:p-6 space-y-4 text-left border border-[#E7E3D9]/80 dark:border-[#332F26] animate-debugger-switch"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E7E3D9] dark:border-[#332F26]">
        <span
          style={{ color: 'var(--solva-muted)' }}
          className="font-mono text-[11px] font-semibold tracking-wider"
        >
          {active.badge}
        </span>
        <span className="px-2 py-0.5 rounded bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 font-mono text-[10px] font-semibold inline-flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          {lang === 'vi' ? 'TRỰC TIẾP' : 'LIVE PIPELINE'}
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
                ...getStaggerStyle(70 + idx * 60),
                backgroundColor: 'var(--solva-surface)',
                borderColor: isRowActive ? 'var(--solva-ink)' : 'transparent',
              }}
              className="px-3.5 py-2.5 rounded-[8px] border flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[12px] transition-all duration-300"
            >
              <span style={{ color: 'var(--solva-muted)' }} className="font-mono">
                {'label' in m && m.label ? m.label : m.k}
              </span>
              <span
                style={{ color: 'var(--solva-ink)' }}
                className="font-medium sm:text-right"
              >
                {m.k === 'Cache Hit Latency' ? (
                  <>
                    <SolvaLiveNumber
                      value={3.2}
                      decimals={1}
                      suffix=" ms"
                      replaySeed={combinedSeed}
                      durationMs={1250}
                    />{' '}
                    (BM25 + Trigram FTS5)
                  </>
                ) : m.k === 'Title Similarity' ? (
                  <>
                    Token Jaccard + Levenshtein + MiniLM (
                    <SolvaLiveNumber
                      value={0.98}
                      decimals={2}
                      replaySeed={combinedSeed}
                      durationMs={1350}
                    />
                    )
                  </>
                ) : (
                  m.v
                )}
              </span>
            </div>
          );
        })}
      </div>

      <div
        style={{
          ...getStaggerStyle(240),
          backgroundColor: 'var(--solva-bg)',
          borderColor: 'var(--solva-border)',
        }}
        className="p-3 rounded-[8px] border font-mono text-[11px] flex items-center gap-2"
      >
        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
        <span style={{ color: 'var(--solva-ink)' }}>
          {tabIndex === 0 && (
            <>
              {lang === 'vi' ? 'Đã nhận diện ' : 'Extracted '}
              <SolvaLiveNumber value={28} replaySeed={combinedSeed} durationMs={1200} />
              {lang === 'vi' ? ' trích dẫn trong bài ([1]–[' : ' in-text markers ([1]–['}
              <SolvaLiveNumber value={28} replaySeed={combinedSeed} durationMs={1200} />
              {lang === 'vi' ? ']) và liên kết chuẩn xác ' : ']) and mapped '}
              <SolvaLiveNumber value={27} replaySeed={combinedSeed} durationMs={1300} />
              {lang === 'vi' ? ' mục tài liệu tham khảo chỉ trong ' : ' canonical bibliography entries in '}
              <SolvaLiveNumber
                value={340}
                suffix="ms."
                replaySeed={combinedSeed}
                durationMs={1450}
              />
            </>
          )}
          {tabIndex === 1 && (
            <>
              {lang === 'vi' ? 'Truy vấn đồng thời ' : 'Queried '}
              <SolvaLiveNumber value={15} replaySeed={combinedSeed} durationMs={1150} />
              {lang === 'vi' ? ' cổng API · Khử trùng lặp ' : ' APIs concurrently · Deduplicated '}
              <SolvaLiveNumber value={64} replaySeed={combinedSeed} durationMs={1350} />
              {lang === 'vi'
                ? ' bản ghi ứng viên · Xác lập hồ sơ học thuật chuẩn nhất.'
                : ' candidate records · Ranked top canonical work.'}
            </>
          )}
          {tabIndex === 2 && (
            <>
              {lang === 'vi'
                ? 'Kích hoạt quy tắc R01_EXACT_DOI & R04_AUTHOR_OVERLAP → Phán quyết: VERIFIED (Độ tin cậy: '
                : 'Triggered R01_EXACT_DOI & R04_AUTHOR_OVERLAP → Verdict: VERIFIED (Confidence: '}
              <SolvaLiveNumber
                value={98.4}
                decimals={1}
                suffix="%)."
                replaySeed={combinedSeed}
                durationMs={1450}
              />
            </>
          )}
          {tabIndex === 3 && (
            <>
              {lang === 'vi'
                ? 'Luận điểm trích dẫn tương thích chặt chẽ với tóm tắt bài gốc (ĐỒNG THUẬN: '
                : 'In-text claim entails retrieved abstract (SUPPORTS: '}
              <SolvaLiveNumber
                value={0.94}
                decimals={2}
                replaySeed={combinedSeed}
                durationMs={1350}
              />{' '}
              · {lang === 'vi' ? 'BÁC BỎ: ' : 'REFUTES: '}
              <SolvaLiveNumber
                value={0.01}
                decimals={2}
                replaySeed={combinedSeed}
                durationMs={1150}
              />{' '}
              · {lang === 'vi' ? 'TRUNG LẬP: ' : 'NEUTRAL: '}
              <SolvaLiveNumber
                value={0.05}
                decimals={2}
                replaySeed={combinedSeed}
                durationMs={1200}
              />
              ).
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
  const { containerRef, isVisible, replaySeed, getStaggerStyle } = useFloralCardAnimation(5200);
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
      label: lang === 'vi' ? 'ĐÃ XÁC THỰC' : 'VERIFIED',
      val: 34,
      startVal: 0,
      color: 'text-emerald-700 dark:text-emerald-300',
    },
    {
      label: lang === 'vi' ? 'LỆCH THÔNG TIN' : 'METADATA DRIFT',
      val: 2,
      startVal: 0,
      color: 'text-amber-700 dark:text-amber-300',
    },
    {
      label: lang === 'vi' ? 'TRÍCH DẪN ẢO' : 'HALLUCINATED',
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
        className="flex items-center justify-between gap-3 border-b border-[#E7E3D9] dark:border-[#332F26] pb-3"
      >
        <div className="min-w-0">
          <div
            style={{ color: 'var(--solva-muted)' }}
            className="text-[10px] font-mono uppercase truncate"
          >
            {lang === 'vi'
              ? 'BÁO CÁO KIỂM CHỨNG TOÀN DIỆN'
              : 'CITATION INTEGRITY AUDIT REPORT'}
          </div>
          <div
            style={{ color: 'var(--solva-ink)' }}
            className="text-[13px] sm:text-[15px] font-medium mt-0.5 truncate"
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
          CIS{' '}
          <SolvaLiveNumber
            value={96.2}
            decimals={1}
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
              className="p-2.5 rounded-[8px] border transition-all duration-300"
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
            ? 'Sẵn sàng xuất báo cáo PDF / JSON & lưu vết kiểm toán'
            : 'Ready for PDF / JSON export & instructor sign-off'}
        </span>
        <span className="font-mono text-emerald-700 dark:text-emerald-300 font-semibold shrink-0 ml-2">
          <SolvaLiveNumber
            value={100}
            suffix={lang === 'vi' ? '% Truy vết rõ' : '% Traceable'}
            replaySeed={replaySeed}
            durationMs={1450}
          />
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
  const { containerRef, isVisible, replaySeed, getStaggerStyle } = useFloralCardAnimation(5200);
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
      idNum: 18,
      file: 'Thesis_018_Neural_RAG.pdf',
      verdict: lang === 'vi' ? 'DOI NGỤY TẠO' : 'GHOST DOI',
      tone: 'red' as const,
      rule: 'R12_GHOST_DOI · HTTP 404',
      detail:
        lang === 'vi'
          ? 'Phát hiện mã DOI hư cấu 10.1038/s42256-024-99812-x (Mục [14])'
          : 'Caught fabricated DOI 10.1038/s42256-024-99812-x (Ref [14])',
      cisNum: 74.2,
    },
    {
      id: '#047',
      idNum: 47,
      file: 'Thesis_047_Legal_NLP.pdf',
      verdict: lang === 'vi' ? 'LỆCH NĂM XB' : 'YEAR DRIFT',
      tone: 'amber' as const,
      rule: 'R05_YEAR_DRIFT · Δ=1yr',
      detail:
        lang === 'vi'
          ? 'Ghi nhầm năm bản nháp arXiv (2018) thay vì kỷ yếu NAACL (2019)'
          : 'arXiv preprint year (2018) vs. canonical NAACL (2019)',
      cisNum: 88.5,
    },
    {
      id: '#104',
      idNum: 104,
      file: 'Thesis_104_BioMed_VLM.pdf',
      verdict: lang === 'vi' ? 'ĐÃ XÁC THỰC' : 'VERIFIED',
      tone: 'emerald' as const,
      rule: 'R01_EXACT_DOI ∧ R09_NLI',
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
        className="flex items-center justify-between gap-2 pb-3 border-b"
      >
        <div className="min-w-0">
          <div
            style={{ color: 'var(--solva-muted)' }}
            className="text-[10px] font-mono uppercase tracking-wider flex items-center gap-1.5"
          >
            <GraduationCap className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">
              {lang === 'vi'
                ? 'HỘI ĐỒNG KHOA KHMT · ĐỢT 1'
                : 'THESIS COMMITTEE · COHORT RUN'}
            </span>
          </div>
          <div
            style={{ color: 'var(--solva-ink)' }}
            className="text-[14px] sm:text-[15px] font-medium truncate mt-0.5"
          >
            <SolvaLiveNumber value={120} replaySeed={replaySeed} durationMs={1300} />{' '}
            {lang === 'vi' ? 'Khóa luận Tốt nghiệp (' : 'Graduation Theses ('}
            <SolvaLiveNumber
              value={4380}
              formatThousands
              thousandSeparator={sep}
              replaySeed={replaySeed}
              durationMs={1500}
            />{' '}
            {lang === 'vi' ? 'trích dẫn)' : 'refs)'}
          </div>
        </div>
        <span className="px-2 py-0.5 rounded-[6px] bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 font-mono text-[10px] font-semibold shrink-0">
          <SolvaLiveNumber value={48} replaySeed={replaySeed} durationMs={1200} />m{' '}
          <SolvaLiveNumber value={12} replaySeed={replaySeed} durationMs={1350} />s
        </span>
      </div>

      {/* Cohort Breakdown Mini-Metrics */}
      <div style={getStaggerStyle(110)} className="grid grid-cols-3 gap-2 text-center">
        {[
          {
            label: lang === 'vi' ? 'CHUẨN XÁC' : 'VERIFIED',
            val: 4192,
            format: true,
            color: 'text-emerald-700 dark:text-emerald-300',
          },
          {
            label: lang === 'vi' ? 'LỆCH NĂM' : 'YEAR DRIFT',
            val: 146,
            format: false,
            color: 'text-amber-700 dark:text-amber-300',
          },
          {
            label: lang === 'vi' ? 'DOI NGỤY TẠO' : 'GHOST DOIs',
            val: 42,
            format: false,
            color: 'text-red-600 dark:text-red-400',
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
              className="text-[9px] font-mono mt-1 truncate"
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
              className="w-full text-left px-3 py-2 rounded-[8px] border transition-all duration-200 cursor-pointer flex items-center justify-between gap-2"
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
                  #<SolvaLiveNumber
                    value={item.idNum}
                    padDigits={3}
                    replaySeed={replaySeed}
                    durationMs={1150 + idx * 120}
                  />
                </span>
                <span
                  style={{ color: 'var(--solva-ink)' }}
                  className="text-[12px] font-medium truncate"
                >
                  {item.file}
                </span>
              </div>
              <span
                className={`text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded shrink-0 ${
                  item.tone === 'emerald'
                    ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                    : item.tone === 'amber'
                      ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
                      : 'bg-red-500/12 text-red-700 dark:text-red-300'
                }`}
              >
                {item.verdict}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active Thesis Rule Trace Footer */}
      <div
        key={activeThesis.id}
        style={{
          backgroundColor: 'var(--solva-surface)',
          borderColor: 'var(--solva-border)',
        }}
        className="p-2.5 rounded-[8px] border space-y-1 animate-debugger-switch"
      >
        <div className="flex items-center justify-between text-[10px] font-mono">
          <span style={{ color: 'var(--solva-ink)' }} className="font-semibold">
            {activeThesis.rule}
          </span>
          <span style={{ color: 'var(--solva-muted)' }}>
            CIS:{' '}
            <strong style={{ color: 'var(--solva-ink)' }}>
              <SolvaLiveNumber
                value={activeThesis.cisNum}
                decimals={1}
                replaySeed={replaySeed}
                durationMs={1150}
              />
            </strong>
          </span>
        </div>
        <p
          style={{ color: 'var(--solva-muted)' }}
          className="text-[11px] leading-snug truncate"
        >
          {activeThesis.detail}
        </p>
      </div>

      {/* Bottom Action Link to Live Debugger */}
      <div style={getStaggerStyle(250)} className="pt-0.5 flex items-center justify-between text-[11px]">
        <span style={{ color: 'var(--solva-muted)' }} className="font-mono text-[10px]">
          <SolvaLiveNumber value={15} suffix="+ APIs" replaySeed={replaySeed} durationMs={1200} />{' '}
          · GROBID TEI
        </span>
        <a
          href="#interactive-demo"
          style={{ color: 'var(--solva-ink)' }}
          className="inline-flex items-center gap-1 font-medium hover:underline"
        >
          <span>
            {lang === 'vi' ? 'Soi chiếu trực tiếp' : 'Inspect live trace'}
          </span>
          <ArrowRight className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
}
