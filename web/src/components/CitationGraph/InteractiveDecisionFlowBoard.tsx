import { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Link2,
  Sparkles,
  Globe,
  HeartPulse,
  Cpu,
  Library,
  Scale,
  Play,
  Square,
  ArrowUpRight,
  ExternalLink,
  MonitorPlay,
  FileSearch,
  FileText,
  Check,
  HelpCircle,
  X,
  Database,
  Search,
} from 'lucide-react';
import type { Citation, MatchedSource, Verdict } from '@/api/client';
import { useTheme } from '@/contexts/ThemeContext';
import { OverrideControls } from '../OverrideControls';
import { toSafeDoiHref, toSafeExternalHref } from '../../lib/utils';
import { DirectionalStageSlide, useSlidingPill } from '@/components/ui/transitions';
import {
  formatAcademicAuthorShort,
  getVerdictDisplay,
  looksLikeTitleSentence,
  resolveDisplayAuthors,
  splitRawAuthorString,
} from '@/lib/academicTaxonomy';
import {
  getCitationMarkerLabel,
  getVerdictExplanation,
  isLegalStatuteVerdict,
  isUrlResource,
} from '@/lib/verdictExplanation';

export interface InteractiveDecisionFlowBoardProps {
  verdict: Verdict;
  citedRef?: Pick<Citation, 'authors' | 'year' | 'title' | 'raw_text'> | null;
  markerLabel?: string;
  onInspectDetails?: (verdict: Verdict) => void;
  onOverride?: (
    verdict: Verdict,
    req: Parameters<typeof import('@/api/client').api.overrideVerdict>[1],
  ) => Promise<void>;
}

type Tone = 'emerald' | 'amber' | 'rose' | 'violet' | 'slate';
type BoardPhase = 'overview' | 'step-0' | 'step-1' | 'step-2' | 'step-3';

type FocusTarget =
  | { kind: 'hub' }
  | { kind: 'step'; index: 0 | 1 | 2 | 3 }
  | { kind: 'sat'; key: string };

/** Presenter-paced duration per Replay Act (2.4s per act = ~9.6s full story) */
const REPLAY_ACT_MS = 2400;

interface SatelliteClusterDef {
  key: string;
  nameVi: string;
  nameEn: string;
  domainVi: string;
  domainEn: string;
  sourceKeys: string[];
  xPct: number;
  yPct: number;
  side: 'left' | 'right';
  icon: typeof Globe;
}

const SATELLITE_CLUSTERS: SatelliteClusterDef[] = [
  {
    key: 'crossref',
    nameVi: 'Crossref · DOI',
    nameEn: 'Crossref · DOI',
    domainVi: '150M+ hồ sơ DOI nhà xuất bản quốc tế',
    domainEn: '150M+ publisher DOI records worldwide',
    sourceKeys: ['crossref', 'doi_ra', 'datacite'],
    xPct: 14,
    yPct: 18,
    side: 'left',
    icon: Globe,
  },
  {
    key: 'openalex',
    nameVi: 'OpenAlex',
    nameEn: 'OpenAlex',
    domainVi: '250M+ công trình & tạp chí học thuật toàn cầu',
    domainEn: '250M+ global scholarly works & venues',
    sourceKeys: ['openalex', 'wikidata_opencitations'],
    xPct: 12.5,
    yPct: 41,
    side: 'left',
    icon: Library,
  },
  {
    key: 'pubmed',
    nameVi: 'PubMed & Y sinh',
    nameEn: 'PubMed & Life Sci',
    domainVi: 'Thư viện Y khoa, Tâm lý & Sinh học quốc tế',
    domainEn: 'Biomedical, clinical & life-science literature',
    sourceKeys: ['europepmc', 'ncbi_biorxiv'],
    xPct: 13.5,
    yPct: 64,
    side: 'left',
    icon: HeartPulse,
  },
  {
    key: 'arxiv',
    nameVi: 'arXiv · DBLP · AI',
    nameEn: 'arXiv · DBLP · AI',
    domainVi: 'Khoa học máy tính, Toán học & Trí tuệ nhân tạo',
    domainEn: 'Computer science, physics, math & ML',
    sourceKeys: ['arxiv', 'dblp', 'huggingface', 'tech_standard'],
    xPct: 19.5,
    yPct: 86,
    side: 'left',
    icon: Cpu,
  },
  {
    key: 'local_scholarly',
    nameVi: 'Thư viện học thuật CITRA',
    nameEn: 'CITRA Scholarly Library',
    domainVi: 'Kho bài báo học thuật chuẩn hóa tích hợp sẵn trong CITRA',
    domainEn: 'Built-in library of verified academic publications',
    sourceKeys: ['local_db', 'acl', 'known_papers'],
    xPct: 84,
    yPct: 15,
    side: 'right',
    icon: Database,
  },
  {
    key: 'semantic',
    nameVi: 'Đối chiếu ngữ cảnh',
    nameEn: 'Context Match',
    domainVi: 'So sánh nội dung câu trích dẫn & song ngữ Việt ↔ Anh',
    domainEn: 'Sentence meaning & VI ↔ EN bilingual matching',
    sourceKeys: ['semantic_scholar'],
    xPct: 86.5,
    yPct: 33,
    side: 'right',
    icon: Sparkles,
  },
  {
    key: 'doaj',
    nameVi: 'DOAJ & OpenAIRE',
    nameEn: 'DOAJ & OpenAIRE',
    domainVi: 'Tạp chí truy cập mở & Kho lưu trữ châu Âu',
    domainEn: 'Open-access journals & institutional repositories',
    sourceKeys: ['doaj', 'openaire_hal', 'serpapi'],
    xPct: 87,
    yPct: 51,
    side: 'right',
    icon: BookOpen,
  },
  {
    key: 'vnlegal',
    nameVi: 'Pháp luật · TCVN',
    nameEn: 'Legal · Standards',
    domainVi: 'Văn bản pháp quy VN, Tiêu chuẩn TCVN & Sách chuyên khảo',
    domainEn: 'VN legal statutes, TCVN standards & books',
    sourceKeys: [
      'vn_legal_registry',
      'vn_tech_standard',
      'vn_textbook_registry',
      'openlibrary',
    ],
    xPct: 86.5,
    yPct: 69,
    side: 'right',
    icon: Scale,
  },
  {
    key: 'web',
    nameVi: 'Trang web & Lưu trữ',
    nameEn: 'Web & Archive',
    domainVi: 'Kiểm tra đường dẫn trực tuyến & Lưu trữ số',
    domainEn: 'Live URL verification & digital web archive',
    sourceKeys: ['web_html_meta', 'wayback_html_meta'],
    xPct: 81.5,
    yPct: 87,
    side: 'right',
    icon: Link2,
  },
];

function formatAuthorSummary(
  rawAuthors: string,
  fallbackMatchedAuthors?: string[],
  fallbackTitle?: string | null,
): string {
  if (looksLikeTitleSentence(rawAuthors)) {
    return formatAcademicAuthorShort([], fallbackTitle || rawAuthors);
  }
  const parsedList = splitRawAuthorString(rawAuthors);
  const hadEtAl = /\bet\s+al\.?/i.test(rawAuthors);
  if (parsedList.length > 0) {
    const authorsInput =
      hadEtAl && parsedList.length === 1
        ? [`${parsedList[0]} et al.`]
        : parsedList;
    return formatAcademicAuthorShort(authorsInput, fallbackTitle);
  }
  if (fallbackMatchedAuthors && fallbackMatchedAuthors.length > 0) {
    return formatAcademicAuthorShort(fallbackMatchedAuthors, fallbackTitle);
  }
  return fallbackTitle ? formatAcademicAuthorShort([], fallbackTitle) : '';
}

function resolveCitedYear(rawStripped: string, explicitYear?: string | null): string {
  const trimmedExplicit = String(explicitYear ?? '').trim();
  if (/^(?:19|20)\d{2}$/.test(trimmedExplicit)) {
    return trimmedExplicit;
  }
  const parenMatch = rawStripped.match(/\(\s*((?:19|20)\d{2})[a-z]?\s*\)/);
  if (parenMatch) return parenMatch[1];
  const fullDateMatch = rawStripped.match(
    /(?:ngày\s+)?\d{1,2}[/-]\d{1,2}[/-]((?:19|20)\d{2})\b/i,
  );
  if (fullDateMatch) return fullDateMatch[1];
  const withoutRanges = rawStripped.replace(
    /(?:giai\s+đoạn\s+)?(?:19|20)\d{2}\s*[-–—]\s*(?:19|20)\d{2}/gi,
    '',
  );
  const cleanYearMatch = withoutRanges.match(/\b(19\d{2}|20\d{2})[a-z]?\b/);
  if (cleanYearMatch) return cleanYearMatch[1];
  const fallbackMatch = rawStripped.match(/\b(19\d{2}|20\d{2})[a-z]?\b/);
  return fallbackMatch ? fallbackMatch[1] : '';
}

function scrubBoardExplanation(text: string, lang: 'vi' | 'en'): string {
  if (!text) return text;
  if (lang === 'vi') {
    return text
      .replace(
        /Kiểm tra liên kết thành công\s*\(\s*HTTP\s+\d{3}\s+OK\s*\)\.?/gi,
        'Liên kết đang hoạt động bình thường.',
      )
      .replace(/\(\s*HTTP\s+200\s+OK\s*\)/gi, '(liên kết hoạt động)')
      .replace(/\bHTTP\s+200\s+OK\b/gi, 'Liên kết hoạt động');
  }
  return text
    .replace(
      /Link check (?:passed|succeeded)\s*\(\s*HTTP\s+\d{3}\s+OK\s*\)\.?/gi,
      'Source link is active and reachable.',
    )
    .replace(/\(\s*HTTP\s+200\s+OK\s*\)/gi, '(link active)')
    .replace(/\bHTTP\s+200\s+OK\b/gi, 'Link Active');
}

export interface CleanCitationIdentityOptions {
  citedYear?: string | null;
  citedAuthors?: string[] | null;
  citedTitle?: string | null;
}

export function extractCleanCitationIdentity(
  raw: string,
  primaryMatched?: Pick<MatchedSource, 'authors' | 'title' | 'year'> | null,
  options?: CleanCitationIdentityOptions,
): {
  shortHeader: string;
  authorOnly: string;
  citedYear: string;
  cleanTitle: string;
} {
  const stripped = (raw || '')
    .replace(/^\s*(?:\[\s*\d+[a-z]?\s*\]|\(\s*[a-z]\s*\)|\d+[a-z]?[.)])\s*/i, '')
    .replace(/^\s*(?:\[\s*\d+[a-z]?\s*\]|\(\s*[a-z]\s*\)|\d+[a-z]?[.)])\s*/i, '')
    .trim();
  const citedYear = resolveCitedYear(stripped, options?.citedYear);
  const cleanExplicitAuthors = resolveDisplayAuthors(options?.citedAuthors, raw);

  // 1. APA style: Authors (Year). Title...
  const apaMatch = stripped.match(/^(.+?)\s*\((?:19|20)\d{2}[a-z]?\)[.,:\s]+(.+)$/);
  if (apaMatch) {
    const restTitle = (apaMatch[2].split(/\.\s+/)[0]?.trim() || apaMatch[2].trim()).replace(
      /^[“"]|[”".,]+$/g,
      '',
    );
    const authorOnly =
      formatAuthorSummary(
        apaMatch[1],
        cleanExplicitAuthors.length > 0 ? cleanExplicitAuthors : primaryMatched?.authors,
        restTitle,
      ) || formatAcademicAuthorShort([], restTitle);
    const shortHeader =
      citedYear && !authorOnly.includes(citedYear)
        ? `${authorOnly} (${citedYear})`
        : authorOnly;
    return {
      shortHeader,
      authorOnly,
      citedYear,
      cleanTitle: restTitle,
    };
  }

  // 2. IEEE / Quoted-title style: N. Reimers and I. Gurevych, "Sentence-BERT: ...", EMNLP 2019.
  const ieeeQuotedMatch = stripped.match(/^(.+?)[,.:]\s*[“"]([^”"]{4,260})[”"][,.\s]*(.*)$/);
  if (ieeeQuotedMatch) {
    const cleanTitle = ieeeQuotedMatch[2].replace(/^[“"]|[”".,]+$/g, '').trim();
    const authorOnly =
      formatAuthorSummary(
        ieeeQuotedMatch[1],
        cleanExplicitAuthors.length > 0 ? cleanExplicitAuthors : primaryMatched?.authors,
        cleanTitle,
      ) || formatAcademicAuthorShort([], cleanTitle);
    const shortHeader =
      citedYear && !authorOnly.includes(citedYear)
        ? `${authorOnly} (${citedYear})`
        : authorOnly;
    return {
      shortHeader,
      authorOnly,
      citedYear,
      cleanTitle,
    };
  }

  // 3. Sentence-delimited fallback — NEVER split on single-letter author initials like "N. Reimers"!
  const sentenceParts = stripped
    .split(/(?<![A-ZÀ-Ỹ])\.\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (sentenceParts.length >= 2) {
    const firstPart = sentenceParts[0];
    const secondPart = sentenceParts[1];
    const secondIsUrlOrDate =
      /^https?:\/\//i.test(secondPart) ||
      /^(?:truy\s+cập|ngày|retrieved|accessed|available)\b/i.test(secondPart);
    if (looksLikeTitleSentence(firstPart) || secondIsUrlOrDate) {
      const cleanTitle = (options?.citedTitle?.trim() || firstPart).replace(
        /^[“"]|[”".,]+$/g,
        '',
      );
      const authorOnly =
        cleanExplicitAuthors.length > 0
          ? formatAcademicAuthorShort(cleanExplicitAuthors, cleanTitle)
          : formatAcademicAuthorShort([], cleanTitle);
      return {
        shortHeader:
          citedYear && !authorOnly.includes(citedYear)
            ? `${authorOnly} (${citedYear})`
            : authorOnly,
        authorOnly,
        citedYear,
        cleanTitle,
      };
    }

    const cleanTitle = secondPart.replace(/^[“"]|[”".,]+$/g, '').trim();
    const authorOnly =
      formatAuthorSummary(
        firstPart,
        cleanExplicitAuthors.length > 0 ? cleanExplicitAuthors : primaryMatched?.authors,
        cleanTitle,
      ) || formatAcademicAuthorShort([], cleanTitle || firstPart);
    return {
      shortHeader:
        citedYear && !authorOnly.includes(citedYear)
          ? `${authorOnly} (${citedYear})`
          : authorOnly,
      authorOnly,
      citedYear,
      cleanTitle,
    };
  }

  // 4. Fallback: if raw text is a title sentence (no cited authors), keep short title without surname-splitting
  const cleanedRawTitle = (options?.citedTitle?.trim() || stripped)
    .replace(/\bhttps?:\/\/\S+/gi, '')
    .replace(/,?\s*ngày\s+\d{1,2}[/-]\d{1,2}[/-](?:19|20)\d{2}\.?$/i, '')
    .replace(/^[“"]|[”".,]+$/g, '')
    .trim();
  if (looksLikeTitleSentence(stripped)) {
    const titleAuthor =
      cleanExplicitAuthors.length > 0
        ? formatAcademicAuthorShort(cleanExplicitAuthors, cleanedRawTitle)
        : formatAcademicAuthorShort([], cleanedRawTitle);
    return {
      shortHeader:
        citedYear && !titleAuthor.includes(citedYear)
          ? `${titleAuthor} (${citedYear})`
          : titleAuthor,
      authorOnly: titleAuthor,
      citedYear,
      cleanTitle: cleanedRawTitle || stripped,
    };
  }

  const fallbackAuthor = formatAcademicAuthorShort(
    cleanExplicitAuthors.length > 0 ? cleanExplicitAuthors : primaryMatched?.authors,
    primaryMatched?.title || cleanedRawTitle || stripped,
  );
  const fallbackHeader =
    citedYear && !fallbackAuthor.includes(citedYear)
      ? `${fallbackAuthor} (${citedYear})`
      : fallbackAuthor;
  return {
    shortHeader: fallbackHeader,
    authorOnly: fallbackAuthor,
    citedYear,
    cleanTitle: cleanedRawTitle || stripped,
  };
}

function humanizeField(field: string, isVi: boolean): string {
  const low = field.toLowerCase();
  if (low === 'year') return isVi ? 'Năm xuất bản' : 'Publication year';
  if (low === 'title') return isVi ? 'Tên bài báo' : 'Title';
  if (low === 'authors' || low === 'author') return isVi ? 'Tác giả' : 'Authors';
  if (low === 'venue' || low === 'journal') return isVi ? 'Nơi công bố' : 'Journal / Venue';
  if (low === 'doi') return 'DOI';
  if (low === 'url') return isVi ? 'Đường dẫn URL' : 'Web link';
  if (low === 'content') return isVi ? 'Nội dung trích dẫn' : 'Cited content';
  if (low === 'retracted' || low === 'retracted_paper') {
    return isVi ? 'Bài đã rút lại' : 'Retracted paper';
  }
  return field;
}

function getToneHex(tone: Tone, dark: boolean): string {
  switch (tone) {
    case 'emerald':
      return dark ? '#34D399' : '#10B981';
    case 'amber':
      return dark ? '#FBBF24' : '#F59E0B';
    case 'rose':
      return dark ? '#F87171' : '#EF4444';
    case 'violet':
      return dark ? '#A78BFA' : '#8B5CF6';
    default:
      return dark ? '#94A3B8' : '#64748B';
  }
}

export function InteractiveDecisionFlowBoard({
  verdict,
  citedRef,
  markerLabel,
  onInspectDetails,
  onOverride,
}: InteractiveDecisionFlowBoardProps) {
  const { i18n } = useTranslation();
  const { resolvedTheme } = useTheme();
  const isVi = Boolean(i18n.language?.startsWith('vi'));
  const lang: 'vi' | 'en' = isVi ? 'vi' : 'en';

  const [cinemaSpotlight, setCinemaSpotlight] = useState(false);
  const [focus, setFocus] = useState<FocusTarget>({ kind: 'hub' });
  const [replaying, setReplaying] = useState(false);
  const replayTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const isDarkSurface = resolvedTheme === 'dark' || cinemaSpotlight;
  const marker = markerLabel || getCitationMarkerLabel(verdict, 0);
  const isResource = isUrlResource(verdict);
  const isLegal = isLegalStatuteVerdict(verdict);
  const effectiveLabel = isResource ? 'resource' : verdict.label;

  const boardPhase: BoardPhase =
    focus.kind === 'step' ? (`step-${focus.index}` as BoardPhase) : 'overview';

  const clearReplayTimers = () => {
    replayTimersRef.current.forEach(clearTimeout);
    replayTimersRef.current = [];
  };

  useEffect(() => {
    clearReplayTimers();
    setReplaying(false);
    setFocus({ kind: 'hub' });
  }, [verdict.citation_id]);

  useEffect(() => {
    return () => {
      clearReplayTimers();
    };
  }, []);

  const primaryTone: Tone =
    effectiveLabel === 'verified'
      ? 'emerald'
      : effectiveLabel === 'metadata_error'
        ? 'amber'
        : effectiveLabel === 'suspected_hallucination'
          ? 'rose'
          : effectiveLabel === 'resource'
            ? 'violet'
            : 'slate';

  const identity = useMemo(() => {
    const primaryMatched = verdict.matched_sources?.[0];
    const parsed = extractCleanCitationIdentity(
      verdict.citation_raw,
      primaryMatched,
      citedRef
        ? {
            citedYear: citedRef.year,
            citedAuthors: citedRef.authors,
            citedTitle: citedRef.title,
          }
        : undefined,
    );
    return {
      shortHeader: parsed.shortHeader,
      authorOnly: parsed.authorOnly,
      citedYear: parsed.citedYear,
      canonicalYear: primaryMatched?.year?.trim() || '',
      canonicalVenue: primaryMatched?.venue?.trim() || '',
      cleanTitle:
        primaryMatched?.title && effectiveLabel === 'verified'
          ? primaryMatched.title.replace(/^[“"]|[”".,]+$/g, '').trim()
          : parsed.cleanTitle,
    };
  }, [verdict.citation_raw, verdict.matched_sources, citedRef, effectiveLabel]);

  // Evaluate each satellite cluster against live Verdict data
  const evaluatedSatellites = useMemo(() => {
    const matchedList = verdict.matched_sources ?? [];
    const rules = verdict.triggered_rules ?? [];
    const mismatchedLower = (verdict.mismatched_fields ?? []).map((f) =>
      f.trim().toLowerCase(),
    );
    const hasContentMismatch =
      mismatchedLower.includes('content') ||
      rules.includes('R-CONTENT-MISMATCH') ||
      verdict.features?.stance_label === 'contradiction_risk';
    const urlSt = verdict.url_status ?? verdict.features?.url_status ?? null;
    const sourceUsed = (verdict.features?.source_used ?? '').toLowerCase();
    const hasLocalScholarlyHit =
      ['local_db', 'acl', 'known_papers'].includes(sourceUsed) ||
      matchedList.some((m) =>
        ['local_db', 'acl', 'known_papers'].includes(m.source.toLowerCase()),
      ) ||
      rules.some(
        (r) => r.startsWith('R-LOCAL_DB') || r.startsWith('R-KNOWN-PAPER'),
      );
    const externalScholarlyKeys = new Set([
      'crossref',
      'openalex',
      'pubmed',
      'arxiv',
      'doaj',
    ]);
    const hasExternalScholarlyHit = matchedList.some((m) => {
      const src = m.source.toLowerCase();
      return SATELLITE_CLUSTERS.some(
        (c) => externalScholarlyKeys.has(c.key) && c.sourceKeys.includes(src),
      );
    });
    const matchedInPrimaryLibraryOnly =
      !hasExternalScholarlyHit &&
      ((hasLocalScholarlyHit &&
        (effectiveLabel === 'verified' || effectiveLabel === 'metadata_error')) ||
        effectiveLabel === 'verified');
    const hasVnLegalRuleHit =
      isLegal ||
      rules.some(
        (r) =>
          r.startsWith('R-VN-LEGAL') ||
          r === 'R-LEGAL-DOCUMENT' ||
          r === 'R-VN-STANDARD-VERIFIED' ||
          r === 'R-VN-TEXTBOOK-VERIFIED',
      );
    const hasSemanticHit =
      effectiveLabel !== 'suspected_hallucination' &&
      ((verdict.features?.content_alignment_score ?? 0) >= 0.45 ||
        Boolean(verdict.features?.cross_lingual_detected) ||
        Boolean(verdict.features?.cross_lingual_title_detected) ||
        ((verdict.features?.title_sim_semantic ?? 0) >= 0.8 && matchedList.length > 0));
    const hasWebHit =
      matchedList.some((m) =>
        ['web_html_meta', 'wayback_html_meta'].includes(m.source.toLowerCase()),
      ) ||
      (urlSt !== null && urlSt !== 'unchecked') ||
      rules.some((r) =>
        [
          'R-WAYBACK-ARCHIVED',
          'R-DEAD-URL',
          'R-BROKEN-LINK',
          'R-FAKE-URL',
          'R-URL-CONTENT-MISMATCH',
        ].includes(r),
      ) ||
      (isResource && !isLegal);

    return SATELLITE_CLUSTERS.map((cluster) => {
      const matchedRecords = matchedList.filter((m) =>
        cluster.sourceKeys.includes(m.source.toLowerCase()),
      );

      let isMatched = matchedRecords.length > 0;
      let isSkippedPrimary = false;
      let satTone: Tone = primaryTone === 'amber' ? 'amber' : 'emerald';
      let statusLine = isVi ? 'Đã dò · Không trùng' : 'Scanned · No match';
      let storyTitle = '';
      let storyBody = '';
      let externalUrl: string | null = null;

      const bestRec = matchedRecords[0];
      if (bestRec) {
        const rawDoi = bestRec.doi?.trim();
        externalUrl = toSafeExternalHref(bestRec.url) ?? toSafeDoiHref(rawDoi);
      }

      if (cluster.key === 'local_scholarly' && (isMatched || hasLocalScholarlyHit)) {
        isMatched = true;
        satTone = effectiveLabel === 'metadata_error' ? 'amber' : 'emerald';
        const mismatched = verdict.mismatched_fields ?? [];
        statusLine =
          mismatched.length > 0 && effectiveLabel === 'metadata_error'
            ? isVi
              ? `⚠ Lệch ${humanizeField(mismatched[0], true).toLowerCase()}`
              : `⚠ ${humanizeField(mismatched[0], false)} differs`
            : isVi
              ? '✓ Tìm thấy bản gốc'
              : '✓ Source matched';
        const venueNote = bestRec?.venue
          ? ` (${bestRec.venue}${bestRec.year ? `, ${bestRec.year}` : ''})`
          : bestRec?.year
            ? ` (${bestRec.year})`
            : '';
        storyTitle = isVi
          ? `${cluster.nameVi} — Đã tìm thấy bài gốc`
          : `${cluster.nameEn} — Official Record Found`;
        storyBody =
          mismatched.length > 0 && effectiveLabel === 'metadata_error'
            ? isVi
              ? `Tìm thấy tài liệu gốc "${bestRec?.title || identity.cleanTitle}"${venueNote} trong ${cluster.nameVi}, nhưng phát hiện sai lệch ở: ${mismatched.map((f) => humanizeField(f, true)).join(', ')}.`
              : `Found official record "${bestRec?.title || identity.cleanTitle}"${venueNote} in ${cluster.nameEn}, with differences in: ${mismatched.map((f) => humanizeField(f, false)).join(', ')}.`
            : isVi
              ? `Xác nhận công trình "${bestRec?.title || identity.cleanTitle}"${venueNote} tồn tại trong ${cluster.nameVi} với thông tin trùng khớp.`
              : `Confirmed "${bestRec?.title || identity.cleanTitle}"${venueNote} in the ${cluster.nameEn} with matching publication details.`;
      } else if (cluster.key === 'vnlegal' && (isMatched || hasVnLegalRuleHit)) {
        isMatched = true;
        satTone = isLegal
          ? 'violet'
          : effectiveLabel === 'metadata_error'
            ? 'amber'
            : 'emerald';
        statusLine = isLegal
          ? isVi
            ? '⚖ Khớp danh mục pháp quy'
            : '⚖ Legal registry matched'
          : isVi
            ? '✓ Tìm thấy bản gốc'
            : '✓ Source matched';
        storyTitle = isVi
          ? `${cluster.nameVi} — Đã đối chứng hợp lệ`
          : `${cluster.nameEn} — Official Registry Match`;
        storyBody = isVi
          ? `Xác nhận văn bản/tiêu chuẩn "${bestRec?.title || identity.cleanTitle}" tồn tại trong ${cluster.nameVi}.`
          : `Confirmed "${bestRec?.title || identity.cleanTitle}" against ${cluster.nameEn}.`;
      } else if (cluster.key === 'semantic' && hasContentMismatch) {
        isMatched = true;
        satTone = 'amber';
        statusLine = isVi
          ? '⚠ Nội dung chưa khớp nguồn'
          : '⚠ Cited content differs';
        storyTitle = isVi
          ? 'Đối chiếu ngữ cảnh — Cần kiểm tra lại nội dung trích dẫn'
          : 'Context Match — Cited Content Needs Review';
        storyBody = isVi
          ? 'Nội dung câu trích dẫn trong bài chưa khớp với tóm tắt của tài liệu gốc. Bạn nên đối chiếu lại bài gốc để đảm bảo trích dẫn đúng ý.'
          : 'Your in-text claim differs from the source publication’s abstract. Please review the original paper to ensure accurate representation.';
      } else if (cluster.key === 'semantic' && hasSemanticHit) {
        isMatched = true;
        const isCross =
          Boolean(verdict.features?.cross_lingual_detected) ||
          Boolean(verdict.features?.cross_lingual_title_detected);
        satTone = isCross
          ? 'violet'
          : primaryTone === 'amber'
            ? 'amber'
            : 'emerald';
        statusLine = isCross
          ? isVi
            ? '✓ Khớp song ngữ Việt ↔ Anh'
            : '✓ VI ↔ EN content match'
          : isVi
            ? '✓ Nội dung khớp ngữ cảnh'
            : '✓ Context meaning aligned';
        storyTitle = isVi
          ? 'Đối chiếu ngữ cảnh — Nội dung phù hợp với bài gốc'
          : 'Context Match — Sentence Aligns with Source';
        storyBody = isCross
          ? isVi
            ? 'Hệ thống nhận diện trích dẫn song ngữ Việt ↔ Anh và xác nhận nội dung bài báo gốc phù hợp với câu trích dẫn trong bài.'
            : 'Detected Vietnamese ↔ English bilingual citation and confirmed the English source aligns with your sentence.'
          : isVi
            ? 'Nội dung câu viết trong bài của bạn phù hợp với chủ đề và tóm tắt của công trình khoa học gốc.'
            : 'Your in-text sentence aligns with the source publication’s abstract and topic.';
      } else if (cluster.key === 'web' && hasWebHit) {
        isMatched = true;
        const isDead = urlSt === 'dead_link' || urlSt === 'fake_domain';
        const isWarnWeb =
          rules.includes('R-URL-CONTENT-MISMATCH') || urlSt === 'archived_alive';
        satTone = isDead ? 'rose' : isWarnWeb ? 'amber' : 'violet';
        statusLine = isDead
          ? isVi
            ? '✕ Đường dẫn bị lỗi'
            : '✕ Broken link'
          : urlSt === 'archived_alive'
            ? isVi
              ? '✓ Bản lưu trữ web'
              : '✓ Web Archive'
            : isWarnWeb
              ? isVi
                ? '⚠ Khác tiêu đề trang'
                : '⚠ Page title differs'
              : isVi
                ? '✓ Đường dẫn hoạt động tốt'
                : '✓ Live link verified';
        storyTitle = isVi
          ? 'Kiểm tra Đường dẫn Web & Lưu trữ Số'
          : 'Live Web Link & Digital Archive Check';
        storyBody = isDead
          ? isVi
            ? 'Đường dẫn URL trong trích dẫn không thể truy cập được (trang không tồn tại hoặc tên miền lỗi). Bạn nên cập nhật lại link mới.'
            : 'The cited URL could not be reached (broken link or invalid domain). Please update the URL.'
          : urlSt === 'archived_alive'
            ? isVi
              ? 'Trang gốc hiện đã thay đổi nhưng CITRA đã tìm thấy bản lưu trữ nguyên vẹn trong kho lưu trữ web.'
              : 'The original URL changed, but CITRA verified an intact snapshot in the web archive.'
            : isVi
              ? 'Đường dẫn trực tuyến mở thành công và phản hồi nội dung trang hợp lệ.'
              : 'The cited web link responds normally with valid page details.';
        if (!externalUrl) {
          const rawUrlMatch = verdict.citation_raw.match(/\bhttps?:\/\/[^\s<>")'\]]+/i);
          externalUrl =
            toSafeExternalHref(verdict.archive_url) ??
            toSafeExternalHref(rawUrlMatch?.[0]);
        }
      } else if (isMatched && bestRec) {
        const isUnconfirmedVerdict =
          effectiveLabel === 'suspected_hallucination' || effectiveLabel === 'unresolved';
        if (isUnconfirmedVerdict) {
          satTone = 'amber';
          statusLine = isVi
            ? '⚠ Gần giống (chưa khớp)'
            : '⚠ Similar (unconfirmed)';
          storyTitle = isVi
            ? `${cluster.nameVi} — Tài liệu gần giống (chưa đủ khớp)`
            : `${cluster.nameEn} — Unconfirmed Similar Record`;
          storyBody = isVi
            ? `Tìm thấy tài liệu "${bestRec.title || identity.cleanTitle}" trên ${cluster.nameVi} có một vài từ tương đồng, nhưng thông tin tác giả/tiêu đề/năm không đủ khớp để xác nhận nguồn gốc.`
            : `Found a loosely similar record "${bestRec.title || identity.cleanTitle}" on ${cluster.nameEn}, but title, authors, or publication year did not match closely enough to confirm.`;
        } else {
          if (isLegal && cluster.key === 'vnlegal') {
            satTone = 'violet';
          } else if (effectiveLabel === 'metadata_error') {
            satTone = 'amber';
          } else {
            satTone = 'emerald';
          }
          const mismatched = verdict.mismatched_fields ?? [];
          statusLine =
            mismatched.length > 0 && effectiveLabel === 'metadata_error'
              ? isVi
                ? `⚠ Lệch ${humanizeField(mismatched[0], true).toLowerCase()}`
                : `⚠ ${humanizeField(mismatched[0], false)} differs`
              : isVi
                ? '✓ Tìm thấy bản gốc'
                : '✓ Source matched';

          const venueNote = bestRec.venue
            ? ` (${bestRec.venue}${bestRec.year ? `, ${bestRec.year}` : ''})`
            : bestRec.year
              ? ` (${bestRec.year})`
              : '';
          storyTitle = isVi
            ? `${cluster.nameVi} — Đã tìm thấy bài gốc`
            : `${cluster.nameEn} — Official Record Found`;
          storyBody =
            mismatched.length > 0 && effectiveLabel === 'metadata_error'
              ? isVi
                ? `Tìm thấy tài liệu gốc "${bestRec.title || identity.cleanTitle}"${venueNote} trên ${cluster.nameVi}, nhưng phát hiện sai lệch ở: ${mismatched.map((f) => humanizeField(f, true)).join(', ')}.`
                : `Found official record "${bestRec.title || identity.cleanTitle}"${venueNote} on ${cluster.nameEn}, with differences in: ${mismatched.map((f) => humanizeField(f, false)).join(', ')}.`
              : isVi
                ? `Xác nhận công trình "${bestRec.title || identity.cleanTitle}"${venueNote} tồn tại chính thức trên ${cluster.nameVi} với thông tin trùng khớp.`
                : `Confirmed "${bestRec.title || identity.cleanTitle}"${venueNote} on ${cluster.nameEn} with consistent details.`;
        }
      } else if (matchedInPrimaryLibraryOnly) {
        isSkippedPrimary = true;
        statusLine = isVi
          ? 'Đã khớp ở kho chính'
          : 'Matched in primary library';
        storyTitle = isVi
          ? `${cluster.nameVi} — Không cần tra cứu thêm`
          : `${cluster.nameEn} — Not Needed`;
        storyBody = isVi
          ? `Tài liệu ${marker} đã được xác minh trực tiếp trong Thư viện học thuật CITRA nên không cần tra cứu bổ sung tại ${cluster.nameVi}.`
          : `Reference ${marker} was already verified in the primary library (CITRA Scholarly Library), so no extra lookup in ${cluster.nameEn} was needed.`;
      } else {
        storyTitle = isVi
          ? `${cluster.nameVi} — Đã quét tự động`
          : `${cluster.nameEn} — Automatically Scanned`;
        storyBody = isVi
          ? `Hệ thống đã dò tìm trên kho ${cluster.nameVi} (${cluster.domainVi}). Tài liệu ${marker} không nằm trong nhóm chuyên ngành này hoặc không có bản ghi trùng.`
          : `Scanned ${cluster.nameEn} (${cluster.domainEn}). Reference ${marker} is outside this index scope or had no matching entry.`;
      }

      return {
        ...cluster,
        isMatched,
        isSkippedPrimary,
        satTone,
        statusLine,
        storyTitle,
        storyBody,
        externalUrl,
      };
    });
  }, [
    verdict,
    isVi,
    primaryTone,
    effectiveLabel,
    isResource,
    isLegal,
    identity.cleanTitle,
    marker,
  ]);

  const matchedSatellites = evaluatedSatellites.filter((s) => s.isMatched);
  const primaryExternalUrl =
    matchedSatellites.find((s) => s.externalUrl)?.externalUrl ?? null;

  // Build 4 human-friendly, zero-jargon end-to-end decision stages
  const stages = useMemo(() => {
    const mapSt = verdict.mapping_status;
    const step1Tone: Tone =
      mapSt === 'matched'
        ? 'emerald'
        : mapSt === 'missing_reference'
          ? 'rose'
          : 'amber';
    const step1Sub =
      mapSt === 'matched'
        ? isVi
          ? 'Đã nối khớp trong bài & cuối bài'
          : 'Linked in-text & bibliography'
        : mapSt === 'uncited_reference'
          ? isVi
            ? 'Có ở cuối bài · Chưa trích trong bài'
            : 'Listed at end · Not cited in text'
          : mapSt === 'missing_reference'
            ? isVi
              ? 'Có trong bài · Thiếu mục cuối bài'
              : 'Cited in text · Missing at end'
            : isVi
              ? 'Đã tách tên bài, tác giả & năm'
              : 'Parsed title, authors & year';

    const isUnconfirmedStep2 =
      effectiveLabel === 'suspected_hallucination' || effectiveLabel === 'unresolved';
    const hitNames = matchedSatellites.map((s) => (isVi ? s.nameVi : s.nameEn));
    const step2Tone: Tone = isUnconfirmedStep2
      ? effectiveLabel === 'suspected_hallucination'
        ? 'rose'
        : 'amber'
      : matchedSatellites.length > 0
        ? effectiveLabel === 'resource'
          ? 'violet'
          : 'emerald'
        : 'slate';
    const primaryHitSat = matchedSatellites[0];
    const primaryHitShortName = primaryHitSat
      ? primaryHitSat.key === 'local_scholarly'
        ? isVi
          ? 'Thư viện CITRA'
          : 'CITRA Library'
        : isVi
          ? primaryHitSat.nameVi
          : primaryHitSat.nameEn
      : '';
    const extraHitCount = Math.max(0, matchedSatellites.length - 1);
    const step2Sub = isUnconfirmedStep2
      ? matchedSatellites.length > 0
        ? isVi
          ? 'Không có bản ghi khớp xác nhận'
          : 'No confirmed library match'
        : isVi
          ? '0 kết quả trên 15+ thư viện'
          : '0 matches across 15+ libraries'
      : matchedSatellites.length > 0
        ? extraHitCount > 0
          ? isVi
            ? `Tìm thấy tại ${primaryHitShortName} +${extraHitCount} nguồn`
            : `Matched in ${primaryHitShortName} +${extraHitCount} ${extraHitCount === 1 ? 'source' : 'sources'}`
          : isVi
            ? `Tìm thấy tại ${primaryHitShortName}`
            : `Matched in ${primaryHitShortName}`
        : isVi
          ? '0 kết quả trên 15+ thư viện'
          : '0 matches across 15+ libraries';

    const mismatched = verdict.mismatched_fields ?? [];
    const isIncomplete = (verdict.triggered_rules ?? []).includes('R-INCOMPLETE-METADATA');
    const step3Tone: Tone =
      effectiveLabel === 'verified'
        ? 'emerald'
        : effectiveLabel === 'resource'
          ? 'violet'
          : effectiveLabel === 'metadata_error'
            ? 'amber'
            : effectiveLabel === 'suspected_hallucination'
              ? 'rose'
              : 'slate';
    const step3Sub = isIncomplete
      ? isVi
        ? '⚠ Thiếu tên tác giả hoặc năm XB'
        : '⚠ Incomplete author or year'
      : mismatched.length > 0
        ? isVi
          ? `⚠ Lệch: ${mismatched.map((f) => humanizeField(f, true)).join(', ')}`
          : `⚠ Differs: ${mismatched.map((f) => humanizeField(f, false)).join(', ')}`
        : effectiveLabel === 'verified'
          ? isVi
            ? 'Tên bài ✓ · Tác giả ✓ · Năm XB ✓'
            : 'Title ✓ · Authors ✓ · Year ✓'
          : effectiveLabel === 'resource'
            ? isVi
              ? 'Nguồn trực tuyến / văn bản hợp lệ ✓'
              : 'Valid web / legal resource ✓'
            : isVi
              ? 'Chưa có bản gốc để đối chiếu'
              : 'No published record to compare';

    const pct = Math.round((verdict.confidence ?? 0) * 100);
    const step4Sub =
      effectiveLabel === 'verified'
        ? isVi
          ? `✓ Đã xác minh · Độ tin cậy ${pct}%`
          : `✓ Verified · ${pct}% confidence`
        : effectiveLabel === 'metadata_error'
          ? isVi
            ? '⚠ Có bài thật · Cần sửa thông tin'
            : '⚠ Real paper · Update details'
          : effectiveLabel === 'suspected_hallucination'
            ? `✕ ${getVerdictDisplay('suspected_hallucination', lang).label}`
            : effectiveLabel === 'resource'
              ? isLegal
                ? isVi
                  ? '⚖ Văn bản pháp luật hợp lệ'
                  : '⚖ Verified legal statute'
                : isVi
                  ? '🔗 Trang web hoạt động tốt'
                  : '🔗 Verified web resource'
              : isVi
                ? '• Cần kiểm tra thủ công thêm'
                : '• Needs manual check';

    return [
      {
        num: isVi ? 'BƯỚC 01' : 'STEP 01',
        title: isVi ? 'Đọc từ bài viết' : 'Read from Paper',
        sub: step1Sub,
        tone: step1Tone,
        hudBadge: isVi
          ? `1/4 · Đang đọc mục ${marker} từ bài viết của bạn`
          : `1/4 · Reading citation ${marker} from your document`,
        storyTitle: isVi
          ? `Bước 1 — Đọc & kiểm tra vị trí trích dẫn ${marker}`
          : `Step 1 — Read & Locate Citation ${marker}`,
        storyBody:
          mapSt === 'matched'
            ? isVi
              ? `Hệ thống đọc mục ${marker} (${identity.shortHeader}) từ bài viết, tách riêng Tên bài, Tác giả, Năm xuất bản và nối khớp với danh mục cuối bài.`
              : `Parsed ${marker} (${identity.shortHeader}) from your document, separating Title, Authors, and Year.`
            : mapSt === 'uncited_reference'
              ? isVi
                ? `Mục ${marker} có tên trong danh mục cuối bài nhưng chưa thấy được trích dẫn ở đoạn văn nào trong thân bài.`
                : `Entry ${marker} appears in your bibliography, but isn't cited anywhere in the body text.`
              : isVi
                ? `Đã đọc thông tin trích dẫn ${marker} từ bài viết để chuẩn bị đối chiếu với các thư viện học thuật.`
                : `Read citation details for ${marker} from your document for library verification.`,
      },
      {
        num: isVi ? 'BƯỚC 02' : 'STEP 02',
        title: isVi ? 'Tra cứu 15+ thư viện' : 'Search 15+ Libraries',
        sub: step2Sub,
        tone: step2Tone,
        hudBadge:
          hitNames.length > 0
            ? isVi
              ? `2/4 · Tra cứu 15+ thư viện → Tìm thấy tại ${hitNames.join(', ')}`
              : `2/4 · Searched 15+ libraries → Found in ${hitNames.join(', ')}`
            : isVi
              ? '2/4 · Đã tra cứu 15+ thư viện học thuật → Không có bản ghi trùng'
              : '2/4 · Searched 15+ academic libraries → 0 matching records',
        storyTitle: isVi
          ? 'Bước 2 — Tra cứu song song trên hơn 15 thư viện học thuật'
          : 'Step 2 — Parallel Search Across 15+ Academic Libraries',
        storyBody:
          hitNames.length > 0
            ? isVi
              ? `CITRA tra cứu song song trên hơn 15 thư viện học thuật và tìm thấy bản gốc tại: ${hitNames.join(', ')}.`
              : `CITRA searched 15+ scholarly libraries in parallel and found the published record in: ${hitNames.join(', ')}.`
            : isVi
              ? 'Đã tra cứu Crossref, OpenAlex, PubMed, arXiv, DBLP, DOAJ và kho sách quốc tế nhưng không tìm thấy công trình nào trùng khớp.'
              : 'Searched Crossref, OpenAlex, PubMed, arXiv, DBLP, DOAJ, and book registries, returning zero matching publications.',
      },
      {
        num: isVi ? 'BƯỚC 03' : 'STEP 03',
        title: isVi ? 'So khớp thông tin' : 'Compare Details',
        sub: step3Sub,
        tone: step3Tone,
        hudBadge:
          mismatched.length > 0
            ? isVi
              ? `3/4 · Đặt cạnh bản gốc ngay tại tâm → Phát hiện lệch ${mismatched.map((f) => humanizeField(f, true)).join(', ')}`
              : `3/4 · Side-by-side check in center → Difference in ${mismatched.map((f) => humanizeField(f, false)).join(', ')}`
            : isVi
              ? '3/4 · Đặt cạnh bản gốc ngay tại tâm → Tất cả thông tin trùng khớp ✓'
              : '3/4 · Side-by-side check in center → All fields match ✓',
        storyTitle: isVi
          ? 'Bước 3 — Đối chiếu Tên bài, Tác giả, Năm xuất bản & Tạp chí'
          : 'Step 3 — Cross-Check Title, Authors, Year & Venue',
        storyBody:
          mismatched.length > 0
            ? isVi
              ? `Ngay tại bảng trung tâm, hệ thống đối chiếu từng dòng với bản gốc và chỉ rõ điểm chưa khớp ở: ${mismatched.map((f) => humanizeField(f, true)).join(', ')}. Các thông tin còn lại đều chính xác.`
              : `Right inside the center card, comparing your citation against the publisher record highlights a difference in: ${mismatched.map((f) => humanizeField(f, false)).join(', ')}.`
            : effectiveLabel === 'verified'
              ? isVi
                ? 'Toàn bộ thông tin quan trọng (Tên bài báo, Nhóm tác giả, Năm xuất bản và Tạp chí/Hội nghị) đều khớp chính xác với bản gốc.'
                : 'Every key detail — Title, Authors, Publication Year, and Journal/Venue — matches the official published record.'
              : scrubBoardExplanation(getVerdictExplanation(verdict, lang), lang),
      },
      {
        num: isVi ? 'BƯỚC 04' : 'STEP 04',
        title: isVi ? 'Kết luận cuối cùng' : 'Final Decision',
        sub: step4Sub,
        tone: primaryTone,
        hudBadge: isVi
          ? `4/4 · Hoàn tất kiểm chứng cho ${marker} → ${step4Sub}`
          : `4/4 · Verification complete for ${marker} → ${step4Sub}`,
        storyTitle: isVi
          ? `Bước 4 — Kết luận kiểm chứng cho ${marker}`
          : `Step 4 — Final Verification Decision for ${marker}`,
        storyBody: scrubBoardExplanation(getVerdictExplanation(verdict, lang), lang),
      },
    ];
  }, [
    verdict,
    isVi,
    lang,
    matchedSatellites,
    effectiveLabel,
    isLegal,
    primaryTone,
    marker,
    identity.shortHeader,
  ]);

  const activePillKey =
    focus.kind === 'step' ? `step-${focus.index}` : 'step-none';
  const { containerRef: stepStripRef, pillStyle: stepPill } =
    useSlidingPill<HTMLDivElement>(`${activePillKey}-${lang}-${verdict.citation_id}`);

  const toggleReplay = () => {
    if (replaying) {
      clearReplayTimers();
      setReplaying(false);
      setFocus({ kind: 'hub' });
      return;
    }
    clearReplayTimers();
    setReplaying(true);
    setFocus({ kind: 'step', index: 0 });
    const t1 = setTimeout(() => setFocus({ kind: 'step', index: 1 }), REPLAY_ACT_MS);
    const t2 = setTimeout(() => setFocus({ kind: 'step', index: 2 }), REPLAY_ACT_MS * 2);
    const t3 = setTimeout(() => setFocus({ kind: 'step', index: 3 }), REPLAY_ACT_MS * 3);
    const t4 = setTimeout(() => {
      setFocus({ kind: 'hub' });
      setReplaying(false);
    }, REPLAY_ACT_MS * 4);
    replayTimersRef.current = [t1, t2, t3, t4];
  };

  const handleManualStepClick = (idx: 0 | 1 | 2 | 3) => {
    clearReplayTimers();
    setReplaying(false);
    if (focus.kind === 'step' && focus.index === idx) {
      setFocus({ kind: 'hub' });
    } else {
      setFocus({ kind: 'step', index: idx });
    }
  };

  // Detailed field comparison rows for Act 3 ("step-2") right inside the Center Hub!
  const centerMatrixRows = useMemo(() => {
    const mismatched = new Set(
      (verdict.mismatched_fields ?? []).map((f) => f.toLowerCase()),
    );
    const isIncomplete = (verdict.triggered_rules ?? []).includes('R-INCOMPLETE-METADATA');

    if (effectiveLabel === 'resource') {
      return isLegal
        ? [
            {
              field: isVi ? 'Loại nguồn' : 'Type',
              value: isVi ? 'Văn bản pháp luật ✓' : 'Legal Statute ✓',
              ok: true,
            },
            {
              field: isVi ? 'Trạng thái' : 'Status',
              value: isVi ? 'Đã đối chứng danh mục ✓' : 'Registry matched ✓',
              ok: true,
            },
          ]
        : [
            {
              field: isVi ? 'Đường dẫn Web' : 'Web URL',
              value: isVi ? 'Phản hồi tốt ✓' : 'Active ✓',
              ok: true,
            },
            {
              field: isVi ? 'Điểm trích dẫn' : 'Citation Score',
              value: isVi ? 'Không trừ điểm ✓' : 'No penalty ✓',
              ok: true,
            },
          ];
    }

    if (effectiveLabel === 'suspected_hallucination' || effectiveLabel === 'unresolved') {
      return [
        {
          field: isVi ? 'Hồ sơ xuất bản' : 'Publisher Record',
          value: isVi ? '✕ Không tìm thấy' : '✕ Not found',
          ok: false,
        },
        {
          field: isVi ? 'Thư viện khớp' : 'Libraries matched',
          value: `${matchedSatellites.length} / 15+`,
          ok: false,
        },
      ];
    }

    const titleMismatch = mismatched.has('title');
    const authorMismatch =
      mismatched.has('authors') || mismatched.has('author') || isIncomplete;
    const yearMismatch = mismatched.has('year') || isIncomplete;
    const venueMismatch = mismatched.has('venue') || mismatched.has('journal');
    const contentMismatch = mismatched.has('content');

    let yearValue = isVi ? '✓ Trùng khớp' : '✓ Matches';
    if (yearMismatch) {
      if (
        identity.citedYear &&
        identity.canonicalYear &&
        identity.citedYear !== identity.canonicalYear
      ) {
        yearValue = isVi
          ? `⚠ Bài ghi ${identity.citedYear} → Gốc ${identity.canonicalYear}`
          : `⚠ Cited ${identity.citedYear} → Actual ${identity.canonicalYear}`;
      } else {
        yearValue = isVi ? '⚠ Chưa khớp bản gốc' : '⚠ Differs from source';
      }
    } else if (identity.canonicalYear || identity.citedYear) {
      yearValue = `✓ ${identity.canonicalYear || identity.citedYear}`;
    }

    return [
      {
        field: isVi ? 'Tên bài báo' : 'Title',
        value: titleMismatch
          ? isVi
            ? '⚠ Lệch tên bài'
            : '⚠ Title differs'
          : isVi
            ? '✓ Trùng khớp'
            : '✓ Matches',
        ok: !titleMismatch,
      },
      {
        field: isVi ? 'Nhóm tác giả' : 'Authors',
        value: authorMismatch
          ? isVi
            ? '⚠ Lệch / thiếu tác giả'
            : '⚠ Author differs'
          : isVi
            ? '✓ Trùng khớp'
            : '✓ Matches',
        ok: !authorMismatch,
      },
      {
        field: isVi ? 'Năm xuất bản' : 'Publication year',
        value: yearValue,
        ok: !yearMismatch,
      },
      {
        field: isVi ? 'Tạp chí / Nguồn' : 'Venue / DOI',
        value: venueMismatch
          ? isVi
            ? '⚠ Lệch nơi công bố'
            : '⚠ Venue differs'
          : isVi
            ? '✓ Đã xác minh'
            : '✓ Verified',
        ok: !venueMismatch,
      },
      ...(contentMismatch
        ? [
            {
              field: isVi ? 'Nội dung trích dẫn' : 'Cited content',
              value: isVi ? '⚠ Cần kiểm tra lại nội dung' : '⚠ Claim differs from source',
              ok: false,
            },
          ]
        : []),
    ];
  }, [
    verdict.mismatched_fields,
    verdict.triggered_rules,
    effectiveLabel,
    isLegal,
    isVi,
    matchedSatellites.length,
    identity.citedYear,
    identity.canonicalYear,
  ]);

  // Determine active Story Card content
  const activeStory = useMemo(() => {
    if (focus.kind === 'step' && stages[focus.index]) {
      const s = stages[focus.index];
      return {
        key: `step-${focus.index}-${verdict.citation_id}`,
        title: s.storyTitle,
        body: s.storyBody,
        tone: s.tone,
        url: primaryExternalUrl,
      };
    }
    if (focus.kind === 'sat') {
      const sat = evaluatedSatellites.find((s) => s.key === focus.key);
      if (sat) {
        return {
          key: `sat-${sat.key}-${verdict.citation_id}`,
          title: sat.storyTitle,
          body: sat.storyBody,
          tone: sat.isMatched ? sat.satTone : ('slate' as Tone),
          url: sat.externalUrl || primaryExternalUrl,
        };
      }
    }
    const defaultTitle =
      effectiveLabel === 'verified'
        ? isVi
          ? `Kết luận cho ${marker}: Tài liệu có thật & thông tin chính xác`
          : `Decision for ${marker}: Authentic publication with accurate details`
        : effectiveLabel === 'metadata_error'
          ? isVi
            ? `Kết luận cho ${marker}: Bài báo có thật nhưng cần chỉnh lại thông tin`
            : `Decision for ${marker}: Real publication found — minor detail needs fixing`
          : effectiveLabel === 'suspected_hallucination'
            ? isVi
              ? `Cảnh báo cho ${marker}: Không tìm thấy bài báo này trên các thư viện khoa học`
              : `Alert for ${marker}: No matching publication found in scholarly libraries`
            : effectiveLabel === 'resource'
              ? isLegal
                ? isVi
                  ? `Kết luận cho ${marker}: Văn bản pháp luật được đối chứng hợp lệ`
                  : `Decision for ${marker}: Verified legal statute / regulation`
                : isVi
                  ? `Kết luận cho ${marker}: Nguồn trang web trực tuyến hoạt động bình thường`
                  : `Decision for ${marker}: Active online web resource (excluded from academic penalty)`
              : isVi
                ? `Kết luận cho ${marker}: Chưa tìm thấy bản số hóa trực tuyến — nên kiểm tra thủ công`
                : `Decision for ${marker}: Not indexed online — please verify print/local source manually`;

    return {
      key: `hub-${verdict.citation_id}`,
      title: defaultTitle,
      body: scrubBoardExplanation(getVerdictExplanation(verdict, lang), lang),
      tone: primaryTone,
      url: primaryExternalUrl,
    };
  }, [
    focus,
    stages,
    evaluatedSatellites,
    verdict,
    effectiveLabel,
    isLegal,
    isVi,
    lang,
    marker,
    primaryTone,
    primaryExternalUrl,
  ]);

  const safeStoryUrl = toSafeExternalHref(activeStory.url);

  // Quick Field Check Chips in overview/step-3 mode
  const hubFieldPills = useMemo(() => {
    if (effectiveLabel === 'resource') {
      return isLegal
        ? [
            { label: isVi ? 'Số hiệu ✓' : 'Code ✓', ok: true },
            { label: isVi ? 'Cơ quan ban hành ✓' : 'Authority ✓', ok: true },
          ]
        : [
            { label: isVi ? 'Đường dẫn Web ✓' : 'Web Link ✓', ok: true },
            { label: isVi ? 'Không trừ điểm ✓' : 'No score penalty ✓', ok: true },
          ];
    }
    if (effectiveLabel === 'suspected_hallucination' || effectiveLabel === 'unresolved') {
      return [
        {
          label: isVi ? '0 thư viện khớp xác nhận' : '0 confirmed library matches',
          ok: false,
        },
      ];
    }
    const mismatched = new Set(
      (verdict.mismatched_fields ?? []).map((f) => f.toLowerCase()),
    );
    return [
      {
        label: `${isVi ? 'Tên bài' : 'Title'} ${mismatched.has('title') ? '⚠' : '✓'}`,
        ok: !mismatched.has('title'),
      },
      {
        label: `${isVi ? 'Tác giả' : 'Authors'} ${mismatched.has('authors') || mismatched.has('author') ? '⚠' : '✓'}`,
        ok: !(mismatched.has('authors') || mismatched.has('author')),
      },
      {
        label: `${isVi ? 'Năm XB' : 'Year'} ${mismatched.has('year') ? '⚠' : '✓'}`,
        ok: !mismatched.has('year'),
      },
      ...(mismatched.has('content')
        ? [
            {
              label: `${isVi ? 'Nội dung' : 'Content'} ⚠`,
              ok: false,
            },
          ]
        : []),
    ];
  }, [
    effectiveLabel,
    isLegal,
    isVi,
    verdict.mismatched_fields,
  ]);

  const activeCanvasTone: Tone =
    boardPhase === 'step-0'
      ? 'violet'
      : boardPhase === 'step-1'
        ? matchedSatellites.length > 0
          ? 'emerald'
          : 'amber'
        : boardPhase === 'step-2'
          ? stages[2].tone
          : primaryTone;

  const hubAccentHex = getToneHex(activeCanvasTone, isDarkSurface);

  const hubBadgeLabel =
    boardPhase === 'step-0'
      ? isVi
        ? '1/4 · ĐANG ĐỌC TỪ BÀI VIẾT'
        : '1/4 · READING DOCUMENT'
      : boardPhase === 'step-1'
        ? isVi
          ? `2/4 · PHÁT HIỆN ${matchedSatellites.length} THƯ VIỆN KHỚP`
          : `2/4 · ${matchedSatellites.length} MATCHING LIBRARIES`
        : boardPhase === 'step-2'
          ? isVi
            ? '3/4 · ĐỐI CHIẾU TỪNG THÔNG TIN'
            : '3/4 · DETAIL COMPARISON'
          : effectiveLabel === 'verified'
            ? isVi
              ? '✓ ĐÃ XÁC MINH'
              : '✓ VERIFIED'
            : effectiveLabel === 'metadata_error'
              ? isVi
                ? '⚠ CẦN SỬA THÔNG TIN'
                : '⚠ FIX CITATION DETAIL'
              : effectiveLabel === 'suspected_hallucination'
                ? isVi
                  ? '✕ KHÔNG TÌM THẤY NGUỒN'
                  : '✕ SOURCE NOT FOUND'
                : effectiveLabel === 'resource'
                  ? isLegal
                    ? isVi
                      ? '⚖ VĂN BẢN PHÁP LUẬT'
                      : '⚖ LEGAL STATUTE'
                    : isVi
                      ? '🔗 NGUỒN WEB HỢP LỆ'
                      : '🔗 VERIFIED WEB LINK'
                  : isVi
                    ? '• CẦN RÀ SOÁT THÊM'
                    : '• MANUAL CHECK';

  const toneDotClass = (tone: Tone) =>
    tone === 'emerald'
      ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.65)]'
      : tone === 'amber'
        ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.65)]'
        : tone === 'rose'
          ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.65)]'
          : tone === 'violet'
            ? 'bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.65)]'
            : 'bg-slate-400';

  const activeStepIndex = focus.kind === 'step' ? focus.index : null;

  return (
    <div
      data-testid="interactive-decision-flow-board"
      data-cinema={cinemaSpotlight ? 'true' : 'false'}
      data-board-phase={boardPhase}
      style={
        {
          '--hub-glow':
            activeCanvasTone === 'emerald'
              ? isDarkSurface
                ? 'rgba(16, 185, 129, 0.17)'
                : 'rgba(16, 185, 129, 0.09)'
              : activeCanvasTone === 'amber'
                ? isDarkSurface
                  ? 'rgba(245, 158, 11, 0.17)'
                  : 'rgba(245, 158, 11, 0.10)'
                : activeCanvasTone === 'rose'
                  ? isDarkSurface
                    ? 'rgba(239, 68, 68, 0.17)'
                    : 'rgba(239, 68, 68, 0.09)'
                  : activeCanvasTone === 'violet'
                    ? isDarkSurface
                      ? 'rgba(139, 92, 246, 0.17)'
                      : 'rgba(139, 92, 246, 0.09)'
                    : 'rgba(100, 116, 139, 0.08)',
        } as React.CSSProperties
      }
      className={`relative rounded-2xl border p-4 sm:p-5 flex flex-col gap-3.5 overflow-hidden transition-colors duration-300 ${
        isDarkSurface
          ? 'bg-[#091116] border-slate-800/90 text-slate-100 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.65)]'
          : 'bg-[#FAF9F5] border-slate-200/90 text-slate-900 shadow-[0_8px_30px_-14px_rgba(15,23,42,0.07)]'
      }`}
    >
      {/* Architectural Micro-Dot Grid + Radial Semantic Aura Background */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 transition-opacity duration-500"
        style={{
          backgroundImage: isDarkSurface
            ? 'radial-gradient(52% 48% at 50% 56%, var(--hub-glow) 0%, transparent 72%), radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)'
            : 'radial-gradient(52% 48% at 50% 56%, var(--hub-glow) 0%, transparent 72%), radial-gradient(rgba(15,23,42,0.065) 1px, transparent 1px)',
          backgroundSize: '100% 100%, 20px 20px',
        }}
      />

      {/* =================================================================
          TOP BAR: Title Pill + Presenter Replay Toggle + Cinema Mode + Diff Link
          ================================================================= */}
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-2.5">
        <div
          className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-bold tracking-wide uppercase border ${
            isDarkSurface
              ? 'bg-white/[0.05] border-white/10 text-slate-300'
              : 'bg-white/90 border-slate-200/90 text-slate-600 shadow-sm'
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${toneDotClass(activeCanvasTone)}`} />
          <span>
            {isVi
              ? `Các bước kiểm tra · Tài liệu ${marker}`
              : `Verification Steps · Reference ${marker}`}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-testid="flow-replay-btn"
            onClick={toggleReplay}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
              replaying
                ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-sm'
                : isDarkSurface
                  ? 'bg-emerald-500/20 hover:bg-emerald-500/30 border-emerald-400/40 text-emerald-300'
                  : 'bg-slate-900 hover:bg-slate-800 border-slate-900 text-white shadow-sm'
            }`}
          >
            {replaying ? (
              <>
                <Square className="h-3 w-3 fill-current" />
                <span>
                  {isVi
                    ? `Dừng xem lại (${(activeStepIndex ?? 0) + 1}/4)`
                    : `Stop Replay (${(activeStepIndex ?? 0) + 1}/4)`}
                </span>
              </>
            ) : (
              <>
                <Play className="h-3 w-3 fill-current" />
                <span>{isVi ? 'Xem lại từng bước' : 'Replay Steps'}</span>
              </>
            )}
          </button>

          {resolvedTheme !== 'dark' && (
            <button
              type="button"
              data-testid="flow-cinema-toggle"
              aria-pressed={cinemaSpotlight}
              onClick={() => setCinemaSpotlight((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                cinemaSpotlight
                  ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300'
                  : 'bg-white hover:bg-slate-50 border-slate-200/90 text-slate-700 shadow-sm'
              }`}
            >
              <MonitorPlay className="h-3.5 w-3.5" />
              <span>{isVi ? 'Giao diện tối' : 'Dark view'}</span>
            </button>
          )}

          {onInspectDetails && (
            <button
              type="button"
              onClick={() => onInspectDetails(verdict)}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                isDarkSurface
                  ? 'bg-white/[0.06] hover:bg-white/[0.12] border-white/10 text-slate-200'
                  : 'bg-white hover:bg-slate-50 border-slate-200/90 text-slate-700 shadow-sm'
              }`}
            >
              <span>{isVi ? 'So sánh chi tiết' : 'Compare Details'}</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* =================================================================
          LAYER 1: COMPACT 4-STEP SELECTOR STRIP (Synchronized with Main Board)
          ================================================================= */}
      <div
        ref={stepStripRef}
        className={`t-tabs relative z-10 grid grid-cols-2 xl:grid-cols-4 gap-2 p-1.5 rounded-2xl border ${
          isDarkSurface
            ? 'bg-slate-950/65 border-white/[0.08]'
            : 'bg-white/80 backdrop-blur-sm border-slate-200/80 shadow-sm'
        }`}
      >
        {focus.kind === 'step' && stepPill.ready && (
          <span
            aria-hidden="true"
            style={{
              width: `${stepPill.width}px`,
              height: `${stepPill.height}px`,
              transform: `translate3d(${stepPill.left}px, ${stepPill.top}px, 0)`,
              transition: stepPill.animate ? undefined : 'none',
            }}
            className={`t-tabs-pill rounded-xl ${
              isDarkSurface
                ? 'bg-white/[0.09] ring-1 ring-emerald-400/60'
                : 'bg-emerald-50/90 ring-1 ring-emerald-500/50'
            }`}
          />
        )}

        {stages.map((st, idx) => {
          const stepIdx = idx as 0 | 1 | 2 | 3;
          const isStepSelected = focus.kind === 'step' && focus.index === stepIdx;
          const isPastStep =
            focus.kind === 'step' && focus.index > stepIdx;
          const borderTone = isStepSelected
            ? isDarkSurface
              ? 'border-emerald-400/70 bg-emerald-500/[0.10]'
              : 'border-emerald-500 bg-emerald-50/60 shadow-sm'
            : st.tone === 'amber' && boardPhase === 'overview'
              ? isDarkSurface
                ? 'border-amber-400/40 bg-amber-500/[0.05]'
                : 'border-amber-300/90 bg-amber-50/45'
              : st.tone === 'rose' && boardPhase === 'overview'
                ? isDarkSurface
                  ? 'border-rose-400/40 bg-rose-500/[0.05]'
                  : 'border-rose-300/90 bg-rose-50/45'
                : isDarkSurface
                  ? 'border-white/[0.07] bg-white/[0.02] hover:border-white/20'
                  : 'border-slate-200/80 bg-white/95 hover:border-slate-300';

          return (
            <button
              key={st.num}
              type="button"
              data-testid={`flow-step-${idx}`}
              data-active={isStepSelected ? 'true' : 'false'}
              data-pill-active={isStepSelected ? 'true' : 'false'}
              onClick={() => handleManualStepClick(stepIdx)}
              className={`t-tab group min-w-0 text-left px-3 py-2 rounded-xl border transition-all duration-200 cursor-pointer ${borderTone} ${
                focus.kind === 'step' && !isStepSelected && !isPastStep
                  ? 'opacity-55'
                  : 'opacity-100'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span
                  className={`text-[10px] font-mono font-bold tracking-wider uppercase ${
                    isStepSelected
                      ? isDarkSurface
                        ? 'text-emerald-300'
                        : 'text-emerald-700'
                      : isDarkSurface
                        ? 'text-slate-400'
                        : 'text-slate-500'
                  }`}
                >
                  {st.num}
                </span>
                <span className={`h-2 w-2 rounded-full shrink-0 ${toneDotClass(st.tone)}`} />
              </div>
              <div
                className={`text-xs sm:text-[13px] font-bold leading-snug break-words ${
                  isDarkSurface ? 'text-white' : 'text-slate-900'
                }`}
              >
                {st.title}
              </div>
              <div
                title={st.sub}
                className={`text-[11px] mt-0.5 leading-snug line-clamp-2 break-words ${
                  st.tone === 'amber'
                    ? isDarkSurface
                      ? 'text-amber-300 font-medium'
                      : 'text-amber-800 font-medium'
                    : st.tone === 'rose'
                      ? isDarkSurface
                        ? 'text-rose-300 font-medium'
                        : 'text-rose-700 font-medium'
                      : isDarkSurface
                        ? 'text-slate-400'
                        : 'text-slate-500'
                }`}
              >
                {st.sub}
              </div>
            </button>
          );
        })}
      </div>

      {/* =================================================================
          LAYER 2: THE MAIN BOARD STAGE — PHYSICALLY CHOREOGRAPHED PER STEP!
          ================================================================= */}
      <div className="citra-cq-flow-stage relative z-10 hidden md:block h-[440px] w-full select-none transition-[height] duration-300">
        {/* LIVE MAIN-BOARD STAGE HUD BANNER (Right where the user's eyes look!) */}
        {activeStepIndex !== null && stages[activeStepIndex] && (
          <div
            data-testid="flow-main-stage-hud"
            className={`absolute left-1/2 top-2 -translate-x-1/2 z-30 max-w-[94%] inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold border shadow-md transition-all duration-200 ${
              isDarkSurface
                ? 'bg-slate-900/95 border-emerald-400/45 text-emerald-200 backdrop-blur-md'
                : 'bg-slate-900 text-white border-slate-800'
            }`}
          >
            {/* Direct 1-2-3-4 Step Switcher Pills right inside Main Board */}
            <div className="inline-flex items-center gap-1 shrink-0">
              {([0, 1, 2, 3] as const).map((idx) => {
                const isCurr = activeStepIndex === idx;
                const isDone = activeStepIndex > idx;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleManualStepClick(idx)}
                    className={`h-5 w-5 rounded-full text-[10px] font-mono font-extrabold inline-flex items-center justify-center transition-all cursor-pointer ${
                      isCurr
                        ? 'bg-emerald-400 text-slate-950 scale-105 shadow-sm'
                        : isDone
                          ? 'bg-emerald-500/30 text-emerald-200 hover:bg-emerald-500/45'
                          : 'bg-white/10 text-slate-400 hover:bg-white/20 hover:text-white'
                    }`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
            <span className="truncate">{stages[activeStepIndex].hudBadge}</span>
            <button
              type="button"
              onClick={() => {
                clearReplayTimers();
                setReplaying(false);
                setFocus({ kind: 'hub' });
              }}
              aria-label={isVi ? 'Đóng chế độ từng bước' : 'Exit step view'}
              className="ml-0.5 p-0.5 rounded-full hover:bg-white/15 text-slate-300 hover:text-white transition-colors cursor-pointer shrink-0"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* ACT 1 ("step-0") MANUSCRIPT SOURCE BEACON ABOVE THE HUB */}
        <div
          className={`pointer-events-none absolute left-1/2 top-[48px] -translate-x-1/2 z-20 transition-all duration-300 ${
            boardPhase === 'step-0'
              ? 'opacity-100 translate-y-0 scale-100'
              : 'opacity-0 -translate-y-2 scale-95'
          }`}
        >
          <div
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-[11px] font-bold border shadow-sm ${
              isDarkSurface
                ? 'bg-violet-950/90 border-violet-400/50 text-violet-200'
                : 'bg-violet-50 border-violet-300 text-violet-800'
            }`}
          >
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span>
              {isVi
                ? `Bài viết của bạn → Đọc trích dẫn ${marker}`
                : `Your Document → Reading ${marker}`}
            </span>
          </div>
        </div>

        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 800 440"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {/* Subtle Orbital Radar Rings Around Center Hub (400, 226) */}
          <circle
            cx="400"
            cy="226"
            r="98"
            fill="none"
            stroke={isDarkSurface ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.05)'}
            strokeWidth="1"
            strokeDasharray="3 5"
          />
          <circle
            cx="400"
            cy="226"
            r="180"
            fill="none"
            stroke={isDarkSurface ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.04)'}
            strokeWidth="1"
            strokeDasharray="4 6"
          />
          <circle
            cx="400"
            cy="226"
            r="268"
            fill="none"
            stroke={isDarkSurface ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.03)'}
            strokeWidth="1"
          />

          {/* ACT 1 ("step-0"): Vertical Extraction Beam from Manuscript Pill -> Center Hub */}
          {boardPhase === 'step-0' && (
            <g>
              <line
                x1="400"
                y1="78"
                x2="400"
                y2="144"
                stroke="#8B5CF6"
                strokeWidth="2.5"
                strokeDasharray="4 4"
              />
              <circle r="4.5" fill="#8B5CF6">
                <animateMotion
                  dur="0.9s"
                  repeatCount="indefinite"
                  path="M 400 78 L 400 144"
                />
              </circle>
            </g>
          )}

          {/* ACT 2 ("step-1"): Expanding Sonar Radar Waves Radiating Across All Libraries */}
          {boardPhase === 'step-1' && (
            <g>
              <circle
                cx="400"
                cy="226"
                r="60"
                fill="none"
                stroke="#38BDF8"
                strokeWidth="2"
              >
                <animate
                  attributeName="r"
                  from="65"
                  to="310"
                  dur="1.6s"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  from="0.55"
                  to="0"
                  dur="1.6s"
                  repeatCount="indefinite"
                />
              </circle>
              <circle
                cx="400"
                cy="226"
                r="60"
                fill="none"
                stroke="#10B981"
                strokeWidth="1.5"
              >
                <animate
                  attributeName="r"
                  from="65"
                  to="310"
                  begin="0.8s"
                  dur="1.6s"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  from="0.4"
                  to="0"
                  begin="0.8s"
                  dur="1.6s"
                  repeatCount="indefinite"
                />
              </circle>
            </g>
          )}

          {/* ACT 4 ("step-3"): Celebratory Verdict Halo Ring Around Center Hub */}
          {boardPhase === 'step-3' && (
            <circle
              cx="400"
              cy="226"
              r="138"
              fill="none"
              stroke={hubAccentHex}
              strokeWidth="2"
              strokeOpacity="0.35"
            >
              <animate
                attributeName="r"
                values="132;152;132"
                dur="2.2s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="stroke-opacity"
                values="0.45;0.12;0.45"
                dur="2.2s"
                repeatCount="indefinite"
              />
            </circle>
          )}

          {/* Bezier Conduits + Step-Aware Signal Choreography */}
          {evaluatedSatellites.map((sat, idx) => {
            const sx = (sat.xPct / 100) * 800;
            const sy = (sat.yPct / 100) * 440;
            const hubHalfW = boardPhase === 'step-2' ? 148 : 122;
            const startX = sat.side === 'left' ? sx + 78 : sx - 78;
            const endX = sat.side === 'left' ? 400 - hubHalfW : 400 + hubHalfW;
            const endY = 226 + (sy - 226) * 0.24;
            const midX = (startX + endX) / 2;
            const d = `M ${startX.toFixed(1)} ${sy.toFixed(1)} C ${midX.toFixed(1)} ${sy.toFixed(1)}, ${midX.toFixed(1)} ${endY.toFixed(1)}, ${endX.toFixed(1)} ${endY.toFixed(1)}`;
            const isSatFocused = focus.kind === 'sat' && focus.key === sat.key;
            const strokeHex = getToneHex(sat.satTone, isDarkSurface);

            // ACT 1 ("step-0"): All external database conduits stay quiet standby!
            if (boardPhase === 'step-0') {
              return (
                <path
                  key={sat.key}
                  d={d}
                  fill="none"
                  stroke={isDarkSurface ? 'rgba(148,163,184,0.08)' : 'rgba(100,116,139,0.10)'}
                  strokeWidth="1.1"
                  strokeDasharray="3 6"
                />
              );
            }

            // ACT 2 ("step-1"): Unmatched libraries receive OUTBOUND cyan search probes (Hub -> Library)!
            if (boardPhase === 'step-1' && !sat.isMatched) {
              const probeDur = (1.15 + (idx % 3) * 0.2).toFixed(2);
              return (
                <g key={sat.key}>
                  <path
                    d={d}
                    fill="none"
                    stroke={isDarkSurface ? 'rgba(56,189,248,0.32)' : 'rgba(14,165,233,0.32)'}
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                  />
                  {/* Outbound Search Probe (keyPoints="1;0" travels Hub -> Satellite!) */}
                  <circle r="2.8" fill="#38BDF8" fillOpacity="0.85">
                    <animateMotion
                      dur={`${probeDur}s`}
                      repeatCount="indefinite"
                      path={d}
                      keyPoints="1;0"
                      keyTimes="0;1"
                      calcMode="linear"
                    />
                  </circle>
                </g>
              );
            }

            // Unmatched library in overview / step-2 / step-3
            if (!sat.isMatched) {
              const dimmedOpacity = boardPhase === 'step-2' ? 0.06 : 0.16;
              return (
                <path
                  key={sat.key}
                  d={d}
                  fill="none"
                  stroke={
                    isSatFocused
                      ? isDarkSurface
                        ? 'rgba(148,163,184,0.6)'
                        : 'rgba(71,85,105,0.5)'
                      : isDarkSurface
                        ? `rgba(148,163,184,${dimmedOpacity})`
                        : `rgba(100,116,139,${dimmedOpacity + 0.03})`
                  }
                  strokeWidth={isSatFocused ? 1.8 : 1.2}
                  strokeDasharray="4 5"
                />
              );
            }

            // Matched library in step-1 / step-2 / step-3 / overview
            const durSec =
              boardPhase === 'step-1' || boardPhase === 'step-2'
                ? (1.15 + (idx % 2) * 0.2).toFixed(2)
                : (1.8 + (idx % 3) * 0.28).toFixed(2);
            const isSpotlighted = boardPhase === 'step-2' || isSatFocused;

            return (
              <g key={sat.key}>
                {/* Soft Luminous Conduit Halo */}
                <path
                  d={d}
                  fill="none"
                  stroke={strokeHex}
                  strokeWidth={isSpotlighted ? 9 : 5.5}
                  strokeOpacity={isDarkSurface ? 0.22 : 0.15}
                  strokeLinecap="round"
                />
                {/* Crisp Core Conduit Wire */}
                <path
                  d={d}
                  fill="none"
                  stroke={strokeHex}
                  strokeWidth={isSpotlighted ? 2.8 : 2}
                  strokeOpacity={0.9}
                  strokeLinecap="round"
                />
                {/* Precision Port Terminal Dots */}
                <circle cx={startX} cy={sy} r="3" fill={strokeHex} fillOpacity="0.9" />
                <circle cx={endX} cy={endY} r="3" fill={strokeHex} fillOpacity="0.9" />
                {/* Inbound Evidence Packet (Satellite -> Central Hub) */}
                <circle r="3.8" fill={strokeHex}>
                  <animateMotion
                    dur={`${durSec}s`}
                    repeatCount="indefinite"
                    path={d}
                    keyPoints="0;1"
                    keyTimes="0;1"
                    calcMode="spline"
                    keySplines="0.25 0.1 0.25 1"
                  />
                </circle>
                <circle r="8" fill={strokeHex} fillOpacity="0.26">
                  <animateMotion
                    dur={`${durSec}s`}
                    repeatCount="indefinite"
                    path={d}
                    keyPoints="0;1"
                    keyTimes="0;1"
                    calcMode="spline"
                    keySplines="0.25 0.1 0.25 1"
                  />
                </circle>
              </g>
            );
          })}
        </svg>

        {/* ===============================================================
            CENTER HUB CARD — MORPHS SYNCHRONOUSLY WITH EVERY STEP!
            =============================================================== */}
        <div
          data-testid="flow-central-hub"
          onClick={() => {
            clearReplayTimers();
            setReplaying(false);
            setFocus({ kind: 'hub' });
          }}
          style={{
            top: boardPhase === 'step-0' ? '53.6%' : '51.7%',
            borderColor: hubAccentHex,
            boxShadow: isDarkSurface
              ? `0 0 48px -10px ${hubAccentHex}60, 0 18px 36px -12px rgba(0,0,0,0.78)`
              : `0 18px 40px -12px ${hubAccentHex}45, 0 4px 14px rgba(15,23,42,0.07)`,
          }}
          className={`absolute left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 rounded-2xl border-[1.5px] p-4 transition-all duration-300 cursor-pointer ${
            boardPhase === 'step-2'
              ? 'w-[308px] text-left'
              : boardPhase === 'step-3'
                ? 'w-[294px] text-center scale-[1.05]'
                : 'w-[272px] text-center hover:scale-[1.02]'
          } ${
            isDarkSurface
              ? 'bg-[#0D1820]/[0.96] backdrop-blur-md text-white'
              : 'bg-white/[0.98] backdrop-blur-md text-slate-900'
          }`}
        >
          {/* Top Status Pill inside Hub */}
          <div
            className={
              boardPhase === 'step-2'
                ? 'flex items-center justify-between gap-2 mb-2.5'
                : 'flex items-center justify-center gap-2 mb-2.5'
            }
          >
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold tracking-wider uppercase ${
                activeCanvasTone === 'emerald'
                  ? isDarkSurface
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-emerald-50 text-emerald-700 border border-emerald-200/80'
                  : activeCanvasTone === 'amber'
                    ? isDarkSurface
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-amber-50 text-amber-800 border border-amber-200/80'
                    : activeCanvasTone === 'rose'
                      ? isDarkSurface
                        ? 'bg-rose-500/20 text-rose-300'
                        : 'bg-rose-50 text-rose-700 border border-rose-200/80'
                      : activeCanvasTone === 'violet'
                        ? isDarkSurface
                          ? 'bg-violet-500/20 text-violet-300'
                          : 'bg-violet-50 text-violet-700 border border-violet-200/80'
                        : isDarkSurface
                          ? 'bg-slate-700/60 text-slate-300'
                          : 'bg-slate-100 text-slate-700'
              }`}
            >
              {hubBadgeLabel}
            </span>
            {boardPhase === 'step-2' && (
              <span className="font-mono text-[11px] font-bold opacity-75">{marker}</span>
            )}
          </div>

          {/* STEP-SPECIFIC CENTER HUB BODY */}
          {boardPhase === 'step-0' ? (
            /* ACT 1 BODY: Parsed Manuscript Tokens */
            <div className="space-y-1.5 text-left mt-1">
              <div
                className={`px-2.5 py-1.5 rounded-lg text-[11.5px] flex items-center justify-between gap-2 ${
                  isDarkSurface ? 'bg-white/[0.05]' : 'bg-slate-50 border border-slate-200/70'
                }`}
              >
                <span className="opacity-70 shrink-0">{isVi ? 'Ký hiệu & Tác giả' : 'Author'}</span>
                <span className="font-bold truncate min-w-0">
                  {marker} {identity.authorOnly}
                </span>
              </div>
              <div
                className={`px-2.5 py-1.5 rounded-lg text-[11.5px] flex items-center justify-between gap-2 ${
                  isDarkSurface ? 'bg-white/[0.05]' : 'bg-slate-50 border border-slate-200/70'
                }`}
              >
                <span className="opacity-70 shrink-0">{isVi ? 'Năm ghi trong bài' : 'Cited Year'}</span>
                <span className="font-mono font-bold shrink-0">
                  {identity.citedYear || (isVi ? 'Chưa ghi' : '—')}
                </span>
              </div>
              <div
                data-testid="flow-step0-title-box"
                title={identity.cleanTitle}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] ${
                  isDarkSurface
                    ? 'bg-white/[0.05] text-slate-300'
                    : 'bg-slate-50 border border-slate-200/70 text-slate-700'
                }`}
              >
                <p className="line-clamp-2 leading-snug break-words [overflow-wrap:anywhere]">
                  “{identity.cleanTitle}”
                </p>
              </div>
            </div>
          ) : boardPhase === 'step-2' ? (
            /* ACT 3 BODY: LIVE FIELD-BY-FIELD COMPARISON MATRIX RIGHT IN THE CENTER! */
            <div data-testid="flow-hub-field-matrix" className="space-y-1.5 mt-1">
              {centerMatrixRows.map((row) => (
                <div
                  key={row.field}
                  className={`px-2.5 py-1.5 rounded-lg text-[11.5px] flex items-center justify-between gap-2 border ${
                    row.ok
                      ? isDarkSurface
                        ? 'bg-emerald-500/[0.08] border-emerald-500/25 text-emerald-200'
                        : 'bg-emerald-50/70 border-emerald-200/80 text-emerald-900'
                      : isDarkSurface
                        ? 'bg-amber-500/[0.16] border-amber-400/50 text-amber-200 font-semibold'
                        : 'bg-amber-50 border-amber-300 text-amber-900 font-semibold'
                  }`}
                >
                  <span className="opacity-80 shrink-0">{row.field}</span>
                  <span className="font-bold text-right truncate">{row.value}</span>
                </div>
              ))}
            </div>
          ) : boardPhase === 'step-3' ? (
            /* ACT 4 BODY: DEDICATED FINAL VERDICT SEAL RIGHT IN THE CENTER! */
            <div data-testid="flow-hub-verdict-seal" className="space-y-2 mt-1">
              <div className="text-xs font-bold opacity-85 flex items-center justify-center gap-1 min-w-0">
                <span className="font-mono shrink-0">{marker}</span>
                <span className="truncate min-w-0">
                  {identity.authorOnly.replace(/…+$/, '')}
                </span>
                {identity.citedYear && !identity.authorOnly.includes(identity.citedYear) && (
                  <span className="shrink-0">({identity.citedYear})</span>
                )}
              </div>
              <div
                className={`rounded-xl border px-3 py-2.5 ${
                  primaryTone === 'emerald'
                    ? isDarkSurface
                      ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-200'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : primaryTone === 'amber'
                      ? isDarkSurface
                        ? 'bg-amber-500/15 border-amber-400/40 text-amber-200'
                        : 'bg-amber-50 border-amber-200 text-amber-900'
                      : primaryTone === 'rose'
                        ? isDarkSurface
                          ? 'bg-rose-500/15 border-rose-400/40 text-rose-200'
                          : 'bg-rose-50 border-rose-200 text-rose-900'
                        : primaryTone === 'violet'
                          ? isDarkSurface
                            ? 'bg-violet-500/15 border-violet-400/40 text-violet-200'
                            : 'bg-violet-50 border-violet-200 text-violet-900'
                          : isDarkSurface
                            ? 'bg-white/[0.06] border-white/15 text-slate-200'
                            : 'bg-slate-50 border-slate-200 text-slate-800'
                }`}
              >
                <div className="text-xs font-extrabold">
                  {stages[3].sub}
                </div>
                <div className="text-[11px] opacity-90 mt-0.5 leading-snug">
                  {(() => {
                    const normMismatch = (verdict.mismatched_fields ?? [])
                      .map((f) => f.trim().toLowerCase())
                      .filter(Boolean);
                    const isYearOnlyMismatch =
                      normMismatch.length === 1 && normMismatch[0] === 'year';
                    if (
                      effectiveLabel === 'metadata_error' &&
                      isYearOnlyMismatch &&
                      identity.citedYear &&
                      identity.canonicalYear &&
                      identity.citedYear !== identity.canonicalYear
                    ) {
                      return isVi
                        ? `Chỉ cần sửa năm ${identity.citedYear} → ${identity.canonicalYear} là hoàn chỉnh`
                        : `Simply update year ${identity.citedYear} → ${identity.canonicalYear}`;
                    }
                    if (effectiveLabel === 'metadata_error') {
                      return isVi
                        ? 'Cần rà soát lại các thông tin bị lệch so với bản gốc'
                        : 'Review the mismatched fields against the published record';
                    }
                    if (effectiveLabel === 'verified') {
                      return isVi
                        ? `Đã xác minh qua ${matchedSatellites.length} thư viện học thuật`
                        : `Verified across ${matchedSatellites.length} ${matchedSatellites.length === 1 ? 'academic library' : 'academic libraries'}`;
                    }
                    if (effectiveLabel === 'suspected_hallucination') {
                      return isVi
                        ? '0/15+ thư viện có công trình này · Nên kiểm tra lại'
                        : '0/15+ libraries matched · Please verify source';
                    }
                    if (effectiveLabel === 'resource') {
                      return isVi
                        ? 'Nguồn tham khảo hợp lệ · Không bị trừ điểm học thuật'
                        : 'Valid reference · No score penalty';
                    }
                    return isVi
                      ? 'Khuyến nghị đối chiếu thêm bản in hoặc nguồn nội bộ'
                      : 'Please double-check print or local repository';
                  })()}
                </div>
              </div>
            </div>
          ) : (
            /* OVERVIEW / ACT 2 BODY */
            <>
              <div
                data-testid="flow-hub-header"
                title={`${marker} ${identity.shortHeader}`}
                className="text-[13.5px] font-extrabold leading-snug flex items-center justify-center gap-1 min-w-0"
              >
                <span className="font-mono opacity-80 shrink-0">{marker}</span>
                <span className="truncate min-w-0">
                  {identity.authorOnly.replace(/…+$/, '')}
                </span>
                {identity.citedYear && !identity.authorOnly.includes(identity.citedYear) && (
                  <span className="shrink-0">({identity.citedYear})</span>
                )}
              </div>

              <p
                title={identity.cleanTitle}
                className={`text-[11.5px] mt-1 line-clamp-2 leading-snug break-words [overflow-wrap:anywhere] ${
                  isDarkSurface ? 'text-slate-300/90' : 'text-slate-600'
                }`}
              >
                {identity.cleanTitle}
              </p>

              <div className="mt-2.5 pt-2 border-t border-slate-200/60 dark:border-white/10 flex flex-wrap items-center justify-center gap-1">
                {boardPhase === 'step-1' ? (
                  <span
                    className={`px-2.5 py-0.5 rounded-md text-[10.5px] font-bold ${
                      matchedSatellites.length > 0
                        ? isDarkSurface
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-emerald-50 text-emerald-700'
                        : isDarkSurface
                          ? 'bg-rose-500/20 text-rose-300'
                          : 'bg-rose-50 text-rose-700'
                    }`}
                  >
                    {matchedSatellites.length > 0
                      ? isVi
                        ? `⚡ Thu nhận bằng chứng từ ${matchedSatellites.length} thư viện`
                        : `⚡ Receiving records from ${matchedSatellites.length} libraries`
                      : isVi
                        ? '✕ 0 thư viện có bài báo này'
                        : '✕ 0 libraries matched'}
                  </span>
                ) : (
                  hubFieldPills.map((fp) => (
                    <span
                      key={fp.label}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                        fp.ok
                          ? isDarkSurface
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-emerald-50 text-emerald-700'
                          : isDarkSurface
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-amber-50 text-amber-800'
                      }`}
                    >
                      {fp.label}
                    </span>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {/* ===============================================================
            8 SURROUNDING SATELLITE NODES — REACT SYNCHRONOUSLY TO EVERY STEP!
            =============================================================== */}
        {evaluatedSatellites.map((sat) => {
          const SatIcon = sat.icon;
          const isFocused = focus.kind === 'sat' && focus.key === sat.key;
          const satHex = getToneHex(sat.satTone, isDarkSurface);

          // Compute exact phase state for Main Board visual storytelling
          const phaseState: 'standby' | 'scanning' | 'hit' | 'dimmed' | 'idle' =
            boardPhase === 'step-0'
              ? 'standby'
              : boardPhase === 'step-1'
                ? sat.isMatched
                  ? 'hit'
                  : 'scanning'
                : boardPhase === 'step-2'
                  ? sat.isMatched
                    ? 'hit'
                    : 'dimmed'
                  : sat.isMatched
                    ? 'hit'
                    : 'idle';

          const dynamicStatusText =
            phaseState === 'standby'
              ? isVi
                ? 'Chờ bước tra cứu...'
                : 'Waiting to scan...'
              : phaseState === 'scanning'
                ? sat.isSkippedPrimary
                  ? isVi
                    ? 'Đã khớp ở kho chính'
                    : 'Matched in primary library'
                  : isVi
                    ? '◌ Đang quét → Không trùng'
                    : '◌ Scanning → No match'
                : boardPhase === 'step-1' && sat.isMatched
                  ? isVi
                    ? '⚡ Đã tìm thấy bản gốc!'
                    : '⚡ Match locked!'
                  : sat.statusLine;

          const visualVisibilityClass =
            phaseState === 'standby'
              ? 'opacity-25 scale-[0.96]'
              : phaseState === 'dimmed'
                ? 'opacity-20 scale-[0.96]'
                : phaseState === 'scanning'
                  ? 'opacity-90 scale-100'
                  : sat.isMatched
                    ? boardPhase === 'step-1' || boardPhase === 'step-2' || boardPhase === 'step-3'
                      ? 'opacity-100 scale-[1.04]'
                      : 'opacity-100 scale-100'
                    : boardPhase === 'step-3'
                      ? 'opacity-35 scale-[0.98]'
                      : 'opacity-70 hover:opacity-100';

          return (
            <button
              key={sat.key}
              type="button"
              data-testid={`flow-sat-${sat.key}`}
              data-matched={sat.isMatched ? 'true' : 'false'}
              data-focused={isFocused ? 'true' : 'false'}
              data-phase-state={phaseState}
              onClick={() => {
                clearReplayTimers();
                setReplaying(false);
                setFocus({ kind: 'sat', key: sat.key });
              }}
              style={{
                left: `${sat.xPct}%`,
                top: `${sat.yPct}%`,
                borderColor:
                  phaseState === 'hit'
                    ? satHex
                    : phaseState === 'scanning'
                      ? '#38BDF8'
                      : isFocused
                        ? '#38BDF8'
                        : undefined,
                boxShadow: isFocused
                  ? '0 0 0 2px #38BDF8, 0 10px 24px -8px rgba(0,0,0,0.28)'
                  : phaseState === 'hit'
                    ? isDarkSurface
                      ? `0 10px 26px -8px ${satHex}55`
                      : `0 10px 22px -8px ${satHex}40`
                    : undefined,
              }}
              className={`absolute -translate-x-1/2 -translate-y-1/2 z-10 w-[184px] rounded-xl border px-3 py-2 text-left transition-all duration-300 hover:scale-[1.04] cursor-pointer ${visualVisibilityClass} ${
                phaseState === 'hit'
                  ? isDarkSurface
                    ? 'bg-[#0E1D22]/95 text-white'
                    : 'bg-white text-slate-900'
                  : isDarkSurface
                    ? 'bg-slate-900/60 border-white/[0.09] text-slate-400 hover:border-white/25'
                    : 'bg-white/80 border-slate-200/80 text-slate-500 hover:border-slate-300'
              }`}
            >
              <div className="flex items-start gap-2 min-w-0">
                <span
                  className={`mt-1 h-2 w-2 rounded-full shrink-0 ${
                    phaseState === 'hit'
                      ? toneDotClass(sat.satTone)
                      : phaseState === 'scanning'
                        ? 'bg-sky-400 animate-ping'
                        : 'bg-slate-400/60'
                  }`}
                />
                <SatIcon
                  className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                    phaseState === 'hit'
                      ? sat.satTone === 'amber'
                        ? 'text-amber-500'
                        : sat.satTone === 'violet'
                          ? 'text-violet-500'
                          : sat.satTone === 'rose'
                            ? 'text-rose-500'
                            : 'text-emerald-500'
                      : phaseState === 'scanning'
                        ? 'text-sky-400'
                        : 'opacity-60'
                  }`}
                />
                <span
                  title={isVi ? sat.nameVi : sat.nameEn}
                  className="text-[11.5px] font-bold leading-tight line-clamp-2 break-words"
                >
                  {isVi ? sat.nameVi : sat.nameEn}
                </span>
              </div>
              <div
                title={dynamicStatusText}
                className={`text-[10.5px] mt-0.5 pl-4 truncate ${
                  phaseState === 'hit'
                    ? sat.satTone === 'amber'
                      ? isDarkSurface
                        ? 'text-amber-300 font-semibold'
                        : 'text-amber-700 font-semibold'
                      : sat.satTone === 'violet'
                        ? isDarkSurface
                          ? 'text-violet-300 font-semibold'
                          : 'text-violet-700 font-semibold'
                        : sat.satTone === 'rose'
                          ? isDarkSurface
                            ? 'text-rose-300 font-semibold'
                            : 'text-rose-600 font-semibold'
                          : isDarkSurface
                            ? 'text-emerald-300 font-semibold'
                            : 'text-emerald-700 font-semibold'
                    : phaseState === 'scanning'
                      ? isDarkSurface
                        ? 'text-sky-300'
                        : 'text-sky-700'
                      : 'opacity-75'
                }`}
              >
                {dynamicStatusText}
              </div>
            </button>
          );
        })}
      </div>

      {/* Mobile Compact Fallback Grid (< md) */}
      <div className="relative z-10 md:hidden space-y-2.5">
        {activeStepIndex !== null && stages[activeStepIndex] && (
          <div className="px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-bold">
            {stages[activeStepIndex].hudBadge}
          </div>
        )}
        <div
          style={{ borderColor: hubAccentHex }}
          className={`rounded-xl border-[1.5px] p-3.5 ${
            isDarkSurface ? 'bg-[#0D1820] text-white' : 'bg-white text-slate-900'
          }`}
        >
          <div className="flex flex-col gap-2">
            <div className="text-[10px] font-bold uppercase tracking-wider opacity-75">
              {hubBadgeLabel}
            </div>
            <div className="text-sm font-bold">
              {marker} {identity.shortHeader}
            </div>
          </div>
          {boardPhase === 'step-2' ? (
            <div className="mt-2 space-y-1 text-xs">
              {centerMatrixRows.map((row) => (
                <div key={`mob-row-${row.field}`} className="flex items-center justify-between gap-2">
                  <span className="opacity-75">{row.field}</span>
                  <span className="font-semibold">{row.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs opacity-80 mt-0.5 line-clamp-2 break-words [overflow-wrap:anywhere]">
              {identity.cleanTitle}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {evaluatedSatellites.map((sat) => (
            <button
              key={`mob-${sat.key}`}
              type="button"
              onClick={() => {
                clearReplayTimers();
                setReplaying(false);
                setFocus({ kind: 'sat', key: sat.key });
              }}
              className={`rounded-xl border p-2.5 text-left text-xs cursor-pointer ${
                sat.isMatched
                  ? sat.satTone === 'amber'
                    ? isDarkSurface
                      ? 'border-amber-500/50 bg-amber-950/30 text-white'
                      : 'border-amber-400 bg-white text-slate-900'
                    : sat.satTone === 'violet'
                      ? isDarkSurface
                        ? 'border-violet-500/50 bg-violet-950/30 text-white'
                        : 'border-violet-400 bg-white text-slate-900'
                      : sat.satTone === 'rose'
                        ? isDarkSurface
                          ? 'border-rose-500/50 bg-rose-950/30 text-white'
                          : 'border-rose-400 bg-white text-slate-900'
                        : isDarkSurface
                          ? 'border-emerald-500/50 bg-emerald-950/30 text-white'
                          : 'border-emerald-400 bg-white text-slate-900'
                  : isDarkSurface
                    ? 'border-white/10 bg-white/[0.03] text-slate-400'
                    : 'border-slate-200 bg-white/70 text-slate-500'
              }`}
            >
              <div className="font-bold truncate">{isVi ? sat.nameVi : sat.nameEn}</div>
              <div className="text-[10.5px] opacity-80 truncate mt-0.5">{sat.statusLine}</div>
            </button>
          ))}
        </div>
      </div>

      {/* =================================================================
          LAYER 3: PLAIN-LANGUAGE INTERACTIVE STORY & ACTION DOCK (120FPS)
          ================================================================= */}
      <DirectionalStageSlide stageKey={activeStory.key} distancePx={8}>
        <div
          data-testid="flow-story-card"
          className={`relative z-10 rounded-xl border p-3.5 sm:px-4 sm:py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
            isDarkSurface
              ? 'bg-white/[0.05] border-white/[0.12]'
              : 'bg-white border-slate-200/90 shadow-sm'
          }`}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              {activeStory.tone === 'emerald' ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
              ) : activeStory.tone === 'amber' ? (
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
              ) : activeStory.tone === 'rose' ? (
                <XCircle className="h-4 w-4 text-rose-500 shrink-0" />
              ) : activeStory.tone === 'violet' ? (
                <FileSearch className="h-4 w-4 text-violet-500 shrink-0" />
              ) : (
                <HelpCircle className="h-4 w-4 text-slate-400 shrink-0" />
              )}
              <span
                className={`text-xs sm:text-[13px] font-bold truncate ${
                  activeStory.tone === 'emerald'
                    ? isDarkSurface
                      ? 'text-emerald-300'
                      : 'text-emerald-700'
                    : activeStory.tone === 'amber'
                      ? isDarkSurface
                        ? 'text-amber-300'
                        : 'text-amber-700'
                      : activeStory.tone === 'rose'
                        ? isDarkSurface
                          ? 'text-rose-300'
                          : 'text-rose-700'
                        : activeStory.tone === 'violet'
                          ? isDarkSurface
                            ? 'text-violet-300'
                            : 'text-violet-700'
                          : isDarkSurface
                            ? 'text-slate-200'
                            : 'text-slate-800'
                }`}
              >
                {activeStory.title}
              </span>
            </div>
            <p
              className={`text-xs sm:text-[13px] leading-relaxed break-words [overflow-wrap:anywhere] ${
                isDarkSurface ? 'text-slate-300' : 'text-slate-600'
              }`}
            >
              {activeStory.body}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {effectiveLabel === 'suspected_hallucination' ||
            effectiveLabel === 'unresolved' ? (
              <a
                data-testid="flow-google-scholar-link"
                href={`https://scholar.google.com/scholar?q=${encodeURIComponent(
                  identity.cleanTitle || verdict.citation_raw || '',
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white shadow-sm transition-colors"
              >
                <Search className="h-3.5 w-3.5" />
                <span>
                  {isVi
                    ? 'Tìm thử trên Google Scholar'
                    : 'Search on Google Scholar'}
                </span>
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : safeStoryUrl ? (
              <a
                href={safeStoryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-colors"
              >
                <Check className="h-3.5 w-3.5" />
                <span>{isVi ? 'Mở nguồn gốc' : 'Open Source'}</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : activeStory.url ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500">
                {activeStory.url}
              </span>
            ) : null}
            {onOverride && (
              <OverrideControls
                verdict={verdict}
                onOverride={(req) => onOverride(verdict, req)}
              />
            )}
          </div>
        </div>
      </DirectionalStageSlide>
    </div>
  );
}
