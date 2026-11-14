import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, FileSearch, Link2, GitBranch, Terminal, Lock, Sparkles } from 'lucide-react';
import { useRole } from '@/hooks/useRole';
import { UpgradeModal } from '@/components/UpgradeModal';
import { BibliographyRemediationModal } from '@/components/BibliographyRemediationModal';
import { Button } from '@/components/ui/button';

interface EssayActionBarProps {
  essayId: string;
  filename?: string;
  onOpenRemediation?: () => void;
}

/**
 * Quick navigation row beneath the report header. Links to companion pages
 * (Debugger Report, Issues, Document, Consistency, Logic Trace) + Remediation Engine using shadcn/ui Button.
 */
export function EssayActionBar({ essayId, filename, onOpenRemediation }: EssayActionBarProps) {
  const { t, i18n } = useTranslation();
  const { has, isUser } = useRole();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [lockedFeature, setLockedFeature] = useState<string>('');
  const [remediationOpen, setRemediationOpen] = useState(false);
  const location = useLocation();
  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const isVi = lang === 'vi';
  const remediationLabel = isVi ? 'Chuẩn hóa Tài liệu tham khảo' : 'Remediation Engine';
  const remediationSubtitle = isVi
    ? 'Tự động chuẩn hóa (APA / IEEE / TDTU)'
    : 'Auto-Fix Style (APA / IEEE / TDTU)';

  const basePath = `/verification/report/${essayId}`;
  const currentPath = location.pathname;

  const isReportRoot = currentPath === basePath || currentPath === `/essay/${essayId}`;
  const isIssues = currentPath.endsWith('/issues');
  const isDocument = currentPath.endsWith('/document');
  const isConsistency = currentPath.endsWith('/consistency');
  const isTrace = currentPath.endsWith('/trace');

  const handleLockedClick = (featureTitle: string) => {
    setLockedFeature(featureTitle);
    setUpgradeOpen(true);
  };

  return (
    <>
      <div className="flex flex-wrap sm:inline-flex items-center gap-1.5 sm:gap-2 p-1.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs overflow-x-auto scrollbar-none max-w-full">
        <Button
          asChild
          variant={isReportRoot ? 'default' : 'ghost'}
          size="sm"
          className={`h-8 rounded-xl text-xs font-medium shrink-0 whitespace-nowrap ${
            isReportRoot
              ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-xs'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          <Link to={basePath}>
            <Terminal className={`h-3.5 w-3.5 ${isReportRoot ? 'text-white' : 'text-indigo-500'}`} />
            <span>
              {isUser
                ? t('essay.citationsTab')
                : lang === 'vi'
                  ? 'Citation Debugger'
                  : 'Citation Debugger'}
            </span>
          </Link>
        </Button>

        <Button
          asChild
          variant={isIssues ? 'default' : 'ghost'}
          size="sm"
          className={`h-8 rounded-xl text-xs font-medium shrink-0 whitespace-nowrap ${
            isIssues
              ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-xs'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          <Link to={`${basePath}/issues`}>
            <AlertCircle className={`h-3.5 w-3.5 ${isIssues ? 'text-white' : 'text-amber-500'}`} />
            <span>{t('essay.issues')}</span>
          </Link>
        </Button>

        {has('view_document_inspector') ? (
          <Button
            asChild
            variant={isDocument ? 'default' : 'ghost'}
            size="sm"
            className={`h-8 rounded-xl text-xs font-medium shrink-0 whitespace-nowrap ${
              isDocument
                ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <Link to={`${basePath}/document`}>
              <FileSearch className={`h-3.5 w-3.5 ${isDocument ? 'text-white' : 'text-indigo-500'}`} />
              <span>{t('essay.document')}</span>
            </Link>
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="locked-document-inspector-btn"
            onClick={() => handleLockedClick('Document Inspector')}
            className="h-8 rounded-xl text-xs font-medium shrink-0 whitespace-nowrap text-slate-500 hover:text-indigo-600 cursor-pointer"
          >
            <Lock className="h-3.5 w-3.5 text-amber-500" />
            <span>{t('essay.document')}</span>
            <span className="ml-1 px-1.5 py-0.2 rounded bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 text-[9px] font-mono font-bold">
              PRO
            </span>
          </Button>
        )}

        {has('view_orphan_detection') ? (
          <Button
            asChild
            variant={isConsistency ? 'default' : 'ghost'}
            size="sm"
            className={`h-8 rounded-xl text-xs font-medium shrink-0 whitespace-nowrap ${
              isConsistency
                ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <Link to={`${basePath}/consistency`}>
              <Link2 className={`h-3.5 w-3.5 ${isConsistency ? 'text-white' : 'text-emerald-500'}`} />
              <span>{t('essay.consistency')}</span>
            </Link>
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="locked-consistency-btn"
            onClick={() => handleLockedClick('Citation Consistency & Orphan Analysis')}
            className="h-8 rounded-xl text-xs font-medium shrink-0 whitespace-nowrap text-slate-500 hover:text-indigo-600 cursor-pointer"
          >
            <Lock className="h-3.5 w-3.5 text-amber-500" />
            <span>{t('essay.consistency')}</span>
            <span className="ml-1 px-1.5 py-0.2 rounded bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 text-[9px] font-mono font-bold">
              PRO
            </span>
          </Button>
        )}

        {has('view_logic_trace') ? (
          <Button
            asChild
            variant={isTrace ? 'default' : 'ghost'}
            size="sm"
            className={`h-8 rounded-xl text-xs font-medium shrink-0 whitespace-nowrap ${
              isTrace
                ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <Link to={`${basePath}/trace`}>
              <GitBranch className={`h-3.5 w-3.5 ${isTrace ? 'text-white' : 'text-violet-500'}`} />
              <span>{t('essay.logicTrace')}</span>
            </Link>
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="locked-logic-trace-btn"
            onClick={() => handleLockedClick('Neuro-Symbolic Logic Trace')}
            className="h-8 rounded-xl text-xs font-medium shrink-0 whitespace-nowrap text-slate-500 hover:text-indigo-600 cursor-pointer"
          >
            <Lock className="h-3.5 w-3.5 text-amber-500" />
            <span>{t('essay.logicTrace')}</span>
            <span className="ml-1 px-1.5 py-0.2 rounded bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 text-[9px] font-mono font-bold">
              PRO
            </span>
          </Button>
        )}

        {has('view_logic_trace') ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="actionbar-remediation-btn"
            title={remediationSubtitle}
            aria-label={`${remediationLabel} — ${remediationSubtitle}`}
            onClick={() => (onOpenRemediation ? onOpenRemediation() : setRemediationOpen(true))}
            className="h-8 rounded-xl text-xs font-medium shrink-0 whitespace-nowrap text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 cursor-pointer"
          >
            <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
            <span>{remediationLabel}</span>
            <span className="hidden xl:inline text-[10px] font-mono text-slate-500 dark:text-slate-400">
              · {remediationSubtitle}
            </span>
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="locked-remediation-btn"
            title={remediationSubtitle}
            aria-label={`${remediationLabel} — ${remediationSubtitle}`}
            onClick={() => handleLockedClick(`${remediationLabel} — ${remediationSubtitle}`)}
            className="h-8 rounded-xl text-xs font-medium shrink-0 whitespace-nowrap text-slate-500 hover:text-indigo-600 cursor-pointer"
          >
            <Lock className="h-3.5 w-3.5 text-amber-500" />
            <span>{remediationLabel}</span>
            <span className="ml-1 px-1.5 py-0.2 rounded bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 text-[9px] font-mono font-bold">
              PRO
            </span>
          </Button>
        )}
      </div>

      <BibliographyRemediationModal
        open={remediationOpen}
        essayId={Number(essayId) || 0}
        filename={filename || `essay_${essayId}.pdf`}
        lang={lang}
        onClose={() => setRemediationOpen(false)}
      />

      <UpgradeModal
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        featureName={lockedFeature}
      />
    </>
  );
}
