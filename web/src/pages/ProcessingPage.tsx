import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Check,
  Circle,
  Database,
  FileCheck,
  FileText,
  GitMerge,
  Loader2,
  Quote,
  AlertTriangle,
  AlertCircle,
  XCircle,
  Clock,
  ArrowRight,
  Upload,
  History,
  ShieldCheck,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type EssayStatus } from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  computeSingleCheckProgress,
  useVerificationProgress,
} from '@/contexts/VerificationProgressContext';
import { streamEssayEvents } from '@/hooks/useEssayStream';
import { formatUserError, resolveAcademicLang } from '@/lib/academicTaxonomy';
import {
  SCHOLARLY_APIS_LABEL,
  SYMBOLIC_RULES_COUNT,
} from '@/lib/productFacts';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  ThinkingStateText,
  SubtleNumber,
  MatrixDotLoader,
  SuccessCheck,
  ReasoningStream,
} from '@/components/ui/transitions';

/* ============================================================
   CITRA — ProcessingPage (Live Verification Progress)
   Streams SSE /essays/{id}/events with GET /essays/{id}/status fallback.
   ============================================================ */

const STEP_LABELS: Array<{
  labelEn: string;
  labelVi: string;
  detailsEn: string;
  detailsVi: string;
  tagEn: string;
  tagVi: string;
}> = [
  {
    labelEn: 'Reading document structure',
    labelVi: 'Đọc cấu trúc và nội dung tài liệu',
    detailsEn: 'Extracting text, sections, and layout from your file',
    detailsVi: 'Đọc văn bản, phân đoạn và bố cục của tệp tải lên',
    tagEn: 'Document Reading',
    tagVi: 'Đọc tài liệu',
  },
  {
    labelEn: 'Detecting citation style',
    labelVi: 'Nhận diện chuẩn trích dẫn học thuật',
    detailsEn: 'Identifying format conventions (APA, IEEE, MLA, Harvard…)',
    detailsVi: 'Xác định chuẩn trích dẫn như APA, IEEE, MLA, Harvard…',
    tagEn: 'Citation Style',
    tagVi: 'Chuẩn trích dẫn',
  },
  {
    labelEn: 'Extracting citations & references',
    labelVi: 'Trích xuất trích dẫn và danh mục tham khảo',
    detailsEn: 'Finding in-text citations and bibliography entries',
    detailsVi: 'Tìm các trích dẫn trong bài và danh sách tài liệu tham khảo',
    tagEn: 'Extraction',
    tagVi: 'Trích xuất',
  },
  {
    labelEn: 'Linking citations to references',
    labelVi: 'Liên kết trích dẫn với danh mục tham khảo',
    detailsEn: 'Matching each in-text citation to its bibliography entry',
    detailsVi: 'Đối nối từng trích dẫn trong văn bản với mục tham khảo tương ứng',
    tagEn: 'Cross-Linking',
    tagVi: 'Liên kết',
  },
  {
    labelEn: `Looking up sources across ${SCHOLARLY_APIS_LABEL} academic libraries`,
    labelVi: `Tra cứu nguồn gốc trên ${SCHOLARLY_APIS_LABEL} thư viện học thuật`,
    detailsEn: 'Searching Crossref, OpenAlex, Semantic Scholar, arXiv, and more',
    detailsVi: 'Tìm kiếm ấn phẩm gốc trên Crossref, OpenAlex, Semantic Scholar, arXiv…',
    tagEn: `${SCHOLARLY_APIS_LABEL} Libraries`,
    tagVi: `${SCHOLARLY_APIS_LABEL} thư viện`,
  },
  {
    labelEn: 'Comparing publication details',
    labelVi: 'Đối chiếu thông tin ấn phẩm gốc',
    detailsEn: 'Verifying title, authors, publication year, journal, and DOI',
    detailsVi: 'Kiểm tra khớp tiêu đề, tác giả, năm xuất bản, tạp chí và mã DOI',
    tagEn: 'Comparison',
    tagVi: 'Đối chiếu',
  },
  {
    labelEn: 'Evaluating citation accuracy & integrity',
    labelVi: 'Kiểm tra độ chính xác và tính toàn vẹn trích dẫn',
    detailsEn: 'Checking for author/year mismatches, broken links, or retracted papers',
    detailsVi: 'Rà soát sai lệch thông tin, liên kết hỏng hoặc bài báo đã bị rút',
    tagEn: `${SYMBOLIC_RULES_COUNT} Checks`,
    tagVi: `${SYMBOLIC_RULES_COUNT} tiêu chí`,
  },
  {
    labelEn: 'Building verification report',
    labelVi: 'Tổng hợp báo cáo và điểm toàn vẹn trích dẫn (CIS)',
    detailsEn: 'Calculating Citation Integrity Score and preparing your report',
    detailsVi: 'Tính điểm toàn vẹn trích dẫn (CIS) và hoàn thiện báo cáo chi tiết',
    tagEn: 'CIS Report',
    tagVi: 'Báo cáo CIS',
  },
];

const STEP_KEY_TO_INDEX: Record<string, number> = {
  parsing: 0,
  style_detection: 1,
  extracting: 2,
  linking: 3,
  retrieving: 4,
  comparing: 5,
  checking: 6,
  scoring: 7,
  done: 7,
};

const SOURCE_DISPLAY_NAMES: Record<string, { en: string; vi: string }> = {
  openalex: { en: 'OpenAlex', vi: 'OpenAlex' },
  crossref: { en: 'Crossref', vi: 'Crossref' },
  semanticscholar: { en: 'Semantic Scholar', vi: 'Semantic Scholar' },
  semantic_scholar: { en: 'Semantic Scholar', vi: 'Semantic Scholar' },
  arxiv: { en: 'arXiv', vi: 'arXiv' },
  pubmed: { en: 'PubMed', vi: 'PubMed' },
  europepmc: { en: 'Europe PMC', vi: 'Europe PMC' },
  europe_pmc: { en: 'Europe PMC', vi: 'Europe PMC' },
  dblp: { en: 'DBLP', vi: 'DBLP' },
  openlibrary: { en: 'Open Library', vi: 'Open Library' },
  open_library: { en: 'Open Library', vi: 'Open Library' },
  datacite: { en: 'DataCite', vi: 'DataCite' },
  doi_ra: { en: 'Global DOI Registry', vi: 'Hệ thống DOI quốc tế' },
  doaj: { en: 'DOAJ', vi: 'DOAJ' },
  openaire_hal: { en: 'OpenAIRE / HAL', vi: 'OpenAIRE / HAL' },
  ncbi_biorxiv: { en: 'PubMed / bioRxiv', vi: 'PubMed / bioRxiv' },
  huggingface: { en: 'Hugging Face', vi: 'Hugging Face' },
  wikidata_opencitations: { en: 'Wikidata / OpenCitations', vi: 'Wikidata / OpenCitations' },
  wikidata_opencitatio: { en: 'Wikidata / OpenCitations', vi: 'Wikidata / OpenCitations' },
  tech_standard: { en: 'Technical Standards', vi: 'Tiêu chuẩn kỹ thuật' },
  vn_tech_standard: { en: 'Vietnam Standards', vi: 'Tiêu chuẩn Quốc gia VN' },
  vn_textbook_registry: { en: 'Vietnam Textbooks', vi: 'Danh mục giáo trình VN' },
  vn_legal_registry: { en: 'Vietnam Legal Database', vi: 'Cơ sở dữ liệu Pháp luật VN' },
  vn_registry: { en: 'Vietnam Academic Registry', vi: 'Danh mục học thuật VN' },
  web_html_meta: { en: 'Source Web Page', vi: 'Trang web gốc' },
  html_head: { en: 'Source Web Page', vi: 'Trang web gốc' },
  wayback_html_meta: { en: 'Web Archive', vi: 'Kho lưu trữ web' },
  serpapi: { en: 'Google Scholar', vi: 'Google Scholar' },
  local_db: { en: 'CITRA Scholarly Library', vi: 'Thư viện học thuật CITRA' },
  known_papers: { en: 'CITRA Scholarly Library', vi: 'Thư viện học thuật CITRA' },
};

function pluralEn(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

function fixEnglishPluralization(text: string): string {
  return text
    .replace(/\b1\s+files\b/gi, '1 file')
    .replace(/\b1\s+databases\b/gi, '1 database')
    .replace(/\b1\s+registries\b/gi, '1 registry')
    .replace(/\b1\s+pages\b/gi, '1 page')
    .replace(/\b1\s+citations\b/gi, '1 citation')
    .replace(/\b1\s+references\b/gi, '1 reference')
    .replace(/\b1\s+source hits\b/gi, '1 source hit');
}

function formatLiveSourceName(key: string, lang: 'vi' | 'en'): string {
  const normalized = key.trim().toLowerCase();
  const entry = SOURCE_DISPLAY_NAMES[normalized];
  if (entry) {
    return lang === 'vi' ? entry.vi : entry.en;
  }
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function formatProcessingError(
  rawError: unknown,
  lang: 'vi' | 'en',
  fallback?: string,
): string {
  const raw =
    typeof rawError === 'string'
      ? rawError
      : rawError instanceof Error
        ? rawError.message
        : '';
  if (/processing\s+timeout/i.test(raw)) {
    return lang === 'vi'
      ? 'Quá thời gian xử lý. Vui lòng thử kiểm tra lại sau ít phút.'
      : 'Verification took too long and timed out. Please try again.';
  }
  if (/unable\s+to\s+fetch\s+processing\s+status|failed\s+to\s+retrieve\s+status/i.test(raw)) {
    return lang === 'vi'
      ? 'Không thể cập nhật tiến trình do gián đoạn kết nối. Vui lòng tải lại trang hoặc thử lại.'
      : 'Lost connection while checking progress. Please refresh or try again.';
  }
  if (/retry\s+failed/i.test(raw)) {
    return lang === 'vi'
      ? 'Không thể chạy lại kiểm tra lúc này. Vui lòng thử lại sau.'
      : 'Could not restart the check right now. Please try again.';
  }
  if (/upload\s+failed/i.test(raw)) {
    return lang === 'vi'
      ? 'Không thể tải tệp lên. Vui lòng kiểm tra kết nối và thử lại.'
      : 'Could not upload this file. Please check your connection and try again.';
  }
  return formatUserError(rawError, lang, fallback);
}

function formatStep1SubStageLine(
  rawMessage: string | null | undefined,
  lang: 'vi' | 'en',
): string | null {
  const clean = (rawMessage ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (!clean) return null;

  const lower = clean.toLowerCase();
  if (
    lower === 'starting analysis...' ||
    lower === 'parsing document...' ||
    lower === 'processing...' ||
    /^parsing (?:pdf|docx|bibtex|ris) structure\.{0,3}$/.test(lower)
  ) {
    return null;
  }

  const pageMatch = clean.match(/(\d+)\s*(?:-|\s*)pages?/i);
  const pageCount = pageMatch ? Number(pageMatch[1]) : null;
  const refMatch = clean.match(/(\d+)\s+references?/i);
  const refCount = refMatch ? Number(refMatch[1]) : null;

  if (lower.includes('loaded cached grobid')) {
    return lang === 'vi'
      ? `[01/08] Đã tải nhanh cấu trúc tài liệu từ bộ nhớ đệm${pageCount ? ` (${pageCount} trang)` : ''}`
      : `[01/08] Loaded cached document structure${pageCount ? ` (${pluralEn(pageCount, 'page', 'pages')})` : ''}`;
  }

  if (lower.includes('checking grobid layout cache')) {
    return lang === 'vi'
      ? `[01/08] Đã đọc văn bản${pageCount ? ` (${pageCount} trang)` : ''} · Kiểm tra dữ liệu bố cục`
      : `[01/08] Extracted document text${pageCount ? ` (${pluralEn(pageCount, 'page', 'pages')})` : ''} · Checking cached layout`;
  }

  if (lower.includes('analyzing') && lower.includes('grobid')) {
    return lang === 'vi'
      ? `[01/08] Đang phân tích cấu trúc tài liệu${pageCount ? ` (${pageCount} trang)` : ''}…`
      : `[01/08] Analyzing document structure${pageCount ? ` (${pluralEn(pageCount, 'page', 'pages')})` : ''}…`;
  }

  if (lower.includes('grobid parsed')) {
    return lang === 'vi'
      ? `[01/08] Đã tách ${refCount ?? 0} tài liệu tham khảo · Hợp nhất trích dẫn`
      : `[01/08] Parsed ${pluralEn(refCount ?? 0, 'reference', 'references')} · Merging citations`;
  }

  if (
    lower.includes('falling back to regex') ||
    lower.includes('using regex parser')
  ) {
    const isFallback = lower.includes('grobid') || lower.includes('falling back');
    if (isFallback) {
      return lang === 'vi'
        ? `[01/08] Đang đọc cấu trúc văn bản ở chế độ tương thích${pageCount ? ` (${pageCount} trang)` : ''}`
        : `[01/08] Reading document layout in compatibility mode${pageCount ? ` (${pluralEn(pageCount, 'page', 'pages')})` : ''}`;
    }
    return lang === 'vi'
      ? `[01/08] Đang phân tích cấu trúc văn bản${pageCount ? ` (${pageCount} trang)` : ''}`
      : `[01/08] Analyzing structural text layout${pageCount ? ` (${pluralEn(pageCount, 'page', 'pages')})` : ''}`;
  }

  if (lower.includes('scanned pdf detected')) {
    return lang === 'vi'
      ? `[01/08] Phát hiện PDF dạng ảnh quét${pageCount ? ` (${pageCount} trang)` : ''} · Kiểm tra khôi phục văn bản`
      : `[01/08] Scanned PDF detected${pageCount ? ` (${pluralEn(pageCount, 'page', 'pages')})` : ''} · Running text recovery checks`;
  }

  if (lower.includes('segmenting sections')) {
    return lang === 'vi'
      ? `[01/08] Đã đọc nội dung tài liệu${pageCount ? ` (${pageCount} trang)` : ''} · Phân vùng các mục`
      : `[01/08] Extracted document content${pageCount ? ` (${pluralEn(pageCount, 'page', 'pages')})` : ''} · Segmenting sections`;
  }

  return null;
}

function localizeLiveStatusMessage(
  rawMessage: string | null | undefined,
  lang: 'vi' | 'en',
  stepIndex: number,
  queuePos: number | null,
): string {
  const clean = (rawMessage ?? '').replace(/[\r\n]+/g, ' ').trim();
  const safeStep = STEP_LABELS[Math.max(0, Math.min(stepIndex, STEP_LABELS.length - 1))];

  if (!clean) {
    return lang === 'vi' ? `${safeStep.detailsVi}…` : `${safeStep.detailsEn}…`;
  }

  const lower = clean.toLowerCase();

  if (lang === 'en') {
    const sanitizedEn = fixEnglishPluralization(clean)
      .replace(/\bGROBID\s+TEI-XML\b/gi, 'document structure')
      .replace(/\bwith\s+GROBID\b/gi, 'structure')
      .replace(/\bGROBID\s+layout\s+cache\b/gi, 'cached layout')
      .replace(/\bGROBID\b/gi, 'document reader')
      .replace(/\b(?:smart\s+)?admission\s+queue\b/gi, 'waiting line')
      .replace(/\bFIFO\s+queue\b/gi, 'waiting line')
      .replace(/\bregex\s+parser\b/gi, 'compatibility reader')
      .replace(/\bmetadata\b/gi, 'citation details');
    return sanitizedEn;
  }

  // Vietnamese localization for live backend SSE messages
  const pageMatch = clean.match(/(\d+)\s*(?:-|\s*)pages?/i);
  const pageCount = pageMatch ? Number(pageMatch[1]) : null;
  const refMatch = clean.match(/(\d+)\s+references?/i);
  const refCount = refMatch ? Number(refMatch[1]) : null;
  const citMatch = clean.match(/(\d+)\s+citations?/i);
  const citCount = citMatch ? Number(citMatch[1]) : null;

  if (lower.includes('queued') || lower.includes('fifo queue') || lower.includes('admission queue')) {
    const posMatch = clean.match(/#(\d+)/);
    const pos = posMatch ? Number(posMatch[1]) : queuePos;
    return pos != null
      ? `Đang xếp hàng chờ xử lý (Vị trí #${pos})…`
      : 'Đang xếp hàng chờ xử lý…';
  }
  if (lower.includes('starting analysis')) {
    return 'Đang khởi tạo quá trình kiểm chứng tài liệu…';
  }
  if (lower.includes('loaded cached grobid')) {
    return pageCount
      ? `Đã tải nhanh cấu trúc tài liệu (${pageCount} trang) từ bộ nhớ đệm…`
      : 'Đã tải nhanh cấu trúc tài liệu từ bộ nhớ đệm…';
  }
  if (lower.includes('checking grobid layout cache')) {
    return pageCount
      ? `Đã đọc văn bản từ ${pageCount} trang · Đang chuẩn bị phân tích cấu trúc…`
      : 'Đã đọc văn bản · Đang chuẩn bị phân tích cấu trúc…';
  }
  if (lower.includes('analyzing') && (lower.includes('grobid') || lower.includes('layout'))) {
    return pageCount
      ? `Đang phân tích cấu trúc tài liệu (${pageCount} trang)…`
      : 'Đang phân tích cấu trúc tài liệu…';
  }
  if (lower.includes('grobid parsed')) {
    return `Đã trích xuất ${refCount ?? 0} tài liệu tham khảo · Đang hợp nhất trích dẫn…`;
  }
  if (lower.includes('regex parser') || lower.includes('falling back to regex')) {
    return pageCount
      ? `Đang phân tích cấu trúc văn bản (${pageCount} trang)…`
      : 'Đang phân tích cấu trúc văn bản…';
  }
  if (lower.includes('scanned pdf detected')) {
    return pageCount
      ? `Phát hiện tài liệu PDF dạng ảnh quét (${pageCount} trang) · Đang kiểm tra khôi phục văn bản…`
      : 'Phát hiện tài liệu PDF dạng ảnh quét · Đang kiểm tra khôi phục văn bản…';
  }
  if (lower.includes('parsing')) {
    return 'Đang đọc cấu trúc và nội dung tài liệu…';
  }
  if (lower.includes('detecting citation style') || lower.includes('style')) {
    return 'Đang nhận diện chuẩn trích dẫn học thuật…';
  }
  const linkedPairMatch = clean.match(/linked\s+(\d+)\s+of\s+(\d+)\s+references?/i);
  if (linkedPairMatch) {
    return `Đã liên kết ${linkedPairMatch[1]} / ${linkedPairMatch[2]} tài liệu tham khảo`;
  }
  if (lower.includes('linking')) {
    return 'Đang liên kết trích dẫn trong bài với danh mục tham khảo…';
  }
  if (lower.includes('extract')) {
    if (citCount != null && refCount != null) {
      return `Đã tìm thấy ${citCount} trích dẫn và ${refCount} tài liệu tham khảo`;
    }
    return 'Đang trích xuất trích dẫn và danh mục tham khảo…';
  }
  const comparedMatch = clean.match(/compared\s+(\d+)\s+source\s+hits?\s+across\s+(\d+)\s+databases?/i);
  if (comparedMatch) {
    return `Đã đối chiếu ${comparedMatch[1]} kết quả từ ${comparedMatch[2]} thư viện học thuật`;
  }
  if (
    lower.includes('querying') ||
    lower.includes('retrieving') ||
    lower.includes('searching') ||
    lower.includes('looking up')
  ) {
    return 'Đang tra cứu nguồn trên các thư viện học thuật…';
  }
  if (lower.includes('comparing') || lower.includes('matching')) {
    return 'Đang đối chiếu tiêu đề, tác giả, năm xuất bản và mã DOI…';
  }
  if (lower.includes('rule') || lower.includes('checking') || lower.includes('evaluating') || lower.includes('verif')) {
    return 'Đang kiểm tra độ chính xác và tính toàn vẹn của từng trích dẫn…';
  }
  if (lower.includes('cis') || lower.includes('scoring') || lower.includes('generating report')) {
    return 'Đang tính điểm toàn vẹn trích dẫn (CIS) và tạo báo cáo…';
  }
  if (lower.includes('complete') || lower === 'done') {
    return 'Kiểm chứng hoàn tất!';
  }

  // If the backend already sent a Vietnamese message (contains Vietnamese diacritics), keep it
  if (/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(clean)) {
    return clean;
  }

  // Otherwise show the friendly localized step description instead of raw English logs
  return `${safeStep.detailsVi}…`;
}

function buildPipelineReasoningLines(
  status: EssayStatus,
  effectiveStepIndex: number,
  liveSourcesEntries: Array<[string, unknown]>,
  lang: 'vi' | 'en',
  step1SubLines: string[] = [],
): string[] {
  const lines: string[] = [];

  lines.push(
    lang === 'vi'
      ? '[01/08] Đọc cấu trúc & phân vùng nội dung tài liệu'
      : '[01/08] Reading document layout and section structure',
  );

  for (const subLine of step1SubLines) {
    if (subLine && lines[lines.length - 1] !== subLine) {
      lines.push(subLine);
    }
  }

  if (effectiveStepIndex >= 1) {
    lines.push(
      lang === 'vi'
        ? '[02/08] Nhận diện chuẩn trích dẫn học thuật (APA, IEEE, MLA…)'
        : '[02/08] Identifying citation style conventions (APA, IEEE, MLA…)',
    );
  }

  if (
    effectiveStepIndex >= 2 ||
    status.citations_found > 0 ||
    status.references_found > 0
  ) {
    lines.push(
      lang === 'vi'
        ? `[03/08] Trích xuất ${status.citations_found} trích dẫn & ${status.references_found} tài liệu tham khảo`
        : `[03/08] Extracted ${pluralEn(status.citations_found, 'in-text citation', 'in-text citations')} & ${pluralEn(status.references_found, 'reference', 'references')}`,
    );
  }

  if (effectiveStepIndex >= 3 || status.linked > 0) {
    lines.push(
      lang === 'vi'
        ? `[04/08] Đã liên kết ${status.linked} cặp trích dẫn với danh mục tham khảo`
        : `[04/08] Linked ${pluralEn(status.linked, 'citation', 'citations')} to bibliography entries`,
    );
  }

  if (effectiveStepIndex >= 4 || liveSourcesEntries.length > 0) {
    const sourcePreview =
      liveSourcesEntries
        .slice(0, 4)
        .map(([k]) => formatLiveSourceName(k, lang))
        .join(' · ') || 'Crossref · OpenAlex';
    const hasExactCount = liveSourcesEntries.length > 0;
    const countTextEn = hasExactCount
      ? pluralEn(liveSourcesEntries.length, 'academic library', 'academic libraries')
      : `${SCHOLARLY_APIS_LABEL} academic libraries`;
    const countTextVi = hasExactCount
      ? `${liveSourcesEntries.length} thư viện học thuật`
      : `${SCHOLARLY_APIS_LABEL} thư viện học thuật`;
    lines.push(
      lang === 'vi'
        ? `[05/08] Đang tra cứu ${countTextVi} (${sourcePreview})`
        : `[05/08] Searching ${countTextEn} (${sourcePreview})`,
    );
  }

  if (effectiveStepIndex >= 5) {
    lines.push(
      lang === 'vi'
        ? '[06/08] Đối chiếu tiêu đề, tác giả, năm xuất bản và mã DOI với ấn phẩm gốc'
        : '[06/08] Comparing titles, authors, publication years, and DOIs',
    );
  }

  if (effectiveStepIndex >= 6) {
    lines.push(
      lang === 'vi'
        ? `[07/08] Rà soát ${SYMBOLIC_RULES_COUNT} tiêu chí toàn vẹn trích dẫn & kiểm tra liên kết`
        : `[07/08] Checking ${SYMBOLIC_RULES_COUNT} citation accuracy & integrity rules`,
    );
  }

  if (effectiveStepIndex >= 7) {
    lines.push(
      lang === 'vi'
        ? '[08/08] Tổng hợp điểm toàn vẹn trích dẫn (CIS) và tạo báo cáo'
        : '[08/08] Calculating Citation Integrity Score (CIS) and building report',
    );
  }

  return lines;
}

function classifyLiveSourceTone(rawStatus: string): {
  dotClass: string;
  pillClass: string;
  isRateLimited: boolean;
} {
  const val = rawStatus.trim().toLowerCase();
  if (
    val === 'rate_limited' ||
    val.startsWith('rate_limited') ||
    val === '429' ||
    val === 'http_429'
  ) {
    return {
      dotClass: 'bg-amber-500 animate-pulse',
      pillClass:
        'bg-amber-50/90 dark:bg-amber-950/60 border-amber-300/85 dark:border-amber-700/80 text-amber-800 dark:text-amber-200',
      isRateLimited: true,
    };
  }
  if (val === 'ok' || val === 'done' || val === 'hit' || val === 'success') {
    return {
      dotClass: 'bg-emerald-500',
      pillClass:
        'bg-emerald-50/80 dark:bg-emerald-950/50 border-emerald-200/80 dark:border-emerald-800/70 text-emerald-800 dark:text-emerald-200',
      isRateLimited: false,
    };
  }
  if (
    val.startsWith('failed') ||
    val.startsWith('error') ||
    val.startsWith('timeout') ||
    val === 'circuit_open'
  ) {
    return {
      dotClass: 'bg-rose-500',
      pillClass:
        'bg-rose-50/80 dark:bg-rose-950/50 border-rose-200/80 dark:border-rose-800/70 text-rose-800 dark:text-rose-200',
      isRateLimited: false,
    };
  }
  if (
    val === 'partial' ||
    val === 'empty' ||
    val === 'miss' ||
    val === '0' ||
    val === 'skipped'
  ) {
    return {
      dotClass: 'bg-slate-400 dark:bg-slate-500',
      pillClass:
        'bg-slate-100/80 dark:bg-slate-800/70 border-slate-200/80 dark:border-slate-700 text-slate-600 dark:text-slate-300',
      isRateLimited: false,
    };
  }
  return {
    dotClass: 'bg-indigo-500 animate-pulse',
    pillClass:
      'bg-indigo-50/80 dark:bg-indigo-950/50 border-indigo-200/80 dark:border-indigo-800/70 text-indigo-800 dark:text-indigo-200',
    isRateLimited: false,
  };
}

function stepStatus(
  idx: number,
  backendIndex: number,
  done: boolean,
  failed: boolean = false,
): 'completed' | 'active' | 'pending' | 'error' {
  if (done) return 'completed';
  if (idx < backendIndex) return 'completed';
  if (idx === backendIndex) return failed ? 'error' : 'active';
  return 'pending';
}

export function ProcessingPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const lang = resolveAcademicLang(i18n.resolvedLanguage || i18n.language);
  const { refreshUser } = useAuth();
  const {
    activeSingleCheck,
    syncSingleCheckFromStatus,
    acknowledgeSingleCheck,
    registerProcessingPageMount,
  } = useVerificationProgress();

  const numericId = id ? parseInt(id, 10) : null;
  const essayId = numericId !== null && !isNaN(numericId) ? numericId : null;

  const initialSeededStep =
    essayId !== null &&
    activeSingleCheck?.essayId === essayId &&
    activeSingleCheck.status === 'processing' &&
    activeSingleCheck.stepIndex > 0
      ? Math.min(activeSingleCheck.stepIndex, STEP_LABELS.length - 1)
      : 0;

  const [statusEntry, setStatusEntry] = useState<{
    essayId: number;
    snap: EssayStatus;
  } | null>(null);
  const status =
    essayId !== null && statusEntry?.essayId === essayId
      ? statusEntry.snap
      : null;
  const [displayedStepIndex, setDisplayedStepIndex] =
    useState<number>(initialSeededStep);
  const [step1SubMessages, setStep1SubMessages] = useState<string[]>([]);
  const [redirecting, setRedirecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [finalElapsedSeconds, setFinalElapsedSeconds] = useState<number | null>(
    null,
  );
  const [retryRunSeq, setRetryRunSeq] = useState(0);
  const [reanalyzing, setReanalyzing] = useState(false);
  const refundedRunKeyRef = useRef<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const seeded =
      essayId !== null &&
      activeSingleCheck?.essayId === essayId &&
      activeSingleCheck.status === 'processing' &&
      activeSingleCheck.stepIndex > 0
        ? Math.min(activeSingleCheck.stepIndex, STEP_LABELS.length - 1)
        : 0;
    setDisplayedStepIndex(seeded);
    setStep1SubMessages([]);
    setRedirecting(false);
    setErrorMsg(null);
    setFinalElapsedSeconds(null);
    refundedRunKeyRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [essayId]);

  useEffect(() => {
    if (status?.status === 'failed' && status?.quota_charged === false) {
      const runKey = `${essayId ?? 'none'}:${retryRunSeq}`;
      if (refundedRunKeyRef.current !== runKey) {
        refundedRunKeyRef.current = runKey;
        void refreshUser();
      }
    } else if (status && status.status !== 'failed') {
      refundedRunKeyRef.current = null;
    }
  }, [essayId, retryRunSeq, status, refreshUser]);

  useEffect(
    () => registerProcessingPageMount(essayId),
    [essayId, registerProcessingPageMount],
  );

  useEffect(() => {
    if (essayId === null) return;
    let cancelled = false;
    let consecutiveErrors = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    const controller = new AbortController();

    const applySnap = (snap: EssayStatus) => {
      if (cancelled) return;
      consecutiveErrors = 0;
      setStatusEntry((prev) => {
        const prevSame = prev && prev.essayId === essayId ? prev.snap : null;
        const merged: EssayStatus = {
          ...(prevSame ?? {}),
          ...snap,
          quota_charged:
            snap.quota_charged !== undefined
              ? snap.quota_charged
              : prevSame?.quota_charged,
          document_diagnostics:
            snap.document_diagnostics != null
              ? snap.document_diagnostics
              : (prevSame?.document_diagnostics ?? snap.document_diagnostics),
        };
        return { essayId, snap: merged };
      });
      syncSingleCheckFromStatus(essayId, snap);
      if (
        snap.status === 'processing' &&
        snap.step === 'parsing' &&
        snap.message
      ) {
        const cleanMsg = snap.message.replace(/[\r\n]+/g, ' ').trim();
        if (cleanMsg && formatStep1SubStageLine(cleanMsg, 'en') !== null) {
          setStep1SubMessages((prev) =>
            prev.includes(cleanMsg) ? prev : [...prev, cleanMsg].slice(-8),
          );
        }
      }
      if (snap.status === 'failed') {
        setRedirecting(false);
        setErrorMsg(snap.error);
        if (
          typeof snap.elapsed_seconds === 'number' &&
          Number.isFinite(snap.elapsed_seconds)
        ) {
          setFinalElapsedSeconds(Math.max(0, snap.elapsed_seconds));
        }
        void queryClient.invalidateQueries({ queryKey: ['essays'] });
      } else if (snap.status === 'completed') {
        setErrorMsg(null);
        if (
          typeof snap.elapsed_seconds === 'number' &&
          Number.isFinite(snap.elapsed_seconds)
        ) {
          setFinalElapsedSeconds(Math.max(0, snap.elapsed_seconds));
        }
      }
    };

    const tick = async () => {
      try {
        const snap = await api.getEssayStatus(essayId, {
          signal: controller.signal,
        });
        if (cancelled) return;
        applySnap(snap);
        if (snap.status === 'failed' || snap.status === 'completed') {
          if (timer) clearInterval(timer);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        consecutiveErrors += 1;
        if (!cancelled && consecutiveErrors >= 5) {
          if (timer) clearInterval(timer);
          const failedSnap: EssayStatus = {
            status: 'failed',
            step: 'parsing',
            step_index: 0,
            total_steps: 8,
            message: 'Failed to retrieve status',
            citations_found: 0,
            references_found: 0,
            linked: 0,
            sources_queried: {},
            elapsed_seconds: 0,
            finished_at: Date.now(),
            error:
              err instanceof Error
                ? err.message
                : 'Unable to fetch processing status.',
          };
          applySnap(failedSnap);
        }
      }
    };

    void (async () => {
      const streamed = await streamEssayEvents(
        essayId,
        applySnap,
        controller.signal,
      );
      if (cancelled || streamed) return;
      void tick();
      timer = setInterval(tick, 800);
    })();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [essayId, retryRunSeq, queryClient, syncSingleCheckFromStatus]);

  const handleRetryAnalysis = async () => {
    if (
      essayId === null ||
      reanalyzing ||
      typeof api.reanalyzeEssay !== 'function'
    )
      return;
    setReanalyzing(true);
    try {
      await api.reanalyzeEssay(essayId);
      refundedRunKeyRef.current = null;
      setDisplayedStepIndex(0);
      setStep1SubMessages([]);
      setRedirecting(false);
      setErrorMsg(null);
      setFinalElapsedSeconds(null);
      setStatusEntry(null);
      void refreshUser();
      void queryClient.invalidateQueries({ queryKey: ['essays'] });
      setRetryRunSeq((s) => s + 1);
    } catch (err) {
      setErrorMsg(
        formatProcessingError(
          err,
          lang,
          lang === 'vi'
            ? 'Không thể thử lại lúc này. Vui lòng thử lại sau.'
            : 'Unable to retry verification right now.',
        ),
      );
    } finally {
      setReanalyzing(false);
    }
  };

  const rawStepIndex = status
    ? typeof status.step_index === 'number' && Number.isFinite(status.step_index)
      ? status.step_index
      : (STEP_KEY_TO_INDEX[status.step] ?? 0)
    : 0;
  const backendIndex = Math.max(
    0,
    Math.min(rawStepIndex, STEP_LABELS.length - 1),
  );

  const isDone = status?.status === 'completed';
  const isFailed = status?.status === 'failed';
  const isQueued = status
    ? status.status === 'queued'
    : essayId !== null &&
      activeSingleCheck?.essayId === essayId &&
      activeSingleCheck.status === 'queued';
  const queuePos =
    status?.queue_position ??
    (essayId !== null && activeSingleCheck?.essayId === essayId
      ? activeSingleCheck.queuePosition
      : null);

  const targetStepIndex = isQueued
    ? 0
    : isDone
      ? STEP_LABELS.length
      : backendIndex;

  useEffect(() => {
    if (essayId === null) return;
    if (isQueued) {
      setDisplayedStepIndex(0);
      return;
    }
    if (isFailed) {
      setDisplayedStepIndex(backendIndex);
      return;
    }
    if (displayedStepIndex >= targetStepIndex) {
      return;
    }
    const stepTimer = setTimeout(() => {
      setDisplayedStepIndex((prev) => Math.min(prev + 1, targetStepIndex));
    }, 220);
    return () => clearTimeout(stepTimer);
  }, [essayId, displayedStepIndex, targetStepIndex, isQueued, isFailed, backendIndex]);

  const effectiveStepIndex = isFailed ? backendIndex : displayedStepIndex;
  const visualDone =
    isDone && !isFailed && displayedStepIndex >= STEP_LABELS.length;

  useEffect(() => {
    if (essayId === null) return;
    if (isFailed) {
      setRedirecting(false);
      return;
    }
    if (!visualDone) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (cancelled) return;
      setRedirecting(true);
      timer = setTimeout(() => {
        acknowledgeSingleCheck(essayId);
        navigate(`/verification/report/${id}`);
      }, 1200);
    };

    void queryClient.invalidateQueries({ queryKey: ['essays'] });
    api
      .getEssay(essayId)
      .then((report) => {
        if (report) queryClient.setQueryData(['essay-report', essayId], report);
      })
      .catch(() => {})
      .finally(finish);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    essayId,
    visualDone,
    isFailed,
    id,
    navigate,
    queryClient,
    acknowledgeSingleCheck,
  ]);

  // BUG-24: When navigated to /verification/processing without an :id,
  // either reconnect to an active in-flight single check OR show a friendly empty state.
  if (essayId === null) {
    if (
      activeSingleCheck?.essayId != null &&
      (activeSingleCheck.status === 'queued' ||
        activeSingleCheck.status === 'processing')
    ) {
      return (
        <Navigate
          to={`/verification/processing/${activeSingleCheck.essayId}`}
          replace
        />
      );
    }

    return (
      <div
        data-testid="processing-empty-state"
        className="citra-cq-page-narrow w-full max-w-2xl mx-auto py-12 px-4"
      >
        <Card className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-8 sm:p-10 text-center shadow-sm space-y-5">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/70 dark:border-indigo-800/70 mx-auto">
            <FileCheck className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="space-y-2">
            <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
              {lang === 'vi'
                ? 'Hiện không có bài viết nào đang xử lý'
                : 'No active verification in progress'}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
              {lang === 'vi'
                ? 'Tải lên một tài liệu mới để theo dõi quá trình kiểm chứng theo thời gian thực, hoặc xem lại các báo cáo đã hoàn tất trong lịch sử.'
                : 'Upload a new document to follow live citation verification, or review your completed reports in History.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button
              asChild
              className="h-10 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
            >
              <Link to="/upload">
                <Upload className="h-4 w-4" />
                <span>
                  {lang === 'vi' ? 'Kiểm tra tài liệu mới' : 'New Verification'}
                </span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-10 px-5 rounded-xl">
              <Link to="/history">
                <History className="h-4 w-4" />
                <span>
                  {lang === 'vi' ? 'Xem lịch sử báo cáo' : 'View History'}
                </span>
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // BUG-24: Synchronize progress percentage with VerificationProgressContext's canonical formula
  const effectiveProgress = isQueued
    ? 0
    : visualDone
      ? 100
      : status
        ? computeSingleCheckProgress(status)
        : activeSingleCheck?.essayId === essayId
          ? activeSingleCheck.progress
          : 0;

  const trackedFilename =
    activeSingleCheck?.essayId === essayId &&
    activeSingleCheck.filename &&
    !activeSingleCheck.filename.startsWith('ID #')
      ? activeSingleCheck.filename
      : null;

  const liveSourcesEntries = Object.entries(status?.sources_queried ?? {});
  const diagnostics = status?.document_diagnostics ?? null;
  const ocrRecoveredPages = diagnostics?.ocr_pages_recovered ?? [];
  const legacyEncoding = diagnostics?.legacy_encoding_detected ?? null;
  const legacyPagesCount = diagnostics?.legacy_encoding_pages_count ?? null;
  const step1SubLines = step1SubMessages
    .map((msg) => formatStep1SubStageLine(msg, lang))
    .filter((line): line is string => Boolean(line));

  const statusPillLabel = isFailed
    ? lang === 'vi'
      ? 'Gặp sự cố'
      : 'Failed'
    : visualDone
      ? lang === 'vi'
        ? 'Hoàn tất'
        : 'Complete'
      : isQueued
        ? lang === 'vi'
          ? `Đang xếp hàng${queuePos ? ` (#${queuePos})` : ''}`
          : `Queued${queuePos ? ` (#${queuePos})` : ''}`
        : lang === 'vi'
          ? 'Đang xử lý'
          : 'In progress';

  const localizedLiveMessage = status
    ? localizeLiveStatusMessage(status.message, lang, effectiveStepIndex, queuePos)
    : '';

  return (
    <div className="citra-cq-page-narrow w-full max-w-4xl mx-auto space-y-6 pb-10 transition-[max-width] duration-300">
      {/* Header Banner */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-2 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {trackedFilename && (
              <Badge
                variant="outline"
                data-testid="processing-filename-badge"
                title={trackedFilename}
                className="font-mono text-[11px] max-w-[200px] sm:max-w-[280px] overflow-hidden"
              >
                <span className="block truncate min-w-0">{trackedFilename}</span>
              </Badge>
            )}
            {isQueued && queuePos !== null && (
              <Badge className="font-mono text-[11px] whitespace-nowrap shrink-0 bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-300 border border-amber-300/70 dark:border-amber-700/70">
                {lang === 'vi' ? `Hàng đợi #${queuePos}` : `Queue #${queuePos}`}
              </Badge>
            )}
            <LiveElapsedTimer
              key={essayId}
              status={status}
              frozenElapsedSeconds={finalElapsedSeconds}
            />
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            {isFailed
              ? lang === 'vi'
                ? 'Phân tích gặp sự cố'
                : 'Analysis failed'
              : visualDone
                ? lang === 'vi'
                  ? 'Phân tích hoàn tất'
                  : 'Analysis complete'
                : isQueued
                  ? lang === 'vi'
                    ? `Đang xếp hàng xử lý${queuePos ? ` (Vị trí #${queuePos})` : ''}`
                    : `Queued for analysis${queuePos ? ` (Position #${queuePos})` : ''}`
                  : lang === 'vi'
                    ? 'Đang kiểm chứng tài liệu học thuật'
                    : 'Verifying your document'}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {isFailed
              ? lang === 'vi'
                ? 'Quá trình phân tích đã dừng lại do gặp sự cố — bạn có thể xem chi tiết và thử lại bên dưới.'
                : 'The verification stopped due to an error — inspect details or retry below.'
              : visualDone
                ? lang === 'vi'
                  ? 'Đang chuyển hướng tới báo cáo kiểm chứng chi tiết…'
                  : 'Opening your verification report…'
                : isQueued
                  ? lang === 'vi'
                    ? 'Hệ thống đang điều phối lưu lượng theo thứ tự nộp để đảm bảo tốc độ ổn định khi tra cứu thư viện học thuật.'
                    : 'Your submission is queued in order to keep scholarly database lookups fast and reliable during peak traffic.'
                  : lang === 'vi'
                    ? 'Quá trình đọc tài liệu và đối chiếu thư viện học thuật thường mất 20–60 giây tùy độ dài tài liệu.'
                    : 'Reading your document and checking academic libraries typically takes 20–60 seconds depending on document length.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="rounded-xl shrink-0 whitespace-nowrap"
          >
            <Link to="/upload?new=1" data-testid="processing-new-upload-btn">
              <Upload className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>{t('upload.checkAnotherFile')}</span>
            </Link>
          </Button>
          {id && !isFailed && (
            isDone ? (
              <Button
                asChild
                size="sm"
                className="rounded-xl shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold whitespace-nowrap"
              >
                <Link
                  to={`/verification/report/${id}`}
                  data-testid="processing-open-report-btn"
                  onClick={() => acknowledgeSingleCheck(essayId)}
                >
                  <span>{lang === 'vi' ? 'Mở báo cáo' : 'Open Report'}</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled
                data-testid="processing-building-report-btn"
                className="rounded-xl shrink-0 opacity-65 cursor-not-allowed whitespace-nowrap"
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>
                  {lang === 'vi' ? 'Đang tạo báo cáo...' : 'Building report...'}
                </span>
              </Button>
            )
          )}
        </div>
      </div>

      {/* Queued waiting banner during high-traffic periods */}
      {isQueued && (
        <div
          data-testid="queued-processing-banner"
          className="rounded-2xl border border-indigo-200 dark:border-indigo-800/80 bg-indigo-50/80 dark:bg-indigo-950/40 p-4 text-xs text-indigo-900 dark:text-indigo-200 flex items-start gap-3"
        >
          <Loader2 className="h-5 w-5 text-indigo-600 dark:text-indigo-400 animate-spin shrink-0 mt-0.5" />
          <div>
            <p className="font-bold font-display">
              {lang === 'vi'
                ? `Bài viết đang chờ tới lượt kiểm tra${queuePos ? ` — Vị trí #${queuePos}` : ''}`
                : `Your document is waiting in line${queuePos ? ` — Position #${queuePos}` : ''}`}
            </p>
            <p className="mt-0.5 text-indigo-800/90 dark:text-indigo-300/90">
              {lang === 'vi'
                ? 'Trang này sẽ tự động cập nhật ngay khi tới lượt kiểm tra tài liệu của bạn — không cần tải lại trang.'
                : 'This page updates automatically as soon as your turn begins — no refresh needed.'}
            </p>
          </div>
        </div>
      )}

      {/* Failed Verification Alert + Quota Restored Reassurance + Action Buttons */}
      {isFailed && (
        <Alert
          variant="destructive"
          data-testid="failed-pipeline-alert"
          className="rounded-2xl border-rose-300 dark:border-rose-800 bg-rose-50/90 dark:bg-rose-950/40"
        >
          <AlertTriangle className="h-5 w-5" />
          <AlertTitle className="font-display font-bold">
            {lang === 'vi'
              ? 'Không thể hoàn tất kiểm tra'
              : 'Verification could not finish'}
          </AlertTitle>
          <AlertDescription className="space-y-3 mt-1.5">
            <p className="text-sm leading-relaxed">
              {formatProcessingError(
                errorMsg ?? status?.error,
                lang,
                lang === 'vi'
                  ? 'Đã xảy ra sự cố ngoài ý muốn — vui lòng thử kiểm tra lại tài liệu.'
                  : 'An unexpected error occurred — please try checking your document again.',
              )}
            </p>

            {status?.quota_charged === false && (
              <div
                data-testid="quota-refund-badge"
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200/90 dark:border-emerald-800/80 text-xs font-medium text-emerald-800 dark:text-emerald-200"
              >
                <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>
                  {lang === 'vi'
                    ? 'Lượt kiểm tra tháng này của bạn đã được hoàn lại (không bị trừ lượt)'
                    : 'This failed check was not counted against your monthly limit'}
                </span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              {typeof api.reanalyzeEssay === 'function' && (
                <Button
                  type="button"
                  size="sm"
                  data-testid="failed-reanalyze-btn"
                  disabled={reanalyzing}
                  onClick={() => void handleRetryAnalysis()}
                  className="rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${reanalyzing ? 'animate-spin' : ''}`}
                  />
                  <span>
                    {lang === 'vi' ? 'Thử lại phân tích' : 'Retry Analysis'}
                  </span>
                </Button>
              )}
              <Button
                asChild
                size="sm"
                className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
              >
                <Link
                  to="/upload"
                  data-testid="failed-upload-another-btn"
                  onClick={() => acknowledgeSingleCheck(essayId)}
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>
                    {lang === 'vi'
                      ? 'Tải lại tài liệu khác'
                      : 'Upload Another Document'}
                  </span>
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="rounded-xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200"
              >
                <Link
                  to="/history"
                  data-testid="failed-back-history-btn"
                  onClick={() => acknowledgeSingleCheck(essayId)}
                >
                  <History className="h-3.5 w-3.5" />
                  <span>
                    {lang === 'vi' ? 'Về Lịch sử kiểm tra' : 'Back to History'}
                  </span>
                </Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Scanned PDF Guardrail banner during/after processing */}
      {diagnostics?.is_scanned_pdf && (
        <div
          data-testid="scanned-pdf-processing-banner"
          className="rounded-2xl border border-amber-400 dark:border-amber-700 bg-amber-50/90 dark:bg-amber-950/60 p-4 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-3"
        >
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold font-display">
              {lang === 'vi'
                ? 'Phát hiện tệp PDF dạng ảnh chụp / quét'
                : 'Scanned PDF detected'}
            </p>
            <p className="mt-0.5">
              {lang === 'vi'
                ? 'Tệp PDF này là ảnh quét không chọn được chữ; hệ thống đang tự động đọc chữ từ trang ảnh khi có thể.'
                : 'This PDF looks like scanned page images rather than selectable text; CITRA is automatically reading text from the pages where supported.'}
            </p>
          </div>
        </div>
      )}

      {/* Early Legacy Vietnamese Font Normalization Info Pill */}
      {legacyEncoding && (
        <div
          data-testid="legacy-encoding-processing-banner"
          className="rounded-2xl border border-indigo-200 dark:border-indigo-800/80 bg-indigo-50/85 dark:bg-indigo-950/45 p-3.5 text-xs text-indigo-900 dark:text-indigo-200 flex items-start gap-3"
        >
          <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold font-display">
              {lang === 'vi'
                ? `Đã chuẩn hóa phông chữ tiếng Việt cũ để đọc chính xác dấu${legacyPagesCount ? ` (${legacyPagesCount} trang)` : ''}`
                : `Older Vietnamese font detected — normalized for accurate reading${legacyPagesCount ? ` (${pluralEn(legacyPagesCount, 'page', 'pages')})` : ''}`}
            </p>
          </div>
        </div>
      )}

      {/* Early Scanned Pages Read Info Pill */}
      {ocrRecoveredPages.length > 0 && (
        <div
          data-testid="ocr-recovered-processing-banner"
          className="rounded-2xl border border-teal-200 dark:border-teal-800/80 bg-teal-50/85 dark:bg-teal-950/45 p-3.5 text-xs text-teal-900 dark:text-teal-200 flex items-start gap-3"
        >
          <FileCheck className="h-4 w-4 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold font-display">
              {lang === 'vi'
                ? `Đọc trang ảnh quét: ${ocrRecoveredPages.length} trang (${ocrRecoveredPages.map((p) => `tr.${p}`).join(', ')})`
                : `Scanned text read: ${pluralEn(ocrRecoveredPages.length, 'page', 'pages')} (${ocrRecoveredPages.map((p) => `p.${p}`).join(', ')})`}
            </p>
          </div>
        </div>
      )}

      {/* 4 Live Progress Stat Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          icon={
            <Quote className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          }
          value={status?.citations_found ?? '—'}
          label={lang === 'vi' ? 'Trích dẫn' : 'Citations'}
        />
        <StatCard
          icon={
            <FileText className="h-4 w-4 text-slate-600 dark:text-slate-400" />
          }
          value={status?.references_found ?? '—'}
          label={lang === 'vi' ? 'Tài liệu tham khảo' : 'References'}
        />
        <StatCard
          icon={
            <GitMerge className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          }
          value={status?.linked ?? '—'}
          label={lang === 'vi' ? 'Đã liên kết' : 'Linked'}
          highlight
        />
        <StatCard
          icon={
            <Database className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          }
          value={
            visualDone || isDone
              ? (status?.references_found || status?.citations_found || 0)
              : liveSourcesEntries.length > 0
                ? liveSourcesEntries.length
                : '—'
          }
          label={
            visualDone || isDone
              ? lang === 'vi'
                ? 'Đã kiểm tra xong'
                : 'Verified'
              : lang === 'vi'
                ? 'Thư viện đã tra cứu'
                : 'Libraries checked'
          }
          highlight={visualDone || isDone}
        />
      </div>

      {/* Live Pipeline Progress Card */}
      <Card className="p-0 overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
        {/* Clean Card Header */}
        <div className="px-4 sm:px-6 py-3.5 bg-slate-50/80 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-sm font-bold text-slate-800 dark:text-slate-200">
            {lang === 'vi'
              ? 'Tiến trình kiểm chứng trích dẫn'
              : 'Live Verification Progress'}
          </h2>

          <div className="flex items-center gap-2 shrink-0">
            <span
              data-testid="processing-status-pill"
              className={`text-xs font-medium px-2.5 py-0.5 rounded-full border whitespace-nowrap ${
                isFailed
                  ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'
                  : visualDone
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                    : isQueued
                      ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800'
                      : 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800'
              }`}
            >
              {statusPillLabel}
            </span>
            <Badge
              variant="secondary"
              data-testid="processing-progress-percent"
              className={`font-mono text-xs whitespace-nowrap ${
                isFailed
                  ? 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                  : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
              }`}
            >
              <SubtleNumber value={effectiveProgress} suffix="%" />
            </Badge>
          </div>
        </div>

        <div className="p-4 sm:p-6 space-y-6">
          {/* Progress Bar & Live Localized Status Stream */}
          <div>
            <Progress value={effectiveProgress} className="h-2.5" />
            {status && !visualDone && !isFailed && (
              <>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-2.5 flex items-center gap-2">
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse shrink-0"
                    aria-hidden="true"
                  />
                  <ThinkingStateText text={localizedLiveMessage} />
                </p>
                {!isQueued && (
                  <ReasoningStream
                    data-testid="processing-reasoning-stream"
                    lines={buildPipelineReasoningLines(
                      status,
                      effectiveStepIndex,
                      liveSourcesEntries,
                      lang,
                      step1SubLines,
                    )}
                    visibleLines={3}
                    lineHeightPx={20}
                    stepMs={360}
                    className="mt-2.5 rounded-xl bg-slate-50/90 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800/80 px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300"
                  />
                )}
              </>
            )}
          </div>

          {/* 8-Step Pipeline Trace */}
          <div className="space-y-2.5">
            {STEP_LABELS.map((step, idx) => {
              const s = isQueued
                ? 'pending'
                : stepStatus(idx, effectiveStepIndex, visualDone, isFailed);

              return (
                <div
                  key={idx}
                  data-testid={`pipeline-step-${idx + 1}`}
                  data-step-status={s}
                  className={`flex items-start gap-3.5 p-3 rounded-xl border transition-[background-color,border-color,box-shadow] duration-200 ${
                    s === 'error'
                      ? 'bg-rose-50/70 dark:bg-rose-950/35 border-rose-300 dark:border-rose-800 shadow-sm'
                      : s === 'active'
                        ? 'bg-indigo-50/60 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700 shadow-sm'
                        : s === 'completed'
                          ? 'bg-emerald-50/30 dark:bg-emerald-950/15 border-emerald-200/70 dark:border-emerald-900/50'
                          : 'bg-slate-50/50 dark:bg-slate-950/40 border-slate-200/60 dark:border-slate-800/70'
                  }`}
                >
                  <div
                    className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-[background-color,border-color,box-shadow] duration-300 ${
                      s === 'error'
                        ? 'bg-rose-100 dark:bg-rose-900/60 border border-rose-200 dark:border-rose-800'
                        : s === 'completed'
                          ? 'bg-emerald-100 dark:bg-emerald-900/60'
                          : s === 'active'
                            ? 'bg-white dark:bg-slate-900 border border-indigo-200/90 dark:border-indigo-700/80 shadow-sm'
                            : 'bg-slate-200/70 dark:bg-slate-800'
                    }`}
                  >
                    {s === 'error' ? (
                      <XCircle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                    ) : s === 'completed' ? (
                      <SuccessCheck
                        size={16}
                        className="text-emerald-600 dark:text-emerald-400"
                      />
                    ) : s === 'active' ? (
                      <MatrixDotLoader variant="scan" />
                    ) : (
                      <Circle className="h-3.5 w-3.5 text-slate-400 dark:text-slate-600" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p
                        className={`text-sm font-medium transition-colors duration-200 ${
                          s === 'error'
                            ? 'text-rose-700 dark:text-rose-300 font-semibold'
                            : s === 'completed'
                              ? 'text-slate-900 dark:text-slate-100'
                              : s === 'active'
                                ? 'text-indigo-700 dark:text-indigo-300 font-semibold'
                                : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {lang === 'vi' ? step.labelVi : step.labelEn}
                      </p>
                      <div className="flex items-center gap-2 shrink-0">
                        {s === 'error' && (
                          <span
                            data-testid={`pipeline-step-error-badge-${idx + 1}`}
                            className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-950 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300"
                          >
                            <AlertCircle className="h-3 w-3" />
                            {lang === 'vi' ? 'Lỗi' : 'Failed'}
                          </span>
                        )}
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {lang === 'vi' ? step.tagVi : step.tagEn}
                        </span>
                        <span className="text-xs font-mono tabular-nums text-slate-400 dark:text-slate-500">
                          0{idx + 1}/0{STEP_LABELS.length}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {lang === 'vi' ? step.detailsVi : step.detailsEn}
                    </p>

                    {idx === 2 && status && effectiveStepIndex >= 2 && (
                      <div className="flex flex-wrap gap-2 sm:gap-3 mt-2 text-xs font-mono">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                          <Quote className="h-3 w-3 text-indigo-500" />
                          {lang === 'vi'
                            ? `${status.citations_found} trích dẫn`
                            : pluralEn(
                                status.citations_found,
                                'citation',
                                'citations',
                              )}
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                          <FileText className="h-3 w-3 text-emerald-500" />
                          {lang === 'vi'
                            ? `${status.references_found} tài liệu tham khảo`
                            : pluralEn(
                                status.references_found,
                                'reference',
                                'references',
                              )}
                        </span>
                      </div>
                    )}

                    {idx === 3 && status && effectiveStepIndex >= 3 && (
                      <div className="flex gap-3 mt-2 text-xs font-mono">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300">
                          <Check className="h-3 w-3" />
                          {lang === 'vi'
                            ? `${status.linked} đã liên kết`
                            : `${status.linked} linked`}
                        </span>
                      </div>
                    )}

                    {idx === 4 && liveSourcesEntries.length > 0 && (
                      <div
                        data-testid="live-sources-queried"
                        className="flex flex-wrap items-center gap-1.5 mt-2.5"
                      >
                        {liveSourcesEntries.map(([sourceKey, sourceState]) => {
                          const tone = classifyLiveSourceTone(
                            String(sourceState),
                          );
                          return (
                            <span
                              key={sourceKey}
                              data-testid={`live-source-pill-${sourceKey}`}
                              data-source-status={String(sourceState)}
                              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-medium ${tone.pillClass}`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full shrink-0 ${tone.dotClass}`}
                              />
                              <span className="font-semibold">
                                {formatLiveSourceName(sourceKey, lang)}
                              </span>
                              {tone.isRateLimited && (
                                <span
                                  data-testid={`live-source-rate-limited-${sourceKey}`}
                                  className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/70 border border-amber-300/80 dark:border-amber-700/80 text-[10px] font-bold tracking-tight text-amber-800 dark:text-amber-200"
                                >
                                  {lang === 'vi'
                                    ? 'Đang bận'
                                    : 'Busy — retrying'}
                                </span>
                              )}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Completion banner — strictly suppressed on failed jobs */}
      {(visualDone || redirecting) && !isFailed && (
        <div
          data-testid="processing-completion-banner"
          className="p-6 rounded-2xl bg-emerald-50/90 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center shadow-sm"
        >
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-900/60 mb-3">
            <FileCheck className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h3 className="font-display text-lg font-bold text-emerald-800 dark:text-emerald-200 mb-1">
            {lang === 'vi' ? 'Kiểm chứng hoàn tất!' : 'Analysis Complete'}
          </h3>
          <p className="text-sm text-emerald-700 dark:text-emerald-300">
            {lang === 'vi'
              ? 'Đang mở báo cáo kiểm chứng chi tiết…'
              : 'Opening your verification report…'}
          </p>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  value,
  label,
  highlight,
}: {
  icon: React.ReactNode;
  value: number | string;
  label: string;
  highlight?: boolean;
}) {
  return (
    <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm">
      <div className="flex items-center justify-between mb-2.5">
        <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800">
          {icon}
        </div>
      </div>
      <p
        className={`text-2xl font-bold font-mono tabular-nums ${
          highlight
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-slate-900 dark:text-slate-100'
        }`}
      >
        <SubtleNumber value={value} />
      </p>
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">
        {label}
      </p>
    </Card>
  );
}

function LiveElapsedTimer({
  status,
  frozenElapsedSeconds,
}: {
  status: EssayStatus | null;
  frozenElapsedSeconds?: number | null;
}) {
  const anchorRef = useRef<{ baseElapsed: number; baseTimeMs: number } | null>(
    null,
  );
  const prevTerminalRef = useRef<boolean>(false);
  const [displaySeconds, setDisplaySeconds] = useState<number>(0);

  const isTerminal =
    status?.status === 'completed' || status?.status === 'failed';
  const serverElapsed =
    status &&
    typeof status.elapsed_seconds === 'number' &&
    Number.isFinite(status.elapsed_seconds)
      ? Math.max(0, status.elapsed_seconds)
      : 0;

  useEffect(() => {
    if (!status) {
      anchorRef.current = null;
      prevTerminalRef.current = false;
      setDisplaySeconds(0);
      return;
    }

    const now = Date.now();
    const restartedAfterTerminal = prevTerminalRef.current && !isTerminal;
    prevTerminalRef.current = isTerminal;

    setDisplaySeconds((prev) => {
      if (restartedAfterTerminal) {
        anchorRef.current = { baseElapsed: serverElapsed, baseTimeMs: now };
        return serverElapsed;
      }
      const currentLive = anchorRef.current
        ? Math.max(
            prev,
            anchorRef.current.baseElapsed +
              Math.max(0, now - anchorRef.current.baseTimeMs) / 1000,
          )
        : prev;
      const synced = Math.max(currentLive, serverElapsed);
      anchorRef.current = { baseElapsed: synced, baseTimeMs: now };
      return synced;
    });
  }, [status, isTerminal, serverElapsed]);

  const hasStatus = Boolean(status);

  useEffect(() => {
    if (!hasStatus || isTerminal) return;

    const updateTick = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const elapsed =
        anchor.baseElapsed +
        Math.max(0, Date.now() - anchor.baseTimeMs) / 1000;
      setDisplaySeconds((prev) => (elapsed > prev ? elapsed : prev));
    };

    const interval = setInterval(updateTick, 100);
    const onVisibility = () => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible'
      ) {
        updateTick();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      clearInterval(interval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [hasStatus, isTerminal]);

  const shownSeconds = Math.max(
    displaySeconds,
    serverElapsed,
    isTerminal && typeof frozenElapsedSeconds === 'number'
      ? frozenElapsedSeconds
      : 0,
  );

  if (!status || (isTerminal && shownSeconds <= 0)) {
    return null;
  }

  return (
    <span
      data-testid="processing-elapsed-time"
      className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800/80 border border-slate-200/70 dark:border-slate-700 text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300"
    >
      <Clock className="h-3.5 w-3.5 shrink-0" />
      <span>{shownSeconds.toFixed(1)}s</span>
    </span>
  );
}
