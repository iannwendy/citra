import type { Verdict } from '@/api/client';
import i18n from '@/i18n';

function resolveLang(lang?: unknown): 'en' | 'vi' {
  if (lang === 'vi' || lang === 'en') return lang;
  return i18n.language?.startsWith('vi') ? 'vi' : 'en';
}

const SOURCE_LABELS: Record<string, string> = {
  crossref: 'Crossref',
  openalex: 'OpenAlex',
  datacite: 'DataCite (Zenodo / Figshare / OSF)',
  doi_ra: 'Global DOI Registration Agency (CSL-JSON)',
  doaj: 'DOAJ (Directory of Open Access Journals)',
  openaire_hal: 'OpenAIRE Graph / HAL Open Science',
  ncbi_biorxiv: 'NCBI Entrez / bioRxiv / medRxiv',
  dblp: 'DBLP',
  arxiv: 'arXiv',
  openlibrary: 'OpenLibrary / Google Books',
  europepmc: 'Europe PMC (PubMed)',
  huggingface: 'Hugging Face Hub',
  tech_standard: 'IETF RFC / PyPI / NPM / GitHub',
  wikidata_opencitations: 'Wikidata Knowledge Graph / OpenCitations',
  serpapi: 'Google Scholar',
  local_db: 'the local library',
  known_papers: 'the known-papers library',
  vn_legal_registry: 'the Vietnamese Legal Registry',
};

const SOURCE_LABELS_VI: Record<string, string> = {
  ...SOURCE_LABELS,
  local_db: 'thư viện học thuật cục bộ',
  known_papers: 'thư viện bài báo kinh điển',
  vn_legal_registry: 'Cơ sở dữ liệu văn bản quy phạm pháp luật Việt Nam',
};

const FIELD_LABELS: Record<string, string> = {
  title: 'the title',
  authors: 'the authors',
  author: 'the authors',
  year: 'the publication year',
  doi: 'the DOI',
  venue: 'the venue',
  url: 'the link',
  retracted: 'the retraction status (RETRACTED PAPER)',
  retracted_paper: 'the retraction status (RETRACTED PAPER)',
};

const FIELD_LABELS_VI: Record<string, string> = {
  title: 'tiêu đề',
  authors: 'tác giả',
  author: 'tác giả',
  year: 'năm xuất bản',
  doi: 'mã DOI',
  venue: 'nơi công bố (venue)',
  url: 'đường dẫn liên kết',
  retracted: 'trạng thái rút bài (BÀI BÁO ĐÃ BỊ RÚT)',
  retracted_paper: 'trạng thái rút bài (BÀI BÁO ĐÃ BỊ RÚT)',
};

const RULE_LABELS: Record<string, string> = {
  'R-WELL-LINKED': 'Citation and publication details match closely',
  'R-WELL-LINKED-MODERATE': 'Citation and publication are a reasonable match',
  'R-DOI-TITLE-AUTHOR': 'DOI, title, and author details match',
  'R-CONSENSUS-FULL': 'Multiple sources agree on the publication details',
  'R-CONSENSUS-PARTIAL': 'Sources agree, with some details to review',
  'R-SINGLE-SOURCE-VERIFIED': 'High-confidence match verified in a scholarly registry',
  'R-SINGLE-SOURCE-PARTIAL': 'Scholarly record found, but author, year, or title differs',
  'R-BOOK-EDITION-VERIFIED': 'Canonical textbook or book edition verified',
  'R-LOCAL_DB_VERIFIED': 'Verified against the local scholarly library',
  'R-LOCAL_DB_GOOD_MATCH': 'Strong match found in the local scholarly library',
  'R-LOCAL_DB_METADATA_ERROR': 'Local scholarly library match found, but metadata fields differ',
  'R-LOCAL_DB': 'Candidate retrieved from the local scholarly paper index',
  'R-LOCAL_DB_ONLY': 'Verified via local scholarly index while external APIs were unavailable',
  'R-API_EXHAUSTED': 'External API quota exhausted; confidence adjusted for cache-only evidence',
  'R-KNOWN-PAPER': 'Matches a canonical benchmark publication',
  'R-KNOWN-PAPER-NO-TITLE': 'Matches a canonical seminal paper by author and year',
  'R-VN-LEGAL-FORMAT': 'Official statutory or legal document format verified',
  'R-LEGAL-DOCUMENT': 'Recognized Vietnamese statutory or government legal document',
  'R-VN-LEGAL-VERIFIED': 'Verified against the Vietnamese Legal Statutory Registry',
  'R-VN-LEGAL-MISMATCH': 'Vietnamese legal document found, but promulgation year, number, or agency differs',
  'R-VN-LEGAL-SUPERSEDED': 'Cited Vietnamese legal statute has been superseded or amended by a newer law',
  'R-VN-LEGAL-FABRICATED': 'Fabricated or non-existent Vietnamese legal document number or issuing authority',
  'R-LEGAL-STATUTE-VERIFIED': 'Official statutory or legal regulation verified against legal registry',
  'R-LEGAL-STATUTE-ERROR': 'Legal statute metadata discrepancy or superseded regulation detected',
  'R-GLOBAL-DOI-RA-VERIFIED': 'Verified via Global DOI Registration Agency & Content Negotiation (CSL-JSON)',
  'R-HF-VERIFIED': 'AI model, dataset, or paper verified on Hugging Face Hub',
  'R-RFC-VERIFIED': 'Technical RFC standard or software repository verified via IETF / PyPI / NPM / GitHub',
  'R-GITHUB-VERIFIED': 'Public software repository & CITATION.cff verified via GitHub REST API',
  'R-PACKAGE-VERIFIED': 'Open-source package metadata verified via PyPI / NPM Registry',
  'R-SOFTWARE-PACKAGE-VERIFIED': 'Software package release metadata verified via PyPI / NPM Registry',
  'R-WIKIDATA-VERIFIED': 'Standard, clinical manual, or DOI verified via Wikidata Knowledge Graph / OpenCitations',
  'R-WIKIDATA-STANDARD-VERIFIED': 'Technical standard or manual verified via Wikidata Knowledge Graph',
  'R-OPENCITATIONS-VERIFIED': 'Citation graph provenance verified via OpenCitations COCI index',
  'R-WAYBACK-ARCHIVED': 'Original URL experienced link rot, verified via Internet Archive Wayback Machine snapshot',
  'R-RETRACTED-PAPER': 'WARNING: This publication has been officially RETRACTED in scholarly registries',
  'R-KNOWN-AUTHOR-TITLE-MISMATCH': 'Author matches, but the title needs review',
  'R-KNOWN-AUTHOR-WEAK-EVIDENCE': 'Author is known, but supporting evidence is limited',
  'R-TITLE-MISMATCH': 'Author and year match a known work, but the cited title differs',
  'R-DOI-TITLE-MISMATCH': 'DOI matches, but the title needs review',
  'R-CHIMERIC-DOI-MISMATCH': 'Cited DOI resolves to a completely different paper (spliced/chimeric citation)',
  'R-FAKE-URL': 'The link does not look like a real academic source',
  'R-DEAD-URL': 'The cited URL is unreachable (HTTP 404/DNS) and no scholarly record was found',
  'R-BROKEN-LINK': 'The scholarly paper exists, but the cited URL returned an HTTP error',
  'R-FABRICATED-DOI': 'The DOI has an invalid or fabricated prefix',
  'R-NONEXISTENT-DOI': 'The cited DOI does not resolve in scholarly registries',
  'R-NO-SCHOLARLY-RECORD': 'Zero matching records returned across live scholarly registries',
  'R-NO-CANDIDATE': 'No matching publication candidates found across queried databases',
  'R-FAIL-ALL': 'All external scholarly APIs failed or timed out during lookup',
  'R-WEAK-EVIDENCE': 'Candidate records found, but similarity scores are too low to confirm',
  'R-ABSTENTION-BORDER': 'Similarity score falls in the uncertain border zone — manual review required',
  'R-AMBIGUOUS-MAPPING': 'In-text citation could match multiple reference entries',
  'R-DOMAIN-EXCEPTION': 'DOI resolves across registries, but title similarity is low (domain exception)',
  'R-NON-SCHOLARLY-RESOURCE': 'Non-scholarly web resource or documentation link',
  'R-UNINDEXED-BOOK-OR-SOURCE': 'Potentially unindexed regional book, thesis, or print monograph',
  'R-URL-RESOURCE': 'Direct URL or web resource citation',
  'R-WEB-RESOURCE': 'Web documentation or online technical resource',
  'R-HALLUCINATED-SOURCE': 'Retrieved candidates fall below the minimum similarity threshold',
  'R-FAKE-AUTHOR': 'The author details look unusual or fabricated',
  'R-FUTURE-YEAR': 'The publication year is in the future',
  'R-FUTURE-YEAR-KNOWN-AUTHOR': 'The publication year needs review',
  'R-CONTENT-ALIGNMENT': 'In-text context aligns semantically with the source abstract',
  'R-CROSS-LINGUAL-ALIGNMENT': 'Vietnamese–English cross-lingual semantic alignment verified via academic concept bridge',
  'R-CROSS-LINGUAL-TITLE-MATCH': 'Translated title matches original publication semantically — original foreign-language title must be preserved per TDTU citation rules',
  'R-CONTENT-MISMATCH': 'The citation content does not match the publication',
  'R-STYLE-INCONSISTENT': 'The citation format differs from the document style',
};

const RULE_LABELS_VI: Record<string, string> = {
  'R-WELL-LINKED': 'Thông tin trích dẫn và ấn phẩm khớp chặt chẽ',
  'R-WELL-LINKED-MODERATE': 'Trích dẫn và ấn phẩm khớp ở mức hợp lý',
  'R-DOI-TITLE-AUTHOR': 'Mã DOI, tiêu đề và tác giả hoàn toàn trùng khớp',
  'R-CONSENSUS-FULL': 'Nhiều cơ sở dữ liệu học thuật đồng thuận về thông tin ấn phẩm',
  'R-CONSENSUS-PARTIAL': 'Các cơ sở dữ liệu đồng thuận một phần, cần rà soát lại một số trường metadata',
  'R-SINGLE-SOURCE-VERIFIED': 'Xác minh độ tin cậy cao trên cơ sở dữ liệu học thuật',
  'R-SINGLE-SOURCE-PARTIAL': 'Tìm thấy hồ sơ học thuật nhưng sai lệch tác giả, năm hoặc tiêu đề',
  'R-BOOK-EDITION-VERIFIED': 'Đã xác minh ấn bản sách chuyên khảo / giáo trình chuẩn',
  'R-LOCAL_DB_VERIFIED': 'Đã xác minh khớp chính xác trong cơ sở dữ liệu học thuật cục bộ',
  'R-LOCAL_DB_GOOD_MATCH': 'Độ tương đồng cao trong cơ sở dữ liệu học thuật cục bộ',
  'R-LOCAL_DB_METADATA_ERROR': 'Tìm thấy trong thư viện cục bộ nhưng có sai lệch trường metadata',
  'R-LOCAL_DB': 'Ứng viên được truy xuất từ chỉ mục bài báo học thuật cục bộ',
  'R-LOCAL_DB_ONLY': 'Xác minh qua thư viện cục bộ khi các API bên ngoài tạm thời không phản hồi',
  'R-API_EXHAUSTED': 'Hạn ngạch API bên ngoài đã cạn; điều chỉnh độ tin cậy cho bằng chứng cục bộ',
  'R-KNOWN-PAPER': 'Khớp với công trình nghiên cứu kinh điển trong danh mục chuẩn',
  'R-KNOWN-PAPER-NO-TITLE': 'Khớp với công trình kinh điển theo tác giả và năm xuất bản',
  'R-VN-LEGAL-FORMAT': 'Định dạng văn bản quy phạm pháp luật hợp lệ',
  'R-LEGAL-DOCUMENT': 'Nhận diện văn bản quy phạm pháp luật Việt Nam',
  'R-VN-LEGAL-VERIFIED': 'Đã xác minh đối chiếu với Cơ sở dữ liệu pháp luật Việt Nam',
  'R-VN-LEGAL-MISMATCH': 'Tìm thấy văn bản pháp luật nhưng sai lệch năm ban hành, số hiệu hoặc cơ quan ban hành',
  'R-VN-LEGAL-SUPERSEDED': 'Văn bản pháp luật được trích dẫn đã hết hiệu lực hoặc bị thay thế bởi văn bản mới hơn',
  'R-VN-LEGAL-FABRICATED': 'Số hiệu hoặc cơ quan ban hành văn bản pháp luật có dấu hiệu ngụy tạo / không tồn tại',
  'R-LEGAL-STATUTE-VERIFIED': 'Đã xác minh văn bản pháp규 / quy định pháp luật chính thức',
  'R-LEGAL-STATUTE-ERROR': 'Phát hiện sai lệch metadata hoặc văn bản pháp luật đã hết hiệu lực',
  'R-GLOBAL-DOI-RA-VERIFIED': 'Đã xác minh qua Cơ quan Đăng ký DOI Toàn cầu & CSL-JSON',
  'R-HF-VERIFIED': 'Đã xác minh mô hình AI, bộ dữ liệu hoặc bài báo trên Hugging Face Hub',
  'R-RFC-VERIFIED': 'Đã xác minh tiêu chuẩn kỹ thuật RFC hoặc gói phần mềm qua IETF / PyPI / NPM / GitHub',
  'R-GITHUB-VERIFIED': 'Đã xác minh kho mã nguồn GitHub & tệp CITATION.cff qua GitHub REST API',
  'R-PACKAGE-VERIFIED': 'Đã xác minh metadata gói phần mềm mã nguồn mở qua PyPI / NPM Registry',
  'R-SOFTWARE-PACKAGE-VERIFIED': 'Đã xác minh thông tin phát hành gói phần mềm qua PyPI / NPM Registry',
  'R-WIKIDATA-VERIFIED': 'Đã xác minh tiêu chuẩn quốc tế, cẩm nang y khoa hoặc DOI qua Wikidata / OpenCitations',
  'R-WIKIDATA-STANDARD-VERIFIED': 'Đã xác minh tiêu chuẩn kỹ thuật qua Wikidata Knowledge Graph',
  'R-OPENCITATIONS-VERIFIED': 'Đã xác minh đồ thị trích dẫn qua chỉ mục OpenCitations COCI',
  'R-WAYBACK-ARCHIVED': 'URL gốc bị lỗi truy cập nhưng đã xác minh qua bản lưu trữ Internet Archive Wayback Machine',
  'R-RETRACTED-PAPER': 'CẢNH BÁO: Ấn phẩm này đã chính thức BỊ RÚT BÀI (RETRACTED) trong cơ sở dữ liệu học thuật',
  'R-KNOWN-AUTHOR-TITLE-MISMATCH': 'Khớp tác giả nhưng tiêu đề bài báo có sai lệch cần kiểm tra lại',
  'R-KNOWN-AUTHOR-WEAK-EVIDENCE': 'Tác giả có thực nhưng bằng chứng đối chiếu bài báo còn yếu',
  'R-TITLE-MISMATCH': 'Khớp tác giả và năm với công trình đã biết nhưng tiêu đề trích dẫn bị sai lệch',
  'R-DOI-TITLE-MISMATCH': 'Mã DOI hợp lệ nhưng tiêu đề không khớp với hồ sơ gốc',
  'R-CHIMERIC-DOI-MISMATCH': 'Mã DOI trỏ tới một bài báo hoàn toàn khác (nghi vấn ghép nối trích dẫn ngụy tạo)',
  'R-FAKE-URL': 'Đường dẫn URL thuộc tên miền giả định hoặc không phải nguồn học thuật thực tế',
  'R-DEAD-URL': 'Đường dẫn URL không thể truy cập (HTTP 404/DNS) và không có hồ sơ học thuật nào khớp',
  'R-BROKEN-LINK': 'Bài báo học thuật có tồn tại nhưng đường dẫn URL đính kèm bị lỗi truy cập',
  'R-FABRICATED-DOI': 'Mã DOI có tiền tố nhà xuất bản giả tạo hoặc không hợp lệ',
  'R-NONEXISTENT-DOI': 'Mã DOI không tồn tại trong hệ thống đăng ký DOI học thuật',
  'R-NO-SCHOLARLY-RECORD': 'Không tìm thấy bất kỳ bản ghi nào khớp trên các cơ sở dữ liệu học thuật',
  'R-NO-CANDIDATE': 'Không tìm thấy ứng viên bài báo nào khớp trên các cơ sở dữ liệu đã truy vấn',
  'R-FAIL-ALL': 'Tất cả các API học thuật bên ngoài đều lỗi hoặc quá thời gian chờ khi truy vấn',
  'R-WEAK-EVIDENCE': 'Tìm thấy một số bản ghi nhưng điểm tương đồng quá thấp để xác nhận',
  'R-ABSTENTION-BORDER': 'Điểm tương đồng nằm trong vùng biên không chắc chắn — cần kiểm tra thủ công',
  'R-AMBIGUOUS-MAPPING': 'Trích dẫn trong bài có thể khớp với nhiều mục tài liệu tham khảo khác nhau',
  'R-DOMAIN-EXCEPTION': 'Mã DOI phân giải thành công nhưng độ tương đồng tiêu đề thấp (ngoại lệ chuyên ngành)',
  'R-NON-SCHOLARLY-RESOURCE': 'Tài nguyên web phi học thuật hoặc đường dẫn tài liệu hướng dẫn',
  'R-UNINDEXED-BOOK-OR-SOURCE': 'Có thể là sách in, giáo trình nội bộ hoặc luận văn chưa được lập chỉ mục trực tuyến',
  'R-URL-RESOURCE': 'Trích dẫn trực tiếp đường dẫn URL hoặc tài nguyên web',
  'R-WEB-RESOURCE': 'Tài liệu kỹ thuật trực tuyến hoặc nguồn tài nguyên web',
  'R-HALLUCINATED-SOURCE': 'Các kết quả tìm được có độ tương đồng thấp hơn ngưỡng tối thiểu (nghi vấn ngụy tạo)',
  'R-FAKE-AUTHOR': 'Tên tác giả có dấu hiệu giả tạo hoặc bất thường',
  'R-FUTURE-YEAR': 'Năm xuất bản nằm trong tương lai (không hợp lệ)',
  'R-FUTURE-YEAR-KNOWN-AUTHOR': 'Năm xuất bản nằm trong tương lai đối với tác giả đã biết — cần kiểm tra lại năm',
  'R-CONTENT-ALIGNMENT': 'Ngữ cảnh trích dẫn trong bài tương đồng ngữ nghĩa với tóm tắt (abstract) nguồn',
  'R-CROSS-LINGUAL-ALIGNMENT': 'Đã xác minh tương đồng ngữ nghĩa xuyên ngôn ngữ Việt – Anh qua cầu nối thuật ngữ học thuật',
  'R-CROSS-LINGUAL-TITLE-MATCH': 'Tiêu đề dịch tiếng Việt khớp ngữ nghĩa với ấn phẩm gốc — cần giữ nguyên tiêu đề tiếng nước ngoài theo quy định trích dẫn TDTU',
  'R-CONTENT-MISMATCH': 'Nội dung khẳng định trong bài không khớp với nội dung thực tế của ấn phẩm được trích dẫn',
  'R-STYLE-INCONSISTENT': 'Định dạng trích dẫn không đồng nhất với chuẩn trích dẫn chung của tài liệu',
};

export function getSourceDisplayName(source: string, lang?: 'en' | 'vi'): string {
  const key = source.toLowerCase();
  const resolved = resolveLang(lang);
  return (resolved === 'vi' ? SOURCE_LABELS_VI[key] : SOURCE_LABELS[key]) ?? source;
}

function matchedSourceNames(verdict: Verdict, lang: 'en' | 'vi'): string[] {
  return (verdict.matched_sources ?? []).map((source) =>
    getSourceDisplayName(source.source, lang),
  );
}

/** Treat URL-only rows as web resources, including older cached reports. */
export function isUrlResource(verdict: { citation_raw: string; label: string }): boolean {
  if (verdict.label === 'resource') return true;
  const raw = verdict.citation_raw.trim().replace(/[.,;:)"']+$/, '');
  return /^(?:https?:\/\/|www\.)\S+$/i.test(raw);
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
  if (resolved === 'vi') {
    const labelsVi: Record<string, string> = {
      verified: 'Hợp lệ',
      metadata_error: 'Cần rà soát metadata',
      suspected_hallucination: 'Không thể xác minh (Nghi vấn ngụy tạo)',
      unresolved: 'Cần kiểm tra thủ công',
      resource: 'Tài nguyên web',
    };
    return labelsVi[label] ?? 'Cần kiểm tra thủ công';
  }
  const labels: Record<string, string> = {
    verified: 'Verified',
    metadata_error: 'Needs a metadata review',
    suspected_hallucination: 'Could not be verified',
    unresolved: 'Needs manual review',
    resource: 'Web resource',
  };
  return labels[label] ?? 'Needs manual review';
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
  const fields = fieldLabels(verdict.mismatched_fields ?? [], resolved);
  const matchedFields = fieldLabels(
    (verdict.matched_sources ?? []).flatMap((source) => source.matched_fields ?? []),
    resolved,
  );

  const urlStatus = verdict.url_status ?? verdict.features?.url_status;
  const urlCode = verdict.url_status_code ?? verdict.features?.url_status_code;
  const archiveUrl = verdict.archive_url ?? verdict.features?.archive_url;
  const isRetracted =
    Boolean(verdict.is_retracted ?? verdict.features?.is_retracted) ||
    Boolean((verdict.triggered_rules ?? []).includes('R-RETRACTED-PAPER'));

  if (resolved === 'vi') {
    const retractionNoteVi = isRetracted
      ? ' CẢNH BÁO RÚT BÀI (RETRACTED): Ấn phẩm này đã chính thức bị rút bài trong cơ sở dữ liệu học thuật.'
      : '';
    const linkNoteVi =
      urlStatus === 'alive'
        ? ` Kiểm tra liên kết thành công (HTTP ${urlCode || 200} OK).`
        : urlStatus === 'restricted_alive'
          ? ` Kiểm tra liên kết thành công (HTTP ${urlCode || 403} tường phí nhà xuất bản — liên kết còn hoạt động).`
          : urlStatus === 'archived_alive'
            ? ` Phát hiện URL gốc lỗi truy cập, nhưng đã xác minh bản lưu trữ trên Internet Archive Wayback Machine${archiveUrl ? ` (${archiveUrl})` : ''}.`
            : urlStatus === 'dead_link'
              ? ` Cảnh báo: URL trích dẫn trả về HTTP ${urlCode || 404} (liên kết hỏng/không truy cập được).`
              : urlStatus === 'fake_domain'
                ? ' Cảnh báo: URL trích dẫn sử dụng tên miền giả định hoặc ví dụ.'
                : '';

    if (isUrlResource(verdict)) {
      return `Phát hiện tài nguyên URL: ${verdict.citation_raw}. Đây không phải trích dẫn bài báo học thuật và không tính vào điểm CIS.${linkNoteVi}${retractionNoteVi}`;
    }

    if (verdict.mapping_status === 'missing_reference') {
      return 'Trích dẫn trong bài này không có mục tương ứng trong danh mục Tài liệu tham khảo.';
    }

    if (verdict.mapping_status === 'ambiguous_mapping') {
      return 'Trích dẫn có thể khớp với nhiều mục trong danh mục Tài liệu tham khảo nên hệ thống không tự động gán.';
    }

    switch (verdict.label) {
      case 'verified':
        if (sources.length === 0) {
          return `Trích dẫn được liên kết với danh mục tham khảo và vượt qua các bước kiểm tra hiện có.${linkNoteVi}${retractionNoteVi}`;
        }
        if (
          sources.every(
            (source) =>
              source === 'thư viện học thuật cục bộ' ||
              source === 'thư viện bài báo kinh điển',
          )
        ) {
          return `Trích dẫn khớp với bài báo trong ${sources[0]}. Thông tin ${matchedFields} hoàn toàn nhất quán.${linkNoteVi}${retractionNoteVi}`;
        }
        return `Tìm thấy ấn phẩm khớp trên ${sources.join(' và ')}. Thông tin ${matchedFields} nhất quán với trích dẫn.${linkNoteVi}${retractionNoteVi}`;

      case 'metadata_error':
        if (
          (verdict.triggered_rules ?? []).includes('R-CROSS-LINGUAL-TITLE-MATCH') ||
          verdict.features?.cross_lingual_title_detected
        ) {
          const crossSimPct = verdict.features?.cross_lingual_title_sim
            ? ` (độ khớp ngữ nghĩa Việt↔Anh ${Math.round(verdict.features.cross_lingual_title_sim * 100)}%)`
            : '';
          return (
            `Tiêu đề dịch tiếng Việt khớp ngữ nghĩa với ấn phẩm tiếng Anh gốc${crossSimPct}, ` +
            `nhưng quy định trích dẫn học thuật TDTU yêu cầu giữ nguyên tiêu đề gốc bằng tiếng nước ngoài (có thể kèm [bản dịch tiếng Việt] trong ngoặc vuông).` +
            linkNoteVi +
            retractionNoteVi
          );
        }
        return (
          (sources.length > 0
            ? `Tìm thấy ấn phẩm tương ứng nhưng ${fields} không khớp với trích dẫn. Vui lòng rà soát lại các thông tin này.`
            : `Không thể xác nhận trích dẫn vì ${fields} không khớp với hồ sơ hiện có.`) +
          linkNoteVi +
          retractionNoteVi
        );

      case 'suspected_hallucination':
        return (
          (sources.length === 0
            ? 'Không tìm thấy ấn phẩm nào khớp trên các cơ sở dữ liệu đã kiểm tra. Vui lòng xác minh lại nguồn trích dẫn này.'
            : 'Các hồ sơ học thuật hiện có không củng cố cho trích dẫn này. Vui lòng kiểm tra thủ công nguồn và thông tin chi tiết.') +
          linkNoteVi +
          retractionNoteVi
        );

      case 'unresolved':
      default:
        return (
          (sources.length === 0
            ? 'Chưa đủ bằng chứng để xác minh trích dẫn này. Vui lòng kiểm tra thủ công.'
            : `Tìm thấy kết quả có khả năng liên quan nhưng thông tin chưa đủ mạnh để khẳng định. Hãy kiểm tra lại ${fields}.`) +
          linkNoteVi +
          retractionNoteVi
        );
    }
  }

  const retractionNote = isRetracted
    ? ' RETRACTION WARNING: This publication has been officially RETRACTED in scholarly registries.'
    : '';
  const linkNote =
    urlStatus === 'alive'
      ? ` Link check passed (HTTP ${urlCode || 200} OK).`
      : urlStatus === 'restricted_alive'
        ? ` Link check passed (HTTP ${urlCode || 403} publisher paywall — link is alive).`
        : urlStatus === 'archived_alive'
          ? ` Link rot detected, but an archived snapshot was verified on Internet Archive Wayback Machine${archiveUrl ? ` (${archiveUrl})` : ''}.`
          : urlStatus === 'dead_link'
            ? ` Warning: the cited URL returned HTTP ${urlCode || 404} (dead/unreachable link).`
            : urlStatus === 'fake_domain'
              ? ' Warning: the cited URL uses a fake or placeholder domain.'
              : '';

  if (isUrlResource(verdict)) {
    return `URL resource detected: ${verdict.citation_raw}. This is not an academic citation and is excluded from the CIS score.${linkNote}${retractionNote}`;
  }

  if (verdict.mapping_status === 'missing_reference') {
    return 'This citation does not have a matching entry in the bibliography.';
  }

  if (verdict.mapping_status === 'ambiguous_mapping') {
    return 'The citation could match more than one bibliography entry, so the system did not choose one automatically.';
  }

  switch (verdict.label) {
    case 'verified':
      if (sources.length === 0) {
        return `The citation is linked to its bibliography entry and passes the available checks.${linkNote}${retractionNote}`;
      }
      if (sources.every((source) => source === 'the local library' || source === 'the known-papers library')) {
        return `The citation matches a paper in ${sources[0]}. ${matchedFields} are consistent, so no external search was needed.${linkNote}${retractionNote}`;
      }
      return `We found a matching publication in ${sources.join(' and ')}. ${matchedFields} are consistent with the citation.${linkNote}${retractionNote}`;

    case 'metadata_error':
      if (
        (verdict.triggered_rules ?? []).includes('R-CROSS-LINGUAL-TITLE-MATCH') ||
        verdict.features?.cross_lingual_title_detected
      ) {
        const crossSimPct = verdict.features?.cross_lingual_title_sim
          ? ` (${Math.round(verdict.features.cross_lingual_title_sim * 100)}% VI↔EN semantic match)`
          : '';
        return (
          `The Vietnamese translated title semantically matches the English publication${crossSimPct}, ` +
          `but TDTU academic citation rules require preserving the original foreign-language title (optionally followed by [Vietnamese translation] in brackets).` +
          linkNote +
          retractionNote
        );
      }
      return (sources.length > 0
        ? `We found a likely publication, but ${fields} do not match the citation. Please review these details.`
        : `The citation could not be confirmed because ${fields} do not match the available record.`) + linkNote + retractionNote;

    case 'suspected_hallucination':
      return (sources.length === 0
        ? 'We could not find a matching publication in the checked sources. Please verify this citation manually.'
        : 'The available records do not support this citation. Please verify the source and its details manually.') + linkNote + retractionNote;

    case 'unresolved':
    default:
      return (sources.length === 0
        ? 'There was not enough evidence to verify this citation. Please review it manually.'
        : `We found a possible match, but the available details are not strong enough to confirm it. Check ${fields}.`) + linkNote + retractionNote;
  }
}

export function getSourceSummary(verdict: Verdict, lang?: 'en' | 'vi'): string {
  const resolved = resolveLang(lang);
  if (isUrlResource(verdict)) return `URL: ${verdict.citation_raw}`;
  const sources = matchedSourceNames(verdict, resolved);
  if (resolved === 'vi') {
    if (sources.length === 0) return 'Không tìm thấy ấn phẩm khớp';
    if (sources.length === 1) return `Tìm thấy ấn phẩm khớp trên ${sources[0]}`;
    return `Tìm thấy ấn phẩm khớp trên ${sources.join(' và ')}`;
  }
  if (sources.length === 0) return 'No matching publication found';
  if (sources.length === 1) return `Found a matching publication in ${sources[0]}`;
  return `Found matching publications in ${sources.join(' and ')}`;
}

export function getSearchStepDescription(verdict: Verdict, lang?: 'en' | 'vi'): string {
  const resolved = resolveLang(lang);
  const sources = matchedSourceNames(verdict, resolved);
  if (resolved === 'vi') {
    if (
      sources.every(
        (source) =>
          source === 'thư viện học thuật cục bộ' ||
          source === 'thư viện bài báo kinh điển',
      ) &&
      sources.length > 0
    ) {
      return 'Khớp với bản ghi cục bộ đã lưu nên không cần truy vấn dịch vụ bên ngoài.';
    }
    if (sources.length > 0) {
      return `Đã kiểm tra ${sources.join(', ')} để tìm ấn phẩm khớp.`;
    }
    return 'Không có ấn phẩm nào khớp được trả về từ các nguồn đã tra cứu.';
  }
  if (sources.every((source) => source === 'the local library' || source === 'the known-papers library') && sources.length > 0) {
    return 'A saved local record matched, so no external services were contacted.';
  }
  if (sources.length > 0) {
    return `Checked ${sources.join(', ')} for a matching publication.`;
  }
  return 'No matching publication was returned by the available sources.';
}
