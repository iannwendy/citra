/**
 * CITRA — Unified Academic Taxonomy, Formatting & User-Error Translation
 *
 * Single source of truth for:
 * - Canonical 5-category non-accusatory academic verdicts (VI & EN)
 * - Layer-1 citation-to-bibliography mapping status labels & actionable guidance
 * - Standardized CIS score formatting (`XX.X / 100` — never `%`, `—` when unscannable)
 * - Localized date & 24h timezone-explicit datetime formatting (VI `DD/MM/YYYY`, EN `MMM D, YYYY`)
 * - Citation intent & claim stance localization
 * - Friendly backend error unwrapping & VI/EN translation (strips raw `API 4xx:` / JSON payloads)
 * - Scanned-image PDF user notices
 */

export type AcademicLang = 'vi' | 'en';

export function resolveAcademicLang(lang?: string | null): AcademicLang {
  return String(lang ?? '').toLowerCase().startsWith('vi') ? 'vi' : 'en';
}

// ============================================================================
// 1. Canonical Verdicts (Non-Accusatory Academic Taxonomy)
// ============================================================================

export type CanonicalVerdictKey =
  | 'verified'
  | 'metadata_error'
  | 'suspected_hallucination'
  | 'unresolved'
  | 'resource';

export interface VerdictDisplay {
  key: CanonicalVerdictKey;
  label: string;
  shortLabel: string;
  description: string;
  pillClass: string;
  badgeClass: string;
  dotClass: string;
}

export function normalizeVerdictKey(raw?: string | null): CanonicalVerdictKey {
  const cleaned = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  switch (cleaned) {
    case 'verified':
    case 'likely_verified':
      return 'verified';
    case 'metadata_error':
    case 'source_mismatch':
    case 'incomplete_metadata':
    case 'incomplete_reference':
    case 'meta_error':
      return 'metadata_error';
    case 'suspected_hallucination':
    case 'hallucinated':
    case 'likely_hallucinated':
    case 'suspected':
    case 'hallucination':
      return 'suspected_hallucination';
    case 'resource':
    case 'url_resource':
    case 'web_resource':
    case 'legal_resource':
    case 'legal_statute':
      return 'resource';
    case 'unresolved':
    case 'unverifiable':
    default:
      return 'unresolved';
  }
}

interface VerdictCopy {
  label: string;
  shortLabel: string;
  description: string;
}

interface VerdictSpec {
  vi: VerdictCopy;
  en: VerdictCopy;
  pillClass: string;
  badgeClass: string;
  dotClass: string;
}

const VERDICT_SPECS: Record<CanonicalVerdictKey, VerdictSpec> = {
  verified: {
    vi: {
      label: 'Đã xác minh',
      shortLabel: 'Đã xác minh',
      description:
        'Đã đối chiếu khớp với ấn phẩm thực tế về tác giả, năm xuất bản và tiêu đề.',
    },
    en: {
      label: 'Verified',
      shortLabel: 'Verified',
      description:
        'Matched with a real publication; author, year, and title are consistent.',
    },
    pillClass:
      'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800',
    badgeClass:
      'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
    dotClass: 'bg-emerald-500',
  },
  metadata_error: {
    vi: {
      label: 'Sai lệch thông tin',
      shortLabel: 'Sai lệch',
      description:
        'Tài liệu có thật nhưng tác giả, năm xuất bản, tiêu đề hoặc mã DOI chưa khớp với bản gốc; hãy kiểm tra và cập nhật lại.',
    },
    en: {
      label: 'Details Mismatch',
      shortLabel: 'Mismatch',
      description:
        'We found the source, but its author, year, title, or DOI differs—review and update the entry.',
    },
    pillClass:
      'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800',
    badgeClass:
      'bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800',
    dotClass: 'bg-amber-500',
  },
  suspected_hallucination: {
    vi: {
      label: 'Không tìm thấy nguồn',
      shortLabel: 'Không thấy nguồn',
      description:
        'Không tìm thấy tài liệu này trên các thư viện học thuật; hãy kiểm tra lại bản gốc hoặc thay thế nguồn trích dẫn.',
    },
    en: {
      label: 'Source Not Found',
      shortLabel: 'Not Found',
      description:
        'No matching publication was found in academic libraries—verify the original paper or replace this citation.',
    },
    pillClass:
      'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800',
    badgeClass:
      'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800',
    dotClass: 'bg-red-500',
  },
  unresolved: {
    vi: {
      label: 'Chưa đủ dữ liệu',
      shortLabel: 'Chưa đủ dữ liệu',
      description:
        'Có thể là sách in, giáo trình nội bộ hoặc luận văn chưa có bản trực tuyến; vui lòng đối chiếu thủ công.',
    },
    en: {
      label: 'Unverified',
      shortLabel: 'Unverified',
      description:
        'This may be a print book, thesis, or local document not indexed online—please verify manually.',
    },
    pillClass:
      'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    badgeClass:
      'bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    dotClass: 'bg-slate-500',
  },
  resource: {
    vi: {
      label: 'Nguồn Web / Văn bản',
      shortLabel: 'Nguồn Web',
      description:
        'Đây là trang web hoặc văn bản quy định chung thay vì bài báo học thuật (không bị tính điểm trừ).',
    },
    en: {
      label: 'Web / Legal Source',
      shortLabel: 'Web Source',
      description:
        'Recognized as a general web link or official regulation rather than a journal article (not penalized in your score).',
    },
    pillClass:
      'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/60 dark:text-violet-300 dark:border-violet-800',
    badgeClass:
      'bg-violet-50 text-violet-700 border border-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-800',
    dotClass: 'bg-violet-500',
  },
};

export function getVerdictDisplay(
  raw: string | null | undefined,
  lang: AcademicLang,
): VerdictDisplay {
  const key = normalizeVerdictKey(raw);
  const spec = VERDICT_SPECS[key];
  const copy = lang === 'vi' ? spec.vi : spec.en;
  return {
    key,
    label: copy.label,
    shortLabel: copy.shortLabel,
    description: copy.description,
    pillClass: spec.pillClass,
    badgeClass: spec.badgeClass,
    dotClass: spec.dotClass,
  };
}

// ============================================================================
// 2. Layer-1 Mapping Status Taxonomy
// ============================================================================

export type CanonicalMappingStatusKey =
  | 'matched'
  | 'missing_reference'
  | 'uncited_reference'
  | 'in_text_mismatch'
  | 'duplicate_reference'
  | 'ambiguous_mapping'
  | 'style_inconsistent'
  | 'unresolved'
  | 'not_applicable';

export interface MappingStatusDisplay {
  key: CanonicalMappingStatusKey;
  label: string;
  description: string;
}

export function normalizeMappingStatusKey(
  raw?: string | null,
): CanonicalMappingStatusKey {
  const cleaned = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  switch (cleaned) {
    case 'matched':
    case 'linked':
      return 'matched';
    case 'missing_reference':
    case 'missing':
    case 'missing_ref':
      return 'missing_reference';
    case 'uncited_reference':
    case 'uncited':
    case 'uncited_ref':
      return 'uncited_reference';
    case 'in_text_mismatch':
    case 'mismatch':
      return 'in_text_mismatch';
    case 'duplicate_reference':
    case 'duplicate':
      return 'duplicate_reference';
    case 'ambiguous_mapping':
    case 'ambiguous':
      return 'ambiguous_mapping';
    case 'style_inconsistent':
    case 'style':
    case 'style_issue':
      return 'style_inconsistent';
    case 'not_applicable':
    case 'n/a':
    case 'na':
      return 'not_applicable';
    case 'unresolved':
    default:
      return 'unresolved';
  }
}

const MAPPING_STATUS_SPECS: Record<
  CanonicalMappingStatusKey,
  { vi: { label: string; description: string }; en: { label: string; description: string } }
> = {
  matched: {
    vi: {
      label: 'Đã liên kết',
      description:
        'Trích dẫn trong bài đã kết nối chính xác với mục tương ứng ở cuối bài.',
    },
    en: {
      label: 'Linked',
      description:
        'In-text citation cleanly connects to its matching bibliography entry.',
    },
  },
  missing_reference: {
    vi: {
      label: 'Thiếu nguồn',
      description:
        'Đã trích dẫn trong bài viết nhưng chưa liệt kê ở danh mục Tài liệu tham khảo cuối bài; hãy bổ sung mục này vào cuối bài.',
    },
    en: {
      label: 'No Reference',
      description:
        'Cited in the essay body, but missing from your final reference list—add the full entry at the end.',
    },
  },
  uncited_reference: {
    vi: {
      label: 'Chưa trích dẫn',
      description:
        'Có tên trong danh mục tham khảo cuối bài nhưng chưa được trích dẫn ở đoạn văn nào trong bài; hãy trích dẫn trong bài hoặc lược bỏ.',
    },
    en: {
      label: 'Not Cited',
      description:
        'Appears in your bibliography, but is never cited in the essay text—cite it in-text or remove it.',
    },
  },
  in_text_mismatch: {
    vi: {
      label: 'Sai lệch',
      description:
        'Tên tác giả hoặc năm viết trong câu văn chưa khớp với mục tương ứng ở danh mục tham khảo; hãy chỉnh lại cho khớp.',
    },
    en: {
      label: 'Mismatch',
      description:
        'The author spelling or year in your sentence differs from the bibliography entry—make both match.',
    },
  },
  duplicate_reference: {
    vi: {
      label: 'Trùng lặp',
      description:
        'Tài liệu này đang bị liệt kê nhiều lần trong danh mục tham khảo; hãy gộp lại thành một mục.',
    },
    en: {
      label: 'Duplicate',
      description:
        'This work is listed more than once in your reference list—merge the duplicate entries.',
    },
  },
  ambiguous_mapping: {
    vi: {
      label: 'Mơ hồ',
      description:
        'Trích dẫn trong bài có thể chỉ tới nhiều tài liệu cùng tác giả/năm; hãy thêm ký hiệu phân biệt (như 2023a, 2023b).',
    },
    en: {
      label: 'Ambiguous',
      description:
        'This in-text citation could refer to two or more bibliography entries—add a year suffix (e.g., 2023a, 2023b) to clarify.',
    },
  },
  style_inconsistent: {
    vi: {
      label: 'Sai chuẩn',
      description:
        'Cách ghi trích dẫn này khác chuẩn chung của bài viết (ví dụ trộn lẫn kiểu số [1] và kiểu tên–năm); hãy thống nhất một chuẩn.',
    },
    en: {
      label: 'Style Issue',
      description:
        'This citation mixes formatting styles (such as APA and IEEE)—format all citations with one consistent style.',
    },
  },
  unresolved: {
    vi: {
      label: 'Chưa xác định',
      description:
        'Chưa thể tự động nối trích dẫn này với danh mục cuối bài; vui lòng kiểm tra lại thủ công.',
    },
    en: {
      label: 'Unresolved',
      description:
        'Could not automatically connect this citation to a bibliography entry—please check the pairing manually.',
    },
  },
  not_applicable: {
    vi: {
      label: 'Không áp dụng',
      description:
        'Tệp chỉ chứa danh mục tài liệu tham khảo (BibTeX/RIS) nên không áp dụng liên kết trích dẫn trong văn bản.',
    },
    en: {
      label: 'Not Applicable',
      description:
        'Bibliography-only submission — in-text cross-reference linking does not apply.',
    },
  },
};

export function getMappingStatusDisplay(
  raw: string | null | undefined,
  lang: AcademicLang,
): MappingStatusDisplay {
  const key = normalizeMappingStatusKey(raw);
  const copy = lang === 'vi' ? MAPPING_STATUS_SPECS[key].vi : MAPPING_STATUS_SPECS[key].en;
  return {
    key,
    label: copy.label,
    description: copy.description,
  };
}

// ============================================================================
// 3. CIS Score Formatting (`XX.X / 100` — NEVER `%`)
// ============================================================================

export function formatCisScore(
  score: number | null | undefined,
  opts?: { isUnscannable?: boolean; decimals?: number },
): string {
  if (opts?.isUnscannable || score == null || typeof score !== 'number' || !Number.isFinite(score)) {
    return '—';
  }
  const decimals = opts?.decimals ?? 1;
  const clamped = Math.max(0, Math.min(100, score));
  return `${clamped.toFixed(decimals)} / 100`;
}

// ============================================================================
// 4. Localized Dates & 24h Timezone-Explicit DateTimes
// ============================================================================

function parseDateSafe(value: string | Date | null | undefined): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const raw = String(value).trim();
  if (!raw) return null;

  // Date-only ISO string (YYYY-MM-DD): anchor at UTC noon to prevent off-by-one timezone shifts
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  // Naive ISO timestamp from backend without timezone designator -> treat as UTC
  const normalized =
    /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(raw)
      ? `${raw.replace(' ', 'T')}Z`
      : raw;

  const dt = new Date(normalized);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function getDateParts(
  date: Date,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Record<string, string> {
  const parts = new Intl.DateTimeFormat(locale, options).formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }
  return map;
}

function formatLocalUtcOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  if (offsetMinutes === 0) return 'UTC';
  const sign = offsetMinutes > 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return minutes === 0
    ? `UTC${sign}${hours}`
    : `UTC${sign}${hours}:${String(minutes).padStart(2, '0')}`;
}

export function formatLocalizedDate(
  value: string | Date | null | undefined,
  lang: AcademicLang,
): string {
  const date = parseDateSafe(value);
  if (!date) return '—';

  if (lang === 'vi') {
    const p = getDateParts(date, 'en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    return `${p.day}/${p.month}/${p.year}`;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function formatLocalizedDateTime(
  value: string | Date | null | undefined,
  lang: AcademicLang,
): string {
  const date = parseDateSafe(value);
  if (!date) return '—';

  if (lang === 'vi') {
    const p = getDateParts(date, 'en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const hour = p.hour === '24' ? '00' : p.hour;
    return `${p.day}/${p.month}/${p.year} · ${hour}:${p.minute} (GMT+7)`;
  }

  const p = getDateParts(date, 'en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const hour = p.hour === '24' ? '00' : p.hour;
  const tz = formatLocalUtcOffset(date);
  return `${p.month} ${p.day}, ${p.year}, ${hour}:${p.minute} (${tz})`;
}

// ============================================================================
// 5. Citation Intent & Claim Stance Labels
// ============================================================================

const INTENT_LABELS: Record<string, { vi: string; en: string }> = {
  methodology: { vi: 'Phương pháp', en: 'Methodology' },
  method: { vi: 'Phương pháp', en: 'Methodology' },
  background: { vi: 'Cơ sở lý thuyết', en: 'Background' },
  result_comparison: { vi: 'So sánh kết quả', en: 'Result Comparison' },
  results: { vi: 'So sánh kết quả', en: 'Result Comparison' },
  result: { vi: 'So sánh kết quả', en: 'Result Comparison' },
  comparison: { vi: 'So sánh kết quả', en: 'Result Comparison' },
  motivation: { vi: 'Động lực nghiên cứu', en: 'Motivation' },
  uses: { vi: 'Sử dụng công cụ / dữ liệu', en: 'Uses / Tooling' },
  tool: { vi: 'Sử dụng công cụ / dữ liệu', en: 'Uses / Tooling' },
  dataset: { vi: 'Bộ dữ liệu', en: 'Dataset' },
  extends: { vi: 'Mở rộng nghiên cứu', en: 'Extends' },
  extension: { vi: 'Mở rộng nghiên cứu', en: 'Extends' },
  future_work: { vi: 'Hướng phát triển', en: 'Future Work' },
  critique: { vi: 'Phản biện / Hạn chế', en: 'Critique' },
  limitation: { vi: 'Phản biện / Hạn chế', en: 'Limitation' },
  other: { vi: 'Tham khảo chung', en: 'General Reference' },
  general: { vi: 'Tham khảo chung', en: 'General Reference' },
};

export function formatIntentLabel(
  intent: string | null | undefined,
  lang: AcademicLang,
): string {
  const cleaned = String(intent ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!cleaned) {
    return lang === 'vi' ? 'Tham khảo chung' : 'General Reference';
  }
  const matched = Object.prototype.hasOwnProperty.call(INTENT_LABELS, cleaned)
    ? INTENT_LABELS[cleaned]
    : undefined;
  if (matched) {
    return lang === 'vi' ? matched.vi : matched.en;
  }
  if (lang === 'vi') {
    return 'Tham khảo chung';
  }
  return cleaned
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const STANCE_LABELS: Record<string, { vi: string; en: string }> = {
  supported: { vi: 'Được nguồn ủng hộ', en: 'Supported' },
  support: { vi: 'Được nguồn ủng hộ', en: 'Supported' },
  supporting: { vi: 'Được nguồn ủng hộ', en: 'Supported' },
  partially_supported: { vi: 'Ủng hộ một phần', en: 'Partially Supported' },
  partial_support: { vi: 'Ủng hộ một phần', en: 'Partially Supported' },
  partial: { vi: 'Ủng hộ một phần', en: 'Partially Supported' },
  neutral: { vi: 'Trung lập', en: 'Neutral' },
  mention: { vi: 'Trung lập', en: 'Neutral' },
  mentions: { vi: 'Trung lập', en: 'Neutral' },
  contradiction_risk: { vi: 'Nguy cơ mâu thuẫn', en: 'Contradiction Risk' },
  contradicts: { vi: 'Nguy cơ mâu thuẫn', en: 'Contradiction Risk' },
  contradicted: { vi: 'Nguy cơ mâu thuẫn', en: 'Contradiction Risk' },
  refutes: { vi: 'Nguy cơ mâu thuẫn', en: 'Contradiction Risk' },
  unverified: { vi: 'Chưa đủ dữ liệu', en: 'Unverified' },
  unknown: { vi: 'Chưa đủ dữ liệu', en: 'Unverified' },
};

export function formatStanceLabel(
  stance: string | null | undefined,
  lang: AcademicLang,
): string {
  const cleaned = String(stance ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!cleaned) {
    return lang === 'vi' ? 'Trung lập' : 'Neutral';
  }
  const matched = Object.prototype.hasOwnProperty.call(STANCE_LABELS, cleaned)
    ? STANCE_LABELS[cleaned]
    : undefined;
  if (matched) {
    return lang === 'vi' ? matched.vi : matched.en;
  }
  return lang === 'vi' ? 'Chưa đủ dữ liệu' : 'Unverified';
}

// ============================================================================
// 6. User-Friendly Error Unwrapping & VI/EN Translation
// ============================================================================

function extractRawErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || '';
  if (error && typeof error === 'object') {
    const rec = error as Record<string, unknown>;
    if (typeof rec.detail === 'string') return rec.detail;
    if (typeof rec.message === 'string') return rec.message;
    if (typeof rec.error === 'string') return rec.error;
  }
  return '';
}

function unwrapApiAndJsonEnvelope(raw: string): string {
  let text = raw.trim();
  // Strip prefixes like "API 400:", "API 401:", "HTTP 409 Conflict:", "Error:"
  text = text.replace(/^(?:(?:API|HTTP)\s+\d{3}(?:\s+[A-Za-z -]+?)?\s*:\s*)+/i, '').trim();
  text = text.replace(/^Error\s*:\s*/i, '').trim();

  // Attempt to unwrap JSON payloads such as {"detail":"..."} or {"detail":[{"msg":"..."}]}
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (typeof parsed.detail === 'string' && parsed.detail.trim()) {
        return parsed.detail.trim();
      }
      if (Array.isArray(parsed.detail) && parsed.detail.length > 0) {
        const first = parsed.detail[0] as Record<string, unknown> | string;
        if (typeof first === 'string' && first.trim()) return first.trim();
        if (first && typeof first === 'object' && typeof first.msg === 'string') {
          return first.msg.trim();
        }
      }
      if (typeof parsed.message === 'string' && parsed.message.trim()) {
        return parsed.message.trim();
      }
      if (typeof parsed.error === 'string' && parsed.error.trim()) {
        return parsed.error.trim();
      }
    } catch {
      // Not valid JSON — keep cleaned string
    }
  }
  return text;
}

interface ErrorMappingRule {
  pattern: RegExp;
  vi: string | ((match: RegExpMatchArray) => string);
  en: string | ((match: RegExpMatchArray) => string);
}

const ERROR_MAPPING_RULES: ErrorMappingRule[] = [
  {
    pattern: /(?:invalid|incorrect)\s+username\s+or\s+password/i,
    vi: 'Tên đăng nhập/email hoặc mật khẩu chưa đúng. Vui lòng kiểm tra lại.',
    en: 'Incorrect username/email or password. Please try again.',
  },
  {
    pattern: /invalid\s+activation\s+token|activation\s+(?:token|link).*(?:invalid|expired)/i,
    vi: 'Liên kết kích hoạt không hợp lệ hoặc đã hết hạn.',
    en: 'This activation link is invalid or has expired.',
  },
  {
    pattern:
      /invalid\s+password\s+reset\s+link|reset\s+(?:token|link).*(?:invalid|expired)|invalid\s+or\s+expired\s+reset/i,
    vi: 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.',
    en: 'This password reset link is invalid or has expired.',
  },
  {
    pattern: /invalid\s+share\s+token\s+format|share\s+(?:link|token)\s+(?:not\s+found|invalid|expired)/i,
    vi: 'Liên kết chia sẻ không hợp lệ hoặc đã hết hạn.',
    en: 'This share link is invalid or has expired.',
  },
  {
    pattern: /invalid\s+class\s+join\s+code/i,
    vi: 'Mã tham gia lớp không đúng. Vui lòng kiểm tra lại với giảng viên.',
    en: 'Invalid class join code. Please check with your instructor.',
  },
  {
    pattern: /promo\s+code\b.*(?:not\s+found|expired|invalid)/i,
    vi: 'Mã giảm giá không tồn tại hoặc đã hết hạn.',
    en: 'Promo code not found or expired.',
  },
  {
    pattern: /please\s+wait\s+(\d+)\s+seconds?\s+before\s+requesting\s+another\s+password\s+setup\s+email/i,
    vi: (m) => `Bạn vừa gửi yêu cầu. Vui lòng đợi ${m[1]} giây rồi thử lại.`,
    en: (m) => `You recently sent a request. Please wait ${m[1]} seconds before trying again.`,
  },
  {
    pattern: /checkout\s+session\s+not\s+found/i,
    vi: 'Không tìm thấy phiên thanh toán. Vui lòng bắt đầu lại từ trang Bảng giá.',
    en: 'Checkout session not found. Please start again from the Pricing page.',
  },
  {
    pattern: /essay\s+not\s+found/i,
    vi: 'Không tìm thấy báo cáo này. Tài liệu có thể đã bị xóa hoặc đường dẫn không đúng.',
    en: 'Report not found. This document may have been deleted or the link is no longer valid.',
  },
  {
    pattern: /access\s+denied|not\s+your\s+class|permission\s+denied|admin\s+access\s+required/i,
    vi: 'Bạn không có quyền truy cập nội dung này.',
    en: 'You do not have permission to access this content.',
  },
  {
    pattern: /failed\s+to\s+fetch|networkerror|load\s+failed|err_network/i,
    vi: 'Không thể kết nối máy chủ. Vui lòng kiểm tra mạng và thử lại.',
    en: 'Unable to reach the server. Please check your connection and try again.',
  },
  {
    pattern: /account\s+is\s+deactivated/i,
    vi: 'Tài khoản của bạn đã bị tạm khóa. Vui lòng liên hệ quản trị viên.',
    en: 'Your account has been deactivated. Please contact an administrator.',
  },
  {
    pattern: /monthly_quota_exceeded|monthly\s+quota\s+exceeded/i,
    vi: 'Bạn đã hết lượt kiểm tra trong tháng. Nâng cấp gói để tiếp tục.',
    en: 'You have reached your monthly check limit. Upgrade your plan to continue.',
  },
];

export function formatUserError(
  error: unknown,
  lang: AcademicLang,
  fallback?: string,
): string {
  const defaultFallback =
    fallback ??
    (lang === 'vi'
      ? 'Đã xảy ra lỗi. Vui lòng thử lại sau.'
      : 'Something went wrong. Please try again.');

  const raw = extractRawErrorMessage(error);
  if (!raw.trim()) return defaultFallback;

  const cleaned = unwrapApiAndJsonEnvelope(raw);
  if (!cleaned) return defaultFallback;

  for (const rule of ERROR_MAPPING_RULES) {
    const match = cleaned.match(rule.pattern);
    if (match) {
      const target = lang === 'vi' ? rule.vi : rule.en;
      return typeof target === 'function' ? target(match) : target;
    }
  }

  // Never leak unparsed JSON blobs directly to users
  if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
    return defaultFallback;
  }

  return cleaned;
}

// ============================================================================
// 7. Scanned-Image PDF Notice
// ============================================================================

export interface ScannedPdfNotice {
  title: string;
  description: string;
  badgeLabel: string;
}

export function getScannedPdfNotice(
  lang: AcademicLang,
  scannedPages?: number,
  totalPages?: number,
): ScannedPdfNotice {
  const hasCounts =
    typeof scannedPages === 'number' &&
    typeof totalPages === 'number' &&
    Number.isFinite(scannedPages) &&
    Number.isFinite(totalPages) &&
    totalPages > 0;

  if (lang === 'vi') {
    return {
      badgeLabel: 'PDF dạng ảnh quét',
      title: 'Tài liệu PDF dạng ảnh quét — không thể đọc lớp văn bản',
      description: hasCounts
        ? `Phát hiện ${scannedPages}/${totalPages} trang là ảnh quét không có lớp văn bản chọn được nên hệ thống không thể trích xuất trích dẫn. Hãy tải lên bản PDF xuất trực tiếp từ Word/LaTeX hoặc chạy OCR trước khi tải lại.`
        : 'Tệp PDF này chủ yếu là hình ảnh quét không có lớp văn bản chọn được nên hệ thống không thể trích xuất trích dẫn. Hãy tải lên tệp PDF xuất từ Word/LaTeX hoặc đã nhận dạng chữ (OCR).',
    };
  }

  return {
    badgeLabel: 'Scanned Image PDF',
    title: 'Scanned Image PDF — No Selectable Text Layer',
    description: hasCounts
      ? `${scannedPages} of ${totalPages} pages appear to be scanned images without selectable text, so citations could not be extracted. Upload a text-based PDF exported from Word/LaTeX or run OCR first.`
      : 'This PDF appears to consist of scanned images without a selectable text layer, so citations could not be extracted. Upload a text-based PDF exported from Word/LaTeX or an OCR-processed copy.',
  };
}

// ============================================================================
// 8. Citation Style Label Normalization
// ============================================================================

export function formatCitationStyleLabel(
  style: string | null | undefined,
  lang: AcademicLang = 'vi',
): string {
  const raw = String(style ?? '').trim();
  if (!raw) return '';
  const norm = raw.toUpperCase().replace(/[\s-]+/g, '_');
  switch (norm) {
    case 'UNKNOWN':
    case 'NONE':
      return '';
    case 'APA':
      return 'APA';
    case 'APA_LIKE':
      return lang === 'vi' ? 'Gần chuẩn APA' : 'APA-like';
    case 'IEEE':
      return 'IEEE';
    case 'IEEE_LIKE':
      return lang === 'vi' ? 'Gần chuẩn IEEE' : 'IEEE-like';
    case 'MIXED':
      return lang === 'vi' ? 'Hỗn hợp' : 'Mixed';
    case 'HARVARD':
      return 'Harvard';
    case 'MLA':
      return 'MLA';
    case 'CHICAGO':
      return 'Chicago';
    case 'VANCOUVER':
      return 'Vancouver';
    case 'BIBTEX':
      return 'BibTeX';
    case 'RIS':
      return 'RIS';
    case 'TDTU':
      return 'TDTU';
    default:
      return raw;
  }
}

// ============================================================================
// 9. Academic & Institutional Author Name Formatting (VI + Global)
// ============================================================================

const VI_DIACRITIC_CHAR_RE =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

const AUTHOR_SURNAME_PARTICLES = new Set([
  'de',
  'del',
  'della',
  'di',
  'da',
  'van',
  'von',
  'der',
  'den',
  'le',
  'la',
  'du',
  'st',
  'st.',
]);

const INSTITUTIONAL_VI_PHRASE_RE =
  /(?:^|[\s,.;:()[\]"'/-])(?:ban\s+chấp\s+hành|đảng\s+cộng\s+sản|quốc\s+hội|chính\s+phủ|thủ\s+tướng|chủ\s+tịch\s+nước|ủy\s+ban|uỷ\s+ban|tòa\s+án|toà\s+án|viện\s+kiểm\s+sát|trường\s+đại\s+học|đại\s+học|học\s+viện|ngân\s+hàng|tổng\s+cục|hội\s+đồng|mặt\s+trận\s+tổ\s+quốc|nhà\s+xuất\s+bản|tổ\s+chức|liên\s+hợp\s+quốc|hiệp\s+hội|trung\s+tâm|tập\s+đoàn|bộ\s+chính\s+trị|ban\s+bí\s+thư)(?=$|[\s,.;:()[\]"'/-])/i;

const INSTITUTIONAL_VI_PREFIX_RE = /^(?:bộ|viện|cục|sở|nxb|ubnd|hdnd|hđnd)\s+/i;

const INSTITUTIONAL_GLOBAL_ACRONYM_RE =
  /\b(?:WHO|UNESCO|OECD|UNICEF|UNDP|UNHCR|IMF|WTO|FAO|IEEE|ACM|ISO|IEC|IETF|W3C|NIST|OWASP|CDC|FDA|NASA|NIH)\b/;

const INSTITUTIONAL_EN_PHRASE_RE =
  /\b(?:ministry|department|commission|association|organi[sz]ation|institute|university|committee|congress|parliament|world\s+bank|united\s+nations|world\s+health|european\s+union|european\s+commission|national\s+institute|government|council|bureau|agency|foundation|society|administration|authority|corporation|academy|board\s+of|center\s+for|centre\s+for|office\s+of)\b/i;

export function isInstitutionalAuthor(name: string | null | undefined): boolean {
  const cleaned = String(name ?? '')
    .replace(/^\s*(?:\[\s*\d+[a-z]?\s*\]|\(\s*[a-z]\s*\)|\d+[a-z]?[.)])\s*/i, '')
    .trim();
  if (!cleaned) return false;
  return (
    INSTITUTIONAL_VI_PHRASE_RE.test(cleaned) ||
    INSTITUTIONAL_VI_PREFIX_RE.test(cleaned) ||
    INSTITUTIONAL_GLOBAL_ACRONYM_RE.test(cleaned) ||
    INSTITUTIONAL_EN_PHRASE_RE.test(cleaned)
  );
}

function isGarbageAuthorToken(raw: string): boolean {
  const stripped = raw
    .replace(/^\s*[[\]().,;:\-–—]+|[[\]().,;:\-–—]+\s*$/g, '')
    .trim();
  if (!stripped) return true;
  if (/^[\d\s.,;:()[\]—–-]+$/.test(stripped)) return true;
  if (/^[A-Za-zÀ-ỹ]\.?$/.test(stripped)) return true;
  if (/^(?:n\/a|none|null|undefined|unknown|—|-+)$/i.test(stripped)) return true;
  // Must contain at least two letters
  const letters = stripped.match(/[A-Za-zÀ-ỹ]/g);
  return !letters || letters.length < 2;
}

function truncateClean(text: string, maxLen: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  const slice = trimmed.slice(0, maxLen - 1);
  const lastSpace = slice.lastIndexOf(' ');
  const base = lastSpace >= Math.floor(maxLen * 0.55) ? slice.slice(0, lastSpace) : slice;
  return `${base.replace(/[,.;:\s]+$/, '')}…`;
}

function cleanFallbackTitle(fallbackTitle?: string | null): string {
  if (!fallbackTitle) return '';
  let cleaned = fallbackTitle
    .replace(/^\s*(?:\[\s*\d+[a-z]?\s*\]|\(\s*[a-z]\s*\)|\d+[a-z]?[.)])\s*/i, '')
    .replace(/^\s*\d+\s+(?=[A-Za-zÀ-ỹ])/, '')
    .replace(/^[“"]|[”".,]+$/g, '')
    .trim();
  if (!cleaned || isGarbageAuthorToken(cleaned)) return '';
  cleaned = cleaned.replace(/\s+/g, ' ');
  return truncateClean(cleaned, 38);
}

export function splitRawAuthorString(rawAuthors: string | null | undefined): string[] {
  const trimmed = String(rawAuthors ?? '')
    .replace(/^\s*(?:\[\s*\d+[a-z]?\s*\]|\(\s*[a-z]\s*\)|\d+[a-z]?[.)])\s*/i, '')
    .replace(/\s*\(\s*(?:19|20)\d{2}[a-z]?\s*\)\s*$/g, '')
    .replace(/[.,;:]+$/, '')
    .trim();
  if (!trimmed || isGarbageAuthorToken(trimmed)) return [];

  // Preserve intact institutional names that may contain commas or "và" / "and"
  // e.g. "Bộ Giáo dục và Đào tạo", "Bộ Văn hóa, Thể thao và Du lịch",
  // "U.S. Department of Health and Human Services"
  if (
    isInstitutionalAuthor(trimmed) &&
    !trimmed.includes(';') &&
    !/\bet\s+al\.?/i.test(trimmed)
  ) {
    return [trimmed];
  }

  return trimmed
    .replace(/\bet\s+al\.?/gi, '')
    .split(/\s*(?:;|\s+&\s+|\s+and\s+|\s+và\s+)\s*/i)
    .flatMap((chunk) => {
      const cleanChunk = chunk.trim();
      if (!cleanChunk) return [];
      if (isInstitutionalAuthor(cleanChunk)) return [cleanChunk];
      const commaParts = cleanChunk.split(/,\s*/).filter(Boolean);
      if (commaParts.length <= 1) return [cleanChunk];
      // Pair "Surname, F. M." without splitting the initials into a separate author
      const grouped: string[] = [];
      for (let i = 0; i < commaParts.length; i += 1) {
        const cur = commaParts[i].trim();
        const next = commaParts[i + 1]?.trim();
        if (next && /^(?:[A-ZÀ-Ỹ]\.(?:\s*-?[A-ZÀ-Ỹ]\.)*|[A-Z]{1,3})$/.test(next)) {
          grouped.push(`${cur}, ${next}`);
          i += 1;
        } else {
          grouped.push(cur);
        }
      }
      return grouped;
    })
    .map((s) => s.replace(/^[\s,;:.&]+|[\s,;:.&]+$/g, '').trim())
    .filter((s) => s.length > 0 && !isGarbageAuthorToken(s));
}

function extractShortSingleAuthor(rawAuthor: string): string {
  const cleaned = rawAuthor
    .replace(/^\s*(?:\[\s*\d+[a-z]?\s*\]|\(\s*[a-z]\s*\)|\d+[a-z]?[.)])\s*/i, '')
    .replace(/\bet\s+al\.?/gi, '')
    .replace(/^[\s,;:.&]+|[\s,;:.&]+$/g, '')
    .trim();
  if (!cleaned || isGarbageAuthorToken(cleaned)) return '';

  // Keep institutional/corporate authors completely intact (NEVER split or invert)
  if (isInstitutionalAuthor(cleaned)) {
    return truncateClean(cleaned, 48);
  }

  // APA / "Last, F. M." format (e.g. "De Choudhury, M." or "Vaswani, A.")
  if (cleaned.includes(',')) {
    const beforeComma = cleaned.split(',')[0].trim();
    if (beforeComma.length >= 2 && !isGarbageAuthorToken(beforeComma)) {
      return truncateClean(beforeComma, 32);
    }
  }

  // Strip leading Western initials like "N. ", "J. Q. ", "A.-B. "
  const withoutInitials = cleaned
    .replace(/^(?:[A-ZÀ-Ỹ](?:\.-?[A-ZÀ-Ỹ])?\.\s*)+/, '')
    .trim();

  const words = (withoutInitials || cleaned)
    .split(/\s+/)
    .map((w) => w.replace(/^[.,;:]+|[.,;:]+$/g, ''))
    .filter((w) => w.length > 0 && !/^[A-ZÀ-Ỹ]\.?$/.test(w));

  if (words.length === 0) return '';
  if (words.length === 1) {
    return isGarbageAuthorToken(words[0]) ? '' : words[0];
  }

  // Keep Vietnamese personal names intact (e.g. "Nguyễn Văn An", "Trần Thị Minh Thư")
  if (
    withoutInitials === cleaned &&
    words.length <= 4 &&
    VI_DIACRITIC_CHAR_RE.test(cleaned)
  ) {
    return truncateClean(cleaned, 34);
  }

  // Preserve compound Western surname particles ("De Choudhury", "van der Maaten")
  if (
    words.length >= 2 &&
    AUTHOR_SURNAME_PARTICLES.has(words[words.length - 2].toLowerCase())
  ) {
    if (
      words.length >= 3 &&
      AUTHOR_SURNAME_PARTICLES.has(words[words.length - 3].toLowerCase())
    ) {
      return `${words[words.length - 3]} ${words[words.length - 2]} ${words[words.length - 1]}`;
    }
    return `${words[words.length - 2]} ${words[words.length - 1]}`;
  }

  const surname = words[words.length - 1];
  return isGarbageAuthorToken(surname) ? '' : surname;
}

export function formatAcademicAuthorShort(
  authors: string[] | null | undefined,
  fallbackTitle?: string | null,
  lang: AcademicLang = 'vi',
): string {
  const rawList = (authors ?? []).map((a) => String(a ?? '').trim()).filter(Boolean);
  const hadExplicitEtAl = rawList.some((a) => /\bet\s+al\.?/i.test(a));

  // Normalize entries while respecting institutional authors
  const normalizedList: string[] = [];
  for (const entry of rawList) {
    const cleaned = entry
      .replace(/^\s*(?:\[\s*\d+[a-z]?\s*\]|\(\s*[a-z]\s*\)|\d+[a-z]?[.)])\s*/i, '')
      .replace(/\bet\s+al\.?/gi, '')
      .replace(/[.,;:]+$/, '')
      .trim();
    if (!cleaned || isGarbageAuthorToken(cleaned)) continue;
    if (isInstitutionalAuthor(cleaned)) {
      normalizedList.push(cleaned);
    } else if (rawList.length === 1 && /(?:;|\s+&\s+|\s+and\s+|\s+và\s+)/i.test(cleaned)) {
      normalizedList.push(...splitRawAuthorString(cleaned));
    } else {
      normalizedList.push(cleaned);
    }
  }

  if (normalizedList.length === 0) {
    const titleFallback = cleanFallbackTitle(fallbackTitle);
    if (titleFallback) return titleFallback;
    return lang === 'vi' ? 'Tài liệu tham khảo' : 'Reference';
  }

  const firstRaw = normalizedList[0];
  const firstIsInstitutional = isInstitutionalAuthor(firstRaw);
  const firstShort = extractShortSingleAuthor(firstRaw);

  if (!firstShort) {
    const titleFallback = cleanFallbackTitle(fallbackTitle);
    if (titleFallback) return titleFallback;
    return lang === 'vi' ? 'Tài liệu tham khảo' : 'Reference';
  }

  // Single institutional author: ALWAYS keep intact, NEVER append "et al."
  if (firstIsInstitutional && normalizedList.length === 1) {
    return firstShort;
  }

  if (normalizedList.length === 1) {
    return hadExplicitEtAl ? `${firstShort} et al.` : firstShort;
  }

  if (normalizedList.length === 2 && !hadExplicitEtAl) {
    const secondShort = extractShortSingleAuthor(normalizedList[1]);
    if (
      secondShort &&
      !firstIsInstitutional &&
      `${firstShort} & ${secondShort}`.length <= 28
    ) {
      return `${firstShort} & ${secondShort}`;
    }
    return `${firstShort} et al.`;
  }

  return `${firstShort} et al.`;
}

// ============================================================================
// 10. Reasoning & Diagnostic Copy Sanitization (VI + Non-Accusatory EN)
// ============================================================================

export function sanitizeReasoningForDisplay(
  reasoning: string | null | undefined,
  lang: AcademicLang,
): string {
  if (!reasoning) return '';

  // 1. Strip internal telemetry blocks like [Neural: content alignment score=0.52, ...]
  let out = String(reasoning)
    .replace(/\s*\[Neural:[^\]]*\]/gi, '')
    .replace(
      /\s*\((?:[^()]*\b(?:title_sim|author_sim|year_diff|score|sim|align|evidence_sim|title_fuzzy|author_jaccard|year_distance)=[^()]*)\)/gi,
      '',
    )
    // Replace inline "điểm căn chỉnh ngữ cảnh Neural = 0.52 [trung bình]" telemetry
    .replace(
      /điểm căn chỉnh ngữ cảnh Neural\s*=\s*([0-9.]+)(?:\s*\[[^\]]+\])?/gi,
      (_m, val: string) => {
        const pct = Math.round(parseFloat(val) * 100);
        return Number.isFinite(pct)
          ? lang === 'vi'
            ? `mức độ liên quan ngữ cảnh: ${pct}%`
            : `context relevance: ${pct}%`
          : '';
      },
    )
    // Unwrap backticked enum tokens
    .replace(/`([^`]+)`/g, (_match, inner: string) => {
      const token = inner.trim().toLowerCase().replace(/[\s-]+/g, '_');
      if (
        token === 'suspected_hallucination' ||
        token === 'metadata_error' ||
        token === 'verified' ||
        token === 'unresolved' ||
        token === 'resource' ||
        token === 'url_resource'
      ) {
        return `"${getVerdictDisplay(token, lang).label}"`;
      }
      return inner.trim();
    })
    .replace(/\bSUSPECTED_HALLUCINATION\b/g, getVerdictDisplay('suspected_hallucination', lang).label)
    .replace(/\bMETADATA_ERROR\b/g, getVerdictDisplay('metadata_error', lang).label)
    .replace(/\bURL_RESOURCE\b/g, getVerdictDisplay('resource', lang).label)
    .replace(/\bUNCITED_REF\b/g, lang === 'vi' ? 'Chưa trích dẫn trong bài' : 'Not Cited')
    .replace(/\bSTYLE_INCONSISTENT\b/g, lang === 'vi' ? 'Khác chuẩn trích dẫn' : 'Style Issue')
    .replace(/\bDUPLICATE_REF\b/g, lang === 'vi' ? 'Trích dẫn trùng lặp' : 'Duplicate Reference');

  // 2. Translate / soften common backend English diagnostic sentences
  if (lang === 'vi') {
    out = out
      .replace(
        /DOI\s+['"]?([^\s'",;]+)['"]?\s+matches\s+(?:a\s+)?known\s+fabricated\s+DOI\s+pattern(?:\s*\([^)]*\))?\.?/gi,
        (_m, doi: string) =>
          `Mã DOI (${doi}) trùng với tiền tố thử nghiệm/không hợp lệ chưa được đăng ký chính thức.`,
      )
      .replace(
        /(?:cited\s+)?DOI\s+(?:has\s+an?\s+)?(?:invalid|fabricated)\s+(?:prefix|pattern)\.?/gi,
        'Mã DOI sử dụng tiền tố không hợp lệ hoặc chưa được đăng ký chính thức.',
      )
      .replace(
        /URL\s+domain\s+['"]([^'"]+)['"]\s+is\s+(?:a\s+)?(?:placeholder\/fake|fake\/placeholder|fake|placeholder)\s+domain\.?/gi,
        (_m, domain: string) =>
          `Tên miền URL '${domain}' là tên miền mẫu hoặc không tồn tại thực tế.`,
      )
      .replace(
        /URL\s+domain\s+(?:is\s+)?(?:clearly\s+)?(?:fake|placeholder|non-academic)\.?/gi,
        'Tên miền URL là địa chỉ mẫu hoặc không thuộc nguồn lưu trữ thực tế.',
      )
      .replace(
        /(?:No\s+matching\s+scholarly\s+record(?:s)?|Zero\s+matching\s+records|No\s+candidates?\s+found)(?:\s+was\s+found|\s+were\s+found)?(?:\s+across\s+[^.;]+)?\.?/gi,
        'Không tìm thấy bản ghi học thuật tương ứng trên các cơ sở dữ liệu đã tra cứu.',
      )
      .replace(/\bPublication\s+year\s+mismatch\b/gi, 'Sai lệch năm xuất bản')
      .replace(/\bTitle\s+mismatch\b/gi, 'Sai lệch tiêu đề')
      .replace(/\bYear\s+mismatch\b/gi, 'Sai lệch năm xuất bản')
      .replace(/\bAuthor(?:s)?\s+mismatch\b/gi, 'Sai lệch tác giả')
      .replace(/\bVenue\s+mismatch\b/gi, 'Sai lệch nơi công bố')
      .replace(/\bDOI\s+mismatch\b/gi, 'Sai lệch mã DOI')
      .replace(/\b(\d{4})\s+vs\.?\s+(\d{4})\b/gi, '$1 so với $2')
      .replace(/\(\s*HTTP\s+200\s+OK\s*\)/gi, '(liên kết hoạt động)')
      .replace(/\bHTTP\s+200\s+OK\b/gi, 'Liên kết hoạt động')
      .replace(/\bfabricated\b/gi, 'không hợp lệ')
      .replace(/\bhallucinated\b/gi, 'chưa tìm thấy nguồn');
  } else {
    out = out
      .replace(
        /DOI\s+['"]?([^\s'",;]+)['"]?\s+matches\s+(?:a\s+)?known\s+fabricated\s+DOI\s+pattern(?:\s*\([^)]*\))?\.?/gi,
        (_m, doi: string) =>
          `DOI (${doi}) matches an invalid/unregistered test prefix.`,
      )
      .replace(
        /URL\s+domain\s+['"]([^'"]+)['"]\s+is\s+(?:a\s+)?(?:placeholder\/fake|fake\/placeholder|fake)\s+domain\.?/gi,
        (_m, domain: string) =>
          `URL domain '${domain}' is a placeholder or non-existent domain.`,
      )
      .replace(/\bknown\s+fabricated\s+DOI\s+pattern\b/gi, 'invalid/unregistered DOI test prefix')
      .replace(/\(\s*HTTP\s+200\s+OK\s*\)/gi, '(link active)')
      .replace(/\bHTTP\s+200\s+OK\b/gi, 'Link Active')
      .replace(/\bfabricated\b/gi, 'invalid/unregistered')
      .replace(/\bhallucinated\b/gi, 'unmatched');
  }

  out = out
    .replace(/\)\)+/g, ')')
    .replace(/\.\.(?!\.)/g, '.')
    .replace(/\s{2,}/g, ' ')
    .replace(/([A-Za-zÀ-ỹ]):(?=[A-Za-zÀ-ỹ])/g, '$1: ')
    .trim();

  return out;
}
