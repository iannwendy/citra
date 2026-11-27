import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type {
  ValidationLabel,
  CitationMappingStatus,
  Verdict,
  OverrideRequest,
} from '@/api/client';
import {
  formatLocalizedDateTime,
  formatUserError,
  getVerdictDisplay,
  resolveAcademicLang,
  type AcademicLang,
} from '@/lib/academicTaxonomy';
import { DecisionSupportBanner } from '@/components/DecisionSupportBanner';
import { cn } from '@/lib/utils';
import { ChevronDown, RefreshCw, X } from 'lucide-react';
import { useRole } from '@/hooks/useRole';
import { useModalA11y } from '@/hooks/useModalA11y';
import { useToast } from '@/contexts/ToastContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

const MIN_OVERRIDE_REASON_LENGTH = 5;

const LABEL_OPTIONS: { value: ValidationLabel; symbol: string; color: string }[] = [
  { value: 'verified', symbol: '✓', color: 'text-emerald-700 dark:text-emerald-400' },
  { value: 'metadata_error', symbol: '△', color: 'text-amber-800 dark:text-amber-300' },
  { value: 'suspected_hallucination', symbol: '✗', color: 'text-red-700 dark:text-red-400' },
  { value: 'unresolved', symbol: '—', color: 'text-slate-700 dark:text-slate-300' },
  { value: 'resource', symbol: '↗', color: 'text-violet-700 dark:text-violet-400' },
];

/**
 * Lecturer-facing explanations for each canonical source verification status
 * (written strictly for instructors evaluating a student submission).
 */
const LECTURER_VERDICT_DESCRIPTIONS: Record<
  ValidationLabel,
  Record<AcademicLang, string>
> = {
  verified: {
    vi: 'Xác nhận trích dẫn này có nguồn gốc hợp lệ sau khi đối chiếu.',
    en: 'Confirm that this citation refers to a valid source after verification.',
  },
  metadata_error: {
    vi: 'Xác nhận tài liệu gốc có thật nhưng bài nộp ghi sai một số chi tiết (tác giả, năm, tiêu đề hoặc mã DOI).',
    en: 'Confirm that the source exists, but the submission has inaccurate citation details (author, year, title, or DOI).',
  },
  suspected_hallucination: {
    vi: 'Ghi nhận chưa tìm thấy nguồn gốc tương ứng; giữ cảnh báo để sinh viên kiểm tra lại bản gốc hoặc thay thế tài liệu.',
    en: 'Record that no matching publication was found; keep the alert so the student checks the original source or replaces it.',
  },
  unresolved: {
    vi: 'Ghi nhận chưa đủ dữ liệu trực tuyến để kết luận (ví dụ sách in, giáo trình hoặc tài liệu nội bộ).',
    en: 'Record that online records are insufficient to confirm (e.g., print books, textbooks, or internal documents).',
  },
  resource: {
    vi: 'Xác nhận đây là trang web, báo cáo hoặc văn bản quy định chung thay vì bài báo học thuật (không bị tính điểm trừ).',
    en: 'Confirm this is a web page, report, or official regulation rather than a journal article (not penalized).',
  },
};

const STATUS_OPTIONS: CitationMappingStatus[] = [
  'matched',
  'missing_reference',
  'uncited_reference',
  'in_text_mismatch',
  'duplicate_reference',
  'ambiguous_mapping',
  'style_inconsistent',
  'unresolved',
];

/**
 * Non-colliding in-text link status labels and neutral third-person descriptions
 * tailored for lecturers (avoids colliding with Section 1 labels and never
 * addresses the lecturer as the essay author).
 */
const LECTURER_MAPPING_SPECS: Record<
  CitationMappingStatus,
  Record<AcademicLang, { label: string; description: string }>
> = {
  matched: {
    vi: {
      label: 'Khớp trong bài & danh mục',
      description:
        'Trích dẫn trong nội dung bài khớp chính xác với mục tương ứng ở danh mục Tài liệu tham khảo cuối bài.',
    },
    en: {
      label: 'Matched in Text & List',
      description:
        'The in-text citation cleanly matches its corresponding entry in the bibliography.',
    },
  },
  missing_reference: {
    vi: {
      label: 'Thiếu trong danh mục',
      description:
        'Có trích dẫn trong nội dung bài nhưng chưa được liệt kê ở danh mục Tài liệu tham khảo cuối bài.',
    },
    en: {
      label: 'Missing from Bibliography',
      description:
        'Cited in the text of the submission, but missing from the bibliography at the end.',
    },
  },
  uncited_reference: {
    vi: {
      label: 'Chưa trích trong nội dung',
      description:
        'Có tên trong danh mục Tài liệu tham khảo cuối bài nhưng chưa được trích dẫn ở đoạn văn nào trong bài.',
    },
    en: {
      label: 'Listed but Not Cited',
      description:
        'Appears in the bibliography, but is never referenced in the body of the submission.',
    },
  },
  in_text_mismatch: {
    vi: {
      label: 'Lệch tên/năm với danh mục',
      description:
        'Tên tác giả hoặc năm xuất bản ghi trong câu văn chưa khớp với mục tương ứng ở danh mục cuối bài.',
    },
    en: {
      label: 'In-Text vs. List Differs',
      description:
        'The author spelling or publication year in the text differs from the matching bibliography entry.',
    },
  },
  duplicate_reference: {
    vi: {
      label: 'Trùng lặp',
      description:
        'Tài liệu này đang được liệt kê lặp lại nhiều hơn một lần trong danh mục Tài liệu tham khảo.',
    },
    en: {
      label: 'Duplicate Entry',
      description:
        'This work is listed more than once in the submission’s reference list.',
    },
  },
  ambiguous_mapping: {
    vi: {
      label: 'Trùng tác giả & năm',
      description:
        'Trích dẫn trong bài có thể trỏ tới nhiều tài liệu cùng tác giả và năm xuất bản (thiếu ký hiệu a, b).',
    },
    en: {
      label: 'Same Author & Year',
      description:
        'This in-text citation could match multiple bibliography entries with the same author and year (missing a/b suffix).',
    },
  },
  style_inconsistent: {
    vi: {
      label: 'Định dạng chưa chuẩn',
      description:
        'Cách trình bày trích dẫn không đồng nhất với chuẩn chung của bài (ví dụ trộn lẫn kiểu số [1] và tên–năm).',
    },
    en: {
      label: 'Mixed Citation Style',
      description:
        'Formatting differs from the rest of the paper (e.g., mixing numbered and author–year styles).',
    },
  },
  unresolved: {
    vi: {
      label: 'Chưa rõ liên kết',
      description:
        'Chưa thể tự động đối chiếu trích dẫn này giữa nội dung bài viết và danh mục Tài liệu tham khảo.',
    },
    en: {
      label: 'Link Unclear',
      description:
        'Could not automatically pair this citation between the text and the reference list.',
    },
  },
};

function getLecturerMappingSpec(
  status: CitationMappingStatus,
  lang: AcademicLang,
): { label: string; description: string } {
  const spec = LECTURER_MAPPING_SPECS[status] ?? LECTURER_MAPPING_SPECS.unresolved;
  return spec[lang];
}

function OverrideForm({
  verdict,
  onClose,
  onSubmit,
}: {
  verdict: Verdict;
  onClose: () => void;
  onSubmit: (req: OverrideRequest) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const lang = resolveAcademicLang(i18n.resolvedLanguage || i18n.language);
  const isVi = lang === 'vi';
  const toast = useToast();
  const [label, setLabel] = useState<ValidationLabel>(verdict.label);
  const [status, setStatus] = useState<CitationMappingStatus>(verdict.mapping_status);
  const [showMappingSection, setShowMappingSection] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const { dialogProps, titleId } = useModalA11y<HTMLFormElement>(true, onClose, {
    disableEscape: submitting,
  });

  const trimmedReason = reason.trim();
  const hasValidReason = trimmedReason.length >= MIN_OVERRIDE_REASON_LENGTH;
  const hasChanges = label !== verdict.label || status !== verdict.mapping_status;
  const canSubmit = !submitting && hasValidReason;
  const selectedVerdictDisplay = getVerdictDisplay(label, lang);
  const selectedVerdictDesc = LECTURER_VERDICT_DESCRIPTIONS[label][lang];
  const selectedMapping = getLecturerMappingSpec(status, lang);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({
        verdict_id: verdict.citation_id,
        new_label: label,
        new_mapping_status: status,
        reason: trimmedReason,
      });
      toast.success(
        isVi
          ? 'Đã lưu kết quả đánh giá vào lịch sử duyệt trích dẫn.'
          : 'Review result saved to the citation review log.',
      );
      setDone(true);
      setTimeout(onClose, 500);
    } catch (err) {
      toast.error(
        formatUserError(
          err,
          lang,
          isVi
            ? 'Không thể lưu kết quả đánh giá. Vui lòng thử lại.'
            : 'Could not save the review result. Please try again.',
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 !mt-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <form
        {...dialogProps}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="bg-background rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl w-full max-w-lg max-h-[90dvh] overflow-y-auto p-4 sm:p-6 space-y-4 outline-none"
      >
        <div className="flex items-center justify-between gap-3">
          <h3 id={titleId} className="text-base font-bold flex items-center gap-2 text-slate-900 dark:text-white">
            <RefreshCw className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <span>
              {isVi ? 'Cập nhật kết quả kiểm tra' : 'Update Review Result'}
            </span>
          </h3>
          <button
            type="button"
            data-testid="override-close-btn"
            onClick={onClose}
            disabled={submitting}
            aria-label={t('teacher.closeModal', isVi ? 'Đóng' : 'Close')}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <DecisionSupportBanner variant="compact" lang={lang} />

        {/* Section 1: Source verification status (5 canonical options) */}
        <div>
          <Label className="text-sm font-medium block mb-2">
            {isVi ? 'Kết quả kiểm tra nguồn gốc' : 'Source Verification Status'}
          </Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {LABEL_OPTIONS.map((opt) => {
              const display = getVerdictDisplay(opt.value, lang);
              const isSelected = label === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={isSelected}
                  data-testid={`override-label-${opt.value}`}
                  onClick={() => setLabel(opt.value)}
                  className={cn(
                    'px-3 py-2 border rounded-lg text-sm text-left transition-colors cursor-pointer',
                    isSelected
                      ? 'border-primary bg-primary/10 font-medium ring-1 ring-primary'
                      : 'hover:bg-muted',
                  )}
                >
                  <span className={opt.color}>
                    {opt.symbol} {display.label}
                  </span>
                </button>
              );
            })}
          </div>
          <p
            data-testid="override-verdict-description"
            className="mt-2 text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/80 rounded-lg px-3 py-2 leading-relaxed"
          >
            <span className="font-semibold text-slate-800 dark:text-slate-100">
              {selectedVerdictDisplay.label}:
            </span>{' '}
            {selectedVerdictDesc}
          </p>
        </div>

        {/* Section 2: Collapsible optional in-text link status */}
        <div className="rounded-xl border border-slate-200/90 dark:border-slate-700/90 bg-slate-50/40 dark:bg-slate-900/40 overflow-hidden">
          <button
            type="button"
            data-testid="override-mapping-toggle"
            aria-expanded={showMappingSection}
            onClick={() => setShowMappingSection((prev) => !prev)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100/70 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
          >
            <span className="min-w-0">
              {isVi
                ? 'Điều chỉnh liên kết trong bài (nâng cao)'
                : 'Adjust In-Text Link Status (optional)'}
            </span>
            <span className="inline-flex items-center gap-1.5 shrink-0">
              <span className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-[11px] font-medium text-slate-600 dark:text-slate-300">
                {selectedMapping.label}
              </span>
              <ChevronDown
                className={cn(
                  'h-4 w-4 text-slate-400 transition-transform',
                  showMappingSection && 'rotate-180',
                )}
              />
            </span>
          </button>

          {showMappingSection && (
            <div className="px-3 pb-3 pt-1 border-t border-slate-200/80 dark:border-slate-700/80 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1.5">
                {STATUS_OPTIONS.map((opt) => {
                  const spec = getLecturerMappingSpec(opt, lang);
                  const isSelected = status === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      aria-pressed={isSelected}
                      data-testid={`override-status-${opt}`}
                      onClick={() => setStatus(opt)}
                      className={cn(
                        'px-2.5 py-1.5 border rounded-lg text-xs text-left transition-colors cursor-pointer bg-background',
                        isSelected
                          ? 'border-primary bg-primary/10 font-medium ring-1 ring-primary'
                          : 'hover:bg-muted',
                      )}
                    >
                      {spec.label}
                    </button>
                  );
                })}
              </div>
              <p
                data-testid="override-mapping-description"
                className="text-xs text-slate-600 dark:text-slate-300 bg-background border border-slate-200/80 dark:border-slate-700/80 rounded-lg px-3 py-2 leading-relaxed"
              >
                <span className="font-semibold text-slate-800 dark:text-slate-100">
                  {selectedMapping.label}:
                </span>{' '}
                {selectedMapping.description}
              </p>
            </div>
          )}
        </div>

        {/* Instructor review note (required >= 5 chars) */}
        <div>
          <Label htmlFor="override-reason" className="text-sm font-medium block mb-1">
            {isVi ? 'Ghi chú của giảng viên' : 'Instructor review note'}{' '}
            <span className="text-rose-500" aria-hidden="true">*</span>{' '}
            <span className="text-muted-foreground font-normal text-xs">
              {isVi ? '(bắt buộc)' : '(required)'}
            </span>
          </Label>
          <Textarea
            id="override-reason"
            data-testid="override-reason-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              isVi
                ? 'VD: Đã đối chiếu sách in tại thư viện, thông tin chính xác...'
                : 'E.g., Verified against print book or original PDF...'
            }
            rows={2}
            required
            minLength={MIN_OVERRIDE_REASON_LENGTH}
            aria-describedby="override-reason-hint"
            className="resize-none"
          />
          <p
            id="override-reason-hint"
            data-testid="override-reason-hint"
            className={cn(
              'mt-1 text-xs leading-snug',
              hasValidReason
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-slate-500 dark:text-slate-400',
            )}
          >
            {!hasValidReason
              ? isVi
                ? `Nhập tối thiểu ${MIN_OVERRIDE_REASON_LENGTH} ký tự để lưu vào lịch sử duyệt (${trimmedReason.length}/${MIN_OVERRIDE_REASON_LENGTH}).`
                : `Enter at least ${MIN_OVERRIDE_REASON_LENGTH} characters for the review history (${trimmedReason.length}/${MIN_OVERRIDE_REASON_LENGTH}).`
              : hasChanges
                ? isVi
                  ? 'Sẵn sàng lưu kết quả đánh giá vào lịch sử duyệt trích dẫn.'
                  : 'Ready to save your review result to the citation review log.'
                : isVi
                  ? 'Xác nhận giữ nguyên kết quả hiện tại kèm ghi chú của giảng viên.'
                  : 'Confirming the current result with your instructor review note.'}
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={submitting}
          >
            {t('override.cancel')}
          </Button>
          <Button
            type="submit"
            data-testid="override-submit-btn"
            disabled={!canSubmit}
          >
            {submitting
              ? t('override.saving')
              : done
                ? t('override.saved')
                : isVi
                  ? 'Lưu kết quả đánh giá'
                  : 'Save Review'}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

export function OverrideControls({
  verdict,
  onOverride,
  className,
}: {
  verdict: Verdict;
  onOverride: (req: OverrideRequest) => Promise<void>;
  className?: string;
}) {
  const { i18n } = useTranslation();
  const { has } = useRole();
  const [open, setOpen] = useState(false);

  if (!has('override_verdict')) return null;

  const lang = resolveAcademicLang(i18n.resolvedLanguage || i18n.language);
  const isVi = lang === 'vi';
  const overriddenBy =
    verdict.overridden_by || verdict.override_record?.overridden_by || null;
  const overrideNote =
    verdict.override_note || verdict.override_record?.reason || null;
  const overriddenAt =
    verdict.overridden_at || verdict.override_record?.overridden_at || null;
  const previousOverrideLabel =
    verdict.override_record?.previous_label ??
    verdict.override_record?.original_label ??
    null;
  const resolvedOverrideLabel =
    verdict.override_record?.new_label ??
    verdict.override_record?.overridden_label ??
    null;

  const attributionLabel = overriddenBy
    ? isVi
      ? `bởi ${overriddenBy}`
      : `by ${overriddenBy}`
    : null;

  const transitionSummary =
    previousOverrideLabel && resolvedOverrideLabel
      ? `${getVerdictDisplay(previousOverrideLabel, lang).label} → ${getVerdictDisplay(resolvedOverrideLabel, lang).label}`
      : null;

  const buttonLabel = verdict.is_overridden
    ? isVi
      ? 'Đã cập nhật kết quả'
      : 'Review Result Updated'
    : isVi
      ? 'Cập nhật kết quả kiểm tra'
      : 'Update Review Result';

  const tooltipText = verdict.is_overridden
    ? [
        buttonLabel,
        transitionSummary,
        attributionLabel,
        overrideNote ? `"${overrideNote}"` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : buttonLabel;

  return (
    <>
      <button
        type="button"
        data-testid="override-badge"
        onClick={() => setOpen(true)}
        className={cn(
          verdict.is_overridden
            ? 'flex items-center flex-wrap gap-1 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 px-2.5 py-1.5 rounded-lg border border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors cursor-pointer'
            : 'flex items-center gap-1 px-2.5 py-1.5 text-xs border rounded-lg hover:bg-muted transition-colors cursor-pointer',
          className,
        )}
        title={tooltipText}
        aria-label={tooltipText}
      >
        <RefreshCw className="h-3 w-3 shrink-0" />
        <span>{buttonLabel}</span>
        {verdict.is_overridden && attributionLabel && (
          <span
            data-testid="override-attribution"
            className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-800 dark:text-amber-200"
          >
            {attributionLabel}
          </span>
        )}
        {verdict.is_overridden && !attributionLabel && overrideNote && (
          <span
            data-testid="override-note-badge"
            className="max-w-[140px] truncate text-[11px] opacity-85"
          >
            · {overrideNote}
          </span>
        )}
        {verdict.is_overridden && overriddenAt && (
          <span className="text-muted-foreground ml-0.5 text-[11px]">
            · {formatLocalizedDateTime(overriddenAt, lang)}
          </span>
        )}
      </button>

      {open && (
        <OverrideForm
          verdict={verdict}
          onClose={() => setOpen(false)}
          onSubmit={async (req) => {
            await onOverride(req);
          }}
        />
      )}
    </>
  );
}
