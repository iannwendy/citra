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
        'Đã trích dẫn trong bài viết nhưng chưa liệt kê ở danh mục tài liệu tham khảo cuối bài; hãy bổ sung mục này vào cuối bài.',
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
        'Tệp chỉ chứa danh mục tài liệu tham khảo (.bib/.ris) nên không áp dụng liên kết trích dẫn trong văn bản.',
    },
    en: {
      label: 'Not Applicable',
      description:
        'Reference-list-only file (.bib/.ris) — in-text cross-reference linking does not apply.',
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
// 3. CIS Score Formatting (`XX.X / 100` — NEVER `%`) & Canonical Score Bands
// ============================================================================

export type CisBandKey = 'excellent' | 'good' | 'review' | 'critical';

export interface CisBandDisplay {
  key: CisBandKey;
  label: string;
  shortLabel: string;
  badgeClass: string;
  textClass: string;
  dotClass: string;
}

const CIS_BAND_SPECS: Record<
  CisBandKey,
  {
    vi: { label: string; shortLabel: string };
    en: { label: string; shortLabel: string };
    badgeClass: string;
    textClass: string;
    dotClass: string;
  }
> = {
  excellent: {
    vi: { label: 'Xuất sắc', shortLabel: 'Xuất sắc' },
    en: { label: 'Excellent', shortLabel: 'Excellent' },
    badgeClass:
      'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800',
    textClass: 'text-emerald-700 dark:text-emerald-400',
    dotClass: 'bg-emerald-500',
  },
  good: {
    vi: { label: 'Khá tốt', shortLabel: 'Khá tốt' },
    en: { label: 'Good', shortLabel: 'Good' },
    badgeClass:
      'bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800',
    textClass: 'text-indigo-700 dark:text-indigo-300',
    dotClass: 'bg-indigo-500',
  },
  review: {
    vi: { label: 'Cần rà soát', shortLabel: 'Cần rà soát' },
    en: { label: 'Needs Review', shortLabel: 'Needs Review' },
    badgeClass:
      'bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800',
    textClass: 'text-amber-800 dark:text-amber-400',
    dotClass: 'bg-amber-500',
  },
  critical: {
    vi: { label: 'Cần kiểm tra kỹ', shortLabel: 'Kiểm tra kỹ' },
    en: { label: 'Needs Careful Review', shortLabel: 'Careful Review' },
    badgeClass:
      'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800',
    textClass: 'text-rose-700 dark:text-rose-400',
    dotClass: 'bg-rose-500',
  },
};

/**
 * Canonical 4-tier CIS score bands aligned with HelpModal (`85–100`, `70–84`, `50–69`, `< 50`).
 */
export function getCisBand(score: number, lang: AcademicLang = 'en'): CisBandDisplay {
  const safeScore = typeof score === 'number' && Number.isFinite(score)
    ? Math.max(0, Math.min(100, score))
    : 0;

  let key: CisBandKey;
  if (safeScore >= 85) {
    key = 'excellent';
  } else if (safeScore >= 70) {
    key = 'good';
  } else if (safeScore >= 50) {
    key = 'review';
  } else {
    key = 'critical';
  }

  const spec = CIS_BAND_SPECS[key];
  const copy = lang === 'vi' ? spec.vi : spec.en;
  return {
    key,
    label: copy.label,
    shortLabel: copy.shortLabel,
    badgeClass: spec.badgeClass,
    textClass: spec.textClass,
    dotClass: spec.dotClass,
  };
}

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
// 3B. Clean Human Source Display Names (VI & EN)
// ============================================================================

export interface SourceDisplayContext {
  triggered_rules?: string[];
  external_ids?: Record<string, string>;
  venue?: string | null;
  title?: string | null;
}

export const SOURCE_DISPLAY_LABELS: Record<string, { en: string; vi: string }> = {
  crossref: { en: 'Crossref', vi: 'Crossref' },
  crossref_rest_api: { en: 'Crossref', vi: 'Crossref' },
  openalex: { en: 'OpenAlex', vi: 'OpenAlex' },
  openalex_scholarly_graph: { en: 'OpenAlex', vi: 'OpenAlex' },
  datacite: {
    en: 'DataCite (Zenodo / Figshare / OSF)',
    vi: 'DataCite (Kho dữ liệu nghiên cứu mở)',
  },
  doi_ra: {
    en: 'Global DOI Registry',
    vi: 'Hệ thống đăng ký DOI quốc tế',
  },
  doi: {
    en: 'Global DOI Registry',
    vi: 'Hệ thống đăng ký DOI quốc tế',
  },
  doaj: {
    en: 'DOAJ (Open Access Journals)',
    vi: 'DOAJ (Danh mục tạp chí truy cập mở)',
  },
  openaire_hal: {
    en: 'OpenAIRE / HAL Open Science',
    vi: 'OpenAIRE / HAL Khoa học mở',
  },
  ncbi_biorxiv: { en: 'PubMed / bioRxiv', vi: 'PubMed / bioRxiv' },
  ncbi: { en: 'PubMed / bioRxiv', vi: 'PubMed / bioRxiv' },
  entrez: { en: 'PubMed / bioRxiv', vi: 'PubMed / bioRxiv' },
  pubmed: { en: 'PubMed', vi: 'PubMed' },
  biorxiv: { en: 'bioRxiv', vi: 'bioRxiv' },
  medrxiv: { en: 'medRxiv', vi: 'medRxiv' },
  dblp: {
    en: 'DBLP',
    vi: 'DBLP (Thư viện Khoa học Máy tính)',
  },
  arxiv: {
    en: 'arXiv',
    vi: 'arXiv (Kho bài nghiên cứu mở)',
  },
  openlibrary: {
    en: 'Open Library / Google Books',
    vi: 'Open Library / Google Books (Thư viện sách)',
  },
  europepmc: {
    en: 'Europe PMC (PubMed)',
    vi: 'Europe PMC (Thư viện Y sinh)',
  },
  huggingface: {
    en: 'Hugging Face',
    vi: 'Hugging Face (Kho tài nguyên AI)',
  },
  tech_standard: {
    en: 'Technical Standards & Software (RFC / PyPI / NPM / GitHub)',
    vi: 'Tiêu chuẩn kỹ thuật & Phần mềm (RFC / PyPI / NPM / GitHub)',
  },
  vn_tech_standard: {
    en: 'Vietnamese National Standards (TCVN / QCVN)',
    vi: 'Tiêu chuẩn / Quy chuẩn Quốc gia (TCVN / QCVN)',
  },
  vn_textbook_registry: {
    en: 'Vietnamese University Textbook Registry',
    vi: 'Danh mục giáo trình đại học Việt Nam',
  },
  wikidata_opencitations: {
    en: 'Wikidata / OpenCitations',
    vi: 'Wikidata / OpenCitations (Thư viện trích dẫn mở)',
  },
  wikidata_opencitatio: {
    en: 'Wikidata / OpenCitations',
    vi: 'Wikidata / OpenCitations (Thư viện trích dẫn mở)',
  },
  serpapi: { en: 'Google Scholar', vi: 'Google Scholar' },
  google_scholar: { en: 'Google Scholar', vi: 'Google Scholar' },
  semanticscholar: { en: 'Semantic Scholar', vi: 'Semantic Scholar' },
  semantic_scholar: { en: 'Semantic Scholar', vi: 'Semantic Scholar' },
  acl: {
    en: 'Scholarly Linguistics Archive',
    vi: 'Thư viện nghiên cứu Ngôn ngữ học',
  },
  coreapi: {
    en: 'CORE Open Research',
    vi: 'CORE (Thư viện nghiên cứu mở)',
  },
  local_db: {
    en: 'CITRA Scholarly Library',
    vi: 'Thư viện học thuật CITRA',
  },
  local_acl: {
    en: 'CITRA Scholarly Library',
    vi: 'Thư viện học thuật CITRA',
  },
  local_papers: {
    en: 'CITRA Scholarly Library',
    vi: 'Thư viện học thuật CITRA',
  },
  known_papers: {
    en: 'CITRA Scholarly Library',
    vi: 'Thư viện học thuật CITRA',
  },
  vn_legal_registry: {
    en: 'Vietnamese Legal Registry',
    vi: 'Thư viện văn bản pháp luật Việt Nam',
  },
  vn_legal: {
    en: 'Vietnamese Legal Registry',
    vi: 'Thư viện văn bản pháp luật Việt Nam',
  },
  web_html_meta: {
    en: 'Source Web Page',
    vi: 'Trang web gốc',
  },
  wayback_html_meta: {
    en: 'Web Archive (Wayback)',
    vi: 'Kho lưu trữ web (Wayback)',
  },
  wayback: {
    en: 'Web Archive (Wayback)',
    vi: 'Kho lưu trữ web (Wayback)',
  },
  github: { en: 'GitHub', vi: 'GitHub' },
};

export function getSourceDisplayName(
  source: string,
  lang: AcademicLang = 'en',
  context?: SourceDisplayContext,
): string {
  const raw = String(source ?? '').trim();
  if (!raw) return raw;
  const key = raw.toLowerCase().replace(/[\s-]+/g, '_');

  if (key === 'tech_standard' && context) {
    const rules = context.triggered_rules ?? [];
    const ext = context.external_ids ?? {};
    if (
      rules.includes('R-VN-STANDARD-VERIFIED') ||
      Boolean(ext.vn_standard_code) ||
      /\b(?:TCVN|QCVN)\b/i.test(`${context.title ?? ''} ${context.venue ?? ''}`)
    ) {
      return SOURCE_DISPLAY_LABELS.vn_tech_standard[lang];
    }
    if (
      rules.includes('R-VN-TEXTBOOK-VERIFIED') ||
      Boolean(ext.vn_textbook_id) ||
      /\b(?:NXB|Nhà xuất bản|Giáo trình)\b/i.test(`${context.title ?? ''} ${context.venue ?? ''}`)
    ) {
      return SOURCE_DISPLAY_LABELS.vn_textbook_registry[lang];
    }
  }

  if (Object.prototype.hasOwnProperty.call(SOURCE_DISPLAY_LABELS, key)) {
    return SOURCE_DISPLAY_LABELS[key][lang];
  }
  if (/sqlite|fts5|local[\s_-]*(?:db|acl|papers)|known[\s_-]*papers/i.test(raw)) {
    return SOURCE_DISPLAY_LABELS.local_db[lang];
  }
  if (/crossref\s+rest\s+api/i.test(raw)) {
    return SOURCE_DISPLAY_LABELS.crossref[lang];
  }
  if (/openalex\s+scholarly\s+graph/i.test(raw)) {
    return SOURCE_DISPLAY_LABELS.openalex[lang];
  }
  if (/ncbi|entrez/i.test(raw)) {
    return SOURCE_DISPLAY_LABELS.ncbi[lang];
  }
  if (/wayback/i.test(raw)) {
    return SOURCE_DISPLAY_LABELS.wayback[lang];
  }
  return raw;
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
        text = parsed.detail.trim();
      } else if (Array.isArray(parsed.detail) && parsed.detail.length > 0) {
        const first = parsed.detail[0] as Record<string, unknown> | string;
        if (typeof first === 'string' && first.trim()) {
          text = first.trim();
        } else if (first && typeof first === 'object' && typeof first.msg === 'string') {
          text = first.msg.trim();
        }
      } else if (typeof parsed.message === 'string' && parsed.message.trim()) {
        text = parsed.message.trim();
      } else if (typeof parsed.error === 'string' && parsed.error.trim()) {
        text = parsed.error.trim();
      }
    } catch {
      // Not valid JSON — keep cleaned string
    }
  }

  // Strip any nested API/HTTP status prefix that lived inside the unwrapped JSON field
  text = text.replace(/^(?:(?:API|HTTP)\s+\d{3}(?:\s+[A-Za-z -]+?)?\s*:\s*)+/i, '').trim();
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
    pattern: /account_not_activated\b|account\s+is\s+not\s+activated/i,
    vi: 'Tài khoản chưa được kích hoạt. Vui lòng kiểm tra email để xác nhận.',
    en: "Your account isn't activated yet. Please check your email for the activation link.",
  },
  {
    pattern: /account_deactivated\b|account\s+(?:is|has\s+been)\s+deactivated/i,
    vi: 'Tài khoản của bạn đã bị tạm khóa. Vui lòng liên hệ quản trị viên.',
    en: 'Your account has been deactivated. Please contact an administrator.',
  },
  {
    pattern: /api_key_requires_pro\b/i,
    vi: 'Tính năng tạo khóa API dành cho gói Pro trở lên.',
    en: 'API keys are available on Pro plans and above.',
  },
  {
    pattern: /privacy_consent_required\b/i,
    vi: 'Vui lòng xác nhận đồng ý Chính sách bảo mật trước khi tiếp tục.',
    en: 'Please confirm the Privacy Policy before continuing.',
  },
  {
    pattern: /google_not_configured\b|google_client_id|google_client_secret/i,
    vi: 'Đăng nhập bằng Google hiện tạm ngưng. Vui lòng đăng nhập bằng email hoặc tên đăng nhập.',
    en: 'Google sign-in is currently unavailable. Please sign in with your email or username.',
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
    pattern:
      /invalid\s+(?:or\s+tampered\s+)?share\s+token|share\s+(?:link|token)\b.*(?:not\s+found|invalid|expired|structure|tampered|signature)/i,
    vi: 'Liên kết chia sẻ không hợp lệ hoặc đã hết hạn.',
    en: 'This share link is invalid or has expired.',
  },
  {
    pattern: /invalid\s+class\s+join\s+code/i,
    vi: 'Mã tham gia lớp không đúng. Vui lòng kiểm tra lại với giảng viên.',
    en: 'Invalid class join code. Please check with your instructor.',
  },
  {
    pattern: /promo\s+code\b.*already\s+exists/i,
    vi: 'Mã khuyến mãi này đã tồn tại.',
    en: 'This promo code already exists.',
  },
  {
    pattern: /promo\s+code\b.*(?:not\s+found|expired|invalid)/i,
    vi: 'Mã giảm giá không tồn tại hoặc đã hết hạn.',
    en: 'Promo code not found or expired.',
  },
  {
    pattern:
      /missing\s+%pdf-\s+header|missing\s+ooxml\s+pk|ooxml\s+security|missing\s+ty\s+-|missing\s+@entry|invalid\s+(?:pdf|docx|bibtex|ris)\s+file|corrupt/i,
    vi: 'Tệp không đúng định dạng chuẩn hoặc bị lỗi. Vui lòng lưu lại tệp PDF/Word và thử tải lên lại.',
    en: "This file appears damaged or isn't a valid document format. Please re-save it and try again.",
  },
  {
    pattern: /72\s+(?:utf-?8\s+)?bytes?|72\s+byte/i,
    vi: 'Mật khẩu hơi dài (tối đa khoảng 50 ký tự nếu có dấu tiếng Việt). Vui lòng chọn mật khẩu ngắn hơn.',
    en: 'Password is too long. Please use a shorter password (under 64 characters).',
  },
  {
    pattern: /2097152\s+bytes|avatar.*(?:too\s+large|max\s+size|size)/i,
    vi: 'Ảnh đại diện vượt quá 2 MB. Vui lòng chọn ảnh nhẹ hơn.',
    en: 'Profile photo exceeds the 2 MB limit. Please choose a smaller image.',
  },
  {
    pattern: /invalid\s+image\s+file|content\s+does\s+not\s+match\s+declared\s+type|unsupported\s+image/i,
    vi: 'Tệp ảnh đại diện không hợp lệ. Vui lòng chọn ảnh JPG, PNG hoặc WEBP.',
    en: 'Invalid profile photo. Please upload a valid JPG, PNG, or WEBP image.',
  },
  {
    pattern: /page\s+limit\s+exceeded/i,
    vi: 'Tài liệu vượt quá số trang tối đa của gói hiện tại. Vui lòng chia nhỏ tệp hoặc nâng cấp gói.',
    en: "This document exceeds your plan's page limit. Please shorten the file or upgrade your plan.",
  },
  {
    pattern: /(?:pdf|docx|document|file)\s+(?:is\s+)?too\s+large|exceeds\s+plan\s+file\s+size\s+limit/i,
    vi: 'Tệp vượt quá dung lượng cho phép của gói hiện tại. Vui lòng nén tệp hoặc nâng cấp gói.',
    en: "This file exceeds your plan's file size limit. Please use a smaller file or upgrade your plan.",
  },
  {
    pattern: /exporting\s+reports\s+in\s+.*is\s+a\s+pro/i,
    vi: 'Tính năng tải báo cáo định dạng này dành cho gói Pro trở lên.',
    en: 'Exporting reports in this format is available on Pro plans and above.',
  },
  {
    pattern: /transient\s+database\s+disk\s+i\/o|database\s+is\s+locked/i,
    vi: 'Hệ thống đang bận lưu dữ liệu. Vui lòng thử lại sau vài giây.',
    en: 'The system is briefly busy. Please try again in a few seconds.',
  },
  {
    pattern: /orphaned\s+analysis\s+job\s+failed|analysis\s+failed\s+before\s+report\s+generation/i,
    vi: 'Phiên kiểm tra trước bị gián đoạn. Vui lòng bấm kiểm tra lại bài viết.',
    en: 'The previous check was interrupted. Please run the check again.',
  },
  {
    pattern: /username\s+already\s+(?:exists|taken|in\s+use)/i,
    vi: 'Tên đăng nhập này đã có người sử dụng.',
    en: 'This username is already taken.',
  },
  {
    pattern: /email\s+(?:address\s+)?already\s+(?:exists|registered|in\s+use)/i,
    vi: 'Email này đã được đăng ký tài khoản khác.',
    en: 'This email is already registered.',
  },
  {
    pattern: /current\s+password\s+is\s+incorrect/i,
    vi: 'Mật khẩu hiện tại chưa đúng. Vui lòng kiểm tra lại.',
    en: 'Your current password is incorrect. Please try again.',
  },
  {
    pattern: /linked\s+to\s+google\s+sign-?in\s+and\s+cannot\s+be\s+changed/i,
    vi: 'Email này đang liên kết với tài khoản Google nên không thể thay đổi.',
    en: 'This email is linked to Google Sign-In and cannot be changed.',
  },
  {
    pattern: /cannot\s+(?:demote|deactivate)\s+the\s+last\s+active\s+admin/i,
    vi: 'Không thể hạ quyền hoặc khóa quản trị viên hoạt động cuối cùng.',
    en: 'You cannot demote or deactivate the last active administrator.',
  },
  {
    pattern: /vnp_txnref|vnp_securehash|pci-dss|payment_status=unpaid|vnpay\s+amount\s+mismatch|\[vnpay\s+code/i,
    vi: 'Giao dịch thanh toán chưa hoàn tất. Vui lòng thử lại.',
    en: 'Payment could not be completed. Please try again.',
  },
  {
    pattern: /please\s+wait\s+(\d+)\s+seconds?\s+before\s+requesting\s+another\s+password\s+setup\s+email/i,
    vi: (m) => `Bạn vừa gửi yêu cầu. Vui lòng đợi ${m[1]} giây rồi thử lại.`,
    en: (m) => `You recently sent a request. Please wait ${m[1]} seconds before trying again.`,
  },
  {
    pattern: /too\s+many\s+authentication\s+attempts/i,
    vi: 'Bạn đã thử quá nhiều lần. Vui lòng đợi một phút rồi thử lại.',
    en: 'Too many sign-in attempts. Please wait a minute and try again.',
  },
  {
    pattern: /checkout\s+session\s+not\s+found/i,
    vi: 'Không tìm thấy phiên thanh toán. Vui lòng bắt đầu lại từ trang Bảng giá.',
    en: 'Checkout session not found. Please start again from the Pricing page.',
  },
  {
    pattern: /invalid\s+authorization\s+header|invalid\s+token\s+payload|\bsession\s+not\s+found\b|token\s+expired/i,
    vi: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
    en: 'Your session has expired. Please sign in again.',
  },
  {
    pattern: /essay\s+not\s+found/i,
    vi: 'Không tìm thấy báo cáo này. Tài liệu có thể đã bị xóa hoặc đường dẫn không đúng.',
    en: 'Report not found. This document may have been deleted or the link is no longer valid.',
  },
  {
    pattern: /only\s+users\s+with\s+role\s+['"]?user['"]?\s+can\s+be\s+added\s+as\s+students/i,
    vi: 'Chỉ có thể thêm tài khoản sinh viên vào lớp học.',
    en: 'Only student accounts can be added to a class.',
  },
  {
    pattern: /only\s+student\s+accounts\s+can\s+self-?enroll/i,
    vi: 'Chỉ tài khoản sinh viên mới có thể tự tham gia lớp bằng mã lớp.',
    en: 'Only student accounts can join a class using a join code.',
  },
  {
    pattern: /override\s+permission\s+is\s+disabled|students\s+are\s+not\s+permitted\s+to\s+override/i,
    vi: 'Tài khoản của bạn không có quyền cập nhật kết quả kiểm tra.',
    en: 'Your account does not have permission to update review results.',
  },
  {
    pattern: /teacher\s+access\s+required/i,
    vi: 'Tính năng này chỉ dành cho tài khoản giảng viên.',
    en: 'This feature requires an instructor account.',
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

  // Strip any remaining ALL_CAPS machine error-code prefix (e.g. "SOME_CODE: message")
  const strippedCode = cleaned.replace(/^[A-Z][A-Z0-9_]{2,}\s*:\s*/, '').trim();
  return strippedCode || defaultFallback;
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

const INSTITUTIONAL_VI_PREFIX_RE =
  /^(?:bộ\s+(?!luật\b|dữ\s+liệu\b|tiêu\s+chuẩn\b|quy\s+tắc\b|câu\s+hỏi\b)|(?:viện|cục|sở|nxb|ubnd|hdnd|hđnd)\s+)/i;

const INSTITUTIONAL_GLOBAL_ACRONYM_RE =
  /\b(?:WHO|UNESCO|OECD|UNICEF|UNDP|UNHCR|IMF|WTO|FAO|IEEE|ACM|ISO|IEC|IETF|W3C|NIST|OWASP|CDC|FDA|NASA|NIH)\b/;

const INSTITUTIONAL_EN_PHRASE_RE =
  /\b(?:ministry|department|commission|association|organi[sz]ation|institute|university|committee|congress|parliament|world\s+bank|united\s+nations|world\s+health|european\s+union|european\s+commission|national\s+institute|government|council|bureau|agency|foundation|society|administration|authority|corporation|academy|board\s+of|center\s+for|centre\s+for|office\s+of)\b/i;

const CANONICAL_VI_INSTITUTION_CASING: Record<string, string> = {
  'ban chấp hành trung ương': 'Ban Chấp hành Trung ương',
  'đảng cộng sản việt nam': 'Đảng Cộng sản Việt Nam',
  'thủ tướng chính phủ': 'Thủ tướng Chính phủ',
  'chính phủ': 'Chính phủ',
  'quốc hội': 'Quốc hội',
  'bộ chính trị': 'Bộ Chính trị',
  'ban bí thư': 'Ban Bí thư',
  'chủ tịch nước': 'Chủ tịch nước',
  'ủy ban thường vụ quốc hội': 'Ủy ban Thường vụ Quốc hội',
  'uỷ ban thường vụ quốc hội': 'Ủy ban Thường vụ Quốc hội',
  'bộ giáo dục và đào tạo': 'Bộ Giáo dục và Đào tạo',
  'bộ khoa học và công nghệ': 'Bộ Khoa học và Công nghệ',
  'bộ thông tin và truyền thông': 'Bộ Thông tin và Truyền thông',
  'bộ công thương': 'Bộ Công Thương',
  'bộ tài chính': 'Bộ Tài chính',
  'bộ y tế': 'Bộ Y tế',
  'bộ tư pháp': 'Bộ Tư pháp',
  'bộ nội vụ': 'Bộ Nội vụ',
};

const LEGAL_DOCUMENT_TOKEN_RE =
  /^(?:nghị\s+quyết|nghị\s+định|quyết\s+định|thông\s+tư|chỉ\s+thị|luật|bộ\s+luật|pháp\s+lệnh|hiến\s+pháp|quy\s+định|công\s+văn|kế\s+hoạch)\b/i;

const STATUTE_NUMBER_RE = /\b\d+(?:\/\d{4})?\/[a-zà-ỹ0-9-]+\b/i;

const VI_TITLE_OPENER_RE =
  /^(?:nghiên\s+cứu|đề\s+xuất|giải\s+pháp|phát\s+triển|đánh\s+giá|phân\s+tích|ứng\s+dụng|xây\s+dựng|hoàn\s+thiện|thực\s+trạng|tác\s+động|ảnh\s+hưởng|vai\s+trò|một\s+số|khảo\s+sát|tổng\s+quan|định\s+hướng|chuyển\s+đổi|tối\s+ưu|thiết\s+kế|mô\s+hình|hệ\s+thống|phương\s+pháp|cơ\s+sở|nâng\s+cao|thúc\s+đẩy|quản\s+lý|áp\s+dụng|tìm\s+hiểu|báo\s+cáo\s+về)\b/i;

const EN_TITLE_OPENER_RE =
  /^(?:a\s+study\s+of|an?\s+empirical|towards?\s+|on\s+the\s+|research\s+on|analysis\s+of|evaluation\s+of|survey\s+of|investigating|exploring|improving|learning\s+to|making\s+a|understanding|building|designing)\b/i;

const DANGLING_TITLE_STOPWORDS = new Set([
  'và',
  'của',
  'về',
  'tại',
  'ở',
  'trong',
  'cho',
  'với',
  'đến',
  'từ',
  'hoặc',
  'hay',
  'các',
  'những',
  'and',
  'of',
  'for',
  'in',
  'on',
  'to',
  'the',
  'a',
  'an',
  'with',
  '-',
  '–',
  '—',
]);

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

export function isLegalDocumentNoiseToken(name: string | null | undefined): boolean {
  const cleaned = String(name ?? '').trim();
  if (!cleaned) return false;
  if (isInstitutionalAuthor(cleaned)) return false;
  return LEGAL_DOCUMENT_TOKEN_RE.test(cleaned) || STATUTE_NUMBER_RE.test(cleaned);
}

export function looksLikeTitleSentence(raw: string | null | undefined): boolean {
  const cleaned = String(raw ?? '')
    .replace(/^\s*(?:\[\s*\d+[a-z]?\s*\]|\(\s*[a-z]\s*\)|\d+[a-z]?[.)])\s*/i, '')
    .trim();
  if (!cleaned) return false;
  if (/\bhttps?:\/\//i.test(cleaned)) return true;

  const words = cleaned
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Za-zÀ-ỹ0-9]+|[^A-Za-zÀ-ỹ0-9]+$/g, ''))
    .filter(Boolean);
  if (words.length < 4) return false;

  if (VI_TITLE_OPENER_RE.test(cleaned)) return true;
  if (words.length >= 5 && EN_TITLE_OPENER_RE.test(cleaned) && !/\b[A-ZÀ-Ỹ]\./.test(cleaned)) {
    return true;
  }

  if (isInstitutionalAuthor(cleaned) && words.length <= 10) return false;

  // Multi-author lists with explicit initials (e.g. "vaswani A., shazeer N.") are not titles
  if (/\b[A-ZÀ-Ỹ]\./.test(cleaned)) return false;

  const lowercaseSentenceWords = words.filter(
    (w) =>
      /^[a-zà-ỹ]{2,}$/.test(w) &&
      !AUTHOR_SURNAME_PARTICLES.has(w) &&
      !/^(?:et|al|and|va|và|of|for|in|the)$/i.test(w),
  );
  if (lowercaseSentenceWords.length >= 5) return true;
  if (words.length >= 8 && lowercaseSentenceWords.length >= 4 && !cleaned.includes(',')) {
    return true;
  }
  return false;
}

export function normalizeAcademicAuthorDisplay(name: string): string {
  if (!name || name === '—') return name;
  const cleaned = name.replace(/\.{2,}/g, '.').replace(/\s+/g, ' ').trim();
  if (!cleaned) return cleaned;

  const lowerKey = cleaned.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(CANONICAL_VI_INSTITUTION_CASING, lowerKey)) {
    return CANONICAL_VI_INSTITUTION_CASING[lowerKey];
  }

  if (isInstitutionalAuthor(cleaned)) {
    if (!/[A-ZÀ-Ỹ]/.test(cleaned)) {
      return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }
    return cleaned;
  }

  return cleaned
    .split(/\s+/)
    .map((word, idx) => {
      if (!word) return word;
      const low = word.toLowerCase();
      if (
        idx > 0 &&
        (AUTHOR_SURNAME_PARTICLES.has(low) ||
          /^(?:et|al|and|va|và|of|for|in|the)$/i.test(low))
      ) {
        return word;
      }
      if (/^[a-zà-ỹ]{2,}$/.test(word)) {
        if (AUTHOR_SURNAME_PARTICLES.has(low) && idx === 0) {
          return word;
        }
        return word.charAt(0).toUpperCase() + word.slice(1);
      }
      return word;
    })
    .join(' ');
}

function collapseSplitInstitutionalTokens(authors: string[]): string[] {
  if (authors.length >= 2 && authors.every((a) => !/[\s,.]/.test(a.trim()))) {
    const joined = authors.map((a) => a.trim()).join(' ');
    if (isInstitutionalAuthor(joined)) {
      return [normalizeAcademicAuthorDisplay(joined)];
    }
  }
  return authors;
}

function extractLeadAuthorBeforeYear(rawText?: string | null): string {
  if (!rawText) return '';
  const stripped = rawText
    .replace(/^\s*(?:\[\s*\d+[a-z]?\s*\]|\(\s*[a-z]\s*\)|\d+[a-z]?[.)])\s*/i, '')
    .replace(/^\s*(?:\[\s*\d+[a-z]?\s*\]|\(\s*[a-z]\s*\)|\d+[a-z]?[.)])\s*/i, '')
    .trim();
  const apa = stripped.match(/^(.+?)\s*\(\s*(?:19|20)\d{2}[a-z]?\s*\)/);
  if (apa) {
    return apa[1].replace(/[.,;:]+$/, '').trim();
  }
  return '';
}

function looksLikeInvertedInstitutionalAuthor(
  candidate: string,
  institutionalRaw: string,
): boolean {
  if (!/\b[A-ZÀ-Ỹ]\./.test(candidate)) return false;
  const instWords = institutionalRaw.split(/\s+/).filter(Boolean);
  if (instWords.length < 2) return false;
  const lastWord = instWords[instWords.length - 1].toLowerCase();
  const candFirstWord = candidate.split(/[\s,]+/)[0]?.toLowerCase() ?? '';
  return candFirstWord === lastWord;
}

export function resolveDisplayAuthors(
  dbAuthors: string[] | null | undefined,
  rawText?: string | null,
  parsedFallbackAuthors?: string | null,
): string[] {
  const leadFromRaw = extractLeadAuthorBeforeYear(rawText);
  const candidateInst =
    (leadFromRaw && isInstitutionalAuthor(leadFromRaw) && !looksLikeTitleSentence(leadFromRaw)
      ? leadFromRaw
      : '') ||
    (parsedFallbackAuthors &&
    parsedFallbackAuthors !== '—' &&
    isInstitutionalAuthor(parsedFallbackAuthors) &&
    !looksLikeTitleSentence(parsedFallbackAuthors)
      ? parsedFallbackAuthors
      : '');

  const rawDb = (dbAuthors ?? [])
    .map((a) => String(a ?? '').trim())
    .filter((a) => a.length > 0 && !isGarbageAuthorToken(a));

  const collapsedDb = collapseSplitInstitutionalTokens(rawDb);

  if (candidateInst) {
    const normalizedInst = normalizeAcademicAuthorDisplay(candidateInst);
    if (
      collapsedDb.length === 0 ||
      collapsedDb.some((a) => looksLikeInvertedInstitutionalAuthor(a, candidateInst)) ||
      collapsedDb.some((a) => isLegalDocumentNoiseToken(a)) ||
      collapsedDb.every((a) => isInstitutionalAuthor(a) || isLegalDocumentNoiseToken(a))
    ) {
      return [normalizedInst];
    }
  }

  const cleanedDb = collapsedDb
    .filter((a) => !isLegalDocumentNoiseToken(a) && !looksLikeTitleSentence(a))
    .map(normalizeAcademicAuthorDisplay);

  if (cleanedDb.length > 0) {
    if (
      cleanedDb.length > 1 &&
      isInstitutionalAuthor(cleanedDb[0]) &&
      VI_DIACRITIC_CHAR_RE.test(cleanedDb[0]) &&
      cleanedDb.slice(1).every((a) => isInstitutionalAuthor(a) && VI_DIACRITIC_CHAR_RE.test(a))
    ) {
      return [cleanedDb[0]];
    }
    return cleanedDb;
  }

  if (
    parsedFallbackAuthors &&
    parsedFallbackAuthors !== '—' &&
    !looksLikeTitleSentence(parsedFallbackAuthors)
  ) {
    return splitRawAuthorString(parsedFallbackAuthors)
      .filter((a) => !isLegalDocumentNoiseToken(a) && !looksLikeTitleSentence(a))
      .map(normalizeAcademicAuthorDisplay);
  }

  return [];
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
    .replace(/\bhttps?:\/\/\S+/gi, '')
    .replace(/,?\s*ngày\s+\d{1,2}[/-]\d{1,2}[/-](?:19|20)\d{2}\.?/gi, '')
    .replace(/^[“"]|[”".,]+$/g, '')
    .trim();
  if (!cleaned || isGarbageAuthorToken(cleaned)) return '';
  cleaned = cleaned.replace(/\s+/g, ' ');
  const words = cleaned.split(' ');
  if (words.length > 6) {
    const picked = words.slice(0, 6);
    while (
      picked.length > 4 &&
      DANGLING_TITLE_STOPWORDS.has(picked[picked.length - 1].toLowerCase())
    ) {
      picked.pop();
    }
    const base = picked.join(' ').replace(/[,.;:\s-]+$/, '');
    return base.length <= 37 ? `${base}…` : truncateClean(base, 38);
  }
  return truncateClean(cleaned, 38);
}

export function splitRawAuthorString(rawAuthors: string | null | undefined): string[] {
  const trimmed = String(rawAuthors ?? '')
    .replace(/^\s*(?:\[\s*\d+[a-z]?\s*\]|\(\s*[a-z]\s*\)|\d+[a-z]?[.)])\s*/i, '')
    .replace(/\s*\(\s*(?:19|20)\d{2}[a-z]?\s*\)\s*$/g, '')
    .replace(/[.,;:]+$/, '')
    .trim();
  if (!trimmed || isGarbageAuthorToken(trimmed) || looksLikeTitleSentence(trimmed)) return [];

  // Preserve intact institutional names that may contain commas or "và" / "and"
  // e.g. "Bộ Giáo dục và Đào tạo", "Bộ Văn hóa, Thể thao và Du lịch",
  // "U.S. Department of Health and Human Services"
  if (
    isInstitutionalAuthor(trimmed) &&
    !trimmed.includes(';') &&
    !/\bet\s+al\.?/i.test(trimmed)
  ) {
    return [normalizeAcademicAuthorDisplay(trimmed)];
  }

  return trimmed
    .replace(/\bet\s+al\.?/gi, '')
    .split(/\s*(?:;|\s+&\s+|\s+and\s+|\s+và\s+)\s*/i)
    .flatMap((chunk) => {
      const cleanChunk = chunk.trim();
      if (!cleanChunk) return [];
      if (isInstitutionalAuthor(cleanChunk)) return [normalizeAcademicAuthorDisplay(cleanChunk)];
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
    .filter((s) => s.length > 0 && !isGarbageAuthorToken(s) && !isLegalDocumentNoiseToken(s));
}

function extractShortSingleAuthor(rawAuthor: string): string {
  const cleaned = rawAuthor
    .replace(/^\s*(?:\[\s*\d+[a-z]?\s*\]|\(\s*[a-z]\s*\)|\d+[a-z]?[.)])\s*/i, '')
    .replace(/\bet\s+al\.?/gi, '')
    .replace(/^[\s,;:.&]+|[\s,;:.&]+$/g, '')
    .trim();
  if (
    !cleaned ||
    isGarbageAuthorToken(cleaned) ||
    isLegalDocumentNoiseToken(cleaned) ||
    looksLikeTitleSentence(cleaned)
  ) {
    return '';
  }

  // Keep institutional/corporate authors completely intact (NEVER split or invert)
  if (isInstitutionalAuthor(cleaned)) {
    return truncateClean(normalizeAcademicAuthorDisplay(cleaned), 48);
  }

  // APA / "Last, F. M." format (e.g. "De Choudhury, M." or "Vaswani, A.")
  if (cleaned.includes(',')) {
    const beforeComma = cleaned.split(',')[0].trim();
    if (beforeComma.length >= 2 && !isGarbageAuthorToken(beforeComma)) {
      return truncateClean(normalizeAcademicAuthorDisplay(beforeComma), 32);
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
    return isGarbageAuthorToken(words[0]) ? '' : normalizeAcademicAuthorDisplay(words[0]);
  }

  // Keep Vietnamese personal names intact (e.g. "Nguyễn Văn An", "Trần Thị Minh Thư")
  if (
    withoutInitials === cleaned &&
    words.length <= 4 &&
    VI_DIACRITIC_CHAR_RE.test(cleaned)
  ) {
    return truncateClean(normalizeAcademicAuthorDisplay(cleaned), 34);
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
      return `${words[words.length - 3]} ${words[words.length - 2]} ${normalizeAcademicAuthorDisplay(words[words.length - 1])}`;
    }
    return `${words[words.length - 2]} ${normalizeAcademicAuthorDisplay(words[words.length - 1])}`;
  }

  const surname = words[words.length - 1];
  return isGarbageAuthorToken(surname) ? '' : normalizeAcademicAuthorDisplay(surname);
}

export function formatAcademicAuthorShort(
  authors: string[] | null | undefined,
  fallbackTitle?: string | null,
  lang: AcademicLang = 'vi',
): string {
  const initialList = (authors ?? []).map((a) => String(a ?? '').trim()).filter(Boolean);
  const rawList = collapseSplitInstitutionalTokens(initialList);
  const hadExplicitEtAl = initialList.some((a) => /\bet\s+al\.?/i.test(a));

  // Normalize entries while respecting institutional authors & rejecting title/statute noise
  const normalizedList: string[] = [];
  let inferredTitleFallback: string | null = null;
  for (const entry of rawList) {
    const cleaned = entry
      .replace(/^\s*(?:\[\s*\d+[a-z]?\s*\]|\(\s*[a-z]\s*\)|\d+[a-z]?[.)])\s*/i, '')
      .replace(/\bet\s+al\.?/gi, '')
      .replace(/[.,;:]+$/, '')
      .trim();
    if (!cleaned || isGarbageAuthorToken(cleaned) || isLegalDocumentNoiseToken(cleaned)) {
      continue;
    }
    if (looksLikeTitleSentence(cleaned)) {
      if (!inferredTitleFallback) inferredTitleFallback = cleaned;
      continue;
    }
    if (isInstitutionalAuthor(cleaned)) {
      normalizedList.push(normalizeAcademicAuthorDisplay(cleaned));
    } else if (rawList.length === 1 && /(?:;|\s+&\s+|\s+and\s+|\s+và\s+)/i.test(cleaned)) {
      normalizedList.push(...splitRawAuthorString(cleaned));
    } else {
      normalizedList.push(cleaned);
    }
  }

  if (normalizedList.length === 0) {
    const titleFallback = cleanFallbackTitle(fallbackTitle || inferredTitleFallback);
    if (titleFallback) return titleFallback;
    return lang === 'vi' ? 'Tài liệu tham khảo' : 'Reference';
  }

  const firstRaw = normalizedList[0];
  const firstIsInstitutional = isInstitutionalAuthor(firstRaw);
  const firstShort = extractShortSingleAuthor(firstRaw);

  if (!firstShort) {
    const titleFallback = cleanFallbackTitle(fallbackTitle || inferredTitleFallback);
    if (titleFallback) return titleFallback;
    return lang === 'vi' ? 'Tài liệu tham khảo' : 'Reference';
  }

  // Single institutional author (or Vietnamese institutional body with subordinate/duplicate organs):
  // ALWAYS keep intact, NEVER append "et al."
  if (
    firstIsInstitutional &&
    (normalizedList.length === 1 ||
      (VI_DIACRITIC_CHAR_RE.test(firstRaw) &&
        normalizedList.slice(1).every((a) => isInstitutionalAuthor(a))))
  ) {
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
        /URL\s+domain\s+['"]([^'"]+)['"]\s+is\s+(?:a\s+)?(?:placeholder\/fake|fake\/placeholder|fake|placeholder)\s+domain(?:\s*\(\s*example\.com,\s*test\.com,\s*localhost,\s*etc\.?\s*\)\s*and\s+does\s+not\s+belong\s+to\s+a\s+scholarly\s+registry)?\.?/gi,
        (fullMatch: string, domain: string) =>
          /does\s+not\s+belong\s+to\s+a\s+scholarly\s+registry/i.test(fullMatch)
            ? `Tên miền URL '${domain}' là tên miền mẫu hoặc không tồn tại thực tế (như example.com, test.com, localhost...) và không thuộc cơ sở dữ liệu học thuật.`
            : `Tên miền URL '${domain}' là tên miền mẫu hoặc không tồn tại thực tế.`,
      )
      .replace(
        /\(\s*example\.com,\s*test\.com,\s*localhost,\s*etc\.?\s*\)\s*and\s+does\s+not\s+belong\s+to\s+a\s+scholarly\s+registry\.?/gi,
        '(như example.com, test.com, localhost...) và không thuộc cơ sở dữ liệu học thuật.',
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
        /URL\s+domain\s+['"]([^'"]+)['"]\s+is\s+(?:a\s+)?(?:placeholder\/fake|fake\/placeholder|fake)\s+domain(?:\s*\(\s*example\.com,\s*test\.com,\s*localhost,\s*etc\.?\s*\)\s*and\s+does\s+not\s+belong\s+to\s+a\s+scholarly\s+registry)?\.?/gi,
        (fullMatch: string, domain: string) =>
          /does\s+not\s+belong\s+to\s+a\s+scholarly\s+registry/i.test(fullMatch)
            ? `URL domain '${domain}' is a placeholder or non-existent domain (example.com, test.com, localhost, etc.) and does not belong to a scholarly registry.`
            : `URL domain '${domain}' is a placeholder or non-existent domain.`,
      )
      .replace(/\bknown\s+fabricated\s+DOI\s+pattern\b/gi, 'invalid/unregistered DOI test prefix')
      .replace(/\(\s*HTTP\s+200\s+OK\s*\)/gi, '(link active)')
      .replace(/\bHTTP\s+200\s+OK\b/gi, 'Link Active')
      .replace(/\bfabricated\b/gi, 'invalid/unregistered')
      .replace(/\bhallucinated\b/gi, 'unmatched');
  }

  out = out
    .replace(/\)\)+/g, ')')
    .replace(/(?<!\.)\.\.(?!\.)/g, '.')
    .replace(/\s{2,}/g, ' ')
    .replace(/([A-Za-zÀ-ỹ]):(?=[A-Za-zÀ-ỹ])/g, '$1: ')
    .trim();

  return out;
}
