import type { PendingVerdict, ValidationLabel } from '@/api/client';

export type ReviewSeverityKey = 'critical' | 'warning' | 'incomplete' | 'uncertain';

export interface TeacherReviewGuidance {
  severity: ReviewSeverityKey;
  headline: string;
  actionHint: string;
  confirmButtonLabel: string;
  confirmNewLabel: ValidationLabel;
}

const CLEAN_FIELD_LABELS_EN: Record<string, string> = {
  title: 'title',
  authors: 'authors',
  author: 'authors',
  year: 'publication year',
  doi: 'DOI',
  venue: 'publication venue',
  url: 'link',
  content: 'cited claim',
  retracted: 'retraction status',
  retracted_paper: 'retraction status',
};

const CLEAN_FIELD_LABELS_VI: Record<string, string> = {
  title: 'tên bài',
  authors: 'tác giả',
  author: 'tác giả',
  year: 'năm xuất bản',
  doi: 'mã DOI',
  venue: 'nơi công bố',
  url: 'đường dẫn',
  content: 'nội dung trích dẫn',
  retracted: 'trạng thái rút bài',
  retracted_paper: 'trạng thái rút bài',
};

export function formatHumanMismatchedFields(
  fields: string[] | undefined,
  lang: 'en' | 'vi',
): string {
  if (!fields || fields.length === 0) return '';
  const map = lang === 'vi' ? CLEAN_FIELD_LABELS_VI : CLEAN_FIELD_LABELS_EN;
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const raw of fields) {
    const key = raw.trim().toLowerCase();
    if (!key || key === 'retracted' || key === 'retracted_paper') continue;
    const mapped = map[key] ?? raw.replace(/_/g, ' ').trim();
    if (!seen.has(mapped)) {
      seen.add(mapped);
      labels.push(mapped);
    }
  }
  return labels.join(', ');
}

export function getTeacherReviewGuidance(
  r: PendingVerdict,
  lang: 'en' | 'vi',
): TeacherReviewGuidance {
  const rawLabel = String(r.label ?? 'unresolved').toLowerCase();
  const rules = r.triggered_rules ?? [];
  const isRetracted =
    Boolean(r.is_retracted) || rules.includes('R-RETRACTED-PAPER');
  const isIncomplete =
    rawLabel === 'metadata_error' && rules.includes('R-INCOMPLETE-METADATA');
  const isUrlMismatch = rules.includes('R-URL-CONTENT-MISMATCH');

  const keepWarningBtn = lang === 'vi' ? 'Giữ cảnh báo' : 'Keep Warning';
  const flagIssueBtn = lang === 'vi' ? 'Đánh dấu lỗi' : 'Flag Issue';

  if (isRetracted) {
    const confirmNewLabel: ValidationLabel =
      rawLabel === 'suspected_hallucination'
        ? 'suspected_hallucination'
        : 'metadata_error';
    return {
      severity: 'critical',
      headline:
        lang === 'vi'
          ? 'Bài báo này đã chính thức bị tạp chí rút bỏ'
          : 'This publication has been officially retracted',
      actionHint:
        lang === 'vi'
          ? 'Yêu cầu sinh viên thay bằng công trình học thuật còn hiệu lực.'
          : 'Ask the student to replace this retracted paper with an active source.',
      confirmButtonLabel: keepWarningBtn,
      confirmNewLabel,
    };
  }

  if (rawLabel === 'suspected_hallucination') {
    const hasDeadUrl =
      r.url_status === 'dead_link' ||
      r.url_status === 'fake_domain' ||
      rules.includes('R-DEAD-URL') ||
      rules.includes('R-FAKE-URL');
    const hasBadDoi =
      rules.includes('R-FABRICATED-DOI') ||
      rules.includes('R-NONEXISTENT-DOI') ||
      rules.includes('R-CHIMERIC-DOI-MISMATCH');

    if (hasBadDoi) {
      return {
        severity: 'critical',
        headline:
          lang === 'vi'
            ? 'Mã DOI không tồn tại hoặc trỏ sang bài báo hoàn toàn khác'
            : 'Cited DOI does not exist or points to a different paper',
        actionHint:
          lang === 'vi'
            ? 'Kiểm tra dấu hiệu ghép nối trích dẫn AI; giữ cảnh báo nếu nguồn không có thật.'
            : 'Verify whether the reference was AI-generated; keep the warning if unverified.',
        confirmButtonLabel: keepWarningBtn,
        confirmNewLabel: 'suspected_hallucination',
      };
    }

    if (hasDeadUrl) {
      return {
        severity: 'critical',
        headline:
          lang === 'vi'
            ? 'Liên kết hỏng và không tìm thấy bài báo trên kho học thuật'
            : 'Broken link with no matching scholarly publication found',
        actionHint:
          lang === 'vi'
            ? 'Kiểm tra lại đường dẫn hoặc yêu cầu sinh viên cung cấp nguồn gốc.'
            : 'Verify the link manually or ask the student for a valid source.',
        confirmButtonLabel: keepWarningBtn,
        confirmNewLabel: 'suspected_hallucination',
      };
    }

    return {
      severity: 'critical',
      headline:
        lang === 'vi'
          ? 'Không tìm thấy công trình khớp với trích dẫn này'
          : 'No matching publication found across scholarly databases',
      actionHint:
        lang === 'vi'
          ? 'Kiểm tra xem sinh viên gõ sai tên bài hay tự bịa nguồn trích dẫn.'
          : 'Check whether the student mistyped the title or cited a non-existent source.',
      confirmButtonLabel: keepWarningBtn,
      confirmNewLabel: 'suspected_hallucination',
    };
  }

  if (isIncomplete) {
    return {
      severity: 'incomplete',
      headline:
        lang === 'vi'
          ? 'Trích dẫn chưa đủ thông tin định danh học thuật'
          : 'Reference is missing essential publication details',
      actionHint:
        lang === 'vi'
          ? 'Nhắc sinh viên bổ sung đầy đủ tác giả, năm xuất bản hoặc nơi công bố.'
          : 'Remind the student to add the missing author, year, or publication venue.',
      confirmButtonLabel: keepWarningBtn,
      confirmNewLabel: 'metadata_error',
    };
  }

  if (isUrlMismatch) {
    return {
      severity: 'warning',
      headline:
        lang === 'vi'
          ? 'Đường dẫn đang mở ra một trang web khác với tên bài trích dẫn'
          : 'Cited link opens a different web page than claimed',
      actionHint:
        lang === 'vi'
          ? 'Đối chiếu tiêu đề trang thực tế bên dưới trước khi chấp nhận.'
          : 'Compare the actual web page title below before approving.',
      confirmButtonLabel: keepWarningBtn,
      confirmNewLabel: 'metadata_error',
    };
  }

  if (rawLabel === 'metadata_error') {
    const fieldText = formatHumanMismatchedFields(r.mismatched_fields, lang);
    return {
      severity: 'warning',
      headline: fieldText
        ? lang === 'vi'
          ? `Tìm thấy bài gốc nhưng lệch thông tin: ${fieldText}`
          : `Source found, but details differ in: ${fieldText}`
        : lang === 'vi'
          ? 'Tìm thấy bài gốc nhưng một số thông tin trích dẫn chưa khớp'
          : 'Source found, but cited bibliographic details differ',
      actionHint:
        lang === 'vi'
          ? 'Nếu chỉ sai chính tả nhẹ có thể chấp nhận, hoặc giữ cảnh báo để sinh viên sửa.'
          : 'Approve if it is a minor typo, or keep the warning so the student fixes it.',
      confirmButtonLabel: keepWarningBtn,
      confirmNewLabel: 'metadata_error',
    };
  }

  // 'unresolved' or legacy 'unverified' -> normalize confirm action to 'metadata_error'
  return {
    severity: 'uncertain',
    headline:
      lang === 'vi'
        ? 'Hệ thống chưa đủ dữ liệu tự động để kết luận chắc chắn'
        : 'Not enough automated evidence to confirm or refute',
    actionHint:
      lang === 'vi'
        ? 'Có thể là sách in hoặc tài liệu nội bộ — kiểm tra nhanh rồi chấp nhận hoặc đánh dấu lỗi.'
        : 'May be a print book or local thesis — verify briefly, then approve or flag.',
    confirmButtonLabel: flagIssueBtn,
    confirmNewLabel: 'metadata_error',
  };
}

export function getHumanVerdictMeta(
  rawLabel: string,
  lang: 'en' | 'vi',
): {
  label: string;
  colorHex: string;
  barClass: string;
  badgeClass: string;
} {
  const norm = (rawLabel || '').trim().toLowerCase();
  switch (norm) {
    case 'verified':
      return {
        label: lang === 'vi' ? 'Hợp lệ' : 'Verified',
        colorHex: '#10b981',
        barClass: 'bg-emerald-500',
        badgeClass:
          'bg-emerald-50 dark:bg-emerald-950/70 border-emerald-200/80 dark:border-emerald-800/80 text-emerald-700 dark:text-emerald-300',
      };
    case 'metadata_error':
      return {
        label: lang === 'vi' ? 'Sai lệch thông tin' : 'Metadata Discrepancy',
        colorHex: '#f59e0b',
        barClass: 'bg-amber-500',
        badgeClass:
          'bg-amber-50 dark:bg-amber-950/70 border-amber-200/80 dark:border-amber-800/80 text-amber-700 dark:text-amber-300',
      };
    case 'incomplete_metadata':
      return {
        label: lang === 'vi' ? 'Thiếu quy cách' : 'Incomplete Reference',
        colorHex: '#fb923c',
        barClass: 'bg-orange-400',
        badgeClass:
          'bg-orange-50 dark:bg-orange-950/70 border-orange-200/80 dark:border-orange-800/80 text-orange-700 dark:text-orange-300',
      };
    case 'suspected_hallucination':
      return {
        label: lang === 'vi' ? 'Nghi vấn ngụy tạo' : 'Suspected Fabrication',
        colorHex: '#f43f5e',
        barClass: 'bg-rose-500',
        badgeClass:
          'bg-rose-50 dark:bg-rose-950/70 border-rose-200/80 dark:border-rose-800/80 text-rose-700 dark:text-rose-300',
      };
    case 'resource':
      return {
        label: lang === 'vi' ? 'Tài nguyên Web / Pháp luật' : 'Web / Legal Resource',
        colorHex: '#0ea5e9',
        barClass: 'bg-sky-500',
        badgeClass:
          'bg-sky-50 dark:bg-sky-950/70 border-sky-200/80 dark:border-sky-800/80 text-sky-700 dark:text-sky-300',
      };
    case 'unresolved':
    case 'unverified':
    default:
      return {
        label: lang === 'vi' ? 'Chờ kiểm tra' : 'Needs Review',
        colorHex: '#64748b',
        barClass: 'bg-slate-400',
        badgeClass:
          'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300',
      };
  }
}
