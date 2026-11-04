import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { FileCode, CheckCircle, XCircle, AlertTriangle } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

/* ============================================================
   SourceLogic — Rule Inspector Component
   Based on UX/UI Concept Section 15: Rule Inspector
   ============================================================ */

export interface RuleDefinition {
  id: string
  name: string
  nameVi: string
  description: string
  descriptionVi: string
  conditions: {
    field: string
    operator: string
    value: string | number
  }[]
  conclusion: string
}

interface Rule extends RuleDefinition {
  triggered: boolean
}

interface RuleInspectorProps {
  triggeredRules: string[]
  verdictLabel?: string
  className?: string
}

export const RULE_DEFINITIONS: Record<string, RuleDefinition> = {
  "R-FAKE-URL": {
    id: "R-FAKE-URL",
    name: "Fake URL Detection",
    nameVi: "Phát hiện URL giả định",
    description: "URL domain is clearly fake/non-academic (example.com, test.com, localhost, etc.)",
    descriptionVi: "Tên miền URL rõ ràng là giả định hoặc không phải nguồn học thuật (example.com, test.com, localhost...)",
    conditions: [
      { field: "url_domain", operator: "IN", value: "[fake_domains]" },
    ],
    conclusion: "SUSPECTED_HALLUCINATION",
  },
  "R-FABRICATED-DOI": {
    id: "R-FABRICATED-DOI",
    name: "Fabricated DOI Pattern",
    nameVi: "Phát hiện mẫu DOI ngụy tạo",
    description: "DOI matches known fabricated DOI pattern (invalid publisher prefix like 10.1234, 10.9999)",
    descriptionVi: "Mã DOI khớp mẫu giả tạo đã biết (tiền tố nhà xuất bản không hợp lệ như 10.1234, 10.9999)",
    conditions: [
      { field: "doi_pattern", operator: "MATCHES", value: "[fabricated_patterns]" },
    ],
    conclusion: "SUSPECTED_HALLUCINATION",
  },
  "R-FAKE-AUTHOR": {
    id: "R-FAKE-AUTHOR",
    name: "Fake Author Name",
    nameVi: "Phát hiện tên tác giả giả tạo",
    description: "Author name matches fake/fabricated patterns (fictional, example, test author, etc.)",
    descriptionVi: "Tên tác giả khớp mẫu hư cấu hoặc ví dụ thử nghiệm",
    conditions: [
      { field: "author_pattern", operator: "MATCHES", value: "[fake_author_regex]" },
    ],
    conclusion: "SUSPECTED_HALLUCINATION",
  },
  "R-FUTURE-YEAR": {
    id: "R-FUTURE-YEAR",
    name: "Future Year Detection",
    nameVi: "Phát hiện năm xuất bản tương lai",
    description: "Citation year is in the future with unknown author - likely fabricated",
    descriptionVi: "Năm xuất bản nằm trong tương lai với tác giả không xác định — khả năng cao là ngụy tạo",
    conditions: [
      { field: "cited_year", operator: ">", value: "current_year" },
      { field: "author", operator: "NOT IN", value: "[known_authors]" },
    ],
    conclusion: "SUSPECTED_HALLUCINATION",
  },
  "R-FUTURE-YEAR-KNOWN-AUTHOR": {
    id: "R-FUTURE-YEAR-KNOWN-AUTHOR",
    name: "Future Year - Known Author",
    nameVi: "Năm xuất bản tương lai (Tác giả đã biết)",
    description: "Citation year is in the future but author is known - likely metadata error",
    descriptionVi: "Năm xuất bản nằm trong tương lai nhưng tác giả có thực — khả năng là lỗi gõ năm metadata",
    conditions: [
      { field: "cited_year", operator: ">", value: "current_year" },
      { field: "author", operator: "IN", value: "[known_authors]" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-DOI-TITLE-AUTHOR": {
    id: "R-DOI-TITLE-AUTHOR",
    name: "DOI + Title + Author Match",
    nameVi: "Khớp DOI + Tiêu đề + Tác giả",
    description: "Exact DOI match with high title similarity and author overlap",
    descriptionVi: "Khớp chính xác mã DOI kèm độ tương đồng tiêu đề và tác giả cao",
    conditions: [
      { field: "doi_exact_match", operator: "=", value: "true" },
      { field: "title_sim", operator: ">=", value: "0.70" },
      { field: "author_jaccard", operator: ">=", value: "0.40" },
    ],
    conclusion: "VERIFIED",
  },
  "R-WELL-LINKED": {
    id: "R-WELL-LINKED",
    name: "Well-Linked Citation (High Similarity)",
    nameVi: "Trích dẫn liên kết chuẩn (Độ tương đồng cao)",
    description: "Citation is author-year matched with high title similarity",
    descriptionVi: "Trích dẫn khớp liên kết tác giả - năm kèm độ tương đồng tiêu đề cao",
    conditions: [
      { field: "mapping_status", operator: "=", value: "matched" },
      { field: "title_sim", operator: ">=", value: "0.70" },
    ],
    conclusion: "VERIFIED",
  },
  "R-WELL-LINKED-MODERATE": {
    id: "R-WELL-LINKED-MODERATE",
    name: "Well-Linked Citation (Moderate Similarity)",
    nameVi: "Trích dẫn liên kết chuẩn (Độ tương đồng khá)",
    description: "Citation is author-year matched with moderate title similarity",
    descriptionVi: "Trích dẫn khớp liên kết tác giả - năm với độ tương đồng tiêu đề mức khá",
    conditions: [
      { field: "mapping_status", operator: "=", value: "matched" },
      { field: "title_sim", operator: "BETWEEN", value: "[0.50, 0.70)" },
    ],
    conclusion: "VERIFIED (with metadata note)",
  },
  "R-DOI-TITLE-MISMATCH": {
    id: "R-DOI-TITLE-MISMATCH",
    name: "DOI Match with Title Mismatch",
    nameVi: "Khớp DOI nhưng sai lệch tiêu đề",
    description: "DOI resolves but title similarity is moderate",
    descriptionVi: "Mã DOI phân giải thành công nhưng tiêu đề bài báo có sai lệch",
    conditions: [
      { field: "doi_exact_match", operator: "=", value: "true" },
      { field: "title_sim", operator: "BETWEEN", value: "[0.50, 0.70)" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-VENUE-MISMATCH": {
    id: "R-VENUE-MISMATCH",
    name: "Publication Venue Conflict",
    nameVi: "Sai lệch nơi công bố (Tạp chí / Hội nghị)",
    description: "Cited journal or conference conflicts with canonical publication venue metadata",
    descriptionVi: "Tên tạp chí hoặc hội nghị trích dẫn mâu thuẫn với nơi công bố chính thức của công trình",
    conditions: [
      { field: "venue_sim", operator: "<", value: "0.25" },
      { field: "is_preprint_pair", operator: "=", value: "false" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-CHIMERIC-DOI-MISMATCH": {
    id: "R-CHIMERIC-DOI-MISMATCH",
    name: "Spliced / Chimeric DOI Hallucination",
    nameVi: "Ngụy tạo ghép nối DOI (Chimeric DOI)",
    description: "Cited DOI resolves to a completely unrelated publication (low title and author similarity)",
    descriptionVi: "Mã DOI trích dẫn trỏ tới một ấn phẩm hoàn toàn khác (độ tương đồng tiêu đề và tác giả cực thấp)",
    conditions: [
      { field: "doi_exact_match", operator: "=", value: "true" },
      { field: "title_sim", operator: "<", value: "0.35" },
      { field: "author_jaccard", operator: "<", value: "0.20" },
    ],
    conclusion: "SUSPECTED_HALLUCINATION",
  },
  "R-CONSENSUS-FULL": {
    id: "R-CONSENSUS-FULL",
    name: "Full Source Consensus",
    nameVi: "Đồng thuận đa nguồn hoàn toàn",
    description: "Multiple sources agree on title, author, and year",
    descriptionVi: "Nhiều cơ sở dữ liệu học thuật đồng thuận về tiêu đề, tác giả và năm xuất bản",
    conditions: [
      { field: "consensus", operator: ">=", value: "2" },
      { field: "title_sim", operator: ">=", value: "0.70" },
      { field: "author_jaccard", operator: ">=", value: "0.40" },
      { field: "year_distance", operator: "<=", value: "1" },
    ],
    conclusion: "VERIFIED",
  },
  "R-CONSENSUS-PARTIAL": {
    id: "R-CONSENSUS-PARTIAL",
    name: "Partial Source Consensus",
    nameVi: "Đồng thuận đa nguồn một phần",
    description: "Multiple sources agree but some fields differ",
    descriptionVi: "Nhiều cơ sở dữ liệu khớp tiêu đề nhưng có sai lệch ở một số trường metadata",
    conditions: [
      { field: "consensus", operator: ">=", value: "2" },
      { field: "title_sim", operator: ">=", value: "0.70" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-KNOWN-AUTHOR-TITLE-MISMATCH": {
    id: "R-KNOWN-AUTHOR-TITLE-MISMATCH",
    name: "Known Author with Title Mismatch",
    nameVi: "Tác giả đã biết nhưng lệch tiêu đề",
    description: "Known academic author but title similarity is moderate",
    descriptionVi: "Tác giả học thuật có thực nhưng độ tương đồng tiêu đề chỉ ở mức trung bình",
    conditions: [
      { field: "author", operator: "IN", value: "[known_authors]" },
      { field: "title_sim", operator: "BETWEEN", value: "[0.30, 0.70)" },
      { field: "sources_succeeded", operator: ">", value: "0" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-KNOWN-AUTHOR-WEAK-EVIDENCE": {
    id: "R-KNOWN-AUTHOR-WEAK-EVIDENCE",
    name: "Known Author - Weak Evidence",
    nameVi: "Tác giả đã biết — Bằng chứng yếu",
    description: "Known author found but evidence is weak (low similarity scores)",
    descriptionVi: "Tìm thấy tác giả có thực nhưng điểm tương đồng với ấn phẩm thấp",
    conditions: [
      { field: "author", operator: "IN", value: "[known_authors]" },
      { field: "title_sim", operator: "BETWEEN", value: "[0.20, 0.70)" },
      { field: "sources_found", operator: ">", value: "0" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-TITLE-MISMATCH": {
    id: "R-TITLE-MISMATCH",
    name: "Known Work Title Discrepancy",
    nameVi: "Sai lệch tiêu đề công trình đã biết",
    description: "Author and year match a known publication, but the cited title differs",
    descriptionVi: "Tác giả và năm khớp với công trình đã biết nhưng tiêu đề trích dẫn bị sai lệch",
    conditions: [
      { field: "author_year_match", operator: "=", value: "true" },
      { field: "title_sim", operator: "<", value: "0.85" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-CONTENT-ALIGNMENT": {
    id: "R-CONTENT-ALIGNMENT",
    name: "Neural Content Alignment",
    nameVi: "Tương đồng ngữ nghĩa nội dung (Neural)",
    description: "Neural layer verified semantic alignment between citation context and source content",
    descriptionVi: "Tầng Neural xác nhận ngữ cảnh trích dẫn khớp ngữ nghĩa với nội dung tóm tắt nguồn",
    conditions: [
      { field: "content_alignment_score", operator: ">", value: "0" },
      { field: "content_is_aligned", operator: "=", value: "true" },
      { field: "title_sim", operator: ">=", value: "0.50" },
    ],
    conclusion: "VERIFIED",
  },
  "R-CROSS-LINGUAL-ALIGNMENT": {
    id: "R-CROSS-LINGUAL-ALIGNMENT",
    name: "Cross-Lingual Semantic Alignment (VI↔EN)",
    nameVi: "Tương đồng ngữ nghĩa xuyên ngôn ngữ Việt ↔ Anh",
    description: "Verified cross-lingual semantic alignment between Vietnamese in-text context and English abstract via academic concept bridge",
    descriptionVi: "Xác minh tương đồng ngữ nghĩa xuyên ngôn ngữ giữa ngữ cảnh tiếng Việt trong bài và tóm tắt tiếng Anh qua cầu nối thuật ngữ học thuật",
    conditions: [
      { field: "cross_lingual_detected", operator: "=", value: "true" },
      { field: "content_alignment_score", operator: ">=", value: "0.25" },
    ],
    conclusion: "VERIFIED",
  },
  "R-CROSS-LINGUAL-TITLE-MATCH": {
    id: "R-CROSS-LINGUAL-TITLE-MATCH",
    name: "Translated Title Match (TDTU Foreign-Title Rule)",
    nameVi: "Tiêu đề dịch tiếng Việt (Vi phạm quy tắc giữ nguyên tiêu đề gốc TDTU)",
    description: "Vietnamese translated title semantically matches the English source, but TDTU citation rules require preserving the original foreign-language title",
    descriptionVi: "Tiêu đề dịch tiếng Việt khớp ngữ nghĩa với bài báo gốc tiếng Anh, nhưng quy định TDTU yêu cầu giữ nguyên tiêu đề tiếng nước ngoài",
    conditions: [
      { field: "cross_lingual_title_detected", operator: "=", value: "true" },
      { field: "cross_lingual_title_sim", operator: ">=", value: "0.55" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-CONTENT-MISMATCH": {
    id: "R-CONTENT-MISMATCH",
    name: "Content Mismatch",
    nameVi: "Sai lệch ngữ nghĩa nội dung trích dẫn",
    description: "Title matches but neural content alignment failed - potential misattribution",
    descriptionVi: "Tiêu đề khớp nhưng đối sánh ngữ nghĩa nội dung thất bại — nghi vấn gán ghép sai nguồn",
    conditions: [
      { field: "content_is_aligned", operator: "=", value: "false" },
      { field: "content_alignment_score", operator: ">=", value: "0.30" },
      { field: "title_sim", operator: ">=", value: "0.70" },
    ],
    conclusion: "SUSPECTED_HALLUCINATION",
  },
  "R-STYLE-INCONSISTENT": {
    id: "R-STYLE-INCONSISTENT",
    name: "Citation Style Inconsistency",
    nameVi: "Không đồng nhất chuẩn trích dẫn",
    description: "In-text citation style does not match detected document style",
    descriptionVi: "Định dạng trích dẫn trong bài không đồng nhất với chuẩn trích dẫn chung của tài liệu",
    conditions: [
      { field: "style_profile", operator: "=", value: "MIXED" },
    ],
    conclusion: "Confidence penalty applied",
  },
  "R-AMBIGUOUS-MAPPING": {
    id: "R-AMBIGUOUS-MAPPING",
    name: "Ambiguous Citation-Reference Mapping",
    nameVi: "Liên kết trích dẫn – tham khảo nhập nhằng",
    description: "Linker could not determine which reference entry matches the citation",
    descriptionVi: "Bộ liên kết không thể phân biệt chính xác mục tài liệu tham khảo nào khớp với trích dẫn trong bài",
    conditions: [
      { field: "mapping_status", operator: "=", value: "ambiguous_mapping" },
    ],
    conclusion: "UNRESOLVED",
  },
  "R-ABSTENTION-BORDER": {
    id: "R-ABSTENTION-BORDER",
    name: "Abstention Border Zone",
    nameVi: "Vùng biên từ chối phán quyết (Abstention)",
    description: "Title similarity is in the uncertain range - system refuses to conclude",
    descriptionVi: "Độ tương đồng tiêu đề nằm trong vùng biên không chắc chắn — hệ thống chuyển sang chờ duyệt thủ công",
    conditions: [
      { field: "title_sim", operator: "BETWEEN", value: "[0.40, 0.50]" },
    ],
    conclusion: "UNRESOLVED",
  },
  "R-DOMAIN-EXCEPTION": {
    id: "R-DOMAIN-EXCEPTION",
    name: "Domain Exception",
    nameVi: "Ngoại lệ chuyên ngành",
    description: "DOI matches but title similarity is low - URL may be broken",
    descriptionVi: "Mã DOI khớp nhưng độ tương đồng tiêu đề thấp hoặc URL liên kết gặp sự cố",
    conditions: [
      { field: "doi_exact_match", operator: "=", value: "true" },
      { field: "title_sim", operator: "<", value: "0.50" },
      { field: "consensus", operator: ">=", value: "2" },
    ],
    conclusion: "METADATA_ERROR (flagged)",
  },
  "R-FAIL-ALL": {
    id: "R-FAIL-ALL",
    name: "All APIs Failed",
    nameVi: "Tất cả API tra cứu thất bại",
    description: "All external APIs failed completely - no evidence available",
    descriptionVi: "Tất cả API học thuật bên ngoài đều lỗi kết nối — không đủ bằng chứng kết luận",
    conditions: [
      { field: "sources_failed", operator: ">", value: "0" },
      { field: "sources_succeeded", operator: "=", value: "0" },
    ],
    conclusion: "UNRESOLVED",
  },
  "R-NO-CANDIDATE": {
    id: "R-NO-CANDIDATE",
    name: "No Matching Candidates",
    nameVi: "Không tìm thấy ứng viên bài báo",
    description: "No candidates found across queried scholarly & technical databases",
    descriptionVi: "Không tìm thấy ứng viên nào khớp trên các cơ sở dữ liệu học thuật và kỹ thuật đã truy vấn",
    conditions: [
      { field: "candidates", operator: "=", value: "0" },
    ],
    conclusion: "UNRESOLVED",
  },
  "R-RETRACTED-PAPER": {
    id: "R-RETRACTED-PAPER",
    name: "Retracted Publication Warning",
    nameVi: "Cảnh báo bài báo đã bị rút (Retracted)",
    description: "Cited publication has been officially RETRACTED in scholarly registries (Retraction Watch / OpenAlex / Crossref)",
    descriptionVi: "Ấn phẩm được trích dẫn đã chính thức BỊ RÚT BÀI trên cơ sở dữ liệu học thuật (Retraction Watch / OpenAlex / Crossref)",
    conditions: [
      { field: "is_retracted", operator: "=", value: "true" },
    ],
    conclusion: "METADATA_ERROR (RETRACTED)",
  },
  "R-WAYBACK-ARCHIVED": {
    id: "R-WAYBACK-ARCHIVED",
    name: "Wayback Machine Archive Recovery",
    nameVi: "Khôi phục bản lưu trữ Wayback Machine",
    description: "Original URL experienced link rot (HTTP 404/DNS), but a valid historical snapshot was verified on Internet Archive Wayback Machine",
    descriptionVi: "URL gốc bị hỏng (HTTP 404/DNS) nhưng đã xác minh được bản chụp lịch sử hợp lệ trên Internet Archive Wayback Machine",
    conditions: [
      { field: "url_status", operator: "=", value: "archived_alive" },
      { field: "archive_snapshot", operator: "!=", value: "null" },
    ],
    conclusion: "VERIFIED (Archived Resource)",
  },
  "R-GLOBAL-DOI-RA-VERIFIED": {
    id: "R-GLOBAL-DOI-RA-VERIFIED",
    name: "Global DOI Registration Agency Verified",
    nameVi: "Xác minh Cơ quan Đăng ký DOI Toàn cầu",
    description: "Verified via Global DOI Registration Agency (DataCite, JaLC, mEDRA, KISTI, CNKI) & CSL-JSON Content Negotiation",
    descriptionVi: "Đã xác minh qua Cơ quan Đăng ký DOI Toàn cầu (DataCite, JaLC, mEDRA, KISTI, CNKI) & CSL-JSON",
    conditions: [
      { field: "doi_ra_status", operator: "=", value: "registered" },
      { field: "csl_json_title_sim", operator: ">=", value: "0.85" },
    ],
    conclusion: "VERIFIED",
  },
  "R-HF-VERIFIED": {
    id: "R-HF-VERIFIED",
    name: "Hugging Face Hub Model / Dataset / Paper Verified",
    nameVi: "Xác minh Mô hình / Bộ dữ liệu / Bài báo Hugging Face Hub",
    description: "Verified AI model, dataset repository, or daily paper on Hugging Face Hub API",
    descriptionVi: "Đã xác minh mô hình AI, kho dữ liệu hoặc bài báo trên Hugging Face Hub API",
    conditions: [
      { field: "source", operator: "=", value: "huggingface" },
      { field: "title_sim_fuzzy", operator: ">=", value: "0.85" },
    ],
    conclusion: "VERIFIED",
  },
  "R-RFC-VERIFIED": {
    id: "R-RFC-VERIFIED",
    name: "IETF RFC / PyPI / NPM / GitHub Verified",
    nameVi: "Xác minh chuẩn IETF RFC / PyPI / NPM / GitHub",
    description: "Verified technical standard (RFC Editor / IETF Datatracker), software package (PyPI / NPM Registry), or GitHub repository (CITATION.cff)",
    descriptionVi: "Đã xác minh tiêu chuẩn kỹ thuật (RFC Editor / IETF), gói phần mềm (PyPI / NPM) hoặc kho mã nguồn GitHub (CITATION.cff)",
    conditions: [
      { field: "source", operator: "=", value: "tech_standard" },
      { field: "title_sim_fuzzy", operator: ">=", value: "0.80" },
    ],
    conclusion: "VERIFIED",
  },
  "R-GITHUB-VERIFIED": {
    id: "R-GITHUB-VERIFIED",
    name: "GitHub Repository & CITATION.cff Verified",
    nameVi: "Xác minh kho mã nguồn GitHub & CITATION.cff",
    description: "Verified public GitHub repository metadata and CITATION.cff citation file via GitHub REST API",
    descriptionVi: "Đã xác minh metadata kho mã nguồn GitHub công khai và tệp CITATION.cff qua GitHub REST API",
    conditions: [
      { field: "source", operator: "=", value: "tech_standard" },
      { field: "github_repo", operator: "!=", value: "null" },
    ],
    conclusion: "VERIFIED",
  },
  "R-PACKAGE-VERIFIED": {
    id: "R-PACKAGE-VERIFIED",
    name: "PyPI / NPM Package Registry Verified",
    nameVi: "Xác minh gói phần mềm PyPI / NPM Registry",
    description: "Verified software package release metadata and maintainers via PyPI or NPM Registry API",
    descriptionVi: "Đã xác minh metadata phát hành gói phần mềm và tác giả qua PyPI hoặc NPM Registry API",
    conditions: [
      { field: "source", operator: "=", value: "tech_standard" },
      { field: "package_registry", operator: "IN", value: "[pypi, npm]" },
    ],
    conclusion: "VERIFIED",
  },
  "R-SOFTWARE-PACKAGE-VERIFIED": {
    id: "R-SOFTWARE-PACKAGE-VERIFIED",
    name: "Software Package Release Verified",
    nameVi: "Xác minh bản phát hành gói phần mềm",
    description: "Verified open-source software package metadata and release version via PyPI / NPM / Cargo Registry",
    descriptionVi: "Đã xác minh metadata và phiên bản phát hành gói phần mềm mã nguồn mở qua PyPI / NPM",
    conditions: [
      { field: "source", operator: "=", value: "tech_standard" },
      { field: "package_registry", operator: "IN", value: "[pypi, npm]" },
    ],
    conclusion: "VERIFIED",
  },
  "R-WIKIDATA-VERIFIED": {
    id: "R-WIKIDATA-VERIFIED",
    name: "Wikidata Knowledge Graph / OpenCitations Verified",
    nameVi: "Xác minh Wikidata Knowledge Graph / OpenCitations",
    description: "Verified international standard (ISO/IEC, NIST SP, IEEE 802, OWASP, WCAG), clinical manual (DSM-5, ICD-11), or DOI via Wikidata & OpenCitations",
    descriptionVi: "Đã xác minh tiêu chuẩn quốc tế (ISO/IEC, NIST SP, IEEE 802, OWASP, WCAG), cẩm nang y khoa hoặc DOI qua Wikidata & OpenCitations",
    conditions: [
      { field: "source", operator: "=", value: "wikidata_opencitations" },
      { field: "title_sim_fuzzy", operator: ">=", value: "0.80" },
    ],
    conclusion: "VERIFIED",
  },
  "R-WIKIDATA-STANDARD-VERIFIED": {
    id: "R-WIKIDATA-STANDARD-VERIFIED",
    name: "Wikidata Technical Standard Verified",
    nameVi: "Xác minh tiêu chuẩn kỹ thuật trên Wikidata",
    description: "Verified technical standard or specification entity via Wikidata Knowledge Graph",
    descriptionVi: "Đã xác minh thực thể tiêu chuẩn kỹ thuật hoặc đặc tả qua Wikidata Knowledge Graph",
    conditions: [
      { field: "source", operator: "=", value: "wikidata_opencitations" },
      { field: "entity_type", operator: "=", value: "standard" },
    ],
    conclusion: "VERIFIED",
  },
  "R-OPENCITATIONS-VERIFIED": {
    id: "R-OPENCITATIONS-VERIFIED",
    name: "OpenCitations COCI Graph Verified",
    nameVi: "Xác minh đồ thị trích dẫn OpenCitations COCI",
    description: "Verified DOI citation provenance and bibliographic links via OpenCitations COCI API",
    descriptionVi: "Đã xác minh nguồn gốc trích dẫn DOI và liên kết thư mục qua OpenCitations COCI API",
    conditions: [
      { field: "source", operator: "=", value: "opencitations" },
      { field: "doi_exact_match", operator: "=", value: "true" },
    ],
    conclusion: "VERIFIED",
  },
  "R-WEAK-EVIDENCE": {
    id: "R-WEAK-EVIDENCE",
    name: "Weak Evidence Fallback",
    nameVi: "Bằng chứng đối chiếu yếu",
    description: "Some candidates found but similarity scores are too low for verification",
    descriptionVi: "Tìm thấy một số ứng viên nhưng điểm tương đồng quá thấp để xác nhận",
    conditions: [
      { field: "title_sim", operator: "<", value: "0.70" },
      { field: "author_jaccard", operator: "<", value: "0.40" },
    ],
    conclusion: "UNRESOLVED",
  },
  "R-LOCAL_DB_VERIFIED": {
    id: "R-LOCAL_DB_VERIFIED",
    name: "Local Scholarly Index Verified",
    nameVi: "Xác minh khớp chính xác trên CSDL học thuật cục bộ",
    description: "Exact title, author, and publication year verified in local scholarly database",
    descriptionVi: "Tiêu đề, tác giả và năm xuất bản khớp chính xác trong cơ sở dữ liệu học thuật cục bộ",
    conditions: [
      { field: "source", operator: "IN", value: "[local_db, known_papers]" },
      { field: "title_sim_fuzzy", operator: ">=", value: "0.95" },
      { field: "author_jaccard", operator: ">=", value: "0.80" },
    ],
    conclusion: "VERIFIED",
  },
  "R-LOCAL_DB_GOOD_MATCH": {
    id: "R-LOCAL_DB_GOOD_MATCH",
    name: "Strong Local Index Match",
    nameVi: "Khớp độ tương đồng cao trên CSDL cục bộ",
    description: "High title and author similarity confirmed in local scholarly database",
    descriptionVi: "Xác nhận độ tương đồng tiêu đề và tác giả cao trong cơ sở dữ liệu học thuật cục bộ",
    conditions: [
      { field: "source", operator: "IN", value: "[local_db, known_papers]" },
      { field: "title_sim_fuzzy", operator: ">=", value: "0.85" },
      { field: "author_jaccard", operator: ">=", value: "0.50" },
    ],
    conclusion: "VERIFIED",
  },
  "R-LOCAL_DB_METADATA_ERROR": {
    id: "R-LOCAL_DB_METADATA_ERROR",
    name: "Local Scholarly Index Metadata Discrepancy",
    nameVi: "Sai lệch Metadata so với CSDL học thuật cục bộ",
    description: "Matched a paper in the local scholarly index, but cited year or author list differs from the canonical record",
    descriptionVi: "Khớp bài báo trong chỉ mục học thuật cục bộ nhưng năm xuất bản hoặc danh sách tác giả bị sai lệch",
    conditions: [
      { field: "source", operator: "=", value: "local_db" },
      { field: "title_sim_fuzzy", operator: ">=", value: "0.85" },
      { field: "mismatched_fields", operator: "!=", value: "[]" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-LOCAL_DB": {
    id: "R-LOCAL_DB",
    name: "Local Database Provenance",
    nameVi: "Nguồn gốc từ CSDL học thuật cục bộ",
    description: "Candidate retrieved from local SQLite FTS5 scholarly paper index",
    descriptionVi: "Ứng viên được truy xuất từ chỉ mục bài báo học thuật SQLite FTS5 cục bộ",
    conditions: [
      { field: "used_local_db", operator: "=", value: "true" },
    ],
    conclusion: "VERIFIED",
  },
  "R-LOCAL_DB_ONLY": {
    id: "R-LOCAL_DB_ONLY",
    name: "Standalone Local Database Verification",
    nameVi: "Xác minh độc lập qua CSDL cục bộ",
    description: "Verified via local scholarly index while external APIs were unavailable",
    descriptionVi: "Xác minh qua chỉ mục học thuật cục bộ khi các API bên ngoài không phản hồi",
    conditions: [
      { field: "used_local_db", operator: "=", value: "true" },
      { field: "external_apis", operator: "=", value: "0" },
    ],
    conclusion: "VERIFIED",
  },
  "R-API_EXHAUSTED": {
    id: "R-API_EXHAUSTED",
    name: "External API Quota Exhausted",
    nameVi: "Cạn hạn ngạch API bên ngoài",
    description: "One or more external scholarly APIs reached rate/quota limits; confidence adjusted accordingly",
    descriptionVi: "Một hoặc nhiều API học thuật bên ngoài đạt giới hạn tần suất truy vấn; đã điều chỉnh độ tin cậy tương ứng",
    conditions: [
      { field: "api_exhausted", operator: "=", value: "true" },
    ],
    conclusion: "Confidence penalty applied",
  },
  "R-KNOWN-PAPER": {
    id: "R-KNOWN-PAPER",
    name: "Known Seminal Publication",
    nameVi: "Công trình nghiên cứu kinh điển đã biết",
    description: "Matches canonical benchmark paper in curated seminal publications registry",
    descriptionVi: "Khớp với bài báo chuẩn trong danh mục các công trình nghiên cứu kinh điển",
    conditions: [
      { field: "source", operator: "=", value: "known_papers" },
      { field: "title_sim_fuzzy", operator: ">=", value: "0.85" },
    ],
    conclusion: "VERIFIED",
  },
  "R-KNOWN-PAPER-NO-TITLE": {
    id: "R-KNOWN-PAPER-NO-TITLE",
    name: "Known Seminal Paper (Author-Year Match)",
    nameVi: "Công trình kinh điển (Khớp Tác giả - Năm)",
    description: "In-text citation matches canonical seminal publication by author and year",
    descriptionVi: "Trích dẫn trong bài khớp với công trình kinh điển theo tác giả và năm xuất bản",
    conditions: [
      { field: "source", operator: "=", value: "known_papers" },
      { field: "author_year_match", operator: "=", value: "true" },
    ],
    conclusion: "VERIFIED",
  },
  "R-SINGLE-SOURCE-VERIFIED": {
    id: "R-SINGLE-SOURCE-VERIFIED",
    name: "Single Registry High-Confidence Match",
    nameVi: "Khớp độ tin cậy cao từ CSDL đơn lẻ",
    description: "Verified by a live scholarly registry with strong title, author, and year agreement",
    descriptionVi: "Đã xác minh trên cơ sở dữ liệu học thuật trực tuyến với độ khớp tiêu đề, tác giả và năm cao",
    conditions: [
      { field: "consensus", operator: ">=", value: "1" },
      { field: "title_sim_fuzzy", operator: ">=", value: "0.90" },
      { field: "author_jaccard", operator: ">=", value: "0.80" },
      { field: "year_distance", operator: "<=", value: "1" },
    ],
    conclusion: "VERIFIED",
  },
  "R-SINGLE-SOURCE-PARTIAL": {
    id: "R-SINGLE-SOURCE-PARTIAL",
    name: "Single Registry Match with Metadata Discrepancy",
    nameVi: "Khớp CSDL đơn lẻ nhưng lệch Metadata",
    description: "Scholarly record found on live registry but has author, year, or title discrepancy",
    descriptionVi: "Tìm thấy hồ sơ học thuật trên cơ sở dữ liệu trực tuyến nhưng có sai lệch tác giả, năm hoặc tiêu đề",
    conditions: [
      { field: "consensus", operator: ">=", value: "1" },
      { field: "title_sim", operator: ">=", value: "0.60" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-BROKEN-LINK": {
    id: "R-BROKEN-LINK",
    name: "Broken Citation URL on Verified Work",
    nameVi: "Đường dẫn URL bị hỏng trên bài báo hợp lệ",
    description: "Cited URL returned HTTP 404/410 or failed DNS, though the scholarly paper exists",
    descriptionVi: "URL trích dẫn trả về lỗi HTTP 404/410 hoặc DNS dù ấn phẩm học thuật thực sự tồn tại",
    conditions: [
      { field: "url_status", operator: "=", value: "dead_link" },
      { field: "scholarly_record", operator: "=", value: "verified" },
    ],
    conclusion: "METADATA_ERROR (flagged)",
  },
  "R-DEAD-URL": {
    id: "R-DEAD-URL",
    name: "Dead Citation URL with No Scholarly Record",
    nameVi: "URL chết và không có hồ sơ học thuật",
    description: "Cited URL is unreachable/404 and no matching scholarly paper exists across registries",
    descriptionVi: "URL trích dẫn không thể truy cập (404) và không tồn tại bài báo học thuật nào khớp",
    conditions: [
      { field: "url_status", operator: "=", value: "dead_link" },
      { field: "title_sim", operator: "<", value: "0.60" },
    ],
    conclusion: "SUSPECTED_HALLUCINATION",
  },
  "R-NONEXISTENT-DOI": {
    id: "R-NONEXISTENT-DOI",
    name: "Non-Existent DOI in Scholarly Registries",
    nameVi: "Mã DOI không tồn tại trên hệ thống đăng ký",
    description: "Cited DOI failed to resolve to the cited work across live scholarly registries",
    descriptionVi: "Mã DOI được trích dẫn không phân giải được tới bài báo nào trên các cơ sở dữ liệu học thuật",
    conditions: [
      { field: "doi_exact_match", operator: "=", value: "false" },
      { field: "title_sim", operator: "<", value: "0.60" },
    ],
    conclusion: "SUSPECTED_HALLUCINATION",
  },
  "R-NO-SCHOLARLY-RECORD": {
    id: "R-NO-SCHOLARLY-RECORD",
    name: "Zero Records in Scholarly Registries",
    nameVi: "Không tồn tại bản ghi trên CSDL học thuật",
    description: "Multiple live scholarly registries responded cleanly (HTTP 200) with zero matching records",
    descriptionVi: "Nhiều cơ sở dữ liệu học thuật phản hồi thành công (HTTP 200) nhưng không có bản ghi nào khớp",
    conditions: [
      { field: "clean_empty_registries", operator: ">=", value: "2" },
      { field: "candidates", operator: "=", value: "0" },
    ],
    conclusion: "SUSPECTED_HALLUCINATION",
  },
  "R-HALLUCINATED-SOURCE": {
    id: "R-HALLUCINATED-SOURCE",
    name: "Hallucinated / Unverifiable Source Evidence",
    nameVi: "Bằng chứng nguồn có dấu hiệu ngụy tạo (Hallucination)",
    description: "Retrieved candidates have extremely low title and author similarity below abstention threshold",
    descriptionVi: "Các ứng viên tìm được có độ tương đồng tiêu đề và tác giả cực thấp dưới ngưỡng tối thiểu",
    conditions: [
      { field: "title_sim", operator: "<", value: "0.40" },
      { field: "author_jaccard", operator: "<", value: "0.30" },
      { field: "doi_exact_match", operator: "=", value: "false" },
    ],
    conclusion: "SUSPECTED_HALLUCINATION",
  },
  "R-NON-SCHOLARLY-RESOURCE": {
    id: "R-NON-SCHOLARLY-RESOURCE",
    name: "Non-Scholarly Web Resource",
    nameVi: "Tài nguyên web phi học thuật",
    description: "Reference points to a general web page, blog, or software documentation rather than a peer-reviewed publication",
    descriptionVi: "Tài liệu tham khảo trỏ tới trang web thông thường hoặc tài liệu kỹ thuật thay vì ấn phẩm học thuật",
    conditions: [
      { field: "resource_category", operator: "=", value: "non_scholarly" },
    ],
    conclusion: "UNRESOLVED",
  },
  "R-UNINDEXED-BOOK-OR-SOURCE": {
    id: "R-UNINDEXED-BOOK-OR-SOURCE",
    name: "Unindexed Regional Book / Print Monograph",
    nameVi: "Sách in / Giáo trình khu vực chưa lập chỉ mục số",
    description: "Citation appears to be a regional print textbook, thesis, or monograph not indexed in global APIs",
    descriptionVi: "Trích dẫn có dạng sách in, giáo trình nội bộ hoặc luận văn chưa được lập chỉ mục trên các API quốc tế",
    conditions: [
      { field: "is_book_or_thesis_pattern", operator: "=", value: "true" },
      { field: "candidates", operator: "=", value: "0" },
    ],
    conclusion: "UNRESOLVED",
  },
  "R-URL-RESOURCE": {
    id: "R-URL-RESOURCE",
    name: "Direct URL Reference",
    nameVi: "Trích dẫn URL trực tiếp",
    description: "Non-academic web link or software repository URL",
    descriptionVi: "Đường dẫn trang web hoặc kho mã nguồn phần mềm trực tiếp",
    conditions: [
      { field: "citation_type", operator: "=", value: "url_resource" },
    ],
    conclusion: "VERIFIED (Resource)",
  },
  "R-WEB-RESOURCE": {
    id: "R-WEB-RESOURCE",
    name: "Web / Technical Documentation Resource",
    nameVi: "Tài nguyên Web / Tài liệu kỹ thuật",
    description: "Technical documentation, API guide, or non-scholarly web reference",
    descriptionVi: "Tài liệu hướng dẫn kỹ thuật, đặc tả API hoặc tài nguyên web",
    conditions: [
      { field: "resource_type", operator: "=", value: "web_documentation" },
    ],
    conclusion: "VERIFIED (Resource)",
  },
  "R-VN-LEGAL-FORMAT": {
    id: "R-VN-LEGAL-FORMAT",
    name: "Legal / Statutory Document Format",
    nameVi: "Định dạng văn bản quy phạm pháp luật",
    description: "Matches official statutory or government legal document citation format",
    descriptionVi: "Khớp định dạng trích dẫn văn bản quy phạm pháp luật chính thức",
    conditions: [
      { field: "is_legal_reference", operator: "=", value: "true" },
    ],
    conclusion: "VERIFIED",
  },
  "R-LEGAL-DOCUMENT": {
    id: "R-LEGAL-DOCUMENT",
    name: "Vietnamese Statutory Legal Document",
    nameVi: "Văn bản quy phạm pháp luật Việt Nam",
    description: "Detected Vietnamese statutory instrument (Law, Code, Decree, Circular, Resolution, Decision)",
    descriptionVi: "Nhận diện văn bản quy phạm pháp luật Việt Nam (Luật, Bộ luật, Nghị định, Thông tư, Nghị quyết, Quyết định)",
    conditions: [
      { field: "doc_category", operator: "=", value: "vn_legal_statute" },
    ],
    conclusion: "VERIFIED",
  },
  "R-VN-LEGAL-VERIFIED": {
    id: "R-VN-LEGAL-VERIFIED",
    name: "Vietnamese Legal Registry Verified",
    nameVi: "Xác minh trên Cơ sở dữ liệu Pháp luật Việt Nam",
    description: "Verified statutory code/number, promulgation year, and issuing authority against Vietnamese Legal Registry",
    descriptionVi: "Đã xác minh số hiệu, năm ban hành và cơ quan ban hành đối chiếu với Cơ sở dữ liệu Pháp luật Việt Nam",
    conditions: [
      { field: "source", operator: "=", value: "vn_legal_registry" },
      { field: "statute_match", operator: "=", value: "true" },
    ],
    conclusion: "VERIFIED",
  },
  "R-VN-LEGAL-MISMATCH": {
    id: "R-VN-LEGAL-MISMATCH",
    name: "Vietnamese Legal Document Metadata Mismatch",
    nameVi: "Sai lệch thông tin văn bản pháp luật Việt Nam",
    description: "Found matching Vietnamese legal statute, but promulgation year, code number, or issuing agency differs",
    descriptionVi: "Tìm thấy văn bản pháp luật tương ứng nhưng năm ban hành, số hiệu hoặc cơ quan ban hành bị sai lệch",
    conditions: [
      { field: "source", operator: "=", value: "vn_legal_registry" },
      { field: "mismatched_fields", operator: "!=", value: "[]" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-VN-LEGAL-SUPERSEDED": {
    id: "R-VN-LEGAL-SUPERSEDED",
    name: "Superseded Vietnamese Legal Statute",
    nameVi: "Văn bản pháp luật đã hết hiệu lực / bị thay thế",
    description: "Cited Vietnamese law or decree has been superseded or replaced by a newer statutory enactment",
    descriptionVi: "Luật hoặc Nghị định được trích dẫn đã hết hiệu lực hoặc bị thay thế bởi văn bản pháp luật mới hơn",
    conditions: [
      { field: "source", operator: "=", value: "vn_legal_registry" },
      { field: "legal_status", operator: "=", value: "superseded" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-VN-LEGAL-FABRICATED": {
    id: "R-VN-LEGAL-FABRICATED",
    name: "Fabricated Vietnamese Legal Document",
    nameVi: "Văn bản pháp luật ngụy tạo / không tồn tại",
    description: "Cited legal document number, promulgation year, or issuing body is impossible or fabricated",
    descriptionVi: "Số hiệu, năm ban hành hoặc cơ quan ban hành văn bản pháp luật không tồn tại hoặc bị ngụy tạo",
    conditions: [
      { field: "source", operator: "=", value: "vn_legal_registry" },
      { field: "is_fabricated_statute", operator: "=", value: "true" },
    ],
    conclusion: "SUSPECTED_HALLUCINATION",
  },
  "R-LEGAL-STATUTE-VERIFIED": {
    id: "R-LEGAL-STATUTE-VERIFIED",
    name: "Official Legal Statute Verified",
    nameVi: "Xác minh văn bản quy phạm pháp luật chính thức",
    description: "Verified statutory instrument metadata against official legal database",
    descriptionVi: "Đã xác minh thông tin văn bản quy phạm pháp luật đối chiếu với cơ sở dữ liệu pháp luật chính thức",
    conditions: [
      { field: "source", operator: "=", value: "vn_legal_registry" },
      { field: "statute_match", operator: "=", value: "true" },
    ],
    conclusion: "VERIFIED",
  },
  "R-LEGAL-STATUTE-ERROR": {
    id: "R-LEGAL-STATUTE-ERROR",
    name: "Legal Statute Metadata or Validity Error",
    nameVi: "Lỗi thông tin hoặc hiệu lực văn bản pháp luật",
    description: "Statutory citation has a number/year discrepancy or references a superseded regulation",
    descriptionVi: "Trích dẫn văn bản pháp luật bị sai số hiệu/năm ban hành hoặc viện dẫn quy định đã hết hiệu lực",
    conditions: [
      { field: "source", operator: "=", value: "vn_legal_registry" },
      { field: "statute_error", operator: "=", value: "true" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-BOOK-EDITION-VERIFIED": {
    id: "R-BOOK-EDITION-VERIFIED",
    name: "Canonical Book / Monograph Edition Verified",
    nameVi: "Xác minh ấn bản Sách chuyên khảo / Giáo trình",
    description: "Verified textbook or monograph edition against OpenLibrary / Google Books bibliographic records",
    descriptionVi: "Đã xác minh ấn bản giáo trình hoặc sách chuyên khảo đối chiếu với OpenLibrary / Google Books",
    conditions: [
      { field: "openlibrary_edition_match", operator: "=", value: "true" },
      { field: "title_sim_fuzzy", operator: ">=", value: "0.90" },
      { field: "author_jaccard", operator: ">=", value: "0.70" },
    ],
    conclusion: "VERIFIED",
  },
}

function getVerdictColorClass(conclusion: string): {
  bg: string
  border: string
  text: string
  icon: React.ReactNode
} {
  if (conclusion.includes("VERIFIED")) {
    return {
      bg: "bg-emerald-50 dark:bg-emerald-950",
      border: "border-emerald-200 dark:border-emerald-800",
      text: "text-emerald-700 dark:text-emerald-300",
      icon: <CheckCircle className="h-3.5 w-3.5" />,
    }
  }
  if (conclusion.includes("METADATA_ERROR")) {
    return {
      bg: "bg-amber-50 dark:bg-amber-950",
      border: "border-amber-200 dark:border-amber-800",
      text: "text-amber-700 dark:text-amber-300",
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
    }
  }
  if (conclusion.includes("HALLUCINATION")) {
    return {
      bg: "bg-red-50 dark:bg-red-950",
      border: "border-red-200 dark:border-red-800",
      text: "text-red-700 dark:text-red-300",
      icon: <XCircle className="h-3.5 w-3.5" />,
    }
  }
  return {
    bg: "bg-slate-50 dark:bg-slate-800",
    border: "border-slate-200 dark:border-slate-700",
    text: "text-slate-700 dark:text-slate-300",
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
  }
}

export function RuleInspector({
  triggeredRules,
  verdictLabel,
  className
}: RuleInspectorProps) {
  const { i18n } = useTranslation()
  const isVi = i18n.language?.startsWith("vi")

  const rules: Rule[] = triggeredRules.map((ruleId) => {
    const definition = RULE_DEFINITIONS[ruleId]
    if (definition) {
      return { ...definition, triggered: true }
    }
    return {
      id: ruleId,
      name: ruleId,
      nameVi: ruleId,
      description: "Custom rule triggered",
      descriptionVi: "Quy tắc kiểm tra bổ sung được kích hoạt",
      conditions: [],
      conclusion: verdictLabel || "UNKNOWN",
      triggered: true,
    }
  })

  if (rules.length === 0) {
    return (
      <Card className={cn("bg-slate-50 dark:bg-slate-800/50 p-4", className)}>
        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
          <FileCode className="h-4 w-4" />
          <span className="text-sm">
            {isVi ? "Chưa có luật nào được kích hoạt" : "No rules triggered"}
          </span>
        </div>
      </Card>
    )
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-2">
        <FileCode className="h-4 w-4 text-slate-500 dark:text-slate-400" />
        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
          {isVi ? `Luật được kích hoạt (${rules.length})` : `Triggered Rules (${rules.length})`}
        </h4>
      </div>

      <div className="space-y-2">
        {rules.map((rule) => {
          const colors = getVerdictColorClass(rule.conclusion)
          const displayName = isVi ? rule.nameVi : rule.name
          const displayDesc = isVi ? rule.descriptionVi : rule.description

          return (
            <Card
              key={rule.id}
              className={cn(
                "p-3",
                colors.bg,
                colors.border
              )}
            >
              <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn("font-mono text-xs font-semibold break-all", colors.text)}>
                      {rule.id}
                    </span>
                  </div>
                  <p className={cn("text-sm font-medium mt-0.5", colors.text)}>
                    {displayName}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={cn("flex items-center gap-1 text-xs font-medium px-2 py-1 rounded shrink-0", colors.bg, colors.border, colors.text)}
                >
                  {colors.icon}
                  <span className="text-[10px]">{rule.conclusion}</span>
                </Badge>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">
                {displayDesc}
              </p>

              {rule.conditions.length > 0 && (
                <div className="mt-2 p-2 bg-white/50 dark:bg-slate-900/50 rounded border border-slate-200/50 dark:border-slate-700/50 overflow-x-auto">
                  <div className="font-mono text-xs space-y-1">
                    <div className="text-slate-500 dark:text-slate-400 font-semibold">
                      {isVi ? "NẾU" : "IF"}
                    </div>
                    {rule.conditions.map((condition, idx) => (
                      <div key={idx} className="flex items-center gap-1 text-slate-600 dark:text-slate-300 pl-3 flex-wrap">
                        {idx > 0 && (
                          <span className="text-slate-400 dark:text-slate-500 mr-1">
                            {isVi ? "VÀ" : "AND"}
                          </span>
                        )}
                        <span className="font-medium break-all">{condition.field}</span>
                        <span className="text-slate-400">{condition.operator}</span>
                        <span className="text-slate-500 break-all">{condition.value}</span>
                      </div>
                    ))}
                    <div className="text-slate-500 dark:text-slate-400 font-semibold mt-2">
                      {isVi ? "KẾT LUẬN" : "THEN"}
                    </div>
                    <div className="pl-3 text-slate-600 dark:text-slate-300 break-words">
                      {rule.conclusion}
                    </div>
                  </div>
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}

export function RuleInspectorCompact({
  triggeredRules,
  className
}: {
  triggeredRules: string[]
  className?: string
}) {
  const { i18n } = useTranslation()
  const isVi = i18n.language?.startsWith("vi")

  if (triggeredRules.length === 0) {
    return null
  }

  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {triggeredRules.map((ruleId) => {
        const definition = RULE_DEFINITIONS[ruleId]
        const conclusion = definition?.conclusion || "UNKNOWN"
        const colors = getVerdictColorClass(conclusion)
        const tooltip = definition
          ? isVi
            ? definition.descriptionVi
            : definition.description
          : ruleId

        return (
          <Badge
            key={ruleId}
            variant="outline"
            className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold border",
              colors.bg,
              colors.border,
              colors.text
            )}
            title={tooltip}
          >
            {colors.icon}
            {ruleId}
          </Badge>
        )
      })}
    </div>
  )
}
