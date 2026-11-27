import { Fragment, useState, useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ThemeToggle } from '@/contexts/ThemeContext';
import { APP_VERSION } from '@/version';
import {
  SCHOLARLY_APIS_LABEL,
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
  compactRightPanel?: boolean;
}

interface LiveTraceSample {
  id: string;
  marker: string;
  citation: string;
  title: string;
  venue: string;
  doi: string;
  ruleLabelEn: string;
  ruleLabelVi: string;
  ruleSummaryEn: string;
  ruleSummaryVi: string;
  checkSummaryEn: string;
  checkSummaryVi: string;
  l1Status: string;
  verdict: 'VERIFIED' | 'METADATA_ERROR' | 'SUSPECTED_HALLUCINATION';
  verdictLabelEn: string;
  verdictLabelVi: string;
  confidence: number;
  cisScore: number;
  matchBadgeEn: string;
  matchBadgeVi: string;
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
    ruleLabelEn: 'Exact DOI Match',
    ruleLabelVi: 'Khớp mã DOI gốc',
    ruleSummaryEn: 'Canonical DOI & Cross-Index Consensus',
    ruleSummaryVi: 'Đồng thuận mã DOI & 4 thư viện quốc tế',
    checkSummaryEn: 'Check: Exact match on canonical DOI and original paper title (2017).',
    checkSummaryVi: 'Đối chiếu: Khớp chính xác mã DOI và tiêu đề bài báo gốc (2017).',
    l1Status: 'MATCHED',
    verdict: 'VERIFIED',
    verdictLabelEn: 'Verified Source',
    verdictLabelVi: 'Nguồn trích dẫn hợp lệ',
    confidence: 99,
    cisScore: 94.8,
    matchBadgeEn: 'Content match: 96%',
    matchBadgeVi: 'Độ khớp nội dung: 96%',
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
    ruleLabelEn: 'Year & Venue Mismatch',
    ruleLabelVi: 'Lệch năm & hội nghị',
    ruleSummaryEn: 'Preprint-to-Proceedings Year & Venue Drift',
    ruleSummaryVi: 'Sai lệch năm bản nháp & hội nghị công bố',
    checkSummaryEn:
      'Check: Cited year (2021) and venue differ from the official NAACL-HLT (2019) record.',
    checkSummaryVi:
      'Đối chiếu: Năm trích dẫn (2021) và tên hội nghị lệch với bản ghi gốc NAACL-HLT (2019).',
    l1Status: 'MATCHED',
    verdict: 'METADATA_ERROR',
    verdictLabelEn: 'Citation Details Mismatch',
    verdictLabelVi: 'Sai lệch thông tin trích dẫn',
    confidence: 84,
    cisScore: 88.5,
    matchBadgeEn: 'Content match: 93%',
    matchBadgeVi: 'Độ khớp nội dung: 93%',
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
    ruleLabelEn: 'Unregistered DOI',
    ruleLabelVi: 'Không tìm thấy mã DOI',
    ruleSummaryEn: 'Non-Existent DOI Handle across 15+ Registries',
    ruleSummaryVi: 'Mã DOI không tồn tại trên 15+ thư viện',
    checkSummaryEn:
      'Check: DOI handle does not exist on Crossref and no matching title was found.',
    checkSummaryVi: 'Đối chiếu: Mã DOI không tồn tại trên Crossref và tiêu đề không khớp.',
    l1Status: 'MATCHED',
    verdict: 'SUSPECTED_HALLUCINATION',
    verdictLabelEn: 'Source Not Found',
    verdictLabelVi: 'Không tìm thấy nguồn gốc',
    confidence: 11,
    cisScore: 84.5,
    matchBadgeEn: 'Source match: 0%',
    matchBadgeVi: 'Độ khớp nguồn: 0%',
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
  'OpenAIRE',
];

export function AuthSplitShell({
  children,
  maxWidthClass = 'max-w-[448px]',
  compactRightPanel = false,
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
      tag: lang === 'vi' ? 'PDF · Word · BibTeX' : 'PDF · DOCX · BibTeX',
      accentClass:
        'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
    },
    {
      icon: Database,
      title: t('auth.featureRetrieval'),
      desc: t('auth.featureRetrievalDesc'),
      tag:
        lang === 'vi'
          ? `${SCHOLARLY_APIS_LABEL} thư viện quốc tế`
          : `${SCHOLARLY_APIS_LABEL} Academic Indexes`,
      accentClass:
        'bg-[#1C1A15]/[0.08] text-[#1C1A15] dark:bg-[#FBFAF6]/10 dark:text-[#FBFAF6] border-[#1C1A15]/15 dark:border-[#FBFAF6]/20',
    },
    {
      icon: GitBranch,
      title: t('auth.featureVerification'),
      desc: t('auth.featureVerificationDesc'),
      tag:
        lang === 'vi'
          ? 'Hơn 30 tiêu chí đối chiếu'
          : '30+ Verification Criteria',
      accentClass:
        'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',
    },
  ];

  const primaryHeroWords = t('auth.heroTitle1').trim().split(/\s+/);
  const secondaryHeroWords = t('auth.heroTitle2').trim().split(/\s+/);

  return (
    <div
      lang={lang}
      data-lang={lang}
      className="solva-editorial-root min-h-screen flex flex-col lg:flex-row selection:bg-[#1C1A15]/15 selection:text-[#1C1A15] dark:selection:bg-[#FBFAF6]/20 dark:selection:text-[#FBFAF6]"
    >
      {/* ============================================================
          Left Panel — Solva Editorial & Painterly Live Debugger Showcase
          (Contains ZERO <button> elements so #password toggle is first SVG button in DOM)
          ============================================================ */}
      <div
        style={{
          backgroundColor: 'var(--solva-surface)',
          borderColor: 'var(--solva-border)',
        }}
        className="hidden lg:flex lg:w-[53%] xl:w-[55%] relative overflow-hidden border-r flex-col justify-between p-6 xl:px-10 xl:py-7"
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
            className="absolute right-0 bottom-0 w-[360px] h-[320px] object-cover opacity-35 dark:opacity-20 solva-pricing-floral-mask select-none"
          />
          <div className="absolute -top-28 -left-28 w-[520px] h-[380px] bg-gradient-to-br from-emerald-500/10 via-amber-500/5 to-transparent blur-3xl rounded-full" />
        </div>

        {/* Top Header: Official CITRA Brand Identity + 120K Empirical Badge */}
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 xl:gap-4">
          <Link
            to="/"
            className="group inline-flex items-center gap-[9px] rounded-[8px] shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1C1A15] dark:focus-visible:ring-[#FBFAF6]"
          >
            <span className="w-[30px] h-[30px] rounded-[8px] bg-white dark:bg-[#1E1C17] border border-[#E7E3D9] dark:border-[#332F26] shadow-sm flex items-center justify-center p-1 shrink-0 transition-transform duration-200 group-hover:scale-105">
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
              title={
                lang === 'vi'
                  ? `CITRA phiên bản v${APP_VERSION}`
                  : `CITRA version v${APP_VERSION}`
              }
              className="ml-0.5 xl:ml-1 px-1.5 xl:px-2 py-0.5 rounded-[5px] border font-mono text-[9.5px] xl:text-[10px] font-medium whitespace-nowrap"
            >
              CITRA · v{APP_VERSION}
            </span>
          </Link>

          <div
            style={{
              backgroundColor: 'var(--solva-bg)',
              borderColor: 'var(--solva-border)',
            }}
            className="inline-flex items-center gap-1.5 xl:gap-2 px-2 xl:px-2.5 py-1 rounded-full border shadow-sm shrink-0 whitespace-nowrap"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <span
              style={{ color: 'var(--solva-ink)' }}
              className="font-mono text-[9.5px] xl:text-[10px] font-semibold tracking-wider uppercase whitespace-nowrap"
            >
              {lang === 'vi'
                ? '120.000 BÀI · 99,67% CHÍNH XÁC'
                : '120K BENCHMARK · 99.67% ACC'}
            </span>
          </div>
        </div>

        {/* Center Content: Two-Tone Editorial Heading + Painterly Live Debugger + 3 Pillars */}
        <div className="relative z-10 my-auto py-3 space-y-3.5 max-w-[600px] mx-auto w-full">
          {/* Eyebrow + Staggered Sentient Light Serif Heading */}
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-[7px] pl-[2px] font-solva-sans">
              <span
                className="w-[10px] h-[5px] rounded-[50px] shrink-0"
                style={{ backgroundColor: 'var(--solva-muted)' }}
              />
              <span
                style={{ color: 'var(--solva-muted)' }}
                className="text-[12px] font-mono uppercase tracking-wider font-medium"
              >
                {lang === 'vi'
                  ? 'Thẩm định Trích dẫn Học thuật 2 Lớp Minh bạch'
                  : 'Two-Layer Explainable Citation Verification'}
              </span>
            </div>

            <h2
              className={`font-solva-serif font-light text-[30px] xl:text-[36px] ${
                lang === 'vi'
                  ? 'leading-[1.15] tracking-[-0.03em]'
                  : 'leading-[1.06] tracking-[-0.05em]'
              }`}
            >
              <span className="block" style={{ color: 'var(--solva-ink)' }}>
                {primaryHeroWords.map((word, idx) => (
                  <Fragment key={`p-${idx}`}>
                    <span
                      className="inline-block"
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
                      {word.normalize('NFC')}
                    </span>
                    {idx < primaryHeroWords.length - 1 ? ' ' : ''}
                  </Fragment>
                ))}
              </span>{' '}
              <span className="block" style={{ color: 'var(--solva-muted)' }}>
                {secondaryHeroWords.map((word, idx) => (
                  <Fragment key={`s-${idx}`}>
                    <span
                      className="inline-block"
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
                      {word.normalize('NFC')}
                    </span>
                    {idx < secondaryHeroWords.length - 1 ? ' ' : ''}
                  </Fragment>
                ))}
              </span>
            </h2>

            <p
              style={{ color: 'var(--solva-muted)' }}
              className="font-solva-sans text-[13.5px] xl:text-[14.5px] leading-[1.5] max-w-[540px]"
            >
              {t('auth.heroDesc')}
            </p>
          </div>

          {/* Solva Painterly Oil Frame + 8px Frosted Glass Ring Live Debugger Card */}
          <div
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => setIsPaused(false)}
            className="relative rounded-[16px] overflow-hidden p-3 xl:p-3.5 border border-[#E7E3D9] dark:border-[#332F26] shadow-md"
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
              {/* macOS Window Chrome + Sample Verification Report Title */}
              <div
                style={{
                  backgroundColor: 'var(--solva-bg)',
                  borderColor: 'var(--solva-border)',
                }}
                className="px-3.5 py-2 border-b flex flex-wrap items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#FF5F56] border border-[#E0443E]/60" />
                    <span className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E] border border-[#DEA123]/60" />
                    <span className="w-2.5 h-2.5 rounded-full bg-[#27C93F] border border-[#1AAB29]/60" />
                  </div>
                  <span
                    style={{ color: 'var(--solva-ink)' }}
                    className="font-solva-sans text-[11.5px] font-medium ml-1 whitespace-nowrap"
                  >
                    {lang === 'vi'
                      ? 'Ví dụ báo cáo kiểm tra'
                      : 'Verification Report Sample'}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[5px] bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300 font-mono text-[10px] font-semibold whitespace-nowrap">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span>{lang === 'vi' ? 'TRỰC TIẾP' : 'LIVE'}</span>
                  </span>
                  <span
                    style={{
                      backgroundColor: 'var(--solva-surface)',
                      color: 'var(--solva-ink)',
                      borderColor: 'var(--solva-border)',
                    }}
                    className="px-2 py-0.5 rounded-[5px] border font-mono text-[10px] font-semibold whitespace-nowrap"
                  >
                    {lang === 'vi' ? 'Điểm toàn vẹn:' : 'Integrity Score:'}{' '}
                    <SolvaLiveNumber
                      value={activeTrace.cisScore}
                      decimals={1}
                      decimalSeparator={lang === 'vi' ? ',' : '.'}
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
                      className="px-2 py-1.5 rounded-[7px] border cursor-pointer transition-all duration-200 flex items-center justify-between gap-1"
                    >
                      <span
                        style={{ color: 'var(--solva-ink)' }}
                        className="font-mono text-[10px] font-semibold whitespace-nowrap"
                      >
                        {sample.marker} {sample.citation.split(' ')[0]}
                      </span>
                      <span
                        className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap ${
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
                className="p-3 space-y-2 animate-debugger-switch"
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
                        className="font-solva-sans text-[10.5px] font-medium"
                      >
                        · {lang === 'vi' ? activeTrace.ruleLabelVi : activeTrace.ruleLabelEn}
                      </span>
                    </div>
                    <p
                      style={{ color: 'var(--solva-ink)' }}
                      className="text-[12px] font-medium leading-snug mt-0.5"
                    >
                      {activeTrace.title}
                    </p>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] font-solva-sans text-[10.5px] font-semibold shrink-0 whitespace-nowrap border ${
                      activeTrace.tone === 'emerald'
                        ? 'bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300 border-emerald-500/25'
                        : activeTrace.tone === 'amber'
                          ? 'bg-amber-500/[0.12] text-amber-700 dark:text-amber-300 border-amber-500/25'
                          : 'bg-red-500/[0.12] text-red-700 dark:text-red-300 border-red-500/25'
                    }`}
                  >
                    {activeTrace.tone === 'emerald' ? (
                      <CheckCircle2 className="w-3 h-3 shrink-0" />
                    ) : activeTrace.tone === 'amber' ? (
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                    ) : (
                      <XCircle className="w-3 h-3 shrink-0" />
                    )}
                    <span>
                      {lang === 'vi'
                        ? activeTrace.verdictLabelVi
                        : activeTrace.verdictLabelEn}
                    </span>
                  </span>
                </div>

                {/* Plain-Language Verification Summary Box */}
                <div
                  style={{
                    backgroundColor: 'var(--solva-surface)',
                    borderColor: 'var(--solva-border)',
                  }}
                  className="rounded-[8px] px-2.5 py-1.5 border font-solva-sans text-[11px] leading-snug space-y-0.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span style={{ color: 'var(--solva-muted)' }}>
                      {lang === 'vi'
                        ? activeTrace.ruleSummaryVi
                        : activeTrace.ruleSummaryEn}
                    </span>
                    <span
                      style={{ color: 'var(--solva-ink)' }}
                      className="font-mono text-[10px] font-semibold whitespace-nowrap"
                    >
                      {lang === 'vi'
                        ? activeTrace.matchBadgeVi
                        : activeTrace.matchBadgeEn}
                    </span>
                  </div>
                  <div
                    style={{ color: 'var(--solva-ink)' }}
                    className="opacity-90 break-words"
                  >
                    {lang === 'vi'
                      ? activeTrace.checkSummaryVi
                      : activeTrace.checkSummaryEn}
                  </div>
                </div>

                {/* Live API Sources Latency Strip — Full Non-Truncated Source Names */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {activeTrace.sources.map((src) => (
                    <div
                      key={src.name}
                      style={{
                        backgroundColor: 'var(--solva-bg)',
                        borderColor: 'var(--solva-border)',
                      }}
                      className="flex-1 min-w-fit px-2.5 py-1.5 rounded-[7px] border flex items-center justify-between gap-2 font-mono text-[10px] whitespace-nowrap"
                    >
                      <span
                        style={{ color: 'var(--solva-ink)' }}
                        className="inline-flex items-center gap-1.5 font-medium whitespace-nowrap"
                      >
                        <ScholarlySourceLogo name={src.name} size={12} />
                        <span>{src.name}</span>
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

          {/* 3 Compact Feature Cards (Zero .truncate or line-clamp-*) */}
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
                  className="group p-2.5 xl:p-3 rounded-[12px] border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm flex flex-col justify-between gap-1.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
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
                      className="px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold border whitespace-nowrap"
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
                      className="text-[11px] mt-0.5 leading-snug"
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
        <div className="relative z-10 space-y-2.5">
          {/* Edge-Masked Infinite Scholarly Source Marquee */}
          <div className="w-full py-1 overflow-hidden solva-ticker-mask">
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
            className="pt-2.5 border-t flex items-center justify-between gap-4 text-[11px]"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Shield className="h-3.5 w-3.5 shrink-0" />
              <span>{t('auth.footerNote')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ============================================================
          Right Panel — Solva Warm Editorial Authentication Portal
          ============================================================ */}
      <div
        style={{ backgroundColor: 'var(--solva-bg)' }}
        className={`flex-1 flex flex-col justify-between relative overflow-hidden ${
          compactRightPanel
            ? 'p-4 sm:p-5 md:p-6 lg:px-8 lg:py-4 xl:px-10 xl:py-5'
            : 'p-4 sm:p-6 md:p-8 lg:p-8 xl:p-10'
        }`}
      >
        {/* Subtle Editorial Ambient Lighting & Grain */}
        <div className="pointer-events-none absolute inset-0">
          <div className="solva-noise-overlay" aria-hidden="true" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] h-[520px] bg-gradient-to-tr from-[#E7E3D9]/45 via-emerald-500/5 to-transparent dark:from-[#29261F]/35 dark:via-emerald-500/5 blur-3xl rounded-full" />
        </div>

        {/* Main Centered Container (FIRST in DOM order so #password toggle is first SVG button) */}
        <div
          className={`relative z-10 order-2 my-auto w-full ${maxWidthClass} mx-auto ${
            compactRightPanel ? 'py-1.5 sm:py-2' : 'py-3 sm:py-4'
          } animate-hero-reveal`}
        >
          {children}
        </div>

        {/* Top Utility Navigation Bar (Visually at top via order-1, placed AFTER form in DOM) */}
        <div
          className={`relative z-10 order-1 w-full ${maxWidthClass} lg:max-w-none mx-auto flex items-center justify-between gap-2`}
        >
          {/* Mobile Brand / Desktop Back to Overview Link */}
          <div className="flex items-center gap-3 shrink-0">
            <Link
              to="/"
              className="lg:hidden inline-flex items-center gap-[8px] rounded-[6px] shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1C1A15] dark:focus-visible:ring-[#FBFAF6]"
            >
              <span className="w-[28px] h-[28px] rounded-[7px] bg-white dark:bg-[#1E1C17] border border-[#E7E3D9] dark:border-[#332F26] shadow-sm flex items-center justify-center p-1 shrink-0">
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
              className="hidden lg:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] border text-xs font-solva-sans font-medium hover:opacity-85 transition-all shadow-sm"
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
              aria-label={lang === 'vi' ? 'Trang chủ' : 'Home'}
              style={{
                backgroundColor: 'var(--solva-surface)',
                borderColor: 'var(--solva-border)',
                color: 'var(--solva-ink)',
              }}
              className="lg:hidden inline-flex items-center justify-center gap-1 px-2 min-[380px]:px-2.5 h-8 rounded-[8px] border text-xs font-solva-sans font-medium hover:opacity-85 transition-opacity whitespace-nowrap"
            >
              <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden min-[380px]:inline">
                {lang === 'vi' ? 'Trang chủ' : 'Home'}
              </span>
            </Link>

            <button
              type="button"
              onClick={toggleLanguage}
              style={{
                backgroundColor: 'var(--solva-surface)',
                borderColor: 'var(--solva-border)',
                color: 'var(--solva-ink)',
              }}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[8px] border text-xs font-mono font-semibold hover:opacity-85 transition-opacity cursor-pointer shadow-sm"
              title={
                lang === 'vi' ? 'Switch to English' : 'Chuyển sang Tiếng Việt'
              }
            >
              <Globe className="h-3.5 w-3.5" />
              <span>{lang === 'vi' ? 'VI' : 'EN'}</span>
            </button>

            <ThemeToggle
              size="sm"
              className="h-8 w-8 rounded-[8px] bg-[#F4F2EC] dark:bg-[#1E1C17] border border-[#E7E3D9] dark:border-[#332F26] shadow-sm"
            />
          </div>
        </div>

        {/* Bottom Subtle Workspace Security Note (order-3) */}
        <div
          style={{ color: 'var(--solva-muted)' }}
          className={`relative z-10 order-3 w-full ${maxWidthClass} mx-auto ${
            compactRightPanel ? 'pt-1' : 'pt-2'
          } flex flex-wrap items-center justify-center sm:justify-between gap-x-3 gap-y-1 text-center text-[11px] font-mono`}
        >
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>
              {lang === 'vi'
                ? 'Không gian Học thuật CITRA'
                : 'CITRA Editorial Workspace'}
            </span>
          </span>
          <span>
            {lang === 'vi'
              ? 'Mã hóa TLS 1.3 · Riêng tư'
              : 'TLS 1.3 Encrypted · Private'}
          </span>
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
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSymbol = /[^a-zA-Z0-9]/.test(password);
  const hasAlphaNum = (hasLower || hasUpper) && hasDigit;
  const diversityCount = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;
  const matches =
    password.length > 0 &&
    confirmPassword.length > 0 &&
    password === confirmPassword;

  // Score purely on password length + character diversity (decoupled from confirmPassword)
  let score = 0;
  if (password.length > 0) {
    if (hasMinLen) score += 1;
    if (hasMinLen && diversityCount >= 2) score += 1;
    if (password.length >= 8 && diversityCount >= 3) score += 1;
    if (password.length >= 10 && diversityCount >= 4) score += 1;
    if (score === 3 && password.length >= 14 && diversityCount >= 3) score = 4;
  }

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
      className="rounded-[10px] border px-3 py-2 space-y-1.5"
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
            className={`h-1 rounded-full transition-colors ${
              score >= level
                ? barColors[score]
                : 'bg-[#E7E3D9] dark:bg-[#332F26]'
            }`}
          />
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 pt-0.5">
        {rules.map((r) => (
          <div
            key={r.label}
            className={`flex items-center gap-1.5 text-[11px] ${
              r.met
                ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                : 'text-[#56524A] dark:text-[#A8A296]'
            }`}
          >
            {r.met ? (
              <Check className="h-3 w-3 shrink-0" />
            ) : (
              <Circle className="h-2.5 w-2.5 shrink-0" />
            )}
            <span>{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
