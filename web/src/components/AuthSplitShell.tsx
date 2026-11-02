import { useState, useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ThemeToggle } from '@/contexts/ThemeContext';
import {
  LOCAL_PAPERS_LABEL,
  SCHOLARLY_APIS_LABEL,
  SYMBOLIC_RULES_RANGE,
} from '@/lib/productFacts';
import { SolvaLiveNumber } from '@/components/landing/SolvaMockupWidgets';
import { ScholarlySourceLogo } from '@/components/landing/ScholarlySourceLogos';
import {
  Shield,
  Quote,
  Database,
  GitBranch,
  ArrowLeft,
  Globe,
  Check,
  Circle,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from 'lucide-react';

export function SourceLogicBrandMark({ size = 28 }: { size?: number }) {
  return (
    <img
      src="/citra-logo.png"
      alt="CITRA Logo"
      width={size}
      height={size}
      className="object-contain select-none dark:brightness-150 dark:drop-shadow-[0_0_2px_rgba(255,255,255,0.45)]"
    />
  );
}

interface AuthSplitShellProps {
  children: ReactNode;
  maxWidthClass?: string;
}

interface LiveTraceSample {
  id: string;
  marker: string;
  citation: string;
  title: string;
  venue: string;
  doi: string;
  ruleCode: string;
  ruleSummaryEn: string;
  ruleSummaryVi: string;
  condition: string;
  l1Status: string;
  verdict: 'VERIFIED' | 'METADATA_ERROR' | 'SUSPECTED_HALLUCINATION';
  verdictLabel: string;
  confidence: number;
  cisScore: number;
  nliLabel: string;
  tone: 'emerald' | 'amber' | 'red';
  sources: Array<{ name: string; ms: number; match: string }>;
}

const LIVE_TRACE_SAMPLES: LiveTraceSample[] = [
  {
    id: 'trace-1',
    marker: '[1]',
    citation: 'Vaswani et al. (2017)',
    title: 'Attention Is All You Need',
    venue: 'Advances in Neural Information Processing Systems (NeurIPS)',
    doi: '10.48550/arXiv.1706.03762',
    ruleCode: 'R01_DOI_MATCH',
    ruleSummaryEn: 'Canonical DOI & Cross-Index Consensus',
    ruleSummaryVi: 'Đồng thuận định danh DOI & 4 CSDL quốc tế',
    condition: 'cited.doi == canonical.doi ∧ title_sim >= 0.99',
    l1Status: 'MATCHED',
    verdict: 'VERIFIED',
    verdictLabel: 'VERIFIED',
    confidence: 99,
    cisScore: 94.8,
    nliLabel: 'SUPPORTS (0.96)',
    tone: 'emerald',
    sources: [
      { name: 'Crossref', ms: 38, match: '100%' },
      { name: 'OpenAlex', ms: 52, match: '100%' },
      { name: 'Semantic Scholar', ms: 61, match: '99%' },
    ],
  },
  {
    id: 'trace-2',
    marker: '[4]',
    citation: 'Nguyen & Tran (2021)',
    title: 'BERT: Pre-training of Deep Bidirectional Transformers',
    venue: 'Proceedings of NAACL-HLT (Cited as EMNLP)',
    doi: '10.18653/v1/N19-1423',
    ruleCode: 'R05_YEAR_DRIFT',
    ruleSummaryEn: 'Preprint-to-Proceedings Year & Venue Drift',
    ruleSummaryVi: 'Sai lệch năm tiền ấn phẩm & hội nghị công bố',
    condition: '|cited.year - canonical.year| == 1 ∧ venue_drift',
    l1Status: 'MATCHED',
    verdict: 'METADATA_ERROR',
    verdictLabel: 'YEAR_MISMATCH',
    confidence: 84,
    cisScore: 88.5,
    nliLabel: 'SUPPORTS (0.93)',
    tone: 'amber',
    sources: [
      { name: 'Crossref', ms: 44, match: '94%' },
      { name: 'DBLP', ms: 49, match: '92%' },
      { name: 'OpenAlex', ms: 58, match: '94%' },
    ],
  },
  {
    id: 'trace-3',
    marker: '[7]',
    citation: 'Robertson & Walker (2024)',
    title: 'Zero-Shot Quantum Hyper-Graphs in Citation Verification',
    venue: 'Nature Machine Intelligence (Unresolved Volume)',
    doi: '10.1038/s42256-024-99812-x',
    ruleCode: 'R12_GHOST_DOI',
    ruleSummaryEn: 'Non-Existent DOI Handle across 15+ Registries',
    ruleSummaryVi: 'Mã định danh DOI ảo không tồn tại trên hệ thống',
    condition: 'doi_ra_status == NOT_EXIST ∧ max_title_sim < 0.18',
    l1Status: 'MATCHED',
    verdict: 'SUSPECTED_HALLUCINATION',
    verdictLabel: 'HALLUCINATED',
    confidence: 11,
    cisScore: 84.5,
    nliLabel: 'UNVERIFIED (0.00)',
    tone: 'red',
    sources: [
      { name: 'Crossref', ms: 51, match: '404' },
      { name: 'OpenAlex', ms: 63, match: '0%' },
      { name: 'PubMed NCBI', ms: 55, match: '0%' },
    ],
  },
];

const TICKER_SOURCES = [
  'Crossref',
  'OpenAlex',
  'Semantic Scholar',
  'PubMed NCBI',
  'arXiv',
  'Europe PMC',
  'DBLP',
  'DOAJ',
  'DataCite',
  'ORCID',
  'GROBID TEI',
];

export function AuthSplitShell({
  children,
  maxWidthClass = 'max-w-[448px]',
}: AuthSplitShellProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';

  const [activeTraceIdx, setActiveTraceIdx] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [replaySeed, setReplaySeed] = useState(1);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (isPaused) return;
    const timer = window.setInterval(() => {
      setActiveTraceIdx((prev) => (prev + 1) % LIVE_TRACE_SAMPLES.length);
      setReplaySeed((prev) => prev + 1);
    }, 3800);
    return () => window.clearInterval(timer);
  }, [isPaused]);

  const toggleLanguage = () => {
    const next = lang === 'en' ? 'vi' : 'en';
    void i18n.changeLanguage(next);
  };

  const activeTrace = LIVE_TRACE_SAMPLES[activeTraceIdx];

  const features = [
    {
      icon: Quote,
      title: t('auth.featureExtraction'),
      desc: t('auth.featureExtractionDesc'),
      tag: 'GROBID TEI · L1',
      accentClass:
        'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
    },
    {
      icon: Database,
      title: t('auth.featureRetrieval'),
      desc: t('auth.featureRetrievalDesc'),
      tag: `${LOCAL_PAPERS_LABEL} ACL · ${SCHOLARLY_APIS_LABEL} APIs`,
      accentClass:
        'bg-[#1C1A15]/8 text-[#1C1A15] dark:bg-[#FBFAF6]/10 dark:text-[#FBFAF6] border-[#1C1A15]/15 dark:border-[#FBFAF6]/20',
    },
    {
      icon: GitBranch,
      title: t('auth.featureVerification'),
      desc: t('auth.featureVerificationDesc'),
      tag: `Rules ${SYMBOLIC_RULES_RANGE} · CIS`,
      accentClass:
        'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',
    },
  ];

  const primaryHeroWords = t('auth.heroTitle1').trim().split(/\s+/);
  const secondaryHeroWords = t('auth.heroTitle2').trim().split(/\s+/);

  return (
    <div className="solva-editorial-root min-h-screen flex flex-col lg:flex-row selection:bg-[#1C1A15]/15 selection:text-[#1C1A15] dark:selection:bg-[#FBFAF6]/20 dark:selection:text-[#FBFAF6]">
      {/* ============================================================
          Left Panel — Solva Editorial & Painterly Live Debugger Showcase
          (Contains ZERO <button> elements so #password toggle is first SVG button in DOM)
          ============================================================ */}
      <div
        style={{
          backgroundColor: 'var(--solva-surface)',
          borderColor: 'var(--solva-border)',
        }}
        className="hidden lg:flex lg:w-[53%] xl:w-[55%] relative overflow-hidden border-r flex-col justify-between p-8 xl:p-12"
      >
        {/* Ambient Solva Editorial Texture, Dot Matrix & Floral Watermark */}
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute inset-0 opacity-45 dark:opacity-15"
            style={{
              backgroundImage:
                'radial-gradient(rgb(140 136 126 / 0.32) 1px, transparent 1px)',
              backgroundSize: '24px 24px',
            }}
          />
          <div className="solva-noise-overlay" aria-hidden="true" />
          <img
            src="/solva/pricing-floral.webp"
            alt=""
            aria-hidden="true"
            loading="eager"
            decoding="async"
            className="absolute right-0 bottom-0 w-[380px] h-[340px] object-cover opacity-35 dark:opacity-20 solva-pricing-floral-mask select-none"
          />
          <div className="absolute -top-28 -left-28 w-[520px] h-[380px] bg-gradient-to-br from-emerald-500/10 via-amber-500/5 to-transparent blur-3xl rounded-full" />
        </div>

        {/* Top Header: Official CITRA Brand Identity + 120K Empirical Badge */}
        <div className="relative z-10 flex items-center justify-between gap-4">
          <Link
            to="/"
            className="group inline-flex items-center gap-[9px] rounded-[8px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1C1A15] dark:focus-visible:ring-[#FBFAF6]"
          >
            <span className="w-[30px] h-[30px] rounded-[8px] bg-white dark:bg-[#1E1C17] border border-[#E7E3D9] dark:border-[#332F26] shadow-2xs flex items-center justify-center p-1 shrink-0 transition-transform duration-200 group-hover:scale-105">
              <SourceLogicBrandMark size={19} />
            </span>
            <span className="font-solva-sans text-[21px] font-medium tracking-[-0.02em] leading-none text-[#1C1A15] dark:text-[#FBFAF6]">
              CITRA
            </span>
            <span
              style={{
                backgroundColor: 'var(--solva-bg)',
                borderColor: 'var(--solva-border)',
                color: 'var(--solva-muted)',
              }}
              className="ml-1 px-2 py-0.5 rounded-[5px] border font-mono text-[10px] font-medium"
            >
              SourceLogic v2.3
            </span>
          </Link>

          <div
            style={{
              backgroundColor: 'var(--solva-bg)',
              borderColor: 'var(--solva-border)',
            }}
            className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border shadow-2xs"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span
              style={{ color: 'var(--solva-ink)' }}
              className="font-mono text-[10px] font-semibold tracking-wider uppercase"
            >
              {lang === 'vi'
                ? '120K THỰC NGHIỆM · 98,6% CHÍNH XÁC'
                : '120K BENCHMARK · 98.6% ACC'}
            </span>
          </div>
        </div>

        {/* Center Content: Two-Tone Editorial Heading + Painterly Live Debugger + 3 Pillars */}
        <div className="relative z-10 my-auto py-5 space-y-5 max-w-[600px] mx-auto w-full">
          {/* Eyebrow + Staggered Sentient Light Serif Heading */}
          <div className="space-y-2.5">
            <div className="inline-flex items-center gap-[7px] pl-[2px] font-solva-sans">
              <span
                className="w-[10px] h-[5px] rounded-[50px] shrink-0"
                style={{ backgroundColor: 'var(--solva-muted)' }}
              />
              <span
                style={{ color: 'var(--solva-muted)' }}
                className="text-[13px] font-mono uppercase tracking-wider font-medium"
              >
                {lang === 'vi'
                  ? 'Kiến trúc Thẩm định Trích dẫn Học thuật 2 Tầng'
                  : 'Two-Layer Neuro-Symbolic Citation Verification'}
              </span>
            </div>

            <h2 className="font-solva-serif font-light text-[32px] xl:text-[40px] leading-[1.06] tracking-[-0.05em]">
              <span className="block" style={{ color: 'var(--solva-ink)' }}>
                {primaryHeroWords.map((word, idx) => (
                  <span
                    key={`p-${idx}`}
                    className="inline-block mr-[0.26em]"
                    style={{
                      opacity: mounted ? 1 : 0.001,
                      transform: mounted
                        ? 'translate3d(0, 0, 0)'
                        : 'translate3d(0, 22px, 0)',
                      filter: mounted ? 'none' : 'blur(4px)',
                      transition:
                        'opacity 620ms cubic-bezier(0.22, 1, 0.36, 1), transform 620ms cubic-bezier(0.22, 1, 0.36, 1), filter 620ms cubic-bezier(0.22, 1, 0.36, 1)',
                      transitionDelay: `${40 + idx * 45}ms`,
                    }}
                  >
                    {word}
                  </span>
                ))}
              </span>
              <span className="block" style={{ color: 'var(--solva-muted)' }}>
                {secondaryHeroWords.map((word, idx) => (
                  <span
                    key={`s-${idx}`}
                    className="inline-block mr-[0.26em]"
                    style={{
                      opacity: mounted ? 1 : 0.001,
                      transform: mounted
                        ? 'translate3d(0, 0, 0)'
                        : 'translate3d(0, 22px, 0)',
                      filter: mounted ? 'none' : 'blur(4px)',
                      transition:
                        'opacity 620ms cubic-bezier(0.22, 1, 0.36, 1), transform 620ms cubic-bezier(0.22, 1, 0.36, 1), filter 620ms cubic-bezier(0.22, 1, 0.36, 1)',
                      transitionDelay: `${40 + (primaryHeroWords.length + idx) * 45}ms`,
                    }}
                  >
                    {word}
                  </span>
                ))}
              </span>
            </h2>

            <p
              style={{ color: 'var(--solva-muted)' }}
              className="font-solva-sans text-[14px] xl:text-[15px] leading-[1.55] max-w-[540px]"
            >
              {t('auth.heroDesc')}
            </p>
          </div>

          {/* Solva Painterly Oil Frame + 8px Frosted Glass Ring Live Debugger Card */}
          <div
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => setIsPaused(false)}
            className="relative rounded-[16px] overflow-hidden p-3.5 xl:p-4 border border-[#E7E3D9] dark:border-[#332F26] shadow-md"
          >
            {/* Impressionist Oil Painting Backdrop + 5% Film Grain */}
            <img
              src="/solva/hero-bg.webp"
              alt="CITRA verification canvas backdrop"
              loading="eager"
              decoding="async"
              className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none scale-105 transition-transform duration-700"
            />
            <div className="solva-noise-overlay" aria-hidden="true" />

            {/* Floating 8px Frosted Glass Ring Debugger Window */}
            <div
              style={{
                backgroundColor: 'var(--solva-card-elevated)',
                borderColor: 'var(--solva-border)',
              }}
              className="relative z-10 solva-glass-ring rounded-[11px] border overflow-hidden select-none"
            >
              {/* macOS Window Chrome + symbolic_verifier.py Title */}
              <div
                style={{
                  backgroundColor: 'var(--solva-bg)',
                  borderColor: 'var(--solva-border)',
                }}
                className="px-3.5 py-2.5 border-b flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#FF5F56] border border-[#E0443E]/60" />
                    <span className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E] border border-[#DEA123]/60" />
                    <span className="w-2.5 h-2.5 rounded-full bg-[#27C93F] border border-[#1AAB29]/60" />
                  </div>
                  <span
                    style={{ color: 'var(--solva-ink)' }}
                    className="font-mono text-[11px] font-medium truncate ml-1"
                  >
                    symbolic_verifier.py · Trace Preview
                  </span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[5px] bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 font-mono text-[10px] font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span>LIVE</span>
                  </span>
                  <span
                    style={{
                      backgroundColor: 'var(--solva-surface)',
                      color: 'var(--solva-ink)',
                      borderColor: 'var(--solva-border)',
                    }}
                    className="px-2 py-0.5 rounded-[5px] border font-mono text-[10px] font-semibold"
                  >
                    CIS:{' '}
                    <SolvaLiveNumber
                      value={activeTrace.cisScore}
                      decimals={1}
                      replaySeed={replaySeed}
                      durationMs={950}
                    />{' '}
                    / 100
                  </span>
                </div>
              </div>

              {/* Interactive Citation Selector Strip (Uses <div role="tab"> so no <button> is added) */}
              <div
                role="tablist"
                aria-label="Live citation verification samples"
                style={{
                  backgroundColor: 'var(--solva-surface)',
                  borderColor: 'var(--solva-border)',
                }}
                className="grid grid-cols-3 gap-1.5 p-2 border-b"
              >
                {LIVE_TRACE_SAMPLES.map((sample, idx) => {
                  const isSelected = idx === activeTraceIdx;
                  return (
                    <div
                      key={sample.id}
                      role="tab"
                      tabIndex={0}
                      aria-selected={isSelected}
                      onClick={() => {
                        setActiveTraceIdx(idx);
                        setReplaySeed((prev) => prev + 1);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setActiveTraceIdx(idx);
                          setReplaySeed((prev) => prev + 1);
                        }
                      }}
                      style={{
                        backgroundColor: isSelected
                          ? 'var(--solva-card-elevated)'
                          : 'transparent',
                        borderColor: isSelected
                          ? 'var(--solva-ink)'
                          : 'var(--solva-border)',
                      }}
                      className="px-2.5 py-1.5 rounded-[7px] border cursor-pointer transition-all duration-200 flex items-center justify-between gap-1.5"
                    >
                      <span
                        style={{ color: 'var(--solva-ink)' }}
                        className="font-mono text-[10px] font-semibold truncate"
                      >
                        {sample.marker} {sample.citation.split(' ')[0]}
                      </span>
                      <span
                        className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0 ${
                          sample.tone === 'emerald'
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                            : sample.tone === 'amber'
                              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                              : 'bg-red-500/15 text-red-700 dark:text-red-300'
                        }`}
                      >
                        {sample.confidence}%
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Active Citation Reasoning & Rule Trace Body */}
              <div
                key={activeTrace.id}
                className="p-3.5 space-y-2.5 animate-debugger-switch"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        style={{ color: 'var(--solva-ink)' }}
                        className="font-mono text-[11px] font-bold"
                      >
                        {activeTrace.marker} {activeTrace.citation}
                      </span>
                      <span
                        style={{ color: 'var(--solva-muted)' }}
                        className="font-mono text-[10px]"
                      >
                        · {activeTrace.ruleCode}
                      </span>
                    </div>
                    <p
                      style={{ color: 'var(--solva-ink)' }}
                      className="text-[12px] font-medium truncate mt-0.5"
                    >
                      {activeTrace.title}
                    </p>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] font-mono text-[10px] font-semibold shrink-0 border ${
                      activeTrace.tone === 'emerald'
                        ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/25'
                        : activeTrace.tone === 'amber'
                          ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/25'
                          : 'bg-red-500/12 text-red-700 dark:text-red-300 border-red-500/25'
                    }`}
                  >
                    {activeTrace.tone === 'emerald' ? (
                      <CheckCircle2 className="w-3 h-3" />
                    ) : activeTrace.tone === 'amber' ? (
                      <AlertTriangle className="w-3 h-3" />
                    ) : (
                      <XCircle className="w-3 h-3" />
                    )}
                    {activeTrace.verdictLabel}
                  </span>
                </div>

                {/* Symbolic Rule Condition Box */}
                <div
                  style={{
                    backgroundColor: 'var(--solva-surface)',
                    borderColor: 'var(--solva-border)',
                  }}
                  className="rounded-[8px] px-3 py-2 border font-mono text-[10px] space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span style={{ color: 'var(--solva-muted)' }}>
                      {lang === 'vi'
                        ? activeTrace.ruleSummaryVi
                        : activeTrace.ruleSummaryEn}
                    </span>
                    <span
                      style={{ color: 'var(--solva-ink)' }}
                      className="font-semibold"
                    >
                      NLI: {activeTrace.nliLabel}
                    </span>
                  </div>
                  <div
                    style={{ color: 'var(--solva-ink)' }}
                    className="truncate opacity-85"
                  >
                    expr: {activeTrace.condition}
                  </div>
                </div>

                {/* Live API Sources Latency Strip */}
                <div className="grid grid-cols-3 gap-1.5">
                  {activeTrace.sources.map((src) => (
                    <div
                      key={src.name}
                      style={{
                        backgroundColor: 'var(--solva-bg)',
                        borderColor: 'var(--solva-border)',
                      }}
                      className="px-2.5 py-1.5 rounded-[7px] border flex items-center justify-between gap-1.5 font-mono text-[10px]"
                    >
                      <span
                        style={{ color: 'var(--solva-ink)' }}
                        className="inline-flex items-center gap-1.5 truncate font-medium"
                      >
                        <ScholarlySourceLogo name={src.name} size={12} />
                        <span className="truncate">{src.name}</span>
                      </span>
                      <span
                        style={{ color: 'var(--solva-muted)' }}
                        className="shrink-0"
                      >
                        {src.ms}ms
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 3 Compact Feature Cards */}
          <div className="grid grid-cols-3 gap-2.5">
            {features.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  style={{
                    backgroundColor: 'var(--solva-bg)',
                    borderColor: 'var(--solva-border)',
                  }}
                  className="group p-3 rounded-[12px] border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm flex flex-col justify-between gap-2"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <div
                      className={`p-1.5 rounded-[8px] border shrink-0 ${item.accentClass}`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <span
                      style={{
                        backgroundColor: 'var(--solva-surface)',
                        color: 'var(--solva-muted)',
                        borderColor: 'var(--solva-border)',
                      }}
                      className="px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold border truncate"
                    >
                      {item.tag}
                    </span>
                  </div>
                  <div>
                    <h3
                      style={{ color: 'var(--solva-ink)' }}
                      className="font-solva-sans font-semibold text-[12px] xl:text-[13px] leading-snug"
                    >
                      {item.title}
                    </h3>
                    <p
                      style={{ color: 'var(--solva-muted)' }}
                      className="text-[11px] mt-0.5 line-clamp-2 leading-relaxed"
                    >
                      {item.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom Marquee Ticker + Decision Support Footer */}
        <div className="relative z-10 space-y-3">
          {/* Edge-Masked Infinite Scholarly Source Marquee */}
          <div className="w-full py-1.5 overflow-hidden solva-ticker-mask">
            <div className="animate-solva-marquee flex items-center gap-7">
              {[...TICKER_SOURCES, ...TICKER_SOURCES].map((sourceName, idx) => (
                <div
                  key={`${sourceName}-${idx}`}
                  style={{ color: 'var(--solva-muted)' }}
                  className="inline-flex items-center gap-1.5 shrink-0 select-none opacity-80"
                >
                  <ScholarlySourceLogo name={sourceName} size={14} />
                  <span className="font-solva-sans text-[12px] font-medium tracking-[-0.02em] whitespace-nowrap">
                    {sourceName}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              borderColor: 'var(--solva-border)',
              color: 'var(--solva-muted)',
            }}
            className="pt-3 border-t flex items-center justify-between gap-4 text-[11px]"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Shield className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{t('auth.footerNote')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ============================================================
          Right Panel — Solva Warm Editorial Authentication Portal
          ============================================================ */}
      <div
        style={{ backgroundColor: 'var(--solva-bg)' }}
        className="flex-1 flex flex-col justify-between p-4 sm:p-6 md:p-8 lg:p-10 xl:p-12 relative overflow-hidden"
      >
        {/* Subtle Editorial Ambient Lighting & Grain */}
        <div className="pointer-events-none absolute inset-0">
          <div className="solva-noise-overlay" aria-hidden="true" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] h-[520px] bg-gradient-to-tr from-[#E7E3D9]/45 via-emerald-500/5 to-transparent dark:from-[#29261F]/35 dark:via-emerald-500/5 blur-3xl rounded-full" />
        </div>

        {/* Main Centered Container (FIRST in DOM order so #password toggle is first SVG button) */}
        <div
          className={`relative z-10 order-2 my-auto w-full ${maxWidthClass} mx-auto py-3 sm:py-4 animate-hero-reveal`}
        >
          {children}
        </div>

        {/* Top Utility Navigation Bar (Visually at top via order-1, placed AFTER form in DOM) */}
        <div
          className={`relative z-10 order-1 w-full ${maxWidthClass} lg:max-w-none mx-auto flex items-center justify-between gap-2`}
        >
          {/* Mobile Brand / Desktop Back to Overview Link */}
          <div className="flex items-center gap-3 min-w-0">
            <Link
              to="/"
              className="lg:hidden inline-flex items-center gap-[8px] rounded-[6px] shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1C1A15] dark:focus-visible:ring-[#FBFAF6]"
            >
              <span className="w-[28px] h-[28px] rounded-[7px] bg-white dark:bg-[#1E1C17] border border-[#E7E3D9] dark:border-[#332F26] shadow-2xs flex items-center justify-center p-1 shrink-0">
                <SourceLogicBrandMark size={18} />
              </span>
              <span className="font-solva-sans text-[20px] font-medium tracking-[-0.02em] leading-none text-[#1C1A15] dark:text-[#FBFAF6]">
                CITRA
              </span>
            </Link>

            <Link
              to="/"
              style={{
                backgroundColor: 'var(--solva-surface)',
                borderColor: 'var(--solva-border)',
                color: 'var(--solva-ink)',
              }}
              className="hidden lg:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] border text-xs font-solva-sans font-medium hover:opacity-85 transition-all shadow-2xs"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>
                {lang === 'vi' ? 'Về trang giới thiệu' : 'Back to Overview'}
              </span>
            </Link>
          </div>

          {/* Right Utility Controls: Mobile Home Link + Language Switcher + ThemeToggle */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <Link
              to="/"
              style={{
                backgroundColor: 'var(--solva-surface)',
                borderColor: 'var(--solva-border)',
                color: 'var(--solva-ink)',
              }}
              className="lg:hidden inline-flex items-center gap-1 px-2.5 h-8 rounded-[8px] border text-xs font-solva-sans font-medium hover:opacity-85 transition-opacity whitespace-nowrap"
            >
              <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
              <span>{lang === 'vi' ? 'Trang chủ' : 'Home'}</span>
            </Link>

            <button
              type="button"
              onClick={toggleLanguage}
              style={{
                backgroundColor: 'var(--solva-surface)',
                borderColor: 'var(--solva-border)',
                color: 'var(--solva-ink)',
              }}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[8px] border text-xs font-mono font-semibold hover:opacity-85 transition-opacity cursor-pointer shadow-2xs"
              title={
                lang === 'vi' ? 'Switch to English' : 'Chuyển sang Tiếng Việt'
              }
            >
              <Globe className="h-3.5 w-3.5" />
              <span>{lang === 'vi' ? 'VI' : 'EN'}</span>
            </button>

            <ThemeToggle
              size="sm"
              className="h-8 w-8 rounded-[8px] bg-[#F4F2EC] dark:bg-[#1E1C17] border border-[#E7E3D9] dark:border-[#332F26] shadow-2xs"
            />
          </div>
        </div>

        {/* Bottom Subtle Workspace Security Note (order-3) */}
        <div
          style={{ color: 'var(--solva-muted)' }}
          className={`relative z-10 order-3 w-full ${maxWidthClass} mx-auto pt-2 flex items-center justify-between text-[11px] font-mono`}
        >
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
            <span>CITRA Editorial Workspace</span>
          </span>
          <span>TLS 1.3 · JWT RBAC</span>
        </div>
      </div>
    </div>
  );
}

export function PasswordStrengthIndicator({
  password,
  confirmPassword,
}: {
  password: string;
  confirmPassword: string;
}) {
  const { t } = useTranslation();

  const hasMinLen = password.length >= 6;
  const hasAlphaNum = /[a-zA-Z]/.test(password) && /\d/.test(password);
  const hasStrongLenOrSpecial =
    password.length >= 10 || /[^a-zA-Z0-9]/.test(password);
  const matches =
    password.length > 0 &&
    confirmPassword.length > 0 &&
    password === confirmPassword;

  let score = 0;
  if (hasMinLen) score += 1;
  if (hasAlphaNum) score += 1;
  if (hasStrongLenOrSpecial) score += 1;
  if (matches) score += 1;

  const strengthLabels = [
    t('auth.strengthWeak'),
    t('auth.strengthWeak'),
    t('auth.strengthFair'),
    t('auth.strengthGood'),
    t('auth.strengthStrong'),
  ];

  const barColors = [
    'bg-[#E7E3D9] dark:bg-[#332F26]',
    'bg-red-500',
    'bg-amber-500',
    'bg-emerald-500/80',
    'bg-emerald-600',
  ];

  const rules = [
    { label: t('auth.ruleMinLength'), met: hasMinLen },
    { label: t('auth.ruleUpperOrNum'), met: hasAlphaNum },
    { label: t('auth.ruleMatch'), met: matches },
  ];

  if (!password && !confirmPassword) {
    return null;
  }

  return (
    <div
      style={{
        backgroundColor: 'var(--solva-surface)',
        borderColor: 'var(--solva-border)',
      }}
      className="rounded-xl border p-3 space-y-2.5"
    >
      <div className="flex items-center justify-between text-[11px] font-medium">
        <span style={{ color: 'var(--solva-muted)' }}>
          {t('auth.passwordStrength')}
        </span>
        <span
          style={{ color: 'var(--solva-ink)' }}
          className="font-mono font-semibold"
        >
          {strengthLabels[score]}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {[1, 2, 3, 4].map((level) => (
          <div
            key={level}
            className={`h-1.5 rounded-full transition-colors ${
              score >= level
                ? barColors[score]
                : 'bg-[#E7E3D9] dark:bg-[#332F26]'
            }`}
          />
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 pt-0.5">
        {rules.map((r) => (
          <div
            key={r.label}
            className={`flex items-center gap-1.5 text-[11px] ${
              r.met
                ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                : 'text-[#8C887E] dark:text-[#7A756B]'
            }`}
          >
            {r.met ? (
              <Check className="h-3 w-3 shrink-0" />
            ) : (
              <Circle className="h-2.5 w-2.5 shrink-0" />
            )}
            <span className="truncate">{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
