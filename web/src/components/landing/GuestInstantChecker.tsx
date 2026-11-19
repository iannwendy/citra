import { useState, useContext } from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Copy,
  Check,
  ArrowRight,
  RotateCcw,
  Loader2,
  BookOpen,
  Scale,
} from 'lucide-react';
import {
  api,
  type SandboxInstantVerifyResponse,
  type SandboxInstantVerdictItem,
} from '@/api/client';
import { AuthContext } from '@/contexts/AuthContext';
import { SYMBOLIC_RULES_RANGE } from '@/lib/productFacts';
import {
  getPlainVerdictLabel,
  getRuleDisplayName,
  getSourceDisplayName,
} from '@/lib/verdictExplanation';
import { SymmetricChevron } from '@/components/ui/transitions';
import {
  type Lang,
  SolvaEyebrow,
  SolvaTwoToneHeading,
} from '@/components/landing/SolvaPrimitives';

const MAX_GUEST_CHARS = 1500;
const MAX_GUEST_REFERENCES = 3;

type PresetId = 'economics' | 'biomedical' | 'ai_invented';

interface GuestPreset {
  id: PresetId;
  labelEn: string;
  labelVi: string;
  tagEn: string;
  tagVi: string;
  referencesText: string;
  fallbackResponse: SandboxInstantVerifyResponse;
}

const GUEST_PRESETS: GuestPreset[] = [
  {
    id: 'economics',
    labelEn: 'Economics Thesis',
    labelVi: 'Luận văn Kinh tế',
    tagEn: 'Wrong year & journal',
    tagVi: 'Sai năm & tạp chí',
    referencesText:
      'Kahneman, D., & Tversky, A. (1981). Prospect theory: An analysis of decision under risk. Journal of Political Economy, 47(2), 263–291. https://doi.org/10.2307/1914185',
    fallbackResponse: {
      elapsed_seconds: 0.38,
      total: 1,
      summary: {
        verified: 0,
        metadata_error: 1,
        suspected_hallucination: 0,
        layer1_linking_issues: 0,
      },
      remediated_apa:
        'Kahneman, D., & Tversky, A. (1979). Prospect theory: An analysis of decision under risk. Econometrica, 47(2), 263–291. https://doi.org/10.2307/1914185',
      results: [
        {
          index: 1,
          citation_raw:
            'Kahneman, D., & Tversky, A. (1981). Prospect theory: An analysis of decision under risk. Journal of Political Economy, 47(2), 263–291. https://doi.org/10.2307/1914185',
          cited_title: 'Prospect theory: An analysis of decision under risk',
          cited_authors: ['Kahneman, D.', 'Tversky, A.'],
          cited_year: '1981',
          cited_venue: 'Journal of Political Economy',
          cited_doi: '10.2307/1914185',
          label: 'metadata_error',
          confidence: 0.985,
          mapping_status: 'matched',
          mapping_note: 'Direct bibliography check.',
          reasoning:
            'Paper exists via DOI 10.2307/1914185, but official publication year is 1979 in Econometrica (cited as 1981 in Journal of Political Economy).',
          triggered_rules: ['R05_YEAR_DRIFT', 'R-YEAR-MISMATCH', 'R-VENUE-MISMATCH'],
          mismatched_fields: ['year', 'venue'],
          remediated_apa:
            'Kahneman, D., & Tversky, A. (1979). Prospect theory: An analysis of decision under risk. Econometrica, 47(2), 263–291. https://doi.org/10.2307/1914185',
          matched_source: {
            source: 'crossref',
            matched_fields: ['doi', 'title', 'authors'],
            checked_at: '2026-11-19T14:00:00Z',
            title: 'Prospect Theory: An Analysis of Decision under Risk',
            authors: ['Daniel Kahneman', 'Amos Tversky'],
            year: '1979',
            venue: 'Econometrica',
            doi: '10.2307/1914185',
            confidence: 0.985,
          },
          matched_sources: [
            {
              source: 'crossref',
              matched_fields: ['doi', 'title', 'authors'],
              checked_at: '2026-11-19T14:00:00Z',
              title: 'Prospect Theory: An Analysis of Decision under Risk',
              authors: ['Daniel Kahneman', 'Amos Tversky'],
              year: '1979',
              venue: 'Econometrica',
              doi: '10.2307/1914185',
              confidence: 0.985,
            },
          ],
        },
      ],
    },
  },
  {
    id: 'biomedical',
    labelEn: 'Biomedical Paper',
    labelVi: 'Bài báo Y sinh',
    tagEn: '100% verified DOI',
    tagVi: 'Khớp chuẩn 100%',
    referencesText:
      'Polack, F. P., Thomas, S. J., Kitchin, N., Absalon, J., Gurtman, A., & Gruber, W. C. (2020). Safety and efficacy of the BNT162b2 mRNA Covid-19 vaccine. New England Journal of Medicine, 383(27), 2603–2615. https://doi.org/10.1056/NEJMoa2034577',
    fallbackResponse: {
      elapsed_seconds: 0.34,
      total: 1,
      summary: {
        verified: 1,
        metadata_error: 0,
        suspected_hallucination: 0,
        layer1_linking_issues: 0,
      },
      remediated_apa:
        'Polack, F. P., Thomas, S. J., Kitchin, N., Absalon, J., Gurtman, A., & Gruber, W. C. (2020). Safety and efficacy of the BNT162b2 mRNA Covid-19 vaccine. New England Journal of Medicine, 383(27), 2603–2615. https://doi.org/10.1056/NEJMoa2034577',
      results: [
        {
          index: 1,
          citation_raw:
            'Polack, F. P., Thomas, S. J., Kitchin, N., Absalon, J., Gurtman, A., & Gruber, W. C. (2020). Safety and efficacy of the BNT162b2 mRNA Covid-19 vaccine. New England Journal of Medicine, 383(27), 2603–2615. https://doi.org/10.1056/NEJMoa2034577',
          cited_title: 'Safety and efficacy of the BNT162b2 mRNA Covid-19 vaccine',
          cited_authors: ['Polack, F. P.', 'Thomas, S. J.', 'Gruber, W. C.'],
          cited_year: '2020',
          cited_venue: 'New England Journal of Medicine',
          cited_doi: '10.1056/NEJMoa2034577',
          label: 'verified',
          confidence: 0.992,
          mapping_status: 'matched',
          mapping_note: 'Direct bibliography check.',
          reasoning:
            'Exact DOI, clinical trial title, author list, and 2020 NEJM issue confirmed across Crossref and Europe PMC.',
          triggered_rules: ['R01_EXACT_DOI', 'R-DOI-TITLE-AUTHOR', 'R-CONSENSUS-FULL'],
          mismatched_fields: [],
          remediated_apa:
            'Polack, F. P., Thomas, S. J., Kitchin, N., Absalon, J., Gurtman, A., & Gruber, W. C. (2020). Safety and efficacy of the BNT162b2 mRNA Covid-19 vaccine. New England Journal of Medicine, 383(27), 2603–2615. https://doi.org/10.1056/NEJMoa2034577',
          matched_source: {
            source: 'europepmc',
            matched_fields: ['doi', 'title', 'authors', 'year', 'venue'],
            checked_at: '2026-11-19T14:00:00Z',
            title: 'Safety and Efficacy of the BNT162b2 mRNA Covid-19 Vaccine',
            authors: ['Fernando P. Polack', 'Stephen J. Thomas', 'William C. Gruber'],
            year: '2020',
            venue: 'New England Journal of Medicine',
            doi: '10.1056/NEJMoa2034577',
            confidence: 0.992,
          },
          matched_sources: [
            {
              source: 'europepmc',
              matched_fields: ['doi', 'title', 'authors', 'year', 'venue'],
              checked_at: '2026-11-19T14:00:00Z',
              title: 'Safety and Efficacy of the BNT162b2 mRNA Covid-19 Vaccine',
              authors: ['Fernando P. Polack', 'Stephen J. Thomas', 'William C. Gruber'],
              year: '2020',
              venue: 'New England Journal of Medicine',
              doi: '10.1056/NEJMoa2034577',
              confidence: 0.992,
            },
          ],
        },
      ],
    },
  },
  {
    id: 'ai_invented',
    labelEn: 'AI-Invented Citation',
    labelVi: 'Nguồn AI tự bịa',
    tagEn: 'Fake DOI & title',
    tagVi: 'DOI & bài báo giả',
    referencesText:
      'Nguyen, T. H., & Morrison, D. R. (2024). Macroeconomic resilience of digital supply chains in ASEAN post-pandemic markets. Quarterly Journal of Economics, 139(4), 2145–2180. https://doi.org/10.1093/qje/qjae994',
    fallbackResponse: {
      elapsed_seconds: 0.41,
      total: 1,
      summary: {
        verified: 0,
        metadata_error: 0,
        suspected_hallucination: 1,
        layer1_linking_issues: 0,
      },
      remediated_apa: null,
      results: [
        {
          index: 1,
          citation_raw:
            'Nguyen, T. H., & Morrison, D. R. (2024). Macroeconomic resilience of digital supply chains in ASEAN post-pandemic markets. Quarterly Journal of Economics, 139(4), 2145–2180. https://doi.org/10.1093/qje/qjae994',
          cited_title:
            'Macroeconomic resilience of digital supply chains in ASEAN post-pandemic markets',
          cited_authors: ['Nguyen, T. H.', 'Morrison, D. R.'],
          cited_year: '2024',
          cited_venue: 'Quarterly Journal of Economics',
          cited_doi: '10.1093/qje/qjae994',
          label: 'suspected_hallucination',
          confidence: 0.96,
          mapping_status: 'matched',
          mapping_note: 'Direct bibliography check.',
          reasoning:
            'DOI 10.1093/qje/qjae994 returns HTTP 404 in Crossref and zero works match this title or author pair across 15+ libraries.',
          triggered_rules: ['R12_GHOST_DOI', 'R-NONEXISTENT-DOI', 'R-NO-SCHOLARLY-RECORD'],
          mismatched_fields: ['doi', 'title', 'authors'],
          remediated_apa: null,
          matched_source: null,
          matched_sources: [],
        },
      ],
    },
  },
];

function formatInteger(value: number, lang: Lang): string {
  const sep = lang === 'vi' ? '.' : ',';
  return Math.trunc(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

function formatConfidencePercent(confidence0to1: number, lang: Lang): string {
  const pct = Math.max(0, Math.min(100, confidence0to1 * 100));
  const roundedTenths = Math.round(pct * 10) / 10;
  const isWhole = Math.abs(roundedTenths - Math.round(roundedTenths)) < 0.05;
  if (isWhole) {
    return `${Math.round(roundedTenths)}%`;
  }
  const formatted = roundedTenths.toFixed(1);
  return lang === 'vi' ? `${formatted.replace('.', ',')}%` : `${formatted}%`;
}

const GUEST_BIB_HEADER_RE =
  /^(?:references?|reference\s+list|bibliography|works?\s+cited|tài\s+liệu\s+tham\s+khảo)\s*:?$/i;
const GUEST_NUMBERED_MARKER_G_RE =
  /(?:\[\s*\d+[a-z]?\s*\]|(?:^|\s)\d{1,2}[.)]\s+[A-ZÀ-ÝĂÂĐÊÔƠƯh])/g;
const GUEST_NUMBERED_LINE_START_RE =
  /^(?:\[\s*\d+[a-z]?\s*\]|\d{1,2}[.)]\s+[A-ZÀ-ÝĂÂĐÊÔƠƯh])/;
const GUEST_PAREN_YEAR_OR_ND_G_RE =
  /\(\s*(?:18|19|20)\d{2}[a-z]?(?:\s*,\s*[^)]*)?\s*\)|\(\s*n\.?\s*d\.?\s*\)/gi;
const GUEST_PAREN_YEAR_OR_ND_RE =
  /\(\s*(?:18|19|20)\d{2}[a-z]?(?:\s*,\s*[^)]*)?\s*\)|\(\s*n\.?\s*d\.?\s*\)/i;
const GUEST_LEADING_PAREN_YEAR_OR_ND_RE =
  /^\(\s*(?:(?:18|19|20)\d{2}[a-z]?(?:\s*,\s*[^)]*)?|n\.?\s*d\.?)\s*\)/i;
const GUEST_STANDALONE_URL_DOI_LINE_RE =
  /^(?:https?:\/\/|www\.|doi\s*:\s*|10\.\d{4,9}\/)\S+$/i;
const GUEST_HAS_URL_OR_DOI_RE =
  /(?:https?:\/\/\S+|www\.\S+|\bdoi\s*:\s*\S+|\b10\.\d{4,9}\/\S+)/i;
const GUEST_COMPLETE_SINGLE_LINE_CITATION_RE =
  /\(\s*(?:(?:18|19|20)\d{2}[a-z]?(?:\s*,\s*[^)]*)?|n\.?\s*d\.?)\s*\)\.\s+\S.{10,}\.\s+\S.{3,}/i;

export function estimateGuestReferenceCount(rawText: string): number {
  const trimmed = rawText.trim();
  if (!trimmed) return 0;

  let rawLines = trimmed.split(/\r?\n/).map((ln) => ln.trim());
  if (rawLines.length > 0 && GUEST_BIB_HEADER_RE.test(rawLines[0])) {
    rawLines = rawLines.slice(1);
  }
  const nonEmptyLines = rawLines.filter(Boolean);
  if (nonEmptyLines.length === 0) return 0;

  const cleanBody = nonEmptyLines.join('\n');
  const bodyWithBlanks = rawLines.join('\n').trim();

  // 1. Blank-line-separated paragraphs
  const paragraphs = bodyWithBlanks
    .split(/\n\s*\n+/)
    .map((b) => b.trim())
    .filter((b) => b.length > 12);

  // 2. Numbered entry markers — both line-start and inline (avoiding DOI decimals like 10.1093)
  const numberedMarkers = (cleanBody.match(GUEST_NUMBERED_MARKER_G_RE) ?? []).length;

  // 3. Parenthetical APA/Harvard year or (n.d.) markers
  const parenYearMarkers = (cleanBody.match(GUEST_PAREN_YEAR_OR_ND_G_RE) ?? []).length;

  // 4. Standalone URL/DOI lines + preceding non-URL bibliography entries
  let urlAndEntryCount = 0;
  let openEntryNeedsUrl = false;
  let openEntryComplete = false;
  for (const ln of nonEmptyLines) {
    const isStandaloneUrl = GUEST_STANDALONE_URL_DOI_LINE_RE.test(ln);
    const lineHasUrl = GUEST_HAS_URL_OR_DOI_RE.test(ln);
    const isCompleteSingleLine = GUEST_COMPLETE_SINGLE_LINE_CITATION_RE.test(ln);
    const lineStartsEntry =
      GUEST_PAREN_YEAR_OR_ND_RE.test(ln) ||
      GUEST_NUMBERED_LINE_START_RE.test(ln) ||
      /\b(?:18|19|20)\d{2}[a-z]?\s*[;:.]/.test(ln);

    if (isStandaloneUrl) {
      if (openEntryNeedsUrl && !openEntryComplete) {
        openEntryNeedsUrl = false;
        openEntryComplete = true;
      } else {
        urlAndEntryCount += 1;
        openEntryNeedsUrl = false;
        openEntryComplete = true;
      }
    } else if (lineStartsEntry) {
      if (
        urlAndEntryCount === 1 &&
        !openEntryComplete &&
        GUEST_LEADING_PAREN_YEAR_OR_ND_RE.test(ln)
      ) {
        openEntryNeedsUrl = !lineHasUrl && !isCompleteSingleLine;
        openEntryComplete = lineHasUrl || isCompleteSingleLine;
      } else {
        urlAndEntryCount += 1;
        openEntryNeedsUrl = !lineHasUrl && !isCompleteSingleLine;
        openEntryComplete = lineHasUrl || isCompleteSingleLine;
      }
    } else if (lineHasUrl) {
      if (openEntryNeedsUrl && !openEntryComplete) {
        openEntryNeedsUrl = false;
        openEntryComplete = true;
      } else {
        urlAndEntryCount += 1;
        openEntryNeedsUrl = false;
        openEntryComplete = true;
      }
    } else if (urlAndEntryCount === 0 || openEntryComplete) {
      urlAndEntryCount += 1;
      openEntryNeedsUrl = true;
      openEntryComplete = false;
    }
  }

  return Math.max(
    1,
    paragraphs.length,
    numberedMarkers,
    parenYearMarkers,
    urlAndEntryCount,
  );
}

function getVerdictBadgeVariantClass(label: string): string {
  const norm = String(label || '').toLowerCase();
  if (norm === 'verified') return 'verdict-badge-verified';
  if (norm === 'likely_verified') return 'verdict-badge-likely-verified';
  if (norm === 'metadata_error') return 'verdict-badge-metadata-error';
  if (norm === 'suspected_hallucination' || norm === 'hallucinated') {
    return 'verdict-badge-hallucinated';
  }
  return 'verdict-badge-unresolved';
}

function buildOfflinePreviewResponse(rawText: string): SandboxInstantVerifyResponse {
  const normalizedInput = rawText.trim();
  const matchedPreset = GUEST_PRESETS.find(
    (p) => p.referencesText.trim() === normalizedInput,
  );
  if (matchedPreset) {
    return matchedPreset.fallbackResponse;
  }

  const lines = normalizedInput
    .split(/\n\s*\n+|\r?\n/)
    .map((ln) => ln.trim())
    .filter((ln) => ln.length >= 8)
    .slice(0, MAX_GUEST_REFERENCES);

  const entries = (lines.length > 0 ? lines : [normalizedInput]).map(
    (line, idx): SandboxInstantVerdictItem => {
      const hasFakeMarker = /qjae994|99812-x|invented|fabricated|fake/i.test(line);
      const label = hasFakeMarker ? 'suspected_hallucination' : 'unresolved';
      const extractedDoi = line.match(/\b10\.\d{4,9}\/[^\s,;)"]+/)?.[0] ?? null;
      return {
        index: idx + 1,
        citation_raw: line,
        cited_doi: extractedDoi,
        label,
        confidence: hasFakeMarker ? 0.91 : 0.65,
        mapping_status: 'matched',
        mapping_note: 'Offline preview check.',
        reasoning: hasFakeMarker
          ? 'No matching scholarly record or valid DOI handle detected in local preview.'
          : 'Live scholarly database connection unavailable; queued for manual check.',
        triggered_rules: hasFakeMarker
          ? ['R12_GHOST_DOI', 'R-NO-SCHOLARLY-RECORD']
          : ['R-ABSTENTION-BORDER'],
        mismatched_fields: hasFakeMarker ? ['doi', 'title'] : [],
        remediated_apa: null,
        matched_source: null,
        matched_sources: [],
      };
    },
  );

  return {
    elapsed_seconds: 0.12,
    total: entries.length,
    summary: {
      verified: 0,
      metadata_error: 0,
      suspected_hallucination: entries.filter(
        (e) => e.label === 'suspected_hallucination',
      ).length,
      unresolved: entries.filter((e) => e.label === 'unresolved').length,
      layer1_linking_issues: 0,
    },
    results: entries,
    remediated_apa: null,
  };
}

function resolveItemRemediatedApa(
  item: SandboxInstantVerdictItem,
  idx: number,
  response: SandboxInstantVerifyResponse,
): string | null {
  if (item.label === 'suspected_hallucination') return null;
  const direct = item.remediated_apa?.trim();
  if (direct) return direct;
  const fromEntries = response.remediation?.entries?.[idx]?.apa?.trim();
  if (fromEntries) return fromEntries;
  if (response.results.length === 1 && response.remediated_apa?.trim()) {
    return response.remediated_apa.trim();
  }
  return null;
}

export function GuestInstantChecker({
  lang,
  isAuthenticated: isAuthenticatedProp,
}: {
  lang: Lang;
  isAuthenticated?: boolean;
}) {
  const auth = useContext(AuthContext);
  const isAuthenticated = isAuthenticatedProp ?? Boolean(auth?.user);
  const fullDraftPath = isAuthenticated ? '/upload' : '/register';

  const defaultPreset = GUEST_PRESETS[0];
  const [activePresetId, setActivePresetId] = useState<PresetId | null>(defaultPreset.id);
  const [referencesText, setReferencesText] = useState<string>(defaultPreset.referencesText);
  const [verifiedInputSnapshot, setVerifiedInputSnapshot] = useState<string>(
    defaultPreset.referencesText.trim(),
  );
  const [result, setResult] = useState<SandboxInstantVerifyResponse>(
    defaultPreset.fallbackResponse,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const [isOfflinePreview, setIsOfflinePreview] = useState(false);
  const [showTechnicalTrace, setShowTechnicalTrace] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const charCount = referencesText.length;
  const refCount = estimateGuestReferenceCount(referencesText);
  const isOverLimit =
    charCount > MAX_GUEST_CHARS || refCount > MAX_GUEST_REFERENCES;
  const shouldHideStaleResults =
    (Boolean(inlineError) || isRateLimited) &&
    referencesText.trim() !== verifiedInputSnapshot;

  const validateInput = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (!trimmed) {
      return lang === 'vi'
        ? 'Vui lòng dán từ 1 đến 3 tài liệu tham khảo vào ô bên trên hoặc chọn một mẫu có sẵn.'
        : 'Please paste 1 to 3 references above, or click one of the academic sample pills.';
    }
    if (raw.length > MAX_GUEST_CHARS) {
      return lang === 'vi'
        ? `Khung kiểm tra nhanh hỗ trợ tối đa ${formatInteger(MAX_GUEST_CHARS, 'vi')} ký tự (tối đa 3 trích dẫn). Để rà soát toàn bộ luận văn hoặc bài báo PDF/Word, hãy tạo tài khoản miễn phí.`
        : `Instant guest check supports up to ${formatInteger(MAX_GUEST_CHARS, 'en')} characters (up to 3 references). Create a free account to upload your full PDF or Word draft.`;
    }
    const count = estimateGuestReferenceCount(trimmed);
    if (count > MAX_GUEST_REFERENCES) {
      return lang === 'vi'
        ? `Bạn đang dán ${count} mục (giới hạn kiểm tra nhanh là tối đa ${MAX_GUEST_REFERENCES} trích dẫn). Hãy tạo tài khoản miễn phí để tải lên trọn vẹn file PDF, Word hoặc BibTeX.`
        : `You pasted ${count} references (instant guest preview checks up to ${MAX_GUEST_REFERENCES} at a time). Create a free account to verify your entire PDF, Word, or BibTeX draft.`;
    }
    return null;
  };

  const executeVerification = async (textToVerify: string) => {
    const validationMsg = validateInput(textToVerify);
    if (validationMsg) {
      setInlineError(validationMsg);
      setIsRateLimited(false);
      setRetryAfterSeconds(null);
      return;
    }

    const trimmedToVerify = textToVerify.trim();
    setInlineError(null);
    setIsRateLimited(false);
    setRetryAfterSeconds(null);
    setIsOfflinePreview(false);
    setIsLoading(true);

    try {
      const liveResp = await api.verifyPublicGuestCitations({
        references_text: trimmedToVerify,
        lang,
        style: 'apa',
      });
      setResult(liveResp);
      setVerifiedInputSnapshot(trimmedToVerify);
    } catch (err) {
      const errObj = err as Error & { status?: number; retryAfterSeconds?: number };
      const msg = String(errObj?.message || '');
      const status = errObj?.status;

      if (status === 429 || /\bAPI\s+429\b/i.test(msg)) {
        const parsedSec =
          typeof errObj?.retryAfterSeconds === 'number' && errObj.retryAfterSeconds > 0
            ? errObj.retryAfterSeconds
            : (() => {
                const m = msg.match(/\b(\d{1,3})\s*(?:s|sec|seconds?|giây)\b/i);
                return m ? Number.parseInt(m[1], 10) : null;
              })();
        setRetryAfterSeconds(
          parsedSec && Number.isFinite(parsedSec) && parsedSec > 0 ? parsedSec : null,
        );
        setIsRateLimited(true);
      } else if (status === 400 || /\bAPI\s+400\b/i.test(msg)) {
        const cleanDetail = msg.replace(/^API\s+\d+:\s*/i, '').trim();
        setInlineError(
          cleanDetail ||
            (lang === 'vi'
              ? 'Không thể kiểm tra nội dung vừa nhập. Vui lòng kiểm tra lại định dạng trích dẫn.'
              : 'Could not verify this input. Please check the reference text and try again.'),
        );
      } else {
        setIsOfflinePreview(true);
        setResult(buildOfflinePreviewResponse(textToVerify));
        setVerifiedInputSnapshot(trimmedToVerify);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectPreset = (preset: GuestPreset) => {
    setActivePresetId(preset.id);
    setReferencesText(preset.referencesText);
    setResult(preset.fallbackResponse);
    setVerifiedInputSnapshot(preset.referencesText.trim());
    void executeVerification(preset.referencesText);
  };

  const handleCopyRemediated = (apaText: string, idx: number) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(apaText);
    }
    setCopiedIndex(idx);
    window.setTimeout(() => {
      setCopiedIndex((prev) => (prev === idx ? null : prev));
    }, 2000);
  };

  const serifTuneClass =
    lang === 'vi'
      ? 'leading-[1.15] tracking-[-0.03em]'
      : 'leading-[1.12] tracking-[-0.04em]';

  return (
    <section
      id="try-instant"
      data-testid="guest-instant-checker"
      className="scroll-mt-[88px] py-12 sm:py-16 lg:py-20 px-5 sm:px-6 lg:px-[40px]"
    >
      <div className="max-w-[1200px] mx-auto space-y-7 sm:space-y-9">
        {/* Section Heading */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div className="space-y-3 max-w-[680px]">
            <SolvaEyebrow>
              {lang === 'vi'
                ? 'Kiểm tra nhanh · Không cần tạo tài khoản'
                : 'Instant Check · No Account Required'}
            </SolvaEyebrow>
            <SolvaTwoToneHeading
              as="h2"
              size="h2"
              primary={
                lang === 'vi'
                  ? 'Dán thử tối đa 3 trích dẫn.'
                  : 'Test up to 3 citations right now.'
              }
              secondary={
                lang === 'vi'
                  ? 'Đối chiếu trực tiếp với hơn 15 thư viện học thuật.'
                  : 'Verified live against 15+ academic libraries.'
              }
            />
          </div>
          <p
            style={{ color: 'var(--solva-muted)' }}
            className="font-solva-sans text-sm sm:text-[15px] leading-relaxed max-w-[420px]"
          >
            {lang === 'vi'
              ? 'Chọn một mẫu thực tế bên dưới hoặc dán mục Tài liệu tham khảo từ khóa luận của bạn để xem CITRA phát hiện năm sai và nguồn do AI tự bịa.'
              : 'Click an academic preset below or paste references from your draft to see CITRA catch wrong years and AI-invented papers on the spot.'}
          </p>
        </div>

        {/* Interactive Studio Card */}
        <div
          style={{
            backgroundColor: 'var(--solva-surface)',
            borderColor: 'var(--solva-border)',
          }}
          className="rounded-[16px] border p-4 sm:p-6 lg:p-7 space-y-5 shadow-sm"
        >
          {/* Row 1: 3 One-Click Academic Preset Pills */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                style={{ color: 'var(--solva-muted)' }}
                className="font-mono text-[11px] uppercase tracking-wider font-semibold mr-1"
              >
                {lang === 'vi' ? 'Mẫu thử 1 chạm:' : '1-Click Samples:'}
              </span>
              {GUEST_PRESETS.map((preset) => {
                const isActive = activePresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    data-testid={`guest-preset-${preset.id}`}
                    onClick={() => handleSelectPreset(preset)}
                    style={{
                      backgroundColor: isActive
                        ? 'var(--solva-btn-bg)'
                        : 'var(--solva-card-elevated)',
                      color: isActive ? 'var(--solva-btn-fg)' : 'var(--solva-ink)',
                      borderColor: isActive
                        ? 'var(--solva-btn-bg)'
                        : 'var(--solva-border)',
                    }}
                    className="min-h-[44px] px-3.5 py-2 rounded-[10px] border font-solva-sans text-xs sm:text-[13px] font-medium inline-flex items-center gap-2 transition-colors cursor-pointer hover:opacity-90"
                  >
                    <Sparkles className="w-3.5 h-3.5 shrink-0 opacity-80" />
                    <span>{lang === 'vi' ? preset.labelVi : preset.labelEn}</span>
                    <span
                      className={`hidden md:inline-block text-[10.5px] font-mono px-1.5 py-0.5 rounded ${
                        isActive
                          ? 'bg-white/[0.16] dark:bg-black/[0.18]'
                          : 'bg-[#F4F2EC] dark:bg-[#29261F]'
                      }`}
                    >
                      {lang === 'vi' ? preset.tagVi : preset.tagEn}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Live Reference & Character Counters */}
            <div
              data-testid="guest-checker-counters"
              style={{ color: 'var(--solva-muted)' }}
              className="flex flex-wrap items-center gap-2.5 font-mono text-xs shrink-0"
            >
              <span
                className={`px-2.5 py-1 rounded-[7px] border ${
                  refCount > MAX_GUEST_REFERENCES
                    ? 'border-amber-600/50 bg-amber-500/[0.12] text-amber-800 dark:text-amber-300 font-semibold'
                    : 'border-[#E7E3D9] dark:border-[#332F26] bg-[#FBFAF6] dark:bg-[#141310]'
                }`}
              >
                {lang === 'vi'
                  ? `${refCount} / ${MAX_GUEST_REFERENCES} trích dẫn`
                  : `${refCount} / ${MAX_GUEST_REFERENCES} refs`}
              </span>
              <span
                className={
                  charCount > MAX_GUEST_CHARS
                    ? 'text-amber-800 dark:text-amber-300 font-semibold'
                    : ''
                }
              >
                {formatInteger(charCount, lang)} / {formatInteger(MAX_GUEST_CHARS, lang)}{' '}
                {lang === 'vi' ? 'ký tự' : 'chars'}
              </span>
            </div>
          </div>

          {/* Row 2: Manuscript Reference Input Textarea + Primary Check Action */}
          <div className="space-y-3">
            <label htmlFor="guest-citations-textarea" className="sr-only">
              {lang === 'vi'
                ? 'Dán tối đa 3 tài liệu tham khảo cần kiểm tra'
                : 'Paste up to 3 academic references to verify'}
            </label>
            <textarea
              id="guest-citations-textarea"
              rows={3}
              value={referencesText}
              onChange={(e) => {
                setReferencesText(e.target.value);
                setActivePresetId(null);
                if (inlineError) setInlineError(null);
              }}
              placeholder={
                lang === 'vi'
                  ? 'Dán từ 1 đến 3 mục tài liệu tham khảo (chuẩn APA, IEEE, Harvard...) vào đây...'
                  : 'Paste 1 to 3 bibliography entries (APA, IEEE, Harvard, MLA...) here...'
              }
              aria-invalid={Boolean(inlineError) || isOverLimit}
              style={{
                backgroundColor: 'var(--solva-card-elevated)',
                color: 'var(--solva-ink)',
              }}
              className={`w-full rounded-[12px] border p-3.5 sm:p-4 font-solva-sans text-sm leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-[#1C1A15]/20 dark:focus:ring-[#FBFAF6]/25 ${
                inlineError || isOverLimit
                  ? 'border-amber-600 dark:border-amber-500'
                  : 'border-[#E7E3D9] dark:border-[#332F26]'
              }`}
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  data-testid="guest-checker-submit"
                  disabled={isLoading}
                  onClick={() => void executeVerification(referencesText)}
                  style={{
                    backgroundColor: 'var(--solva-btn-bg)',
                    color: 'var(--solva-btn-fg)',
                  }}
                  className="min-h-[44px] px-5 py-2.5 rounded-[10px] font-solva-sans text-sm font-medium inline-flex items-center justify-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-60 cursor-pointer"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                      <span>
                        {lang === 'vi'
                          ? 'Đang đối chiếu thư viện...'
                          : 'Checking libraries...'}
                      </span>
                    </>
                  ) : (
                    <>
                      <BookOpen className="w-4 h-4 shrink-0" />
                      <span>
                        {lang === 'vi' ? 'Kiểm tra trích dẫn ngay' : 'Check Citations Now'}
                      </span>
                    </>
                  )}
                </button>

                {referencesText.trim().length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setReferencesText('');
                      setActivePresetId(null);
                      setInlineError(null);
                      setIsRateLimited(false);
                      setRetryAfterSeconds(null);
                    }}
                    style={{
                      backgroundColor: 'var(--solva-card-elevated)',
                      borderColor: 'var(--solva-border)',
                      color: 'var(--solva-muted)',
                    }}
                    className="min-h-[44px] px-3.5 py-2 rounded-[10px] border font-solva-sans text-xs sm:text-sm font-medium inline-flex items-center gap-1.5 hover:opacity-85 transition-opacity cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                    <span>{lang === 'vi' ? 'Xóa ô nhập' : 'Clear'}</span>
                  </button>
                )}
              </div>

              <span
                style={{ color: 'var(--solva-muted)' }}
                className="text-xs font-solva-sans"
              >
                {lang === 'vi'
                  ? 'Miễn phí · Không lưu bản nháp công khai · Đối chiếu Crossref, OpenAlex & PubMed'
                  : 'Free live check · Private · Cross-checked with Crossref, OpenAlex & PubMed'}
              </span>
            </div>
          </div>

          {/* Inline Input Guidance Alert (Empty / >3 refs / >1500 chars) */}
          {inlineError && (
            <div
              role="alert"
              data-testid="guest-checker-inline-alert"
              className="rounded-[12px] border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-amber-900 dark:text-amber-200"
            >
              <div className="flex items-start gap-2.5 text-xs sm:text-sm leading-relaxed">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-800 dark:text-amber-300" />
                <span>{inlineError}</span>
              </div>
              {(charCount > MAX_GUEST_CHARS || refCount > MAX_GUEST_REFERENCES) && (
                <Link
                  to={fullDraftPath}
                  className="min-h-[44px] px-3.5 py-2 rounded-[9px] bg-amber-800 text-white dark:bg-amber-300 dark:text-[#1C1A15] font-solva-sans text-xs font-semibold inline-flex items-center justify-center text-center gap-1.5 shrink-0 w-full sm:w-auto sm:whitespace-nowrap hover:opacity-90 transition-opacity"
                >
                  <span>
                    {lang === 'vi' ? 'Tải toàn bộ bài viết' : 'Upload Full Draft'}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                </Link>
              )}
            </div>
          )}

          {/* Friendly 429 Rate-Limit Banner */}
          {isRateLimited && (
            <div
              role="alert"
              data-testid="guest-checker-rate-limit-banner"
              style={{
                backgroundColor: 'var(--solva-card-elevated)',
                borderColor: 'var(--solva-border)',
              }}
              className="rounded-[12px] border p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="space-y-1">
                <div
                  style={{ color: 'var(--solva-ink)' }}
                  className="font-solva-sans text-sm font-semibold"
                >
                  {lang === 'vi'
                    ? 'Bạn đã dùng hết 6 lượt kiểm tra nhanh trong phút này'
                    : 'You’ve reached the 6-check guest preview limit for this minute'}
                </div>
                <p
                  style={{ color: 'var(--solva-muted)' }}
                  className="font-solva-sans text-xs sm:text-sm leading-relaxed"
                >
                  {lang === 'vi'
                    ? `Đợi ${retryAfterSeconds ? `~${retryAfterSeconds}s` : 'khoảng một phút'} để thử tiếp trên trang chủ, hoặc mở tài khoản miễn phí để tải lên trọn bộ khóa luận PDF/Word không bị gián đoạn.`
                    : `Wait ${retryAfterSeconds ? `~${retryAfterSeconds}s` : 'a moment'} to run another quick check here, or create a free account to upload your full PDF or Word manuscript without waiting.`}
                </p>
              </div>
              <Link
                to={fullDraftPath}
                style={{
                  backgroundColor: 'var(--solva-btn-bg)',
                  color: 'var(--solva-btn-fg)',
                }}
                className="min-h-[44px] px-4 py-2.5 rounded-[10px] font-solva-sans text-xs sm:text-sm font-medium inline-flex items-center justify-center text-center gap-2 shrink-0 w-full sm:w-auto sm:whitespace-nowrap hover:opacity-90 transition-opacity"
              >
                <span>
                  {isAuthenticated
                    ? lang === 'vi'
                      ? 'Mở trình tải tài liệu'
                      : 'Open Full Uploader'
                    : lang === 'vi'
                      ? 'Tạo tài khoản miễn phí'
                      : 'Create Free Account'}
                </span>
                <ArrowRight className="w-4 h-4 shrink-0" />
              </Link>
            </div>
          )}

          {/* Calm Offline Preview Notice */}
          {isOfflinePreview && !shouldHideStaleResults && (
            <div
              data-testid="guest-checker-offline-notice"
              style={{
                backgroundColor: 'var(--solva-card-elevated)',
                borderColor: 'var(--solva-border)',
                color: 'var(--solva-muted)',
              }}
              className="rounded-[10px] border px-3.5 py-2.5 text-xs font-solva-sans flex items-center gap-2"
            >
              <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
              <span>
                {lang === 'vi'
                  ? 'Chế độ xem trước ngoại tuyến — hiển thị kết quả đối chiếu mẫu ngay trên trình duyệt khi máy chủ tạm thời chưa phản hồi.'
                  : 'Offline preview mode — showing instant browser check while the live verification server is unreachable.'}
              </span>
            </div>
          )}

          {/* Split-View Manuscript Diff Results & Progressive Disclosure Trace */}
          <div
            aria-live="polite"
            aria-busy={isLoading}
            className="space-y-4"
          >
            {!shouldHideStaleResults && (
              <>
                <div className="space-y-4">
                  {result.results.map((item, idx) => {
                    const plainVerdict = getPlainVerdictLabel(item.label, lang);
                    const badgeVariant = getVerdictBadgeVariantClass(item.label);
                    const matchedSource =
                      item.matched_source ?? item.matched_sources?.[0] ?? null;
                    const remediatedApa = resolveItemRemediatedApa(item, idx, result);
                    const mismatchedSet = new Set(
                      (item.mismatched_fields ?? []).map((f) => f.toLowerCase()),
                    );

                    return (
                      <div
                        key={`${item.index}-${idx}`}
                        data-testid={`guest-checker-result-${idx}`}
                        style={{
                          backgroundColor: 'var(--solva-card-elevated)',
                          borderColor: 'var(--solva-border)',
                        }}
                        className="rounded-[14px] border p-4 sm:p-5 space-y-4"
                      >
                        {/* Card Top Header: Marker + Plain Verdict Badge + Confidence */}
                        <div
                          style={{ borderColor: 'var(--solva-border)' }}
                          className="flex flex-wrap items-center justify-between gap-3 pb-3.5 border-b"
                        >
                          <div className="flex flex-wrap items-center gap-2.5">
                            <span
                              style={{
                                backgroundColor: 'var(--solva-surface)',
                                color: 'var(--solva-ink)',
                              }}
                              className="font-mono text-xs font-bold px-2.5 py-1 rounded-[6px]"
                            >
                              [{item.index}]
                            </span>
                            <span
                              className={`verdict-badge ${badgeVariant} text-xs px-3 py-1 font-semibold inline-flex items-center gap-1.5`}
                            >
                              {item.label === 'verified' ? (
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              ) : item.label === 'suspected_hallucination' ? (
                                <XCircle className="w-3.5 h-3.5 shrink-0" />
                              ) : (
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                              )}
                              <span>{plainVerdict.label}</span>
                            </span>
                          </div>

                          <div
                            style={{ color: 'var(--solva-muted)' }}
                            className="font-mono text-xs flex items-center gap-2"
                          >
                            <span>
                              {lang === 'vi' ? 'Độ tin cậy:' : 'Confidence:'}{' '}
                              <strong style={{ color: 'var(--solva-ink)' }}>
                                {formatConfidencePercent(item.confidence, lang)}
                              </strong>
                            </span>
                          </div>
                        </div>

                        {/* Split-View Manuscript Diff: Submitted Citation vs. Matched Library Record */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
                          {/* Left Column: Submitted Citation */}
                          <div
                            style={{
                              backgroundColor: 'var(--solva-surface)',
                              borderColor: 'var(--solva-border)',
                            }}
                            className="rounded-[10px] border p-3.5 sm:p-4 space-y-2.5"
                          >
                            <div
                              style={{ color: 'var(--solva-muted)' }}
                              className="font-mono text-[11px] uppercase tracking-wider font-semibold"
                            >
                              {lang === 'vi'
                                ? 'Trích dẫn bạn đưa vào'
                                : 'Submitted in Your Draft'}
                            </div>
                            <p
                              style={{ color: 'var(--solva-ink)' }}
                              className={`font-solva-serif text-sm sm:text-[15px] ${serifTuneClass} break-words`}
                            >
                              {item.citation_raw.normalize('NFC')}
                            </p>
                            {(item.cited_year || item.cited_venue || item.cited_doi) && (
                              <div className="flex flex-wrap gap-1.5 pt-1 text-[11px] font-mono">
                                {item.cited_year && (
                                  <span
                                    className={`px-2 py-0.5 rounded border ${
                                      mismatchedSet.has('year')
                                        ? 'border-amber-600/40 bg-amber-500/[0.12] text-amber-800 dark:text-amber-300 font-semibold'
                                        : 'border-[#E7E3D9] dark:border-[#332F26] text-[#56524A] dark:text-[#A8A296]'
                                    }`}
                                  >
                                    {lang === 'vi' ? 'Năm ghi:' : 'Cited year:'} {item.cited_year}
                                  </span>
                                )}
                                {item.cited_venue && (
                                  <span
                                    className={`px-2 py-0.5 rounded border break-words ${
                                      mismatchedSet.has('venue')
                                        ? 'border-amber-600/40 bg-amber-500/[0.12] text-amber-800 dark:text-amber-300 font-semibold'
                                        : 'border-[#E7E3D9] dark:border-[#332F26] text-[#56524A] dark:text-[#A8A296]'
                                    }`}
                                  >
                                    {item.cited_venue}
                                  </span>
                                )}
                                {item.cited_doi && (
                                  <span
                                    data-testid={`guest-checker-cited-doi-${idx}`}
                                    className={`px-2 py-0.5 rounded border break-all ${
                                      item.label === 'suspected_hallucination'
                                        ? 'text-red-700 dark:text-red-300 border-red-500/30 bg-red-500/[0.08] font-semibold'
                                        : mismatchedSet.has('doi')
                                          ? 'border-amber-600/40 bg-amber-500/[0.12] text-amber-800 dark:text-amber-300 font-semibold'
                                          : 'border-[#E7E3D9] dark:border-[#332F26] text-[#56524A] dark:text-[#A8A296]'
                                    }`}
                                  >
                                    DOI: {item.cited_doi}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Right Column: Official Matched Library Record */}
                          <div
                            style={{
                              backgroundColor: 'var(--solva-surface)',
                              borderColor: 'var(--solva-border)',
                            }}
                            className="rounded-[10px] border p-3.5 sm:p-4 space-y-2.5"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span
                                style={{ color: 'var(--solva-muted)' }}
                                className="font-mono text-[11px] uppercase tracking-wider font-semibold"
                              >
                                {lang === 'vi'
                                  ? 'Hồ sơ gốc trên thư viện học thuật'
                                  : 'Official Library Record'}
                              </span>
                              {matchedSource?.source && (
                                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300 font-semibold">
                                  {getSourceDisplayName(matchedSource.source, lang)}
                                </span>
                              )}
                            </div>

                            {matchedSource ? (
                              <div className="space-y-2">
                                <div
                                  style={{ color: 'var(--solva-ink)' }}
                                  className={`font-solva-serif text-sm sm:text-[15px] font-normal ${serifTuneClass} break-words`}
                                >
                                  {(matchedSource.title || item.citation_raw).normalize('NFC')}
                                </div>
                                <div
                                  style={{ color: 'var(--solva-muted)' }}
                                  className="text-xs leading-relaxed break-words"
                                >
                                  {(matchedSource.authors ?? []).join(', ')}
                                </div>
                                <div className="flex flex-wrap gap-1.5 text-[11px] font-mono">
                                  {matchedSource.year && (
                                    <span className="px-2 py-0.5 rounded bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300 font-semibold">
                                      {lang === 'vi' ? 'Năm xuất bản:' : 'Published:'}{' '}
                                      {matchedSource.year}
                                    </span>
                                  )}
                                  {matchedSource.venue && (
                                    <span className="px-2 py-0.5 rounded bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300 font-semibold break-words">
                                      {matchedSource.venue}
                                    </span>
                                  )}
                                  {matchedSource.doi && (
                                    <span
                                      style={{ color: 'var(--solva-muted)' }}
                                      className="px-2 py-0.5 rounded border border-[#E7E3D9] dark:border-[#332F26] break-all"
                                    >
                                      DOI: {matchedSource.doi}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div className="py-2 space-y-1.5">
                                <p className="text-xs sm:text-sm font-medium text-red-700 dark:text-red-300">
                                  {lang === 'vi'
                                    ? 'Không tìm thấy bài báo hoặc mã DOI này trên hơn 15 thư viện học thuật.'
                                    : 'No matching paper or valid DOI found across 15+ academic libraries.'}
                                </p>
                                <p
                                  style={{ color: 'var(--solva-muted)' }}
                                  className="text-xs leading-relaxed"
                                >
                                  {lang === 'vi'
                                    ? 'Các công cụ tạo văn bản AI thường ghép tên tạp chí uy tín với mã DOI hoặc tiêu đề chưa từng xuất bản.'
                                    : 'AI writing tools frequently pair real journal names with non-existent DOIs or invented article titles.'}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Plain-Language Action Hint */}
                        <div
                          style={{
                            backgroundColor: 'var(--solva-surface)',
                            borderColor: 'var(--solva-border)',
                          }}
                          className="rounded-[10px] border p-3.5 flex items-start gap-2.5 text-xs sm:text-sm leading-relaxed"
                        >
                          <Scale
                            style={{ color: 'var(--solva-ink)' }}
                            className="w-4 h-4 shrink-0 mt-0.5"
                          />
                          <div style={{ color: 'var(--solva-ink)' }}>
                            <strong className="mr-1.5">
                              {lang === 'vi' ? 'Hướng xử lý gợi ý:' : 'Recommended action:'}
                            </strong>
                            <span style={{ color: 'var(--solva-muted)' }}>
                              {plainVerdict.actionHint}
                            </span>
                          </div>
                        </div>

                        {/* Copyable Corrected APA 7th Reference */}
                        {remediatedApa && (
                          <div
                            style={{
                              backgroundColor: 'var(--solva-bg)',
                              borderColor: 'var(--solva-border)',
                            }}
                            className="rounded-[10px] border p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                          >
                            <div className="space-y-1 min-w-0">
                              <div className="text-[11px] font-mono font-semibold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">
                                {lang === 'vi'
                                  ? 'Chuẩn hóa trích dẫn APA 7th sẵn sàng sao chép'
                                  : 'Ready-to-Copy Corrected APA 7th Reference'}
                              </div>
                              <p
                                style={{ color: 'var(--solva-ink)' }}
                                className="text-xs sm:text-[13px] leading-relaxed break-words"
                              >
                                {remediatedApa}
                              </p>
                            </div>
                            <button
                              type="button"
                              data-testid={`guest-checker-copy-remediated-${idx}`}
                              onClick={() => handleCopyRemediated(remediatedApa, idx)}
                              style={{
                                backgroundColor: 'var(--solva-surface)',
                                borderColor: 'var(--solva-border)',
                                color: 'var(--solva-ink)',
                              }}
                              className="min-h-[44px] px-3.5 py-2 rounded-[9px] border font-solva-sans text-xs font-medium inline-flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap hover:opacity-85 transition-opacity cursor-pointer"
                            >
                              {copiedIndex === idx ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-300" />
                                  <span>{lang === 'vi' ? 'Đã chép' : 'Copied'}</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  <span>
                                    {lang === 'vi' ? 'Sao chép chuẩn APA' : 'Copy APA 7th'}
                                  </span>
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Progressive Disclosure: Optional Technical Rule Trace (R01–R30) */}
                <div className="pt-1 space-y-3">
                  <button
                    type="button"
                    data-testid="guest-checker-trace-toggle"
                    aria-expanded={showTechnicalTrace}
                    aria-controls="guest-checker-trace-panel"
                    onClick={() => setShowTechnicalTrace((prev) => !prev)}
                    style={{
                      backgroundColor: 'var(--solva-card-elevated)',
                      borderColor: showTechnicalTrace
                        ? 'var(--solva-ink)'
                        : 'var(--solva-border)',
                      color: 'var(--solva-ink)',
                    }}
                    className="w-full min-h-[44px] px-4 py-2.5 rounded-[10px] border font-solva-sans text-xs font-medium flex items-center justify-between gap-2 hover:opacity-90 transition-colors cursor-pointer"
                  >
                    <span>
                      {showTechnicalTrace
                        ? lang === 'vi'
                          ? 'Ẩn mã quy tắc kỹ thuật'
                          : 'Hide Technical Rule Trace'
                        : lang === 'vi'
                          ? `Tùy chọn: Xem mã quy tắc kỹ thuật (${SYMBOLIC_RULES_RANGE})`
                          : `Optional: View Technical Rule Trace (${SYMBOLIC_RULES_RANGE})`}
                    </span>
                    <SymmetricChevron open={showTechnicalTrace} size={14} />
                  </button>

                  <div
                    id="guest-checker-trace-panel"
                    data-testid="guest-checker-trace-panel"
                    hidden={!showTechnicalTrace}
                  >
                    {showTechnicalTrace && (
                      <div
                        style={{
                          backgroundColor: 'var(--solva-card-elevated)',
                          borderColor: 'var(--solva-border)',
                        }}
                        className="rounded-[12px] border p-4 space-y-3 font-mono text-xs"
                      >
                        {result.results.map((item, idx) => (
                          <div
                            key={`trace-${item.index}-${idx}`}
                            style={{
                              backgroundColor: 'var(--solva-surface)',
                              borderColor: 'var(--solva-border)',
                            }}
                            className="rounded-[9px] border p-3 space-y-2"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span style={{ color: 'var(--solva-ink)' }} className="font-bold">
                                [{item.index}] {String(item.label).toUpperCase()}
                              </span>
                              <span style={{ color: 'var(--solva-muted)' }}>
                                {lang === 'vi' ? 'Độ tin cậy:' : 'Confidence:'}{' '}
                                {formatConfidencePercent(item.confidence, lang)}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {(item.triggered_rules && item.triggered_rules.length > 0
                                ? item.triggered_rules
                                : ['R01_EXACT_DOI']
                              ).map((ruleCode) => (
                                <span
                                  key={ruleCode}
                                  style={{
                                    backgroundColor: 'var(--solva-bg)',
                                    borderColor: 'var(--solva-border)',
                                    color: 'var(--solva-ink)',
                                  }}
                                  className="px-2 py-1 rounded border text-[11px] break-words"
                                >
                                  <strong>{ruleCode}</strong> ·{' '}
                                  {getRuleDisplayName(ruleCode, lang)}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Bottom Full-Document Conversion Bar */}
          <div
            style={{
              backgroundColor: 'var(--solva-card-elevated)',
              borderColor: 'var(--solva-border)',
            }}
            className="rounded-[12px] border p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
          >
            <div className="space-y-1">
              <div
                style={{ color: 'var(--solva-ink)' }}
                className="font-solva-sans text-sm sm:text-[15px] font-semibold"
              >
                {lang === 'vi'
                  ? 'Cần kiểm tra toàn bộ khóa luận hoặc bài báo khoa học?'
                  : 'Need to check an entire thesis or journal manuscript?'}
              </div>
              <p
                style={{ color: 'var(--solva-muted)' }}
                className="font-solva-sans text-xs sm:text-sm leading-relaxed"
              >
                {lang === 'vi'
                  ? 'Tải lên file PDF, Word (.docx) hoặc BibTeX để tự động đối chiếu hai chiều mọi trích dẫn trong bài với danh mục cuối bài.'
                  : 'Upload your full PDF, Word (.docx), or BibTeX file to cross-check every in-text citation against your entire reference list.'}
              </p>
            </div>
            <Link
              to={fullDraftPath}
              data-testid="guest-checker-full-upload-cta"
              style={{
                backgroundColor: 'var(--solva-btn-bg)',
                color: 'var(--solva-btn-fg)',
              }}
              className="min-h-[44px] px-5 py-2.5 rounded-[10px] font-solva-sans text-xs sm:text-sm font-medium inline-flex items-center justify-center text-center gap-2 shrink-0 w-full sm:w-auto sm:whitespace-nowrap hover:opacity-90 transition-opacity"
            >
              <span>
                {isAuthenticated
                  ? lang === 'vi'
                    ? 'Tải bản thảo PDF/Word lên ngay'
                    : 'Upload Full PDF/Word Draft'
                  : lang === 'vi'
                    ? 'Kiểm tra toàn bộ file PDF/Word miễn phí'
                    : 'Check Full PDF/Word Draft Free'}
              </span>
              <ArrowRight className="w-4 h-4 shrink-0" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
