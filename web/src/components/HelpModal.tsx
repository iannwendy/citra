import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  Keyboard,
  Upload,
  FileText,
  AlertTriangle,
  CheckCircle2,
  BookOpen,
  ShieldCheck,
  Sparkles,
  Globe,
  HelpCircle,
  ChevronRight,
  Gauge,
  FileSearch,
  Database,
  BarChart3,
  Download,
  Clock,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DecisionSupportBanner } from '@/components/DecisionSupportBanner';
import { useModalA11y } from '@/hooks/useModalA11y';
import { getVerdictDisplay, resolveAcademicLang } from '@/lib/academicTaxonomy';
import { SCHOLARLY_APIS_LABEL } from '@/lib/productFacts';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HelpModal({ isOpen, onClose }: HelpModalProps) {
  const { t, i18n } = useTranslation();
  const lang = resolveAcademicLang(i18n.resolvedLanguage || i18n.language);
  const isVi = lang === 'vi';
  const [activeSection, setActiveSection] = useState<string>('overview');
  const { dialogProps, titleId } = useModalA11y<HTMLDivElement>(isOpen, onClose);

  if (!isOpen) return null;

  const sections = [
    { id: 'overview', label: t('help.overview'), icon: BookOpen },
    { id: 'getting-started', label: t('help.gettingStarted'), icon: Upload },
    { id: 'verdicts', label: t('help.understandingVerdicts'), icon: ShieldCheck },
    { id: 'keyboard', label: t('help.keyboardShortcuts'), icon: Keyboard },
  ];

  const shortcuts = [
    {
      keys: ['Ctrl', 'B'],
      description: isVi
        ? 'Thu gọn / mở rộng thanh điều hướng bên trái'
        : 'Collapse / expand left navigation sidebar',
    },
    { keys: ['Ctrl', '/'], description: t('help.shortcutHelp') },
    { keys: ['Esc'], description: t('help.shortcutClose') },
  ];

  const workflowIcons = [Upload, FileSearch, Database, BarChart3, Download];
  const gettingStartedIcons = [Upload, Clock, CheckCircle2, Download];

  const verifiedDisplay = getVerdictDisplay('verified', lang);
  const metadataDisplay = getVerdictDisplay('metadata_error', lang);
  const notFoundDisplay = getVerdictDisplay('suspected_hallucination', lang);
  const unresolvedDisplay = getVerdictDisplay('unresolved', lang);
  const resourceDisplay = getVerdictDisplay('resource', lang);

  const verdictItems = [
    {
      id: 'verified',
      badge: verifiedDisplay.label,
      badgeVariant: 'verified' as const,
      desc: verifiedDisplay.description,
      icon: CheckCircle2,
      iconBox:
        'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-500/20',
    },
    {
      id: 'metadata_error',
      badge: metadataDisplay.label,
      badgeVariant: 'metadata_error' as const,
      desc: metadataDisplay.description,
      icon: AlertTriangle,
      iconBox:
        'bg-amber-500/10 text-amber-800 dark:text-amber-400 ring-1 ring-amber-500/20',
    },
    {
      id: 'incomplete_reference',
      badge: isVi ? 'Thiếu quy cách trích dẫn' : 'Incomplete Reference',
      badgeVariant: 'metadata_error' as const,
      desc: isVi
        ? 'Mục tham khảo thiếu các thông tin cơ bản (tác giả, năm xuất bản hoặc nơi công bố). Đây là lỗi thiếu sót quy cách trình bày chứ không phải dấu hiệu bịa đặt.'
        : 'Citations missing required bibliographic fields (author, publication year, or venue) are formatting omissions rather than fabricated sources.',
      icon: FileText,
      iconBox:
        'bg-amber-500/10 text-amber-800 dark:text-amber-400 ring-1 ring-amber-500/20',
    },
    {
      id: 'suspected_hallucination',
      badge: notFoundDisplay.label,
      badgeVariant: 'hallucination' as const,
      desc: notFoundDisplay.description,
      icon: XCircle,
      iconBox:
        'bg-red-500/10 text-red-700 dark:text-red-400 ring-1 ring-red-500/20',
    },
    {
      id: 'unresolved',
      badge: unresolvedDisplay.label,
      badgeVariant: 'muted' as const,
      desc: unresolvedDisplay.description,
      icon: HelpCircle,
      iconBox:
        'bg-slate-500/10 text-slate-700 dark:text-slate-300 ring-1 ring-slate-500/20',
    },
    {
      id: 'resource',
      badge: resourceDisplay.label,
      badgeVariant: 'default' as const,
      desc: resourceDisplay.description,
      icon: Globe,
      iconBox:
        'bg-violet-500/10 text-violet-700 dark:text-violet-400 ring-1 ring-violet-500/20',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div
        {...dialogProps}
        className="relative bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-2xl w-full max-w-4xl h-[620px] max-h-[88dvh] overflow-hidden flex flex-col animate-scale-in outline-none"
      >
        {/* Full-Width Executive Header */}
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <span className="w-[28px] h-[28px] rounded-[7px] bg-white dark:bg-[#1E1C17] border border-[#E7E3D9] dark:border-[#332F26] shadow-sm flex items-center justify-center p-1 shrink-0 transition-colors">
              <img
                src="/citra-logo.png"
                alt="CITRA Logo"
                width={18}
                height={18}
                className="object-contain select-none dark:brightness-150 dark:drop-shadow-[0_0_2px_rgba(255,255,255,0.45)]"
              />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2
                  id={titleId}
                  className="font-display text-sm sm:text-base font-semibold text-slate-900 dark:text-white tracking-tight truncate"
                >
                  {t('help.title')}
                </h2>
                <span className="inline-flex items-center rounded-md bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 text-[10px] sm:text-[11px] font-medium text-indigo-700 dark:text-indigo-300 ring-1 ring-inset ring-indigo-600/20 whitespace-nowrap">
                  {isVi ? 'Hướng dẫn CITRA' : 'CITRA Guide'}
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 truncate">
                {t('nav.academicVerification')} · {t('nav.footerSystem')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden sm:flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 mr-1">
              <kbd className="px-1.5 py-0.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-[11px] font-mono text-slate-600 dark:text-slate-300 shadow-sm">
                Ctrl
              </kbd>
              <span>+</span>
              <kbd className="px-1.5 py-0.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-[11px] font-mono text-slate-600 dark:text-slate-300 shadow-sm">
                /
              </kbd>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Split Body */}
        <div className="flex flex-1 min-h-0 overflow-hidden flex-col md:flex-row">
          {/* Sidebar Navigation — horizontal scroll strip on mobile, 272px column on desktop (zero truncation) */}
          <div className="w-full md:w-[272px] shrink-0 bg-slate-50/60 dark:bg-slate-900/50 border-b md:border-b-0 md:border-r border-slate-200/80 dark:border-slate-800 p-2.5 sm:p-3 flex flex-col justify-between gap-3">
            <nav
              aria-label={isVi ? 'Danh mục trợ giúp' : 'Help sections'}
              className="flex md:flex-col gap-1.5 overflow-x-auto scrollbar-none md:overflow-x-visible"
            >
              {sections.map((section) => {
                const Icon = section.icon;
                const isActive = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setActiveSection(section.id)}
                    aria-label={section.label}
                    className={`group shrink-0 md:w-full flex items-center justify-between gap-2.5 px-3 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm text-left whitespace-nowrap transition-all cursor-pointer ${
                      isActive
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold shadow-sm ring-1 ring-slate-200/90 dark:ring-slate-700'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100/80 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <span
                        className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                          isActive
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400 group-hover:text-slate-800 dark:group-hover:text-slate-200'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="whitespace-nowrap">{section.label}</span>
                    </span>
                    <ChevronRight
                      className={`hidden md:block h-3.5 w-3.5 shrink-0 transition-transform ${
                        isActive
                          ? 'text-indigo-600 dark:text-indigo-400 translate-x-0.5'
                          : 'text-slate-400 dark:text-slate-500 opacity-0 group-hover:opacity-100'
                      }`}
                    />
                  </button>
                );
              })}
            </nav>

            {/* Sidebar Academic Trust Summary (non-jargon bilingual card) */}
            <div className="hidden md:block rounded-xl bg-slate-100/80 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60 p-3.5">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  {isVi ? 'Đối chiếu học thuật minh bạch' : 'Transparent Verification'}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                {isVi
                  ? `Tra cứu đồng thời trên ${SCHOLARLY_APIS_LABEL} thư viện học thuật quốc tế kèm dẫn chứng rõ ràng.`
                  : `Cross-checked across ${SCHOLARLY_APIS_LABEL} scholarly registries with transparent evidence.`}
              </p>
            </div>
          </div>

          {/* Scrollable Content Pane with bottom scroll-fade to prevent mid-character clipping */}
          <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden bg-white dark:bg-slate-950/30">
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-10 sm:pb-12">
              {activeSection === 'overview' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-display font-semibold text-slate-900 dark:text-white tracking-tight">
                      {t('help.welcomeTitle')}
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed">
                      {t('help.welcomeDesc')}
                    </p>
                  </div>

                  {/* Unified Decision-Support Banner */}
                  <DecisionSupportBanner variant="card" lang={lang} />

                  {/* How It Works Pipeline */}
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
                      {t('help.howItWorksTitle')}
                    </h4>
                    <div className="space-y-2.5">
                      {[1, 2, 3, 4, 5].map((step) => {
                        const StepIcon = workflowIcons[step - 1] || FileText;
                        return (
                          <div
                            key={step}
                            className="flex items-center gap-3.5 p-3 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50"
                          >
                            <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono font-semibold text-indigo-600 dark:text-indigo-400 shrink-0 shadow-sm">
                              0{step}
                            </div>
                            <StepIcon className="h-4 w-4 text-slate-500 dark:text-slate-400 shrink-0" />
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                              {t(`help.step${step}`)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {activeSection === 'getting-started' && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-lg font-display font-semibold text-slate-900 dark:text-white tracking-tight">
                      {t('help.gettingStarted')}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {t('upload.subtitle')}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {[1, 2, 3, 4].map((num) => {
                      const StepIcon = gettingStartedIcons[num - 1] || FileText;
                      return (
                        <div
                          key={num}
                          className="group relative flex flex-col justify-between p-4 rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/70 shadow-sm hover:border-indigo-300 dark:hover:border-indigo-800/80 transition-all"
                        >
                          <div>
                            <div className="flex items-center justify-between mb-3">
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60">
                                {isVi ? `BƯỚC 0${num}` : `STEP 0${num}`}
                              </span>
                              <div className="h-8 w-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300">
                                <StepIcon className="h-4 w-4" />
                              </div>
                            </div>
                            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                              {t(`help.gs${num}Title`)}
                            </h4>
                            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed">
                              {t(`help.gs${num}Desc`)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeSection === 'verdicts' && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-lg font-display font-semibold text-slate-900 dark:text-white tracking-tight">
                      {t('help.understandingVerdicts')}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {t('essay.cisSubtitle')}
                    </p>
                  </div>

                  {/* Unified Academic Verdict Cards (zero raw enum codes) */}
                  <div className="space-y-2.5">
                    {verdictItems.map((item) => {
                      const Icon = item.icon;
                      return (
                        <div
                          key={item.id}
                          className="flex items-start gap-3.5 p-3.5 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800 shadow-sm hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
                        >
                          <div
                            className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${item.iconBox}`}
                          >
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <Badge variant={item.badgeVariant} className="text-[11px]">
                                {item.badge}
                              </Badge>
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                              {item.desc}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* CIS Score Breakdown Card (0 – 100 scale, never %) */}
                  <div className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 p-4">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-lg bg-indigo-600/10 dark:bg-indigo-500/15 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                          <Gauge className="h-4 w-4" />
                        </div>
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                          {t('help.cisTitle')}
                        </h4>
                      </div>
                      <span className="font-mono text-xs font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-md border border-indigo-200/60 dark:border-indigo-800/60">
                        0 – 100
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                      {t('help.cisDesc')}
                    </p>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                      <div className="rounded-lg bg-white dark:bg-slate-900 p-2.5 border border-slate-200/80 dark:border-slate-800">
                        <div className="flex items-center justify-between text-[11px] font-mono font-semibold text-emerald-700 dark:text-emerald-400 mb-1">
                          <span>85 – 100</span>
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        </div>
                        <div className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                          {isVi ? 'Xuất sắc' : 'Excellent'}
                        </div>
                      </div>
                      <div className="rounded-lg bg-white dark:bg-slate-900 p-2.5 border border-slate-200/80 dark:border-slate-800">
                        <div className="flex items-center justify-between text-[11px] font-mono font-semibold text-indigo-700 dark:text-indigo-300 mb-1">
                          <span>70 – 84</span>
                          <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                        </div>
                        <div className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                          {isVi ? 'Tốt' : 'Good'}
                        </div>
                      </div>
                      <div className="rounded-lg bg-white dark:bg-slate-900 p-2.5 border border-slate-200/80 dark:border-slate-800">
                        <div className="flex items-center justify-between text-[11px] font-mono font-semibold text-amber-800 dark:text-amber-400 mb-1">
                          <span>50 – 69</span>
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        </div>
                        <div className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                          {isVi ? 'Trung bình / Cần rà soát' : 'Fair / Needs Review'}
                        </div>
                      </div>
                      <div className="rounded-lg bg-white dark:bg-slate-900 p-2.5 border border-slate-200/80 dark:border-slate-800">
                        <div className="flex items-center justify-between text-[11px] font-mono font-semibold text-red-700 dark:text-red-400 mb-1">
                          <span>&lt; 50</span>
                          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                        </div>
                        <div className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                          {isVi ? 'Cần rà soát kỹ' : 'Needs Thorough Review'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeSection === 'keyboard' && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-lg font-display font-semibold text-slate-900 dark:text-white tracking-tight">
                      {t('help.keyboardShortcuts')}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {t('help.shortcutsIntro')}
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/70 divide-y divide-slate-200/70 dark:divide-slate-800 overflow-hidden shadow-sm">
                    {shortcuts.map((shortcut, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-7 w-7 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 shrink-0">
                            <Keyboard className="h-3.5 w-3.5" />
                          </div>
                          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                            {shortcut.description}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {shortcut.keys.map((key, keyIndex) => (
                            <span key={keyIndex} className="inline-flex items-center gap-1.5">
                              <kbd className="px-2.5 py-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 border-b-2 rounded-md text-xs font-mono font-semibold text-slate-700 dark:text-slate-200 shadow-sm">
                                {key}
                              </kbd>
                              {keyIndex < shortcut.keys.length - 1 && (
                                <span className="text-xs text-slate-500 font-medium">+</span>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {/* Subtle bottom scroll fade so scrolled lines never slice abruptly */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-white via-white/80 to-transparent dark:from-slate-950 dark:via-slate-950/80"
            />
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/80 shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 min-w-0">
            <ShieldCheck className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <span className="truncate">{t('auth.footerNote')}</span>
          </div>
          <Button variant="outline" size="sm" onClick={onClose} className="h-8 text-xs shrink-0">
            {t('common.close')}
          </Button>
        </div>
      </div>
    </div>
  );
}
