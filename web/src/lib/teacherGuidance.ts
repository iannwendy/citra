import type {
  PendingVerdict,
  TriggeredRuleStat,
  ValidationLabel,
} from '@/api/client';
import { getVerdictDisplay } from '@/lib/academicTaxonomy';
import { getRuleDisplayName } from '@/lib/verdictExplanation';

export type ReviewSeverityKey = 'critical' | 'warning' | 'incomplete' | 'uncertain';

const NON_ISSUE_RULE_IDS = new Set<string>([
  'R-LOCAL_DB',
  'R-LOCAL_DB_ONLY',
  'R-LOCAL_DB_VERIFIED',
  'R-LOCAL_DB_GOOD_MATCH',
  'R-WELL-LINKED',
  'R-WELL-LINKED-MODERATE',
  'R-DOI-TITLE-AUTHOR',
  'R-CONSENSUS-FULL',
  'R-SINGLE-SOURCE-VERIFIED',
  'R-BOOK-EDITION-VERIFIED',
  'R-KNOWN-PAPER',
  'R-KNOWN-PAPER-NO-TITLE',
  'R-SEMINAL-PAPER',
  'R-CANONICAL-MATCH',
  'R-VN-LEGAL-FORMAT',
  'R-LEGAL-DOCUMENT',
  'R-VN-LEGAL-VERIFIED',
  'R-LEGAL-STATUTE-VERIFIED',
  'R-GLOBAL-DOI-RA-VERIFIED',
  'R-HF-VERIFIED',
  'R-RFC-VERIFIED',
  'R-GITHUB-VERIFIED',
  'R-PACKAGE-VERIFIED',
  'R-SOFTWARE-PACKAGE-VERIFIED',
  'R-WIKIDATA-VERIFIED',
  'R-WIKIDATA-STANDARD-VERIFIED',
  'R-OPENCITATIONS-VERIFIED',
  'R-WAYBACK-ARCHIVED',
  'R-DOMAIN-EXCEPTION',
  'R-NON-SCHOLARLY-RESOURCE',
  'R-URL-RESOURCE',
  'R-WEB-RESOURCE',
  'R-CONTENT-ALIGNMENT',
  'R-CROSS-LINGUAL-ALIGNMENT',
  'R-VN-STANDARD-VERIFIED',
  'R-VN-TEXTBOOK-VERIFIED',
  'R-TECH-STANDARD-VERIFIED',
  'R01_EXACT_DOI',
  'R01_DOI_EXACT',
  'R01_DOI_MATCH',
  'R04_AUTHOR_OVERLAP',
  'R09_SEMANTIC_ALIGN',
]);

const POSITIVE_RULE_TEXT_RE =
  /(?:^|[^a-z])(?:(?<!not\s)verified)(?=$|[^a-z])|exact\s+match|canonical\s+match|known\s+seminal|matches?\s+closely|reasonable\s+match|multiple\s+sources\s+agree|high-confidence\s+match|strong\s+match|aligns?\s+semantically|đã\s+xác\s+minh|khớp\s+chính\s+xác|khớp\s+chặt\s+chẽ|hoàn\s+toàn\s+trùng\s+khớp|kinh\s+điển|đồng\s+thuận\s+về\s+thông\s+tin\s+ấn\s+phẩm|tương\s+đồng\s+ngữ\s+nghĩa/i;

const CHIMERIC_RULE_RE = /spliced\/chimeric|chimeric|ghép\s+nối\s+trích\s+dẫn\s+ngụy\s+tạo/i;

/**
 * Defense-in-depth filter excluding positive/verified provenance rules from
 * Class Detail "Most Common Citation Issues".
 */
export function isPositiveOrNonIssueRule(ruleIdOrText: string): boolean {
  const cleaned = String(ruleIdOrText ?? '').trim();
  if (!cleaned) return true;
  const upper = cleaned.toUpperCase();
  if (NON_ISSUE_RULE_IDS.has(upper)) return true;
  if (upper.endsWith('-VERIFIED') || upper.endsWith('_VERIFIED')) return true;
  return POSITIVE_RULE_TEXT_RE.test(cleaned);
}

/**
 * Human-readable issue label for teacher cohort analytics, replacing academic
 * jargon such as "spliced/chimeric citation" with plain language.
 */
export function getTeacherIssueRuleLabel(
  ruleId: string,
  lang: 'en' | 'vi',
): string {
  const upper = String(ruleId ?? '').trim().toUpperCase();
  if (upper === 'R-CHIMERIC-DOI-MISMATCH') {
    return lang === 'vi'
      ? 'Mã DOI dẫn tới một bài báo khác (có thể ghép nhầm DOI)'
      : 'Cited DOI points to a different publication';
  }
  if (upper === 'R-HALLUCINATED-SOURCE') {
    return lang === 'vi'
      ? 'Không tìm thấy ấn phẩm khớp trên các thư viện học thuật'
      : 'No matching publication found in academic libraries';
  }
  const base = getRuleDisplayName(ruleId, lang);
  if (CHIMERIC_RULE_RE.test(base)) {
    return lang === 'vi'
      ? 'Mã DOI dẫn tới một bài báo khác (có thể ghép nhầm DOI)'
      : 'Cited DOI points to a different publication';
  }
  return base;
}

export interface TeacherIssueRuleItem extends TriggeredRuleStat {
  label: string;
}

/**
 * Filter positive/verified rules out of `top_triggered_rules` and map each
 * genuine citation issue rule to a clean, non-jargon label.
 */
export function filterTopCitationIssueRules(
  rules: TriggeredRuleStat[] | undefined,
  lang: 'en' | 'vi',
): TeacherIssueRuleItem[] {
  if (!Array.isArray(rules) || rules.length === 0) return [];
  const filtered: TeacherIssueRuleItem[] = [];
  for (const r of rules) {
    if (!r || !r.rule_id || r.count <= 0) continue;
    if (isPositiveOrNonIssueRule(r.rule_id)) continue;
    const label = getTeacherIssueRuleLabel(r.rule_id, lang);
    if (isPositiveOrNonIssueRule(label)) continue;
    filtered.push({ ...r, label });
  }
  return filtered;
}

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
            ? 'Đối chiếu lại mã DOI với bài báo gốc; giữ cảnh báo nếu thông tin không khớp.'
            : 'Verify the cited DOI against the original publication; keep the warning if it does not match.',
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
          : 'No matching publication found in academic libraries',
      actionHint:
        lang === 'vi'
          ? 'Kiểm tra xem sinh viên gõ sai tên bài hay tài liệu không có trong các thư viện học thuật đã tra cứu.'
          : 'Check whether the student mistyped the title or the document is not indexed in the checked academic libraries.',
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
  if (norm === 'incomplete_metadata') {
    return {
      label: lang === 'vi' ? 'Thiếu quy cách trích dẫn' : 'Incomplete Reference',
      colorHex: '#fb923c',
      barClass: 'bg-orange-400',
      badgeClass:
        'bg-orange-50 dark:bg-orange-950/70 border-orange-200/80 dark:border-orange-800/80 text-orange-700 dark:text-orange-300',
    };
  }

  const display = getVerdictDisplay(norm, lang);
  switch (display.key) {
    case 'verified':
      return {
        label: display.label,
        colorHex: '#10b981',
        barClass: 'bg-emerald-500',
        badgeClass:
          'bg-emerald-50 dark:bg-emerald-950/70 border-emerald-200/80 dark:border-emerald-800/80 text-emerald-700 dark:text-emerald-300',
      };
    case 'metadata_error':
      return {
        label: display.label,
        colorHex: '#f59e0b',
        barClass: 'bg-amber-500',
        badgeClass:
          'bg-amber-50 dark:bg-amber-950/70 border-amber-200/80 dark:border-amber-800/80 text-amber-700 dark:text-amber-300',
      };
    case 'suspected_hallucination':
      return {
        label: display.label,
        colorHex: '#f43f5e',
        barClass: 'bg-rose-500',
        badgeClass:
          'bg-rose-50 dark:bg-rose-950/70 border-rose-200/80 dark:border-rose-800/80 text-rose-700 dark:text-rose-300',
      };
    case 'resource':
      return {
        label: display.label,
        colorHex: '#0ea5e9',
        barClass: 'bg-sky-500',
        badgeClass:
          'bg-sky-50 dark:bg-sky-950/70 border-sky-200/80 dark:border-sky-800/80 text-sky-700 dark:text-sky-300',
      };
    case 'unresolved':
    default:
      return {
        label: display.label,
        colorHex: '#64748b',
        barClass: 'bg-slate-400',
        badgeClass:
          'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300',
      };
  }
}
