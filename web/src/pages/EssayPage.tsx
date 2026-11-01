import { useState, useMemo, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  api,
  type Verdict,
  type Citation,
  type CitationLink,
  type ValidationLabel,
  type RevisionDiffData,
} from '@/api/client';
import { EssayHeader } from './essay/EssayHeader';
import { EssayActionBar } from './essay/EssayActionBar';
import { FileFormatIcon } from '@/components/FileFormatIcon';
import { OverrideControls } from '@/components/OverrideControls';
import { CitationGraphView, EvidenceGraph } from '@/components/CitationGraph';
import { UpgradeModal } from '@/components/UpgradeModal';
import { BibliographyRemediationModal } from '@/components/BibliographyRemediationModal';
import { useEssayReport, useOverrideVerdict } from '@/hooks/useEssayReport';
import { isUrlResource } from '@/lib/verdictExplanation';
import { useRole } from '@/hooks/useRole';
import {
  Loader2,
  AlertCircle,
  FileText,
  Scale,
  Check,
  AlertTriangle,
  XCircle,
  Shield,
  ArrowUpRight,
  Search,
  ExternalLink,
  GitBranch,
  Lock,
  Sparkles,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

/* ============================================================
   Helper Types & Functions for the Real Citation Debugger IDE
   ============================================================ */

type FieldStatus = 'match' | 'partial' | 'mismatch' | 'missing';

interface MetadataFields {
  title: string;
  authors: string;
  year: string;
  venue: string;
  doi: string;
  url: string;
}

interface SymbolicRuleDisplay {
  code: string;
  name: string;
  condition: string;
  status: 'passed' | 'warning' | 'failed';
}

interface SourceRetrievalItem {
  name: string;
  status: 'matched' | 'partial' | 'not_found';
  score: string;
  matchedFields: string[];
  url?: string;
  doi?: string;
}

interface LinkBadgeInfo {
  text: string;
  badgeClass: string;
  title: string;
  status: 'alive' | 'restricted_alive' | 'archived_alive' | 'dead_link' | 'fake_domain';
}

interface EnrichedCitationItem {
  verdict: Verdict;
  index: number;
  marker: string;
  inText: string;
  pageLabel: string;
  verdictText: string;
  verdictBadgeClass: string;
  mappingText: string;
  mappingBadgeClass: string;
  linkBadge: LinkBadgeInfo | null;
  confidencePct: number;
  citedMeta: MetadataFields;
  retrievedMeta: MetadataFields | null;
  fieldStatus: Record<keyof MetadataFields, { status: FieldStatus; label?: string }>;
  contextBefore: string;
  contextHighlight: string;
  contextAfter: string;
  explanationText: string;
  rules: SymbolicRuleDisplay[];
  sources: SourceRetrievalItem[];
}

const RULE_CATALOG: Record<
  string,
  {
    nameVi: string;
    nameEn: string;
    condition: string;
    status: 'passed' | 'warning' | 'failed';
  }
> = {
  'R-DOI-TITLE-AUTHOR': {
    nameVi: 'Xác thực tuyệt đối DOI + Tiêu đề + Tác giả',
    nameEn: 'Exact DOI + Title + Author Match',
    condition: 'IF doi_exact_match == 1.0 AND title_sim >= 0.90 AND author_jaccard >= 0.70 THEN VERIFIED',
    status: 'passed',
  },
  'R-WELL-LINKED': {
    nameVi: 'Khớp đa trường độ tin cậy cao',
    nameEn: 'High-Confidence Multi-Field Match',
    condition: 'IF title_sim_fuzzy >= 0.88 AND author_jaccard >= 0.75 AND year_distance == 0 THEN VERIFIED',
    status: 'passed',
  },
  'R-WELL-LINKED-MODERATE': {
    nameVi: 'Khớp tiêu đề & tác giả mức khá',
    nameEn: 'Moderate Title & Author Match',
    condition: 'IF title_sim_fuzzy >= 0.80 AND author_jaccard >= 0.60 AND year_distance <= 1 THEN VERIFIED',
    status: 'passed',
  },
  'R-LOCAL_DB_VERIFIED': {
    nameVi: 'Xác thực trực tiếp từ CSDL ACL / Known Papers nội bộ',
    nameEn: 'Verified in Local ACL / Known Papers Index',
    condition: 'IF local_fts5_hit == TRUE AND title_sim >= 0.90 AND year_distance == 0 THEN VERIFIED',
    status: 'passed',
  },
  'R-LOCAL_DB_GOOD_MATCH': {
    nameVi: 'Khớp tốt trong CSDL nội bộ',
    nameEn: 'Strong Local Index Candidate Match',
    condition: 'IF local_fts5_hit == TRUE AND title_sim >= 0.82 AND author_jaccard >= 0.65 THEN VERIFIED',
    status: 'passed',
  },
  'R-LOCAL_DB': {
    nameVi: 'Truy hồi từ chỉ mục SQLite FTS5 nội bộ',
    nameEn: 'Local SQLite FTS5 Index Hit',
    condition: 'IF source IN ("local_db", "known_papers") AND candidate_confidence >= 0.70 THEN PASS',
    status: 'passed',
  },
  'R-LOCAL_DB_ONLY': {
    nameVi: 'Đối chiếu độc lập trên CSDL nội bộ',
    nameEn: 'Standalone Local Database Verification',
    condition: 'IF external_apis == OFFLINE AND local_db_confidence >= 0.80 THEN VERIFIED',
    status: 'passed',
  },
  'R-KNOWN-PAPER': {
    nameEn: 'Canonical Benchmark Publication Match',
    nameVi: 'Công trình kinh điển trong tập chuẩn',
    condition: 'IF source == "known_papers" AND title_sim >= 0.92 THEN VERIFIED',
    status: 'passed',
  },
  'R-KNOWN-PAPER-NO-TITLE': {
    nameEn: 'Known Seminal Paper (In-Text Author-Year Match)',
    nameVi: 'Công trình kinh điển (Khớp Tác giả - Năm trong bài)',
    condition: 'IF source == "known_papers" AND author_year_match == TRUE THEN VERIFIED',
    status: 'passed',
  },
  'R-SINGLE-SOURCE-VERIFIED': {
    nameEn: 'Single Scholarly Registry High-Confidence Match',
    nameVi: 'Xác thực độ tin cậy cao từ CSDL học thuật đơn nguồn',
    condition: 'IF live_source_consensus >= 1 AND title_sim_fuzzy >= 0.90 AND author_jaccard >= 0.80 AND year_distance <= 1 THEN VERIFIED',
    status: 'passed',
  },
  'R-SINGLE-SOURCE-PARTIAL': {
    nameEn: 'Single Registry Match with Metadata Discrepancy',
    nameVi: 'Khớp CSDL học thuật nhưng sai lệch Metadata (Năm/Tác giả/Tiêu đề)',
    condition: 'IF live_source_consensus >= 1 AND title_sim >= 0.60 AND (author_jaccard < 0.50 OR year_distance > 1) THEN METADATA_ERROR',
    status: 'warning',
  },
  'R-VN-LEGAL-FORMAT': {
    nameEn: 'Legal / Statutory Document Format Verified',
    nameVi: 'Xác thực định dạng Văn bản Pháp luật / Quy phạm',
    condition: 'IF is_legal_statutory_reference == TRUE THEN VERIFIED',
    status: 'passed',
  },
  'R-LEGAL-DOCUMENT': {
    nameEn: 'Vietnamese Statutory / Regulatory Document Classification',
    nameVi: 'Phân loại Văn bản Quy phạm Pháp luật Việt Nam (TDTU §2.6.1)',
    condition: 'IF matched_pattern == "vn_legal_document" THEN ROUTE_VN_LEGAL_VERIFIER',
    status: 'passed',
  },
  'R-VN-LEGAL-VERIFIED': {
    nameEn: 'Vietnamese Statutory Code & Authority Verified',
    nameVi: 'Xác thực Số hiệu, Năm ban hành & Thẩm quyền Văn bản Pháp luật VN',
    condition: 'IF statute_code_match == TRUE AND issuing_authority_match == TRUE THEN VERIFIED',
    status: 'passed',
  },
  'R-VN-LEGAL-SUPERSEDED': {
    nameEn: 'Vietnamese Statute Verified (Superseded / Expired Notice)',
    nameVi: 'Cảnh báo hiệu lực: Văn bản Pháp luật đã hết hiệu lực / được thay thế',
    condition: 'IF statute_in_registry == TRUE AND is_superseded == TRUE THEN WARN_SUPERSEDED',
    status: 'warning',
  },
  'R-VN-LEGAL-MISMATCH': {
    nameEn: 'Vietnamese Statutory Number / Year / Authority Mismatch',
    nameVi: 'Sai lệch Số hiệu, Năm ban hành hoặc Cơ quan ban hành Văn bản Pháp luật VN',
    condition: 'IF statute_year_conflict == TRUE OR authority_conflict == TRUE THEN METADATA_ERROR',
    status: 'failed',
  },
  'R-BOOK-EDITION-VERIFIED': {
    nameEn: 'Canonical Book / Monograph Edition Verified',
    nameVi: 'Xác thực ấn bản Sách chuyên khảo / Giáo trình (Edition Match)',
    condition: 'IF openlibrary_edition_match == TRUE AND title_sim >= 0.90 AND author_jaccard >= 0.70 THEN VERIFIED',
    status: 'passed',
  },
  'R-GLOBAL-DOI-RA-VERIFIED': {
    nameEn: 'Global DOI Registration Agency Verified (JaLC/CNKI/mEDRA/KISTI)',
    nameVi: 'Xác thực Cơ quan Đăng ký DOI Quốc tế (JaLC/CNKI/mEDRA/KISTI)',
    condition: 'IF source == "doi_ra" AND doi_exact_match == TRUE AND title_sim >= 0.85 THEN VERIFIED',
    status: 'passed',
  },
  'R-HF-VERIFIED': {
    nameEn: 'Hugging Face Hub Model / Dataset / Paper Verified',
    nameVi: 'Xác thực Mô hình / Bộ dữ liệu / Bài báo trên Hugging Face Hub',
    condition: 'IF source == "huggingface" AND title_sim >= 0.85 THEN VERIFIED',
    status: 'passed',
  },
  'R-RFC-VERIFIED': {
    nameEn: 'IETF RFC Standard / PyPI / NPM / GitHub Verified',
    nameVi: 'Xác thực Chuẩn IETF RFC / Gói phần mềm PyPI / NPM / GitHub',
    condition: 'IF source == "tech_standard" AND title_sim >= 0.80 THEN VERIFIED',
    status: 'passed',
  },
  'R-GITHUB-VERIFIED': {
    nameEn: 'GitHub Public Repository & CITATION.cff Verified',
    nameVi: 'Xác thực Kho mã nguồn GitHub & Hồ sơ CITATION.cff',
    condition: 'IF source == "tech_standard" AND github_repo != NULL AND title_sim >= 0.80 THEN VERIFIED',
    status: 'passed',
  },
  'R-PACKAGE-VERIFIED': {
    nameEn: 'PyPI / NPM Software Package Registry Verified',
    nameVi: 'Xác thực Gói thư viện Mã nguồn mở trên PyPI / NPM Registry',
    condition: 'IF source == "tech_standard" AND (npm_package != NULL OR pypi_package != NULL) THEN VERIFIED',
    status: 'passed',
  },
  'R-WIKIDATA-VERIFIED': {
    nameEn: 'Wikidata Knowledge Graph / OpenCitations Verified',
    nameVi: 'Xác thực Chuẩn quốc tế / Cẩm nang lâm sàng / DOI qua Wikidata & OpenCitations',
    condition: 'IF source == "wikidata_opencitations" AND title_sim >= 0.80 THEN VERIFIED',
    status: 'passed',
  },
  'R-WAYBACK-ARCHIVED': {
    nameEn: 'Wayback Machine Archival Snapshot Verified (Link Rot Rescued)',
    nameVi: 'Xác thực Bản lưu trữ Internet Archive Wayback Machine (Link Rot)',
    condition: 'IF url_status == "archived_alive" AND archive_url != NULL THEN WARN_LINK_ROT_NOT_HALLUCINATION',
    status: 'warning',
  },
  'R-RETRACTED-PAPER': {
    nameEn: 'Retracted Publication Alert (Retraction Watch / Crossref)',
    nameVi: 'CẢNH BÁO NGHIÊM TRỌNG: Bài báo đã bị rút hồi (Retracted Paper)',
    condition: 'IF is_retracted == TRUE THEN METADATA_ERROR (FLAG_RETRACTED_PAPER)',
    status: 'failed',
  },
  'R-CONSENSUS-FULL': {
    nameVi: 'Đồng thuận đa nguồn học thuật (≥ 2 CSDL)',
    nameEn: 'Multi-Source Scholarly Consensus (≥ 2 DBs)',
    condition: 'IF source_consensus >= 2 AND metadata_conflict == FALSE THEN BOOST_CONFIDENCE(+0.10)',
    status: 'passed',
  },
  'R-CONSENSUS-PARTIAL': {
    nameVi: 'Đồng thuận một phần giữa các nguồn',
    nameEn: 'Partial Cross-Database Consensus',
    condition: 'IF matched_sources >= 1 AND partial_field_agreement == TRUE THEN WARN',
    status: 'warning',
  },
  'R-DOI-TITLE-MISMATCH': {
    nameVi: 'Xung đột giữa DOI và Tiêu đề bài báo',
    nameEn: 'DOI vs. Title Cross-Check Conflict',
    condition: 'IF doi_resolved == TRUE AND title_sim_fuzzy < 0.65 THEN METADATA_ERROR',
    status: 'warning',
  },
  'R-KNOWN-AUTHOR-TITLE-MISMATCH': {
    nameVi: 'Tác giả có thật nhưng sai lệch Metadata / Năm / Tiêu đề',
    nameEn: 'Known Author with Metadata / Year / Title Drift',
    condition: 'IF author_matched == TRUE AND (year_distance > 0 OR title_sim < 0.85) THEN METADATA_ERROR',
    status: 'warning',
  },
  'R-KNOWN-AUTHOR-WEAK-EVIDENCE': {
    nameVi: 'Tác giả khớp một phần nhưng thiếu bằng chứng nguồn',
    nameEn: 'Known Author with Weak Bibliographic Evidence',
    condition: 'IF author_jaccard >= 0.50 AND candidate_confidence < 0.65 THEN METADATA_ERROR',
    status: 'warning',
  },
  'R-WEAK-EVIDENCE': {
    nameVi: 'Độ tương đồng ứng viên thấp (Weak Evidence)',
    nameEn: 'Low Candidate Similarity Score',
    condition: 'IF max_candidate_confidence BETWEEN [0.40, 0.70) THEN METADATA_ERROR',
    status: 'warning',
  },
  'R-CONTENT-ALIGNMENT': {
    nameVi: 'Ngữ cảnh trích dẫn khớp nội dung nguồn',
    nameEn: 'In-Text Context Semantic Alignment',
    condition: 'IF context_abstract_cosine >= 0.65 THEN PASS',
    status: 'passed',
  },
  'R-CONTENT-MISMATCH': {
    nameVi: 'Ngữ cảnh trích dẫn mâu thuẫn với tóm tắt bài gốc',
    nameEn: 'In-Text Claim vs. Source Abstract Mismatch',
    condition: 'IF context_abstract_cosine < 0.30 THEN WARN_CONTENT_DRIFT',
    status: 'warning',
  },
  'R-STYLE-INCONSISTENT': {
    nameVi: 'Sai lệch chuẩn định dạng trích dẫn (APA/IEEE)',
    nameEn: 'Citation Formatting Style Inconsistency',
    condition: 'IF citation_style != dominant_document_style THEN APPLY_STYLE_PENALTY',
    status: 'warning',
  },
  'R-WEB-RESOURCE': {
    nameVi: 'Tài nguyên Web / URL phi học thuật',
    nameEn: 'Non-Scholarly Web URL Resource',
    condition: 'IF has_url == TRUE AND no_doi == TRUE AND no_academic_venue == TRUE THEN RESOURCE',
    status: 'passed',
  },
  'R-URL-RESOURCE': {
    nameVi: 'Liên kết URL trực tiếp',
    nameEn: 'Direct URL Reference',
    condition: 'IF citation_type == "url" THEN RESOURCE',
    status: 'passed',
  },
  'R-FAKE-URL': {
    nameVi: 'URL hoặc tên miền không tồn tại / giả mạo',
    nameEn: 'Unresolvable or Fabricated URL',
    condition: 'IF url_status >= 400 OR domain_resolvable == FALSE THEN SUSPECTED_HALLUCINATION',
    status: 'failed',
  },
  'R-FABRICATED-DOI': {
    nameVi: 'Mã DOI không tồn tại trên hệ thống Crossref/DataCite',
    nameEn: 'Non-Existent / Fabricated DOI Prefix',
    condition: 'IF cited_doi != NULL AND crossref_doi_lookup == 404 THEN SUSPECTED_HALLUCINATION',
    status: 'failed',
  },
  'R-FAKE-AUTHOR': {
    nameVi: 'Tổ hợp Tác giả + Công trình không tồn tại',
    nameEn: 'Unverifiable Author-Publication Combination',
    condition: 'IF author_jaccard == 0.0 AND max_title_sim < 0.45 THEN SUSPECTED_HALLUCINATION',
    status: 'failed',
  },
  'R-FUTURE-YEAR': {
    nameVi: 'Năm xuất bản vượt quá thời điểm hiện tại',
    nameEn: 'Impossibly Future Publication Year',
    condition: 'IF cited_year > current_year + 1 THEN SUSPECTED_HALLUCINATION',
    status: 'failed',
  },
  'R-FUTURE-YEAR-KNOWN-AUTHOR': {
    nameEn: 'Publication Year Discrepancy on Known Work',
    nameVi: 'Sai năm xuất bản (lệch năm so với bản gốc)',
    condition: 'IF title_sim >= 0.85 AND abs(cited_year - actual_year) >= 1 THEN METADATA_ERROR',
    status: 'warning',
  },
  'R-AMBIGUOUS-MAPPING': {
    nameEn: 'Ambiguous In-Text to Bibliography Mapping',
    nameVi: 'Ánh xạ trích dẫn trong bài và danh mục tài liệu nhập nhằng',
    condition: 'IF mapping_status == "ambiguous_mapping" THEN UNRESOLVED (CAP_CONFIDENCE <= 0.55)',
    status: 'warning',
  },
  'R-ABSTENTION-BORDER': {
    nameEn: 'Abstention Border Zone (Uncertain Similarity)',
    nameVi: 'Vùng biên từ chối phán quyết (Độ tương đồng chưa đủ kết luận)',
    condition: 'IF 0.40 <= title_sim_max <= 0.60 THEN UNRESOLVED',
    status: 'warning',
  },
  'R-DOMAIN-EXCEPTION': {
    nameEn: 'Domain / Broken Link Exception on Verified Record',
    nameVi: 'Ngoại lệ liên kết lỗi trên công trình có thật trong CSDL',
    condition: 'IF scholarly_record_exists == TRUE AND (url_status == "dead_link" OR title_sim < 0.60) THEN FLAG_DOMAIN_EXCEPTION',
    status: 'warning',
  },
  'R-BROKEN-LINK': {
    nameEn: 'Broken / Unreachable Citation URL (HTTP 404/410/DNS)',
    nameVi: 'Liên kết URL trích dẫn bị hỏng hoặc không thể truy cập (HTTP 404/410)',
    condition: 'IF url_status == "dead_link" AND scholarly_record_verified == TRUE THEN PENALIZE_IDENTIFIER_VALIDITY',
    status: 'warning',
  },
  'R-DEAD-URL': {
    nameEn: 'Dead Citation URL with No Scholarly Record',
    nameVi: 'URL trích dẫn chết và không tồn tại hồ sơ học thuật',
    condition: 'IF url_status == "dead_link" AND count(matched_candidates) == 0 THEN SUSPECTED_HALLUCINATION',
    status: 'failed',
  },
  'R-NONEXISTENT-DOI': {
    nameEn: 'Non-Existent DOI in Scholarly Registries',
    nameVi: 'Mã DOI không tồn tại trên các CSDL học thuật',
    condition: 'IF cited_doi != NULL AND doi_exact_match == FALSE AND title_sim_max < 0.60 THEN SUSPECTED_HALLUCINATION',
    status: 'failed',
  },
  'R-NO-SCHOLARLY-RECORD': {
    nameEn: 'Zero Records Across Live Scholarly Registries',
    nameVi: 'Không tồn tại bản ghi trên hệ thống CSDL học thuật trực tuyến',
    condition: 'IF clean_empty_registries >= 2 AND count(candidates) == 0 THEN SUSPECTED_HALLUCINATION',
    status: 'failed',
  },
  'R-HALLUCINATED-SOURCE': {
    nameEn: 'Hallucinated / Unverifiable Source Evidence',
    nameVi: 'Nguồn trích dẫn có dấu hiệu bị AI bịa đặt (Hallucinated Source)',
    condition: 'IF title_sim_max < 0.40 AND author_jaccard < 0.30 AND doi_exact_match == FALSE THEN SUSPECTED_HALLUCINATION',
    status: 'failed',
  },
  'R-NO-CANDIDATE': {
    nameEn: 'Zero Candidates Retrieved Across Scholarly DBs',
    nameVi: 'Không tìm thấy ứng viên nào trên các CSDL học thuật',
    condition: 'IF count(candidates_across_all_sources) == 0 THEN SUSPECTED_HALLUCINATION / UNRESOLVED',
    status: 'failed',
  },
  'R-FAIL-ALL': {
    nameEn: 'External Scholarly APIs Unavailable / Timed Out',
    nameVi: 'Các cổng API học thuật bên ngoài lỗi kết nối hoặc quá thời gian chờ',
    condition: 'IF sources_succeeded == 0 AND sources_failed > 0 THEN UNRESOLVED',
    status: 'warning',
  },
};

function parseRawCitationMeta(rawText: string): MetadataFields {
  const cleaned = rawText.replace(/^\s*\[\d+\]\s*/, '').trim();

  // Extract DOI if present
  const doiMatch = cleaned.match(/\b(10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+)\b/);
  const doi = doiMatch ? doiMatch[1].replace(/[.,;]+$/, '') : '—';

  // Extract Year
  const yearMatch = cleaned.match(/\b(19\d{2}|20\d{2})[a-z]?\b/);
  const year = yearMatch ? yearMatch[1] : '—';

  // Try quotes for title: "Title" or “Title”
  const quoteMatch = cleaned.match(/[“"]([^”"]{8,220})[”"]/);
  let title = quoteMatch ? quoteMatch[1].replace(/[.,]+$/, '').trim() : '';

  // Try APA style: Authors (Year). Title. Venue.
  let authors = '';
  let venue = '';

  const apaMatch = cleaned.match(/^(.+?)\s*\((?:19|20)\d{2}[a-z]?\)\.\s*([^.]+)\.\s*(.*)$/);
  if (apaMatch) {
    authors = apaMatch[1].trim().replace(/[.,]+$/, '');
    if (!title) title = apaMatch[2].trim();
    venue = apaMatch[3]
      .replace(/\b(?:https?:\/\/\S+|doi:\s*\S+|10\.\d{4,9}\/\S+)/gi, '')
      .trim()
      .replace(/[.,]+$/, '');
  } else {
    // IEEE or general style: Authors, "Title," Venue, Year. OR Authors. Title. Venue, Year.
    const segments = cleaned
      .split(/\.\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length >= 2) {
      authors = segments[0].replace(/^\[\d+\]\s*/, '').trim();
      if (!title) {
        title = segments[1].replace(/^[“"]|[”"]$/g, '').trim();
      }
      if (segments.length >= 3) {
        venue = segments
          .slice(2)
          .join('. ')
          .replace(/\b(?:https?:\/\/\S+|doi:\s*\S+|10\.\d{4,9}\/\S+)/gi, '')
          .trim();
      }
    } else {
      const commaParts = cleaned.split(/,\s+/);
      if (commaParts.length >= 2) {
        authors = commaParts[0].trim();
        if (!title) title = commaParts.slice(1).join(', ').slice(0, 140);
      } else {
        title = cleaned.slice(0, 140);
      }
    }
  }

  const cleanVenue = venue
    .replace(/^(?:,\s*)?(?:[^.()]*?\)\.\s*)+/, '')
    .replace(/^[,.;:)\s]+/, '')
    .trim();

  const urlMatch = cleaned.match(/\bhttps?:\/\/[^\s<>")'\]]+/i);
  const rawUrl = urlMatch
    ? urlMatch[0].replace(/[.,;:)'"\u2019\u201d]+$/, '')
    : '';
  const url = rawUrl || (doi !== '—' ? `https://doi.org/${doi}` : '—');

  return {
    title: title || cleaned.slice(0, 120) || '—',
    authors: authors || '—',
    year: year || '—',
    venue: cleanVenue || venue || '—',
    doi,
    url,
  };
}

function formatShortInText(
  authors: string,
  year: string,
  rawText: string,
  authorList?: string[]
): string {
  if (authors && authors !== '—') {
    const firstAuthor = authors.split(/,|&|\band\b/i)[0].trim();
    const hasMore =
      authorList && authorList.length > 0
        ? authorList.length > 1 || /\bet\s+al/i.test(authors)
        : authors.split(',').length > 2 || /&|\band\b|\bet\s+al/i.test(authors);
    const shortAuthor =
      firstAuthor.length > 28 ? firstAuthor.slice(0, 28) + '…' : firstAuthor;
    const suffix =
      hasMore && !/et\s+al/i.test(shortAuthor) ? ' et al.' : '';
    return year && year !== '—'
      ? `${shortAuthor}${suffix} (${year})`
      : `${shortAuthor}${suffix}`;
  }
  const stripped = rawText.replace(/^\s*\[\d+\]\s*/, '').trim();
  return (stripped || rawText).slice(0, 42);
}

function getVerdictBadgeVisuals(
  label: ValidationLabel,
  triggeredRules?: string[]
): {
  text: string;
  badgeClass: string;
} {
  const isLegal = (triggeredRules ?? []).some((r) => r.includes('LEGAL'));
  switch (label) {
    case 'verified':
      return {
        text: '✓ VERIFIED',
        badgeClass:
          'verdict-badge-verified bg-emerald-100/90 text-emerald-800 border border-emerald-300 dark:bg-emerald-950/90 dark:text-emerald-300 dark:border-emerald-700 font-bold',
      };
    case 'metadata_error':
      return {
        text: isLegal ? '⚠ LEGAL_METADATA_ERROR' : '⚠ METADATA_ERROR',
        badgeClass:
          'verdict-badge-metadata-error bg-amber-100/90 text-amber-800 border border-amber-300 dark:bg-amber-950/90 dark:text-amber-300 dark:border-amber-700 font-bold',
      };
    case 'suspected_hallucination':
      return {
        text: '✕ HALLUCINATION',
        badgeClass:
          'verdict-badge-hallucinated bg-red-100/90 text-red-800 border border-red-300 dark:bg-red-950/90 dark:text-red-300 dark:border-red-700 font-bold',
      };
    case 'resource':
      return {
        text: isLegal ? '⚖ VN_LEGAL_STATUTE' : '↗ URL_RESOURCE',
        badgeClass:
          'bg-violet-100/90 text-violet-800 border border-violet-300 dark:bg-violet-950/90 dark:text-violet-300 dark:border-violet-700 font-bold',
      };
    default:
      return {
        text: '— UNRESOLVED',
        badgeClass:
          'verdict-badge-unverifiable bg-slate-200/80 text-slate-700 border border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 font-bold',
      };
  }
}

function getMappingBadgeVisuals(status: Verdict['mapping_status']): {
  text: string;
  badgeClass: string;
} {
  switch (status) {
    case 'matched':
      return {
        text: 'MATCHED',
        badgeClass:
          'bg-indigo-50 text-indigo-700 border border-indigo-200/90 dark:bg-indigo-950/70 dark:text-indigo-300 dark:border-indigo-800 font-semibold',
      };
    case 'missing_reference':
      return {
        text: 'MISSING_REF',
        badgeClass:
          'mapping-badge-missing bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/70 dark:text-red-300 dark:border-red-800 font-semibold',
      };
    case 'uncited_reference':
      return {
        text: 'UNCITED_REF',
        badgeClass:
          'mapping-badge-uncited bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-950/70 dark:text-sky-300 dark:border-sky-800 font-semibold',
      };
    case 'in_text_mismatch':
    case 'ambiguous_mapping':
    case 'duplicate_reference':
    case 'style_inconsistent':
      return {
        text: status.toUpperCase().replace('_REFERENCE', '_REF'),
        badgeClass:
          'mapping-badge-mismatch bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-950/70 dark:text-orange-300 dark:border-orange-800 font-semibold',
      };
    default:
      return {
        text: 'UNRESOLVED',
        badgeClass:
          'bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 font-semibold',
      };
  }
}

function resolveVerdictUrlStatus(verdict: Verdict): {
  status: 'alive' | 'restricted_alive' | 'archived_alive' | 'dead_link' | 'fake_domain' | null;
  code: number | null;
} {
  const rawStatus = verdict.url_status ?? verdict.features?.url_status ?? null;
  const rawCode =
    verdict.url_status_code ?? verdict.features?.url_status_code ?? null;
  if (rawStatus) {
    return { status: rawStatus, code: rawCode };
  }
  const rules = verdict.triggered_rules ?? [];
  if (rules.includes('R-WAYBACK-ARCHIVED')) {
    return { status: 'archived_alive', code: rawCode ?? 404 };
  }
  if (rules.includes('R-FAKE-URL')) {
    return { status: 'fake_domain', code: null };
  }
  if (rules.includes('R-DEAD-URL') || rules.includes('R-BROKEN-LINK')) {
    return { status: 'dead_link', code: rawCode ?? 404 };
  }
  return { status: null, code: null };
}

function getLinkBadgeVisuals(
  verdict: Verdict,
  lang: 'vi' | 'en'
): LinkBadgeInfo | null {
  const { status, code } = resolveVerdictUrlStatus(verdict);
  if (!status) return null;

  switch (status) {
    case 'alive':
      return {
        status,
        text: `✓ HTTP ${code || 200} OK`,
        badgeClass:
          'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-800 font-semibold',
        title:
          lang === 'vi'
            ? `Liên kết URL hoạt động bình thường (HTTP ${code || 200} OK)`
            : `Citation URL resolved successfully (HTTP ${code || 200} OK)`,
      };
    case 'restricted_alive':
      return {
        status,
        text: `🔒 HTTP ${code || 403} OK`,
        badgeClass:
          'bg-teal-50 text-teal-700 border border-teal-200 dark:bg-teal-950/70 dark:text-teal-300 dark:border-teal-800 font-semibold',
        title:
          lang === 'vi'
            ? `Liên kết sống — Tường lửa nhà xuất bản (HTTP ${code || 403})`
            : `Publisher paywall / bot-filtered URL is alive (HTTP ${code || 403})`,
      };
    case 'archived_alive':
      return {
        status,
        text: '🏛️ WAYBACK ARCHIVED',
        badgeClass:
          'bg-amber-50 text-amber-800 border border-amber-300 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800 font-semibold',
        title:
          lang === 'vi'
            ? `URL gốc bị lỗi Link Rot nhưng đã xác thực có bản lưu trên Internet Archive Wayback Machine${verdict.archive_url ? ` (${verdict.archive_url})` : ''}`
            : `Live URL suffered link rot, but verified archival snapshot exists on Internet Archive Wayback Machine${verdict.archive_url ? ` (${verdict.archive_url})` : ''}`,
      };
    case 'dead_link':
      return {
        status,
        text: `✕ HTTP ${code || 404} DEAD`,
        badgeClass:
          'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/70 dark:text-red-300 dark:border-emerald-800 font-semibold',
        title:
          lang === 'vi'
            ? `Liên kết URL bị hỏng hoặc không tồn tại (HTTP ${code || 404} / DNS Error)`
            : `Broken or unreachable citation URL (HTTP ${code || 404} / DNS Error)`,
      };
    case 'fake_domain':
      return {
        status,
        text: '✕ FAKE URL',
        badgeClass:
          'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/70 dark:text-red-300 dark:border-red-800 font-semibold',
        title:
          lang === 'vi'
            ? 'Tên miền URL giả mạo hoặc placeholder'
            : 'Fabricated or placeholder URL domain',
      };
  }
}

function buildLocalizedReasoning(verdict: Verdict, lang: 'vi' | 'en'): string {
  const isLegalStatute = (verdict.triggered_rules ?? []).some((r) =>
    r.includes('LEGAL')
  );
  if (isLegalStatute && verdict.reasoning) {
    return verdict.override_note
      ? lang === 'vi'
        ? `[Ghi đè bởi Giảng viên: ${verdict.override_note}] — ${verdict.reasoning}`
        : `[Teacher Override: ${verdict.override_note}] — ${verdict.reasoning}`
      : verdict.reasoning;
  }

  const sourceMapVi: Record<string, string> = {
    local_db: 'Thư viện học thuật nội bộ (ACL / SQLite FTS5)',
    known_papers: 'CSDL công trình kinh điển (Known Papers)',
    vn_legal_registry: 'Hệ thống Văn bản Quy phạm Pháp luật Việt Nam',
    crossref: 'Crossref',
    openalex: 'OpenAlex',
    semantic_scholar: 'Semantic Scholar',
    dblp: 'DBLP',
    arxiv: 'arXiv',
    openlibrary: 'OpenLibrary / Google Books',
    europepmc: 'Europe PMC (PubMed)',
    datacite: 'DataCite (Zenodo / Figshare / OSF)',
    doi_ra: 'Global DOI Registration Agency (JaLC / CNKI / mEDRA)',
    doaj: 'DOAJ (Directory of Open Access Journals)',
    openaire_hal: 'OpenAIRE Graph / HAL Open Science',
    ncbi_biorxiv: 'NCBI Entrez / bioRxiv / medRxiv',
    huggingface: 'Hugging Face Hub',
    tech_standard: 'IETF RFC / PyPI / NPM / GitHub',
    wikidata_opencitations: 'Wikidata Knowledge Graph / OpenCitations',
    serpapi: 'Google Scholar',
  };
  const sourceMapEn: Record<string, string> = {
    local_db: 'the local scholarly index (ACL / SQLite FTS5)',
    known_papers: 'the canonical Known Papers index',
    vn_legal_registry: 'the Vietnamese Legal Statute Registry',
    crossref: 'Crossref',
    openalex: 'OpenAlex',
    semantic_scholar: 'Semantic Scholar',
    dblp: 'DBLP',
    arxiv: 'arXiv',
    openlibrary: 'OpenLibrary / Google Books',
    europepmc: 'Europe PMC (PubMed)',
    datacite: 'DataCite (Zenodo / Figshare / OSF)',
    doi_ra: 'Global DOI Registration Agency (JaLC / CNKI / mEDRA)',
    doaj: 'DOAJ (Directory of Open Access Journals)',
    openaire_hal: 'OpenAIRE Graph / HAL Open Science',
    ncbi_biorxiv: 'NCBI Entrez / bioRxiv / medRxiv',
    huggingface: 'Hugging Face Hub',
    tech_standard: 'IETF RFC / PyPI / NPM / GitHub',
    wikidata_opencitations: 'Wikidata Knowledge Graph / OpenCitations',
    serpapi: 'Google Scholar',
  };

  const fieldMapVi: Record<string, string> = {
    title: 'tiêu đề',
    authors: 'nhóm tác giả',
    author: 'tác giả',
    year: 'năm xuất bản',
    venue: 'nơi công bố',
    doi: 'mã DOI',
    url: 'đường dẫn URL',
    retracted: 'trạng thái thu hồi bài báo (Retracted)',
    retracted_paper: 'trạng thái thu hồi bài báo (Retracted)',
  };
  const fieldMapEn: Record<string, string> = {
    title: 'title',
    authors: 'authors',
    author: 'authors',
    year: 'publication year',
    venue: 'venue',
    doi: 'DOI',
    url: 'URL',
    retracted: 'retraction status (Retracted)',
    retracted_paper: 'retraction status (Retracted)',
  };

  const sources = [
    ...new Set(
      (verdict.matched_sources ?? []).map((s) =>
        lang === 'vi'
          ? sourceMapVi[s.source.toLowerCase()] ?? s.source
          : sourceMapEn[s.source.toLowerCase()] ?? s.source
      )
    ),
  ];

  const matchedFields = [
    ...new Set(
      (verdict.matched_sources ?? []).flatMap((s) =>
        (s.matched_fields ?? []).map((f) =>
          lang === 'vi'
            ? fieldMapVi[f.toLowerCase()] ?? f
            : fieldMapEn[f.toLowerCase()] ?? f
        )
      )
    ),
  ];

  const mismatchedFields = [
    ...new Set(
      (verdict.mismatched_fields ?? []).map((f) =>
        lang === 'vi'
          ? fieldMapVi[f.toLowerCase()] ?? f
          : fieldMapEn[f.toLowerCase()] ?? f
      )
    ),
  ];

  // Extract neural context alignment score from features or raw reasoning if present
  const neuralMatch = verdict.reasoning?.match(
    /content alignment score=([\d.]+)\s*\((low|medium|high)\)/i
  );
  const featAlignScore = verdict.features?.content_alignment_score;
  const neuralScore =
    featAlignScore && featAlignScore > 0
      ? featAlignScore.toFixed(2)
      : neuralMatch
        ? neuralMatch[1]
        : null;
  const neuralLevel = (
    verdict.features?.content_alignment_confidence ||
    (neuralMatch ? neuralMatch[2] : '') ||
    ''
  ).toLowerCase() || null;

  const { status: urlStatus, code: urlCode } = resolveVerdictUrlStatus(verdict);

  const titleSim = verdict.features?.title_sim_fuzzy;
  const authorSim = verdict.features?.author_jaccard;

  if (lang === 'vi') {
    const telemetryParts: string[] = [];
    if (titleSim !== undefined) {
      telemetryParts.push(`độ tương đồng tiêu đề = ${titleSim.toFixed(2)}`);
    }
    if (authorSim !== undefined) {
      telemetryParts.push(`tác giả = ${authorSim.toFixed(2)}`);
    }
    if (neuralScore) {
      const levelVi =
        neuralLevel === 'high'
          ? 'cao'
          : neuralLevel === 'medium'
            ? 'trung bình'
            : 'thấp';
      telemetryParts.push(
        `điểm căn chỉnh ngữ cảnh Neural = ${neuralScore} (${levelVi})`
      );
    }
    if (urlStatus === 'alive') {
      telemetryParts.push(`kiểm tra liên kết = HTTP ${urlCode || 200} OK`);
    } else if (urlStatus === 'restricted_alive') {
      telemetryParts.push(
        `kiểm tra liên kết = HTTP ${urlCode || 403} (tường lửa nhà xuất bản — liên kết sống)`
      );
    } else if (urlStatus === 'archived_alive') {
      telemetryParts.push(
        'kiểm tra liên kết = Đã lưu trữ trên Wayback Machine (Link Rot)'
      );
    } else if (urlStatus === 'dead_link') {
      telemetryParts.push(
        `kiểm tra liên kết = HTTP ${urlCode || 404} (liên kết chết / không thể truy cập)`
      );
    } else if (urlStatus === 'fake_domain') {
      telemetryParts.push('kiểm tra liên kết = tên miền giả mạo');
    }
    const isRetracted =
      Boolean(verdict.is_retracted) ||
      (verdict.triggered_rules ?? []).includes('R-RETRACTED-PAPER');
    const retractionPrefixVi = isRetracted
      ? '⚠️ CẢNH BÁO NGHIÊM TRỌNG: Bài báo này đã bị rút hồi chính thức (RETRACTED PAPER). Không sử dụng làm nguồn trích dẫn khoa học! '
      : '';
    const telemetrySuffix =
      telemetryParts.length > 0 ? ` (${telemetryParts.join(' · ')})` : '';

    let mainText = '';
    if (verdict.label === 'resource') {
      mainText = `Phát hiện tài nguyên Web / API phi học thuật (${verdict.citation_raw}). Mục này được phân loại là đường dẫn tài nguyên tham khảo và không tính điểm phạt vào chỉ số CIS.${telemetrySuffix}`;
    } else if (verdict.mapping_status === 'missing_reference') {
      mainText =
        'Trích dẫn xuất hiện trong phần nội dung bài viết nhưng bị khuyết mục tương ứng trong danh mục tài liệu tham khảo cuối bài.';
    } else if (verdict.label === 'verified') {
      const srcStr =
        sources.length > 0
          ? sources.join(' và ')
          : 'cơ sở dữ liệu học thuật';
      const fldStr =
        matchedFields.length > 0
          ? matchedFields.join(', ')
          : 'tiêu đề, tác giả và năm xuất bản';
      const brokenLinkNoteVi =
        urlStatus === 'dead_link'
          ? ' Lưu ý: Công trình học thuật có thật nhưng đường dẫn URL đính kèm bị hỏng (HTTP 404/DNS).'
          : '';
      mainText = `Trích dẫn khớp chính xác với công trình trong ${srcStr}. Các trường thông tin (${fldStr}) hoàn toàn nhất quán với bản ghi gốc.${brokenLinkNoteVi}${telemetrySuffix}`;
    } else if (verdict.label === 'metadata_error') {
      const srcStr =
        sources.length > 0 ? ` trên ${sources.join(' và ')}` : '';
      const errFldStr =
        mismatchedFields.length > 0
          ? mismatchedFields.join(', ')
          : 'siêu dữ liệu (năm xuất bản / tiêu đề)';
      mainText = `Tìm thấy công trình học thuật tương ứng${srcStr}, nhưng phát hiện sai lệch ở trường: ${errFldStr}. Vui lòng đối chiếu và hiệu đính lại theo bản ghi gốc.${telemetrySuffix}`;
    } else if (verdict.label === 'suspected_hallucination') {
      mainText = `Không tìm thấy bất kỳ công trình học thuật nào khớp với trích dẫn này trên hệ thống 15+ cơ sở dữ liệu học thuật & kỹ thuật (Local ACL FTS5, Crossref, OpenAlex, DataCite, DOAJ, OpenAIRE/HAL, NCBI/bioRxiv, DBLP, arXiv, OpenLibrary, Europe PMC, Hugging Face, IETF RFC, Global DOI RA). Nghi ngờ trích dẫn suy diễn (hallucination) hoặc thông tin không có thật.${telemetrySuffix}`;
    } else {
      const srcStr =
        sources.length > 0
          ? `Tìm thấy ứng viên tiềm năng trên ${sources.join(', ')}, nhưng bằng chứng siêu dữ liệu chưa đủ mạnh để xác nhận tự động.`
          : 'Chưa đủ bằng chứng siêu dữ liệu từ các nguồn truy hồi để xác minh tự động trích dẫn này.';
      mainText = `${srcStr} Khuyến nghị giảng viên kiểm tra thủ công.${telemetrySuffix}`;
    }

    return verdict.override_note
      ? `[Ghi đè bởi Giảng viên: ${verdict.override_note}] — ${retractionPrefixVi}${mainText}`
      : `${retractionPrefixVi}${mainText}`;
  }

  // English ('en') — 100% pure English
  const telemetryPartsEn: string[] = [];
  if (titleSim !== undefined) {
    telemetryPartsEn.push(`title similarity = ${titleSim.toFixed(2)}`);
  }
  if (authorSim !== undefined) {
    telemetryPartsEn.push(`author similarity = ${authorSim.toFixed(2)}`);
  }
  if (neuralScore) {
    telemetryPartsEn.push(
      `Neural context alignment = ${neuralScore} (${neuralLevel || 'checked'})`
    );
  }
  if (urlStatus === 'alive') {
    telemetryPartsEn.push(`link check = HTTP ${urlCode || 200} OK`);
  } else if (urlStatus === 'restricted_alive') {
    telemetryPartsEn.push(
      `link check = HTTP ${urlCode || 403} (publisher paywall — link alive)`
    );
  } else if (urlStatus === 'archived_alive') {
    telemetryPartsEn.push(
      'link check = Wayback Machine snapshot verified (Link Rot)'
    );
  } else if (urlStatus === 'dead_link') {
    telemetryPartsEn.push(`link check = HTTP ${urlCode || 404} (dead link)`);
  } else if (urlStatus === 'fake_domain') {
    telemetryPartsEn.push('link check = fake/placeholder domain');
  }
  const isRetractedEn =
    Boolean(verdict.is_retracted) ||
    (verdict.triggered_rules ?? []).includes('R-RETRACTED-PAPER');
  const retractionPrefixEn = isRetractedEn
    ? '⚠️ CRITICAL WARNING: This publication has been officially RETRACTED. Do not cite as valid scientific evidence! '
    : '';
  const telemetrySuffixEn =
    telemetryPartsEn.length > 0 ? ` (${telemetryPartsEn.join(' · ')})` : '';

  let mainTextEn = '';
  if (verdict.label === 'resource') {
    mainTextEn = `Non-scholarly Web / API resource detected (${verdict.citation_raw}). Classified as a web resource and excluded from the CIS penalty calculation.${telemetrySuffixEn}`;
  } else if (verdict.mapping_status === 'missing_reference') {
    mainTextEn =
      'This in-text citation does not have a corresponding entry in the bibliography section.';
  } else if (verdict.label === 'verified') {
    const srcStr =
      sources.length > 0 ? sources.join(' and ') : 'scholarly databases';
    const fldStr =
      matchedFields.length > 0
        ? matchedFields.join(', ')
        : 'title, authors, and publication year';
    const brokenLinkNoteEn =
      urlStatus === 'dead_link'
        ? ' Note: the scholarly publication exists, but the cited URL is broken (HTTP 404/DNS).'
        : '';
    mainTextEn = `The citation matches a canonical publication in ${srcStr}. Verified fields (${fldStr}) are consistent with the source record.${brokenLinkNoteEn}${telemetrySuffixEn}`;
  } else if (verdict.label === 'metadata_error') {
    const srcStr = sources.length > 0 ? ` in ${sources.join(' and ')}` : '';
    const errFldStr =
      mismatchedFields.length > 0
        ? mismatchedFields.join(', ')
        : 'metadata fields (year / title)';
    mainTextEn = `Found a corresponding publication${srcStr}, but detected discrepancies in: ${errFldStr}. Please review against the canonical record.${telemetrySuffixEn}`;
  } else if (verdict.label === 'suspected_hallucination') {
    mainTextEn = `No matching publication was found across all 15+ scholarly & technical databases (Local ACL FTS5, Crossref, OpenAlex, DataCite, DOAJ, OpenAIRE/HAL, NCBI/bioRxiv, DBLP, arXiv, OpenLibrary, Europe PMC, Hugging Face, IETF RFC, Global DOI RA). Suspected hallucinated or fabricated reference.${telemetrySuffixEn}`;
  } else {
    mainTextEn =
      sources.length > 0
        ? `A potential candidate was found in ${sources.join(', ')}, but bibliographic evidence is insufficient for automatic verification. Manual review recommended.${telemetrySuffixEn}`
        : `Insufficient bibliographic evidence across queried databases to automatically verify this citation. Manual review recommended.${telemetrySuffixEn}`;
  }

  return verdict.override_note
    ? `[Instructor Override: ${verdict.override_note}] — ${retractionPrefixEn}${mainTextEn}`
    : `${retractionPrefixEn}${mainTextEn}`;
}

function enrichVerdictItem(
  rawVerdict: Verdict,
  index: number,
  references: Citation[],
  extractedCitations: Citation[],
  lang: 'vi' | 'en'
): EnrichedCitationItem {
  const verdict: Verdict = isUrlResource(rawVerdict)
    ? { ...rawVerdict, label: 'resource' }
    : rawVerdict;
  const rawBracketMatch = (verdict.citation_raw ?? '').match(/^\s*\[(\d+)\]/);
  const refIdNumMatch = verdict.citation_link?.reference_id?.match(/^ref-0*(\d+)$/);
  const marker = `[${rawBracketMatch?.[1] || refIdNumMatch?.[1] || index + 1}]`;
  const parsedFallback = parseRawCitationMeta(verdict.citation_raw);

  // Find corresponding Reference entry if available
  const refId = verdict.citation_link?.reference_id;
  let matchedRef: Citation | undefined;
  if (refId) {
    const idxNum = parseInt(refId.replace(/^ref-/, ''), 10);
    if (!Number.isNaN(idxNum) && idxNum >= 1 && idxNum <= references.length) {
      matchedRef = references[idxNum - 1];
    }
  }
  if (!matchedRef) {
    matchedRef = references.find(
      (r) =>
        (r.raw_text ?? '').trim() === (verdict.citation_raw ?? '').trim() ||
        (r.title &&
          (verdict.citation_raw ?? '').toLowerCase().includes(r.title.toLowerCase().slice(0, 35)))
    );
  }

  // Find corresponding in-text Citation entry for page number & manuscript context
  const matchedInText = extractedCitations.find(
    (c) =>
      (refId &&
        (c.citation_link?.reference_id === refId ||
          c.citation_links?.some((l) => l.reference_id === refId))) ||
      (c.raw_text ?? '').trim() === (verdict.citation_raw ?? '').trim() ||
      (matchedRef?.authors?.[0] &&
        (c.raw_text ?? '').toLowerCase().includes(matchedRef.authors[0].split(',')[0].toLowerCase()))
  );

  const citedDoi = matchedRef?.doi || parsedFallback.doi || '—';
  const citedUrl =
    matchedRef?.url ||
    verdict.features?.checked_url ||
    parsedFallback.url ||
    (citedDoi !== '—' ? `https://doi.org/${citedDoi}` : '—');

  const citedMeta: MetadataFields = {
    title: matchedRef?.title || parsedFallback.title || verdict.citation_raw,
    authors:
      (matchedRef?.authors && matchedRef.authors.length > 0
        ? matchedRef.authors.join(', ')
        : parsedFallback.authors) || '—',
    year:
      (matchedRef?.year ? String(matchedRef.year) : parsedFallback.year) || '—',
    venue: matchedRef?.venue || parsedFallback.venue || '—',
    doi: citedDoi,
    url: citedUrl,
  };

  const inTextDisplay = formatShortInText(
    citedMeta.authors,
    citedMeta.year,
    matchedRef?.raw_text || verdict.citation_raw,
    matchedRef?.authors
  );

  const pageNum =
    matchedInText?.page_num ||
    matchedRef?.cited_on_pages?.[0] ||
    matchedRef?.page_num ||
    1;
  const pageLabel = `p. ${pageNum}`;

  // Determine Canonical Retrieved Metadata from matched_sources[0]
  const bestSource =
    verdict.matched_sources && verdict.matched_sources.length > 0
      ? verdict.matched_sources[0]
      : null;

  const matchedFieldsSet = new Set(
    (bestSource?.matched_fields ?? []).map((f) => f.toLowerCase())
  );
  const mismatchedFieldsSet = new Set(
    (verdict.mismatched_fields ?? []).map((f) => f.toLowerCase())
  );

  // Parse actual year from reasoning if year was mismatched and not explicitly in bestSource
  let inferredActualYear: string | null = null;
  if (verdict.reasoning) {
    const actualYearMatch =
      verdict.reasoning.match(/(?:actual|published|canonical|real)\s+year[:\s]+(\d{4})/i) ||
      verdict.reasoning.match(/\b(?:in|year)\s+(\d{4})\s*\((?:cited|vs)/i);
    if (actualYearMatch) {
      inferredActualYear = actualYearMatch[1];
    }
  }
  if (
    !inferredActualYear &&
    verdict.features?.year_distance &&
    verdict.features.year_distance > 0 &&
    citedMeta.year !== '—'
  ) {
    const citedYrNum = parseInt(citedMeta.year, 10);
    if (!Number.isNaN(citedYrNum)) {
      inferredActualYear = `${citedYrNum - Math.round(verdict.features.year_distance)} (Δ=${verdict.features.year_distance}y)`;
    }
  }

  const isLegalRule = (verdict.triggered_rules ?? []).some((r) =>
    r.includes('LEGAL')
  );
  const hasCanonicalRecord =
    Boolean(bestSource) &&
    verdict.label !== 'suspected_hallucination' &&
    (verdict.label !== 'resource' || isLegalRule) &&
    (bestSource?.confidence ?? verdict.confidence) >= 0.25;

  const retrievedMeta: MetadataFields | null = hasCanonicalRecord && bestSource
    ? {
        title:
          bestSource.title ||
          (matchedFieldsSet.has('title') && !mismatchedFieldsSet.has('title')
            ? citedMeta.title
            : '—'),
        authors:
          bestSource.authors && bestSource.authors.length > 0
            ? bestSource.authors.join(', ')
            : matchedFieldsSet.has('authors') && !mismatchedFieldsSet.has('authors')
              ? citedMeta.authors
              : mismatchedFieldsSet.has('authors')
                ? lang === 'vi'
                  ? 'Khác danh sách tác giả gốc'
                  : 'Author list discrepancy in source'
                : citedMeta.authors !== '—' && verdict.label === 'verified'
                  ? citedMeta.authors
                  : '—',
        year: bestSource.year
          ? String(bestSource.year)
          : mismatchedFieldsSet.has('year')
            ? inferredActualYear ||
              (lang === 'vi' ? 'Lệch năm xuất bản' : 'Year mismatch in source')
            : matchedFieldsSet.has('year') || verdict.label === 'verified'
              ? citedMeta.year
              : '—',
        venue:
          bestSource.venue ||
          (matchedFieldsSet.has('venue') && !mismatchedFieldsSet.has('venue')
            ? citedMeta.venue !== '—'
              ? citedMeta.venue
              : `Indexed in ${bestSource.source}`
            : bestSource.source
              ? `Indexed in ${bestSource.source}`
              : '—'),
        doi:
          bestSource.doi ||
          (Boolean(verdict.features?.doi_exact_match) || matchedFieldsSet.has('doi')
            ? citedMeta.doi
            : '—'),
        url:
          bestSource.url ||
          (bestSource.doi
            ? bestSource.doi.startsWith('http')
              ? bestSource.doi
              : `https://doi.org/${bestSource.doi}`
            : citedMeta.url !== '—' && verdict.label === 'verified'
              ? citedMeta.url
              : '—'),
      }
    : null;

  // Compute field-by-field status
  const hasExplicitTitleSim =
    verdict.features?.title_sim_fuzzy !== undefined ||
    verdict.features?.title_sim_semantic !== undefined;
  const hasExplicitAuthorSim = verdict.features?.author_jaccard !== undefined;
  const titleSim =
    verdict.features?.title_sim_fuzzy ??
    verdict.features?.title_sim_semantic ??
    (matchedFieldsSet.has('title') ? 1 : 0);
  const authorSim =
    verdict.features?.author_jaccard ??
    (matchedFieldsSet.has('authors') ? 1 : 0);

  const computeTitleStatus = (): { status: FieldStatus; label?: string } => {
    if (!retrievedMeta) return { status: 'mismatch', label: 'Diff' };
    if (mismatchedFieldsSet.has('title')) {
      if (titleSim >= 0.5) {
        return { status: 'partial', label: `${Math.round(titleSim * 100)}% Sim` };
      }
      return { status: 'mismatch', label: 'Diff' };
    }
    if (
      titleSim >= 0.96 ||
      (!hasExplicitTitleSim && matchedFieldsSet.has('title')) ||
      (verdict.label === 'verified' && titleSim >= 0.85)
    ) {
      return { status: 'match', label: '100% Match' };
    }
    if (titleSim >= 0.5) {
      return { status: 'partial', label: `${Math.round(titleSim * 100)}% Sim` };
    }
    return verdict.label === 'verified'
      ? { status: 'match', label: '100% Match' }
      : {
          status: 'mismatch',
          label: titleSim > 0 ? `${Math.round(titleSim * 100)}% Sim` : 'Diff',
        };
  };

  const computeAuthorsStatus = (): { status: FieldStatus; label?: string } => {
    if (citedMeta.authors === '—') return { status: 'missing' };
    if (!retrievedMeta) return { status: 'mismatch', label: 'Diff' };
    if (mismatchedFieldsSet.has('authors')) {
      return authorSim >= 0.45
        ? { status: 'partial', label: `${Math.round(authorSim * 100)}% Sim` }
        : { status: 'mismatch', label: 'Diff' };
    }
    if (
      authorSim >= 0.95 ||
      (!hasExplicitAuthorSim && matchedFieldsSet.has('authors')) ||
      verdict.label === 'verified'
    ) {
      return { status: 'match', label: '100% Match' };
    }
    if (authorSim >= 0.45) {
      return { status: 'partial', label: `${Math.round(authorSim * 100)}% Sim` };
    }
    return {
      status: 'mismatch',
      label: authorSim > 0 ? `${Math.round(authorSim * 100)}% Sim` : 'Diff',
    };
  };

  const computeYearStatus = (): { status: FieldStatus; label?: string } => {
    if (citedMeta.year === '—') return { status: 'missing' };
    if (!retrievedMeta) return { status: 'mismatch', label: 'Diff' };
    if (
      mismatchedFieldsSet.has('year') ||
      (verdict.features?.year_distance !== undefined &&
        verdict.features.year_distance > 0)
    ) {
      return { status: 'mismatch', label: 'Diff' };
    }
    if (matchedFieldsSet.has('year') || verdict.label === 'verified') {
      return { status: 'match', label: '100% Match' };
    }
    return { status: 'partial', label: 'Checked' };
  };

  const computeVenueStatus = (): { status: FieldStatus; label?: string } => {
    if (citedMeta.venue === '—' && (!retrievedMeta || retrievedMeta.venue === '—')) {
      return { status: 'missing' };
    }
    if (!retrievedMeta) return { status: 'mismatch', label: 'Diff' };
    if (mismatchedFieldsSet.has('venue')) return { status: 'mismatch', label: 'Diff' };
    if (citedMeta.venue === '—') return { status: 'missing' };
    if (matchedFieldsSet.has('venue') || verdict.label === 'verified') {
      return { status: 'match', label: '100% Match' };
    }
    return { status: 'partial', label: 'Indexed' };
  };

  const computeDoiStatus = (): { status: FieldStatus; label?: string } => {
    if (citedMeta.doi === '—' && (!retrievedMeta || retrievedMeta.doi === '—')) {
      return { status: 'missing' };
    }
    if (!retrievedMeta) return { status: 'mismatch', label: 'Diff' };
    if (mismatchedFieldsSet.has('doi')) return { status: 'mismatch', label: 'Diff' };
    if (
      Boolean(verdict.features?.doi_exact_match) ||
      matchedFieldsSet.has('doi') ||
      (citedMeta.doi !== '—' &&
        retrievedMeta.doi !== '—' &&
        citedMeta.doi.toLowerCase() === retrievedMeta.doi.toLowerCase())
    ) {
      return { status: 'match', label: '100% Match' };
    }
    if (citedMeta.doi === '—' && retrievedMeta.doi !== '—') {
      return { status: 'partial', label: 'Retrieved' };
    }
    return { status: 'missing' };
  };

  const { status: urlStatus, code: urlCode } = resolveVerdictUrlStatus(verdict);

  const computeUrlStatus = (): { status: FieldStatus; label?: string } => {
    if (urlStatus === 'alive') {
      return { status: 'match', label: `HTTP ${urlCode || 200} OK` };
    }
    if (urlStatus === 'restricted_alive') {
      return { status: 'match', label: `HTTP ${urlCode || 403} (Alive)` };
    }
    if (urlStatus === 'archived_alive') {
      return { status: 'partial', label: 'Wayback Archived' };
    }
    if (urlStatus === 'dead_link') {
      return { status: 'mismatch', label: `HTTP ${urlCode || 404} Dead` };
    }
    if (urlStatus === 'fake_domain') {
      return { status: 'mismatch', label: 'Fake Domain' };
    }
    if (mismatchedFieldsSet.has('url')) {
      return { status: 'mismatch', label: 'Broken Link' };
    }
    if (citedMeta.url === '—' && (!retrievedMeta || retrievedMeta.url === '—')) {
      return { status: 'missing' };
    }
    if (
      citedMeta.url !== '—' &&
      (verdict.label === 'verified' || verdict.label === 'resource')
    ) {
      return { status: 'match', label: 'Verified Link' };
    }
    if (citedMeta.url === '—' && retrievedMeta && retrievedMeta.url !== '—') {
      return { status: 'partial', label: 'Resolved URL' };
    }
    return { status: 'partial', label: 'Checked' };
  };

  // Build Manuscript Context with highlighted citation
  const rawContext =
    matchedInText?.context ||
    verdict.context ||
    matchedRef?.context ||
    verdict.citation_raw;
  const highlightTarget = matchedInText?.raw_text || inTextDisplay;
  let contextBefore = '“... ';
  let contextHighlight = highlightTarget;
  let contextAfter = ' ...”';

  const pos = rawContext.indexOf(highlightTarget);
  if (pos !== -1) {
    contextBefore = '“' + rawContext.slice(0, pos);
    contextHighlight = highlightTarget;
    contextAfter = rawContext.slice(pos + highlightTarget.length) + '”';
  } else {
    contextBefore = `“${rawContext} `;
    contextHighlight = marker;
    contextAfter = '”';
  }

  // Build localized explanation text (pure VI when lang==='vi', pure EN when lang==='en')
  const explanationText = buildLocalizedReasoning(verdict, lang);

  // Build Symbolic Rules Trace
  const triggeredCodes =
    verdict.triggered_rules && verdict.triggered_rules.length > 0
      ? verdict.triggered_rules
      : verdict.label === 'verified'
        ? ['R-WELL-LINKED']
        : verdict.label === 'metadata_error'
          ? ['R-KNOWN-AUTHOR-TITLE-MISMATCH']
          : verdict.label === 'suspected_hallucination'
            ? ['R-NO-CANDIDATE']
            : ['R-WEAK-EVIDENCE'];

  const rules: SymbolicRuleDisplay[] = triggeredCodes.map((code) => {
    const cleanCode = code.trim();
    const meta = RULE_CATALOG[cleanCode];
    if (meta) {
      return {
        code: cleanCode,
        name: lang === 'vi' ? meta.nameVi : meta.nameEn,
        condition: meta.condition,
        status: meta.status,
      };
    }
    const fallbackStatus: 'passed' | 'warning' | 'failed' =
      verdict.label === 'verified'
        ? 'passed'
        : verdict.label === 'metadata_error'
          ? 'warning'
          : 'failed';
    return {
      code: cleanCode,
      name:
        lang === 'vi'
          ? `Quy tắc kiểm định ${cleanCode}`
          : `Symbolic Verification Rule ${cleanCode}`,
      condition: `IF rule_triggered("${cleanCode}") == TRUE THEN ${verdict.label.toUpperCase()}`,
      status: fallbackStatus,
    };
  });

  // Build Federated Sources List (combining actual matched_sources with the standard scholarly engines)
  const standardEngines = [
    { key: 'local', label: 'Local ACL / Known Papers (SQLite FTS5)', matchTokens: ['local', 'known', 'acl'] },
    { key: 'crossref', label: 'Crossref REST API', matchTokens: ['crossref'] },
    { key: 'openalex', label: 'OpenAlex Scholarly Graph', matchTokens: ['openalex'] },
    { key: 'datacite', label: 'DataCite (Zenodo / Figshare / OSF)', matchTokens: ['datacite', 'zenodo', 'figshare'] },
    { key: 'doaj', label: 'DOAJ (Directory of Open Access Journals)', matchTokens: ['doaj'] },
    { key: 'openaire_hal', label: 'OpenAIRE Graph / HAL Open Science', matchTokens: ['openaire', 'hal'] },
    { key: 'ncbi_biorxiv', label: 'NCBI Entrez / bioRxiv / medRxiv', matchTokens: ['ncbi', 'biorxiv', 'medrxiv'] },
    { key: 'dblp', label: 'DBLP Computer Science Bibliography', matchTokens: ['dblp'] },
    { key: 'arxiv', label: 'arXiv Preprint Repository', matchTokens: ['arxiv'] },
    { key: 'openlibrary', label: 'OpenLibrary / Google Books', matchTokens: ['openlibrary', 'google_books'] },
    { key: 'europepmc', label: 'Europe PMC / PubMed', matchTokens: ['europepmc', 'pubmed'] },
    { key: 'huggingface', label: 'Hugging Face Hub (Models / Datasets / Papers)', matchTokens: ['huggingface'] },
    { key: 'tech_standard', label: 'IETF RFC / PyPI / NPM / GitHub', matchTokens: ['tech_standard', 'rfc', 'pypi', 'npm', 'github'] },
    { key: 'wikidata_opencitations', label: 'Wikidata Knowledge Graph / OpenCitations', matchTokens: ['wikidata', 'opencitations'] },
    { key: 'doi_ra', label: 'Global DOI Registration Agency (CSL-JSON)', matchTokens: ['doi_ra', 'jalc', 'cnki', 'medra'] },
  ];

  const usedSourceIndices = new Set<number>();
  const sources: SourceRetrievalItem[] = standardEngines.map((engine) => {
    const foundIdx = (verdict.matched_sources ?? []).findIndex((ms, idx) => {
      if (usedSourceIndices.has(idx)) return false;
      const lower = ms.source.toLowerCase();
      return engine.matchTokens.some((tok) => lower.includes(tok));
    });

    if (foundIdx !== -1 && verdict.matched_sources) {
      usedSourceIndices.add(foundIdx);
      const ms = verdict.matched_sources[foundIdx];
      const conf = ms.confidence ?? verdict.confidence;
      return {
        name: engine.label,
        status: conf >= 0.7 ? 'matched' : 'partial',
        score: conf.toFixed(2),
        matchedFields: ms.matched_fields ?? [],
        url: ms.url ?? undefined,
        doi: ms.doi ?? undefined,
      };
    }

    return {
      name: engine.label,
      status: 'not_found',
      score: '0.00',
      matchedFields: [],
    };
  });

  // Append any additional custom matched sources not covered above
  (verdict.matched_sources ?? []).forEach((ms, idx) => {
    if (!usedSourceIndices.has(idx)) {
      const conf = ms.confidence ?? verdict.confidence;
      sources.unshift({
        name: ms.source,
        status: conf >= 0.7 ? 'matched' : 'partial',
        score: conf.toFixed(2),
        matchedFields: ms.matched_fields ?? [],
        url: ms.url ?? undefined,
        doi: ms.doi ?? undefined,
      });
    }
  });

  const verdictVisual = getVerdictBadgeVisuals(
    verdict.label,
    verdict.triggered_rules
  );
  const mappingVisual = getMappingBadgeVisuals(verdict.mapping_status);
  const linkBadge = getLinkBadgeVisuals(verdict, lang);

  return {
    verdict,
    index,
    marker,
    inText: inTextDisplay,
    pageLabel,
    verdictText: verdictVisual.text,
    verdictBadgeClass: verdictVisual.badgeClass,
    mappingText: mappingVisual.text,
    mappingBadgeClass: mappingVisual.badgeClass,
    linkBadge,
    confidencePct: Math.round((verdict.confidence ?? 0) * 100),
    citedMeta,
    retrievedMeta,
    fieldStatus: {
      title: computeTitleStatus(),
      authors: computeAuthorsStatus(),
      year: computeYearStatus(),
      venue: computeVenueStatus(),
      doi: computeDoiStatus(),
      url: computeUrlStatus(),
    },
    contextBefore,
    contextHighlight,
    contextAfter,
    explanationText,
    rules,
    sources,
  };
}

/* ============================================================
   SourceLogic — Real Interactive Citation Debugger IDE Page
   ============================================================ */

export function EssayPage() {
  const { t, i18n } = useTranslation();
  const { isUser, has } = useRole();
  const canViewDeepTrace = has('view_logic_trace');
  const canOverride = has('override_verdict');
  const lang: 'vi' | 'en' = i18n.language?.startsWith('en') ? 'en' : 'vi';

  const { id } = useParams<{ id: string }>();
  const numericId = id ? parseInt(id, 10) : null;
  const essayId =
    numericId !== null && !Number.isNaN(numericId) && numericId > 0
      ? numericId
      : null;

  const { data: report, isLoading, error } = useEssayReport(essayId);
  const overrideMutation = useOverrideVerdict();

  const [selectedCitationId, setSelectedCitationId] = useState<string | null>(null);
  const [filterLabel, setFilterLabel] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [workspaceMode, setWorkspaceMode] = useState<'debugger' | 'graph'>('debugger');
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [lockedFeatureName, setLockedFeatureName] = useState<string>('');
  const [remediationOpen, setRemediationOpen] = useState(false);
  const [customRevisionDiff, setCustomRevisionDiff] = useState<RevisionDiffData | null>(null);
  const [revisionExpanded, setRevisionExpanded] = useState(false);
  const [loadingRevisionDiff, setLoadingRevisionDiff] = useState(false);

  useEffect(() => {
    setCustomRevisionDiff(null);
    setRevisionExpanded(false);
  }, [essayId]);

  const handleCompareRevisionChange = async (targetPrevId: number) => {
    if (!essayId || !targetPrevId) return;
    setLoadingRevisionDiff(true);
    try {
      const diff = await api.getRevisionDiff(essayId, targetPrevId);
      setCustomRevisionDiff(diff);
    } catch {
      // keep existing diff
    } finally {
      setLoadingRevisionDiff(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedCitationId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const errorMessage =
    essayId === null
      ? t('essay.invalidEssayId')
      : error
        ? error instanceof Error
          ? error.message
          : t('essay.failedLoadReport')
        : null;

  const enrichedItems = useMemo(() => {
    if (!report) return [];
    return (report.verdicts ?? []).map((v, idx) =>
      enrichVerdictItem(
        v,
        idx,
        report.references ?? [],
        report.extracted_citations ?? [],
        lang
      )
    );
  }, [report, lang]);

  const filteredItems = useMemo(() => {
    return enrichedItems.filter((item) => {
      if (filterLabel !== 'all') {
        if (filterLabel === 'unresolved') {
          if (
            item.verdict.label !== 'unresolved' &&
            item.verdict.label !== 'resource'
          ) {
            return false;
          }
        } else if (item.verdict.label !== filterLabel) {
          return false;
        }
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          item.citedMeta.title.toLowerCase().includes(q) ||
          item.citedMeta.authors.toLowerCase().includes(q) ||
          item.inText.toLowerCase().includes(q) ||
          item.verdict.citation_raw.toLowerCase().includes(q) ||
          item.marker.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [enrichedItems, filterLabel, searchQuery]);

  async function handleOverride(
    verdict: Verdict,
    req: Parameters<typeof api.overrideVerdict>[1]
  ) {
    const targetEssayId = report?.essay_id ?? essayId ?? 0;
    await overrideMutation.mutateAsync({
      essayId: targetEssayId,
      verdictId: verdict.citation_id,
      req,
    });
  }

  const renderFieldStatusBadge = (fieldInfo: {
    status: FieldStatus;
    label?: string;
  }) => {
    switch (fieldInfo.status) {
      case 'match':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            <Check className="h-3 w-3" /> {fieldInfo.label || '100% Match'}
          </span>
        );
      case 'partial':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            <AlertTriangle className="h-3 w-3" /> {fieldInfo.label || 'Partial'}
          </span>
        );
      case 'mismatch':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300 border border-red-200 dark:border-red-800">
            <XCircle className="h-3 w-3" /> {fieldInfo.label || 'Diff'}
          </span>
        );
      case 'missing':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
            — Missing
          </span>
        );
    }
  };

  if (errorMessage) {
    return (
      <Alert variant="destructive" className="card p-6">
        <AlertCircle className="h-5 w-5" />
        <AlertTitle className="font-medium">
          {t('common.error')}: {errorMessage}
        </AlertTitle>
        <AlertDescription>
          <Link
            to="/history"
            className="text-indigo-600 dark:text-indigo-400 hover:underline mt-2 inline-block"
          >
            {t('essay.backToReports')}
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  if (!report) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 text-indigo-600 dark:text-indigo-400 animate-spin" />
        <span className="ml-3 text-slate-600 dark:text-slate-400">
          {isLoading ? t('essay.loadingReport') : t('essay.waitingForAnalysis')}
        </span>
      </div>
    );
  }

  // Pick active citation item (defaulting to first academic issue or [1])
  const defaultItem =
    filteredItems.find(
      (i) =>
        i.verdict.label === 'metadata_error' ||
        i.verdict.label === 'suspected_hallucination'
    ) ||
    filteredItems[0] ||
    enrichedItems[0];

  const activeItem =
    filteredItems.find((i) => i.verdict.citation_id === selectedCitationId) ||
    enrichedItems.find((i) => i.verdict.citation_id === selectedCitationId) ||
    defaultItem;

  const counts = {
    all: enrichedItems.length,
    verified: enrichedItems.filter((i) => i.verdict.label === 'verified').length,
    metadata_error: enrichedItems.filter((i) => i.verdict.label === 'metadata_error')
      .length,
    suspected_hallucination: enrichedItems.filter(
      (i) => i.verdict.label === 'suspected_hallucination'
    ).length,
    unresolved: enrichedItems.filter(
      (i) => i.verdict.label === 'unresolved' || i.verdict.label === 'resource'
    ).length,
  };

  const linksOf = (c: { citation_links?: CitationLink[]; citation_link?: CitationLink }) =>
    c.citation_links?.length ? c.citation_links : c.citation_link ? [c.citation_link] : [];

  const activeRevisionDiff = customRevisionDiff ?? report.revision_diff ?? null;
  const isSandboxManuscript = Boolean(
    report.filename &&
      (/^citra_acl_sandbox/i.test(report.filename) || /acl_sandbox/i.test(report.filename)),
  );
  const shouldShowRevisionDiff = Boolean(
    !isSandboxManuscript &&
      activeRevisionDiff?.has_previous_revision &&
      (customRevisionDiff !== null || activeRevisionDiff.is_same_manuscript_family !== false),
  );
  const sameFamilyRevisions = (activeRevisionDiff?.available_revisions ?? []).filter(
    (rev) => rev.is_same_stem !== false && !/acl_sandbox/i.test(rev.filename),
  );
  const docDiag = report.document_diagnostics;
  const isScannedPdfDetected = Boolean(
    docDiag?.is_scanned_pdf ||
      (!report.filename.toLowerCase().endsWith('.docx') &&
        report.num_pages > 0 &&
        report.verdicts.length === 0 &&
        (report.extracted_citations?.length ?? 0) === 0),
  );

  return (
    <div className="space-y-6 pb-10">
      {/* Top Breadcrumb, Filename & Export Buttons */}
      <EssayHeader
        essayId={report.essay_id}
        filename={report.filename}
        numPages={report.num_pages}
        numCitations={report.num_citations}
        styleName={report.style_profile?.style}
      />

      {/* P3 Feature #4: Scanned / Image-Only PDF Diagnostic Guardrail Banner */}
      {isScannedPdfDetected && (
        <div
          data-testid="scanned-pdf-guardrail-banner"
          className="rounded-2xl border-2 border-amber-400/80 dark:border-amber-600/80 bg-gradient-to-r from-amber-50 via-orange-50/70 to-amber-50 dark:from-amber-950/70 dark:via-slate-900 dark:to-amber-950/60 p-5 shadow-md"
        >
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="h-11 w-11 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0 mt-0.5">
                <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-md text-[11px] font-mono font-bold bg-amber-600 text-white uppercase tracking-wider">
                    SCANNED_PDF_DETECTED
                  </span>
                  <h3 className="text-sm sm:text-base font-display font-bold text-amber-950 dark:text-amber-100">
                    {lang === 'vi'
                      ? 'Cảnh báo: Phát hiện Tài liệu PDF dạng Ảnh quét (Thiếu lớp văn bản Text Layer)'
                      : 'Guardrail Alert: Scanned / Image-Only PDF Detected (Missing Digital Text Layer)'}
                  </h3>
                </div>
                <p className="text-xs sm:text-sm text-amber-900/90 dark:text-amber-200/90 leading-relaxed max-w-3xl">
                  {docDiag?.warning_message ||
                    (lang === 'vi'
                      ? 'Tài liệu PDF này được tạo từ máy scan hoặc ảnh chụp trang giấy nên không chứa lớp ký tự số hóa (Text Layer) để GROBID và PyMuPDF bóc tách trích dẫn. Vui lòng chuyển đổi qua OCR hoặc tải lên bản gốc Word (.docx) / PDF xuất trực tiếp từ Word hoặc LaTeX.'
                      : 'This PDF appears to be scanned from images without an extractable text layer. Please run OCR or upload the native .docx / digital PDF exported from Word or LaTeX.')}
                </p>
                <div className="flex flex-wrap items-center gap-3 pt-1 text-xs font-mono text-amber-800 dark:text-amber-300">
                  <span>
                    • {lang === 'vi' ? 'Số trang thiếu Text Layer' : 'Scanned pages'}:{' '}
                    <strong>
                      {docDiag?.scanned_pages_count ?? report.num_pages}/{report.num_pages}
                    </strong>
                  </span>
                  {typeof docDiag?.avg_chars_per_page === 'number' && docDiag.avg_chars_per_page >= 0 && (
                    <span>
                      • {lang === 'vi' ? 'Mật độ ký tự trung bình' : 'Avg extractable chars/page'}:{' '}
                      <strong>{docDiag.avg_chars_per_page} chars/page</strong>
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link
                to="/upload"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-mono font-semibold bg-amber-600 hover:bg-amber-700 text-white shadow-xs transition-colors"
              >
                <ArrowUpRight className="h-4 w-4" />
                {lang === 'vi' ? 'Tải lên bản .DOCX / PDF số hóa' : 'Upload Native .DOCX / Digital PDF'}
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* P3 Feature #3: Revision Diff / Version Progress Tracker (v1 -> v2) */}
      {shouldShowRevisionDiff && activeRevisionDiff && (
        <div
          data-testid="revision-diff-banner"
          className="rounded-2xl border border-indigo-200/90 dark:border-indigo-800/80 bg-gradient-to-r from-indigo-50/90 via-white to-emerald-50/70 dark:from-indigo-950/50 dark:via-slate-900 dark:to-emerald-950/30 p-4 sm:p-5 shadow-xs overflow-hidden"
        >
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 min-w-0 max-w-full">
            <div className="space-y-1.5 min-w-0 max-w-full">
              <div className="flex flex-wrap items-center gap-2 min-w-0 max-w-full">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-indigo-600 text-white">
                  <GitBranch className="h-3 w-3 shrink-0" />
                  {lang === 'vi' ? 'THEO DÕI TIẾN BỘ QUA CÁC LẦN NỘP (v1 → v2)' : 'REVISION PROGRESS TRACKER (v1 → v2)'}
                </span>
                <span className="text-xs font-mono text-slate-600 dark:text-slate-300 break-words [overflow-wrap:anywhere]">
                  {lang === 'vi' ? 'So sánh với:' : 'Compared against:'}{' '}
                  <strong className="text-slate-900 dark:text-white">
                    #{activeRevisionDiff.previous_essay_id} — {activeRevisionDiff.previous_filename}
                  </strong>
                </span>
                {sameFamilyRevisions.length > 1 && (
                    <select
                      data-testid="revision-compare-select"
                      aria-label="Select previous revision to compare"
                      value={activeRevisionDiff.previous_essay_id ?? ''}
                      disabled={loadingRevisionDiff}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (val) void handleCompareRevisionChange(val);
                      }}
                      className="w-full sm:w-auto max-w-full sm:max-w-[320px] min-w-0 truncate text-xs font-mono px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                    >
                      {sameFamilyRevisions.map((rev) => (
                        <option key={rev.essay_id} value={rev.essay_id}>
                          #{rev.essay_id}{' '}
                          {rev.filename.length > 18 ? `${rev.filename.slice(0, 16)}...` : rev.filename}{' '}
                          (CIS {rev.cis_score.toFixed(1)}%)
                        </option>
                      ))}
                    </select>
                  )}
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                {/* CIS Delta Pill */}
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xs">
                  <span className="text-xs font-mono text-slate-500 dark:text-slate-400">CIS:</span>
                  <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-300">
                    {(activeRevisionDiff.cis_before ?? 0).toFixed(1)}%
                  </span>
                  <span className="text-slate-400">→</span>
                  <span className="text-sm font-mono font-bold text-indigo-600 dark:text-indigo-400">
                    {(activeRevisionDiff.cis_after ?? report.cis.score).toFixed(1)}%
                  </span>
                  <span
                    data-testid="revision-cis-delta-badge"
                    className={`px-2 py-0.5 rounded-md text-xs font-mono font-bold ${
                      (activeRevisionDiff.cis_delta ?? 0) >= 0
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                    }`}
                  >
                    {(activeRevisionDiff.cis_delta ?? 0) >= 0
                      ? `+${(activeRevisionDiff.cis_delta ?? 0).toFixed(1)}%`
                      : `${(activeRevisionDiff.cis_delta ?? 0).toFixed(1)}%`}
                  </span>
                </div>

                {/* Resolved Issues Pill */}
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50/90 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-xs font-mono text-emerald-800 dark:text-emerald-300">
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  <span>
                    {lang === 'vi' ? 'Đã khắc phục:' : 'Resolved Issues:'}{' '}
                    <strong>{activeRevisionDiff.resolved_issues_count ?? 0}</strong>
                  </span>
                </div>

                {/* Metadata Error Before -> After */}
                {activeRevisionDiff.counts_before && activeRevisionDiff.counts_after && (
                  <>
                    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-700 dark:text-slate-300">
                      <span>{lang === 'vi' ? 'Lỗi Metadata:' : 'Metadata Errors:'}</span>
                      <strong>{activeRevisionDiff.counts_before.metadata_error}</strong>
                      <span>→</span>
                      <strong className="text-emerald-600 dark:text-emerald-400">
                        {activeRevisionDiff.counts_after.metadata_error}
                      </strong>
                    </div>
                    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-700 dark:text-slate-300">
                      <span>{lang === 'vi' ? 'Nghi vấn Bịa đặt:' : 'Hallucinations:'}</span>
                      <strong>{activeRevisionDiff.counts_before.suspected_hallucination}</strong>
                      <span>→</span>
                      <strong className="text-emerald-600 dark:text-emerald-400">
                        {activeRevisionDiff.counts_after.suspected_hallucination}
                      </strong>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                data-testid="revision-diff-details-btn"
                onClick={() => setRevisionExpanded((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-mono font-semibold bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 transition-colors"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {revisionExpanded
                  ? lang === 'vi'
                    ? 'Thu gọn Chi tiết Tiến bộ'
                    : 'Hide Revision Diff'
                  : lang === 'vi'
                    ? 'Xem Chi tiết Thay đổi (v1 → v2)'
                    : 'View Detailed Changes (v1 → v2)'}
              </button>
              <Link
                to={`/verification/report/${activeRevisionDiff.previous_essay_id}`}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-mono font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-indigo-600 transition-colors"
              >
                {lang === 'vi' ? 'Mở bản cũ' : 'Open v1'}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          {revisionExpanded && (
            <div
              data-testid="revision-diff-details-panel"
              className="mt-4 pt-4 border-t border-indigo-200/70 dark:border-indigo-800/60 space-y-3"
            >
              {activeRevisionDiff.citation_changes && activeRevisionDiff.citation_changes.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-64 overflow-y-auto pr-1">
                  {activeRevisionDiff.citation_changes.map((chg, idx) => {
                    const isGood =
                      chg.transition === 'fixed' ||
                      chg.transition === 'removed_hallucination' ||
                      chg.transition === 'fixed_and_reformatted';
                    return (
                      <div
                        key={idx}
                        className={`p-3 rounded-xl border text-xs flex flex-col gap-1 ${
                          isGood
                            ? 'bg-emerald-50/70 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/70'
                            : 'bg-amber-50/70 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/70'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 font-mono font-bold">
                          <span
                            className={
                              isGood
                                ? 'text-emerald-700 dark:text-emerald-300'
                                : 'text-amber-700 dark:text-amber-300'
                            }
                          >
                            {chg.transition === 'removed_hallucination'
                              ? lang === 'vi'
                                ? '✓ ĐÃ LOẠI BỎ NGUỒN BỊA ĐẶT'
                                : '✓ REMOVED HALLUCINATION'
                              : isGood
                                ? lang === 'vi'
                                  ? '✓ ĐÃ SỬA LỖI THÀNH CÔNG'
                                  : '✓ REPAIRED TO VERIFIED'
                                : lang === 'vi'
                                  ? '⚠ CẦN KIỂM TRA THÊM'
                                  : '⚠ REQUIRES ATTENTION'}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-white/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                            {chg.before_label.toUpperCase()} → {chg.after_label.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-slate-700 dark:text-slate-300 line-clamp-2 font-mono text-[11px]">
                          {chg.citation_raw}
                        </p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs font-mono text-slate-600 dark:text-slate-400">
                  {lang === 'vi'
                    ? `Đã đối chiếu tự động giữa #${activeRevisionDiff.previous_essay_id} (CIS ${(activeRevisionDiff.cis_before ?? 0).toFixed(1)}%) và #${activeRevisionDiff.current_essay_id} (CIS ${(activeRevisionDiff.cis_after ?? 0).toFixed(1)}%).`
                    : `Automatically compared #${activeRevisionDiff.previous_essay_id} and #${activeRevisionDiff.current_essay_id}.`}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Quick Diagnostic Sub-Pages Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <EssayActionBar essayId={id ?? ''} />
        <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
          Citation Integrity Score (CIS):{' '}
          <strong className="text-indigo-600 dark:text-indigo-400">
            {report.cis.score.toFixed(1)}%
          </strong>{' '}
          · {report.verdicts.length} citations
        </div>
      </div>

      {/* ============================================================
          Interactive Citation Debugger IDE (Real Evaluation Engine)
          ============================================================ */}
      <section className="pt-1">
        {/* IDE Window Container */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950 shadow-xl overflow-hidden">
          {/* Top Window Chrome Bar */}
          <div className="px-4 sm:px-6 py-3.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-[200px] flex-1">
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="w-3 h-3 rounded-full bg-red-400/80 inline-block" />
                <span className="w-3 h-3 rounded-full bg-amber-400/80 inline-block" />
                <span className="w-3 h-3 rounded-full bg-emerald-400/80 inline-block" />
              </div>
              <Separator orientation="vertical" className="h-4 shrink-0" />
              <div className="flex items-center gap-2 font-mono text-xs text-slate-700 dark:text-slate-300 min-w-0 flex-1">
                <FileFormatIcon filename={report.filename} size="xs" />
                <span className="font-semibold truncate" title={report.filename}>
                  {report.filename}
                </span>
                <span className="hidden 2xl:inline text-slate-400 shrink-0">
                  ({report.num_pages} pages · {report.verdicts.length} citations)
                </span>
              </div>
            </div>

            {/* Right Status Bar & Workspace Mode Switcher in Chrome */}
            <div className="flex items-center gap-2 flex-wrap min-w-0 max-w-full">
              <div
                role="group"
                aria-label="Workspace View Mode"
                className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700"
              >
                <button
                  type="button"
                  data-testid="mode-debugger-btn"
                  onClick={() => setWorkspaceMode('debugger')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold transition-all ${
                    workspaceMode === 'debugger'
                      ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-2xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {lang === 'vi' ? 'Split-Pane IDE' : 'Split-Pane IDE'}
                </button>
                <button
                  type="button"
                  data-testid="mode-graph-btn"
                  onClick={() => {
                    if (!canViewDeepTrace) {
                      setLockedFeatureName(
                        lang === 'vi'
                          ? 'Đồ thị Mạng lưới Trích dẫn & Bằng chứng (Citation & Evidence Graph)'
                          : 'Interactive Citation & Evidence Network Graph'
                      );
                      setUpgradeOpen(true);
                      return;
                    }
                    setWorkspaceMode('graph');
                  }}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold transition-all ${
                    workspaceMode === 'graph'
                      ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-2xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <GitBranch className="h-3 w-3 text-violet-500" />
                  <span>{lang === 'vi' ? 'Đồ thị Trích dẫn' : 'Citation Graph'}</span>
                  {!canViewDeepTrace && (
                    <span className="ml-0.5 inline-flex items-center gap-0.5 px-1 py-0.2 rounded bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 text-[9px] font-mono font-bold">
                      <Lock className="h-2.5 w-2.5 text-amber-500" />
                      PRO
                    </span>
                  )}
                </button>
              </div>

              <button
                type="button"
                data-testid="open-remediation-studio-btn"
                onClick={() => {
                  if (!canViewDeepTrace) {
                    setLockedFeatureName(
                      lang === 'vi'
                        ? '1-Click Chuẩn hóa & Sửa lỗi Danh mục Tài liệu Tham khảo (BibTeX / RIS / APA / IEEE / TDTU)'
                        : '1-Click Bibliography Auto-Remediation & Export Studio (BibTeX / RIS / APA / IEEE / TDTU)'
                    );
                    setUpgradeOpen(true);
                    return;
                  }
                  setRemediationOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white text-[11px] font-mono font-semibold shadow-2xs transition-all"
              >
                <Sparkles className="h-3.5 w-3.5 text-amber-300" />
                <span>{lang === 'vi' ? '1-Click Auto-Fix & BibTeX' : '1-Click Auto-Fix & BibTeX'}</span>
                {!canViewDeepTrace && (
                  <span className="ml-0.5 inline-flex items-center gap-0.5 px-1 py-0.2 rounded bg-white/20 text-white text-[9px] font-mono font-bold">
                    <Lock className="h-2.5 w-2.5 text-amber-300" />
                    PRO
                  </span>
                )}
              </button>

              <Badge
                variant="outline"
                className="font-mono text-[11px] bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700"
              >
                Style: {report.style_profile?.style || 'Academic'}
              </Badge>
              <div
                className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/90 border border-indigo-200/80 dark:border-indigo-800 text-xs font-mono"
                title="Verified Citations"
              >
                <span className="text-slate-500 dark:text-slate-400">VERIFIED:</span>
                <span className="font-bold text-indigo-700 dark:text-indigo-300">
                  {counts.verified} / {counts.all}
                </span>
              </div>
            </div>
          </div>

          {/* Empty State if PDF had zero citations */}
          {enrichedItems.length === 0 ? (
            <div className="p-12 text-center bg-white dark:bg-slate-950">
              <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                {lang === 'vi'
                  ? 'Không phát hiện trích dẫn nào trong tài liệu này.'
                  : 'No citations were extracted from this document.'}
              </p>
            </div>
          ) : workspaceMode === 'graph' && canViewDeepTrace ? (
            <CitationGraphView
              verdicts={report.verdicts}
              linkingSummary={report.linking_summary}
              onSelect={(v) => setSelectedCitationId(v.citation_id)}
              onOverride={canOverride ? handleOverride : undefined}
            />
          ) : (
            /* Split-Pane Debugger Body */
            <div className="grid lg:grid-cols-12">
              {/* Left Pane: Extracted Citations Queue (5 cols) */}
              <div className="lg:col-span-5 min-w-0 lg:relative lg:min-h-[680px] border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/50">
                <div className="lg:absolute lg:inset-0 p-4 sm:p-5 flex flex-col min-w-0">
                  {/* Search & Verdict Filter Chips */}
                  <div className="space-y-2 mb-3.5 shrink-0">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder={
                            lang === 'vi'
                              ? 'Tìm theo tiêu đề, tác giả, [số]...'
                              : 'Filter by title, author, [#]...'
                          }
                          className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                        />
                      </div>
                      <span className="text-[11px] font-mono text-indigo-600 dark:text-indigo-400 shrink-0">
                        {filteredItems.length} / {enrichedItems.length}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {(
                        [
                          ['all', `All (${counts.all})`],
                          ['verified', `✓ Verified (${counts.verified})`],
                          ['metadata_error', `⚠ Metadata (${counts.metadata_error})`],
                          [
                            'suspected_hallucination',
                            `✕ Hallucination (${counts.suspected_hallucination})`,
                          ],
                          ...(counts.unresolved > 0
                            ? [['unresolved', `— Other (${counts.unresolved})`]]
                            : []),
                        ] as const
                      ).map(([key, labelText]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setFilterLabel(key)}
                          className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold transition-colors border ${
                            filterLabel === key
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:border-slate-300'
                          }`}
                        >
                          {labelText}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Clickable Citation Cards List */}
                  <div
                    className="space-y-2.5 min-h-0 max-h-[440px] lg:max-h-none overflow-y-auto pr-1"
                    role="listbox"
                    aria-label="Extracted Citations"
                  >
                    {filteredItems.map((cit) => {
                      const isSelected =
                        activeItem?.verdict.citation_id === cit.verdict.citation_id;
                      const isFlaggedRed =
                        cit.verdict.label === 'suspected_hallucination' ||
                        cit.verdict.label === 'metadata_error';
                      return (
                        <button
                          key={cit.verdict.citation_id}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          data-verdict-label={cit.verdict.label}
                          onClick={() => setSelectedCitationId(cit.verdict.citation_id)}
                          className={`w-full text-left p-3.5 rounded-xl border transition-all duration-150 ${
                            isSelected
                              ? 'bg-indigo-50/70 dark:bg-indigo-950/50 border-indigo-500 dark:border-indigo-500 shadow-sm ring-1 ring-indigo-500/30'
                              : 'bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className={`font-mono text-xs font-bold px-2 py-0.5 rounded shrink-0 bg-slate-100 dark:bg-slate-800 ${
                                  isFlaggedRed
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-slate-800 dark:text-slate-200'
                                }`}
                              >
                                {cit.marker}
                              </span>
                              <span
                                className={`font-semibold text-sm truncate ${
                                  isFlaggedRed
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-slate-900 dark:text-white'
                                }`}
                              >
                                {cit.inText}
                              </span>
                            </div>
                            <span className="font-mono text-[11px] text-slate-400 shrink-0">
                              {cit.pageLabel}
                            </span>
                          </div>

                          <p
                            className={`text-xs line-clamp-1 mb-2.5 font-serif italic break-words [overflow-wrap:anywhere] ${
                              isFlaggedRed
                                ? 'text-red-600 dark:text-red-400 font-medium'
                                : 'text-slate-600 dark:text-slate-400'
                            }`}
                          >
                            &ldquo;{cit.citedMeta.title}&rdquo;
                          </p>

                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className={`verdict-badge ${cit.verdictBadgeClass} text-[10px] px-2.5 py-0.5 font-mono`}
                              >
                                {cit.verdictText}
                              </span>
                              {!isUser && (
                                <span
                                  className={`mapping-badge ${cit.mappingBadgeClass} text-[10px] px-2 py-0.5 font-mono`}
                                >
                                  {cit.mappingText}
                                </span>
                              )}
                              {cit.linkBadge && (
                                <span
                                  className={`rounded-md ${cit.linkBadge.badgeClass} text-[10px] px-2 py-0.5 font-mono`}
                                  title={cit.linkBadge.title}
                                >
                                  {cit.linkBadge.text}
                                </span>
                              )}
                            </div>
                            {!isUser && (
                              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                Conf:{' '}
                                <strong className="text-slate-800 dark:text-slate-200">
                                  {cit.confidencePct}%
                                </strong>
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Document Context Snippet Box */}
                  {activeItem && (
                    <div className="mt-4 shrink-0 p-3.5 rounded-xl border bg-slate-100/80 dark:bg-slate-900 border-slate-200/80 dark:border-slate-800">
                      <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400 mb-1.5">
                        <span
                          className={
                            activeItem.verdict.label === 'suspected_hallucination' ||
                            activeItem.verdict.label === 'metadata_error'
                              ? 'text-red-600 dark:text-red-400 font-bold'
                              : undefined
                          }
                        >
                          {isUser
                            ? lang === 'vi'
                              ? `NGỮ CẢNH TRONG BÀI (${activeItem.pageLabel})`
                              : `IN-TEXT CONTEXT (${activeItem.pageLabel})`
                            : `MANUSCRIPT CONTEXT (${activeItem.pageLabel})`}
                        </span>
                        {!isUser && <span>GROBID TEI-XML</span>}
                      </div>
                      <p className="document-content text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed line-clamp-4 break-words [overflow-wrap:anywhere]">
                        {activeItem.contextBefore}
                        <mark
                          className={`bg-transparent font-bold ${
                            activeItem.verdict.label === 'suspected_hallucination' ||
                            activeItem.verdict.label === 'metadata_error'
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-indigo-600 dark:text-indigo-400'
                          }`}
                        >
                          {activeItem.contextHighlight}
                        </mark>
                        {activeItem.contextAfter}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Pane: Reference Inspector & Symbolic Trace (7 cols) */}
              {activeItem && (
                <div className="lg:col-span-7 min-w-0 p-4 sm:p-6 bg-white dark:bg-slate-950 flex flex-col justify-between">
                  <div className="min-w-0">
                    {/* Inspector Header */}
                    <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
                      <div className="min-w-[200px] flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {selectedCitationId !== null ? (
                            <h4 className="font-mono text-xs text-slate-400">
                              Citation Detail
                            </h4>
                          ) : (
                            <span className="font-mono text-xs text-slate-400">
                              {isUser
                                ? lang === 'vi'
                                  ? 'CHI TIẾT TRÍCH DẪN'
                                  : 'CITATION DETAILS'
                                : 'INSPECTING REFERENCE'}
                            </span>
                          )}
                          <span
                            className={`font-mono text-xs font-bold ${
                              activeItem.verdict.label === 'suspected_hallucination' ||
                              activeItem.verdict.label === 'metadata_error'
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-indigo-600 dark:text-indigo-400'
                            }`}
                          >
                            {activeItem.marker}
                          </span>
                          {!isUser && linksOf(activeItem.verdict)[0]?.reference_id && (
                            <span className="font-mono text-[11px] text-slate-400">
                              · {linksOf(activeItem.verdict)[0]?.reference_id}
                            </span>
                          )}
                        </div>
                        <h3
                          className={`font-display text-lg sm:text-xl font-bold leading-snug break-words [overflow-wrap:anywhere] ${
                            activeItem.verdict.label === 'suspected_hallucination' ||
                            activeItem.verdict.label === 'metadata_error'
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-slate-900 dark:text-white'
                          }`}
                        >
                          {activeItem.citedMeta.title}
                        </h3>
                      </div>

                      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap min-w-0 max-w-full">
                        <span
                          className={`verdict-badge ${activeItem.verdictBadgeClass} text-xs px-3 py-1 font-mono`}
                        >
                          {activeItem.verdictText}
                        </span>
                        {!isUser && (
                          <span
                            className={`mapping-badge ${activeItem.mappingBadgeClass} text-xs px-2.5 py-1 font-mono`}
                          >
                            {activeItem.mappingText}
                          </span>
                        )}
                        {activeItem.linkBadge && (
                          <span
                            className={`rounded-md ${activeItem.linkBadge.badgeClass} text-xs px-2.5 py-1 font-mono`}
                            title={activeItem.linkBadge.title}
                          >
                            {activeItem.linkBadge.text}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Explanation Callout — Pro/Ultra, Teacher & Admin */}
                    {canViewDeepTrace && (
                      <div className="my-4 p-3.5 rounded-xl border flex items-start gap-3 bg-slate-50 dark:bg-slate-900 border-slate-200/80 dark:border-slate-800">
                        <Scale
                          className={`h-4 w-4 shrink-0 mt-0.5 ${
                            activeItem.verdict.label === 'suspected_hallucination' ||
                            activeItem.verdict.label === 'metadata_error'
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-indigo-600 dark:text-indigo-400'
                          }`}
                        />
                        <div
                          className={`text-xs sm:text-sm leading-relaxed ${
                            activeItem.verdict.label === 'suspected_hallucination' ||
                            activeItem.verdict.label === 'metadata_error'
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          <span className="font-semibold text-slate-900 dark:text-white mr-1.5">
                            {lang === 'vi'
                              ? 'Kết luận suy diễn:'
                              : 'Neuro-Symbolic Reasoning:'}
                          </span>
                          {activeItem.explanationText}
                        </div>
                      </div>
                    )}

                    {/* Inspector Tabs: Metadata Diff (All) | Symbolic Rules, Sources & Evidence Graph (Pro/Ultra/Teacher/Admin) */}
                    <Tabs defaultValue="diff" className="w-full mt-4">
                      <TabsList className="grid grid-cols-1 sm:grid-cols-2 w-full bg-slate-100 dark:bg-slate-900 p-1 rounded-xl h-auto gap-1">
                        <TabsTrigger value="diff" className="w-full text-xs font-mono py-2 sm:py-1.5 px-2.5 truncate">
                          {lang === 'vi' ? '1. Đối chiếu Metadata' : '1. Metadata Diff'}
                        </TabsTrigger>
                        {canViewDeepTrace ? (
                          <>
                            <TabsTrigger value="rules" className="w-full text-xs font-mono py-2 sm:py-1.5 px-2.5 truncate">
                              {lang === 'vi'
                                ? `2. Luật Suy diễn (${activeItem.rules.length})`
                                : `2. Symbolic Rules (${activeItem.rules.length})`}
                            </TabsTrigger>
                            <TabsTrigger value="sources" className="w-full text-xs font-mono py-2 sm:py-1.5 px-2.5 truncate">
                              {lang === 'vi' ? '3. Nguồn Truy hồi' : '3. Source Retrieval'}
                            </TabsTrigger>
                            <TabsTrigger
                              value="graph"
                              data-testid="inspector-tab-graph"
                              className="w-full text-xs font-mono py-2 sm:py-1.5 px-2.5 gap-1 truncate"
                            >
                              <GitBranch className="h-3 w-3 shrink-0 text-violet-500" />
                              <span className="truncate">{lang === 'vi' ? '4. Đồ thị Bằng chứng' : '4. Evidence Graph'}</span>
                            </TabsTrigger>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setLockedFeatureName(
                                  lang === 'vi'
                                    ? 'Tập Luật Suy diễn Hình thức (28 Symbolic Rules)'
                                    : '28 Deterministic Symbolic Rules Trace'
                                );
                                setUpgradeOpen(true);
                              }}
                              className="w-full inline-flex items-center justify-center gap-1 text-[11px] sm:text-xs font-mono py-1.5 px-2 rounded-lg text-slate-500 hover:text-indigo-600 cursor-pointer truncate"
                            >
                              <Lock className="h-3 w-3 shrink-0 text-amber-500" />
                              <span className="truncate">{lang === 'vi' ? '2. Luật Suy diễn' : '2. Symbolic Rules'}</span>
                              <span className="px-1 py-0.2 rounded bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 text-[9px] font-bold shrink-0">
                                PRO
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setLockedFeatureName(
                                  lang === 'vi'
                                    ? 'Đối chiếu Liên hợp 15+ CSDL Học thuật (Federated Source Retrieval)'
                                    : 'Federated 15+ Registry Source Retrieval'
                                );
                                setUpgradeOpen(true);
                              }}
                              className="w-full inline-flex items-center justify-center gap-1 text-[11px] sm:text-xs font-mono py-1.5 px-2 rounded-lg text-slate-500 hover:text-indigo-600 cursor-pointer truncate"
                            >
                              <Lock className="h-3 w-3 shrink-0 text-amber-500" />
                              <span className="truncate">{lang === 'vi' ? '3. Nguồn Truy hồi' : '3. Source Retrieval'}</span>
                              <span className="px-1 py-0.2 rounded bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 text-[9px] font-bold shrink-0">
                                PRO
                              </span>
                            </button>
                            <button
                              type="button"
                              data-testid="locked-evidence-graph-tab"
                              onClick={() => {
                                setLockedFeatureName(
                                  lang === 'vi'
                                    ? 'Đồ thị Bằng chứng Neuro-Symbolic (Evidence DAG)'
                                    : 'Interactive Neuro-Symbolic Evidence Graph'
                                );
                                setUpgradeOpen(true);
                              }}
                              className="w-full inline-flex items-center justify-center gap-1 text-[11px] sm:text-xs font-mono py-1.5 px-2 rounded-lg text-slate-500 hover:text-indigo-600 cursor-pointer truncate"
                            >
                              <Lock className="h-3 w-3 shrink-0 text-amber-500" />
                              <span className="truncate">{lang === 'vi' ? '4. Đồ thị Bằng chứng' : '4. Evidence Graph'}</span>
                              <span className="px-1 py-0.2 rounded bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 text-[9px] font-bold shrink-0">
                                PRO
                              </span>
                            </button>
                          </>
                        )}
                      </TabsList>

                      {/* TAB 1: Side-by-side Metadata Diff */}
                      <TabsContent value="diff" className="mt-4">
                        <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                          <table className="w-full block sm:table sm:table-fixed lg:block xl:table xl:table-fixed text-left border-collapse">
                            <thead className="hidden sm:table-header-group lg:hidden xl:table-header-group">
                              <tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-[11px] font-mono uppercase text-slate-500 dark:text-slate-400">
                                <th className="py-2.5 px-3 w-[84px]">Field</th>
                                <th className="py-2.5 px-3">Cited in Manuscript</th>
                                <th className="py-2.5 px-3">Canonical Retrieved</th>
                                <th className="py-2.5 px-3 w-[124px] text-right">Status</th>
                              </tr>
                            </thead>
                            <tbody className="block sm:table-row-group lg:block xl:table-row-group divide-y divide-slate-200/70 dark:divide-slate-800 text-xs">
                              {(
                                [
                                  ['Title', 'title'],
                                  ['Authors', 'authors'],
                                  ['Year', 'year'],
                                  ['Venue', 'venue'],
                                  ['DOI', 'doi'],
                                  ['URL / Link', 'url'],
                                ] as const
                              ).map(([label, key]) => (
                                <tr
                                  key={key}
                                  className="flex flex-col sm:table-row lg:flex lg:flex-col xl:table-row p-3 sm:p-0 lg:p-3 xl:p-0 gap-1.5 sm:gap-0 lg:gap-1.5 xl:gap-0 hover:bg-slate-50/70 dark:hover:bg-slate-900/40"
                                >
                                  <td className="py-0.5 sm:py-2.5 lg:py-0.5 xl:py-2.5 px-0 sm:px-3 lg:px-0 xl:px-3 font-mono font-semibold sm:font-medium lg:font-semibold xl:font-medium text-slate-500 dark:text-slate-400 align-top flex items-center justify-between sm:table-cell lg:flex xl:table-cell">
                                    <span>{label}</span>
                                    <span className="sm:hidden lg:inline-flex xl:hidden">
                                      {renderFieldStatusBadge(activeItem.fieldStatus[key])}
                                    </span>
                                  </td>
                                  <td className="py-0.5 sm:py-2.5 lg:py-0.5 xl:py-2.5 px-0 sm:px-3 lg:px-0 xl:px-3 text-slate-800 dark:text-slate-200 font-medium align-top break-words [overflow-wrap:anywhere] sm:table-cell lg:block xl:table-cell">
                                    <span className="sm:hidden lg:block xl:hidden block text-[10px] font-mono uppercase text-slate-400 mb-0.5">
                                      Cited in Manuscript
                                    </span>
                                    {key === 'url' &&
                                    activeItem.citedMeta.url !== '—' &&
                                    /^https?:\/\//i.test(activeItem.citedMeta.url) ? (
                                      <a
                                        href={activeItem.citedMeta.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 font-mono text-indigo-600 dark:text-indigo-400 hover:underline break-all"
                                      >
                                        <span>{activeItem.citedMeta.url}</span>
                                        <ExternalLink className="h-3 w-3 shrink-0" />
                                      </a>
                                    ) : (
                                      activeItem.citedMeta[key]
                                    )}
                                  </td>
                                  <td className="py-0.5 sm:py-2.5 lg:py-0.5 xl:py-2.5 px-0 sm:px-3 lg:px-0 xl:px-3 font-mono text-slate-600 dark:text-slate-300 align-top break-words [overflow-wrap:anywhere] sm:table-cell lg:block xl:table-cell">
                                    <span className="sm:hidden lg:block xl:hidden block text-[10px] font-mono uppercase text-slate-400 mb-0.5">
                                      Canonical Retrieved
                                    </span>
                                    {activeItem.retrievedMeta ? (
                                      key === 'doi' &&
                                      activeItem.retrievedMeta.doi !== '—' ? (
                                        <a
                                          href={
                                            activeItem.retrievedMeta.doi.startsWith('http')
                                              ? activeItem.retrievedMeta.doi
                                              : `https://doi.org/${activeItem.retrievedMeta.doi}`
                                          }
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline break-all"
                                        >
                                          <span>{activeItem.retrievedMeta.doi}</span>
                                          <ExternalLink className="h-3 w-3 shrink-0" />
                                        </a>
                                      ) : key === 'url' &&
                                        activeItem.retrievedMeta.url !== '—' &&
                                        /^https?:\/\//i.test(activeItem.retrievedMeta.url) ? (
                                        <a
                                          href={activeItem.retrievedMeta.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline break-all"
                                        >
                                          <span>{activeItem.retrievedMeta.url}</span>
                                          <ExternalLink className="h-3 w-3 shrink-0" />
                                        </a>
                                      ) : (
                                        activeItem.retrievedMeta[key]
                                      )
                                    ) : key === 'url' && activeItem.linkBadge ? (
                                      <span
                                        className={
                                          activeItem.linkBadge.status === 'alive' ||
                                          activeItem.linkBadge.status === 'restricted_alive'
                                            ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                            : 'text-red-500 dark:text-red-400 font-semibold'
                                        }
                                      >
                                        {activeItem.linkBadge.title}
                                      </span>
                                    ) : (
                                      <span className="text-red-500 dark:text-red-400 italic">
                                        No canonical record found
                                      </span>
                                    )}
                                  </td>
                                  <td className="hidden sm:table-cell lg:hidden xl:table-cell py-2.5 px-3 text-right whitespace-nowrap align-top">
                                    {renderFieldStatusBadge(activeItem.fieldStatus[key])}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Raw Bibliography Entry Box — Teacher & Admin only */}
                        {!isUser && (
                          <div className="mt-3 p-3 rounded-xl bg-slate-50/80 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800 text-xs">
                            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400 block mb-1">
                              {lang === 'vi'
                                ? 'Chuỗi Trích dẫn Gốc trong Tài liệu (Raw Extracted String)'
                                : 'Raw Extracted Reference String'}
                            </span>
                            <p className="font-mono text-slate-700 dark:text-slate-300 break-words leading-relaxed">
                              {activeItem.verdict.citation_raw}
                            </p>
                          </div>
                        )}
                      </TabsContent>

                      {/* TAB 2: Symbolic Rules Trace */}
                      <TabsContent value="rules" className="mt-4">
                        <div className="space-y-2.5">
                          {activeItem.rules.map((rule) => (
                            <div
                              key={rule.code}
                              className={`p-3.5 rounded-xl border font-mono text-xs ${
                                rule.status === 'passed'
                                  ? 'bg-emerald-50/50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/70'
                                  : rule.status === 'warning'
                                    ? 'bg-amber-50/50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/70'
                                    : 'bg-red-50/50 dark:bg-red-950/30 border-red-200 dark:border-red-800/70'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="px-2 py-0.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-bold text-[11px] shrink-0">
                                    {rule.code}
                                  </span>
                                  <span className="font-bold text-slate-900 dark:text-white truncate">
                                    {rule.name}
                                  </span>
                                </div>
                                <span
                                  className={`text-[11px] font-bold uppercase shrink-0 ${
                                    rule.status === 'passed'
                                      ? 'text-emerald-700 dark:text-emerald-400'
                                      : rule.status === 'warning'
                                        ? 'text-amber-700 dark:text-amber-400'
                                        : 'text-red-700 dark:text-red-400'
                                  }`}
                                >
                                  {rule.status === 'passed'
                                    ? '✓ TRIGGERED (PASS)'
                                    : rule.status === 'warning'
                                      ? '⚠ TRIGGERED (WARN)'
                                      : '✕ TRIGGERED (FAIL)'}
                                </span>
                              </div>
                              <p className="text-slate-600 dark:text-slate-300 text-[11px] pl-1">
                                {rule.condition}
                              </p>
                            </div>
                          ))}

                          {/* Neural Feature Vector & HTTP Link Telemetry Strip */}
                          {(activeItem.verdict.features || activeItem.linkBadge) && (
                            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 font-mono text-[11px] text-slate-600 dark:text-slate-400 flex flex-wrap items-center gap-x-4 gap-y-1">
                              <span className="font-semibold text-slate-800 dark:text-slate-200">
                                Neural &amp; Link Telemetry:
                              </span>
                              {activeItem.verdict.features?.title_sim_fuzzy !== undefined && (
                                <span>
                                  title_fuzzy=
                                  {activeItem.verdict.features.title_sim_fuzzy.toFixed(2)}
                                </span>
                              )}
                              {activeItem.verdict.features?.title_sim_semantic !== undefined &&
                                activeItem.verdict.features.title_sim_semantic > 0 && (
                                  <span>
                                    title_semantic=
                                    {activeItem.verdict.features.title_sim_semantic.toFixed(2)}
                                  </span>
                                )}
                              {activeItem.verdict.features?.author_jaccard !== undefined && (
                                <span>
                                  author_jaccard=
                                  {activeItem.verdict.features.author_jaccard.toFixed(2)}
                                </span>
                              )}
                              {activeItem.verdict.features?.year_distance !== undefined && (
                                <span>
                                  year_dist={activeItem.verdict.features.year_distance}
                                </span>
                              )}
                              {activeItem.verdict.features?.venue_sim !== undefined &&
                                activeItem.verdict.features.venue_sim > 0 && (
                                  <span>
                                    venue_sim=
                                    {activeItem.verdict.features.venue_sim.toFixed(2)}
                                  </span>
                                )}
                              {activeItem.verdict.features?.doi_exact_match !== undefined && (
                                <span>
                                  doi_match=
                                  {String(activeItem.verdict.features.doi_exact_match)}
                                </span>
                              )}
                              {activeItem.verdict.features?.source_consensus !== undefined && (
                                <span>
                                  consensus={activeItem.verdict.features.source_consensus}
                                </span>
                              )}
                              {activeItem.verdict.features?.content_alignment_score !==
                                undefined &&
                                activeItem.verdict.features.content_alignment_score > 0 && (
                                  <span>
                                    content_align=
                                    {activeItem.verdict.features.content_alignment_score.toFixed(
                                      2
                                    )}
                                    {activeItem.verdict.features.content_alignment_confidence
                                      ? ` (${activeItem.verdict.features.content_alignment_confidence})`
                                      : ''}
                                  </span>
                                )}
                              {activeItem.linkBadge && (
                                <span
                                  className={
                                    activeItem.linkBadge.status === 'alive' ||
                                    activeItem.linkBadge.status === 'restricted_alive'
                                      ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                                      : 'text-red-600 dark:text-red-400 font-semibold'
                                  }
                                >
                                  link_status={activeItem.linkBadge.text}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </TabsContent>

                      {/* TAB 3: Multi-Source Federation */}
                      <TabsContent value="sources" className="mt-4">
                        <div className="grid sm:grid-cols-2 gap-3">
                          {activeItem.sources.map((src) => (
                            <div
                              key={src.name}
                              className={`p-3.5 rounded-xl border flex items-center justify-between gap-2 ${
                                src.status === 'matched'
                                  ? 'bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/70'
                                  : src.status === 'partial'
                                    ? 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/70'
                                    : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                              }`}
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                                  {src.name}
                                </p>
                                <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                                  Sim: {src.score}
                                  {src.matchedFields.length > 0 &&
                                    ` · Fields: ${src.matchedFields.join(', ')}`}
                                </p>
                                {(() => {
                                  const rawUrl =
                                    src.url ||
                                    (src.doi?.startsWith('http')
                                      ? src.doi
                                      : src.doi
                                        ? `https://doi.org/${encodeURIComponent(src.doi)}`
                                        : '');
                                  const safeUrl = /^https?:\/\//i.test(rawUrl)
                                    ? rawUrl
                                    : null;
                                  if (!safeUrl) return null;
                                  return (
                                    <a
                                      href={safeUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-[11px] font-mono text-indigo-600 dark:text-indigo-400 hover:underline mt-1"
                                    >
                                      <span>
                                        {lang === 'vi' ? 'Mở bản ghi nguồn' : 'Open Source Record'}
                                      </span>
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  );
                                })()}
                              </div>
                              <span
                                className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded shrink-0 ${
                                  src.status === 'matched'
                                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
                                    : src.status === 'partial'
                                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
                                      : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                                }`}
                              >
                                {src.status === 'matched'
                                  ? 'MATCH'
                                  : src.status === 'partial'
                                    ? 'CANDIDATE'
                                    : 'NO HIT'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </TabsContent>

                      {/* TAB 4: Interactive Neuro-Symbolic Evidence Graph */}
                      <TabsContent value="graph" className="mt-4">
                        <EvidenceGraph verdict={activeItem.verdict} />
                      </TabsContent>
                    </Tabs>
                  </div>

                  {/* Inspector Footer Bar with Instructor Override & Full Logic Trace Link */}
                  {canViewDeepTrace && (
                    <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
                      {canOverride ? (
                        <div className="flex items-center gap-3 flex-wrap">
                          <div className="flex items-center gap-2">
                            <Shield className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                            <span>
                              {lang === 'vi'
                                ? 'Giảng viên có thể Ghi đè nhãn (Override Verdict) kèm lý do kiểm toán.'
                                : 'Instructors can Override Verdicts with mandatory audit logging.'}
                            </span>
                          </div>
                          <OverrideControls
                            verdict={activeItem.verdict}
                            onOverride={(req) => handleOverride(activeItem.verdict, req)}
                          />
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <GitBranch className="h-4 w-4 text-violet-500" />
                          <span>
                            {lang === 'vi'
                              ? 'Đã mở khóa toàn bộ Trace Neuro-Symbolic & Đồ thị Bằng chứng (Gói Pro / Ultra).'
                              : 'Full Neuro-Symbolic Trace & Evidence Graph unlocked (Pro / Ultra Plan).'}
                          </span>
                        </div>
                      )}

                      <Link
                        to={`/verification/report/${report.essay_id}/trace`}
                        className="inline-flex items-center gap-1 font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        <span>
                          {lang === 'vi' ? 'Mở toàn bộ Inspector' : 'Open Full Inspector'}
                        </span>
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <UpgradeModal
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        featureName={lockedFeatureName}
      />

      <BibliographyRemediationModal
        open={remediationOpen}
        essayId={report.essay_id}
        filename={report.filename}
        lang={lang}
        onClose={() => setRemediationOpen(false)}
      />
    </div>
  );
}
