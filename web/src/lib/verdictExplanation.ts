import type { HtmlPageMetaPayload, MatchedSource, Verdict } from '@/api/client';
import i18n from '@/i18n';
import {
  getSourceDisplayName as getCanonicalSourceDisplayName,
  getVerdictDisplay,
  SOURCE_DISPLAY_LABELS,
} from '@/lib/academicTaxonomy';

function resolveLang(lang?: unknown): 'en' | 'vi' {
  if (lang === 'vi' || lang === 'en') return lang;
  return i18n.language?.startsWith('vi') ? 'vi' : 'en';
}

const SOURCE_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(SOURCE_DISPLAY_LABELS).map(([k, v]) => [k, v.en]),
);

const SOURCE_LABELS_VI: Record<string, string> = Object.fromEntries(
  Object.entries(SOURCE_DISPLAY_LABELS).map(([k, v]) => [k, v.vi]),
);

const FIELD_LABELS: Record<string, string> = {
  title: 'the title',
  authors: 'the authors',
  author: 'the authors',
  year: 'the publication year',
  doi: 'the DOI',
  venue: 'the venue',
  url: 'the link',
  content: 'the cited claim content',
  retracted: 'the retraction status (retracted publication)',
  retracted_paper: 'the retraction status (retracted publication)',
};

const FIELD_LABELS_VI: Record<string, string> = {
  title: 'tiêu đề',
  authors: 'tác giả',
  author: 'tác giả',
  year: 'năm xuất bản',
  doi: 'mã DOI',
  venue: 'nơi công bố',
  url: 'đường dẫn liên kết',
  content: 'nội dung trích dẫn',
  retracted: 'trạng thái rút bài (ấn phẩm đã bị rút)',
  retracted_paper: 'trạng thái rút bài (ấn phẩm đã bị rút)',
};

const RULE_LABELS: Record<string, string> = {
  'R-WELL-LINKED': 'Citation and publication details match closely',
  'R-WELL-LINKED-MODERATE': 'Citation and publication are a reasonable match',
  'R-DOI-TITLE-AUTHOR': 'DOI, title, and author details match',
  'R-CONSENSUS-FULL': 'Multiple academic libraries agree on the publication details',
  'R-CONSENSUS-PARTIAL': 'Multiple libraries agree, with a few citation details to review',
  'R-SINGLE-SOURCE-VERIFIED': 'High-confidence match verified in an academic library',
  'R-SINGLE-SOURCE-PARTIAL': 'Published record found, but author, year, or title differs',
  'R-BOOK-EDITION-VERIFIED': 'Published textbook or book edition verified',
  'R-LOCAL_DB_VERIFIED': 'Verified in the CITRA Scholarly Library',
  'R-LOCAL_DB_GOOD_MATCH': 'Strong match found in the CITRA Scholarly Library',
  'R-LOCAL_DB_METADATA_ERROR': 'Matched in the CITRA Scholarly Library, but some citation details differ',
  'R-LOCAL_DB': 'Matched in the CITRA Scholarly Library',
  'R-LOCAL_DB_ONLY': 'Verified via the CITRA Scholarly Library while external libraries were temporarily unavailable',
  'R-API_EXHAUSTED': 'External libraries were temporarily busy; verified using the CITRA Scholarly Library',
  'R-KNOWN-PAPER': 'Matches a widely cited published work in the CITRA Scholarly Library',
  'R-KNOWN-PAPER-NO-TITLE': 'Matches a well-known published work by author and year',
  'R-VN-LEGAL-FORMAT': 'Official statutory or legal document format verified',
  'R-LEGAL-DOCUMENT': 'Recognized Vietnamese statutory or government legal document',
  'R-VN-LEGAL-VERIFIED': 'Verified against the Vietnamese Legal Registry',
  'R-VN-LEGAL-MISMATCH': 'Vietnamese legal document found, but promulgation year, number, or agency differs',
  'R-VN-LEGAL-SUPERSEDED': 'Cited Vietnamese legal statute has been superseded or amended by a newer law',
  'R-VN-LEGAL-FABRICATED': 'Vietnamese legal document number or issuing authority could not be confirmed in the official legal registry',
  'R-LEGAL-STATUTE-VERIFIED': 'Official statutory or legal regulation verified against legal registry',
  'R-LEGAL-STATUTE-ERROR': 'Legal statute details differ or regulation has been superseded',
  'R-GLOBAL-DOI-RA-VERIFIED': 'Verified via the Global DOI Registry',
  'R-DOI-RA-NO-CSL': 'DOI is registered, but full publication details are not publicly available — please verify manually',
  'R-HF-VERIFIED': 'AI model, dataset, or paper verified on Hugging Face',
  'R-RFC-VERIFIED': 'Technical standard or software repository verified via IETF / PyPI / NPM / GitHub',
  'R-GITHUB-VERIFIED': 'Public software repository and citation file verified on GitHub',
  'R-PACKAGE-VERIFIED': 'Open-source software package details verified via PyPI / NPM',
  'R-SOFTWARE-PACKAGE-VERIFIED': 'Software package release details verified via PyPI / NPM',
  'R-WIKIDATA-VERIFIED': 'Standard, manual, or DOI verified via Wikidata / OpenCitations',
  'R-WIKIDATA-STANDARD-VERIFIED': 'Technical standard or manual verified via Wikidata',
  'R-OPENCITATIONS-VERIFIED': 'Citation record verified via OpenCitations',
  'R-WAYBACK-ARCHIVED': 'Original link was unavailable; verified via Web Archive (Wayback Machine)',
  'R-RETRACTED-PAPER': 'Notice: This publication has been officially retracted by the publisher',
  'R-KNOWN-AUTHOR-TITLE-MISMATCH': 'Author matches, but the title needs review',
  'R-KNOWN-AUTHOR-WEAK-EVIDENCE': 'Author is known, but supporting evidence is limited',
  'R-TITLE-MISMATCH': 'Author and year match a known work, but the cited title differs',
  'R-DOI-TITLE-MISMATCH': 'DOI matches, but the title needs review',
  'R-VENUE-MISMATCH': 'Cited journal or conference differs from the published record',
  'R-CHIMERIC-DOI-MISMATCH': 'Cited DOI points to a different publication than the one named in the reference',
  'R-FAKE-URL': 'The link uses a placeholder address or does not point to a real publication',
  'R-DEAD-URL': 'The cited link could not be reached and no matching publication was found',
  'R-BROKEN-LINK': 'The publication exists, but the cited web link could not be opened',
  'R-FABRICATED-DOI': 'The DOI prefix is invalid or unregistered',
  'R-NONEXISTENT-DOI': 'The cited DOI was not found in the Global DOI Registry',
  'R-NO-SCHOLARLY-RECORD': 'No matching publication was found across online academic libraries',
  'R-NO-CANDIDATE': 'No matching publications were found across the searched academic libraries',
  'R-FAIL-ALL': 'External academic libraries temporarily timed out during lookup',
  'R-RATE-LIMITED-ABSTAIN': 'Academic libraries were temporarily busy — marked for manual review',
  'R-WEAK-EVIDENCE': 'Possible matches were found, but details are too different to confirm automatically',
  'R-ABSTENTION-BORDER': 'Match confidence is borderline — please verify manually',
  'R-AMBIGUOUS-MAPPING': 'In-text citation could match multiple reference entries',
  'R-DOMAIN-EXCEPTION': 'DOI matched a real publication, though the title differs from the library record',
  'R-NON-SCHOLARLY-RESOURCE': 'General web resource or documentation link',
  'R-UNINDEXED-BOOK-OR-SOURCE': 'Potentially unindexed regional book, thesis, or print monograph',
  'R-URL-RESOURCE': 'Direct URL or web resource citation',
  'R-WEB-RESOURCE': 'Web documentation or online technical resource',
  'R-HALLUCINATED-SOURCE': 'No closely matching publication was found in online academic libraries',
  'R-FAKE-AUTHOR': 'Author details could not be matched to a published record',
  'R-FUTURE-YEAR': 'The publication year is in the future',
  'R-FUTURE-YEAR-KNOWN-AUTHOR': 'The publication year needs review',
  'R-CONTENT-ALIGNMENT': 'In-text context aligns with the source abstract',
  'R-CROSS-LINGUAL-ALIGNMENT': 'Vietnamese–English cross-lingual content alignment verified',
  'R-CROSS-LINGUAL-TITLE-MATCH': 'Translated title matches the original publication — keep the original title as published',
  'R-CONTENT-MISMATCH': 'The citation content does not match the publication',
  'R-STYLE-INCONSISTENT': 'The citation format differs from the document style',
  'R-INCOMPLETE-METADATA': 'Incomplete bibliographic reference — missing required author, publication year, or venue',
  'R-URL-CONTENT-MISMATCH': 'Cited web page title or details do not match the cited reference',
  'R-VN-STANDARD-VERIFIED': 'Vietnamese national technical standard or regulation (TCVN / QCVN) verified',
  'R-VN-TEXTBOOK-VERIFIED': 'Vietnamese university textbook or monograph verified',
  'R-YEAR-MISMATCH': 'Publication year in the citation differs from the published record',
  'R-DOI-METADATA-MISMATCH': 'Cited DOI differs from the published DOI of this work',
  'R-DOI-CONFLICT': 'Different DOI identifiers were found across academic libraries',
  R00_PRECONDITION_HALT: 'Stopped early due to missing required citation details',
  R01_EXACT_DOI: 'Exact DOI matched to the published record',
  R01_DOI_EXACT: 'Exact DOI matched to the published record',
  R01_DOI_MATCH: 'DOI identifier matches the published record',
  R04_AUTHOR_OVERLAP: 'Cited author list aligns with the published authors',
  R05_YEAR_DRIFT: 'Cited publication year differs from the published date',
  R07_VENUE_MISMATCH: 'Cited journal or conference differs from the published venue',
  R09_SEMANTIC_ALIGN: 'In-text claim aligns with the source abstract',
  R12_GHOST_DOI: 'Cited DOI was not found in the Global DOI Registry',
  R14_ZERO_TITLE_HIT: 'No published works match the cited title',
  R16_SYNTHETIC_PATTERN: 'Citation details do not follow a verifiable published record pattern',
};

const RULE_LABELS_VI: Record<string, string> = {
  'R-WELL-LINKED': 'Thông tin trích dẫn và ấn phẩm khớp chặt chẽ',
  'R-WELL-LINKED-MODERATE': 'Trích dẫn và ấn phẩm khớp ở mức hợp lý',
  'R-DOI-TITLE-AUTHOR': 'Mã DOI, tiêu đề và tác giả hoàn toàn trùng khớp',
  'R-CONSENSUS-FULL': 'Nhiều thư viện học thuật đồng thuận về thông tin ấn phẩm',
  'R-CONSENSUS-PARTIAL': 'Các thư viện học thuật đồng thuận một phần, cần rà soát lại một vài thông tin trích dẫn',
  'R-SINGLE-SOURCE-VERIFIED': 'Xác minh độ tin cậy cao trên thư viện học thuật',
  'R-SINGLE-SOURCE-PARTIAL': 'Tìm thấy bản ghi gốc nhưng sai lệch tác giả, năm hoặc tiêu đề',
  'R-BOOK-EDITION-VERIFIED': 'Đã xác minh ấn bản sách chuyên khảo hoặc giáo trình',
  'R-LOCAL_DB_VERIFIED': 'Đã xác minh khớp chính xác trong Thư viện học thuật CITRA',
  'R-LOCAL_DB_GOOD_MATCH': 'Tìm thấy bản ghi khớp cao trong Thư viện học thuật CITRA',
  'R-LOCAL_DB_METADATA_ERROR': 'Tìm thấy trong Thư viện học thuật CITRA nhưng có sai lệch thông tin trích dẫn',
  'R-LOCAL_DB': 'Tìm thấy kết quả đối chiếu trong Thư viện học thuật CITRA',
  'R-LOCAL_DB_ONLY': 'Đã xác minh qua Thư viện học thuật CITRA khi các thư viện trực tuyến tạm thời không phản hồi',
  'R-API_EXHAUSTED': 'Các thư viện học thuật bên ngoài tạm thời bận; đã đối chiếu qua Thư viện học thuật CITRA',
  'R-KNOWN-PAPER': 'Khớp với công trình nghiên cứu đã xuất bản trong Thư viện học thuật CITRA',
  'R-KNOWN-PAPER-NO-TITLE': 'Khớp với công trình đã xuất bản theo tác giả và năm',
  'R-VN-LEGAL-FORMAT': 'Định dạng văn bản quy phạm pháp luật hợp lệ',
  'R-LEGAL-DOCUMENT': 'Nhận diện văn bản quy phạm pháp luật Việt Nam',
  'R-VN-LEGAL-VERIFIED': 'Đã xác minh đối chiếu với Thư viện văn bản pháp luật Việt Nam',
  'R-VN-LEGAL-MISMATCH': 'Tìm thấy văn bản pháp luật nhưng sai lệch năm ban hành, số hiệu hoặc cơ quan ban hành',
  'R-VN-LEGAL-SUPERSEDED': 'Văn bản pháp luật được trích dẫn đã hết hiệu lực hoặc bị thay thế bởi văn bản mới hơn',
  'R-VN-LEGAL-FABRICATED': 'Số hiệu hoặc cơ quan ban hành văn bản pháp luật không khớp với hệ thống văn bản pháp luật hiện hành',
  'R-LEGAL-STATUTE-VERIFIED': 'Đã xác minh văn bản pháp quy / quy định pháp luật chính thức',
  'R-LEGAL-STATUTE-ERROR': 'Thông tin văn bản pháp luật chưa khớp hoặc văn bản đã hết hiệu lực',
  'R-GLOBAL-DOI-RA-VERIFIED': 'Đã xác minh qua Hệ thống đăng ký DOI quốc tế',
  'R-DOI-RA-NO-CSL': 'Mã DOI đã được đăng ký nhưng chưa có thông tin thư mục công khai — vui lòng kiểm tra thủ công',
  'R-HF-VERIFIED': 'Đã xác minh mô hình AI, bộ dữ liệu hoặc bài báo trên Hugging Face',
  'R-RFC-VERIFIED': 'Đã xác minh tiêu chuẩn kỹ thuật hoặc gói phần mềm qua IETF / PyPI / NPM / GitHub',
  'R-GITHUB-VERIFIED': 'Đã xác minh kho mã nguồn công khai và thông tin trích dẫn trên GitHub',
  'R-PACKAGE-VERIFIED': 'Đã xác minh thông tin gói phần mềm mã nguồn mở trên PyPI / NPM',
  'R-SOFTWARE-PACKAGE-VERIFIED': 'Đã xác minh thông tin phiên bản gói phần mềm trên PyPI / NPM',
  'R-WIKIDATA-VERIFIED': 'Đã xác minh tiêu chuẩn quốc tế, tài liệu chuyên ngành hoặc DOI qua Wikidata / OpenCitations',
  'R-WIKIDATA-STANDARD-VERIFIED': 'Đã xác minh tiêu chuẩn kỹ thuật qua Wikidata',
  'R-OPENCITATIONS-VERIFIED': 'Đã xác minh bản ghi trích dẫn qua OpenCitations',
  'R-WAYBACK-ARCHIVED': 'Đường dẫn gốc tạm không mở được nhưng đã xác minh qua Kho lưu trữ web (Wayback)',
  'R-RETRACTED-PAPER': 'Cảnh báo: Ấn phẩm này đã chính thức bị rút bài khỏi tạp chí/nhà xuất bản',
  'R-KNOWN-AUTHOR-TITLE-MISMATCH': 'Khớp tác giả nhưng tiêu đề bài báo có sai lệch cần kiểm tra lại',
  'R-KNOWN-AUTHOR-WEAK-EVIDENCE': 'Tác giả có thực nhưng bằng chứng đối chiếu bài báo còn hạn chế',
  'R-TITLE-MISMATCH': 'Khớp tác giả và năm với công trình đã biết nhưng tiêu đề trích dẫn bị sai lệch',
  'R-DOI-TITLE-MISMATCH': 'Mã DOI hợp lệ nhưng tiêu đề không khớp với bản ghi gốc',
  'R-VENUE-MISMATCH': 'Tên tạp chí hoặc hội nghị trích dẫn khác với bản ghi gốc',
  'R-CHIMERIC-DOI-MISMATCH': 'Mã DOI trỏ tới một bài báo khác với tài liệu được nêu trong trích dẫn',
  'R-FAKE-URL': 'Đường dẫn URL là địa chỉ mẫu hoặc không dẫn tới nguồn tài liệu thực tế',
  'R-DEAD-URL': 'Đường dẫn trích dẫn hiện không truy cập được và chưa tìm thấy bản ghi học thuật tương ứng',
  'R-BROKEN-LINK': 'Bài báo có tồn tại nhưng đường dẫn đi kèm hiện không mở được',
  'R-FABRICATED-DOI': 'Mã DOI sử dụng định dạng hoặc tiền tố chưa được đăng ký hợp lệ',
  'R-NONEXISTENT-DOI': 'Không tìm thấy mã DOI này trong Hệ thống đăng ký DOI quốc tế',
  'R-NO-SCHOLARLY-RECORD': 'Không tìm thấy bản ghi khớp trên các thư viện học thuật trực tuyến',
  'R-NO-CANDIDATE': 'Không tìm thấy bài báo nào khớp trên các thư viện học thuật đã tra cứu',
  'R-FAIL-ALL': 'Các thư viện học thuật trực tuyến tạm thời không phản hồi trong quá trình tra cứu',
  'R-RATE-LIMITED-ABSTAIN': 'Các thư viện học thuật đang tạm thời bận — chuyển sang cần kiểm tra thủ công',
  'R-WEAK-EVIDENCE': 'Tìm thấy một số tài liệu gần giống nhưng thông tin chưa đủ khớp để xác nhận tự động',
  'R-ABSTENTION-BORDER': 'Mức độ khớp chưa đủ rõ ràng — vui lòng kiểm tra thủ công',
  'R-AMBIGUOUS-MAPPING': 'Trích dẫn trong bài có thể khớp với nhiều mục tài liệu tham khảo khác nhau',
  'R-DOMAIN-EXCEPTION': 'Mã DOI khớp với bài gốc nhưng tiêu đề khác so với bản ghi thư viện — vui lòng kiểm tra nhanh',
  'R-NON-SCHOLARLY-RESOURCE': 'Trang web thông thường hoặc tài liệu hướng dẫn trực tuyến',
  'R-UNINDEXED-BOOK-OR-SOURCE': 'Có thể là sách in, giáo trình nội bộ hoặc luận văn chưa có bản trực tuyến',
  'R-URL-RESOURCE': 'Trích dẫn trực tiếp đường dẫn URL hoặc trang web tham khảo',
  'R-WEB-RESOURCE': 'Tài liệu kỹ thuật trực tuyến hoặc trang web tham khảo',
  'R-HALLUCINATED-SOURCE': 'Không tìm thấy ấn phẩm đủ khớp trên các thư viện học thuật trực tuyến',
  'R-FAKE-AUTHOR': 'Thông tin tác giả chưa khớp với bản ghi xuất bản nào',
  'R-FUTURE-YEAR': 'Năm xuất bản nằm trong tương lai (không hợp lệ)',
  'R-FUTURE-YEAR-KNOWN-AUTHOR': 'Năm xuất bản nằm trong tương lai đối với tác giả đã biết — cần kiểm tra lại năm',
  'R-CONTENT-ALIGNMENT': 'Ngữ cảnh trích dẫn trong bài phù hợp với nội dung tóm tắt của bài gốc',
  'R-CROSS-LINGUAL-ALIGNMENT': 'Đã xác minh nội dung tương đồng xuyên ngôn ngữ Việt – Anh',
  'R-CROSS-LINGUAL-TITLE-MATCH': 'Tiêu đề dịch tiếng Việt khớp với bài gốc — nên giữ nguyên tiêu đề gốc theo chuẩn trích dẫn học thuật',
  'R-CONTENT-MISMATCH': 'Nội dung khẳng định trong bài chưa khớp với nội dung thực tế của ấn phẩm được trích dẫn',
  'R-STYLE-INCONSISTENT': 'Định dạng trích dẫn không đồng nhất với chuẩn trình bày chung của bài viết',
  'R-INCOMPLETE-METADATA': 'Thiếu quy cách trích dẫn — thiếu tác giả, năm xuất bản hoặc nơi công bố',
  'R-URL-CONTENT-MISMATCH': 'Tiêu đề hoặc thông tin của trang web không khớp với tài liệu được trích dẫn',
  'R-VN-STANDARD-VERIFIED': 'Đã xác minh Tiêu chuẩn / Quy chuẩn Kỹ thuật Quốc gia Việt Nam (TCVN / QCVN)',
  'R-VN-TEXTBOOK-VERIFIED': 'Đã xác minh giáo trình đại học hoặc sách chuyên khảo tại Việt Nam',
  'R-YEAR-MISMATCH': 'Năm xuất bản trong trích dẫn khác với bản ghi gốc',
  'R-DOI-METADATA-MISMATCH': 'Mã DOI trích dẫn khác với mã DOI chính thức của bản ghi gốc',
  'R-DOI-CONFLICT': 'Các thư viện học thuật ghi nhận mã DOI khác nhau cho tài liệu này',
  R00_PRECONDITION_HALT: 'Tạm dừng đối chiếu do thiếu thông tin nhận dạng tối thiểu',
  R01_EXACT_DOI: 'Mã DOI khớp chính xác với bản ghi gốc',
  R01_DOI_EXACT: 'Mã DOI khớp chính xác với bản ghi gốc',
  R01_DOI_MATCH: 'Mã DOI khớp với bản ghi gốc trên thư viện học thuật',
  R04_AUTHOR_OVERLAP: 'Danh sách tác giả trích dẫn khớp với tác giả trên bản ghi gốc',
  R05_YEAR_DRIFT: 'Năm xuất bản ghi trong bài bị lệch so với bản ghi gốc',
  R07_VENUE_MISMATCH: 'Tên tạp chí hoặc kỷ yếu trích dẫn khác với bản ghi gốc',
  R09_SEMANTIC_ALIGN: 'Nội dung câu trích dẫn phù hợp với tóm tắt bài báo gốc',
  R12_GHOST_DOI: 'Mã DOI không tồn tại trong Hệ thống đăng ký DOI quốc tế',
  R14_ZERO_TITLE_HIT: 'Không có công trình học thuật nào khớp với tiêu đề được trích dẫn',
  R16_SYNTHETIC_PATTERN: 'Thông tin trích dẫn có dấu hiệu bất thường và chưa khớp với bản ghi xuất bản nào',
};

export function getSourceDisplayName(
  source: string,
  lang?: 'en' | 'vi',
  context?: {
    triggered_rules?: string[];
    external_ids?: Record<string, string>;
    venue?: string | null;
    title?: string | null;
  },
): string {
  const resolved = resolveLang(lang);
  const canonical = getCanonicalSourceDisplayName(source, resolved, context);
  if (canonical !== source) {
    return canonical;
  }
  const key = source.toLowerCase();
  return (resolved === 'vi' ? SOURCE_LABELS_VI[key] : SOURCE_LABELS[key]) ?? source;
}

function matchedSourceNames(verdict: Verdict, lang: 'en' | 'vi'): string[] {
  return (verdict.matched_sources ?? [])
    .filter((s) => s.source !== 'web_html_meta' && s.source !== 'wayback_html_meta')
    .map((source) =>
      getSourceDisplayName(source.source, lang, {
        triggered_rules: verdict.triggered_rules,
        external_ids: source.external_ids,
        venue: source.venue,
        title: source.title,
      }),
    );
}

export function isLegalStatuteVerdict(verdict: {
  label?: string;
  triggered_rules?: string[];
}): boolean {
  return (verdict.triggered_rules ?? []).some((r) => r.includes('LEGAL'));
}

/** Treat URL-only / resource rows as web resources, excluding legal statutes and dead/fake URL errors. */
export function isUrlResource(verdict: {
  citation_raw: string;
  label: string;
  triggered_rules?: string[];
}): boolean {
  if (isLegalStatuteVerdict(verdict)) return false;
  if (verdict.label === 'suspected_hallucination' || verdict.label === 'metadata_error') {
    return false;
  }
  if (verdict.label === 'resource') return true;
  const raw = (verdict.citation_raw ?? '').trim().replace(/[.,;:)"']+$/, '');
  return /^(?:https?:\/\/|www\.)\S+$/i.test(raw);
}

export interface ObservedWebMeta {
  title: string | null;
  authors: string[];
  year: string | null;
  venue: string | null;
  doi: string | null;
  url: string | null;
  isArchived: boolean;
}

export function extractObservedWebMeta(verdict: {
  html_meta?: HtmlPageMetaPayload | null;
  archive_url?: string | null;
  cited_url?: string | null;
  url_status?: string | null;
  matched_sources?: MatchedSource[];
  matched_source?: MatchedSource | null;
  features?: Verdict['features'];
}): ObservedWebMeta | null {
  const rawMeta = verdict.html_meta ?? verdict.features?.html_meta ?? null;
  const webSource =
    (verdict.matched_sources ?? []).find(
      (s) => s.source === 'web_html_meta' || s.source === 'wayback_html_meta',
    ) ??
    (verdict.matched_source &&
    (verdict.matched_source.source === 'web_html_meta' ||
      verdict.matched_source.source === 'wayback_html_meta')
      ? verdict.matched_source
      : null);

  if (!rawMeta && !webSource) return null;
  if (rawMeta?.is_soft_404) return null;

  const title =
    (rawMeta?.citation_title || rawMeta?.page_title || webSource?.title || '').trim() || null;
  const rawAuthors = rawMeta?.citation_authors ?? rawMeta?.authors ?? webSource?.authors ?? [];
  const authors = Array.isArray(rawAuthors)
    ? rawAuthors.map((a) => String(a).trim()).filter(Boolean)
    : [];
  const rawYear = rawMeta?.published_year ?? rawMeta?.year ?? webSource?.year ?? null;
  const year = rawYear != null && String(rawYear).trim() ? String(rawYear).trim() : null;
  const venue = (rawMeta?.site_name || webSource?.venue || '').trim() || null;
  const doi = (rawMeta?.citation_doi || rawMeta?.doi || webSource?.doi || '').trim() || null;
  const url =
    (
      verdict.archive_url ||
      verdict.features?.archive_url ||
      rawMeta?.canonical_url ||
      webSource?.url ||
      verdict.cited_url ||
      ''
    ).trim() || null;

  if (!title && authors.length === 0 && !year && !venue && !doi) {
    return null;
  }

  const urlStatus = verdict.url_status ?? verdict.features?.url_status;
  const hasArchiveUrl = Boolean(verdict.archive_url || verdict.features?.archive_url);
  return {
    title,
    authors,
    year,
    venue,
    doi,
    url,
    isArchived:
      urlStatus === 'archived_alive' ||
      webSource?.source === 'wayback_html_meta' ||
      (hasArchiveUrl && urlStatus !== 'alive' && urlStatus !== 'restricted_alive'),
  };
}

/**
 * Formats bibliography / verdict index badge (`[14a]`, `[14b]`, `[15]`), preserving
 * composite sub-reference labels across EssayPage, DocumentInspector, OrphanDetection, Issues, and SharedReport.
 */
export function getCitationMarkerLabel(
  item: {
    composite_label?: string | null;
    numeric_index?: number | null;
    sub_index?: string | null;
    citation_raw?: string | null;
    raw_text?: string | null;
    reference_id?: string | null;
    citation_link?: { reference_id?: string | null } | null;
    features?: {
      composite_label?: string | null;
      numeric_index?: number | null;
      sub_index?: string | null;
    } | null;
  },
  fallbackIndex?: number,
): string {
  const comp = (item.composite_label || item.features?.composite_label || '').trim();
  if (comp) return comp.startsWith('[') ? comp : `[${comp}]`;

  const numIdx = item.numeric_index ?? item.features?.numeric_index;
  const subIdx = (item.sub_index || item.features?.sub_index || '').trim();
  if (typeof numIdx === 'number' && Number.isFinite(numIdx) && numIdx > 0) {
    return `[${numIdx}${subIdx}]`;
  }

  const raw = (item.citation_raw ?? item.raw_text ?? '').trim();
  const bracketMatch = raw.match(/^\[\s*(\d+[a-z]?)\s*\]/i);
  if (bracketMatch?.[1]) return `[${bracketMatch[1]}]`;

  const refId = item.reference_id || item.citation_link?.reference_id || '';
  const refNumMatch = refId.match(/^ref-0*(\d+[a-z]?)$/i);
  if (refNumMatch?.[1]) return `[${refNumMatch[1]}]`;

  if (typeof fallbackIndex === 'number') return `[${fallbackIndex + 1}]`;
  return '[?]';
}

export function getFieldDisplayName(field: string, lang?: 'en' | 'vi'): string {
  const resolved = resolveLang(lang);
  const dict = resolved === 'vi' ? FIELD_LABELS_VI : FIELD_LABELS;
  return dict[field.toLowerCase()] ?? field;
}

export function getRuleDisplayName(rule: string, lang?: 'en' | 'vi' | number): string {
  const resolved = resolveLang(lang);
  if (resolved === 'vi') {
    return RULE_LABELS_VI[rule] ?? RULE_LABELS[rule] ?? 'Đã áp dụng quy tắc kiểm tra bổ sung';
  }
  return RULE_LABELS[rule] ?? 'An additional verification check was applied';
}

export function getVerdictDisplayName(label: string, lang?: 'en' | 'vi'): string {
  const resolved = resolveLang(lang);
  return getVerdictDisplay(label, resolved).label;
}

export interface PlainVerdictLabel {
  label: string;
  actionHint: string;
  technicalCode: string;
}

export interface PlainMappingLabel {
  label: string;
  actionHint: string;
  technicalCode: string;
}

interface BilingualPlainEntry {
  technicalCode: string;
  en: { label: string; actionHint: string };
  vi: { label: string; actionHint: string };
}

const PLAIN_VERDICT_ENTRIES: Record<string, BilingualPlainEntry> = {
  VERIFIED: {
    technicalCode: 'VERIFIED',
    en: {
      label: 'Verified',
      actionHint:
        'Matched with a real publication; author, year, and title are consistent.',
    },
    vi: {
      label: 'Đã xác minh',
      actionHint:
        'Đã đối chiếu khớp với ấn phẩm thực tế về tác giả, năm xuất bản và tiêu đề.',
    },
  },
  LIKELY_VERIFIED: {
    technicalCode: 'LIKELY_VERIFIED',
    en: {
      label: 'Likely Verified',
      actionHint:
        'Closely matches a real publication; consider adding a DOI or direct link.',
    },
    vi: {
      label: 'Độ khớp cao',
      actionHint:
        'Khớp chặt với ấn phẩm thực tế; nên bổ sung thêm mã DOI hoặc đường dẫn gốc.',
    },
  },
  METADATA_ERROR: {
    technicalCode: 'METADATA_ERROR',
    en: {
      label: 'Details Mismatch',
      actionHint:
        'We found the source, but its author, year, title, or DOI differs—review and update the entry.',
    },
    vi: {
      label: 'Sai lệch thông tin',
      actionHint:
        'Tài liệu có thật nhưng tác giả, năm xuất bản, tiêu đề hoặc mã DOI chưa khớp với bản gốc; hãy kiểm tra và cập nhật lại.',
    },
  },
  SOURCE_MISMATCH: {
    technicalCode: 'SOURCE_MISMATCH',
    en: {
      label: 'Wrong Source Linked',
      actionHint:
        'The link or DOI points to a different work than the title cited—verify the source.',
    },
    vi: {
      label: 'Nhầm nguồn trích dẫn',
      actionHint:
        'Đường dẫn hoặc mã DOI đang trỏ sang một tài liệu khác với tên bài được trích dẫn; hãy kiểm tra lại nguồn.',
    },
  },
  SUSPECTED_HALLUCINATION: {
    technicalCode: 'SUSPECTED_HALLUCINATION',
    en: {
      label: 'Source Not Found',
      actionHint:
        'No matching publication was found in academic libraries—verify the original paper or replace this citation.',
    },
    vi: {
      label: 'Không tìm thấy nguồn',
      actionHint:
        'Không tìm thấy tài liệu này trên các thư viện học thuật; hãy kiểm tra lại bản gốc hoặc thay thế nguồn trích dẫn.',
    },
  },
  UNRESOLVED: {
    technicalCode: 'UNRESOLVED',
    en: {
      label: 'Unverified',
      actionHint:
        'This may be a print book, thesis, or local document not indexed online—please verify manually.',
    },
    vi: {
      label: 'Chưa đủ dữ liệu',
      actionHint:
        'Có thể là sách in, giáo trình nội bộ hoặc luận văn chưa có bản trực tuyến; vui lòng đối chiếu thủ công.',
    },
  },
  UNVERIFIABLE: {
    technicalCode: 'UNVERIFIABLE',
    en: {
      label: 'Unverified',
      actionHint:
        'This may be a print book, thesis, or local document not indexed online—please verify manually.',
    },
    vi: {
      label: 'Chưa đủ dữ liệu',
      actionHint:
        'Có thể là sách in, giáo trình nội bộ hoặc luận văn chưa có bản trực tuyến; vui lòng đối chiếu thủ công.',
    },
  },
  RESOURCE: {
    technicalCode: 'RESOURCE',
    en: {
      label: 'Web / Legal Source',
      actionHint:
        'Recognized as a general web link or official regulation rather than a journal article (not penalized in your score).',
    },
    vi: {
      label: 'Nguồn Web / Văn bản',
      actionHint:
        'Đây là trang web hoặc văn bản quy định chung thay vì bài báo học thuật (không bị tính điểm trừ).',
    },
  },
};

const PLAIN_VERDICT_ALIASES: Record<string, string> = {
  HALLUCINATED: 'SUSPECTED_HALLUCINATION',
  LIKELY_HALLUCINATED: 'SUSPECTED_HALLUCINATION',
  SUSPECTED: 'SUSPECTED_HALLUCINATION',
  URL_RESOURCE: 'RESOURCE',
  WEB_RESOURCE: 'RESOURCE',
};

const PLAIN_MAPPING_ENTRIES: Record<string, BilingualPlainEntry> = {
  MATCHED: {
    technicalCode: 'MATCHED',
    en: {
      label: 'Linked to Bibliography',
      actionHint:
        'In-text citation cleanly connects to its matching bibliography entry.',
    },
    vi: {
      label: 'Đã khớp danh mục tham khảo',
      actionHint:
        'Trích dẫn trong bài đã kết nối chính xác với mục tương ứng ở cuối bài.',
    },
  },
  MISSING_REFERENCE: {
    technicalCode: 'MISSING_REFERENCE',
    en: {
      label: 'Missing from Bibliography',
      actionHint:
        'Cited in the essay body, but missing from your final reference list—add the full entry at the end.',
    },
    vi: {
      label: 'Thiếu ở danh mục tham khảo',
      actionHint:
        'Đã trích dẫn trong bài viết nhưng chưa liệt kê ở danh mục tài liệu tham khảo cuối bài; hãy bổ sung mục này vào cuối bài.',
    },
  },
  UNCITED_REFERENCE: {
    technicalCode: 'UNCITED_REFERENCE',
    en: {
      label: 'Listed but Never Cited',
      actionHint:
        'Appears in your bibliography, but is never cited in the essay text—cite it in-text or remove it.',
    },
    vi: {
      label: 'Có ở danh mục nhưng chưa trích dẫn',
      actionHint:
        'Có tên trong danh mục tham khảo cuối bài nhưng chưa được trích dẫn ở đoạn văn nào trong bài; hãy trích dẫn trong bài hoặc lược bỏ.',
    },
  },
  IN_TEXT_MISMATCH: {
    technicalCode: 'IN_TEXT_MISMATCH',
    en: {
      label: 'In-Text Author or Year Mismatch',
      actionHint:
        'The author spelling or year in your sentence differs from the bibliography entry—make both match.',
    },
    vi: {
      label: 'Lệch tên tác giả hoặc năm trong bài',
      actionHint:
        'Tên tác giả hoặc năm viết trong câu văn chưa khớp với mục tương ứng ở danh mục tham khảo; hãy chỉnh lại cho khớp.',
    },
  },
  DUPLICATE_REFERENCE: {
    technicalCode: 'DUPLICATE_REFERENCE',
    en: {
      label: 'Duplicate Bibliography Entry',
      actionHint:
        'This work is listed more than once in your reference list—merge the duplicate entries.',
    },
    vi: {
      label: 'Trùng lặp mục tham khảo',
      actionHint:
        'Tài liệu này đang bị liệt kê nhiều lần trong danh mục tham khảo; hãy gộp lại thành một mục.',
    },
  },
  AMBIGUOUS_MAPPING: {
    technicalCode: 'AMBIGUOUS_MAPPING',
    en: {
      label: 'Matches Multiple References',
      actionHint:
        'This in-text citation could refer to two or more bibliography entries—add a year suffix (e.g., 2023a, 2023b) to clarify.',
    },
    vi: {
      label: 'Khớp với nhiều mục tham khảo',
      actionHint:
        'Trích dẫn trong bài có thể chỉ tới nhiều tài liệu cùng tác giả/năm; hãy thêm ký hiệu phân biệt (như 2023a, 2023b).',
    },
  },
  STYLE_INCONSISTENT: {
    technicalCode: 'STYLE_INCONSISTENT',
    en: {
      label: 'Inconsistent Citation Style',
      actionHint:
        'This citation mixes formatting styles (such as APA and IEEE)—format all citations with one consistent style.',
    },
    vi: {
      label: 'Chưa đồng nhất chuẩn trình bày',
      actionHint:
        'Cách ghi trích dẫn này khác chuẩn chung của bài viết (ví dụ trộn lẫn kiểu số [1] và kiểu tên–năm); hãy thống nhất một chuẩn.',
    },
  },
  UNRESOLVED: {
    technicalCode: 'UNRESOLVED',
    en: {
      label: 'Needs Link Check',
      actionHint:
        'Could not automatically connect this citation to a bibliography entry—please check the pairing manually.',
    },
    vi: {
      label: 'Cần kiểm tra liên kết thủ công',
      actionHint:
        'Chưa thể tự động nối trích dẫn này với danh mục cuối bài; vui lòng kiểm tra lại thủ công.',
    },
  },
};

const PLAIN_MAPPING_ALIASES: Record<string, string> = {
  LINKED: 'MATCHED',
  MISSING: 'MISSING_REFERENCE',
  MISSING_REF: 'MISSING_REFERENCE',
  UNCITED: 'UNCITED_REFERENCE',
  UNCITED_REF: 'UNCITED_REFERENCE',
  MISMATCH: 'IN_TEXT_MISMATCH',
  DUPLICATE: 'DUPLICATE_REFERENCE',
  AMBIGUOUS: 'AMBIGUOUS_MAPPING',
  STYLE: 'STYLE_INCONSISTENT',
  STYLE_ISSUE: 'STYLE_INCONSISTENT',
};

function normalizeStatusCode(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

// ES2020-compatible equivalent of Object.hasOwn (web/tsconfig.json targets ES2020)
function hasOwnKey<T extends object>(
  record: T,
  key: PropertyKey,
): key is keyof T {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function getPlainVerdictLabel(
  verdict: string,
  lang?: 'en' | 'vi',
): PlainVerdictLabel {
  const resolved = resolveLang(lang);
  const normalized = normalizeStatusCode(verdict);
  const canonicalKey = hasOwnKey(PLAIN_VERDICT_ALIASES, normalized)
    ? PLAIN_VERDICT_ALIASES[normalized]
    : normalized;
  const entry = hasOwnKey(PLAIN_VERDICT_ENTRIES, canonicalKey)
    ? PLAIN_VERDICT_ENTRIES[canonicalKey]
    : undefined;
  if (entry) {
    const copy = resolved === 'vi' ? entry.vi : entry.en;
    return {
      label: copy.label,
      actionHint: copy.actionHint,
      technicalCode: entry.technicalCode,
    };
  }
  const fallback = PLAIN_VERDICT_ENTRIES.UNRESOLVED;
  const copy = resolved === 'vi' ? fallback.vi : fallback.en;
  return {
    label: copy.label,
    actionHint: copy.actionHint,
    technicalCode: normalized || 'UNRESOLVED',
  };
}

export function getPlainMappingLabel(
  status: string,
  lang?: 'en' | 'vi',
): PlainMappingLabel {
  const resolved = resolveLang(lang);
  const normalized = normalizeStatusCode(status);
  const canonicalKey = hasOwnKey(PLAIN_MAPPING_ALIASES, normalized)
    ? PLAIN_MAPPING_ALIASES[normalized]
    : normalized;
  const entry = hasOwnKey(PLAIN_MAPPING_ENTRIES, canonicalKey)
    ? PLAIN_MAPPING_ENTRIES[canonicalKey]
    : undefined;
  if (entry) {
    const copy = resolved === 'vi' ? entry.vi : entry.en;
    return {
      label: copy.label,
      actionHint: copy.actionHint,
      technicalCode: entry.technicalCode,
    };
  }
  const fallback = PLAIN_MAPPING_ENTRIES.UNRESOLVED;
  const copy = resolved === 'vi' ? fallback.vi : fallback.en;
  return {
    label: copy.label,
    actionHint: copy.actionHint,
    technicalCode: normalized || 'UNRESOLVED',
  };
}

const PLURAL_EN_FIELDS = new Set(['authors', 'author']);

function isEnFieldPhrasePlural(rawFields: string[]): boolean {
  const unique = [...new Set(rawFields.map((field) => field.toLowerCase()).filter(Boolean))];
  if (unique.length === 0) return true; // "the available details"
  if (unique.length > 1) return true; // "X and Y"
  return PLURAL_EN_FIELDS.has(unique[0]);
}

function capitalizeSentence(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function fieldLabels(fields: string[], lang: 'en' | 'vi'): string {
  const dict = lang === 'vi' ? FIELD_LABELS_VI : FIELD_LABELS;
  const labels = [...new Set(fields.map((field) => dict[field.toLowerCase()] ?? field))];
  if (lang === 'vi') {
    if (labels.length === 0) return 'các thông tin hiện có';
    if (labels.length === 1) return labels[0];
    if (labels.length === 2) return `${labels[0]} và ${labels[1]}`;
    return `${labels.slice(0, -1).join(', ')} và ${labels[labels.length - 1]}`;
  }
  if (labels.length === 0) return 'the available details';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

/**
 * Converts internal validation reasoning into a short explanation for people
 * reading the report. The raw reasoning remains available to the backend.
 */
export function getVerdictExplanation(verdict: Verdict, lang?: 'en' | 'vi'): string {
  const resolved = resolveLang(lang);
  const sources = matchedSourceNames(verdict, resolved);
  const rawMismatchedFields = verdict.mismatched_fields ?? [];
  const rawMatchedFields = (verdict.matched_sources ?? []).flatMap(
    (source) => source.matched_fields ?? [],
  );
  const fields = fieldLabels(rawMismatchedFields, resolved);
  const matchedFields = fieldLabels(rawMatchedFields, resolved);

  const urlStatus = verdict.url_status ?? verdict.features?.url_status;
  const archiveUrl = verdict.archive_url ?? verdict.features?.archive_url;
  const isRetracted =
    Boolean(verdict.is_retracted ?? verdict.features?.is_retracted) ||
    Boolean((verdict.triggered_rules ?? []).includes('R-RETRACTED-PAPER'));

  if (resolved === 'vi') {
    const retractionNoteVi = isRetracted
      ? ' CẢNH BÁO RÚT BÀI: Ấn phẩm này đã chính thức bị rút bài trong thư viện học thuật.'
      : '';
    const linkNoteVi =
      urlStatus === 'alive'
        ? ' Liên kết trang web đang hoạt động.'
        : urlStatus === 'restricted_alive'
          ? ' Liên kết đang hoạt động (trang yêu cầu đăng nhập hoặc trả phí nhà xuất bản).'
          : urlStatus === 'archived_alive'
            ? ` Đường dẫn gốc hiện không mở được, nhưng đã xác minh bản lưu trên Kho lưu trữ web (Wayback)${archiveUrl ? ` (${archiveUrl})` : ''}.`
            : urlStatus === 'dead_link'
              ? ' Cảnh báo: Đường dẫn trích dẫn hiện không thể truy cập.'
              : urlStatus === 'fake_domain'
                ? ' Cảnh báo: Đường dẫn trích dẫn sử dụng tên miền mẫu hoặc không tồn tại.'
                : '';

    const observedWeb = extractObservedWebMeta(verdict);

    if (verdict.label === 'resource' && isLegalStatuteVerdict(verdict)) {
      const cleanLegalRaw = verdict.citation_raw.replace(/^\[\d+[a-z]?\]\s*/i, '').replace(/\.$/, '');
      return `Nhận diện văn bản quy phạm pháp luật Việt Nam hợp lệ (${cleanLegalRaw}). Văn bản pháp luật được phân loại là nguồn quy phạm chính thức và không ảnh hưởng điểm trích dẫn.${linkNoteVi}${retractionNoteVi}`;
    }

    if (isUrlResource(verdict)) {
      const resolvedMetaVi = observedWeb?.title
        ? ` Tiêu đề trang web: "${observedWeb.title}"${observedWeb.venue ? ` (${observedWeb.venue})` : ''}.`
        : '';
      return `Phát hiện nguồn trang web: ${verdict.citation_raw}. Đây không phải trích dẫn bài báo học thuật và không ảnh hưởng điểm trích dẫn.${resolvedMetaVi}${linkNoteVi}${retractionNoteVi}`;
    }

    if (verdict.mapping_status === 'missing_reference') {
      return 'Trích dẫn trong bài này không có mục tương ứng trong danh mục tài liệu tham khảo.';
    }

    if (verdict.mapping_status === 'ambiguous_mapping') {
      return 'Trích dẫn có thể khớp với nhiều mục trong danh mục tài liệu tham khảo nên hệ thống không tự động gán.';
    }

    switch (verdict.label) {
      case 'verified':
        if (sources.length === 0) {
          return `Trích dẫn được liên kết với danh mục tham khảo và vượt qua các bước kiểm tra hiện có.${linkNoteVi}${retractionNoteVi}`;
        }
        if (sources.every((source) => source === SOURCE_LABELS_VI.local_db)) {
          return `Tìm thấy ấn phẩm khớp trong ${sources[0]}. Thông tin ${matchedFields} nhất quán với trích dẫn.${linkNoteVi}${retractionNoteVi}`;
        }
        return `Tìm thấy ấn phẩm khớp trên ${sources.join(' và ')}. Thông tin ${matchedFields} nhất quán với trích dẫn.${linkNoteVi}${retractionNoteVi}`;

      case 'metadata_error':
        if ((verdict.triggered_rules ?? []).includes('R-INCOMPLETE-METADATA')) {
          const missingDetail =
            rawMismatchedFields.length > 0 ? ` (thiếu ${fields})` : '';
          return (
            `Thiếu quy cách trích dẫn${missingDetail}: mục tham khảo chưa đủ thông tin định danh học thuật (tác giả, năm xuất bản, nơi công bố hoặc DOI/URL). Đây chỉ là thiếu sót về trình bày trích dẫn — vui lòng bổ sung đầy đủ thông tin.` +
            linkNoteVi +
            retractionNoteVi
          );
        }
        if ((verdict.triggered_rules ?? []).includes('R-URL-CONTENT-MISMATCH')) {
          const observedTitleNoteVi = observedWeb?.title
            ? ` (trang web thực tế có tiêu đề: "${observedWeb.title}"${observedWeb.venue ? ` — ${observedWeb.venue}` : ''})`
            : '';
          return (
            `Nội dung hoặc tiêu đề thực tế của trang web đính kèm${observedTitleNoteVi} không khớp với tiêu đề tài liệu được trích dẫn. Vui lòng kiểm tra lại đường dẫn hoặc tiêu đề trích dẫn.` +
            linkNoteVi +
            retractionNoteVi
          );
        }
        if (
          (verdict.triggered_rules ?? []).includes('R-CROSS-LINGUAL-TITLE-MATCH') ||
          verdict.features?.cross_lingual_title_detected
        ) {
          const viRe =
            /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
          const isViCited = viRe.test(verdict.citation_raw ?? '');
          const matchedCanonTitle = verdict.matched_sources?.[0]?.title ?? '';
          const isEnToVi = !isViCited && viRe.test(matchedCanonTitle);
          const crossSimPct = verdict.features?.cross_lingual_title_sim
            ? ` (độ khớp ngữ nghĩa ${isEnToVi ? 'Anh↔Việt' : 'Việt↔Anh'} ${Math.round(verdict.features.cross_lingual_title_sim * 100)}%)`
            : '';
          if (isEnToVi) {
            return (
              `Tiêu đề dịch tiếng Anh khớp ngữ nghĩa với ấn phẩm tiếng Việt gốc${crossSimPct}, ` +
              `nhưng chuẩn trích dẫn học thuật yêu cầu giữ nguyên tiêu đề gốc theo đúng ngôn ngữ xuất bản.` +
              linkNoteVi +
              retractionNoteVi
            );
          }
          return (
            `Tiêu đề dịch tiếng Việt khớp ngữ nghĩa với ấn phẩm tiếng Anh gốc${crossSimPct}, ` +
            `nhưng chuẩn trích dẫn học thuật yêu cầu giữ nguyên tiêu đề gốc bằng ngôn ngữ xuất bản (có thể kèm [bản dịch tiếng Việt] trong ngoặc vuông).` +
            linkNoteVi +
            retractionNoteVi
          );
        }
        return (
          (sources.length > 0
            ? `Tìm thấy ấn phẩm tương ứng nhưng ${fields} không khớp với trích dẫn. Vui lòng rà soát lại các thông tin này.`
            : `Không thể xác nhận trích dẫn vì ${fields} không khớp với bản ghi gốc hiện có.`) +
          linkNoteVi +
          retractionNoteVi
        );

      case 'suspected_hallucination':
        return (
          (sources.length === 0
            ? 'Không tìm thấy ấn phẩm nào khớp trên các thư viện học thuật đã kiểm tra. Vui lòng xác minh lại nguồn trích dẫn này.'
            : 'Các bản ghi học thuật hiện có không củng cố cho trích dẫn này. Vui lòng kiểm tra thủ công nguồn và thông tin chi tiết.') +
          linkNoteVi +
          retractionNoteVi
        );

      case 'unresolved':
      default:
        return (
          (sources.length === 0
            ? 'Chưa đủ dữ liệu để xác minh tự động trích dẫn này. Vui lòng kiểm tra thủ công.'
            : `Tìm thấy kết quả có khả năng liên quan nhưng thông tin chưa đủ mạnh để khẳng định. Hãy kiểm tra lại ${fields}.`) +
          linkNoteVi +
          retractionNoteVi
        );
    }
  }

  const retractionNote = isRetracted
    ? ' RETRACTION WARNING: This publication has been officially retracted in academic libraries.'
    : '';
  const linkNote =
    urlStatus === 'alive'
      ? ' The cited link is active.'
      : urlStatus === 'restricted_alive'
        ? ' The cited link is active (behind a publisher paywall).'
        : urlStatus === 'archived_alive'
          ? ` The original link is no longer reachable, but an archived copy was verified on Web Archive (Wayback Machine)${archiveUrl ? ` (${archiveUrl})` : ''}.`
          : urlStatus === 'dead_link'
            ? ' Warning: the cited link could not be reached.'
            : urlStatus === 'fake_domain'
              ? ' Warning: the cited link uses a placeholder or non-existent domain.'
              : '';

  const observedWebEn = extractObservedWebMeta(verdict);

  if (verdict.label === 'resource' && isLegalStatuteVerdict(verdict)) {
    const cleanLegalRawEn = verdict.citation_raw.replace(/^\[\d+[a-z]?\]\s*/i, '').replace(/\.$/, '');
    return `Recognized official Vietnamese statutory or government legal document (${cleanLegalRawEn}). Statutory sources are classified as official legal references and excluded from citation score deductions.${linkNote}${retractionNote}`;
  }

  if (isUrlResource(verdict)) {
    const resolvedMetaEn = observedWebEn?.title
      ? ` Web page title: "${observedWebEn.title}"${observedWebEn.venue ? ` (${observedWebEn.venue})` : ''}.`
      : '';
    return `Web resource detected: ${verdict.citation_raw}. This is not an academic citation and is excluded from the citation score.${resolvedMetaEn}${linkNote}${retractionNote}`;
  }

  if (verdict.mapping_status === 'missing_reference') {
    return 'This citation does not have a matching entry in the bibliography.';
  }

  if (verdict.mapping_status === 'ambiguous_mapping') {
    return 'The citation could match more than one bibliography entry, so the system did not choose one automatically.';
  }

  const matchedVerb = isEnFieldPhrasePlural(rawMatchedFields) ? 'are' : 'is';
  const mismatchedPlural = isEnFieldPhrasePlural(rawMismatchedFields);
  const mismatchedDo = mismatchedPlural ? 'do' : 'does';
  const reviewPronoun = mismatchedPlural ? 'these details' : 'this detail';

  switch (verdict.label) {
    case 'verified':
      if (sources.length === 0) {
        return `The citation is linked to its bibliography entry and passes the available checks.${linkNote}${retractionNote}`;
      }
      if (sources.every((source) => source === SOURCE_LABELS.local_db)) {
        return `We found a matching publication in ${sources[0]}. ${capitalizeSentence(matchedFields)} ${matchedVerb} consistent with the citation.${linkNote}${retractionNote}`;
      }
      return `We found a matching publication in ${sources.join(' and ')}. ${capitalizeSentence(matchedFields)} ${matchedVerb} consistent with the citation.${linkNote}${retractionNote}`;

    case 'metadata_error':
      if ((verdict.triggered_rules ?? []).includes('R-INCOMPLETE-METADATA')) {
        const missingDetail =
          rawMismatchedFields.length > 0 ? ` (missing ${fields})` : '';
        return (
          `Incomplete bibliographic reference${missingDetail}: this entry lacks required scholarly identifiers (author, publication year, academic venue, or DOI/URL). This indicates incomplete formatting rather than an invalid source — please complete the citation details.` +
          linkNote +
          retractionNote
        );
      }
      if ((verdict.triggered_rules ?? []).includes('R-URL-CONTENT-MISMATCH')) {
        const observedTitleNoteEn = observedWebEn?.title
          ? ` (actual web page title: "${observedWebEn.title}"${observedWebEn.venue ? ` — ${observedWebEn.venue}` : ''})`
          : '';
        return (
          `The actual web page title or details at the cited link${observedTitleNoteEn} do not match the claimed citation title. Please verify the link or citation title.` +
          linkNote +
          retractionNote
        );
      }
      if (
        (verdict.triggered_rules ?? []).includes('R-CROSS-LINGUAL-TITLE-MATCH') ||
        verdict.features?.cross_lingual_title_detected
      ) {
        const viReEn =
          /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
        const isViCitedEn = viReEn.test(verdict.citation_raw ?? '');
        const matchedCanonTitleEn = verdict.matched_sources?.[0]?.title ?? '';
        const isEnToViEn = !isViCitedEn && viReEn.test(matchedCanonTitleEn);
        const crossSimPct = verdict.features?.cross_lingual_title_sim
          ? ` (${Math.round(verdict.features.cross_lingual_title_sim * 100)}% ${isEnToViEn ? 'EN↔VI' : 'VI↔EN'} semantic match)`
          : '';
        if (isEnToViEn) {
          return (
            `The English translated title semantically matches the original Vietnamese publication${crossSimPct}, ` +
            `but standard academic citation rules require preserving the original publication title as published.` +
            linkNote +
            retractionNote
          );
        }
        return (
          `The Vietnamese translated title semantically matches the English publication${crossSimPct}, ` +
          `but standard academic citation rules require preserving the original foreign-language title (optionally followed by [Vietnamese translation] in brackets).` +
          linkNote +
          retractionNote
        );
      }
      return (
        (sources.length > 0
          ? `We found a likely publication, but ${fields} ${mismatchedDo} not match the citation. Please review ${reviewPronoun}.`
          : `The citation could not be confirmed because ${fields} ${mismatchedDo} not match the published record.`) +
        linkNote +
        retractionNote
      );

    case 'suspected_hallucination':
      return (
        (sources.length === 0
          ? 'We could not find a matching publication in the checked academic libraries. Please verify this citation manually.'
          : 'The available published records do not support this citation. Please verify the source and its details manually.') +
        linkNote +
        retractionNote
      );

    case 'unresolved':
    default:
      return (
        (sources.length === 0
          ? 'There was not enough data to verify this citation automatically. Please review it manually.'
          : `We found a possible match, but the available details are not strong enough to confirm it. Check ${fields}.`) +
        linkNote +
        retractionNote
      );
  }
}

export function getSourceSummary(verdict: Verdict, lang?: 'en' | 'vi'): string {
  const resolved = resolveLang(lang);
  const observedWeb = extractObservedWebMeta(verdict);
  if (verdict.label === 'resource' && isLegalStatuteVerdict(verdict)) {
    return resolved === 'vi'
      ? 'Đã đối chiếu Thư viện văn bản pháp luật Việt Nam'
      : 'Matched in the Vietnamese Legal Registry';
  }
  if (isUrlResource(verdict)) {
    if (observedWeb?.title) {
      return `Web: ${observedWeb.title}${observedWeb.venue ? ` (${observedWeb.venue})` : ''}`;
    }
    return `URL: ${verdict.citation_raw}`;
  }
  const sources = matchedSourceNames(verdict, resolved);
  if (resolved === 'vi') {
    if (sources.length === 0 && observedWeb?.title) {
      return `Trang web gốc: "${observedWeb.title}"`;
    }
    if (sources.length === 0) return 'Không tìm thấy ấn phẩm khớp';
    if (sources.length === 1) return `Tìm thấy ấn phẩm khớp trên ${sources[0]}`;
    return `Tìm thấy ấn phẩm khớp trên ${sources.join(' và ')}`;
  }
  if (sources.length === 0 && observedWeb?.title) {
    return `Source web page: "${observedWeb.title}"`;
  }
  if (sources.length === 0) return 'No matching publication found';
  if (sources.length === 1) return `Found a matching publication in ${sources[0]}`;
  return `Found matching publications in ${sources.join(' and ')}`;
}

export function getSearchStepDescription(verdict: Verdict, lang?: 'en' | 'vi'): string {
  const resolved = resolveLang(lang);
  const sources = matchedSourceNames(verdict, resolved);
  const observedWeb = extractObservedWebMeta(verdict);
  if (resolved === 'vi') {
    if (
      sources.length > 0 &&
      sources.every((source) => source === SOURCE_LABELS_VI.local_db)
    ) {
      return 'Đã đối chiếu và tìm thấy bản ghi khớp trong Thư viện học thuật CITRA.';
    }
    if (sources.length > 0) {
      return `Đã kiểm tra ${sources.join(', ')} để tìm ấn phẩm khớp.`;
    }
    if (observedWeb) {
      return observedWeb.isArchived
        ? 'Đã đọc thông tin tài liệu từ bản lưu trên Kho lưu trữ web (Wayback).'
        : 'Đã kiểm tra đường dẫn và đọc thông tin trực tiếp từ trang web gốc.';
    }
    return 'Không có ấn phẩm nào khớp được trả về từ các thư viện đã tra cứu.';
  }
  if (sources.length > 0 && sources.every((source) => source === SOURCE_LABELS.local_db)) {
    return 'Matched against the CITRA Scholarly Library.';
  }
  if (sources.length > 0) {
    return `Checked ${sources.join(', ')} for a matching publication.`;
  }
  if (observedWeb) {
    return observedWeb.isArchived
      ? 'Read publication details from an archived snapshot on Web Archive (Wayback).'
      : 'Checked the citation link and read publication details from the source web page.';
  }
  return 'No matching publication was returned by the checked academic libraries.';
}
