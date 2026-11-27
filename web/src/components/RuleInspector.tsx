import { useTranslation } from "react-i18next"
import type { Verdict } from "@/api/client"
import { cn } from "@/lib/utils"
import { ListChecks, CheckCircle, XCircle, AlertTriangle } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { getVerdictDisplay, normalizeVerdictKey } from "@/lib/academicTaxonomy"

/* ============================================================
   CITRA — Verification Checks Inspector Component
   Plain-language bilingual verification explanations
   ============================================================ */

export interface RuleDefinition {
  id: string
  name: string
  nameVi: string
  description: string
  descriptionVi: string
  category?: "verified" | "warning" | "error" | "info"
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
  features?: Verdict["features"]
  className?: string
}

export const RULE_DEFINITIONS: Record<string, RuleDefinition> = {
  "R-FAKE-URL": {
    id: "R-FAKE-URL",
    name: "Unrecognized or Placeholder Web Link",
    nameVi: "Liên kết web là địa chỉ mẫu hoặc không hợp lệ",
    description: "The cited web address uses a placeholder domain (such as example.com or test.com) rather than an active publication source.",
    descriptionVi: "Đường dẫn sử dụng tên miền mẫu (như example.com, test.com) thay vì trang web tài liệu thực tế.",
    conditions: [
      { field: "url_domain", operator: "IN", value: "[placeholder_domains]" },
    ],
    conclusion: "SUSPECTED_HALLUCINATION",
  },
  "R-FABRICATED-DOI": {
    id: "R-FABRICATED-DOI",
    name: "Unregistered DOI Format",
    nameVi: "Mã DOI chưa được đăng ký",
    description: "The cited DOI uses a test or unrecognized publisher prefix (such as 10.1234 or 10.9999) that does not match a registered publication.",
    descriptionVi: "Mã DOI sử dụng tiền tố thử nghiệm hoặc chưa được đăng ký chính thức (như 10.1234, 10.9999).",
    conditions: [
      { field: "doi_pattern", operator: "MATCHES", value: "[unregistered_prefix]" },
    ],
    conclusion: "SUSPECTED_HALLUCINATION",
  },
  "R-FAKE-AUTHOR": {
    id: "R-FAKE-AUTHOR",
    name: "Placeholder Author Name",
    nameVi: "Tên tác giả có dạng mẫu thử",
    description: "The author name looks like a sample or placeholder name rather than a published author.",
    descriptionVi: "Tên tác giả có dạng ví dụ minh họa hoặc chưa khớp với tên tác giả thực tế.",
    conditions: [
      { field: "author_pattern", operator: "MATCHES", value: "[placeholder_author]" },
    ],
    conclusion: "SUSPECTED_HALLUCINATION",
  },
  "R-FUTURE-YEAR": {
    id: "R-FUTURE-YEAR",
    name: "Future Publication Year",
    nameVi: "Năm xuất bản ở tương lai",
    description: "The listed publication year is in the future and no matching author record was found. Please check for a typo.",
    descriptionVi: "Năm xuất bản lớn hơn năm hiện tại và chưa tìm thấy tác giả tương ứng — vui lòng kiểm tra lại xem có lỗi gõ năm không.",
    conditions: [
      { field: "cited_year", operator: ">", value: "current_year" },
    ],
    conclusion: "SUSPECTED_HALLUCINATION",
  },
  "R-FUTURE-YEAR-KNOWN-AUTHOR": {
    id: "R-FUTURE-YEAR-KNOWN-AUTHOR",
    name: "Future Year for Known Author",
    nameVi: "Năm xuất bản ở tương lai (đã tìm thấy tác giả)",
    description: "The publication year is in the future, though the author is recognized — likely a year typo.",
    descriptionVi: "Năm xuất bản lớn hơn năm hiện tại nhưng tác giả có trong thư viện — có thể là lỗi gõ nhầm năm.",
    conditions: [
      { field: "cited_year", operator: ">", value: "current_year" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-DOI-TITLE-AUTHOR": {
    id: "R-DOI-TITLE-AUTHOR",
    name: "DOI, Title, and Authors Match",
    nameVi: "Khớp mã DOI, tiêu đề và tác giả",
    description: "The cited DOI matches the published record, and both the title and authors align closely.",
    descriptionVi: "Mã DOI khớp chính xác với bản gốc, đồng thời tiêu đề và danh sách tác giả đều trùng khớp.",
    conditions: [
      { field: "doi_exact_match", operator: "=", value: "true" },
    ],
    conclusion: "VERIFIED",
  },
  "R-WELL-LINKED": {
    id: "R-WELL-LINKED",
    name: "Strong Match Across Citation Details",
    nameVi: "Khớp chặt chẽ tiêu đề, tác giả và năm xuất bản",
    description: "The citation matches a published record closely across title, authors, and publication year.",
    descriptionVi: "Trích dẫn khớp chặt chẽ với tài liệu gốc về tiêu đề, tác giả và năm xuất bản.",
    conditions: [
      { field: "mapping_status", operator: "=", value: "matched" },
    ],
    conclusion: "VERIFIED",
  },
  "R-WELL-LINKED-MODERATE": {
    id: "R-WELL-LINKED-MODERATE",
    name: "Good Match with Minor Wording Differences",
    nameVi: "Khớp tốt tiêu đề và tác giả",
    description: "The citation matches a published work by author and year with close title wording.",
    descriptionVi: "Trích dẫn khớp với tài liệu gốc về tác giả, năm và tiêu đề ở mức tốt.",
    conditions: [
      { field: "mapping_status", operator: "=", value: "matched" },
    ],
    conclusion: "VERIFIED (with metadata note)",
  },
  "R-DOI-TITLE-MISMATCH": {
    id: "R-DOI-TITLE-MISMATCH",
    name: "DOI Matched, Title Differs",
    nameVi: "Khớp mã DOI nhưng tiêu đề chưa khớp",
    description: "The DOI points to a real publication, but the title in your citation differs from the published record.",
    descriptionVi: "Mã DOI dẫn đến bài báo có thật, nhưng tiêu đề bạn ghi trong bài khác với bản gốc.",
    conditions: [
      { field: "doi_exact_match", operator: "=", value: "true" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-DOI-CONFLICT": {
    id: "R-DOI-CONFLICT",
    name: "Conflicting DOI Across Academic Libraries",
    nameVi: "Mã DOI khác nhau giữa các thư viện học thuật",
    description: "Different academic libraries list conflicting DOI identifiers for this matched publication.",
    descriptionVi: "Các thư viện học thuật ghi nhận mã DOI khác nhau cho cùng công trình này — hãy kiểm tra lại mã DOI chính thức.",
    category: "warning",
    conditions: [
      { field: "distinct_dois", operator: ">", value: "1" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-VENUE-MISMATCH": {
    id: "R-VENUE-MISMATCH",
    name: "Journal or Conference Name Differs",
    nameVi: "Sai lệch tên tạp chí hoặc hội nghị",
    description: "The cited journal or conference name differs from the published venue record.",
    descriptionVi: "Tên tạp chí hoặc hội nghị bạn ghi khác với nơi công bố chính thức của tài liệu.",
    conditions: [
      { field: "venue_match", operator: "=", value: "false" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-CHIMERIC-DOI-MISMATCH": {
    id: "R-CHIMERIC-DOI-MISMATCH",
    name: "DOI Points to a Different Publication",
    nameVi: "Mã DOI trỏ sang một bài báo khác",
    description: "The cited DOI resolves to a completely different publication than the title and authors listed in your citation.",
    descriptionVi: "Mã DOI bạn ghi dẫn đến một công trình hoàn toàn khác với tiêu đề và tác giả trong trích dẫn.",
    conditions: [
      { field: "doi_mismatch", operator: "=", value: "true" },
    ],
    conclusion: "SUSPECTED_HALLUCINATION",
  },
  "R-CONSENSUS-FULL": {
    id: "R-CONSENSUS-FULL",
    name: "Confirmed by Multiple Academic Libraries",
    nameVi: "Được xác nhận đồng thời trên nhiều thư viện học thuật",
    description: "Multiple academic libraries agree on the title, authors, and publication year.",
    descriptionVi: "Nhiều thư viện học thuật cùng xác nhận trùng khớp về tiêu đề, tác giả và năm xuất bản.",
    conditions: [
      { field: "consensus", operator: ">=", value: "2" },
    ],
    conclusion: "VERIFIED",
  },
  "R-CONSENSUS-PARTIAL": {
    id: "R-CONSENSUS-PARTIAL",
    name: "Matched in Libraries with Some Details Differing",
    nameVi: "Tìm thấy trên thư viện nhưng một vài chi tiết chưa khớp",
    description: "Multiple academic libraries found this publication, but some citation details differ from the published record.",
    descriptionVi: "Các thư viện học thuật đã tìm thấy công trình này nhưng một vài thông tin (như năm hoặc tác giả) chưa khớp.",
    conditions: [
      { field: "consensus", operator: ">=", value: "2" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-KNOWN-AUTHOR-TITLE-MISMATCH": {
    id: "R-KNOWN-AUTHOR-TITLE-MISMATCH",
    name: "Author Recognized, Title Differs",
    nameVi: "Tác giả khớp nhưng tiêu đề có sai lệch",
    description: "The author was found in academic libraries, but the cited title differs from the published record.",
    descriptionVi: "Đã tìm thấy tác giả trong thư viện học thuật nhưng tiêu đề trích dẫn có khác biệt so với bản gốc.",
    conditions: [
      { field: "author_match", operator: "=", value: "true" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-KNOWN-AUTHOR-WEAK-EVIDENCE": {
    id: "R-KNOWN-AUTHOR-WEAK-EVIDENCE",
    name: "Author Recognized, Source Details Uncertain",
    nameVi: "Tác giả khớp nhưng thông tin công trình chưa đủ rõ",
    description: "The author was found, but the matching record differs noticeably from your citation details.",
    descriptionVi: "Tìm thấy tên tác giả nhưng thông tin bài báo trong thư viện còn khác nhiều so với trích dẫn của bạn.",
    conditions: [
      { field: "author_match", operator: "=", value: "true" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-TITLE-MISMATCH": {
    id: "R-TITLE-MISMATCH",
    name: "Title Differs from Published Record",
    nameVi: "Sai lệch tiêu đề so với bản gốc",
    description: "The author and year match a published work, but the cited title differs from the official title.",
    descriptionVi: "Tác giả và năm xuất bản khớp với tài liệu có thật, nhưng tiêu đề bạn ghi khác với tiêu đề gốc.",
    conditions: [
      { field: "author_year_match", operator: "=", value: "true" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-CONTENT-ALIGNMENT": {
    id: "R-CONTENT-ALIGNMENT",
    name: "Context Matches Source Summary",
    nameVi: "Ngữ cảnh trích dẫn phù hợp với nội dung nguồn",
    description: "The sentence where this source is cited aligns well with the summary of the published work.",
    descriptionVi: "Đoạn văn trích dẫn trong bài phù hợp về nội dung với tóm tắt của tài liệu gốc.",
    conditions: [
      { field: "content_aligned", operator: "=", value: "true" },
    ],
    conclusion: "VERIFIED",
  },
  "R-CROSS-LINGUAL-ALIGNMENT": {
    id: "R-CROSS-LINGUAL-ALIGNMENT",
    name: "Cross-Language Meaning Match (VI ↔ EN)",
    nameVi: "Khớp nội dung song ngữ Việt ↔ Anh",
    description: "The Vietnamese sentence in your essay aligns in meaning with the English summary of the cited paper.",
    descriptionVi: "Đoạn văn tiếng Việt trong bài phù hợp về nội dung với tóm tắt tiếng Anh của bài báo gốc.",
    conditions: [
      { field: "cross_lingual_match", operator: "=", value: "true" },
    ],
    conclusion: "VERIFIED",
  },
  "R-CROSS-LINGUAL-TITLE-MATCH": {
    id: "R-CROSS-LINGUAL-TITLE-MATCH",
    name: "Foreign-Language Title Was Translated",
    nameVi: "Tiêu đề bài báo nước ngoài đang bị dịch sang tiếng Việt",
    description: "The Vietnamese title matches an English published work in meaning. Academic citation guidelines recommend keeping the original publication title (with an optional translation in brackets).",
    descriptionVi: "Tiêu đề dịch tiếng Việt khớp nội dung với bài báo gốc tiếng Anh. Theo thông lệ trích dẫn học thuật, hãy giữ nguyên tiêu đề gốc bằng tiếng nước ngoài (có thể ghi thêm bản dịch trong ngoặc vuông).",
    conditions: [
      { field: "translated_title", operator: "=", value: "true" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-CONTENT-MISMATCH": {
    id: "R-CONTENT-MISMATCH",
    name: "Context May Differ from Source Topic",
    nameVi: "Ngữ cảnh trích dẫn có thể khác chủ đề bài gốc",
    description: "The title matches, but the surrounding sentence in your essay appears unrelated to the source summary. Please confirm this is the intended source.",
    descriptionVi: "Tiêu đề khớp nhưng đoạn văn trích dẫn trong bài có nội dung khá khác với tóm tắt tài liệu gốc — hãy kiểm tra lại xem có trích nhầm nguồn không.",
    conditions: [
      { field: "content_aligned", operator: "=", value: "false" },
    ],
    conclusion: "SUSPECTED_HALLUCINATION",
  },
  "R-STYLE-INCONSISTENT": {
    id: "R-STYLE-INCONSISTENT",
    name: "Mixed Citation Formatting Style",
    nameVi: "Chưa thống nhất kiểu định dạng trích dẫn",
    description: "This citation uses a different formatting style from the rest of your document.",
    descriptionVi: "Cách trình bày trích dẫn này khác với chuẩn chung của toàn bài viết.",
    conditions: [
      { field: "style_consistent", operator: "=", value: "false" },
    ],
    conclusion: "Confidence penalty applied",
  },
  "R-AMBIGUOUS-MAPPING": {
    id: "R-AMBIGUOUS-MAPPING",
    name: "Matches Multiple Reference Entries",
    nameVi: "Trích dẫn có thể trùng nhiều mục tham khảo",
    description: "This in-text citation could match more than one entry in your reference list.",
    descriptionVi: "Không thể xác định chắc chắn trích dẫn trong bài đang nối tới mục nào trong danh mục tài liệu tham khảo.",
    conditions: [
      { field: "mapping_status", operator: "=", value: "ambiguous_mapping" },
    ],
    conclusion: "UNRESOLVED",
  },
  "R-ABSTENTION-BORDER": {
    id: "R-ABSTENTION-BORDER",
    name: "Uncertain Match — Manual Check Needed",
    nameVi: "Độ khớp trung bình — cần bạn tự kiểm tra",
    description: "Found a somewhat similar publication, but not close enough to confirm automatically.",
    descriptionVi: "Tìm thấy một tài liệu có nét tương đồng nhưng chưa đủ chắc chắn để tự động xác nhận.",
    conditions: [
      { field: "match_confidence", operator: "=", value: "borderline" },
    ],
    conclusion: "UNRESOLVED",
  },
  "R-DOMAIN-EXCEPTION": {
    id: "R-DOMAIN-EXCEPTION",
    name: "DOI Matched, Title or Link Needs Review",
    nameVi: "Mã DOI khớp nhưng tiêu đề hoặc liên kết cần xem lại",
    description: "The DOI resolves to a real publication, though the title differs or the attached web link could not be opened.",
    descriptionVi: "Mã DOI khớp với bài báo có thật, nhưng tiêu đề có sai lệch hoặc đường dẫn đính kèm gặp lỗi.",
    conditions: [
      { field: "doi_exact_match", operator: "=", value: "true" },
    ],
    conclusion: "METADATA_ERROR (flagged)",
  },
  "R-FAIL-ALL": {
    id: "R-FAIL-ALL",
    name: "Online Libraries Temporarily Unavailable",
    nameVi: "Các thư viện trực tuyến tạm thời không phản hồi",
    description: "External academic libraries could not be reached during this check — please verify manually or retry shortly.",
    descriptionVi: "Các thư viện học thuật trực tuyến gặp lỗi kết nối trong lúc kiểm tra — vui lòng đối chiếu thủ công hoặc thử lại sau.",
    conditions: [
      { field: "sources_succeeded", operator: "=", value: "0" },
    ],
    conclusion: "UNRESOLVED",
  },
  "R-RATE-LIMITED-ABSTAIN": {
    id: "R-RATE-LIMITED-ABSTAIN",
    name: "Online Libraries Temporarily Busy",
    nameVi: "Thư viện trực tuyến tạm bận — chuyển sang rà soát thủ công",
    description: "Academic libraries briefly limited lookup traffic, so CITRA marked this entry for manual review instead of flagging an issue.",
    descriptionVi: "Các thư viện học thuật trực tuyến tạm thời giới hạn lượt tra cứu, nên hệ thống chuyển mục này sang rà soát thủ công thay vì báo lỗi.",
    conditions: [
      { field: "libraries_busy", operator: "=", value: "true" },
    ],
    conclusion: "UNRESOLVED",
  },
  "R-NO-CANDIDATE": {
    id: "R-NO-CANDIDATE",
    name: "No Matching Record Found",
    nameVi: "Không tìm thấy tài liệu tương ứng",
    description: "No matching publication was found across the checked academic libraries and technical repositories.",
    descriptionVi: "Không tìm thấy công trình nào khớp trên các thư viện học thuật và kho tài liệu đã tra cứu.",
    conditions: [
      { field: "candidates", operator: "=", value: "0" },
    ],
    conclusion: "UNRESOLVED",
  },
  "R-RETRACTED-PAPER": {
    id: "R-RETRACTED-PAPER",
    name: "Retracted Publication Notice",
    nameVi: "Cảnh báo: Bài báo đã bị rút bài",
    description: "This publication has been officially retracted in scholarly registries (Retraction Watch / OpenAlex / Crossref). Consider replacing it.",
    descriptionVi: "Ấn phẩm này đã chính thức bị rút bài theo ghi nhận từ nhà xuất bản và thư viện học thuật (Retraction Watch / OpenAlex / Crossref).",
    conditions: [
      { field: "is_retracted", operator: "=", value: "true" },
    ],
    conclusion: "METADATA_ERROR (RETRACTED)",
  },
  "R-WAYBACK-ARCHIVED": {
    id: "R-WAYBACK-ARCHIVED",
    name: "Web Archive Copy Found",
    nameVi: "Tìm thấy bản lưu trữ web dự phòng",
    description: "The original web page is no longer reachable, but a saved historical copy was verified on Internet Archive.",
    descriptionVi: "Trang web gốc hiện không còn mở được, nhưng đã tìm thấy bản lưu trữ hợp lệ trên Internet Archive.",
    conditions: [
      { field: "archive_snapshot", operator: "=", value: "available" },
    ],
    conclusion: "VERIFIED (Archived Resource)",
  },
  "R-GLOBAL-DOI-RA-VERIFIED": {
    id: "R-GLOBAL-DOI-RA-VERIFIED",
    name: "Verified via Global DOI Registry",
    nameVi: "Xác nhận qua Hệ thống đăng ký DOI quốc tế",
    description: "Verified through the Global DOI Registry (DataCite, JaLC, mEDRA, KISTI, CNKI) with matching publication details.",
    descriptionVi: "Đã xác nhận mã DOI và thông tin công trình qua Hệ thống đăng ký DOI quốc tế.",
    conditions: [
      { field: "doi_registered", operator: "=", value: "true" },
    ],
    conclusion: "VERIFIED",
  },
  "R-HF-VERIFIED": {
    id: "R-HF-VERIFIED",
    name: "Verified on Hugging Face",
    nameVi: "Xác nhận tài nguyên trên Hugging Face",
    description: "Verified AI model, dataset, or research paper record on Hugging Face.",
    descriptionVi: "Đã xác nhận mô hình, bộ dữ liệu hoặc bài nghiên cứu tương ứng trên Hugging Face.",
    conditions: [
      { field: "source", operator: "=", value: "huggingface" },
    ],
    conclusion: "VERIFIED",
  },
  "R-RFC-VERIFIED": {
    id: "R-RFC-VERIFIED",
    name: "Verified Technical Standard or Repository",
    nameVi: "Xác nhận tiêu chuẩn kỹ thuật hoặc mã nguồn",
    description: "Verified technical standard (IETF RFC), software package (PyPI / NPM), or public GitHub repository.",
    descriptionVi: "Đã xác nhận tiêu chuẩn kỹ thuật (IETF RFC), thư viện phần mềm (PyPI / NPM) hoặc kho mã nguồn GitHub.",
    conditions: [
      { field: "source", operator: "=", value: "tech_standard" },
    ],
    conclusion: "VERIFIED",
  },
  "R-GITHUB-VERIFIED": {
    id: "R-GITHUB-VERIFIED",
    name: "Verified GitHub Repository",
    nameVi: "Xác nhận kho mã nguồn GitHub",
    description: "Verified public GitHub repository and citation metadata.",
    descriptionVi: "Đã xác nhận kho mã nguồn GitHub công khai và thông tin trích dẫn tương ứng.",
    conditions: [
      { field: "source", operator: "=", value: "github" },
    ],
    conclusion: "VERIFIED",
  },
  "R-PACKAGE-VERIFIED": {
    id: "R-PACKAGE-VERIFIED",
    name: "Verified Software Package (PyPI / NPM)",
    nameVi: "Xác nhận gói phần mềm (PyPI / NPM)",
    description: "Verified software package release details and authors on PyPI or NPM.",
    descriptionVi: "Đã xác nhận thông tin phát hành gói phần mềm và tác giả trên PyPI hoặc NPM.",
    conditions: [
      { field: "source", operator: "=", value: "package_registry" },
    ],
    conclusion: "VERIFIED",
  },
  "R-SOFTWARE-PACKAGE-VERIFIED": {
    id: "R-SOFTWARE-PACKAGE-VERIFIED",
    name: "Verified Software Package Release",
    nameVi: "Xác nhận phiên bản gói phần mềm",
    description: "Verified open-source software package details and release version on PyPI or NPM.",
    descriptionVi: "Đã xác nhận thông tin và phiên bản gói phần mềm mã nguồn mở trên PyPI hoặc NPM.",
    conditions: [
      { field: "source", operator: "=", value: "package_registry" },
    ],
    conclusion: "VERIFIED",
  },
  "R-WIKIDATA-VERIFIED": {
    id: "R-WIKIDATA-VERIFIED",
    name: "Verified via Wikidata / OpenCitations",
    nameVi: "Xác nhận qua Wikidata / OpenCitations",
    description: "Verified international standard (ISO/IEC, NIST, IEEE, OWASP, WCAG), reference manual, or DOI via Wikidata and OpenCitations.",
    descriptionVi: "Đã xác nhận tiêu chuẩn quốc tế (ISO/IEC, NIST, IEEE, OWASP, WCAG), tài liệu hướng dẫn hoặc mã DOI qua Wikidata và OpenCitations.",
    conditions: [
      { field: "source", operator: "=", value: "wikidata_opencitations" },
    ],
    conclusion: "VERIFIED",
  },
  "R-WIKIDATA-STANDARD-VERIFIED": {
    id: "R-WIKIDATA-STANDARD-VERIFIED",
    name: "Verified Technical Standard on Wikidata",
    nameVi: "Xác nhận tiêu chuẩn kỹ thuật trên Wikidata",
    description: "Verified technical standard or official specification entry on Wikidata.",
    descriptionVi: "Đã xác nhận tiêu chuẩn kỹ thuật hoặc đặc tả chính thức trên Wikidata.",
    conditions: [
      { field: "source", operator: "=", value: "wikidata" },
    ],
    conclusion: "VERIFIED",
  },
  "R-OPENCITATIONS-VERIFIED": {
    id: "R-OPENCITATIONS-VERIFIED",
    name: "Citation Link Verified via OpenCitations",
    nameVi: "Xác nhận liên kết trích dẫn trên OpenCitations",
    description: "Verified DOI publication and bibliographic links through OpenCitations.",
    descriptionVi: "Đã xác nhận thông tin xuất bản và liên kết thư mục của mã DOI qua OpenCitations.",
    conditions: [
      { field: "source", operator: "=", value: "opencitations" },
    ],
    conclusion: "VERIFIED",
  },
  "R-WEAK-EVIDENCE": {
    id: "R-WEAK-EVIDENCE",
    name: "Partial Match Only — Manual Check Suggested",
    nameVi: "Thông tin đối chiếu chưa đủ khớp",
    description: "Some similar titles were found, but the details are too different to confirm automatically.",
    descriptionVi: "Tìm thấy vài tài liệu gần giống nhưng độ khớp còn thấp nên chưa thể tự động xác nhận.",
    conditions: [
      { field: "match_strength", operator: "=", value: "low" },
    ],
    conclusion: "UNRESOLVED",
  },
  "R-LOCAL_DB_VERIFIED": {
    id: "R-LOCAL_DB_VERIFIED",
    name: "Verified in CITRA Scholarly Library",
    nameVi: "Khớp chính xác trong Thư viện học thuật CITRA",
    description: "Title, authors, and publication year match a verified record in the CITRA Scholarly Library.",
    descriptionVi: "Tiêu đề, tác giả và năm xuất bản khớp chính xác với bản ghi trong Thư viện học thuật CITRA.",
    conditions: [
      { field: "source", operator: "=", value: "CITRA Scholarly Library" },
    ],
    conclusion: "VERIFIED",
  },
  "R-LOCAL_DB_GOOD_MATCH": {
    id: "R-LOCAL_DB_GOOD_MATCH",
    name: "Strong Match in CITRA Scholarly Library",
    nameVi: "Khớp độ chính xác cao trong Thư viện học thuật CITRA",
    description: "High title and author agreement confirmed in the CITRA Scholarly Library.",
    descriptionVi: "Xác nhận tiêu đề và tác giả khớp ở mức cao trong Thư viện học thuật CITRA.",
    conditions: [
      { field: "source", operator: "=", value: "CITRA Scholarly Library" },
    ],
    conclusion: "VERIFIED",
  },
  "R-LOCAL_DB_METADATA_ERROR": {
    id: "R-LOCAL_DB_METADATA_ERROR",
    name: "Matched Source with Details Mismatch",
    nameVi: "Tìm thấy bài gốc nhưng thông tin chưa khớp",
    description: "Found this publication in the CITRA Scholarly Library, but the cited year or author list differs from the published record.",
    descriptionVi: "Đã tìm thấy bài báo trong Thư viện học thuật CITRA, nhưng năm xuất bản hoặc danh sách tác giả trong bài khác với bản gốc.",
    conditions: [
      { field: "source", operator: "=", value: "CITRA Scholarly Library" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-LOCAL_DB": {
    id: "R-LOCAL_DB",
    name: "Matched in CITRA Scholarly Library",
    nameVi: "Tìm thấy trong Thư viện học thuật CITRA",
    description: "Publication record retrieved from the CITRA Scholarly Library.",
    descriptionVi: "Đã tìm thấy bản ghi công trình trong Thư viện học thuật CITRA.",
    conditions: [
      { field: "source", operator: "=", value: "CITRA Scholarly Library" },
    ],
    conclusion: "VERIFIED",
  },
  "R-LOCAL_DB_ONLY": {
    id: "R-LOCAL_DB_ONLY",
    name: "Verified via CITRA Scholarly Library",
    nameVi: "Xác nhận qua Thư viện học thuật CITRA",
    description: "Verified in the CITRA Scholarly Library while external online libraries were temporarily unavailable.",
    descriptionVi: "Đã xác nhận trực tiếp trên Thư viện học thuật CITRA khi các thư viện trực tuyến bên ngoài tạm bận.",
    conditions: [
      { field: "source", operator: "=", value: "CITRA Scholarly Library" },
    ],
    conclusion: "VERIFIED",
  },
  "R-API_EXHAUSTED": {
    id: "R-API_EXHAUSTED",
    name: "Online Library Lookup Limit Reached",
    nameVi: "Thư viện trực tuyến tạm đạt giới hạn tra cứu",
    description: "One or more online academic libraries temporarily limited lookups; match confidence was adjusted accordingly.",
    descriptionVi: "Một số thư viện học thuật trực tuyến tạm đạt giới hạn truy vấn nên mức độ khớp đã được điều chỉnh phù hợp.",
    conditions: [
      { field: "libraries_limited", operator: "=", value: "true" },
    ],
    conclusion: "Confidence penalty applied",
  },
  "R-KNOWN-PAPER": {
    id: "R-KNOWN-PAPER",
    name: "Widely Cited Published Work Verified",
    nameVi: "Khớp công trình học thuật chuẩn",
    description: "Matches a widely cited published work in the CITRA Scholarly Library.",
    descriptionVi: "Khớp với công trình nghiên cứu đã được lưu chuẩn trong Thư viện học thuật CITRA.",
    conditions: [
      { field: "source", operator: "=", value: "CITRA Scholarly Library" },
    ],
    conclusion: "VERIFIED",
  },
  "R-KNOWN-PAPER-NO-TITLE": {
    id: "R-KNOWN-PAPER-NO-TITLE",
    name: "Matched Published Work by Author & Year",
    nameVi: "Khớp công trình học thuật theo tác giả và năm",
    description: "In-text citation matches a published work in the CITRA Scholarly Library by author and year.",
    descriptionVi: "Trích dẫn trong bài khớp với công trình trong Thư viện học thuật CITRA theo tên tác giả và năm xuất bản.",
    conditions: [
      { field: "author_year_match", operator: "=", value: "true" },
    ],
    conclusion: "VERIFIED",
  },
  "R-SINGLE-SOURCE-VERIFIED": {
    id: "R-SINGLE-SOURCE-VERIFIED",
    name: "High-Confidence Library Match",
    nameVi: "Khớp độ chính xác cao từ thư viện học thuật",
    description: "Verified in an online academic library with strong agreement on title, authors, and publication year.",
    descriptionVi: "Đã xác nhận trên thư viện học thuật trực tuyến với tiêu đề, tác giả và năm xuất bản khớp ở mức cao.",
    conditions: [
      { field: "library_match", operator: "=", value: "high" },
    ],
    conclusion: "VERIFIED",
  },
  "R-SINGLE-SOURCE-PARTIAL": {
    id: "R-SINGLE-SOURCE-PARTIAL",
    name: "Library Match with Details Discrepancy",
    nameVi: "Tìm thấy trong thư viện nhưng thông tin chưa khớp",
    description: "Found the published record in an academic library, but the author, year, or title differs slightly.",
    descriptionVi: "Tìm thấy hồ sơ công trình trên thư viện học thuật nhưng năm xuất bản, tác giả hoặc tiêu đề chưa khớp hoàn toàn.",
    conditions: [
      { field: "library_match", operator: "=", value: "partial" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-BROKEN-LINK": {
    id: "R-BROKEN-LINK",
    name: "Attached Link Unreachable on Verified Paper",
    nameVi: "Đường dẫn đính kèm không mở được (bài báo có thật)",
    description: "The publication itself exists, but the web link included in your citation currently cannot be opened.",
    descriptionVi: "Công trình học thuật có thật nhưng đường dẫn đính kèm trong trích dẫn hiện không thể truy cập.",
    conditions: [
      { field: "url_reachable", operator: "=", value: "false" },
    ],
    conclusion: "METADATA_ERROR (flagged)",
  },
  "R-DEAD-URL": {
    id: "R-DEAD-URL",
    name: "Link Unreachable & No Matching Publication",
    nameVi: "Đường dẫn không mở được và chưa tìm thấy bài gốc",
    description: "The cited web link could not be opened and no matching publication was found across academic libraries.",
    descriptionVi: "Đường dẫn trích dẫn hiện không mở được và chưa tìm thấy công trình học thuật nào khớp.",
    conditions: [
      { field: "url_reachable", operator: "=", value: "false" },
    ],
    conclusion: "SUSPECTED_HALLUCINATION",
  },
  "R-NONEXISTENT-DOI": {
    id: "R-NONEXISTENT-DOI",
    name: "DOI Not Found in Official Registries",
    nameVi: "Mã DOI không tìm thấy trên hệ thống đăng ký",
    description: "The cited DOI could not be resolved to any published record across academic registries.",
    descriptionVi: "Mã DOI bạn ghi không tìm thấy bản ghi công trình nào trên các hệ thống đăng ký học thuật.",
    conditions: [
      { field: "doi_found", operator: "=", value: "false" },
    ],
    conclusion: "SUSPECTED_HALLUCINATION",
  },
  "R-NO-SCHOLARLY-RECORD": {
    id: "R-NO-SCHOLARLY-RECORD",
    name: "No Record Found Across Academic Libraries",
    nameVi: "Không tìm thấy bản ghi trên các thư viện học thuật",
    description: "Multiple online academic libraries were searched cleanly and returned no matching publication.",
    descriptionVi: "Đã tra cứu trên nhiều thư viện học thuật trực tuyến nhưng không tìm thấy bản ghi nào khớp.",
    conditions: [
      { field: "candidates", operator: "=", value: "0" },
    ],
    conclusion: "SUSPECTED_HALLUCINATION",
  },
  "R-HALLUCINATED-SOURCE": {
    id: "R-HALLUCINATED-SOURCE",
    name: "No Matching Publication Found",
    nameVi: "Không tìm thấy tài liệu khớp trong thư viện học thuật",
    description: "No candidate found across checked academic libraries closely matched the cited title, authors, or DOI.",
    descriptionVi: "Chưa tìm thấy tài liệu nào trên các thư viện học thuật khớp với tiêu đề, tác giả hoặc mã DOI trong bài.",
    conditions: [
      { field: "match_found", operator: "=", value: "false" },
    ],
    conclusion: "SUSPECTED_HALLUCINATION",
  },
  "R-NON-SCHOLARLY-RESOURCE": {
    id: "R-NON-SCHOLARLY-RESOURCE",
    name: "Web Page or Online Documentation",
    nameVi: "Trang web hoặc tài liệu trực tuyến",
    description: "Points to a general web page, blog, or technical guide rather than a peer-reviewed journal article.",
    descriptionVi: "Tài liệu tham khảo trỏ tới trang web thông thường hoặc tài liệu hướng dẫn kỹ thuật thay vì bài báo học thuật.",
    conditions: [
      { field: "resource_type", operator: "=", value: "web" },
    ],
    conclusion: "UNRESOLVED",
  },
  "R-UNINDEXED-BOOK-OR-SOURCE": {
    id: "R-UNINDEXED-BOOK-OR-SOURCE",
    name: "Print Book, Textbook, or Local Thesis",
    nameVi: "Sách in, giáo trình hoặc luận văn chưa có bản trực tuyến",
    description: "Appears to be a print textbook, thesis, or regional monograph that is not indexed in online academic libraries.",
    descriptionVi: "Trích dẫn có dạng sách in, giáo trình nội bộ hoặc luận văn chưa được lập chỉ mục trên các thư viện trực tuyến.",
    conditions: [
      { field: "print_source_pattern", operator: "=", value: "true" },
    ],
    conclusion: "UNRESOLVED",
  },
  "R-URL-RESOURCE": {
    id: "R-URL-RESOURCE",
    name: "Direct Web Link Reference",
    nameVi: "Trích dẫn đường dẫn web trực tiếp",
    description: "Recognized as a direct web page or software repository link.",
    descriptionVi: "Nhận diện là đường dẫn trang web hoặc kho mã nguồn trực tiếp.",
    conditions: [
      { field: "citation_type", operator: "=", value: "url" },
    ],
    conclusion: "VERIFIED (Resource)",
  },
  "R-WEB-RESOURCE": {
    id: "R-WEB-RESOURCE",
    name: "Web or Technical Documentation",
    nameVi: "Tài nguyên web hoặc tài liệu kỹ thuật",
    description: "Recognized as an online guide, official web page, or technical specification.",
    descriptionVi: "Nhận diện là trang hướng dẫn trực tuyến, tài liệu kỹ thuật hoặc trang web tham khảo.",
    conditions: [
      { field: "resource_type", operator: "=", value: "web_documentation" },
    ],
    conclusion: "VERIFIED (Resource)",
  },
  "R-VN-LEGAL-FORMAT": {
    id: "R-VN-LEGAL-FORMAT",
    name: "Legal / Statutory Document Format",
    nameVi: "Định dạng văn bản quy phạm pháp luật",
    description: "Matches official statutory or government legal document citation format.",
    descriptionVi: "Khớp định dạng trích dẫn văn bản quy phạm pháp luật chính thức.",
    conditions: [
      { field: "is_legal_reference", operator: "=", value: "true" },
    ],
    conclusion: "VERIFIED",
  },
  "R-LEGAL-DOCUMENT": {
    id: "R-LEGAL-DOCUMENT",
    name: "Vietnamese Statutory Legal Document",
    nameVi: "Văn bản quy phạm pháp luật Việt Nam",
    description: "Recognized Vietnamese statutory instrument (Law, Code, Decree, Circular, Resolution, or Decision).",
    descriptionVi: "Nhận diện văn bản quy phạm pháp luật Việt Nam (Luật, Bộ luật, Nghị định, Thông tư, Nghị quyết, Quyết định).",
    conditions: [
      { field: "doc_category", operator: "=", value: "vn_legal_statute" },
    ],
    conclusion: "VERIFIED",
  },
  "R-VN-LEGAL-VERIFIED": {
    id: "R-VN-LEGAL-VERIFIED",
    name: "Verified in Vietnamese Legal Registry",
    nameVi: "Xác nhận trên Thư viện văn bản pháp luật Việt Nam",
    description: "Verified document number, promulgation year, and issuing authority against the Vietnamese Legal Registry.",
    descriptionVi: "Đã xác nhận số hiệu, năm ban hành và cơ quan ban hành đối chiếu với Thư viện văn bản pháp luật Việt Nam.",
    conditions: [
      { field: "statute_match", operator: "=", value: "true" },
    ],
    conclusion: "VERIFIED",
  },
  "R-VN-LEGAL-MISMATCH": {
    id: "R-VN-LEGAL-MISMATCH",
    name: "Vietnamese Legal Document Details Mismatch",
    nameVi: "Sai lệch thông tin văn bản pháp luật Việt Nam",
    description: "Found the matching Vietnamese legal document, but the promulgation year, number, or issuing agency differs.",
    descriptionVi: "Tìm thấy văn bản pháp luật tương ứng nhưng năm ban hành, số hiệu hoặc cơ quan ban hành chưa khớp.",
    conditions: [
      { field: "statute_mismatch", operator: "=", value: "true" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-VN-LEGAL-SUPERSEDED": {
    id: "R-VN-LEGAL-SUPERSEDED",
    name: "Superseded Vietnamese Legal Document",
    nameVi: "Văn bản pháp luật đã hết hiệu lực hoặc bị thay thế",
    description: "The cited Vietnamese law or decree has been superseded or replaced by a newer legal document.",
    descriptionVi: "Luật hoặc Nghị định được trích dẫn đã hết hiệu lực hoặc được thay thế bởi văn bản pháp luật mới hơn.",
    conditions: [
      { field: "legal_status", operator: "=", value: "superseded" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-VN-LEGAL-FABRICATED": {
    id: "R-VN-LEGAL-FABRICATED",
    name: "Legal Document Number Not Found",
    nameVi: "Không tìm thấy số hiệu văn bản pháp luật này",
    description: "The cited legal document number, promulgation year, or issuing authority could not be confirmed in the official legal registry.",
    descriptionVi: "Số hiệu, năm ban hành hoặc cơ quan ban hành văn bản pháp luật này chưa được tìm thấy trên hệ thống văn bản pháp luật chính thức.",
    conditions: [
      { field: "statute_found", operator: "=", value: "false" },
    ],
    conclusion: "SUSPECTED_HALLUCINATION",
  },
  "R-LEGAL-STATUTE-VERIFIED": {
    id: "R-LEGAL-STATUTE-VERIFIED",
    name: "Official Legal Document Verified",
    nameVi: "Xác nhận văn bản quy phạm pháp luật chính thức",
    description: "Verified legal document details against the official legal registry.",
    descriptionVi: "Đã xác nhận thông tin văn bản quy phạm pháp luật đối chiếu với thư viện pháp luật chính thức.",
    conditions: [
      { field: "statute_match", operator: "=", value: "true" },
    ],
    conclusion: "VERIFIED",
  },
  "R-LEGAL-STATUTE-ERROR": {
    id: "R-LEGAL-STATUTE-ERROR",
    name: "Legal Document Details or Validity Issue",
    nameVi: "Sai lệch thông tin hoặc hiệu lực văn bản pháp luật",
    description: "This legal citation has a number/year discrepancy or references a superseded regulation.",
    descriptionVi: "Trích dẫn văn bản pháp luật bị lệch số hiệu/năm ban hành hoặc đang dẫn chiếu quy định đã hết hiệu lực.",
    conditions: [
      { field: "statute_error", operator: "=", value: "true" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-BOOK-EDITION-VERIFIED": {
    id: "R-BOOK-EDITION-VERIFIED",
    name: "Book or Textbook Edition Verified",
    nameVi: "Xác nhận ấn bản sách hoặc giáo trình",
    description: "Verified book or textbook edition against OpenLibrary and Google Books.",
    descriptionVi: "Đã xác nhận ấn bản giáo trình hoặc sách chuyên khảo đối chiếu với OpenLibrary và Google Books.",
    conditions: [
      { field: "book_match", operator: "=", value: "true" },
    ],
    conclusion: "VERIFIED",
  },
  "R-DOI-RA-NO-CSL": {
    id: "R-DOI-RA-NO-CSL",
    name: "Regional DOI Registered Without Public Details",
    nameVi: "Mã DOI đã đăng ký khu vực nhưng chưa công khai chi tiết",
    description: "This DOI is registered at a regional agency (such as Airiti, JaLC, KISTI, or CNKI) that does not publish public citation details — please check manually.",
    descriptionVi: "Mã DOI đã được đăng ký tại cơ quan quản lý DOI khu vực nhưng chưa công khai thông tin thư mục — vui lòng đối chiếu thủ công.",
    conditions: [
      { field: "doi_public_details", operator: "=", value: "unavailable" },
    ],
    conclusion: "UNRESOLVED",
  },
  "R-INCOMPLETE-METADATA": {
    id: "R-INCOMPLETE-METADATA",
    name: "Incomplete Citation Details",
    nameVi: "Thiếu thông tin trích dẫn",
    description: "This reference entry is missing required details such as author, publication year, venue, or identifier — please complete it.",
    descriptionVi: "Mục tài liệu tham khảo còn thiếu thông tin quan trọng (tác giả, năm xuất bản, nơi công bố hoặc mã định danh) — hãy bổ sung cho đầy đủ.",
    conditions: [
      { field: "is_incomplete", operator: "=", value: "true" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-URL-CONTENT-MISMATCH": {
    id: "R-URL-CONTENT-MISMATCH",
    name: "Web Page Title Does Not Match Citation",
    nameVi: "Tiêu đề trang web không khớp với trích dẫn",
    description: "The web link opens, but the page title at that address does not match the title in your citation.",
    descriptionVi: "Đường dẫn vẫn mở được nhưng tiêu đề trang web đích không khớp với tiêu đề bạn ghi trong bài.",
    conditions: [
      { field: "page_title_match", operator: "=", value: "false" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-VN-STANDARD-VERIFIED": {
    id: "R-VN-STANDARD-VERIFIED",
    name: "Vietnamese National Standard Verified (TCVN / QCVN)",
    nameVi: "Xác nhận Tiêu chuẩn / Quy chuẩn Quốc gia (TCVN / QCVN)",
    description: "Verified Vietnamese national technical standard or regulation against the TCVN / QCVN catalog.",
    descriptionVi: "Đã xác nhận Tiêu chuẩn hoặc Quy chuẩn Kỹ thuật Quốc gia đối chiếu với danh mục TCVN / QCVN.",
    conditions: [
      { field: "standard_match", operator: "=", value: "true" },
    ],
    conclusion: "VERIFIED",
  },
  "R-VN-TEXTBOOK-VERIFIED": {
    id: "R-VN-TEXTBOOK-VERIFIED",
    name: "Vietnamese University Textbook Verified",
    nameVi: "Xác nhận Giáo trình Đại học Việt Nam",
    description: "Verified Vietnamese university textbook or monograph against the curated textbook catalog.",
    descriptionVi: "Đã xác nhận giáo trình đại học hoặc sách chuyên khảo tiếng Việt đối chiếu với danh mục chuẩn.",
    conditions: [
      { field: "textbook_match", operator: "=", value: "true" },
    ],
    conclusion: "VERIFIED",
  },
  "R-YEAR-MISMATCH": {
    id: "R-YEAR-MISMATCH",
    name: "Publication Year Mismatch",
    nameVi: "Sai lệch năm xuất bản",
    description: "Found the matching publication, but the cited year differs from the published record.",
    descriptionVi: "Đã tìm thấy tài liệu gốc nhưng năm xuất bản bạn ghi trong bài chưa khớp.",
    conditions: [
      { field: "year_match", operator: "=", value: "false" },
    ],
    conclusion: "METADATA_ERROR",
  },
  "R-DOI-METADATA-MISMATCH": {
    id: "R-DOI-METADATA-MISMATCH",
    name: "Cited DOI Differs from Published Record",
    nameVi: "Mã DOI trích dẫn khác với bản gốc",
    description: "The publication title and authors match, but the cited DOI differs from the official DOI of this work.",
    descriptionVi: "Tiêu đề và tác giả khớp với bài báo có thật nhưng mã DOI trong bài khác với mã DOI chính thức.",
    conditions: [
      { field: "doi_match", operator: "=", value: "false" },
    ],
    conclusion: "METADATA_ERROR",
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

function formatRuleConclusion(conclusion: string, lang: "vi" | "en"): string {
  const upper = conclusion.toUpperCase()
  if (upper.includes("HALLUCINATION")) {
    return getVerdictDisplay("suspected_hallucination", lang).label
  }
  if (upper.includes("RETRACTED")) {
    return lang === "vi" ? "Bài báo đã bị rút" : "Retracted Publication"
  }
  if (upper.includes("METADATA_ERROR")) {
    return getVerdictDisplay("metadata_error", lang).label
  }
  if (upper.includes("RESOURCE") || upper.includes("ARCHIVED")) {
    return getVerdictDisplay("resource", lang).label
  }
  if (upper.includes("VERIFIED")) {
    return getVerdictDisplay("verified", lang).label
  }
  if (upper.includes("UNRESOLVED")) {
    return getVerdictDisplay("unresolved", lang).label
  }
  if (upper.includes("CONFIDENCE PENALTY")) {
    return lang === "vi" ? "Điều chỉnh mức độ khớp" : "Match confidence adjusted"
  }
  return conclusion
}

export function RuleInspector({
  triggeredRules,
  verdictLabel,
  features,
  className,
}: RuleInspectorProps) {
  const { i18n } = useTranslation()
  const isVi = Boolean(i18n.language?.startsWith("vi"))
  const lang: "vi" | "en" = isVi ? "vi" : "en"

  const summaryChips: string[] = []
  if (features) {
    const titleScore = Math.max(
      features.title_sim_fuzzy ?? 0,
      features.title_sim_semantic ?? 0,
      features.cross_lingual_title_sim ?? 0,
    )
    if (
      features.title_sim_fuzzy !== undefined ||
      (features.title_sim_semantic !== undefined && features.title_sim_semantic > 0) ||
      (features.cross_lingual_title_sim !== undefined && features.cross_lingual_title_sim > 0)
    ) {
      const pct = Math.round(titleScore * 100)
      summaryChips.push(isVi ? `Khớp tiêu đề: ${pct}%` : `Title match: ${pct}%`)
    }
    if (features.author_jaccard !== undefined) {
      const pct = Math.round(features.author_jaccard * 100)
      summaryChips.push(isVi ? `Khớp tác giả: ${pct}%` : `Author match: ${pct}%`)
    }
    if (
      features.year_distance !== undefined &&
      features.year_distance < 900 &&
      features.has_scholarly_candidate !== false
    ) {
      const dist = Math.round(features.year_distance)
      summaryChips.push(
        dist === 0
          ? isVi
            ? "Năm xuất bản: khớp"
            : "Year: exact match"
          : isVi
            ? `Năm xuất bản: lệch ${dist} năm`
            : `Year: ${dist} ${dist === 1 ? "yr" : "yrs"} off`,
      )
    }
    if (features.html_meta_title_sim !== undefined && features.html_meta_title_sim !== null) {
      const pct = Math.round(features.html_meta_title_sim * 100)
      summaryChips.push(isVi ? `Khớp tiêu đề trang web: ${pct}%` : `Web page title match: ${pct}%`)
    }
    if (features.cross_lingual_detected || features.cross_lingual_title_detected) {
      summaryChips.push(isVi ? "Khớp nội dung Việt–Anh" : "Cross-language match")
    }
    if (features.doi_exact_match !== undefined) {
      summaryChips.push(
        features.doi_exact_match
          ? isVi
            ? "Mã DOI: khớp"
            : "DOI: matched"
          : isVi
            ? "Mã DOI: chưa khớp"
            : "DOI: not matched",
      )
    }
  }

  const rules: Rule[] = triggeredRules.map((ruleId) => {
    const definition = RULE_DEFINITIONS[ruleId]
    if (definition) {
      return { ...definition, triggered: true }
    }
    return {
      id: ruleId,
      name: "Additional Verification Check",
      nameVi: "Tiêu chí kiểm tra bổ sung",
      description: "An additional bibliographic verification check was applied to this citation.",
      descriptionVi: "Hệ thống đã áp dụng thêm một tiêu chí đối chiếu cho trích dẫn này.",
      conditions: [],
      conclusion: verdictLabel || "UNKNOWN",
      triggered: true,
    }
  })

  if (rules.length === 0) {
    return (
      <Card className={cn("bg-slate-50 dark:bg-slate-800/50 p-4", className)}>
        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
          <ListChecks className="h-4 w-4" />
          <span className="text-sm">
            {isVi ? "Chưa có tiêu chí kiểm tra nào" : "No verification checks recorded"}
          </span>
        </div>
      </Card>
    )
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-2">
        <ListChecks className="h-4 w-4 text-slate-500 dark:text-slate-400" />
        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
          {isVi ? `Tiêu chí kiểm tra (${rules.length})` : `Verification Checks (${rules.length})`}
        </h4>
      </div>

      {summaryChips.length > 0 && (
        <div
          data-testid="rule-inspector-live-features"
          className="flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200/70 dark:border-slate-800 px-2.5 py-2"
        >
          {summaryChips.map((chip) => (
            <span
              key={chip}
              className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-700 dark:text-slate-300"
            >
              {chip}
            </span>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {rules.map((rule) => {
          const normalizedLabel = verdictLabel
            ? normalizeVerdictKey(verdictLabel)
            : null
          const isOverallUnconfirmed =
            normalizedLabel === "suspected_hallucination" ||
            normalizedLabel === "unresolved"
          const isContradictoryPositive =
            isOverallUnconfirmed && rule.conclusion.toUpperCase().includes("VERIFIED")
          const colors = isContradictoryPositive
            ? {
                bg: "bg-amber-50 dark:bg-amber-950/60",
                border: "border-amber-200 dark:border-amber-800",
                text: "text-amber-700 dark:text-amber-300",
                icon: <AlertTriangle className="h-3.5 w-3.5" />,
              }
            : getVerdictColorClass(rule.conclusion)
          const displayName = isVi ? rule.nameVi : rule.name
          const displayDesc = isVi ? rule.descriptionVi : rule.description
          const displayConclusion = isContradictoryPositive
            ? lang === "vi"
              ? "Ứng viên tham khảo (chưa đủ khớp)"
              : "Candidate (insufficient match)"
            : formatRuleConclusion(rule.conclusion, lang)

          return (
            <Card
              key={rule.id}
              className={cn(
                "p-3",
                colors.bg,
                colors.border,
              )}
            >
              <div className="flex items-start justify-between gap-2 mb-1.5 flex-wrap">
                <p className={cn("text-sm font-semibold min-w-0 flex-1", colors.text)}>
                  {displayName}
                </p>
                <Badge
                  variant="outline"
                  className={cn(
                    "flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded shrink-0",
                    colors.bg,
                    colors.border,
                    colors.text,
                  )}
                >
                  {colors.icon}
                  <span className="text-[11px]">{displayConclusion}</span>
                </Badge>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {displayDesc}
              </p>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

export function RuleInspectorCompact({
  triggeredRules,
  className,
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
        const displayName = definition
          ? isVi
            ? definition.nameVi
            : definition.name
          : isVi
            ? "Tiêu chí kiểm tra"
            : "Verification Check"
        const tooltip = definition
          ? isVi
            ? definition.descriptionVi
            : definition.description
          : displayName

        return (
          <Badge
            key={ruleId}
            variant="outline"
            className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border",
              colors.bg,
              colors.border,
              colors.text,
            )}
            title={tooltip}
          >
            {colors.icon}
            {displayName}
          </Badge>
        )
      })}
    </div>
  )
}
