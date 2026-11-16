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

interface EssayActionBarProps {
  essayId: string;
  filename?: string;
  issueCount?: number;
  consistencyOk?: boolean;
  workspaceMode?: 'debugger' | 'graph';
  onChangeWorkspaceMode?: (mode: 'debugger' | 'graph') => void;
  hideRemediationButton?: boolean;
  onOpenRemediation?: () => void;
}

/**
 * Single-purpose View Switcher Bar beneath the report header.
 * Presents 3 clear human-friendly views:
 * 1. Danh mục trích dẫn (Citations)
 * 2. Xem trong bài viết (In Document)
 * 3. Kiểm tra thiếu / thừa (In-Text Check)
 * Plus optional Network Graph toggle on the main report workspace.
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

  const isReportRoot = currentPath === basePath || currentPath === `/essay/${essayId}`;
  const isIssues = currentPath.endsWith('/issues');
  const isDocument = currentPath.endsWith('/document');
  const isConsistency = currentPath.endsWith('/consistency');
  const isTrace = currentPath.endsWith('/trace');

  const isCitationsTabActive = isReportRoot && workspaceMode !== 'graph';
  const isGraphTabActive = isReportRoot && workspaceMode === 'graph';

  const handleLockedClick = (featureTitle: string) => {
    setLockedFeature(featureTitle);
    setUpgradeOpen(true);
  };

  return (
    <>
      <div
        role="tablist"
        aria-label={isVi ? 'Chế độ xem báo cáo' : 'Report Views'}
        className="flex flex-wrap sm:inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100/90 dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 max-w-full"
      >
        {/* View 1: Citations (Default) */}
        <Button
          asChild
          variant={isCitationsTabActive ? 'default' : 'ghost'}
          size="sm"
          className={`h-8 rounded-lg text-xs font-semibold shrink-0 whitespace-nowrap transition-all ${
            isCitationsTabActive
              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white hover:bg-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Link
            to={basePath}
            onClick={() => {
              if (onChangeWorkspaceMode) {
                onChangeWorkspaceMode('debugger');
              }
            }}
          >
            <BookOpen
              className={`h-3.5 w-3.5 ${
                isCitationsTabActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500'
              }`}
            />
            <span>{isVi ? 'Danh mục trích dẫn' : 'Citations'}</span>
            {typeof issueCount === 'number' && issueCount > 0 && (
              <span className="ml-0.5 px-1.5 py-0.2 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300/70 dark:border-amber-800">
                {issueCount}
              </span>
            )}
          </Link>
        </Button>

        {/* View 2: In Document */}
        {has('view_document_inspector') ? (
          <Button
            asChild
            variant={isDocument ? 'default' : 'ghost'}
            size="sm"
            className={`h-8 rounded-lg text-xs font-semibold shrink-0 whitespace-nowrap transition-all ${
              isDocument
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white hover:bg-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Link to={`${basePath}/document`}>
              <FileSearch
                className={`h-3.5 w-3.5 ${
                  isDocument ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500'
                }`}
              />
              <span>{isVi ? 'Xem trong bài viết' : 'In Document'}</span>
            </Link>
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="locked-document-inspector-btn"
            onClick={() =>
              handleLockedClick(isVi ? 'Xem trích dẫn trong bài viết' : 'In-Document Citation View')
            }
            className="h-8 rounded-lg text-xs font-medium shrink-0 whitespace-nowrap text-slate-500 hover:text-indigo-600 cursor-pointer"
          >
            <Lock className="h-3 w-3 text-slate-400" />
            <span>{isVi ? 'Xem trong bài viết' : 'In Document'}</span>
          </Button>
        )}

        {/* View 3: In-Text <-> Bibliography Check */}
        {has('view_orphan_detection') ? (
          <Button
            asChild
            variant={isConsistency ? 'default' : 'ghost'}
            size="sm"
            className={`h-8 rounded-lg text-xs font-semibold shrink-0 whitespace-nowrap transition-all ${
              isConsistency
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white hover:bg-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Link to={`${basePath}/consistency`}>
              <Link2
                className={`h-3.5 w-3.5 ${
                  isConsistency ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500'
                }`}
              />
              <span>{isVi ? 'Kiểm tra thiếu / thừa' : 'In-Text Check'}</span>
              {consistencyOk && (
                <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              )}
            </Link>
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="locked-consistency-btn"
            onClick={() =>
              handleLockedClick(
                isVi
                  ? 'Kiểm tra thiếu / thừa trích dẫn'
                  : 'Citation Consistency & Orphan Analysis',
              )
            }
            className="h-8 rounded-lg text-xs font-medium shrink-0 whitespace-nowrap text-slate-500 hover:text-indigo-600 cursor-pointer"
          >
            <Lock className="h-3 w-3 text-slate-400" />
            <span>{isVi ? 'Kiểm tra thiếu / thừa' : 'In-Text Check'}</span>
          </Button>
        )}

        {/* Optional View 4: Subtle Network Graph Switcher (when inside EssayPage) */}
        {onChangeWorkspaceMode && (
          <Button
            type="button"
            variant={isGraphTabActive ? 'default' : 'ghost'}
            size="sm"
            data-testid="mode-graph-btn"
            onClick={() => {
              if (!has('view_logic_trace')) {
                handleLockedClick(
                  isVi
                    ? 'Sơ đồ Mạng lưới Liên kết Trích dẫn'
                    : 'Interactive Citation Network Graph',
                );
                return;
              }
              onChangeWorkspaceMode(isGraphTabActive ? 'debugger' : 'graph');
            }}
            className={`h-8 rounded-lg text-xs font-semibold shrink-0 whitespace-nowrap cursor-pointer transition-all ${
              isGraphTabActive
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white hover:bg-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Network
              className={`h-3.5 w-3.5 ${
                isGraphTabActive ? 'text-violet-600 dark:text-violet-400' : 'text-slate-500'
              }`}
            />
            <span>{isVi ? 'Sơ đồ' : 'Network'}</span>
          </Button>
        )}

        {/* Contextual indicator ONLY when visiting companion /issues or /trace URL directly */}
        {isIssues && (
          <Button
            asChild
            variant="default"
            size="sm"
            className="h-8 rounded-lg text-xs font-semibold shrink-0 whitespace-nowrap bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs"
          >
            <Link to={`${basePath}/issues`}>
              <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
              <span>{isVi ? 'Danh sách vấn đề' : 'Issues'}</span>
            </Link>
          </Button>
        )}

        {isTrace && (
          <Button
            asChild
            variant="default"
            size="sm"
            className="h-8 rounded-lg text-xs font-semibold shrink-0 whitespace-nowrap bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs"
          >
            <Link to={`${basePath}/trace`}>
              <GitBranch className="h-3.5 w-3.5 text-violet-500" />
              <span>{isVi ? 'Chi tiết kiểm chứng' : 'How We Verified'}</span>
            </Link>
          </Button>
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
              className="h-8 rounded-lg text-xs font-medium shrink-0 whitespace-nowrap text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 cursor-pointer"
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
              className="h-8 rounded-lg text-xs font-medium shrink-0 whitespace-nowrap text-slate-500 hover:text-indigo-600 cursor-pointer"
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
