import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  type AnalysisReport,
  type Verdict,
  type Citation,
  type CitationMappingStatus,
} from '@/api/client';
import { VerdictBadge } from '@/components/VerdictBadge';
import { getCitationMarkerLabel, isUrlResource } from '@/lib/verdictExplanation';
import { MappingStatusBadge } from '@/components/MappingStatusBadge';
import { DecisionSupportBanner } from '@/components/DecisionSupportBanner';
import {
  formatUserError,
  getMappingStatusDisplay,
} from '@/lib/academicTaxonomy';
import { useOrphanReport } from '@/hooks/useOrphanReport';
import { EssayHeader } from './essay/EssayHeader';
import { EssayActionBar } from './essay/EssayActionBar';
import { DirectionalStageSlide, useSlidingPill } from '@/components/ui/transitions';
import {
  Loader2,
  AlertCircle,
  Link2Off,
  FileText,
  CheckCircle,
  HelpCircle,
  GitCompare,
  Copy,
  AlertTriangle,
  ArrowLeft,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/* ============================================================
   SourceLogic — Orphan Detection Page (L5)
   Bipartite Citation ↔ Bibliography Consistency Analyzer
   ============================================================ */

interface OrphanCitation {
  citation_id: string;
  citation_raw: string;
  label: string;
  mapping_status: CitationMappingStatus;
  triggered_rules?: string[];
  numeric_index?: number | null;
  sub_index?: string | null;
  composite_label?: string | null;
  reference_id?: string;
  citation_link?: Verdict['citation_link'];
  features?: Verdict['features'];
}

interface UncitedReference {
  reference_id: string;
  raw_text: string;
  numeric_index?: number | null;
  sub_index?: string | null;
  composite_label?: string | null;
  citation_link?: Verdict['citation_link'];
  features?: Verdict['features'];
}

function getOrphanStats(
  verdicts: Verdict[],
  references?: Citation[],
  extractedCitations?: Citation[]
) {
  const verdictOrphans = verdicts.filter(
    (v) => v.mapping_status === 'missing_reference' || v.mapping_status === 'in_text_mismatch'
  );
  const seenOrphanRaw = new Set(verdictOrphans.map((v) => v.citation_raw));
  const extraOrphansFromExtracted: OrphanCitation[] = (extractedCitations ?? [])
    .filter(
      (c) =>
        (c.mapping_status === 'missing_reference' || c.mapping_status === 'in_text_mismatch') &&
        !seenOrphanRaw.has(c.raw_text)
    )
    .map((c, i) => ({
      citation_id: String(c.id ?? `occ-orphan-${i}`),
      citation_raw: c.raw_text,
      label: 'unresolved',
      mapping_status: c.mapping_status || 'missing_reference',
      numeric_index: c.numeric_index,
      sub_index: c.sub_index,
      composite_label: c.composite_label,
      reference_id: c.reference_id,
      citation_link: c.citation_link,
    }));

  const citationsWithoutReference: OrphanCitation[] = [
    ...verdictOrphans,
    ...extraOrphansFromExtracted,
  ];
  const verdictUncited = verdicts.filter(
    (v) => v.mapping_status === 'uncited_reference'
  );
  const seenUncitedRaw = new Set(verdictUncited.map((v) => v.citation_raw));
  const extraUncitedFromRefs: UncitedReference[] = (references ?? [])
    .filter(
      (r) =>
        (r.cited_in_text_count === 0 || r.mapping_status === 'uncited_reference') &&
        !seenUncitedRaw.has(r.raw_text)
    )
    .map((r, i) => ({
      reference_id: r.reference_id || String(r.id ?? `ref-uncited-${i}`),
      raw_text: r.raw_text,
      numeric_index: r.numeric_index,
      sub_index: r.sub_index,
      composite_label: r.composite_label,
      citation_link: r.citation_link,
    }));

  const uncitedReferences: UncitedReference[] = [
    ...verdictUncited.map((v) => ({
      reference_id: v.citation_link?.reference_id || v.citation_id,
      raw_text: v.citation_raw,
      numeric_index: v.numeric_index,
      sub_index: v.sub_index,
      composite_label: v.composite_label,
      citation_link: v.citation_link,
      features: v.features,
    })),
    ...extraUncitedFromRefs,
  ];

  // Bucket EVERY remaining verdict so ZERO entries are silently dropped (BUG-02)
  const ambiguousMappings = verdicts.filter(
    (v) => v.mapping_status === 'ambiguous_mapping'
  );
  const duplicateReferences = verdicts.filter(
    (v) => v.mapping_status === 'duplicate_reference'
  );
  const styleInconsistent = verdicts.filter(
    (v) => v.mapping_status === 'style_inconsistent'
  );
  const correctlyLinked = verdicts.filter(
    (v) => v.mapping_status === 'matched'
  );
  const otherUnresolved = verdicts.filter(
    (v) =>
      v.mapping_status !== 'matched' &&
      v.mapping_status !== 'missing_reference' &&
      v.mapping_status !== 'in_text_mismatch' &&
      v.mapping_status !== 'uncited_reference' &&
      v.mapping_status !== 'ambiguous_mapping' &&
      v.mapping_status !== 'duplicate_reference' &&
      v.mapping_status !== 'style_inconsistent'
  );

  const renderedTotal =
    citationsWithoutReference.length +
    uncitedReferences.length +
    ambiguousMappings.length +
    duplicateReferences.length +
    styleInconsistent.length +
    otherUnresolved.length +
    correctlyLinked.length;

  return {
    citationsWithoutReference,
    uncitedReferences,
    correctlyLinked,
    ambiguousMappings,
    duplicateReferences,
    styleInconsistent,
    otherUnresolved,
    total: renderedTotal,
    correctlyLinkedCount: correctlyLinked.length,
    orphanCount: citationsWithoutReference.length,
    uncitedCount: uncitedReferences.length,
    ambiguousCount: ambiguousMappings.length,
    duplicateCount: duplicateReferences.length,
    styleCount: styleInconsistent.length,
    otherUnresolvedCount: otherUnresolved.length,
  };
}

function MappingIssueCard({
  citation,
  index,
  isVi,
}: {
  citation: OrphanCitation;
  index: number;
  isVi: boolean;
}) {
  const lang: 'vi' | 'en' = isVi ? 'vi' : 'en';
  const markerLabel = getCitationMarkerLabel(citation, index);
  const displayRaw = citation.citation_raw.replace(/^\s*\[\s*\d+[a-z]?\s*\]\s*/i, '');
  const statusDisplay = getMappingStatusDisplay(citation.mapping_status, lang);

  const isAmbiguous = citation.mapping_status === 'ambiguous_mapping';
  const isDuplicate = citation.mapping_status === 'duplicate_reference';
  const isStyleOrOther =
    citation.mapping_status === 'style_inconsistent' ||
    citation.mapping_status === 'unresolved';

  const cardTheme = isAmbiguous
    ? {
        card: 'border-blue-200/90 dark:border-blue-900/70 bg-blue-50/40 dark:bg-blue-950/25 hover:bg-blue-50/80 dark:hover:bg-blue-950/45',
        iconBox: 'bg-blue-100/80 dark:bg-blue-900/50 border-blue-200/60 dark:border-blue-800/60 text-blue-600 dark:text-blue-400',
        pill: 'bg-blue-100/90 dark:bg-blue-950/80 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800',
        icon: <HelpCircle className="h-4 w-4" />,
        pillIcon: <HelpCircle className="h-3 w-3" />,
      }
    : isDuplicate
      ? {
          card: 'border-violet-200/90 dark:border-violet-900/70 bg-violet-50/40 dark:bg-violet-950/25 hover:bg-violet-50/80 dark:hover:bg-violet-950/45',
          iconBox: 'bg-violet-100/80 dark:bg-violet-900/50 border-violet-200/60 dark:border-violet-800/60 text-violet-600 dark:text-violet-400',
          pill: 'bg-violet-100/90 dark:bg-violet-950/80 text-violet-800 dark:text-violet-300 border-violet-200 dark:border-violet-800',
          icon: <Copy className="h-4 w-4" />,
          pillIcon: <Copy className="h-3 w-3" />,
        }
      : isStyleOrOther
        ? {
            card: 'border-amber-200/90 dark:border-amber-900/70 bg-amber-50/40 dark:bg-amber-950/25 hover:bg-amber-50/80 dark:hover:bg-amber-950/45',
            iconBox: 'bg-amber-100/80 dark:bg-amber-900/50 border-amber-200/60 dark:border-amber-800/60 text-amber-600 dark:text-amber-400',
            pill: 'bg-amber-100/90 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800',
            icon: <AlertTriangle className="h-4 w-4" />,
            pillIcon: <AlertTriangle className="h-3 w-3" />,
          }
        : {
            card: 'border-red-200/90 dark:border-red-900/70 bg-red-50/40 dark:bg-red-950/25 hover:bg-red-50/80 dark:hover:bg-red-950/45',
            iconBox: 'bg-red-100/80 dark:bg-red-900/50 border-red-200/60 dark:border-red-800/60 text-red-600 dark:text-red-400',
            pill: 'bg-red-100/90 dark:bg-red-950/80 text-red-800 dark:text-red-300 border-red-200 dark:border-red-800',
            icon: <Link2Off className="h-4 w-4" />,
            pillIcon: <Link2Off className="h-3 w-3" />,
          };

  return (
    <Card
      data-testid="consistency-entry-card"
      data-mapping-status={citation.mapping_status}
      className={`rounded-xl p-4 transition-colors shadow-sm ${cardTheme.card}`}
    >
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-xl border shrink-0 ${cardTheme.iconBox}`}>
          {cardTheme.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-xs font-mono font-semibold text-slate-500 dark:text-slate-400">
              {markerLabel}
            </span>
            <span
              data-testid="mapping-issue-primary-badge"
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${cardTheme.pill}`}
            >
              {cardTheme.pillIcon}
              {statusDisplay.label}
            </span>
          </div>
          <p className="text-sm font-serif text-slate-800 dark:text-slate-200 line-clamp-2 leading-relaxed break-words [overflow-wrap:anywhere]">
            {displayRaw || citation.citation_raw}
          </p>
          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
            <VerdictBadge
              verdict={isUrlResource(citation) ? 'resource' : citation.label}
              triggeredRules={citation.triggered_rules}
              size="sm"
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

function UncitedReferenceCard({
  reference,
  index,
  isVi,
}: {
  reference: UncitedReference;
  index: number;
  isVi: boolean;
}) {
  const markerLabel = getCitationMarkerLabel(reference, index);
  const displayRaw = reference.raw_text.replace(/^\s*\[\s*\d+[a-z]?\s*\]\s*/i, '');
  return (
    <Card
      data-testid="consistency-entry-card"
      data-mapping-status="uncited_reference"
      className="rounded-xl border-amber-200/90 dark:border-amber-900/70 p-4 bg-amber-50/40 dark:bg-amber-950/25 hover:bg-amber-50/80 dark:hover:bg-amber-950/45 transition-colors shadow-sm"
    >
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-xl bg-amber-100/80 dark:bg-amber-900/50 border border-amber-200/60 dark:border-amber-800/60 shrink-0">
          <FileText className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-mono font-semibold text-slate-500 dark:text-slate-400">
              {markerLabel}
            </span>
            <Badge
              variant="metadata_error"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-medium"
            >
              <Link2Off className="h-3 w-3" />
              {isVi ? 'Chưa trích dẫn' : 'Uncited'}
            </Badge>
          </div>
          <p className="text-sm font-serif text-slate-800 dark:text-slate-200 line-clamp-2 leading-relaxed break-words [overflow-wrap:anywhere]">
            {displayRaw || reference.raw_text}
          </p>
        </div>
      </div>
    </Card>
  );
}

function SectionHeader({
  indexCode,
  title,
  icon,
  count,
  color,
  description,
}: {
  indexCode: string;
  title: string;
  icon: React.ReactNode;
  count: number;
  color: 'red' | 'amber' | 'green' | 'blue';
  description: string;
}) {
  const colorClasses = {
    red: {
      badge: 'bg-red-50 dark:bg-red-950/80 text-red-600 dark:text-red-400',
      icon: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/60 border-red-200/70 dark:border-red-800/70',
      text: 'text-red-600 dark:text-red-400',
      count: 'text-red-600 dark:text-red-400',
    },
    amber: {
      badge: 'bg-amber-50 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400',
      icon: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 border-amber-200/70 dark:border-amber-800/70',
      text: 'text-amber-600 dark:text-amber-400',
      count: 'text-amber-600 dark:text-amber-400',
    },
    green: {
      badge: 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400',
      icon: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200/70 dark:border-emerald-800/70',
      text: 'text-emerald-600 dark:text-emerald-400',
      count: 'text-emerald-600 dark:text-emerald-400',
    },
    blue: {
      badge: 'bg-blue-50 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400',
      icon: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 border-blue-200/70 dark:border-blue-800/70',
      text: 'text-blue-600 dark:text-blue-400',
      count: 'text-blue-600 dark:text-blue-400',
    },
  };

  const c = colorClasses[color];

  return (
    <Card className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className={`p-2.5 rounded-xl border ${c.icon}`}>
          {icon}
        </div>
        <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${c.badge}`}>
          {indexCode}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h3 className={`text-sm font-semibold ${c.text}`}>{title}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{description}</p>
        </div>
        <div className={`text-3xl font-bold font-mono tabular-nums shrink-0 ${c.count}`}>
          {count}
        </div>
      </div>
    </Card>
  );
}

export function OrphanConsistencyWorkspace({
  report,
  embedded = false,
  onSelectVerdictInCitations,
}: {
  report: AnalysisReport;
  embedded?: boolean;
  onSelectVerdictInCitations?: (citationId: string) => void;
}) {
  const { i18n } = useTranslation();
  const isVi = Boolean(i18n.language?.startsWith('vi'));
  const [activeTab, setActiveTab] = useState<
    'all' | 'orphans' | 'uncited' | 'ambiguous' | 'duplicates' | 'style' | 'other'
  >('all');

  const stats = useMemo(
    () => getOrphanStats(report.verdicts, report.references, report.extracted_citations),
    [report],
  );

  const hasIssues =
    stats.orphanCount > 0 ||
    stats.uncitedCount > 0 ||
    stats.ambiguousCount > 0 ||
    stats.duplicateCount > 0 ||
    stats.styleCount > 0 ||
    stats.otherUnresolvedCount > 0;

  const filterTabs = [
    { id: 'all' as const, label: isVi ? 'Tất cả' : 'All', count: stats.total, idx: 0 },
    { id: 'orphans' as const, label: isVi ? 'Thiếu tham khảo' : 'Orphans', count: stats.orphanCount, idx: 1 },
    { id: 'uncited' as const, label: isVi ? 'Chưa trích dẫn' : 'Uncited', count: stats.uncitedCount, idx: 2 },
    { id: 'ambiguous' as const, label: isVi ? 'Mơ hồ' : 'Ambiguous', count: stats.ambiguousCount, idx: 3 },
    ...(stats.duplicateCount > 0
      ? [{ id: 'duplicates' as const, label: isVi ? 'Trùng lặp' : 'Duplicates', count: stats.duplicateCount, idx: 4 }]
      : []),
    ...(stats.styleCount > 0
      ? [{ id: 'style' as const, label: isVi ? 'Sai quy cách' : 'Style Issues', count: stats.styleCount, idx: 5 }]
      : []),
    ...(stats.otherUnresolvedCount > 0
      ? [{ id: 'other' as const, label: isVi ? 'Khác' : 'Other', count: stats.otherUnresolvedCount, idx: 6 }]
      : []),
  ];
  const { containerRef: filterPillRef, pillStyle: filterPill } =
    useSlidingPill<HTMLDivElement>(`${activeTab}-${i18n.language}-${filterTabs.length}`);
  const activeStageIdx = filterTabs.find((t) => t.id === activeTab)?.idx ?? 0;

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-6'}>
      {/* Summary stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SectionHeader
          indexCode="01"
          title={isVi ? 'Liên kết chính xác' : 'Correctly Linked'}
          icon={<CheckCircle className="h-5 w-5" />}
          count={stats.correctlyLinkedCount}
          color="green"
          description={
            isVi
              ? 'Trích dẫn khớp với tài liệu tham khảo'
              : 'Citations with matching references'
          }
        />
        <SectionHeader
          indexCode="02"
          title={isVi ? 'Trích dẫn thiếu tham khảo' : 'Citations Without Reference'}
          icon={<Link2Off className="h-5 w-5" />}
          count={stats.orphanCount}
          color="red"
          description={
            isVi
              ? 'Trích dẫn trong bài chưa có mục tham khảo'
              : 'In-text citations without bibliography entry'
          }
        />
        <SectionHeader
          indexCode="03"
          title={isVi ? 'Tham khảo chưa trích dẫn' : 'Uncited References'}
          icon={<FileText className="h-5 w-5" />}
          count={stats.uncitedCount}
          color="amber"
          description={
            isVi
              ? 'Mục tham khảo không được trích dẫn trong bài'
              : 'Bibliography entries never cited in document'
          }
        />
      </div>

      {/* Consistency Container */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
            <GitCompare className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <span>
              {isVi
                ? `Kiểm tra khớp nối hai chiều · ${stats.total} mục đã phân tích`
                : `Two-way citation check · ${stats.total} entries analyzed`}
            </span>
          </div>

          <div
            ref={filterPillRef}
            className="t-tabs relative flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 overflow-x-auto scrollbar-none max-w-full"
          >
            <span
              aria-hidden="true"
              style={{
                width: `${filterPill.width}px`,
                height: `${filterPill.height}px`,
                transform: `translate3d(${filterPill.left}px, ${filterPill.top}px, 0)`,
                opacity: filterPill.ready ? 1 : 0,
                transition: filterPill.animate ? undefined : 'none',
              }}
              className="t-tabs-pill rounded-lg bg-white dark:bg-slate-900 shadow-sm"
            />
            {filterTabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  data-pill-active={isActive ? 'true' : 'false'}
                  onClick={() => setActiveTab(tab.id)}
                  className={`t-tab px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 whitespace-nowrap cursor-pointer ${
                    isActive
                      ? filterPill.ready
                        ? 'text-slate-900 dark:text-white'
                        : 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {tab.label}
                  {tab.count > 0 && (
                    <span
                      className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                        isActive
                          ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                          : 'bg-slate-200/80 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6">
          <DirectionalStageSlide stageKey={activeStageIdx} distancePx={12}>
            {(activeTab === 'all' &&
              (hasIssues || stats.correctlyLinked.length > 0)) ||
            (activeTab === 'orphans' && stats.citationsWithoutReference.length > 0) ||
            (activeTab === 'uncited' && stats.uncitedReferences.length > 0) ||
            (activeTab === 'ambiguous' && stats.ambiguousMappings.length > 0) ||
            (activeTab === 'duplicates' && stats.duplicateReferences.length > 0) ||
            (activeTab === 'style' && stats.styleInconsistent.length > 0) ||
            (activeTab === 'other' && stats.otherUnresolved.length > 0) ? (
              <div className="space-y-8">
                {(activeTab === 'all' || activeTab === 'orphans') &&
                  stats.citationsWithoutReference.length > 0 && (
                    <div>
                      <h2 className="font-sans text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 mb-1.5 flex items-center gap-2">
                        <Link2Off className="h-5 w-5 text-red-600 dark:text-red-400" />
                        {isVi
                          ? 'Trích dẫn thiếu mục tham khảo'
                          : 'Citations Without Reference'}
                      </h2>
                      <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mb-4">
                        {isVi
                          ? 'Các trích dẫn này xuất hiện trong nội dung bài viết nhưng không tìm thấy mục tương ứng trong danh mục tài liệu tham khảo.'
                          : 'These citations appear in the document but no matching entry was found in the bibliography.'}
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                        {stats.citationsWithoutReference.map((citation, index) => (
                          <div
                            key={citation.citation_id}
                            onClick={
                              onSelectVerdictInCitations &&
                              report.verdicts.some((v) => v.citation_id === citation.citation_id)
                                ? () => onSelectVerdictInCitations(citation.citation_id)
                                : undefined
                            }
                            className={
                              onSelectVerdictInCitations &&
                              report.verdicts.some((v) => v.citation_id === citation.citation_id)
                                ? 'cursor-pointer'
                                : undefined
                            }
                          >
                            <MappingIssueCard
                              citation={citation}
                              index={index}
                              isVi={isVi}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                {(activeTab === 'all' || activeTab === 'uncited') &&
                  stats.uncitedReferences.length > 0 && (
                    <div>
                      <h2 className="font-sans text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 mb-1.5 flex items-center gap-2">
                        <FileText className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                        {isVi
                          ? 'Tài liệu tham khảo chưa được trích dẫn'
                          : 'References Never Cited'}
                      </h2>
                      <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mb-4">
                        {isVi
                          ? 'Các tài liệu này nằm trong danh mục tham khảo cuối bài nhưng chưa được trích dẫn trong nội dung văn bản.'
                          : 'These references exist in the bibliography but are never cited in the document.'}
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                        {stats.uncitedReferences.map((reference, index) => (
                          <UncitedReferenceCard
                            key={reference.reference_id}
                            reference={reference}
                            index={index}
                            isVi={isVi}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                {(activeTab === 'all' || activeTab === 'ambiguous') &&
                  stats.ambiguousMappings.length > 0 && (
                    <div>
                      <h2 className="font-sans text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 mb-1.5 flex items-center gap-2">
                        <HelpCircle className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                        {isVi ? 'Liên kết mơ hồ' : 'Ambiguous Mappings'}
                      </h2>
                      <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mb-4">
                        {isVi
                          ? 'Các trích dẫn này khớp với nhiều hơn một mục tài liệu tham khảo.'
                          : 'These citations have multiple possible reference matches.'}
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                        {stats.ambiguousMappings.map((citation, index) => (
                          <div
                            key={citation.citation_id}
                            onClick={
                              onSelectVerdictInCitations
                                ? () => onSelectVerdictInCitations(citation.citation_id)
                                : undefined
                            }
                            className={onSelectVerdictInCitations ? 'cursor-pointer' : undefined}
                          >
                            <MappingIssueCard
                              citation={citation}
                              index={index}
                              isVi={isVi}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                {(activeTab === 'all' || activeTab === 'duplicates') &&
                  stats.duplicateReferences.length > 0 && (
                    <div>
                      <h2 className="font-sans text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 mb-1.5 flex items-center gap-2">
                        <Copy className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                        {isVi ? 'Mục tham khảo trùng lặp' : 'Duplicate References'}
                      </h2>
                      <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mb-4">
                        {isVi
                          ? 'Các mục tài liệu tham khảo này xuất hiện trùng lặp trong danh mục cuối bài.'
                          : 'These bibliography entries appear more than once in the reference list.'}
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                        {stats.duplicateReferences.map((citation, index) => (
                          <div
                            key={citation.citation_id}
                            onClick={
                              onSelectVerdictInCitations
                                ? () => onSelectVerdictInCitations(citation.citation_id)
                                : undefined
                            }
                            className={onSelectVerdictInCitations ? 'cursor-pointer' : undefined}
                          >
                            <MappingIssueCard
                              citation={citation}
                              index={index}
                              isVi={isVi}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                {(activeTab === 'all' || activeTab === 'style') &&
                  stats.styleInconsistent.length > 0 && (
                    <div>
                      <h2 className="font-sans text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 mb-1.5 flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                        {isVi ? 'Sai quy cách trích dẫn' : 'Citation Style Inconsistencies'}
                      </h2>
                      <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mb-4">
                        {isVi
                          ? 'Định dạng các trích dẫn này chưa đồng nhất với chuẩn trích dẫn chung của tài liệu.'
                          : 'These citations do not match the dominant citation style used across the manuscript.'}
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                        {stats.styleInconsistent.map((citation, index) => (
                          <div
                            key={citation.citation_id}
                            onClick={
                              onSelectVerdictInCitations
                                ? () => onSelectVerdictInCitations(citation.citation_id)
                                : undefined
                            }
                            className={onSelectVerdictInCitations ? 'cursor-pointer' : undefined}
                          >
                            <MappingIssueCard
                              citation={citation}
                              index={index}
                              isVi={isVi}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                {(activeTab === 'all' || activeTab === 'other') &&
                  stats.otherUnresolved.length > 0 && (
                    <div>
                      <h2 className="font-sans text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 mb-1.5 flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-slate-500" />
                        {isVi ? 'Liên kết chưa xác định' : 'Other Unresolved Mappings'}
                      </h2>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                        {stats.otherUnresolved.map((citation, index) => (
                          <div
                            key={citation.citation_id}
                            onClick={
                              onSelectVerdictInCitations
                                ? () => onSelectVerdictInCitations(citation.citation_id)
                                : undefined
                            }
                            className={onSelectVerdictInCitations ? 'cursor-pointer' : undefined}
                          >
                            <MappingIssueCard
                              citation={citation}
                              index={index}
                              isVi={isVi}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                {activeTab === 'all' && stats.correctlyLinked.length > 0 && (
                  <div>
                    <h2 className="font-sans text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 mb-1.5 flex items-center gap-2">
                      <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                      {isVi
                        ? 'Trích dẫn liên kết chính xác hai chiều'
                        : 'Correctly Linked Citations'}
                    </h2>
                    <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mb-4">
                      {isVi
                        ? 'Các mục tài liệu tham khảo này đã được liên kết khớp hoàn toàn với trích dẫn trong bài viết.'
                        : 'These bibliography entries are properly linked to in-text citations in the manuscript.'}
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                      {stats.correctlyLinked.map((v, index) => {
                        const markerLabel = getCitationMarkerLabel(v, index);
                        const displayRaw = v.citation_raw.replace(
                          /^\s*\[\s*\d+[a-z]?\s*\]\s*/i,
                          '',
                        );
                        return (
                          <Card
                            key={v.citation_id}
                            data-testid="consistency-entry-card"
                            data-mapping-status={v.mapping_status}
                            onClick={
                              onSelectVerdictInCitations
                                ? () => onSelectVerdictInCitations(v.citation_id)
                                : undefined
                            }
                            className={`rounded-xl border-emerald-200/80 dark:border-emerald-900/60 p-4 bg-emerald-50/30 dark:bg-emerald-950/20 transition-colors shadow-sm ${
                              onSelectVerdictInCitations
                                ? 'cursor-pointer hover:border-emerald-400'
                                : ''
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <div className="p-2 rounded-xl bg-emerald-100/80 dark:bg-emerald-900/50 border border-emerald-200/60 dark:border-emerald-800/70 shrink-0">
                                <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                  <span className="text-xs font-mono font-semibold text-slate-500 dark:text-slate-400">
                                    {markerLabel}
                                  </span>
                                  <VerdictBadge
                                    verdict={isUrlResource(v) ? 'resource' : v.label}
                                    triggeredRules={v.triggered_rules}
                                    size="sm"
                                  />
                                  <MappingStatusBadge
                                    status={v.mapping_status}
                                    size="sm"
                                  />
                                </div>
                                <p className="text-sm font-serif text-slate-800 dark:text-slate-200 line-clamp-2 leading-relaxed break-words [overflow-wrap:anywhere]">
                                  {displayRaw || v.citation_raw}
                                </p>
                              </div>
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-12 text-center">
                <div className="flex justify-center mb-4">
                  <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-800/70 flex items-center justify-center">
                    <CheckCircle className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                  </div>
                </div>
                <h3 className="font-sans text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
                  {isVi ? 'Không có vấn đề nhất quán' : 'No Consistency Issues'}
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                  {isVi
                    ? 'Tất cả trích dẫn trong bài đều khớp với danh mục tài liệu tham khảo và không có mục thừa.'
                    : 'All citations are correctly linked to references and all references are cited in the document.'}
                </p>
              </div>
            )}
          </DirectionalStageSlide>
        </div>
      </div>

      {!embedded && (
        <Card className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm">
          <h3 className="font-display text-sm font-semibold mb-4 text-slate-900 dark:text-slate-100">
            {isVi
              ? 'Tổng quan Nhất quán Trích dẫn'
              : 'Citation Consistency Summary'}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="flex items-center gap-3 p-3.5 bg-slate-50/70 dark:bg-slate-800/40 rounded-xl border border-emerald-200/80 dark:border-emerald-900/70">
              <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div>
                <p className="text-xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                  {stats.correctlyLinkedCount}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {isVi ? 'Liên kết chính xác' : 'Correctly linked'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3.5 bg-slate-50/70 dark:bg-slate-800/40 rounded-xl border border-red-200/80 dark:border-red-900/70">
              <Link2Off className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0" />
              <div>
                <p className="text-xl font-bold font-mono tabular-nums text-red-600 dark:text-red-400">
                  {stats.orphanCount}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {isVi ? 'Thiếu tham khảo' : 'Without reference'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3.5 bg-slate-50/70 dark:bg-slate-800/40 rounded-xl border border-amber-200/80 dark:border-amber-900/70">
              <FileText className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
              <div>
                <p className="text-xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
                  {stats.uncitedCount}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {isVi ? 'Chưa trích dẫn' : 'Uncited'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3.5 bg-slate-50/70 dark:bg-slate-800/40 rounded-xl border border-blue-200/80 dark:border-blue-900/70">
              <HelpCircle className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0" />
              <div>
                <p className="text-xl font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400">
                  {stats.ambiguousCount + stats.duplicateCount + stats.styleCount + stats.otherUnresolvedCount}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {isVi ? 'Mơ hồ / Quy cách / Trùng' : 'Ambiguous / Style / Dup'}
                </p>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

/**
 * @internal Retained for standalone `OrphanDetectionPage` unit test coverage;
 * production route `/verification/report/:id/consistency` renders `EssayPage` + `OrphanConsistencyWorkspace`.
 */
export function OrphanDetectionPage() {
  const { id } = useParams<{ id: string }>();
  const { i18n } = useTranslation();
  const isVi = Boolean(i18n.language?.startsWith('vi'));
  const lang: 'vi' | 'en' = isVi ? 'vi' : 'en';
  const numericId = id ? parseInt(id, 10) : null;
  const essayId =
    numericId !== null && !isNaN(numericId) && numericId > 0 ? numericId : null;
  const { data: report, error } = useOrphanReport(essayId);

  const errorMessage =
    essayId === null
      ? isVi
        ? 'Mã báo cáo không hợp lệ.'
        : 'Invalid essay ID.'
      : error
        ? formatUserError(error, lang)
        : null;

  if (errorMessage) {
    return (
      <div
        data-testid="consistency-error-card"
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 shadow-sm max-w-2xl mx-auto my-8"
      >
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-2xl bg-amber-50 dark:bg-amber-950/70 border border-amber-200 dark:border-amber-800 flex items-center justify-center shrink-0">
            <AlertCircle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="space-y-3 flex-1 min-w-0">
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
              {isVi ? 'Không thể tải kiểm tra nhất quán' : 'Unable to Load Consistency Check'}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed break-words">
              {errorMessage}
            </p>
            <div className="pt-1">
              <Link
                to="/history"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                {isVi ? 'Về lịch sử báo cáo' : 'Back to History'}
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 text-indigo-600 dark:text-indigo-400 animate-spin" />
        <span className="ml-3 text-slate-600 dark:text-slate-400 font-mono text-sm">
          {isVi ? 'Đang tải dữ liệu trích dẫn...' : 'Loading citation data...'}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-10">
      {/* Shared Report Header */}
      <EssayHeader
        essayId={report.essay_id}
        filename={report.filename}
        numPages={report.num_pages}
        numCitations={report.num_citations}
        numReferences={report.verdicts.length}
        styleName={report.style_profile?.style}
      />

      {/* Shared Multi-Tab Diagnostic Navigation + Compact CIS Score (BUG-19) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <EssayActionBar essayId={id ?? ''} filename={report.filename} />
        <div className="flex flex-wrap items-center gap-2.5 text-xs font-mono text-slate-500 dark:text-slate-400">
          {report.cis && (
            <span
              data-testid="consistency-cis-pill"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/80 font-semibold"
            >
              <span>CIS:</span>
              <span>
                {report.cis.is_unscannable
                  ? isVi
                    ? 'N/A · Không thể quét'
                    : 'N/A · Not Scannable'
                  : `${Number(report.cis.score ?? 0).toFixed(1)} / 100`}
              </span>
            </span>
          )}
          <div className="flex items-center gap-2">
            <GitCompare className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <span>
              {isVi
                ? `Nhất quán Trích dẫn · ${report.verdicts.length} mục đã phân tích`
                : `Citation Consistency · ${report.verdicts.length} entries analyzed`}
            </span>
          </div>
        </div>
      </div>

      {/* Non-Accusatory Academic Decision-Support Disclaimer (BUG-03) */}
      <DecisionSupportBanner variant="compact" lang={lang} />

      <OrphanConsistencyWorkspace report={report} embedded={false} />
    </div>
  );
}
