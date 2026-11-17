import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  BookOpen,
  Check,
  FileSearch,
  GitBranch,
  Link2,
  Lock,
  Network,
  Sparkles,
} from 'lucide-react';
import { useRole } from '@/hooks/useRole';
import { UpgradeModal } from '@/components/UpgradeModal';
import { BibliographyRemediationModal } from '@/components/BibliographyRemediationModal';
import { Button } from '@/components/ui/button';
import { useSlidingPill } from '@/components/ui/transitions';

export type ReportWorkspaceMode = 'debugger' | 'document' | 'consistency' | 'graph';

interface EssayActionBarProps {
  essayId: string;
  filename?: string;
  issueCount?: number;
  consistencyOk?: boolean;
  workspaceMode?: ReportWorkspaceMode;
  onChangeWorkspaceMode?: (mode: ReportWorkspaceMode) => void;
  hideRemediationButton?: boolean;
  onOpenRemediation?: () => void;
}

/**
 * Single-purpose View Switcher Bar beneath the report header.
 * When `onChangeWorkspaceMode` is provided (Unified Single-Page Report), all 4 views
 * (`Citations`, `In Document`, `In-Text Check`, `Network`) stay pinned in one fixed
 * container and glide at 120fps via GPU-composited `useSlidingPill`.
 */
export function EssayActionBar({
  essayId,
  filename,
  issueCount,
  consistencyOk,
  workspaceMode = 'debugger',
  onChangeWorkspaceMode,
  hideRemediationButton = false,
  onOpenRemediation,
}: EssayActionBarProps) {
  const { i18n } = useTranslation();
  const { has } = useRole();
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

  const isUnifiedMode = Boolean(onChangeWorkspaceMode);
  const isIssues = !isUnifiedMode && currentPath.endsWith('/issues');
  const isDocument = isUnifiedMode
    ? workspaceMode === 'document'
    : currentPath.endsWith('/document');
  const isConsistency = isUnifiedMode
    ? workspaceMode === 'consistency'
    : currentPath.endsWith('/consistency');
  const isTrace = !isUnifiedMode && currentPath.endsWith('/trace');
  const isGraphTabActive = isUnifiedMode && workspaceMode === 'graph';
  const isCitationsTabActive = isUnifiedMode
    ? workspaceMode === 'debugger'
    : !isIssues && !isDocument && !isConsistency && !isTrace;

  const activePillKey = isUnifiedMode
    ? workspaceMode
    : isDocument
      ? 'document'
      : isConsistency
        ? 'consistency'
        : isIssues
          ? 'issues'
          : isTrace
            ? 'trace'
            : 'debugger';

  const { containerRef: tabsRef, pillStyle } = useSlidingPill<HTMLDivElement>(
    `${activePillKey}-${lang}`,
  );

  const handleLockedClick = (featureTitle: string) => {
    setLockedFeature(featureTitle);
    setUpgradeOpen(true);
  };

  const tabBtnClass = (isActive: boolean) =>
    `t-tab inline-flex items-center justify-center gap-1 sm:gap-1.5 h-8 px-1.5 sm:px-3 rounded-lg text-[11px] sm:text-xs font-semibold min-w-0 sm:shrink-0 whitespace-nowrap select-none cursor-pointer transition-colors ${
      isActive
        ? pillStyle.ready
          ? 'text-slate-900 dark:text-white'
          : 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
    }`;

  const lockedTabBtnClass =
    't-tab inline-flex items-center justify-center gap-1 sm:gap-1.5 h-8 px-1.5 sm:px-3 rounded-lg text-[11px] sm:text-xs font-medium min-w-0 sm:shrink-0 whitespace-nowrap text-slate-500 hover:text-indigo-600 cursor-pointer transition-colors';

  return (
    <>
      <div
        ref={tabsRef}
        role="tablist"
        data-testid="report-view-tablist"
        aria-label={isVi ? 'Chế độ xem báo cáo' : 'Report Views'}
        className={`t-tabs relative ${
          isUnifiedMode && hideRemediationButton
            ? 'grid grid-cols-2 w-full sm:w-auto sm:inline-flex'
            : 'flex flex-wrap sm:inline-flex'
        } items-center gap-1 p-1 rounded-xl bg-slate-100/90 dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 max-w-full shrink-0`}
      >
        {/* 120fps GPU-Composited Sliding Pill */}
        <span
          aria-hidden="true"
          data-testid="report-tabs-sliding-pill"
          style={{
            width: `${pillStyle.width}px`,
            height: `${pillStyle.height}px`,
            transform: `translate3d(${pillStyle.left}px, ${pillStyle.top}px, 0)`,
            opacity: pillStyle.ready ? 1 : 0,
            transition: pillStyle.animate ? undefined : 'none',
          }}
          className="t-tabs-pill rounded-lg bg-white dark:bg-slate-800 shadow-xs"
        />

        {/* View 1: Citations (Default) */}
        {isUnifiedMode && onChangeWorkspaceMode ? (
          <button
            type="button"
            role="tab"
            data-testid="mode-citations-btn"
            aria-selected={isCitationsTabActive}
            data-pill-active={isCitationsTabActive ? 'true' : 'false'}
            onClick={() => onChangeWorkspaceMode('debugger')}
            className={tabBtnClass(isCitationsTabActive)}
          >
            <BookOpen
              className={`h-3.5 w-3.5 shrink-0 ${
                isCitationsTabActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500'
              }`}
            />
            <span className="truncate">{isVi ? 'Danh mục trích dẫn' : 'Citations'}</span>
            {typeof issueCount === 'number' && issueCount > 0 && (
              <span className="ml-0.5 px-1.5 py-0.2 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300/70 dark:border-amber-800 shrink-0">
                {issueCount}
              </span>
            )}
          </button>
        ) : (
          <Link
            to={basePath}
            data-pill-active={isCitationsTabActive ? 'true' : 'false'}
            className={tabBtnClass(isCitationsTabActive)}
          >
            <BookOpen
              className={`h-3.5 w-3.5 shrink-0 ${
                isCitationsTabActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500'
              }`}
            />
            <span className="truncate">{isVi ? 'Danh mục trích dẫn' : 'Citations'}</span>
            {typeof issueCount === 'number' && issueCount > 0 && (
              <span className="ml-0.5 px-1.5 py-0.2 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300/70 dark:border-amber-800 shrink-0">
                {issueCount}
              </span>
            )}
          </Link>
        )}

        {/* View 2: In Document */}
        {has('view_document_inspector') ? (
          isUnifiedMode && onChangeWorkspaceMode ? (
            <button
              type="button"
              role="tab"
              data-testid="mode-document-btn"
              aria-selected={isDocument}
              data-pill-active={isDocument ? 'true' : 'false'}
              onClick={() => onChangeWorkspaceMode('document')}
              className={tabBtnClass(isDocument)}
            >
              <FileSearch
                className={`h-3.5 w-3.5 shrink-0 ${
                  isDocument ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500'
                }`}
              />
              <span className="truncate">{isVi ? 'Xem trong bài viết' : 'In Document'}</span>
            </button>
          ) : (
            <Link
              to={`${basePath}/document`}
              data-pill-active={isDocument ? 'true' : 'false'}
              className={tabBtnClass(isDocument)}
            >
              <FileSearch
                className={`h-3.5 w-3.5 shrink-0 ${
                  isDocument ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500'
                }`}
              />
              <span className="truncate">{isVi ? 'Xem trong bài viết' : 'In Document'}</span>
            </Link>
          )
        ) : (
          <button
            type="button"
            role={isUnifiedMode ? 'tab' : undefined}
            aria-selected={isUnifiedMode ? false : undefined}
            data-testid="locked-document-inspector-btn"
            onClick={() =>
              handleLockedClick(isVi ? 'Xem trích dẫn trong bài viết' : 'In-Document Citation View')
            }
            className={lockedTabBtnClass}
          >
            <Lock className="h-3 w-3 text-slate-400 shrink-0" />
            <span className="truncate">{isVi ? 'Xem trong bài viết' : 'In Document'}</span>
          </button>
        )}

        {/* View 3: In-Text <-> Bibliography Check */}
        {has('view_orphan_detection') ? (
          isUnifiedMode && onChangeWorkspaceMode ? (
            <button
              type="button"
              role="tab"
              data-testid="mode-consistency-btn"
              aria-selected={isConsistency}
              data-pill-active={isConsistency ? 'true' : 'false'}
              onClick={() => onChangeWorkspaceMode('consistency')}
              className={tabBtnClass(isConsistency)}
            >
              <Link2
                className={`h-3.5 w-3.5 shrink-0 ${
                  isConsistency ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500'
                }`}
              />
              <span className="truncate">{isVi ? 'Kiểm tra thiếu / thừa' : 'In-Text Check'}</span>
              {consistencyOk && (
                <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              )}
            </button>
          ) : (
            <Link
              to={`${basePath}/consistency`}
              data-pill-active={isConsistency ? 'true' : 'false'}
              className={tabBtnClass(isConsistency)}
            >
              <Link2
                className={`h-3.5 w-3.5 shrink-0 ${
                  isConsistency ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500'
                }`}
              />
              <span className="truncate">{isVi ? 'Kiểm tra thiếu / thừa' : 'In-Text Check'}</span>
              {consistencyOk && (
                <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              )}
            </Link>
          )
        ) : (
          <button
            type="button"
            role={isUnifiedMode ? 'tab' : undefined}
            aria-selected={isUnifiedMode ? false : undefined}
            data-testid="locked-consistency-btn"
            onClick={() =>
              handleLockedClick(
                isVi
                  ? 'Kiểm tra thiếu / thừa trích dẫn'
                  : 'Citation Consistency & Orphan Analysis',
              )
            }
            className={lockedTabBtnClass}
          >
            <Lock className="h-3 w-3 text-slate-400 shrink-0" />
            <span className="truncate">{isVi ? 'Kiểm tra thiếu / thừa' : 'In-Text Check'}</span>
          </button>
        )}

        {/* View 4: Network Graph Switcher (Unified Single-Page Report) */}
        {isUnifiedMode && onChangeWorkspaceMode && (
          <button
            type="button"
            role="tab"
            data-testid="mode-graph-btn"
            aria-selected={isGraphTabActive}
            data-pill-active={isGraphTabActive ? 'true' : 'false'}
            onClick={() => {
              if (!has('view_logic_trace')) {
                handleLockedClick(
                  isVi
                    ? 'Sơ đồ Mạng lưới Liên kết Trích dẫn'
                    : 'Interactive Citation Network Graph',
                );
                return;
              }
              onChangeWorkspaceMode('graph');
            }}
            className={
              has('view_logic_trace')
                ? tabBtnClass(isGraphTabActive)
                : lockedTabBtnClass
            }
          >
            {has('view_logic_trace') ? (
              <Network
                className={`h-3.5 w-3.5 shrink-0 ${
                  isGraphTabActive ? 'text-violet-600 dark:text-violet-400' : 'text-slate-500'
                }`}
              />
            ) : (
              <Lock className="h-3 w-3 text-slate-400 shrink-0" />
            )}
            <span className="truncate">{isVi ? 'Sơ đồ' : 'Network'}</span>
          </button>
        )}

        {/* Contextual indicator ONLY when visiting companion /issues or /trace URL directly */}
        {isIssues && (
          <Link
            to={`${basePath}/issues`}
            data-pill-active="true"
            className={tabBtnClass(true)}
          >
            <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            <span>{isVi ? 'Danh sách vấn đề' : 'Issues'}</span>
          </Link>
        )}

        {isTrace && (
          <Link
            to={`${basePath}/trace`}
            data-pill-active="true"
            className={tabBtnClass(true)}
          >
            <GitBranch className="h-3.5 w-3.5 text-violet-500 shrink-0" />
            <span>{isVi ? 'Chi tiết kiểm chứng' : 'How We Verified'}</span>
          </Link>
        )}

        {/* Standalone Remediation CTA (hidden when EssayHeader already renders Primary CTA above) */}
        {!hideRemediationButton &&
          (has('view_logic_trace') ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="actionbar-remediation-btn"
              title={remediationSubtitle}
              aria-label={`${remediationLabel} — ${remediationSubtitle}`}
              onClick={() =>
                onOpenRemediation ? onOpenRemediation() : setRemediationOpen(true)
              }
              className="t-tab h-8 rounded-lg text-xs font-medium shrink-0 whitespace-nowrap text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
              <span>{remediationLabel}</span>
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
              className="t-tab h-8 rounded-lg text-xs font-medium shrink-0 whitespace-nowrap text-slate-500 hover:text-indigo-600 cursor-pointer"
            >
              <Lock className="h-3 w-3 text-slate-400" />
              <span>{remediationLabel}</span>
            </Button>
          ))}
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
