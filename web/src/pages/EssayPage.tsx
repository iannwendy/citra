import { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, Link, useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  api,
  type Verdict,
  type Citation,
  type ValidationLabel,
  type RevisionDiffData,
} from '@/api/client';
import { EssayHeader } from './essay/EssayHeader';
import { EssayActionBar, type ReportWorkspaceMode } from './essay/EssayActionBar';
import { DocumentInspectorWorkspace } from './DocumentInspectorPage';
import { OrphanConsistencyWorkspace } from './OrphanDetectionPage';
import { OverrideControls } from '@/components/OverrideControls';
import { CitationGraphView, EvidenceGraph } from '@/components/CitationGraph';
import { UpgradeModal } from '@/components/UpgradeModal';
import { BibliographyRemediationModal } from '@/components/BibliographyRemediationModal';
import { RULE_DEFINITIONS } from '@/components/RuleInspector';
import { useEssayReport, useOverrideVerdict } from '@/hooks/useEssayReport';
import { useToast } from '@/contexts/ToastContext';
import { copyTextToClipboard } from '@/lib/clipboard';
import {
  extractObservedWebMeta,
  getCitationMarkerLabel,
  getSourceDisplayName,
  isLegalStatuteVerdict,
  isUrlResource,
} from '@/lib/verdictExplanation';
import { SYMBOLIC_RULES_COUNT } from '@/lib/productFacts';
import { useRole } from '@/hooks/useRole';
import {
  Loader2,
  AlertCircle,
  Scale,
  Check,
  AlertTriangle,
  XCircle,
  Shield,
  ArrowUpRight,
  Search,
  ExternalLink,
  GitBranch,
  Sparkles,
  FileText,
  Copy,
  Microscope,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  AccordionExpand,
  SymmetricChevron,
  SoftTextSwap,
  SubtleNumber,
  StreamingText,
  ScoreRing,
  DirectionalStageSlide,
  useSlidingPill,
} from '@/components/ui/transitions';

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
  notRouted?: boolean;
}

type CrossLingualFeaturesExt = NonNullable<Verdict['features']> & {
  cross_lingual_bridged_concepts?: string[];
  cross_lingual_alignment?: boolean | number;
  semantic_similarity?: number;
  cross_lingual_direction?: string;
};

const VI_DIACRITIC_RE =
  /[ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i;

function detectCrossLingualDirection(
  citedSample: string,
  canonicalSample: string,
  explicitDir?: string,
): 'VI → EN' | 'EN → VI' | 'VI ↔ EN' {
  if (explicitDir) {
    const up = explicitDir.toUpperCase();
    if (up.includes('VI') && up.includes('EN')) {
      if (up.indexOf('VI') < up.indexOf('EN') && (up.includes('->') || up.includes('→') || up.includes('_TO_'))) {
        return 'VI → EN';
      }
      if (up.indexOf('EN') < up.indexOf('VI') && (up.includes('->') || up.includes('→') || up.includes('_TO_'))) {
        return 'EN → VI';
      }
    }
  }
  const citedHasVi = VI_DIACRITIC_RE.test(citedSample);
  const canonicalHasVi = VI_DIACRITIC_RE.test(canonicalSample);
  if (citedHasVi && !canonicalHasVi && canonicalSample.trim().length > 0) {
    return 'VI → EN';
  }
  if (!citedHasVi && canonicalHasVi && citedSample.trim().length > 0) {
    return 'EN → VI';
  }
  return 'VI ↔ EN';
}

function formatRevisionVerdictLabel(
  rawLabel: string | null | undefined,
  lang: 'vi' | 'en',
): string {
  const norm = (rawLabel || '').trim().toLowerCase();
  switch (norm) {
    case 'verified':
      return lang === 'vi' ? 'Đã xác thực' : 'Verified';
    case 'metadata_error':
      return lang === 'vi' ? 'Lỗi Metadata' : 'Metadata Error';
    case 'suspected_hallucination':
      return lang === 'vi' ? 'Nghi vấn Bịa đặt' : 'Suspected Hallucination';
    case 'unresolved':
      return lang === 'vi' ? 'Chưa xác minh' : 'Unresolved';
    case 'resource':
      return lang === 'vi' ? 'Tài nguyên Web / Pháp quy' : 'URL / Legal Resource';
    case 'removed':
    case 'deleted':
      return lang === 'vi' ? 'Đã gỡ bỏ' : 'Removed';
    case 'added':
    case 'new':
      return lang === 'vi' ? 'Mới thêm' : 'Added';
    case '':
    case 'none':
      return '—';
    default:
      return norm
        .split('_')
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
        .join(' ');
  }
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
  'R-CROSS-LINGUAL-ALIGNMENT': {
    nameVi: 'Căn chỉnh ngữ nghĩa đa ngôn ngữ Việt ↔ Anh (Cross-Lingual Semantic Alignment)',
    nameEn: 'Vietnamese ↔ English Cross-Lingual Semantic Alignment',
    condition: 'IF cross_lingual_detected == TRUE AND content_alignment_score >= 0.35 THEN VERIFIED',
    status: 'passed',
  },
  'R-CROSS-LINGUAL-TITLE-MATCH': {
    nameVi: 'Tiêu đề bài báo nước ngoài bị dịch sang tiếng Việt (Thiếu tiêu đề gốc)',
    nameEn: 'Translated Foreign-Language Title Without Original Title (TDTU Guideline)',
    condition: 'IF cross_lingual_title_detected == TRUE AND cross_lingual_title_sim >= 0.58 THEN METADATA_ERROR (title)',
    status: 'warning',
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
  'R-INCOMPLETE-METADATA': {
    nameEn: 'Incomplete Bibliographic Reference (Missing Author / Year / Venue)',
    nameVi: 'Thiếu quy cách trích dẫn học thuật (Thiếu Tác giả / Năm / Nơi công bố)',
    condition: 'IF is_incomplete == TRUE AND has_resolvable_id == FALSE THEN METADATA_ERROR',
    status: 'warning',
  },
  'R-URL-CONTENT-MISMATCH': {
    nameEn: 'Cited Web Page Title / Metadata Mismatch',
    nameVi: 'Nội dung / Tiêu đề trang URL không khớp tiêu đề trích dẫn',
    condition: 'IF url_status == "alive" AND html_meta_title_sim < 0.20 THEN METADATA_ERROR',
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
  'R-VN-STANDARD-VERIFIED': {
    nameEn: 'Vietnamese National Technical Standard / Regulation (TCVN/QCVN) Verified',
    nameVi: 'Xác thực Tiêu chuẩn / Quy chuẩn Kỹ thuật Quốc gia Việt Nam (TCVN / QCVN)',
    condition: 'IF source == "tech_standard" AND standard_code IN ("TCVN", "QCVN") THEN VERIFIED',
    status: 'passed',
  },
  'R-VN-TEXTBOOK-VERIFIED': {
    nameEn: 'Vietnamese University Textbook / Monograph Registry Verified',
    nameVi: 'Xác thực Danh mục Giáo trình / Sách chuyên khảo Đại học Việt Nam',
    condition: 'IF source == "tech_standard" AND textbook_registry_hit == TRUE AND title_sim >= 0.85 THEN VERIFIED',
    status: 'passed',
  },
  'R-VN-LEGAL-FABRICATED': {
    nameEn: 'Fabricated Vietnamese Statutory Number or Issuing Authority',
    nameVi: 'Số hiệu hoặc Cơ quan ban hành Văn bản Pháp luật VN không tồn tại / bịa đặt',
    condition: 'IF statute_code_fabricated == TRUE OR authority_invalid == TRUE THEN SUSPECTED_HALLUCINATION',
    status: 'failed',
  },
  'R-LEGAL-STATUTE-VERIFIED': {
    nameEn: 'Official Legal Statute / Regulatory Document Verified',
    nameVi: 'Xác thực Văn bản Quy phạm Pháp luật chính thức',
    condition: 'IF legal_registry_match == TRUE THEN VERIFIED',
    status: 'passed',
  },
  'R-LEGAL-STATUTE-ERROR': {
    nameEn: 'Legal Statute Metadata Discrepancy or Superseded Regulation',
    nameVi: 'Sai lệch Metadata hoặc hiệu lực Văn bản Quy phạm Pháp luật',
    condition: 'IF legal_metadata_conflict == TRUE THEN METADATA_ERROR',
    status: 'warning',
  },
  'R-RATE-LIMITED-ABSTAIN': {
    nameEn: 'Scholarly API Rate-Limit Abstention (HTTP 429 Guard)',
    nameVi: 'Từ chối phán quyết tạm thời do giới hạn băng thông API (HTTP 429)',
    condition: 'IF http_429_rate_limited == TRUE AND candidates == 0 THEN UNRESOLVED',
    status: 'warning',
  },
  'R-VENUE-MISMATCH': {
    nameEn: 'Publication Venue / Journal Discrepancy',
    nameVi: 'Sai lệch Nơi công bố (Tạp chí / Hội nghị)',
    condition: 'IF title_sim >= 0.85 AND venue_sim < 0.40 THEN METADATA_ERROR',
    status: 'warning',
  },
  'R-TITLE-MISMATCH': {
    nameEn: 'Cited Title Discrepancy on Matched Author-Year Work',
    nameVi: 'Sai lệch Tiêu đề trên công trình khớp Tác giả & Năm',
    condition: 'IF author_jaccard >= 0.70 AND year_distance == 0 AND title_sim < 0.75 THEN METADATA_ERROR',
    status: 'warning',
  },
  'R-YEAR-MISMATCH': {
    nameEn: 'Publication Year Discrepancy Against Canonical Record',
    nameVi: 'Sai lệch Năm xuất bản so với bản ghi chuẩn',
    condition: 'IF title_sim >= 0.85 AND year_distance >= 1 THEN METADATA_ERROR',
    status: 'warning',
  },
  'R-DOI-METADATA-MISMATCH': {
    nameEn: 'Resolved DOI Metadata Discrepancy',
    nameVi: 'Mã DOI hợp lệ nhưng sai lệch Metadata công trình',
    condition: 'IF doi_exact_match == TRUE AND (title_sim < 0.80 OR year_distance > 1) THEN METADATA_ERROR',
    status: 'warning',
  },
  'R-DOI-CONFLICT': {
    nameEn: 'Cross-Registry DOI Metadata Conflict',
    nameVi: 'Xung đột Metadata của mã DOI giữa các CSDL',
    condition: 'IF doi_resolved == TRUE AND cross_source_conflict == TRUE THEN METADATA_ERROR',
    status: 'warning',
  },
  'R-CHIMERIC-DOI-MISMATCH': {
    nameEn: 'Chimeric / Spliced DOI Resolves to Different Publication',
    nameVi: 'Trích dẫn ghép nối (Chimeric): DOI trỏ tới một công trình hoàn toàn khác',
    condition: 'IF doi_resolved == TRUE AND title_sim_fuzzy < 0.35 AND author_jaccard < 0.25 THEN SUSPECTED_HALLUCINATION',
    status: 'failed',
  },
  'R-LOCAL_DB_METADATA_ERROR': {
    nameEn: 'Local Scholarly Library Match with Metadata Discrepancy',
    nameVi: 'Khớp CSDL học thuật nội bộ nhưng sai lệch trường Metadata',
    condition: 'IF local_fts5_hit == TRUE AND (year_distance > 0 OR author_jaccard < 0.60) THEN METADATA_ERROR',
    status: 'warning',
  },
  'R-NON-SCHOLARLY-RESOURCE': {
    nameEn: 'Non-Scholarly Web Resource or Technical Documentation',
    nameVi: 'Tài nguyên Web phi học thuật hoặc Tài liệu kỹ thuật trực tuyến',
    condition: 'IF is_web_documentation == TRUE AND has_scholarly_venue == FALSE THEN RESOURCE',
    status: 'passed',
  },
  'R-UNINDEXED-BOOK-OR-SOURCE': {
    nameEn: 'Unindexed Regional Monograph, Thesis, or Print Source',
    nameVi: 'Sách chuyên khảo, Luận văn hoặc Nguồn bản in địa phương chưa lập chỉ mục số',
    condition: 'IF print_monograph_pattern == TRUE AND live_candidates == 0 THEN UNRESOLVED',
    status: 'warning',
  },
  'R-SOFTWARE-PACKAGE-VERIFIED': {
    nameEn: 'Software Package Release Metadata Verified (PyPI / NPM / CRAN)',
    nameVi: 'Xác thực Metadata Gói phần mềm trên PyPI / NPM / CRAN',
    condition: 'IF source == "tech_standard" AND package_registry_match == TRUE THEN VERIFIED',
    status: 'passed',
  },
  'R-WIKIDATA-STANDARD-VERIFIED': {
    nameEn: 'Technical Standard or Manual Verified via Wikidata Knowledge Graph',
    nameVi: 'Xác thực Tiêu chuẩn kỹ thuật / Cẩm nang qua Wikidata Knowledge Graph',
    condition: 'IF source == "wikidata_opencitations" AND standard_entity_match == TRUE THEN VERIFIED',
    status: 'passed',
  },
  'R-OPENCITATIONS-VERIFIED': {
    nameEn: 'Citation Provenance Verified via OpenCitations COCI Index',
    nameVi: 'Xác thực phả hệ trích dẫn qua chỉ mục OpenCitations COCI',
    condition: 'IF opencitations_coci_hit == TRUE AND doi_exact_match == TRUE THEN VERIFIED',
    status: 'passed',
  },
  'R-API_EXHAUSTED': {
    nameEn: 'External API Quota Exhausted (Cache-Adjusted Confidence)',
    nameVi: 'Hết hạn mức API bên ngoài (Điều chỉnh độ tin cậy từ bộ nhớ đệm)',
    condition: 'IF external_api_quota_exhausted == TRUE THEN ADJUST_CONFIDENCE',
    status: 'warning',
  },
};

function stripUrlAccessBoilerplate(text: string): string {
  return text
    .replace(
      /\s*(?:\[Online\]\.?\s*)?(?:Available(?:\s+online)?\s+at|Available|Retrieved(?:\s+[^:]*?)?\s+from|Accessed(?:\s+on)?|Truy\s+cập(?:\s+(?:tại|ngày))?|Nguồn)\s*:?\s*<?https?:\/\/\S+>?.*$/gi,
      '',
    )
    .replace(/\s*<https?:\/\/[^>]+>/gi, '')
    .replace(/\b(?:https?:\/\/\S+|doi:\s*\S+|10\.\d{4,9}\/\S+)/gi, '')
    .replace(
      /\s*(?:\[?\s*(?:Accessed|Retrieved|Truy\s+cập)[^.\]]*\]?|\(?\s*(?:accessed|truy\s+cập)[^.)]*\)?)\s*$/gi,
      '',
    )
    .replace(/\s*(?:Available\s+at|Retrieved\s+from|Truy\s+cập\s+tại|Available)\s*:?\s*$/gi, '')
    .replace(/\s*\[Online\]\.?\s*$/gi, '')
    .trim();
}

function parseRawCitationMeta(
  rawText: string,
  options?: { missingAuthors?: boolean },
): MetadataFields {
  const cleaned = rawText
    .replace(/^\s*(?:\[\s*\d+[a-z]?\s*\]|\(\s*[a-z]\s*\)|\d+[a-z]\.)\s*/i, '')
    .replace(/^\s*\(\s*[a-z]\s*\)\s*/i, '')
    .trim();

  // Extract DOI if present
  const doiMatch = cleaned.match(/\b(10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+)\b/);
  const doi = doiMatch ? doiMatch[1].replace(/[.,;]+$/, '') : '—';

  const urlMatch = cleaned.match(/\bhttps?:\/\/[^\s<>")'\]]+/i);
  const rawUrl = urlMatch
    ? urlMatch[0].replace(/[.,;:)'"\u2019\u201d>]+$/, '')
    : '';
  const url = rawUrl || (doi !== '—' ? `https://doi.org/${doi}` : '—');

  // If the entire citation is just a bare URL
  if (/^<?https?:\/\/\S+>?$/i.test(cleaned)) {
    return {
      title: rawUrl || cleaned,
      authors: '—',
      year: '—',
      venue: '—',
      doi,
      url,
    };
  }

  const withoutUrls = stripUrlAccessBoilerplate(cleaned);

  // Extract Year
  const yearMatch = (withoutUrls || cleaned).match(/\b(19\d{2}|20\d{2})[a-z]?\b/);
  const year = yearMatch ? yearMatch[1] : '—';

  // Try quotes for title: "Title" or “Title”
  const quoteMatch = (withoutUrls || cleaned).match(/[“"]([^”"]{8,220})[”"]/);
  let title = quoteMatch ? quoteMatch[1].replace(/[.,]+$/, '').trim() : '';

  let authors = '';
  let venue = '';

  if (options?.missingAuthors) {
    // Do NOT hallucinate authors from a bare title when R-INCOMPLETE-METADATA explicitly flags missing authors
    const segments = (withoutUrls || cleaned)
      .split(/\.\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!title) {
      title = (segments[0] || withoutUrls || cleaned)
        .replace(/\(\s*(?:19|20)\d{2}[a-z]?\s*\)/g, '')
        .replace(/^[“"]|[”".,]+$/g, '')
        .trim();
    }
    if (segments.length >= 2) {
      venue = stripUrlAccessBoilerplate(segments.slice(1).join('. '))
        .replace(/\b(?:19|20)\d{2}[a-z]?\b/g, '')
        .replace(/^[,.;:()\s]+|[,.;:()\s]+$/g, '')
        .trim();
    }
  } else {
    // Try APA style: Authors (Year). Title. Venue.
    const apaMatch = (withoutUrls || cleaned).match(
      /^(.+?)\s*\((?:19|20)\d{2}[a-z]?\)\.\s*([^.]+)(?:\.\s*(.*))?$/,
    );
    if (apaMatch) {
      authors = apaMatch[1].trim().replace(/[.,]+$/, '');
      if (!title) title = stripUrlAccessBoilerplate(apaMatch[2]).replace(/[.,]+$/, '').trim();
      venue = stripUrlAccessBoilerplate(apaMatch[3] || '')
        .replace(/[.,]+$/, '')
        .trim();
    } else {
      // IEEE or general style: Authors, "Title," Venue, Year. OR Authors. Title. Venue, Year.
      const segments = (withoutUrls || cleaned)
        .split(/\.\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (segments.length >= 2) {
        authors = segments[0]
          .replace(/^(?:\[\s*\d+[a-z]?\s*\]|\(\s*[a-z]\s*\))\s*/i, '')
          .trim();
        if (!title) {
          title = stripUrlAccessBoilerplate(segments[1])
            .replace(/^[“"]|[”".,]+$/g, '')
            .trim();
        }
        if (segments.length >= 3) {
          venue = stripUrlAccessBoilerplate(segments.slice(2).join('. ')).trim();
        }
      } else {
        const commaParts = (withoutUrls || cleaned).split(/,\s+/);
        if (commaParts.length >= 2) {
          authors = commaParts[0].trim();
          if (!title) {
            title = stripUrlAccessBoilerplate(commaParts.slice(1).join(', '))
              .replace(/[.,]+$/, '')
              .slice(0, 140);
          }
        } else {
          title = (withoutUrls || cleaned).replace(/[.,]+$/, '').slice(0, 140);
        }
      }
    }
  }

  const cleanVenue = stripUrlAccessBoilerplate(venue)
    .replace(/^(?:,\s*)?(?:[^.()]*?\)\.\s*)+/, '')
    .replace(/^[,.;:)\s]+|[,.;:(\s]+$/g, '')
    .trim();

  return {
    title: title || (withoutUrls || cleaned).slice(0, 120) || '—',
    authors: authors || '—',
    year: year || '—',
    venue: cleanVenue || '—',
    doi,
    url,
  };
}

function normalizeWebText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\bhuffington\s+post\b/g, 'huffpost')
    .replace(/\bcomprehensive\s+r\s+archive\s+network\b/g, 'cran')
    .replace(/\bmozilla\s+developer\s+network\b/g, 'mdn')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function computeWebTextSim(a: string, b: string): number {
  if (!a || !b || a === '—' || b === '—') return 0;
  const na = normalizeWebText(a);
  const nb = normalizeWebText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1.0;
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) {
    return 0.88;
  }
  const stopWords = new Set(['the', 'of', 'and', 'in', 'on', 'at', 'for', 'to', 'a', 'an']);
  const tokA = na.split(' ').filter((t) => t.length >= 2 && !stopWords.has(t));
  const tokB = nb.split(' ').filter((t) => t.length >= 2 && !stopWords.has(t));
  if (tokA.length === 0 || tokB.length === 0) return 0;
  const setA = new Set(tokA);
  const setB = new Set(tokB);
  let overlap = 0;
  for (const t of setA) {
    if (setB.has(t)) overlap += 1;
  }
  const containment = overlap / Math.min(setA.size, setB.size);
  const jaccard = overlap / (setA.size + setB.size - overlap);
  const tokenScore = 0.65 * containment + 0.35 * jaccard;

  // Handle publisher/site rebrands & acronyms (e.g. "The Huffington Post" <-> "HuffPost",
  // "World Health Organization" <-> "WHO")
  if (tokA.length <= 5 && tokB.length <= 5) {
    const initialsA = tokA.map((t) => t[0]).join('');
    const initialsB = tokB.map((t) => t[0]).join('');
    const compactA = tokA.join('');
    const compactB = tokB.join('');
    if (
      (initialsA.length >= 2 && initialsA === compactB) ||
      (initialsB.length >= 2 && initialsB === compactA)
    ) {
      return Math.max(tokenScore, 0.9);
    }
    if (compactA.length >= 5 && compactB.length >= 5) {
      const makeBigrams = (s: string) => {
        const bg = new Set<string>();
        for (let i = 0; i < s.length - 1; i += 1) {
          bg.add(s.slice(i, i + 2));
        }
        return bg;
      };
      const bgA = makeBigrams(compactA);
      const bgB = makeBigrams(compactB);
      let bgOverlap = 0;
      for (const g of bgA) {
        if (bgB.has(g)) bgOverlap += 1;
      }
      const bgContainment = bgOverlap / Math.min(bgA.size, bgB.size);
      const bgDice = (2 * bgOverlap) / (bgA.size + bgB.size);
      if (bgContainment >= 0.8 && bgDice >= 0.55) {
        return Math.max(tokenScore, 0.65 * bgContainment + 0.35 * bgDice);
      }
    }
  }
  return tokenScore;
}

function computeWebAuthorSim(citedAuthors: string, obsAuthors: string): number {
  if (!citedAuthors || !obsAuthors || citedAuthors === '—' || obsAuthors === '—') return 0;
  const stop = new Set(['et', 'al', 'and', 'va', 'the', 'team', 'contributors']);
  const tokA = normalizeWebText(citedAuthors)
    .split(' ')
    .filter((t) => t.length >= 2 && !stop.has(t));
  const tokB = normalizeWebText(obsAuthors)
    .split(' ')
    .filter((t) => t.length >= 2 && !stop.has(t));
  if (tokA.length === 0 || tokB.length === 0) return 0;
  const setA = new Set(tokA);
  const setB = new Set(tokB);
  let overlap = 0;
  for (const t of setA) {
    if (setB.has(t)) overlap += 1;
  }
  if (overlap === 0) return 0;
  return overlap / Math.min(setA.size, setB.size);
}

const PREPRINT_VENUE_RE =
  /\b(?:arxiv|corr|biorxiv|medrxiv|ssrn|preprint|hal|zenodo|openreview)\b/i;

const BOGUS_VENUE_RE =
  /\b(?:unknown|imaginary|hypothetical|nonexistent|fictional|placeholder|bogus)\b/i;

function normalizeDoiForCompare(raw: string): string {
  if (!raw || raw === '—') return '';
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/\.+$/, '')
    .trim();
}

function areEquivalentCanonicalDois(d1: string, d2: string): boolean {
  if (!d1 || !d2) return false;
  if (d1 === d2) return true;
  const [shorter, longer] = d1.length <= d2.length ? [d1, d2] : [d2, d1];
  if (shorter.includes('(') && !shorter.includes(')') && longer.startsWith(`${shorter})`)) {
    return true;
  }
  const bertEquiv = new Set(['10.18653/v1/n19-1423', '10.48550/arxiv.1810.04805']);
  return bertEquiv.has(d1) && bertEquiv.has(d2);
}

function normalizeAcademicVenueTokens(venue: string): string[] {
  const expanded = venue
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\b(?:neurips|nips)\b/g, 'neural information processing systems')
    .replace(/\bcvpr\b/g, 'computer vision pattern recognition')
    .replace(/\biccv\b/g, 'computer vision')
    .replace(/\beccv\b/g, 'european computer vision')
    .replace(/\bicml\b/g, 'machine learning')
    .replace(/\biclr\b/g, 'learning representations')
    .replace(/\bnaacl(?:-hlt)?\b/g, 'north american chapter association computational linguistics')
    .replace(/\bemnlp\b/g, 'empirical methods natural language processing')
    .replace(/\bacl\b/g, 'association computational linguistics')
    .replace(/\bjmlr\b/g, 'machine learning')
    .replace(/\bjair\b/g, 'artificial intelligence')
    .replace(/\btpami\b/g, 'pattern analysis machine intelligence')
    .replace(/\bpnas\b/g, 'national academy sciences')
    .replace(/[^a-z0-9\s]/g, ' ');

  const boiler = new Set([
    'the', 'of', 'and', 'in', 'on', 'at', 'for', 'to', 'a', 'an', 'with',
    'journal', 'proceedings', 'proc', 'conference', 'conf', 'international',
    'int', 'annual', 'meeting', 'symposium', 'workshop', 'transactions',
    'trans', 'review', 'letters', 'advances', 'adv', 'research', 'ieee',
    'acm', 'cvf', 'springer', 'elsevier', 'wiley', 'findings', 'volume', 'vol',
  ]);
  return expanded
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !boiler.has(t) && !/^(?:19|20)\d{2}$/.test(t));
}

function computeAcademicVenueSim(v1: string, v2: string): number {
  if (!v1 || !v2 || v1 === '—' || v2 === '—') return 0;
  const clean1 = normalizeWebText(v1);
  const clean2 = normalizeWebText(v2);
  if (!clean1 || !clean2) return 0;
  if (clean1 === clean2) return 1.0;

  const tokA = normalizeAcademicVenueTokens(v1);
  const tokB = normalizeAcademicVenueTokens(v2);
  if (tokA.length === 0 || tokB.length === 0) {
    return computeWebTextSim(v1, v2);
  }
  const setA = new Set(tokA);
  const setB = new Set(tokB);
  let overlap = 0;
  for (const t of setA) {
    if (setB.has(t)) overlap += 1;
  }
  if (overlap === 0) return 0;
  const containment = overlap / Math.min(setA.size, setB.size);
  const jaccard = overlap / (setA.size + setB.size - overlap);
  return 0.65 * containment + 0.35 * jaccard;
}

function normalizeAuthorDisplay(name: string): string {
  if (!name || name === '—') return name;
  return name
    .replace(/\.{2,}/g, '.')
    .split(/\s+/)
    .map((word) => {
      if (!word) return word;
      if (/^[a-zà-ỹ]{2,}$/.test(word) && !/^(?:et|al|and|va|và|of|for|in|the)$/i.test(word)) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }
      return word;
    })
    .join(' ');
}

function formatShortInText(
  authors: string,
  year: string,
  rawText: string,
  authorList?: string[]
): string {
  if (authors && authors !== '—') {
    const firstAuthor = normalizeAuthorDisplay(
      authors.split(/,|&|\band\b/i)[0].trim()
    );
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
  const stripped = rawText
    .replace(/^\s*(?:\[\s*\d+[a-z]?\s*\]|\(\s*[a-z]\s*\))\s*/i, '')
    .trim();
  return (stripped || rawText).slice(0, 42);
}

export function getVerdictBadgeVisuals(
  label: ValidationLabel,
  triggeredRules?: string[],
  lang: 'vi' | 'en' = 'en'
): {
  text: string;
  badgeClass: string;
} {
  const isLegal = (triggeredRules ?? []).some((r) => r.includes('LEGAL'));
  const isIncompleteMeta = (triggeredRules ?? []).includes('R-INCOMPLETE-METADATA');
  switch (label) {
    case 'verified':
      return {
        text: '✓ VERIFIED',
        badgeClass:
          'verdict-badge-verified bg-emerald-100/90 text-emerald-800 border border-emerald-300 dark:bg-emerald-950/90 dark:text-emerald-300 dark:border-emerald-700 font-bold',
      };
    case 'metadata_error':
      return {
        text: isIncompleteMeta
          ? lang === 'vi'
            ? '⚠ Thiếu quy cách trích dẫn'
            : '⚠ Incomplete Reference'
          : isLegal
            ? '⚠ LEGAL_METADATA_ERROR'
            : '⚠ METADATA_ERROR',
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
  if (rawStatus && rawStatus !== 'unchecked') {
    return { status: rawStatus, code: rawCode };
  }
  const rules = verdict.triggered_rules ?? [];
  if (rules.includes('R-WAYBACK-ARCHIVED') || Boolean(verdict.archive_url)) {
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
  const isUrlContentMismatch = (verdict.triggered_rules ?? []).includes(
    'R-URL-CONTENT-MISMATCH',
  );

  switch (status) {
    case 'alive':
      if (isUrlContentMismatch) {
        return {
          status,
          text:
            lang === 'vi'
              ? `⚠ HTTP ${code || 200} · Sai nội dung trang`
              : `⚠ HTTP ${code || 200} · Wrong Page`,
          badgeClass:
            'bg-amber-50 text-amber-800 border border-amber-300 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800 font-semibold',
          title:
            lang === 'vi'
              ? `HTTP ${code || 200} phản hồi thành công nhưng trỏ tới trang web có tiêu đề khác với tài liệu trích dẫn`
              : `HTTP ${code || 200} resolved to a different page title than claimed in the citation`,
        };
      }
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
          'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/70 dark:text-red-300 dark:border-red-800 font-semibold',
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

function formatEssaySourceDisplay(
  sourceKey: string,
  lang: 'vi' | 'en',
  verdict: Verdict,
  ms?: Verdict['matched_sources'][number],
): string {
  const lower = (sourceKey || '').toLowerCase();
  if (lower === 'vn_legal_registry' && lang === 'en') {
    return 'VN Legal Registry';
  }
  return getSourceDisplayName(sourceKey, lang, {
    triggered_rules: verdict.triggered_rules,
    external_ids: ms?.external_ids,
    venue: ms?.venue,
    title: ms?.title,
  });
}

function buildLocalizedReasoning(verdict: Verdict, lang: 'vi' | 'en'): string {
  const isLegalStatute = isLegalStatuteVerdict(verdict);
  const hasViChars =
    /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(
      verdict.reasoning || '',
    );
  if (
    isLegalStatute &&
    verdict.reasoning &&
    ((lang === 'vi' && hasViChars) || (lang === 'en' && !hasViChars))
  ) {
    return verdict.override_note
      ? lang === 'vi'
        ? `[Ghi đè bởi Giảng viên: ${verdict.override_note}] — ${verdict.reasoning}`
        : `[Teacher Override: ${verdict.override_note}] — ${verdict.reasoning}`
      : verdict.reasoning;
  }

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

  const allNonWebSources = (verdict.matched_sources ?? []).filter((s) => {
    const low = (s.source || '').toLowerCase();
    return low !== 'web_html_meta' && low !== 'wayback_html_meta';
  });
  const topSource = allNonWebSources[0];
  const isCuratedPrimary =
    Boolean(topSource) &&
    ([
      'tech_standard',
      'vn_tech_standard',
      'vn_textbook_registry',
      'vn_legal_registry',
    ].includes((topSource.source || '').toLowerCase()) ||
      (verdict.triggered_rules ?? []).some((r) =>
        [
          'R-VN-STANDARD-VERIFIED',
          'R-VN-TEXTBOOK-VERIFIED',
          'R-VN-LEGAL-VERIFIED',
        ].includes(r),
      ));
  const effectiveSourcesList = isCuratedPrimary && topSource
    ? [topSource]
    : allNonWebSources.length > 0
      ? allNonWebSources
      : (verdict.matched_sources ?? []);

  const sources = [
    ...new Set(
      effectiveSourcesList.map((s) =>
        formatEssaySourceDisplay(s.source, lang, verdict, s),
      ),
    ),
  ];

  const primaryFieldSource =
    topSource && (topSource.matched_fields?.length ?? 0) > 0
      ? [topSource]
      : effectiveSourcesList;

  const rawMismatchedKeySet =
    verdict.label === 'verified'
      ? new Set<string>()
      : new Set(
          (verdict.mismatched_fields ?? []).flatMap((f) => {
            const k = f.toLowerCase();
            return k === 'author' || k === 'authors' ? ['author', 'authors'] : [k];
          })
        );

  const matchedFields = [
    ...new Set(
      primaryFieldSource.flatMap((s) =>
        (s.matched_fields ?? [])
          .filter((f) => !rawMismatchedKeySet.has(f.toLowerCase()))
          .map((f) =>
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
  const isUrlContentMismatch = (verdict.triggered_rules ?? []).includes(
    'R-URL-CONTENT-MISMATCH',
  );
  const observedWeb = extractObservedWebMeta(verdict);

  const hasScholarlyCandidate = verdict.features?.has_scholarly_candidate !== false;
  const hasAnyTitleSim =
    verdict.features?.title_sim_fuzzy !== undefined ||
    verdict.features?.title_sim_semantic !== undefined ||
    verdict.features?.cross_lingual_title_sim !== undefined;
  const titleSim =
    hasScholarlyCandidate && hasAnyTitleSim
      ? Math.max(
          verdict.features?.title_sim_fuzzy ?? 0,
          verdict.features?.title_sim_semantic ?? 0,
          verdict.features?.cross_lingual_title_sim ?? 0,
        )
      : undefined;
  const authorSim = hasScholarlyCandidate
    ? verdict.features?.author_jaccard
    : undefined;
  const htmlMetaSim = verdict.features?.html_meta_title_sim;

  if (lang === 'vi') {
    const telemetryParts: string[] = [];
    if (titleSim !== undefined) {
      telemetryParts.push(`độ tương đồng tiêu đề = ${titleSim.toFixed(2)}`);
    }
    if (typeof htmlMetaSim === 'number') {
      telemetryParts.push(`khớp tiêu đề trang HTML = ${htmlMetaSim.toFixed(2)}`);
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
      telemetryParts.push(
        isUrlContentMismatch
          ? `kiểm tra liên kết = HTTP ${urlCode || 200} (sai nội dung trang)`
          : `kiểm tra liên kết = HTTP ${urlCode || 200} OK`,
      );
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
      if (isLegalStatute) {
        const legalSrc =
          sources[0] || 'Cơ sở dữ liệu văn bản quy phạm pháp luật Việt Nam';
        mainText = `Văn bản quy phạm pháp luật đã được đối chiếu và xác thực qua ${legalSrc}. Mục này không tính điểm phạt vào chỉ số CIS.${telemetrySuffix}`;
      } else if (observedWeb?.title) {
        mainText = `Tài nguyên Web trực tuyến hợp lệ: đã trích xuất metadata trang HTML («${observedWeb.title}»${observedWeb.venue ? ` · ${observedWeb.venue}` : ''}). Mục này được phân loại là tài nguyên tham khảo trực tuyến và không tính điểm phạt vào chỉ số CIS.${telemetrySuffix}`;
      } else {
        mainText = `Phát hiện tài nguyên Web / API phi học thuật (${verdict.citation_raw}). Mục này được phân loại là đường dẫn tài nguyên tham khảo và không tính điểm phạt vào chỉ số CIS.${telemetrySuffix}`;
      }
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
      if (isUrlContentMismatch) {
        const obsTitleNoteVi = observedWeb?.title
          ? ` Trang web thực tế tại URL có tiêu đề: «${observedWeb.title}»${observedWeb.venue ? ` (${observedWeb.venue})` : ''}.`
          : '';
        mainText = `Đường dẫn URL phản hồi hợp lệ (HTTP ${urlCode || 200}), nhưng nội dung/tiêu đề trang web không khớp với tiêu đề tài liệu được trích dẫn.${obsTitleNoteVi} Vui lòng kiểm tra lại liên kết URL hoặc cập nhật đúng tiêu đề trang đích.${telemetrySuffix}`;
      } else if ((verdict.triggered_rules ?? []).includes('R-INCOMPLETE-METADATA')) {
        const missingStrVi =
          mismatchedFields.length > 0
            ? ` (thiếu ${mismatchedFields.join(', ')})`
            : '';
        mainText = `Thiếu quy cách trích dẫn học thuật${missingStrVi}: mục tham khảo chưa đủ thông tin định danh (tác giả, năm xuất bản, nơi công bố hoặc DOI/URL). Đây là lỗi trình bày trích dẫn chứ không phải nguồn do AI bịa đặt — vui lòng bổ sung đầy đủ thông tin.${telemetrySuffix}`;
      } else if (
        (verdict.triggered_rules ?? []).includes('R-CROSS-LINGUAL-TITLE-MATCH') ||
        verdict.features?.cross_lingual_title_detected
      ) {
        const xlSimPct = verdict.features?.cross_lingual_title_sim
          ? ` (${Math.round(verdict.features.cross_lingual_title_sim * 100)}% tương đồng ngữ nghĩa Việt ↔ Anh)`
          : '';
        mainText = `Tiêu đề tiếng Việt dịch thuật khớp ngữ nghĩa với công trình gốc tiếng Anh${xlSimPct}, nhưng theo quy định trích dẫn học thuật TDTU cần giữ nguyên tiêu đề gốc bằng tiếng nước ngoài (có thể kèm [Bản dịch tiếng Việt] trong ngoặc vuông).${telemetrySuffix}`;
      } else {
        const srcStr =
          sources.length > 0 ? ` trên ${sources.join(' và ')}` : '';
        const errFldStr =
          mismatchedFields.length > 0
            ? mismatchedFields.join(', ')
            : 'siêu dữ liệu (năm xuất bản / tiêu đề)';
        mainText = `Tìm thấy công trình học thuật tương ứng${srcStr}, nhưng phát hiện sai lệch ở trường: ${errFldStr}. Vui lòng đối chiếu và hiệu đính lại theo bản ghi gốc.${telemetrySuffix}`;
      }
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
  if (typeof htmlMetaSim === 'number') {
    telemetryPartsEn.push(`HTML page title similarity = ${htmlMetaSim.toFixed(2)}`);
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
    telemetryPartsEn.push(
      isUrlContentMismatch
        ? `link check = HTTP ${urlCode || 200} (wrong page content)`
        : `link check = HTTP ${urlCode || 200} OK`,
    );
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
    if (isLegalStatute) {
      const legalSrcEn = sources[0] || 'VN Legal Registry';
      mainTextEn = `Official statutory / legal document verified against ${legalSrcEn}. Excluded from the CIS penalty calculation.${telemetrySuffixEn}`;
    } else if (observedWeb?.title) {
      mainTextEn = `Verified live web resource: extracted HTML metadata (“${observedWeb.title}”${observedWeb.venue ? ` · ${observedWeb.venue}` : ''}). Classified as a web resource and excluded from the CIS penalty calculation.${telemetrySuffixEn}`;
    } else {
      mainTextEn = `Non-scholarly Web / API resource detected (${verdict.citation_raw}). Classified as a web resource and excluded from the CIS penalty calculation.${telemetrySuffixEn}`;
    }
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
    if (isUrlContentMismatch) {
      const obsTitleNoteEn = observedWeb?.title
        ? ` The actual web page at this URL is titled “${observedWeb.title}”${observedWeb.venue ? ` (${observedWeb.venue})` : ''}.`
        : '';
      mainTextEn = `The cited URL is reachable (HTTP ${urlCode || 200}), but the web page title and metadata do not match the claimed citation title.${obsTitleNoteEn} Please verify that the URL points to the intended resource.${telemetrySuffixEn}`;
    } else if ((verdict.triggered_rules ?? []).includes('R-INCOMPLETE-METADATA')) {
      const missingStrEn =
        mismatchedFields.length > 0
          ? ` (missing ${mismatchedFields.join(', ')})`
          : '';
      mainTextEn = `Incomplete bibliographic reference${missingStrEn}: this entry lacks required scholarly identifiers (author, publication year, academic venue, or DOI/URL). This reflects incomplete formatting rather than an AI-fabricated source — please complete the citation details.${telemetrySuffixEn}`;
    } else if (
      (verdict.triggered_rules ?? []).includes('R-CROSS-LINGUAL-TITLE-MATCH') ||
      verdict.features?.cross_lingual_title_detected
    ) {
      const xlSimPctEn = verdict.features?.cross_lingual_title_sim
        ? ` (${Math.round(verdict.features.cross_lingual_title_sim * 100)}% VI↔EN semantic match)`
        : '';
      mainTextEn = `Translated Vietnamese title semantically matches the canonical English publication${xlSimPctEn}, but TDTU academic citation rules require preserving the original foreign-language title (optionally followed by [Vietnamese translation] in brackets).${telemetrySuffixEn}`;
    } else {
      const srcStr = sources.length > 0 ? ` in ${sources.join(' and ')}` : '';
      const errFldStr =
        mismatchedFields.length > 0
          ? mismatchedFields.join(', ')
          : 'metadata fields (year / title)';
      mainTextEn = `Found a corresponding publication${srcStr}, but detected discrepancies in: ${errFldStr}. Please review against the canonical record.${telemetrySuffixEn}`;
    }
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
  const marker = getCitationMarkerLabel(verdict, index);

  const mismatchedFieldsSet =
    verdict.label === 'verified'
      ? new Set<string>()
      : new Set((verdict.mismatched_fields ?? []).map((f) => f.toLowerCase()));
  const isIncompleteMeta = (verdict.triggered_rules ?? []).includes(
    'R-INCOMPLETE-METADATA',
  );
  const isUrlContentMismatch = (verdict.triggered_rules ?? []).includes(
    'R-URL-CONTENT-MISMATCH',
  );
  const isLegalRule = isLegalStatuteVerdict(verdict);
  const missingAuthorsFlag =
    isIncompleteMeta &&
    (mismatchedFieldsSet.has('authors') || mismatchedFieldsSet.has('author'));

  const parsedFallback = parseRawCitationMeta(verdict.citation_raw, {
    missingAuthors: missingAuthorsFlag,
  });

  // Find corresponding Reference entry if available
  const refId = verdict.citation_link?.reference_id;
  let matchedRef: Citation | undefined;
  if (refId) {
    matchedRef = references.find((r) => r.reference_id === refId);
    if (!matchedRef && /^ref-0*\d+$/.test(refId)) {
      const idxNum = parseInt(refId.replace(/^ref-/, ''), 10);
      if (!Number.isNaN(idxNum) && idxNum >= 1 && idxNum <= references.length) {
        matchedRef = references[idxNum - 1];
      }
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
    verdict.cited_url ||
    verdict.features?.checked_url ||
    parsedFallback.url ||
    (citedDoi !== '—' ? `https://doi.org/${citedDoi}` : '—');

  const cleanedMatchedVenue = matchedRef?.venue
    ? stripUrlAccessBoilerplate(matchedRef.venue) || matchedRef.venue
    : '';

  const citedMeta: MetadataFields = {
    title: matchedRef?.title || parsedFallback.title || verdict.citation_raw,
    authors:
      missingAuthorsFlag && (!matchedRef?.authors || matchedRef.authors.length === 0)
        ? '—'
        : (matchedRef?.authors && matchedRef.authors.length > 0
            ? matchedRef.authors.map(normalizeAuthorDisplay).join(', ')
            : normalizeAuthorDisplay(parsedFallback.authors)) || '—',
    year:
      (matchedRef?.year ? String(matchedRef.year) : parsedFallback.year) || '—',
    venue: cleanedMatchedVenue || parsedFallback.venue || '—',
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

  // Separate scholarly/legal/standard sources from web_html_meta / wayback_html_meta
  const nonWebSources = (verdict.matched_sources ?? []).filter((s) => {
    const low = (s.source || '').toLowerCase();
    return low !== 'web_html_meta' && low !== 'wayback_html_meta';
  });
  const bestSource = nonWebSources.length > 0 ? nonWebSources[0] : null;
  const observedWeb = extractObservedWebMeta(verdict);

  const matchedFieldsSet = new Set(
    (bestSource?.matched_fields ?? []).map((f) => f.toLowerCase())
  );

  const validYearDistance =
    verdict.features?.year_distance !== undefined &&
    verdict.features.year_distance < 900 &&
    verdict.features?.has_scholarly_candidate !== false
      ? verdict.features.year_distance
      : undefined;

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
    validYearDistance !== undefined &&
    validYearDistance > 0 &&
    citedMeta.year !== '—'
  ) {
    const citedYrNum = parseInt(citedMeta.year, 10);
    if (!Number.isNaN(citedYrNum)) {
      inferredActualYear = `${citedYrNum - Math.round(validYearDistance)} (Δ=${validYearDistance}y)`;
    }
  }

  const hasCanonicalRecord =
    Boolean(bestSource) &&
    verdict.label !== 'suspected_hallucination' &&
    (bestSource?.confidence ?? verdict.confidence) >= 0.25;

  const isWebResourceMode =
    verdict.label === 'resource' && !isLegalRule && !hasCanonicalRecord;
  const useObservedWebMeta =
    !hasCanonicalRecord &&
    Boolean(observedWeb) &&
    (isWebResourceMode || isUrlContentMismatch);

  const undeclaredWebText =
    lang === 'vi'
      ? 'Trang web không khai báo thẻ này'
      : 'Not declared in page metadata';

  let retrievedMeta: MetadataFields | null = null;
  if (hasCanonicalRecord && bestSource) {
    const isVerifiedLike =
      verdict.label === 'verified' || (isLegalRule && verdict.label === 'resource');
    const sourceDisplay = formatEssaySourceDisplay(
      bestSource.source,
      lang,
      verdict,
      bestSource,
    );
    retrievedMeta = {
      title:
        bestSource.title ||
        ((matchedFieldsSet.has('title') || isVerifiedLike) &&
        !mismatchedFieldsSet.has('title')
          ? citedMeta.title
          : '—'),
      authors:
        bestSource.authors && bestSource.authors.length > 0
          ? bestSource.authors.join(', ')
          : matchedFieldsSet.has('authors') && !mismatchedFieldsSet.has('authors')
            ? citedMeta.authors
            : mismatchedFieldsSet.has('authors') || mismatchedFieldsSet.has('author')
              ? lang === 'vi'
                ? 'Khác danh sách tác giả gốc'
                : 'Author list discrepancy in source'
              : citedMeta.authors !== '—' && isVerifiedLike
                ? citedMeta.authors
                : '—',
      year: bestSource.year
        ? String(bestSource.year)
        : mismatchedFieldsSet.has('year')
          ? inferredActualYear ||
            (lang === 'vi' ? 'Lệch năm xuất bản' : 'Year mismatch in source')
          : matchedFieldsSet.has('year') || isVerifiedLike
            ? citedMeta.year
            : '—',
      venue:
        bestSource.venue ||
        ((matchedFieldsSet.has('venue') || isVerifiedLike) &&
        !mismatchedFieldsSet.has('venue')
          ? citedMeta.venue !== '—'
            ? citedMeta.venue
            : sourceDisplay
          : bestSource.source
            ? sourceDisplay
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
          : citedMeta.url !== '—' && isVerifiedLike
            ? citedMeta.url
            : '—'),
    };
  } else if (isLegalRule && verdict.label === 'resource' && mismatchedFieldsSet.size === 0) {
    // Format-verified statutory citation without external matched_sources row
    retrievedMeta = {
      title: citedMeta.title,
      authors: citedMeta.authors,
      year: citedMeta.year,
      venue:
        citedMeta.venue !== '—'
          ? citedMeta.venue
          : formatEssaySourceDisplay('vn_legal_registry', lang, verdict),
      doi: citedMeta.doi,
      url: citedMeta.url,
    };
  } else if (useObservedWebMeta && observedWeb) {
    retrievedMeta = {
      title: observedWeb.title || undeclaredWebText,
      authors:
        observedWeb.authors && observedWeb.authors.length > 0
          ? observedWeb.authors.join(', ')
          : undeclaredWebText,
      year: observedWeb.year ? String(observedWeb.year) : undeclaredWebText,
      venue: observedWeb.venue || undeclaredWebText,
      doi: observedWeb.doi || '—',
      url: observedWeb.url || (citedMeta.url !== '—' ? citedMeta.url : '—'),
    };
  }

  // Compute field-by-field status
  const hasExplicitTitleSim =
    verdict.features?.title_sim_fuzzy !== undefined ||
    verdict.features?.title_sim_semantic !== undefined ||
    verdict.features?.cross_lingual_title_sim !== undefined;
  const hasExplicitAuthorSim = verdict.features?.author_jaccard !== undefined;
  const explicitTitleSim = hasExplicitTitleSim
    ? Math.max(
        verdict.features?.title_sim_fuzzy ?? 0,
        verdict.features?.title_sim_semantic ?? 0,
        verdict.features?.cross_lingual_title_sim ?? 0,
      )
    : null;
  const titleSim =
    explicitTitleSim ?? (matchedFieldsSet.has('title') ? 1 : 0);
  const authorSim =
    verdict.features?.author_jaccard ??
    (matchedFieldsSet.has('authors') ? 1 : 0);

  const computeWebFieldStatus = (
    field: 'title' | 'authors' | 'year' | 'venue' | 'doi',
  ): { status: FieldStatus; label?: string } => {
    if (!observedWeb) {
      if (field === 'doi' && citedMeta.doi === '—') {
        return {
          status: 'missing',
          label: lang === 'vi' ? '— Thiếu' : '— Missing',
        };
      }
      return {
        status: 'missing',
        label: lang === 'vi' ? 'Tài nguyên Web' : 'Web Resource',
      };
    }

    if (field === 'title') {
      if (isUrlContentMismatch) {
        return { status: 'mismatch', label: lang === 'vi' ? 'Lệch' : 'Diff' };
      }
      if (!observedWeb.title) {
        return { status: 'missing', label: 'Web' };
      }
      if (/^https?:\/\//i.test(citedMeta.title.trim())) {
        return { status: 'match', label: lang === 'vi' ? 'Khớp' : 'Match' };
      }
      const tokenSim = computeWebTextSim(citedMeta.title, observedWeb.title);
      const bestSim =
        typeof verdict.features?.html_meta_title_sim === 'number'
          ? Math.max(tokenSim, verdict.features.html_meta_title_sim)
          : tokenSim;
      if (bestSim >= 0.65) {
        return { status: 'match', label: lang === 'vi' ? 'Khớp' : 'Match' };
      }
      if (bestSim >= 0.3) {
        return {
          status: 'partial',
          label: lang === 'vi' ? 'Khớp phần' : 'Partial',
        };
      }
      return { status: 'mismatch', label: lang === 'vi' ? 'Lệch' : 'Diff' };
    }

    if (field === 'authors') {
      if (!observedWeb.authors || observedWeb.authors.length === 0) {
        return { status: 'missing', label: 'Web' };
      }
      if (citedMeta.authors === '—') {
        return {
          status: 'partial',
          label: lang === 'vi' ? 'Đã trích xuất' : 'Retrieved',
        };
      }
      const aSim = computeWebAuthorSim(
        citedMeta.authors,
        observedWeb.authors.join(', '),
      );
      if (aSim >= 0.65) {
        return { status: 'match', label: lang === 'vi' ? 'Khớp' : 'Match' };
      }
      if (aSim >= 0.3) {
        return {
          status: 'partial',
          label: lang === 'vi' ? 'Khớp phần' : 'Partial',
        };
      }
      return { status: 'mismatch', label: lang === 'vi' ? 'Lệch' : 'Diff' };
    }

    if (field === 'year') {
      if (!observedWeb.year) {
        return { status: 'missing', label: 'Web' };
      }
      if (citedMeta.year === '—') {
        return {
          status: 'partial',
          label: lang === 'vi' ? 'Đã trích xuất' : 'Retrieved',
        };
      }
      const citedYr = parseInt(citedMeta.year, 10);
      const obsYr = parseInt(String(observedWeb.year), 10);
      if (
        !Number.isNaN(citedYr) &&
        !Number.isNaN(obsYr) &&
        Math.abs(citedYr - obsYr) <= 1
      ) {
        return { status: 'match', label: lang === 'vi' ? 'Khớp' : 'Match' };
      }
      return { status: 'mismatch', label: lang === 'vi' ? 'Lệch' : 'Diff' };
    }

    if (field === 'venue') {
      if (!observedWeb.venue) {
        return { status: 'missing', label: 'Web' };
      }
      if (citedMeta.venue === '—') {
        return {
          status: 'partial',
          label: lang === 'vi' ? 'Đã trích xuất' : 'Retrieved',
        };
      }
      const vSim = computeWebTextSim(citedMeta.venue, observedWeb.venue);
      if (vSim >= 0.65) {
        return { status: 'match', label: lang === 'vi' ? 'Khớp' : 'Match' };
      }
      if (vSim >= 0.3) {
        return {
          status: 'partial',
          label: lang === 'vi' ? 'Khớp phần' : 'Partial',
        };
      }
      return { status: 'mismatch', label: lang === 'vi' ? 'Lệch' : 'Diff' };
    }

    // field === 'doi'
    if (!observedWeb.doi) {
      return { status: 'missing', label: 'Web' };
    }
    if (citedMeta.doi === '—') {
      return {
        status: 'partial',
        label: lang === 'vi' ? 'Đã trích xuất' : 'Retrieved',
      };
    }
    return citedMeta.doi.toLowerCase() === observedWeb.doi.toLowerCase()
      ? { status: 'match', label: lang === 'vi' ? 'Khớp' : 'Match' }
      : { status: 'mismatch', label: lang === 'vi' ? 'Lệch' : 'Diff' };
  };

  const hasLegalMismatch = (verdict.triggered_rules ?? []).includes(
    'R-VN-LEGAL-MISMATCH',
  );

  const computeTitleStatus = (): { status: FieldStatus; label?: string } => {
    if (isUrlContentMismatch) {
      return { status: 'mismatch', label: lang === 'vi' ? 'Lệch' : 'Diff' };
    }
    if (isWebResourceMode || useObservedWebMeta) {
      return computeWebFieldStatus('title');
    }
    if (!retrievedMeta && isIncompleteMeta) {
      if (mismatchedFieldsSet.has('title') || citedMeta.title === '—') {
        return { status: 'partial', label: lang === 'vi' ? 'Thiếu' : 'Missing' };
      }
      return { status: 'missing', label: lang === 'vi' ? 'Đã ghi' : 'Provided' };
    }
    if (!retrievedMeta) return { status: 'mismatch', label: 'Diff' };
    if (isLegalRule && verdict.label === 'resource' && !mismatchedFieldsSet.has('title')) {
      return { status: 'match', label: '100% Match' };
    }
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
    if (isWebResourceMode || useObservedWebMeta) {
      return computeWebFieldStatus('authors');
    }
    if (!retrievedMeta && isIncompleteMeta) {
      if (
        mismatchedFieldsSet.has('authors') ||
        mismatchedFieldsSet.has('author') ||
        citedMeta.authors === '—'
      ) {
        return { status: 'partial', label: lang === 'vi' ? 'Thiếu' : 'Missing' };
      }
      return { status: 'missing', label: lang === 'vi' ? 'Đã ghi' : 'Provided' };
    }
    if (citedMeta.authors === '—') return { status: 'missing' };
    if (!retrievedMeta) return { status: 'mismatch', label: 'Diff' };
    if (
      isLegalRule &&
      verdict.label === 'resource' &&
      !mismatchedFieldsSet.has('authors') &&
      !mismatchedFieldsSet.has('author') &&
      !hasLegalMismatch
    ) {
      return { status: 'match', label: '100% Match' };
    }
    if (mismatchedFieldsSet.has('authors') || mismatchedFieldsSet.has('author')) {
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

  const hasDoiRuleConflict = (verdict.triggered_rules ?? []).some((r) =>
    [
      'R-FABRICATED-DOI',
      'R-NONEXISTENT-DOI',
      'R-DOI-CONFLICT',
      'R-CHIMERIC-DOI-MISMATCH',
    ].includes(r),
  );

  const computeYearStatus = (): { status: FieldStatus; label?: string } => {
    if (isWebResourceMode || useObservedWebMeta) {
      return computeWebFieldStatus('year');
    }
    if (!retrievedMeta && isIncompleteMeta) {
      if (mismatchedFieldsSet.has('year') || citedMeta.year === '—') {
        return { status: 'partial', label: lang === 'vi' ? 'Thiếu' : 'Missing' };
      }
      return { status: 'missing', label: lang === 'vi' ? 'Đã ghi' : 'Provided' };
    }
    if (citedMeta.year === '—') return { status: 'missing' };
    if (!retrievedMeta) return { status: 'mismatch', label: 'Diff' };
    if (
      mismatchedFieldsSet.has('year') ||
      (validYearDistance !== undefined && validYearDistance > 0)
    ) {
      return { status: 'mismatch', label: 'Diff' };
    }
    if (retrievedMeta.year !== '—') {
      const citedYr = parseInt(citedMeta.year, 10);
      const retYr = parseInt(retrievedMeta.year, 10);
      if (!Number.isNaN(citedYr) && !Number.isNaN(retYr)) {
        return citedYr === retYr
          ? { status: 'match', label: '100% Match' }
          : { status: 'mismatch', label: 'Diff' };
      }
    }
    if (
      matchedFieldsSet.has('year') ||
      verdict.label === 'verified' ||
      (isLegalRule && verdict.label === 'resource' && !hasLegalMismatch)
    ) {
      return { status: 'match', label: '100% Match' };
    }
    return { status: 'partial', label: 'Checked' };
  };

  const computeVenueStatus = (): { status: FieldStatus; label?: string } => {
    if (isWebResourceMode || useObservedWebMeta) {
      return computeWebFieldStatus('venue');
    }
    if (!retrievedMeta && isIncompleteMeta) {
      if (mismatchedFieldsSet.has('venue') || citedMeta.venue === '—') {
        return { status: 'partial', label: lang === 'vi' ? 'Thiếu' : 'Missing' };
      }
      return { status: 'missing', label: lang === 'vi' ? 'Đã ghi' : 'Provided' };
    }
    if (citedMeta.venue === '—' && (!retrievedMeta || retrievedMeta.venue === '—')) {
      return { status: 'missing' };
    }
    if (citedMeta.venue === '—' && isIncompleteMeta) {
      return { status: 'missing' };
    }
    if (!retrievedMeta) return { status: 'mismatch', label: 'Diff' };
    if (mismatchedFieldsSet.has('venue')) return { status: 'mismatch', label: 'Diff' };
    if (isLegalRule && verdict.label === 'resource' && !hasLegalMismatch) {
      return { status: 'match', label: '100% Match' };
    }
    if (citedMeta.venue === '—') return { status: 'missing' };

    const hasExplicitBestVenue = Boolean(bestSource?.venue && bestSource.venue.trim());
    const lexicalVenueSim = computeAcademicVenueSim(citedMeta.venue, retrievedMeta.venue);
    const effectiveVenueSim = Math.max(verdict.features?.venue_sim ?? 0, lexicalVenueSim);

    if (BOGUS_VENUE_RE.test(citedMeta.venue) && effectiveVenueSim < 0.5) {
      return { status: 'mismatch', label: 'Diff' };
    }

    if (!hasExplicitBestVenue && retrievedMeta.venue !== citedMeta.venue) {
      return verdict.label === 'verified'
        ? { status: 'match', label: '100% Match' }
        : { status: 'partial', label: 'Indexed' };
    }

    const citedIsPreprint = PREPRINT_VENUE_RE.test(citedMeta.venue);
    const retrievedIsPreprint = PREPRINT_VENUE_RE.test(retrievedMeta.venue);
    if (citedIsPreprint !== retrievedIsPreprint && effectiveVenueSim < 0.45) {
      if (
        verdict.label === 'verified' ||
        (Boolean(verdict.features?.doi_exact_match) && authorSim >= 0.5)
      ) {
        return { status: 'partial', label: 'Preprint' };
      }
      return { status: 'mismatch', label: 'Diff' };
    }

    if (effectiveVenueSim >= 0.5) {
      return { status: 'match', label: '100% Match' };
    }
    if (effectiveVenueSim >= 0.25) {
      return { status: 'partial', label: `${Math.round(effectiveVenueSim * 100)}% Sim` };
    }
    return { status: 'mismatch', label: 'Diff' };
  };

  const computeDoiStatus = (): { status: FieldStatus; label?: string } => {
    if (isWebResourceMode || useObservedWebMeta) {
      return computeWebFieldStatus('doi');
    }
    if (!retrievedMeta && isIncompleteMeta) {
      if (mismatchedFieldsSet.has('doi')) {
        return { status: 'partial', label: lang === 'vi' ? 'Thiếu' : 'Missing' };
      }
      if (citedMeta.doi === '—') {
        return { status: 'missing' };
      }
      return { status: 'missing', label: lang === 'vi' ? 'Đã ghi' : 'Provided' };
    }
    if (citedMeta.doi === '—' && (!retrievedMeta || retrievedMeta.doi === '—')) {
      return { status: 'missing' };
    }
    if (!retrievedMeta) return { status: 'mismatch', label: 'Diff' };
    if (mismatchedFieldsSet.has('doi') || hasDoiRuleConflict) {
      return { status: 'mismatch', label: 'Diff' };
    }
    if (citedMeta.doi === '—' && retrievedMeta.doi !== '—') {
      return { status: 'partial', label: 'Retrieved' };
    }

    const normCitedDoi = normalizeDoiForCompare(citedMeta.doi);
    const normRetrievedDoi = normalizeDoiForCompare(retrievedMeta.doi);
    if (normCitedDoi && normRetrievedDoi) {
      if (normCitedDoi === normRetrievedDoi) {
        return { status: 'match', label: '100% Match' };
      }
      if (
        areEquivalentCanonicalDois(normCitedDoi, normRetrievedDoi) ||
        (Boolean(verdict.features?.doi_exact_match) &&
          (normCitedDoi.startsWith('10.48550/arxiv') !==
            normRetrievedDoi.startsWith('10.48550/arxiv')))
      ) {
        return { status: 'partial', label: 'Preprint DOI' };
      }
      return { status: 'mismatch', label: 'Diff' };
    }

    if (citedMeta.doi !== '—' && Boolean(verdict.features?.doi_exact_match)) {
      return { status: 'match', label: '100% Match' };
    }
    if (citedMeta.doi !== '—') {
      return verdict.label === 'verified'
        ? { status: 'partial', label: 'Provided' }
        : { status: 'partial', label: 'Unverified' };
    }
    return { status: 'missing' };
  };

  const { status: urlStatus, code: urlCode } = resolveVerdictUrlStatus(verdict);

  const computeUrlStatus = (): { status: FieldStatus; label?: string } => {
    if (isUrlContentMismatch) {
      return {
        status: 'partial',
        label: lang === 'vi' ? 'Sai nội dung trang' : 'Wrong Page',
      };
    }
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
    if (!retrievedMeta && isIncompleteMeta && citedMeta.url !== '—') {
      return { status: 'missing', label: lang === 'vi' ? 'Đã ghi' : 'Provided' };
    }
    if (!retrievedMeta && !isWebResourceMode) {
      return { status: 'mismatch', label: 'Broken Link' };
    }
    const citedUrlIsDoi = /^https?:\/\/(?:dx\.)?doi\.org\//i.test(citedMeta.url);
    if (citedUrlIsDoi) {
      const doiEval = computeDoiStatus();
      if (doiEval.status === 'mismatch') {
        return { status: 'mismatch', label: 'Broken Link' };
      }
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
    return { status: 'partial', label: 'Unverified' };
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
  const markerPos =
    pos === -1 && marker && marker !== '[?]'
      ? rawContext.indexOf(marker)
      : -1;
  if (pos !== -1) {
    contextBefore = '“' + rawContext.slice(0, pos);
    contextHighlight = highlightTarget;
    contextAfter = rawContext.slice(pos + highlightTarget.length) + '”';
  } else if (markerPos !== -1) {
    contextBefore = '“' + rawContext.slice(0, markerPos);
    contextHighlight = marker;
    contextAfter = rawContext.slice(markerPos + marker.length) + '”';
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
      : verdict.label === 'resource'
        ? isLegalRule
          ? ['R-VN-LEGAL-FORMAT']
          : ['R-URL-RESOURCE']
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
    const inspectorDef = RULE_DEFINITIONS[cleanCode];
    if (inspectorDef) {
      const concl = inspectorDef.conclusion.toLowerCase();
      const statusFromOutcome: 'passed' | 'warning' | 'failed' =
        concl.includes('verified') || concl.includes('resource')
          ? 'passed'
          : concl.includes('hallucination')
            ? 'failed'
            : 'warning';
      const condText = inspectorDef.conditions
        .map((c) => `${c.field} ${c.operator} ${c.value}`)
        .join(' AND ');
      return {
        code: cleanCode,
        name: lang === 'vi' ? inspectorDef.nameVi : inspectorDef.name,
        condition: `IF ${condText} THEN ${inspectorDef.conclusion}`,
        status: statusFromOutcome,
      };
    }
    const fallbackStatus: 'passed' | 'warning' | 'failed' =
      verdict.label === 'verified' || verdict.label === 'resource'
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
      condition: `IF ${cleanCode} THEN ${verdict.label.toUpperCase()}`,
      status: fallbackStatus,
    };
  });

  // Build Federated Sources List (combining actual matched_sources with the standard scholarly engines)
  const isNonScholarlyResourceUnrouted =
    (isWebResourceMode || isLegalRule || verdict.label === 'resource') &&
    verdict.features?.has_scholarly_candidate === false;
  const standardEngines = [
    {
      key: 'local',
      label:
        lang === 'vi'
          ? 'CSDL ACL / Bài báo Kinh điển Nội bộ (SQLite FTS5)'
          : 'Local ACL / Known Papers (SQLite FTS5)',
      matchTokens: ['local', 'known', 'acl'],
    },
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
      const contextualLabel =
        engine.key === 'tech_standard'
          ? formatEssaySourceDisplay(ms.source, lang, verdict, ms)
          : engine.label;
      return {
        name: contextualLabel,
        status: conf >= 0.7 ? 'matched' : 'partial',
        score: conf.toFixed(2),
        matchedFields: ms.matched_fields ?? [],
        url: ms.url ?? undefined,
        doi: ms.doi ?? undefined,
      };
    }

    if (
      engine.key === 'local' &&
      ((verdict.features?.source_used ?? '').toLowerCase().includes('local') ||
        (verdict.features?.agreed_sources ?? []).some((s) =>
          String(s).toLowerCase().includes('local'),
        ))
    ) {
      return {
        name: engine.label,
        status: verdict.confidence >= 0.7 ? 'matched' : 'partial',
        score: verdict.confidence.toFixed(2),
        matchedFields: [],
      };
    }

    return {
      name: engine.label,
      status: 'not_found',
      score: '0.00',
      matchedFields: [],
      notRouted: isNonScholarlyResourceUnrouted,
    };
  });

  // Append any additional custom matched sources (vn_legal_registry, web_html_meta, wayback_html_meta, etc.)
  let hasWebHtmlSourceCard = false;
  (verdict.matched_sources ?? []).forEach((ms, idx) => {
    if (!usedSourceIndices.has(idx)) {
      const low = (ms.source || '').toLowerCase();
      if (low === 'web_html_meta' || low === 'wayback_html_meta') {
        hasWebHtmlSourceCard = true;
      }
      const conf = ms.confidence ?? verdict.confidence;
      sources.unshift({
        name: formatEssaySourceDisplay(ms.source, lang, verdict, ms),
        status: isUrlContentMismatch
          ? 'partial'
          : conf >= 0.7
            ? 'matched'
            : 'partial',
        score: conf.toFixed(2),
        matchedFields: ms.matched_fields ?? [],
        url: ms.url ?? undefined,
        doi: ms.doi ?? undefined,
      });
    }
  });

  if (!hasWebHtmlSourceCard && observedWeb) {
    const webSourceKey = observedWeb.isArchived
      ? 'wayback_html_meta'
      : 'web_html_meta';
    const extractedFields: string[] = [];
    if (observedWeb.title) extractedFields.push('title');
    if (observedWeb.authors?.length) extractedFields.push('authors');
    if (observedWeb.year) extractedFields.push('year');
    if (observedWeb.venue) extractedFields.push('venue');
    if (observedWeb.doi) extractedFields.push('doi');
    sources.unshift({
      name: formatEssaySourceDisplay(webSourceKey, lang, verdict),
      status: isUrlContentMismatch ? 'partial' : 'matched',
      score: (
        typeof verdict.features?.html_meta_title_sim === 'number'
          ? verdict.features.html_meta_title_sim
          : verdict.confidence
      ).toFixed(2),
      matchedFields: extractedFields,
      url: observedWeb.url ?? undefined,
      doi: observedWeb.doi ?? undefined,
    });
  }

  const verdictVisual = getVerdictBadgeVisuals(
    verdict.label,
    verdict.triggered_rules,
    lang
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

/**
 * Resolve a `?citation=` deep-link value against report verdicts. Accepts the
 * report citation id (`v123`) or the raw DB verdict id (`123`) that teacher
 * endpoints such as pending-reviews return.
 */
export function findVerdictByCitationParam(
  verdicts: Verdict[],
  param: string | null | undefined,
): Verdict | undefined {
  if (!param) return undefined;
  const raw = param.trim();
  if (!raw) return undefined;
  const bare = raw.replace(/^v/i, '');
  return (
    verdicts.find((v) => v.citation_id === raw) ||
    verdicts.find((v) => v.citation_id === `v${bare}`) ||
    verdicts.find((v) => v.citation_id.replace(/^v/i, '') === bare)
  );
}

export function EssayPage() {
  const { t, i18n } = useTranslation();
  const { has } = useRole();
  const canViewDeepTrace = has('view_logic_trace');
  const canOverride = has('override_verdict');
  const lang: 'vi' | 'en' = i18n.language?.startsWith('vi') ? 'vi' : 'en';

  const { id } = useParams<{ id: string }>();
  const numericId = id ? parseInt(id, 10) : null;
  const essayId =
    numericId !== null && !Number.isNaN(numericId) && numericId > 0
      ? numericId
      : null;

  const { data: report, isLoading, error } = useEssayReport(essayId);
  const overrideMutation = useOverrideVerdict();
  const toast = useToast();

  const location = useLocation();
  const [searchParams] = useSearchParams();

  const resolveInitialMode = (): ReportWorkspaceMode => {
    if (location.pathname.endsWith('/document') && has('view_document_inspector')) {
      return 'document';
    }
    if (location.pathname.endsWith('/consistency') && has('view_orphan_detection')) {
      return 'consistency';
    }
    const viewParam = searchParams.get('view');
    if (viewParam === 'document' && has('view_document_inspector')) return 'document';
    if (viewParam === 'consistency' && has('view_orphan_detection')) return 'consistency';
    if (viewParam === 'graph' && canViewDeepTrace) return 'graph';
    return 'debugger';
  };

  const [selectedCitationId, setSelectedCitationId] = useState<string | null>(null);
  const [filterLabel, setFilterLabel] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [workspaceMode, setWorkspaceMode] = useState<ReportWorkspaceMode>(resolveInitialMode);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [lockedFeatureName, setLockedFeatureName] = useState<string>('');
  const [remediationOpen, setRemediationOpen] = useState(false);
  const [deepDrawerOpen, setDeepDrawerOpen] = useState(false);
  const [customRevisionDiff, setCustomRevisionDiff] = useState<RevisionDiffData | null>(null);
  const [revisionExpanded, setRevisionExpanded] = useState(false);
  const [loadingRevisionDiff, setLoadingRevisionDiff] = useState(false);
  const { containerRef: queueFilterPillRef, pillStyle: queueFilterPill } =
    useSlidingPill<HTMLDivElement>(`${filterLabel}-${lang}-${workspaceMode}`);

  useEffect(() => {
    setCustomRevisionDiff(null);
    setRevisionExpanded(false);
    setDeepDrawerOpen(false);
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
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (
        upgradeOpen ||
        remediationOpen ||
        Boolean(
          document.querySelector(
            '[role="dialog"], [data-testid="bibliography-remediation-modal"], [data-testid="upgrade-modal"]',
          ),
        )
      ) {
        return;
      }
      setSelectedCitationId(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [upgradeOpen, remediationOpen]);

  // Deep link: /verification/report/:id?citation=<verdict id> (e.g. from the
  // teacher Pending Reviews queue) selects and scrolls to that citation once.
  const citationParam = searchParams.get('citation');
  const appliedCitationParamRef = useRef<string | null>(null);
  useEffect(() => {
    if (!report || !citationParam) return;
    const key = `${report.essay_id}:${citationParam}`;
    if (appliedCitationParamRef.current === key) return;
    const target = findVerdictByCitationParam(report.verdicts, citationParam);
    if (!target) return;
    appliedCitationParamRef.current = key;
    setFilterLabel('all');
    setSearchQuery('');
    setWorkspaceMode('debugger');
    setSelectedCitationId(target.citation_id);
    const scroll = () => {
      const el = Array.from(
        document.querySelectorAll<HTMLElement>('[data-citation-id]'),
      ).find((node) => node.dataset.citationId === target.citation_id);
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      el?.focus?.({ preventScroll: true });
    };
    requestAnimationFrame(() => requestAnimationFrame(scroll));
  }, [report, citationParam]);

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
    const verdictPriority = (label: ValidationLabel): number => {
      if (label === 'suspected_hallucination') return 0;
      if (label === 'metadata_error') return 1;
      if (label === 'unresolved') return 2;
      return 3;
    };

    return enrichedItems
      .filter((item) => {
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
      })
      .sort(
        (a, b) =>
          verdictPriority(a.verdict.label) - verdictPriority(b.verdict.label) ||
          a.index - b.index,
      );
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

  const localizeFieldBadgeLabel = (rawLabel?: string, fallbackEn = ''): string => {
    const label = rawLabel || fallbackEn;
    if (lang !== 'vi') return label;
    const simMatch = label.match(/^(\d+)%\s*Sim$/i);
    if (simMatch) return `Tương đồng ${simMatch[1]}%`;
    const mapVi: Record<string, string> = {
      '100% Match': 'Khớp 100%',
      Match: 'Khớp',
      Partial: 'Khớp một phần',
      Diff: 'Sai lệch',
      Missing: 'Thiếu',
      '— Missing': '— Thiếu',
      Provided: 'Đã ghi',
      'Web Resource': 'Tài nguyên Web',
      'Wrong Page': 'Sai nội dung trang',
      Checked: 'Đã kiểm tra',
      Indexed: 'Đã lập chỉ mục',
      Retrieved: 'Đã truy xuất',
      'Wayback Archived': 'Lưu trữ Wayback',
      'Fake Domain': 'Tên miền giả',
      'Broken Link': 'Liên kết hỏng',
      'Verified Link': 'Liên kết hợp lệ',
      'Resolved URL': 'Đã phân giải URL',
      Preprint: 'Bản tiền ấn phẩm',
      'Preprint DOI': 'DOI tiền ấn phẩm',
      Unverified: 'Chưa xác minh',
    };
    return mapVi[label] ?? label;
  };

  const renderFieldStatusBadge = (fieldInfo: {
    status: FieldStatus;
    label?: string;
  }) => {
    switch (fieldInfo.status) {
      case 'match':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold whitespace-nowrap shrink-0 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            <Check className="h-3 w-3 shrink-0" />{' '}
            {localizeFieldBadgeLabel(fieldInfo.label, '100% Match')}
          </span>
        );
      case 'partial':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold whitespace-nowrap shrink-0 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            <AlertTriangle className="h-3 w-3 shrink-0" />{' '}
            {localizeFieldBadgeLabel(fieldInfo.label, 'Partial')}
          </span>
        );
      case 'mismatch':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold whitespace-nowrap shrink-0 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300 border border-red-200 dark:border-red-800">
            <XCircle className="h-3 w-3 shrink-0" />{' '}
            {localizeFieldBadgeLabel(fieldInfo.label, 'Diff')}
          </span>
        );
      case 'missing': {
        const displayMissing = fieldInfo.label
          ? localizeFieldBadgeLabel(fieldInfo.label)
          : lang === 'vi'
            ? '— Khuyết thông tin'
            : '— Missing';
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold whitespace-nowrap shrink-0 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
            {displayMissing}
          </span>
        );
      }
    }
  };

  if (errorMessage) {
    const statusCode = (error as { status?: number } | null)?.status;
    const isPipelineJobFailed =
      essayId !== null &&
      (statusCode === 409 ||
        /409|failed|thất bại|analysis failed|pipeline/i.test(errorMessage));

    if (isPipelineJobFailed) {
      return (
        <div
          data-testid="essay-failed-analysis-card"
          className="rounded-2xl border border-red-200 dark:border-red-900/70 bg-white dark:bg-slate-900 p-6 sm:p-8 shadow-sm max-w-2xl mx-auto my-8"
        >
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-2xl bg-red-50 dark:bg-red-950/70 border border-red-200 dark:border-red-800 flex items-center justify-center shrink-0">
              <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
            </div>
            <div className="space-y-3 flex-1 min-w-0">
              <h2 className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
                {lang === 'vi'
                  ? 'Phân tích tài liệu không thành công'
                  : 'Manuscript Analysis Failed'}
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed break-words">
                {errorMessage}
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Link
                  to="/upload"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-mono font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
                >
                  <ArrowUpRight className="h-4 w-4" />
                  {lang === 'vi' ? 'Tải lên lại' : 'Upload Again'}
                </Link>
                <Link
                  to="/history"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-mono font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors"
                >
                  {lang === 'vi' ? 'Quay lại Lịch sử' : 'Back to History'}
                </Link>
              </div>
            </div>
          </div>
        </div>
      );
    }

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

  const activeRevisionDiff = customRevisionDiff ?? report.revision_diff ?? null;
  const isSandboxManuscript = Boolean(
    report.filename &&
      (/^citra_acl_sandbox/i.test(report.filename) || /acl_sandbox/i.test(report.filename)),
  );
  const shouldShowRevisionDiff = Boolean(
    !isSandboxManuscript &&
      (activeRevisionDiff?.has_previous_revision ||
        Boolean((activeRevisionDiff as { has_previous?: boolean } | null)?.has_previous)) &&
      (customRevisionDiff !== null || activeRevisionDiff?.is_same_manuscript_family !== false),
  );
  const sameFamilyRevisions = (activeRevisionDiff?.available_revisions ?? []).filter(
    (rev) => rev.is_same_stem !== false && !/acl_sandbox/i.test(rev.filename),
  );
  const hasRevisionCountChanges = Boolean(
    activeRevisionDiff?.counts_before &&
      activeRevisionDiff?.counts_after &&
      ((activeRevisionDiff.counts_before.verified ?? 0) !==
        (activeRevisionDiff.counts_after.verified ?? 0) ||
        (activeRevisionDiff.counts_before.metadata_error ?? 0) !==
          (activeRevisionDiff.counts_after.metadata_error ?? 0) ||
        (activeRevisionDiff.counts_before.suspected_hallucination ?? 0) !==
          (activeRevisionDiff.counts_after.suspected_hallucination ?? 0) ||
        (activeRevisionDiff.counts_before.unresolved ?? 0) !==
          (activeRevisionDiff.counts_after.unresolved ?? 0)),
  );
  const isZeroChangeRevision = Boolean(
    activeRevisionDiff &&
      Math.abs(activeRevisionDiff.cis_delta ?? 0) < 0.05 &&
      (activeRevisionDiff.resolved_issues_count ?? 0) === 0 &&
      (activeRevisionDiff.new_issues_count ?? 0) === 0 &&
      (activeRevisionDiff.citation_changes?.length ?? 0) === 0 &&
      !hasRevisionCountChanges,
  );

  const isAbnormalMapping = (status?: string | null) =>
    Boolean(status && status !== 'matched');

  const cisScore = report.cis.score;
  const cisHealthPill =
    cisScore >= 90
      ? {
          text: lang === 'vi' ? '✓ Rất đáng tin cậy' : '✓ Highly Reliable',
          className:
            'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-800',
        }
      : cisScore >= 75
        ? {
            text: lang === 'vi' ? 'Khá tốt · Cần rà soát nhẹ' : 'Good · Minor Review',
            className:
              'bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/70 dark:text-indigo-300 dark:border-indigo-800',
          }
        : cisScore >= 50
          ? {
              text: lang === 'vi' ? '⚠ Cần kiểm tra kỹ' : '⚠ Needs Review',
              className:
                'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800',
            }
          : {
              text: lang === 'vi' ? '✕ Nhiều rủi ro trích dẫn' : '✕ High Citation Risk',
              className:
                'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/70 dark:text-red-300 dark:border-red-800',
            };

  const getPrimarySourceExternalUrl = (item: EnrichedCitationItem): string | null => {
    const rawDoi =
      (item.retrievedMeta?.doi && item.retrievedMeta.doi !== '—'
        ? item.retrievedMeta.doi
        : '') ||
      item.verdict.matched_sources?.[0]?.doi ||
      '';
    if (rawDoi) {
      return rawDoi.startsWith('http')
        ? rawDoi
        : `https://doi.org/${rawDoi.replace(/^doi:\s*/i, '')}`;
    }
    const candidateUrl =
      (item.retrievedMeta?.url && /^https?:\/\//i.test(item.retrievedMeta.url)
        ? item.retrievedMeta.url
        : '') ||
      item.verdict.matched_sources?.[0]?.url ||
      (item.citedMeta.url && /^https?:\/\//i.test(item.citedMeta.url)
        ? item.citedMeta.url
        : '');
    return /^https?:\/\//i.test(candidateUrl) ? candidateUrl : null;
  };

  const handleCopyFormattedCitation = async (item: EnrichedCitationItem) => {
    const cleanField = (val?: string | null) =>
      val &&
      val !== '—' &&
      val !== 'Trang web không khai báo thẻ này' &&
      val !== 'Not declared in page metadata'
        ? val.trim()
        : '';
    const authors =
      cleanField(item.retrievedMeta?.authors) || cleanField(item.citedMeta.authors);
    const year = cleanField(item.retrievedMeta?.year) || cleanField(item.citedMeta.year);
    const title = cleanField(item.retrievedMeta?.title) || cleanField(item.citedMeta.title);
    const venue = cleanField(item.retrievedMeta?.venue) || cleanField(item.citedMeta.venue);
    const doi = cleanField(item.retrievedMeta?.doi) || cleanField(item.citedMeta.doi);

    const parts: string[] = [item.marker];
    if (authors) parts.push(year ? `${authors} (${year}).` : `${authors}.`);
    else if (year) parts.push(`(${year}).`);
    if (title) parts.push(`${title.replace(/\.+$/, '')}.`);
    if (venue) parts.push(`${venue.replace(/\.+$/, '')}.`);
    if (doi) {
      parts.push(
        doi.startsWith('http') ? doi : `https://doi.org/${doi.replace(/^doi:\s*/i, '')}`,
      );
    }
    const formatted = parts.join(' ').trim() || item.verdict.citation_raw;
    await copyTextToClipboard(formatted);
    toast.success(
      lang === 'vi' ? 'Đã sao chép trích dẫn chuẩn' : 'Copied formatted citation',
      formatted,
    );
  };

  const docDiag = report.document_diagnostics;
  const isScannedPdfDetected = Boolean(
    docDiag?.is_scanned_pdf ||
      (!report.filename.toLowerCase().endsWith('.docx') &&
        report.num_pages > 0 &&
        report.verdicts.length === 0 &&
        (report.extracted_citations?.length ?? 0) === 0),
  );

  const attentionCount = counts.metadata_error + counts.suspected_hallucination;
  const consistencyAllMatched =
    (report.linking_summary?.missing_reference ?? 0) === 0 &&
    (report.linking_summary?.uncited_reference ?? 0) === 0 &&
    (report.linking_summary?.in_text_mismatch ?? 0) === 0;

  return (
    <div className="space-y-3.5 pb-10">
      {/* Zone 1: Compact Document Topbar */}
      <EssayHeader
        essayId={report.essay_id}
        filename={report.filename}
        numPages={report.num_pages}
        numCitations={report.num_citations}
        numReferences={report.verdicts.length}
        styleName={report.style_profile?.style}
        onOpenRemediation={() => setRemediationOpen(true)}
      />

      {/* Legacy Vietnamese Encoding (TCVN3/VNI) & Page-Selective OCR Recovery Diagnostics */}
      {(Boolean(docDiag?.legacy_encoding_detected) ||
        (docDiag?.ocr_pages_recovered?.length ?? 0) > 0) && (
        <div
          data-testid="essay-doc-diagnostics-banner"
          className="flex flex-wrap items-center gap-2.5"
        >
          {docDiag?.legacy_encoding_detected && (
            <div
              data-testid="legacy-encoding-diagnostic-pill"
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs bg-indigo-50/90 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-800 dark:text-indigo-200"
            >
              <Sparkles className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <span>
                {lang === 'vi'
                  ? `Đã tự động chuyển mã bảng mã tiếng Việt cũ (${String(docDiag.legacy_encoding_detected).toUpperCase()} → Unicode NFC)`
                  : `Auto-transcoded legacy Vietnamese encoding (${String(docDiag.legacy_encoding_detected).toUpperCase()} → Unicode NFC)`}
              </span>
            </div>
          )}
          {(docDiag?.ocr_pages_recovered?.length ?? 0) > 0 && (
            <div
              data-testid="ocr-recovery-diagnostic-pill"
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs bg-emerald-50/90 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200"
            >
              <FileText className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>
                {lang === 'vi'
                  ? `Đã khôi phục văn bản bằng OCR (Tesseract vie+eng) tại trang: ${docDiag!.ocr_pages_recovered!.join(', ')}`
                  : `Recovered text via Tesseract OCR (vie+eng) on page(s): ${docDiag!.ocr_pages_recovered!.join(', ')}`}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Scanned / Image-Only PDF Diagnostic Guardrail Banner */}
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
                  <span className="px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-amber-600 text-white uppercase tracking-wider">
                    SCANNED_PDF_DETECTED
                  </span>
                  <h3 className="text-sm sm:text-base font-bold text-amber-950 dark:text-amber-100">
                    {lang === 'vi'
                      ? 'Cảnh báo: Phát hiện Tài liệu PDF dạng Ảnh quét (Thiếu lớp văn bản)'
                      : 'Alert: Scanned / Image-Only PDF Detected (Missing Digital Text Layer)'}
                  </h3>
                </div>
                <p className="text-xs sm:text-sm text-amber-900/90 dark:text-amber-200/90 leading-relaxed max-w-3xl">
                  {docDiag?.warning_message ||
                    (lang === 'vi'
                      ? 'Tài liệu PDF này được tạo từ máy scan hoặc ảnh chụp trang giấy nên không chứa lớp ký tự số hóa để bóc tách trích dẫn. Vui lòng tải lên bản gốc Word (.docx) hoặc PDF xuất trực tiếp từ Word/LaTeX.'
                      : 'This PDF appears to be scanned from images without an extractable text layer. Please run OCR or upload the native .docx / digital PDF exported from Word or LaTeX.')}
                </p>
                <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-amber-800 dark:text-amber-300">
                  <span>
                    • {lang === 'vi' ? 'Số trang thiếu lớp chữ' : 'Scanned pages'}:{' '}
                    <strong>
                      {docDiag?.scanned_pages_count ?? report.num_pages}/{report.num_pages}
                    </strong>
                  </span>
                  {typeof docDiag?.avg_chars_per_page === 'number' &&
                    docDiag.avg_chars_per_page >= 0 && (
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
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white shadow-xs transition-colors"
              >
                <ArrowUpRight className="h-4 w-4" />
                {lang === 'vi'
                  ? 'Tải lên bản .DOCX / PDF số hóa'
                  : 'Upload Native .DOCX / Digital PDF'}
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Slim Revision Progress Banner (ONLY shown when actual changes exist between v1 and v2) */}
      {shouldShowRevisionDiff && activeRevisionDiff && !isZeroChangeRevision && (
        <div
          data-testid="revision-diff-banner"
          data-quiet-unchanged="false"
          className="rounded-2xl border border-indigo-200/90 dark:border-indigo-800/80 bg-gradient-to-r from-emerald-50/80 via-white to-indigo-50/70 dark:from-emerald-950/30 dark:via-slate-900 dark:to-indigo-950/40 px-4 py-3 shadow-2xs overflow-hidden"
        >
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 min-w-0">
            <div className="flex flex-wrap items-center gap-2.5 min-w-0 text-xs sm:text-[13px]">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-600 text-white">
                <GitBranch className="h-3 w-3 shrink-0" />
                v1 → v2
              </span>
              <span className="text-slate-700 dark:text-slate-300">
                {lang === 'vi' ? 'So sánh với bản cũ:' : 'Compared against:'}{' '}
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
                  className="max-w-[240px] truncate text-xs px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                >
                  {sameFamilyRevisions.map((rev) => (
                    <option key={rev.essay_id} value={rev.essay_id}>
                      #{rev.essay_id}{' '}
                      {rev.filename.length > 18 ? `${rev.filename.slice(0, 16)}...` : rev.filename}{' '}
                      ({rev.cis_score.toFixed(1)}%)
                    </option>
                  ))}
                </select>
              )}

              {/* Compact CIS Delta */}
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs">
                <span className="text-slate-600 dark:text-slate-300">
                  {(activeRevisionDiff.cis_before ?? 0).toFixed(1)}% →{' '}
                  <strong className="text-indigo-600 dark:text-indigo-400">
                    {(activeRevisionDiff.cis_after ?? report.cis.score).toFixed(1)}%
                  </strong>
                </span>
                <span
                  data-testid="revision-cis-delta-badge"
                  className={`px-1.5 py-0.5 rounded font-bold text-[11px] ${
                    (activeRevisionDiff.cis_delta ?? 0) > 0
                      ? 'text-emerald-700 bg-emerald-500/10 dark:text-emerald-300 dark:bg-emerald-950'
                      : (activeRevisionDiff.cis_delta ?? 0) < 0
                        ? 'text-rose-700 bg-rose-500/10 dark:text-rose-300 dark:bg-rose-950'
                        : 'text-slate-600 bg-slate-500/10 dark:text-slate-300 dark:bg-slate-800'
                  }`}
                >
                  {(activeRevisionDiff.cis_delta ?? 0) >= 0
                    ? `+${(activeRevisionDiff.cis_delta ?? 0).toFixed(1)}%`
                    : `${(activeRevisionDiff.cis_delta ?? 0).toFixed(1)}%`}
                </span>
              </div>

              {(activeRevisionDiff.resolved_issues_count ?? 0) > 0 && (
                <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50/90 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300">
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  <span>
                    {lang === 'vi' ? 'Đã khắc phục:' : 'Resolved:'}{' '}
                    <strong>{activeRevisionDiff.resolved_issues_count}</strong>
                  </span>
                </div>
              )}

              {activeRevisionDiff.counts_before &&
                activeRevisionDiff.counts_after &&
                (() => {
                  const beforeVerified = activeRevisionDiff.counts_before.verified ?? 0;
                  const afterVerified = activeRevisionDiff.counts_after.verified ?? 0;
                  const deltaVerified = afterVerified - beforeVerified;
                  const beforeMeta = activeRevisionDiff.counts_before.metadata_error ?? 0;
                  const afterMeta = activeRevisionDiff.counts_after.metadata_error ?? 0;
                  const deltaMeta = afterMeta - beforeMeta;
                  const beforeHallu =
                    activeRevisionDiff.counts_before.suspected_hallucination ?? 0;
                  const afterHallu =
                    activeRevisionDiff.counts_after.suspected_hallucination ?? 0;
                  const deltaHallu = afterHallu - beforeHallu;
                  const beforeUnres = activeRevisionDiff.counts_before.unresolved ?? 0;
                  const afterUnres = activeRevisionDiff.counts_after.unresolved ?? 0;
                  const deltaUnres = afterUnres - beforeUnres;

                  const getErrorDeltaBadgeClass = (delta: number) =>
                    delta < 0
                      ? 'text-emerald-700 bg-emerald-500/10 dark:text-emerald-300'
                      : delta > 0
                        ? 'text-rose-700 bg-rose-500/10 dark:text-rose-300'
                        : 'text-slate-600 bg-slate-500/10 dark:text-slate-400';

                  const getVerifiedDeltaBadgeClass = (delta: number) =>
                    delta > 0
                      ? 'text-emerald-700 bg-emerald-500/10 dark:text-emerald-300'
                      : delta < 0
                        ? 'text-rose-700 bg-rose-500/10 dark:text-rose-300'
                        : 'text-slate-600 bg-slate-500/10 dark:text-slate-400';

                  const formatSignedDelta = (delta: number) =>
                    delta > 0 ? `+${delta}` : `${delta}`;

                  return (
                    <>
                      {deltaVerified !== 0 && (
                        <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300">
                          <span>{lang === 'vi' ? 'Hợp lệ:' : 'Verified:'}</span>
                          <strong>{afterVerified}</strong>
                          <span
                            data-testid="revision-delta-verified"
                            className={`px-1.5 py-0.5 rounded font-bold text-[11px] ${getVerifiedDeltaBadgeClass(deltaVerified)}`}
                          >
                            {formatSignedDelta(deltaVerified)}
                          </span>
                        </div>
                      )}
                      {deltaMeta !== 0 && (
                        <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300">
                          <span>{lang === 'vi' ? 'Sai thông tin:' : 'Details Mismatch:'}</span>
                          <strong>{afterMeta}</strong>
                          <span
                            data-testid="revision-delta-metadata_error"
                            className={`px-1.5 py-0.5 rounded font-bold text-[11px] ${getErrorDeltaBadgeClass(deltaMeta)}`}
                          >
                            {formatSignedDelta(deltaMeta)}
                          </span>
                        </div>
                      )}
                      {deltaHallu !== 0 && (
                        <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300">
                          <span>{lang === 'vi' ? 'Không thấy nguồn:' : 'Not Found:'}</span>
                          <strong>{afterHallu}</strong>
                          <span
                            data-testid="revision-delta-suspected_hallucination"
                            className={`px-1.5 py-0.5 rounded font-bold text-[11px] ${getErrorDeltaBadgeClass(deltaHallu)}`}
                          >
                            {formatSignedDelta(deltaHallu)}
                          </span>
                        </div>
                      )}
                      {deltaUnres !== 0 && (
                        <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300">
                          <span>{lang === 'vi' ? 'Chưa rõ:' : 'Unresolved:'}</span>
                          <strong>{afterUnres}</strong>
                          <span
                            data-testid="revision-delta-unresolved"
                            className={`px-1.5 py-0.5 rounded font-bold text-[11px] ${getErrorDeltaBadgeClass(deltaUnres)}`}
                          >
                            {formatSignedDelta(deltaUnres)}
                          </span>
                        </div>
                      )}
                    </>
                  );
                })()}
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                data-testid="revision-diff-details-btn"
                aria-expanded={revisionExpanded}
                onClick={() => setRevisionExpanded((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 transition-colors cursor-pointer"
              >
                <span>
                  {revisionExpanded
                    ? lang === 'vi'
                      ? 'Thu gọn chi tiết'
                      : 'Hide Changes'
                    : lang === 'vi'
                      ? 'Xem chi tiết thay đổi'
                      : 'View Changes'}
                </span>
                <SymmetricChevron open={revisionExpanded} size={14} />
              </button>
              <Link
                to={`/verification/report/${activeRevisionDiff.previous_essay_id}`}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-indigo-600 transition-colors"
              >
                {lang === 'vi' ? 'Mở bản cũ' : 'Open v1'}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          <AccordionExpand open={revisionExpanded}>
            <div
              data-testid="revision-diff-details-panel"
              className="mt-3 pt-3 border-t border-indigo-200/70 dark:border-indigo-800/60 space-y-2.5"
            >
              {activeRevisionDiff.citation_changes &&
              activeRevisionDiff.citation_changes.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-60 overflow-y-auto pr-1">
                  {activeRevisionDiff.citation_changes.map((chg, idx) => {
                    const extChg = chg as typeof chg & {
                      composite_label?: string | null;
                    };
                    const rawComposite = (extChg.composite_label || '').trim();
                    const compositeBadge = rawComposite
                      ? rawComposite.startsWith('[')
                        ? rawComposite
                        : `[${rawComposite}]`
                      : null;
                    const isGood =
                      chg.transition === 'fixed' ||
                      chg.transition === 'removed_hallucination' ||
                      chg.transition === 'fixed_and_reformatted' ||
                      (chg.after_label === 'verified' && chg.before_label !== 'verified');
                    const isRegression =
                      !isGood &&
                      (chg.after_label === 'suspected_hallucination' ||
                        chg.transition === 'regressed' ||
                        chg.transition === 'new_hallucination');
                    return (
                      <div
                        key={idx}
                        data-testid={`revision-change-item-${idx}`}
                        className={`p-3 rounded-xl border text-xs flex flex-col gap-1 ${
                          isGood
                            ? 'bg-emerald-50/70 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/70'
                            : isRegression
                              ? 'bg-rose-50/70 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/70'
                              : 'bg-amber-50/70 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/70'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 font-semibold flex-wrap">
                          <span
                            className={
                              isGood
                                ? 'text-emerald-700 dark:text-emerald-300'
                                : isRegression
                                  ? 'text-rose-700 dark:text-rose-300'
                                  : 'text-amber-700 dark:text-amber-300'
                            }
                          >
                            {chg.transition === 'removed_hallucination'
                              ? lang === 'vi'
                                ? '✓ Đã gỡ nguồn không xác thực'
                                : '✓ Removed Unverified Source'
                              : isGood
                                ? lang === 'vi'
                                  ? '✓ Đã sửa thành công'
                                  : '✓ Repaired to Verified'
                                : isRegression
                                  ? lang === 'vi'
                                    ? '✕ Phát sinh lỗi mới'
                                    : '✕ New Issue Detected'
                                  : lang === 'vi'
                                    ? '⚠ Cần kiểm tra thêm'
                                    : '⚠ Needs Attention'}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-white/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                            {formatRevisionVerdictLabel(chg.before_label, lang)} →{' '}
                            {formatRevisionVerdictLabel(chg.after_label, lang)}
                          </span>
                        </div>
                        <p className="text-slate-700 dark:text-slate-300 line-clamp-2 text-[11.5px]">
                          {compositeBadge && (
                            <span
                              data-testid="revision-change-composite-marker"
                              className="inline-block font-mono font-bold text-indigo-700 dark:text-indigo-300 mr-1.5"
                            >
                              {compositeBadge}
                            </span>
                          )}
                          {compositeBadge &&
                          chg.citation_raw.trim().startsWith(compositeBadge)
                            ? chg.citation_raw.trim().slice(compositeBadge.length).trim()
                            : chg.citation_raw}
                        </p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {lang === 'vi'
                    ? `Đã đối chiếu tự động giữa #${activeRevisionDiff.previous_essay_id} (${(activeRevisionDiff.cis_before ?? 0).toFixed(1)}%) và #${activeRevisionDiff.current_essay_id} (${(activeRevisionDiff.cis_after ?? 0).toFixed(1)}%).`
                    : `Automatically compared #${activeRevisionDiff.previous_essay_id} and #${activeRevisionDiff.current_essay_id}.`}
                </p>
              )}
            </div>
          </AccordionExpand>
        </div>
      )}

      {/* Zone 2: Unified Summary Health & Single-Purpose View Switcher Bar */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 px-4 py-3 sm:px-5 shadow-2xs flex flex-wrap items-center justify-between gap-3.5">
        <div
          data-testid="report-health-summary"
          className="flex flex-wrap items-center gap-3.5 min-w-0"
        >
          <ScoreRing
            data-testid="cis-score-ring"
            value={cisScore}
            size={40}
            thickness={4.2}
            color={
              cisScore >= 90
                ? '#10b981'
                : cisScore >= 75
                  ? '#6366f1'
                  : cisScore >= 50
                    ? '#f59e0b'
                    : '#ef4444'
            }
          />
          <div className="flex flex-col justify-center">
            <div className="flex items-center gap-2 flex-wrap leading-none">
              <span className="text-lg sm:text-[19px] font-extrabold tracking-tight tabular-nums text-slate-900 dark:text-white leading-none">
                <SubtleNumber value={report.cis.score.toFixed(1)} suffix="%" />
              </span>
              <span
                data-testid="cis-qualitative-pill"
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${cisHealthPill.className}`}
              >
                {cisHealthPill.text}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 mt-1 leading-tight">
              <span>
                <strong className="text-slate-900 dark:text-slate-200">{counts.verified}</strong>{' '}
                {lang === 'vi' ? 'hợp lệ' : 'verified'}
              </span>
              {attentionCount > 0 && (
                <>
                  <span>•</span>
                  <span className="font-semibold text-amber-700 dark:text-amber-400">
                    {attentionCount}{' '}
                    {lang === 'vi' ? 'cần kiểm tra' : 'need review'}
                  </span>
                </>
              )}
              {counts.unresolved > 0 && (
                <>
                  <span>•</span>
                  <span>
                    {counts.unresolved}{' '}
                    {enrichedItems.some((i) => i.verdict.label === 'unresolved')
                      ? lang === 'vi'
                        ? 'nguồn web / cần rà soát'
                        : 'other / web'
                      : lang === 'vi'
                        ? 'nguồn web trực tuyến'
                        : 'web sources'}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Quiet Zero-Change Revision Note (0px vertical overhead when v1 -> v2 has 0 changes) */}
          {shouldShowRevisionDiff && activeRevisionDiff && isZeroChangeRevision && (
            <div
              data-testid="revision-diff-banner"
              data-quiet-unchanged="true"
              className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 sm:pl-3 sm:border-l border-slate-200 dark:border-slate-800"
            >
              <span>
                {lang === 'vi'
                  ? `So với bản cũ (#${activeRevisionDiff.previous_essay_id} — ${activeRevisionDiff.previous_filename}): Không đổi`
                  : `Compared to #${activeRevisionDiff.previous_essay_id} — ${activeRevisionDiff.previous_filename}: No changes`}
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
                  className="max-w-[180px] truncate text-xs px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                >
                  {sameFamilyRevisions.map((rev) => (
                    <option key={rev.essay_id} value={rev.essay_id}>
                      #{rev.essay_id}{' '}
                      {rev.filename.length > 16 ? `${rev.filename.slice(0, 14)}...` : rev.filename}
                    </option>
                  ))}
                </select>
              )}
              <Link
                to={`/verification/report/${activeRevisionDiff.previous_essay_id}`}
                className="inline-flex items-center gap-0.5 font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                <span>{lang === 'vi' ? 'Mở bản cũ' : 'Open v1'}</span>
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          )}
        </div>

        <EssayActionBar
          essayId={id ?? ''}
          filename={report.filename}
          issueCount={attentionCount}
          consistencyOk={consistencyAllMatched}
          workspaceMode={workspaceMode}
          onChangeWorkspaceMode={setWorkspaceMode}
          hideRemediationButton={true}
          onOpenRemediation={() => setRemediationOpen(true)}
        />
      </div>

      {/* ============================================================
          Zone 3: Unified 4-View Stage (120fps Causal Directional Slide)
          ============================================================ */}
      <section>
        <DirectionalStageSlide
          stageKey={
            workspaceMode === 'debugger'
              ? 0
              : workspaceMode === 'document'
                ? 1
                : workspaceMode === 'consistency'
                  ? 2
                  : 3
          }
          distancePx={16}
          data-testid="report-view-stage"
        >
          {workspaceMode === 'document' && has('view_document_inspector') ? (
            <DocumentInspectorWorkspace
              essayId={id ?? String(report.essay_id)}
              report={report}
              embedded={true}
              onSelectVerdictInCitations={(cid) => {
                setSelectedCitationId(cid);
                setWorkspaceMode('debugger');
              }}
            />
          ) : workspaceMode === 'consistency' && has('view_orphan_detection') ? (
            <OrphanConsistencyWorkspace
              report={report}
              embedded={true}
              onSelectVerdictInCitations={(cid) => {
                setSelectedCitationId(cid);
                setWorkspaceMode('debugger');
              }}
            />
          ) : (
            <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-xs overflow-hidden">
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
                  selectedCitationId={selectedCitationId}
                  onSelect={(v) => {
                    setSelectedCitationId(v.citation_id);
                  }}
                  onInspectDetails={(v) => {
                    setSelectedCitationId(v.citation_id);
                    setWorkspaceMode('debugger');
                  }}
                  onOverride={canOverride ? handleOverride : undefined}
                />
              ) : (
                <div className="grid lg:grid-cols-12">
                  {/* Left Pane: Exception-First Citation Queue (5 cols) */}
                  <div className="citra-cq-citations-left lg:col-span-5 min-w-0 lg:relative lg:min-h-[680px] border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
                    <div className="lg:absolute lg:inset-0 flex flex-col min-w-0">
                      {/* Sticky Search & Filter Header */}
                      <div className="p-3.5 sm:px-4 sm:py-3.5 border-b border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2.5 shrink-0">
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1">
                            <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input
                              type="text"
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              placeholder={
                                lang === 'vi'
                                  ? 'Tìm tên bài, tác giả, số [7]...'
                                  : 'Search by title, author, [#]...'
                              }
                              className="w-full pl-8 pr-3 py-1.5 text-xs sm:text-[13px] rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                            />
                          </div>
                          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 shrink-0">
                            {filteredItems.length}/{enrichedItems.length}
                          </span>
                        </div>

                        <div
                          ref={queueFilterPillRef}
                          className="t-tabs relative flex flex-wrap gap-1.5"
                        >
                          <span
                            aria-hidden="true"
                            style={{
                              width: `${queueFilterPill.width}px`,
                              height: `${queueFilterPill.height}px`,
                              transform: `translate3d(${queueFilterPill.left}px, ${queueFilterPill.top}px, 0)`,
                              opacity: queueFilterPill.ready ? 1 : 0,
                              transition: queueFilterPill.animate ? undefined : 'none',
                            }}
                            className="t-tabs-pill rounded-full bg-slate-900 dark:bg-white shadow-2xs"
                          />
                          {(
                            [
                              [
                                'all',
                                lang === 'vi'
                                  ? `Tất cả (${counts.all})`
                                  : `All (${counts.all})`,
                              ],
                              [
                                'verified',
                                lang === 'vi'
                                  ? `✓ Hợp lệ (${counts.verified})`
                                  : `✓ Verified (${counts.verified})`,
                              ],
                              [
                                'metadata_error',
                                lang === 'vi'
                                  ? `⚠ Sai thông tin (${counts.metadata_error})`
                                  : `⚠ Metadata (${counts.metadata_error})`,
                              ],
                              [
                                'suspected_hallucination',
                                lang === 'vi'
                                  ? `✕ Bịa đặt (${counts.suspected_hallucination})`
                                  : `✕ Hallucination (${counts.suspected_hallucination})`,
                              ],
                              ...(counts.unresolved > 0
                                ? [
                                    [
                                      'unresolved',
                                      lang === 'vi'
                                        ? `— Khác (${counts.unresolved})`
                                        : `— Other (${counts.unresolved})`,
                                    ] as const,
                                  ]
                                : []),
                            ] as const
                          ).map(([key, labelText]) => {
                            const isActive = filterLabel === key;
                            return (
                              <button
                                key={key}
                                type="button"
                                data-pill-active={isActive ? 'true' : 'false'}
                                onClick={() => setFilterLabel(key)}
                                className={`t-tab px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors border cursor-pointer ${
                                  isActive
                                    ? queueFilterPill.ready
                                      ? 'text-white dark:text-slate-900 border-transparent'
                                      : 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900 dark:border-white'
                                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:border-slate-300'
                                }`}
                              >
                                {labelText}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                  {/* Full-Height Citation Queue List */}
                  <div
                    className="flex-1 p-3 sm:p-3.5 space-y-2 min-h-0 max-h-[520px] lg:max-h-none overflow-y-auto"
                    role="listbox"
                    aria-label="Extracted Citations"
                  >
                    {(() => {
                      const isAttentionItem = (it: EnrichedCitationItem) =>
                        it.verdict.label === 'suspected_hallucination' ||
                        it.verdict.label === 'metadata_error' ||
                        it.verdict.label === 'unresolved';
                      const attentionItems = filteredItems.filter(isAttentionItem);
                      const cleanItems = filteredItems.filter((it) => !isAttentionItem(it));
                      const showGroupHeaders =
                        filterLabel === 'all' &&
                        attentionItems.length > 0 &&
                        cleanItems.length > 0;

                      const renderQueueCard = (cit: EnrichedCitationItem) => {
                        const isSelected =
                          activeItem?.verdict.citation_id === cit.verdict.citation_id;
                        const isHallucination =
                          cit.verdict.label === 'suspected_hallucination';
                        const isMetadataError = cit.verdict.label === 'metadata_error';

                        return (
                          <button
                            key={cit.verdict.citation_id}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            data-verdict-label={cit.verdict.label}
                            data-citation-id={cit.verdict.citation_id}
                            onClick={() => setSelectedCitationId(cit.verdict.citation_id)}
                            className={`w-full text-left px-3.5 py-3 rounded-xl border transition-all duration-150 cursor-pointer ${
                              isSelected
                                ? 'bg-slate-50/95 dark:bg-slate-800/75 border-slate-300 dark:border-slate-600 shadow-[0_2px_10px_-3px_rgba(15,23,42,0.08)]'
                                : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50/40 dark:hover:bg-slate-800/40'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  className={`font-mono text-[11px] font-bold px-1.5 py-0.5 rounded-md shrink-0 transition-colors ${
                                    isHallucination
                                      ? 'bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400'
                                      : isMetadataError
                                        ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400'
                                        : isSelected
                                          ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-2xs'
                                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                                  }`}
                                >
                                  {cit.marker}
                                </span>
                                <span className="font-semibold text-[13px] text-slate-900 dark:text-white truncate">
                                  {cit.inText}
                                </span>
                              </div>
                              <span className="text-[11px] text-slate-400 shrink-0">
                                {cit.pageLabel}
                              </span>
                            </div>

                            <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-1 mb-2 break-words [overflow-wrap:anywhere]">
                              {cit.citedMeta.title}
                            </p>

                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className={`verdict-badge ${cit.verdictBadgeClass} text-[11px] px-2 py-0.5 font-semibold`}
                              >
                                {cit.verdictText}
                              </span>
                              {canViewDeepTrace &&
                                isAbnormalMapping(cit.verdict.mapping_status) && (
                                  <span
                                    className={`mapping-badge ${cit.mappingBadgeClass} text-[11px] px-2 py-0.5 font-medium`}
                                  >
                                    {cit.mappingText}
                                  </span>
                                )}
                              {cit.linkBadge && (
                                <span
                                  className={`rounded-md ${cit.linkBadge.badgeClass} text-[11px] px-2 py-0.5 font-medium`}
                                  title={cit.linkBadge.title}
                                >
                                  {cit.linkBadge.text}
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      };

                      if (!showGroupHeaders) {
                        return filteredItems.map(renderQueueCard);
                      }

                      return (
                        <>
                          <div className="px-1 pt-1 pb-0.5 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            <span>
                              {lang === 'vi'
                                ? `Cần kiểm tra trước (${attentionItems.length})`
                                : `Needs Review First (${attentionItems.length})`}
                            </span>
                            <span className="text-amber-700 dark:text-amber-400 font-semibold normal-case">
                              {lang === 'vi' ? 'Ưu tiên xử lý' : 'Action required'}
                            </span>
                          </div>
                          {attentionItems.map(renderQueueCard)}

                          <div className="px-1 pt-3 pb-0.5 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            <span>
                              {lang === 'vi'
                                ? `Đã xác thực hợp lệ (${cleanItems.length})`
                                : `Verified Sources (${cleanItems.length})`}
                            </span>
                          </div>
                          {cleanItems.map(renderQueueCard)}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Right Pane: 3-Tier Human-First Detail Inspector (7 cols, 120fps Slide per Citation Click) */}
              {activeItem && (
                <DirectionalStageSlide
                  stageKey={Math.max(
                    0,
                    enrichedItems.findIndex(
                      (it) => it.verdict.citation_id === activeItem.verdict.citation_id,
                    ),
                  )}
                  distancePx={10}
                  data-testid="citation-detail-stage"
                  className="citra-cq-citations-right lg:col-span-7 min-w-0 bg-white dark:bg-slate-950"
                >
                  <div className="p-4 sm:p-6 flex flex-col gap-5">
                    {/* TIER 1: Clean Identity Header + Plain-Language Diagnosis + Quick Actions */}
                  <div className="flex flex-wrap items-start justify-between gap-3 pb-3.5 border-b border-slate-200 dark:border-slate-800">
                    <div className="min-w-[200px] flex-1">
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                        <span>
                          {lang === 'vi' ? 'Tài liệu' : 'Reference'}{' '}
                          <code className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                            {activeItem.marker}
                          </code>
                        </span>
                        <span>•</span>
                        <span>{activeItem.pageLabel}</span>
                      </div>
                      <h3 className="font-sans text-lg sm:text-xl font-bold leading-snug text-slate-900 dark:text-white break-words [overflow-wrap:anywhere]">
                        <SoftTextSwap text={activeItem.citedMeta.title} />
                      </h3>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                      <span
                        className={`verdict-badge ${activeItem.verdictBadgeClass} text-xs px-3 py-1 font-semibold`}
                      >
                        {activeItem.verdictText}
                      </span>
                      {canViewDeepTrace &&
                        isAbnormalMapping(activeItem.verdict.mapping_status) && (
                          <span
                            className={`mapping-badge ${activeItem.mappingBadgeClass} text-xs px-2.5 py-1 font-medium`}
                          >
                            {activeItem.mappingText}
                          </span>
                        )}
                      {activeItem.linkBadge && (
                        <span
                          className={`rounded-md ${activeItem.linkBadge.badgeClass} text-xs px-2.5 py-1 font-medium`}
                          title={activeItem.linkBadge.title}
                        >
                          {activeItem.linkBadge.text}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Plain-Language Summary & Quick Fix Actions */}
                  <div
                    className={`p-4 rounded-xl border space-y-3 ${
                      activeItem.verdict.label === 'suspected_hallucination'
                        ? 'bg-red-50/40 dark:bg-red-950/20 border-red-200/80 dark:border-red-900/60'
                        : activeItem.verdict.label === 'metadata_error'
                          ? 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200/80 dark:border-amber-900/60'
                          : activeItem.verdict.label === 'verified'
                            ? 'bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200/80 dark:border-emerald-900/60'
                            : 'bg-slate-50 dark:bg-slate-900 border-slate-200/80 dark:border-slate-800'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <Scale
                        className={`h-4 w-4 shrink-0 mt-0.5 ${
                          activeItem.verdict.label === 'suspected_hallucination'
                            ? 'text-red-600 dark:text-red-400'
                            : activeItem.verdict.label === 'metadata_error'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      />
                      <div className="text-xs sm:text-sm leading-relaxed text-slate-800 dark:text-slate-200 flex-1 min-w-0">
                        <span className="font-semibold text-slate-900 dark:text-white mr-1.5">
                          {lang === 'vi' ? 'Tóm tắt kiểm tra:' : 'Summary:'}
                        </span>
                        <StreamingText text={activeItem.explanationText} />

                        {canViewDeepTrace &&
                          (() => {
                            const f = activeItem.verdict.features as
                              | CrossLingualFeaturesExt
                              | undefined;
                            const bridgedConcepts =
                              Array.isArray(f?.cross_lingual_bridged_concepts) &&
                              f.cross_lingual_bridged_concepts.length > 0
                                ? f.cross_lingual_bridged_concepts
                                : Array.isArray(f?.bridged_concepts)
                                  ? f.bridged_concepts
                                  : [];
                            const hasCrossLingualRule = (
                              activeItem.verdict.triggered_rules ?? []
                            ).some(
                              (r) =>
                                r === 'R-CROSS-LINGUAL-ALIGNMENT' ||
                                r === 'R-CROSS-LINGUAL-TITLE-MATCH',
                            );
                            const shouldRenderCrossLingual =
                              bridgedConcepts.length > 0 ||
                              Boolean(f?.cross_lingual_detected) ||
                              Boolean(f?.cross_lingual_alignment) ||
                              Boolean(f?.cross_lingual_title_detected) ||
                              (f?.cross_lingual_title_sim ?? 0) >= 0.5 ||
                              hasCrossLingualRule;
                            if (!shouldRenderCrossLingual) return null;

                            const citedSample = `${activeItem.citedMeta.title} ${activeItem.verdict.context || ''} ${activeItem.verdict.citation_raw || ''}`;
                            const canonicalSample =
                              activeItem.retrievedMeta?.title ||
                              activeItem.verdict.matched_sources?.[0]?.title ||
                              '';
                            const direction = detectCrossLingualDirection(
                              citedSample,
                              canonicalSample,
                              f?.cross_lingual_direction,
                            );
                            const onnxSim = Math.max(
                              f?.cross_lingual_title_sim ?? 0,
                              f?.title_sim_semantic ?? 0,
                              f?.semantic_similarity ?? 0,
                              f?.content_alignment_score ?? 0,
                            );
                            const onnxPct = onnxSim > 0 ? Math.round(onnxSim * 100) : null;

                            return (
                              <div
                                data-testid="essay-bridged-concepts"
                                className="mt-2 pt-2 border-t border-slate-200/70 dark:border-slate-800 flex flex-wrap items-center gap-1.5"
                              >
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-indigo-100 text-indigo-800 border border-indigo-200 dark:bg-indigo-950/80 dark:text-indigo-200 dark:border-indigo-800">
                                  {direction}
                                </span>
                                {bridgedConcepts.length > 0 ? (
                                  <>
                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                                      {lang === 'vi'
                                        ? 'Cầu nối Khái niệm Học thuật:'
                                        : 'Academic Concept Bridge:'}
                                    </span>
                                    {bridgedConcepts.slice(0, 5).map((pair, idx) => (
                                      <span
                                        key={idx}
                                        className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800/70"
                                      >
                                        {pair}
                                      </span>
                                    ))}
                                    {onnxPct !== null && (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-teal-50 text-teal-700 border border-teal-200 dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-800/70">
                                        ONNX INT8 · {onnxPct}%
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <div
                                    data-testid="essay-onnx-cross-lingual-badge"
                                    className="flex flex-wrap items-center gap-1.5"
                                  >
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-teal-50 text-teal-800 border border-teal-200 dark:bg-teal-950/70 dark:text-teal-200 dark:border-teal-800">
                                      {lang === 'vi'
                                        ? 'Đối sánh ngữ nghĩa đa ngôn ngữ ONNX INT8 (paraphrase-multilingual-MiniLM-L12-v2)'
                                        : 'Multilingual ONNX INT8 Embedding Match (paraphrase-multilingual-MiniLM-L12-v2)'}
                                    </span>
                                    {onnxPct !== null && (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800/70">
                                        {lang === 'vi'
                                          ? `Tương đồng đa ngôn ngữ: ${onnxPct}%`
                                          : `Cross-Lingual Sim: ${onnxPct}%`}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                      </div>
                    </div>

                    {(() => {
                      const primarySourceUrl = getPrimarySourceExternalUrl(activeItem);
                      const canCopyClean =
                        activeItem.verdict.label !== 'suspected_hallucination';
                      if (!canCopyClean && !primarySourceUrl) return null;
                      return (
                        <div className="flex flex-wrap items-center gap-2 pl-6">
                          {canCopyClean && (
                            <button
                              type="button"
                              data-testid="copy-formatted-citation-btn"
                              onClick={() => void handleCopyFormattedCitation(activeItem)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-2xs transition-colors cursor-pointer"
                            >
                              <Copy className="h-3.5 w-3.5" />
                              <span>
                                {lang === 'vi'
                                  ? 'Chép trích dẫn chuẩn'
                                  : 'Copy Formatted Citation'}
                              </span>
                            </button>
                          )}
                          {primarySourceUrl && (
                            <a
                              href={primarySourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                            >
                              <span>
                                {lang === 'vi' ? 'Mở bài báo gốc' : 'Open Source Paper'}
                              </span>
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  {/* TIER 2: Focused Comparison Table (Mismatches First, Empty Rows Hidden) + Manuscript Quote */}
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                      {lang === 'vi'
                        ? 'Đối chiếu thông tin chi tiết'
                        : 'Detailed Field Comparison'}
                    </div>
                    <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                      <table className="w-full block sm:table sm:table-fixed lg:block xl:table xl:table-fixed text-left border-collapse">
                        <thead className="hidden sm:table-header-group lg:hidden xl:table-header-group">
                          <tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                            <th className="py-2.5 px-3 w-[96px]">
                              {lang === 'vi' ? 'Trường' : 'Field'}
                            </th>
                            <th className="py-2.5 px-3">
                              {lang === 'vi' ? 'Trích dẫn trong bài' : 'Cited in Manuscript'}
                            </th>
                            <th className="py-2.5 px-3">
                              {lang === 'vi'
                                ? 'Bản ghi chuẩn truy xuất'
                                : 'Canonical Retrieved'}
                            </th>
                            <th className="py-2.5 px-3 w-[160px] text-right">
                              {lang === 'vi' ? 'Trạng thái' : 'Status'}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="block sm:table-row-group lg:block xl:table-row-group divide-y divide-slate-200/70 dark:divide-slate-800 text-xs">
                          {(() => {
                            const baseFields: ReadonlyArray<
                              readonly [string, keyof MetadataFields]
                            > = [
                              [lang === 'vi' ? 'Tiêu đề' : 'Title', 'title'],
                              [lang === 'vi' ? 'Tác giả' : 'Authors', 'authors'],
                              [lang === 'vi' ? 'Năm XB' : 'Year', 'year'],
                              [lang === 'vi' ? 'Nơi công bố' : 'Venue', 'venue'],
                              ['DOI', 'doi'],
                              ['URL / Link', 'url'],
                            ];

                            const rowPriority = (status: FieldStatus): number => {
                              if (status === 'mismatch') return 0;
                              if (status === 'partial') return 1;
                              return 2;
                            };

                            const visibleFields = baseFields
                              .filter(([, key]) => {
                                if (key !== 'doi' && key !== 'url') return true;
                                const st = activeItem.fieldStatus[key].status;
                                if (st === 'mismatch') return true;
                                const citedVal = activeItem.citedMeta[key];
                                const canonVal = activeItem.retrievedMeta?.[key] ?? '—';
                                if (key === 'url') {
                                  if (activeItem.linkBadge) return true;
                                  const toDoiHref = (d?: string | null) =>
                                    d && d !== '—'
                                      ? d.startsWith('http')
                                        ? d
                                        : `https://doi.org/${d}`
                                      : '';
                                  const citedIsRedundant =
                                    citedVal === '—' ||
                                    citedVal === toDoiHref(activeItem.citedMeta.doi);
                                  const canonIsRedundant =
                                    canonVal === '—' ||
                                    canonVal === toDoiHref(activeItem.retrievedMeta?.doi);
                                  if (citedIsRedundant && canonIsRedundant) {
                                    return false;
                                  }
                                }
                                if (st === 'partial') return true;
                                return !(citedVal === '—' && canonVal === '—');
                              })
                              .map((entry, idx) => ({ entry, idx }))
                              .sort(
                                (a, b) =>
                                  rowPriority(activeItem.fieldStatus[a.entry[1]].status) -
                                    rowPriority(activeItem.fieldStatus[b.entry[1]].status) ||
                                  a.idx - b.idx,
                              )
                              .map((w) => w.entry);

                            return visibleFields.map(([label, key]) => {
                              const st = activeItem.fieldStatus[key].status;
                              const rowHighlight =
                                st === 'mismatch'
                                  ? activeItem.verdict.label === 'suspected_hallucination'
                                    ? 'bg-red-50/50 dark:bg-red-950/20'
                                    : 'bg-amber-50/60 dark:bg-amber-950/20'
                                  : st === 'partial'
                                    ? 'bg-amber-50/40 dark:bg-amber-950/15'
                                    : 'hover:bg-slate-50/70 dark:hover:bg-slate-900/40';

                              return (
                                <tr
                                  key={key}
                                  className={`flex flex-col sm:table-row lg:flex lg:flex-col xl:table-row p-3 sm:p-0 lg:p-3 xl:p-0 gap-1.5 sm:gap-0 lg:gap-1.5 xl:gap-0 ${rowHighlight}`}
                                >
                                  <td className="py-0.5 sm:py-2.5 lg:py-0.5 xl:py-2.5 px-0 sm:px-3 lg:px-0 xl:px-3 font-semibold text-slate-600 dark:text-slate-400 align-top flex items-center justify-between sm:table-cell lg:flex xl:table-cell">
                                    <span>{label}</span>
                                    <span className="sm:hidden lg:inline-flex xl:hidden">
                                      {renderFieldStatusBadge(activeItem.fieldStatus[key])}
                                    </span>
                                  </td>
                                  <td className="py-0.5 sm:py-2.5 lg:py-0.5 xl:py-2.5 px-0 sm:px-3 lg:px-0 xl:px-3 text-slate-900 dark:text-slate-100 font-medium align-top break-words [overflow-wrap:anywhere] sm:table-cell lg:block xl:table-cell">
                                    <span className="sm:hidden lg:block xl:hidden block text-[10px] uppercase text-slate-400 mb-0.5">
                                      {lang === 'vi' ? 'Trích dẫn trong bài' : 'Cited in Manuscript'}
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
                                      <SoftTextSwap text={activeItem.citedMeta[key]} />
                                    )}
                                  </td>
                                  <td className="py-0.5 sm:py-2.5 lg:py-0.5 xl:py-2.5 px-0 sm:px-3 lg:px-0 xl:px-3 text-slate-700 dark:text-slate-300 align-top break-words [overflow-wrap:anywhere] sm:table-cell lg:block xl:table-cell">
                                    <span className="sm:hidden lg:block xl:hidden block text-[10px] uppercase text-slate-400 mb-0.5">
                                      {lang === 'vi'
                                        ? 'Bản ghi chuẩn truy xuất'
                                        : 'Canonical Retrieved'}
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
                                          className="inline-flex items-center gap-1 font-mono text-indigo-600 dark:text-indigo-400 hover:underline break-all"
                                        >
                                          <span>{activeItem.retrievedMeta.doi}</span>
                                          <ExternalLink className="h-3 w-3 shrink-0" />
                                        </a>
                                      ) : key === 'url' &&
                                        activeItem.retrievedMeta.url !== '—' &&
                                        /^https?:\/\//i.test(activeItem.retrievedMeta.url) ? (
                                        <div className="space-y-1">
                                          <a
                                            href={activeItem.retrievedMeta.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 font-mono text-indigo-600 dark:text-indigo-400 hover:underline break-all"
                                          >
                                            <span>{activeItem.retrievedMeta.url}</span>
                                            <ExternalLink className="h-3 w-3 shrink-0" />
                                          </a>
                                          {(activeItem.verdict.triggered_rules ?? []).includes(
                                            'R-URL-CONTENT-MISMATCH',
                                          ) && (
                                            <span className="block text-[11px] font-sans text-amber-700 dark:text-amber-400 font-medium">
                                              {lang === 'vi'
                                                ? 'HTTP 200 hoạt động nhưng trỏ tới tiêu đề trang web khác'
                                                : 'HTTP 200 resolved to a different page title'}
                                            </span>
                                          )}
                                        </div>
                                      ) : activeItem.retrievedMeta[key] ===
                                          'Trang web không khai báo thẻ này' ||
                                        activeItem.retrievedMeta[key] ===
                                          'Not declared in page metadata' ? (
                                        <span className="text-slate-500 dark:text-slate-400 italic">
                                          <SoftTextSwap text={activeItem.retrievedMeta[key]} />
                                        </span>
                                      ) : (
                                        <SoftTextSwap text={activeItem.retrievedMeta[key]} />
                                      )
                                    ) : key === 'url' && activeItem.linkBadge ? (
                                      <span
                                        className={
                                          (activeItem.verdict.triggered_rules ?? []).includes(
                                            'R-URL-CONTENT-MISMATCH',
                                          )
                                            ? 'text-amber-700 dark:text-amber-400 font-semibold'
                                            : activeItem.linkBadge.status === 'alive' ||
                                                activeItem.linkBadge.status === 'restricted_alive'
                                              ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                              : 'text-red-500 dark:text-red-400 font-semibold'
                                        }
                                      >
                                        {activeItem.linkBadge.title}
                                      </span>
                                    ) : activeItem.verdict.label === 'resource' &&
                                      !isLegalStatuteVerdict(activeItem.verdict) ? (
                                      key === 'doi' && activeItem.citedMeta.doi === '—' ? (
                                        <span className="text-slate-500 dark:text-slate-400">—</span>
                                      ) : (activeItem.verdict.url_status ??
                                          activeItem.verdict.features?.url_status) ===
                                        'restricted_alive' ? (
                                        <span className="text-slate-600 dark:text-slate-300">
                                          {lang === 'vi'
                                            ? 'Tài nguyên web hợp lệ (tường lửa/chặn bot — không đọc được thẻ HTML)'
                                            : 'Verified web resource (bot-protected — HTML meta unavailable)'}
                                        </span>
                                      ) : (
                                        <span className="text-slate-600 dark:text-slate-300">
                                          {lang === 'vi'
                                            ? 'Tài nguyên web trực tiếp (không có thẻ metadata HTML)'
                                            : 'Direct web resource (no HTML metadata tags)'}
                                        </span>
                                      )
                                    ) : (activeItem.verdict.triggered_rules ?? []).includes(
                                        'R-INCOMPLETE-METADATA',
                                      ) ? (
                                      <span className="text-amber-700 dark:text-amber-400 italic">
                                        {lang === 'vi'
                                          ? 'Chưa đủ thông tin quy cách để tra cứu bản ghi chuẩn'
                                          : 'Insufficient citation metadata for canonical lookup'}
                                      </span>
                                    ) : (
                                      <span className="text-red-500 dark:text-red-400 italic">
                                        {lang === 'vi'
                                          ? 'Không tìm thấy bản ghi chuẩn'
                                          : 'No canonical record found'}
                                      </span>
                                    )}
                                  </td>
                                  <td className="hidden sm:table-cell lg:hidden xl:table-cell py-2.5 px-3 text-right whitespace-nowrap align-top">
                                    {renderFieldStatusBadge(activeItem.fieldStatus[key])}
                                  </td>
                                </tr>
                              );
                            });
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Manuscript Context Quote Box (Moved cleanly from Left Queue bottom into Right Detail flow) */}
                  <div
                    data-testid="manuscript-context-card"
                    className="p-3.5 sm:p-4 rounded-xl border bg-slate-50/90 dark:bg-slate-900 border-slate-200/80 dark:border-slate-800"
                  >
                    <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                      <span>
                        {lang === 'vi'
                          ? `Đoạn trích dẫn trong bài của bạn (${activeItem.pageLabel})`
                          : `In-Text Context (${activeItem.pageLabel})`}
                      </span>
                      {canViewDeepTrace && (
                        <span className="font-mono text-[10px] font-medium text-slate-400">
                          {(() => {
                            const parserUsed = (docDiag?.parser_used || '').toLowerCase();
                            const fnameLow = (report.filename || '').toLowerCase();
                            if (parserUsed === 'docx' || fnameLow.endsWith('.docx')) {
                              return 'WORD DOCX · OPENXML';
                            }
                            if (fnameLow.endsWith('.bib')) return 'BIBTEX PARSER';
                            if (fnameLow.endsWith('.ris')) return 'RIS PARSER';
                            if (fnameLow.endsWith('.txt')) return 'PLAIN TEXT';
                            if (parserUsed === 'mupdf') return 'PYMUPDF PARSER';
                            return 'GROBID TEI-XML';
                          })()}
                        </span>
                      )}
                    </div>
                    <p className="document-content text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed line-clamp-4 break-words [overflow-wrap:anywhere]">
                      {activeItem.contextBefore}
                      <mark
                        className={`rounded px-1 py-0.5 font-mono font-bold ${
                          activeItem.verdict.label === 'suspected_hallucination'
                            ? 'bg-red-100/80 dark:bg-red-950/70 text-red-700 dark:text-red-300'
                            : activeItem.verdict.label === 'metadata_error'
                              ? 'bg-amber-100/80 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300'
                              : 'bg-indigo-100/80 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300'
                        }`}
                      >
                        {activeItem.contextHighlight}
                      </mark>
                      {activeItem.contextAfter}
                    </p>
                  </div>

                  {/* Instructor Override Bar (Directly accessible for Teachers & Admins) */}
                  {canOverride && (
                    <div className="p-3.5 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/70 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2 text-indigo-900 dark:text-indigo-200">
                        <Shield className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                        <span className="font-medium">
                          {lang === 'vi'
                            ? 'Quyền Giảng viên: Ghi đè kết quả kiểm định kèm ghi chú.'
                            : 'Instructor Controls: Override verdict with mandatory audit note.'}
                        </span>
                      </div>
                      <OverrideControls
                        verdict={activeItem.verdict}
                        onOverride={(req) => handleOverride(activeItem.verdict, req)}
                      />
                    </div>
                  )}

                  {/* TIER 3: Progressive Disclosure Drawer — Deep AI Rules, 15+ Sources & Evidence Graph (Closed by Default!) */}
                  <div
                    data-testid="deep-verification-drawer"
                    data-open={deepDrawerOpen ? 'true' : 'false'}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50 overflow-hidden"
                  >
                    <button
                      type="button"
                      data-testid="deep-verification-drawer-toggle"
                      aria-expanded={deepDrawerOpen}
                      onClick={() => setDeepDrawerOpen((v) => !v)}
                      className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left text-xs sm:text-[13px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100/80 dark:hover:bg-slate-800/70 transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <Microscope className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                        <span className="truncate">
                          {lang === 'vi'
                            ? 'Xem chi tiết kiểm chứng chuyên sâu (Nguồn tra cứu & Quy tắc AI)'
                            : 'View Deep Verification Details (Scholarly Sources & AI Rules)'}
                        </span>
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 shrink-0">
                        <span>
                          {deepDrawerOpen
                            ? lang === 'vi'
                              ? 'Thu gọn'
                              : 'Collapse'
                            : lang === 'vi'
                              ? 'Mở rộng'
                              : 'Expand'}
                        </span>
                        <SymmetricChevron open={deepDrawerOpen} size={14} />
                      </span>
                    </button>

                    <div
                      className={`grid transition-all duration-200 ${
                        deepDrawerOpen
                          ? 'grid-rows-[1fr] opacity-100 border-t border-slate-200 dark:border-slate-800'
                          : 'grid-rows-[0fr] opacity-0 pointer-events-none'
                      }`}
                    >
                      <div className="overflow-hidden min-h-0">
                        <div className="p-4 bg-white dark:bg-slate-950 space-y-4">
                          {canViewDeepTrace ? (
                            <>
                              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
                                <span>
                                  {lang === 'vi' ? 'Độ tin cậy:' : 'Conf:'}{' '}
                                  <strong className="font-mono text-slate-900 dark:text-white">
                                    {activeItem.confidencePct}%
                                  </strong>
                                </span>
                                <Link
                                  to={`/verification/report/${report.essay_id}/trace`}
                                  className="inline-flex items-center gap-1 font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                                >
                                  <span>
                                    {lang === 'vi'
                                      ? 'Mở trang Quy trình kiểm chứng'
                                      : 'Open Full Verification Trace'}
                                  </span>
                                  <ArrowUpRight className="h-3.5 w-3.5" />
                                </Link>
                              </div>

                              <Tabs defaultValue="sources" className="w-full">
                                <TabsList className="grid grid-cols-1 sm:grid-cols-3 w-full bg-slate-100 dark:bg-slate-900 p-1 rounded-xl h-auto gap-1">
                                  <TabsTrigger
                                    value="sources"
                                    className="w-full text-xs font-semibold py-1.5 px-2.5 truncate"
                                  >
                                    {lang === 'vi' ? '3. Nguồn Truy hồi' : '3. Source Retrieval'}
                                  </TabsTrigger>
                                  <TabsTrigger
                                    value="rules"
                                    className="w-full text-xs font-semibold py-1.5 px-2.5 truncate"
                                  >
                                    {lang === 'vi'
                                      ? `2. Luật Suy diễn (${activeItem.rules.length})`
                                      : `2. Symbolic Rules (${activeItem.rules.length})`}
                                  </TabsTrigger>
                                  <TabsTrigger
                                    value="graph"
                                    data-testid="inspector-tab-graph"
                                    className="w-full text-xs font-semibold py-1.5 px-2.5 gap-1 truncate"
                                  >
                                    <GitBranch className="h-3 w-3 shrink-0 text-violet-500" />
                                    <span className="truncate">
                                      {lang === 'vi' ? '4. Đồ thị Bằng chứng' : '4. Evidence Graph'}
                                    </span>
                                  </TabsTrigger>
                                </TabsList>

                                {/* Multi-Source Federation */}
                                <TabsContent value="sources" className="mt-3">
                                  <div className="grid sm:grid-cols-2 gap-2.5">
                                    {activeItem.sources.map((src) => {
                                      const localizeFieldToken = (f: string) => {
                                        if (lang !== 'vi') return f;
                                        const low = f.toLowerCase();
                                        if (low === 'title') return 'tiêu đề';
                                        if (low === 'authors' || low === 'author') return 'tác giả';
                                        if (low === 'year') return 'năm';
                                        if (low === 'venue') return 'nơi công bố';
                                        return f;
                                      };
                                      const joinedFields = src.matchedFields
                                        .map(localizeFieldToken)
                                        .join(', ');
                                      const subtitleText =
                                        src.status === 'matched'
                                          ? lang === 'vi'
                                            ? `Đã khớp · Tương đồng: ${src.score}${joinedFields ? ` · Trường khớp: ${joinedFields}` : ''}`
                                            : `Matched · Sim: ${src.score}${joinedFields ? ` · Fields: ${joinedFields}` : ''}`
                                          : src.status === 'partial'
                                            ? lang === 'vi'
                                              ? `Đã truy vấn · Tương đồng: ${src.score}${joinedFields ? ` · Trường khớp: ${joinedFields}` : ''}`
                                              : `Queried · Sim: ${src.score}${joinedFields ? ` · Fields: ${joinedFields}` : ''}`
                                            : src.notRouted
                                              ? lang === 'vi'
                                                ? 'Không định tuyến · Tài nguyên phi học thuật'
                                                : 'Not Routed · Non-scholarly resource'
                                              : lang === 'vi'
                                                ? `Đã truy vấn · Tương đồng: ${src.score}`
                                                : `Queried · Sim: ${src.score}`;
                                      return (
                                        <div
                                          key={src.name}
                                          className={`p-3 rounded-xl border flex items-center justify-between gap-2 ${
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
                                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                              {subtitleText}
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
                                                  className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline mt-1"
                                                >
                                                  <span>
                                                    {lang === 'vi'
                                                      ? 'Mở bản ghi nguồn'
                                                      : 'Open Source Record'}
                                                  </span>
                                                  <ExternalLink className="h-3 w-3" />
                                                </a>
                                              );
                                            })()}
                                          </div>
                                          <span
                                            className={`text-[10.5px] font-semibold px-2 py-0.5 rounded shrink-0 ${
                                              src.status === 'matched'
                                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
                                                : src.status === 'partial'
                                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
                                                  : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                                            }`}
                                          >
                                            {src.status === 'matched'
                                              ? lang === 'vi'
                                                ? 'KHỚP'
                                                : 'MATCH'
                                              : src.status === 'partial'
                                                ? lang === 'vi'
                                                  ? 'ỨNG VIÊN'
                                                  : 'CANDIDATE'
                                                : src.notRouted
                                                  ? lang === 'vi'
                                                    ? 'KHÔNG ĐỊNH TUYẾN'
                                                    : 'NOT ROUTED'
                                                  : lang === 'vi'
                                                    ? 'KHÔNG KHỚP'
                                                    : 'NO HIT'}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </TabsContent>

                                {/* Symbolic Rules Trace */}
                                <TabsContent value="rules" className="mt-3">
                                  <div className="space-y-2.5">
                                    {activeItem.rules.map((rule) => (
                                      <div
                                        key={rule.code}
                                        className={`p-3 rounded-xl border text-xs ${
                                          rule.status === 'passed'
                                            ? 'bg-emerald-50/50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/70'
                                            : rule.status === 'warning'
                                              ? 'bg-amber-50/50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/70'
                                              : 'bg-red-50/50 dark:bg-red-950/30 border-red-200 dark:border-red-800/70'
                                        }`}
                                      >
                                        <div className="flex items-center justify-between gap-2 mb-1">
                                          <div className="flex items-center gap-2 min-w-0">
                                            <span className="px-2 py-0.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-mono font-bold text-[11px] shrink-0">
                                              {rule.code}
                                            </span>
                                            <span className="font-semibold text-slate-900 dark:text-white truncate">
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
                                              ? '✓ PASS'
                                              : rule.status === 'warning'
                                                ? '⚠ WARN'
                                                : '✕ FAIL'}
                                          </span>
                                        </div>
                                        <p className="font-mono text-slate-600 dark:text-slate-300 text-[11px] pl-1">
                                          {rule.condition}
                                        </p>
                                      </div>
                                    ))}

                                    {(activeItem.verdict.features || activeItem.linkBadge) && (
                                      <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 font-mono text-[11px] text-slate-600 dark:text-slate-400 flex flex-wrap items-center gap-x-4 gap-y-1">
                                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                                          Telemetry:
                                        </span>
                                        {activeItem.verdict.features?.title_sim_fuzzy !==
                                          undefined && (
                                          <span>
                                            title_fuzzy=
                                            {activeItem.verdict.features.title_sim_fuzzy.toFixed(2)}
                                          </span>
                                        )}
                                        {activeItem.verdict.features?.title_sim_semantic !==
                                          undefined &&
                                          activeItem.verdict.features.title_sim_semantic > 0 && (
                                            <span>
                                              title_semantic=
                                              {activeItem.verdict.features.title_sim_semantic.toFixed(
                                                2,
                                              )}
                                            </span>
                                          )}
                                        {typeof activeItem.verdict.features?.html_meta_title_sim ===
                                          'number' && (
                                          <span>
                                            html_meta_title_sim=
                                            {activeItem.verdict.features.html_meta_title_sim.toFixed(
                                              2,
                                            )}
                                          </span>
                                        )}
                                        {activeItem.verdict.features?.author_jaccard !==
                                          undefined && (
                                          <span>
                                            author_jaccard=
                                            {activeItem.verdict.features.author_jaccard.toFixed(2)}
                                          </span>
                                        )}
                                        {activeItem.verdict.features?.year_distance !== undefined &&
                                          activeItem.verdict.features.year_distance < 900 &&
                                          activeItem.verdict.features?.has_scholarly_candidate !==
                                            false && (
                                            <span>
                                              year_dist={activeItem.verdict.features.year_distance}
                                            </span>
                                          )}
                                        {(activeItem.verdict.features?.cross_lingual_detected ||
                                          activeItem.verdict.features
                                            ?.cross_lingual_title_detected) && (
                                          <span>cross_lingual_detected=true</span>
                                        )}
                                        {typeof activeItem.verdict.features
                                          ?.cross_lingual_title_sim === 'number' &&
                                          activeItem.verdict.features.cross_lingual_title_sim >
                                            0 && (
                                            <span>
                                              cross_lingual_title_sim=
                                              {activeItem.verdict.features.cross_lingual_title_sim.toFixed(
                                                2,
                                              )}
                                            </span>
                                          )}
                                        {activeItem.verdict.features?.venue_sim !== undefined &&
                                          activeItem.verdict.features.venue_sim > 0 && (
                                            <span>
                                              venue_sim=
                                              {activeItem.verdict.features.venue_sim.toFixed(2)}
                                            </span>
                                          )}
                                        {activeItem.verdict.features?.doi_exact_match !==
                                          undefined && (
                                          <span>
                                            doi_match=
                                            {String(activeItem.verdict.features.doi_exact_match)}
                                          </span>
                                        )}
                                        {activeItem.verdict.features?.source_consensus !==
                                          undefined && (
                                          <span>
                                            consensus=
                                            {activeItem.verdict.features.source_consensus}
                                          </span>
                                        )}
                                        {activeItem.verdict.features?.content_alignment_score !==
                                          undefined &&
                                          activeItem.verdict.features.content_alignment_score >
                                            0 && (
                                            <span>
                                              content_align=
                                              {activeItem.verdict.features.content_alignment_score.toFixed(
                                                2,
                                              )}
                                              {activeItem.verdict.features
                                                .content_alignment_confidence
                                                ? ` (${activeItem.verdict.features.content_alignment_confidence})`
                                                : ''}
                                            </span>
                                          )}
                                        {activeItem.linkBadge && (
                                          <span
                                            className={
                                              (
                                                activeItem.verdict.triggered_rules ?? []
                                              ).includes('R-URL-CONTENT-MISMATCH')
                                                ? 'text-amber-700 dark:text-amber-400 font-semibold'
                                                : activeItem.linkBadge.status === 'alive' ||
                                                    activeItem.linkBadge.status ===
                                                      'restricted_alive'
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

                                {/* Evidence Graph */}
                                <TabsContent value="graph" className="mt-3">
                                  <EvidenceGraph verdict={activeItem.verdict} />
                                </TabsContent>
                              </Tabs>

                              {/* Raw Extracted Reference String */}
                              <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800 text-xs">
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block mb-1">
                                  {lang === 'vi'
                                    ? 'Chuỗi Trích dẫn Gốc trong Tài liệu (Raw Extracted String)'
                                    : 'Raw Extracted Reference String'}
                                </span>
                                <p className="font-mono text-slate-700 dark:text-slate-300 break-words leading-relaxed">
                                  {activeItem.verdict.citation_raw}
                                </p>
                              </div>
                            </>
                          ) : (
                            <div
                              data-testid="deep-drawer-basic-upgrade"
                              className="p-3.5 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/70 flex flex-wrap items-center justify-between gap-3"
                            >
                              <div className="text-xs sm:text-[13px] text-slate-800 dark:text-slate-200 flex-1 min-w-[200px]">
                                <strong className="text-slate-900 dark:text-white">
                                  {lang === 'vi'
                                    ? 'Mở khóa Chi tiết Kiểm chứng Chuyên sâu (Gói Pro): '
                                    : 'Unlock Deep Verification Details (Pro Plan): '}
                                </strong>
                                <span>
                                  {lang === 'vi'
                                    ? `Xem toàn bộ kết quả đối chiếu từ 15+ CSDL học thuật quốc tế, ${SYMBOLIC_RULES_COUNT} quy tắc AI & Đồ thị bằng chứng.`
                                    : `Inspect federated lookups across 15+ scholarly registries, ${SYMBOLIC_RULES_COUNT} symbolic rules & interactive Evidence Graph.`}
                                </span>
                              </div>
                              <button
                                type="button"
                                data-testid="locked-evidence-graph-tab"
                                onClick={() => {
                                  setLockedFeatureName(
                                    lang === 'vi'
                                      ? 'Chi tiết Kiểm chứng Chuyên sâu & Đồ thị Bằng chứng (Gói Pro)'
                                      : 'Deep Verification Details & Interactive Evidence Graph',
                                  );
                                  setUpgradeOpen(true);
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer shrink-0"
                              >
                                <Sparkles className="h-3.5 w-3.5 text-amber-300" />
                                <span>{lang === 'vi' ? 'Xem gói Pro' : 'Explore Pro'}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  </div>
                </DirectionalStageSlide>
              )}
                </div>
              )}
            </div>
          )}
        </DirectionalStageSlide>
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
