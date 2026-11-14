import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
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
  Terminal,
  Clock,
  ArrowRight,
  Upload,
  History,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type EssayStatus } from '@/api/client';
import { useVerificationProgress } from '@/contexts/VerificationProgressContext';
import { streamEssayEvents } from '@/hooks/useEssayStream';
import {
  SCHOLARLY_APIS_LABEL,
  SYMBOLIC_RULES_COUNT,
} from '@/lib/productFacts';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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
   ProcessingPage — Real-time pipeline progress (Scholarly Precision v2.0)
   Streams SSE /essays/{id}/events with GET /essays/{id}/status fallback.
   ============================================================ */

const STEP_LABELS: Array<{
  labelEn: string;
  labelVi: string;
  detailsEn: string;
  detailsVi: string;
  tag: string;
}> = [
  {
    labelEn: 'Parsing document structure (GROBID TEI-XML & DOCX)',
    labelVi: 'Phân tích cấu trúc tài liệu (GROBID TEI-XML & DOCX)',
    detailsEn: 'Reading text and document layout',
    detailsVi: 'Đọc nội dung và bố cục file',
    tag: 'GROBID v0.9.1 · DOCX',
  },
  {
    labelEn: 'Detecting citation style',
    labelVi: 'Nhận diện chuẩn trích dẫn học thuật',
    detailsEn: 'Identifying format (APA, IEEE, MLA…)',
    detailsVi: 'Nhận diện chuẩn APA, IEEE, MLA…',
    tag: 'STYLE ENGINE',
  },
  {
    labelEn: 'Extracting citations & references',
    labelVi: 'Trích xuất trích dẫn trong bài & Danh mục tham khảo',
    detailsEn: 'Finding citations and reference list',
    detailsVi: 'Tìm trích dẫn và tài liệu tham khảo',
    tag: 'LAYER 1 · PARSER',
  },
  {
    labelEn: 'Linking citations to references',
    labelVi: 'Ánh xạ hai chiều Trích dẫn ↔ Tài liệu tham khảo',
    detailsEn: 'Matching citations to references',
    detailsVi: 'Ghép trích dẫn với tài liệu tham khảo',
    tag: 'LINKING GRAPH',
  },
  {
    labelEn: `Retrieving source metadata across ${SCHOLARLY_APIS_LABEL} registries`,
    labelVi: `Truy hồi dữ liệu từ hệ thống ${SCHOLARLY_APIS_LABEL} CSDL học thuật & tri thức liên hợp`,
    detailsEn: 'Looking up papers in academic databases',
    detailsVi: 'Tra cứu bài gốc trên thư viện học thuật',
    tag: `${SCHOLARLY_APIS_LABEL} INDEXES`,
  },
  {
    labelEn: 'Comparing candidate publications & neural evidence',
    labelVi: 'Đối chiếu đa trường & bằng chứng ngữ nghĩa (Title, Authors, Year, Venue, DOI)',
    detailsEn: 'Checking titles, authors, and years',
    detailsVi: 'Kiểm tra tên bài, tác giả, năm xuất bản',
    tag: 'NEURAL DIFF',
  },
  {
    labelEn: `Applying ${SYMBOLIC_RULES_COUNT} neuro-symbolic rules & Platt calibration`,
    labelVi: `Kích hoạt hệ ${SYMBOLIC_RULES_COUNT} luật suy diễn hình thức & hiệu chỉnh Platt`,
    detailsEn: 'Checking for errors, broken links, or retractions',
    detailsVi: 'Kiểm tra sai sót, link hỏng, bài bị rút',
    tag: `${SYMBOLIC_RULES_COUNT} SYMBOLIC RULES`,
  },
  {
    labelEn: 'Generating verification report',
    labelVi: 'Tổng hợp báo cáo & Điểm Toàn vẹn Trích dẫn (CIS)',
    detailsEn: 'Calculating score and building report',
    detailsVi: 'Tính điểm tin cậy và tạo báo cáo',
    tag: 'CIS REPORT',
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

const SOURCE_DISPLAY_NAMES: Record<string, string> = {
  openalex: 'OpenAlex',
  crossref: 'Crossref',
  semanticscholar: 'Semantic Scholar',
  semantic_scholar: 'Semantic Scholar',
  arxiv: 'arXiv',
  pubmed: 'PubMed',
  europepmc: 'Europe PMC',
  europe_pmc: 'Europe PMC',
  dblp: 'DBLP',
  openlibrary: 'Open Library',
  open_library: 'Open Library',
  datacite: 'DataCite',
  doi_ra: 'DOI RA',
  doaj: 'DOAJ',
  openaire_hal: 'OpenAIRE / HAL',
  ncbi_biorxiv: 'NCBI / bioRxiv',
  huggingface: 'Hugging Face',
  wikidata_opencitations: 'Wikidata / OpenCitations',
  wikidata_opencitatio: 'Wikidata / OpenCitations',
  tech_standard: 'Tech Standards',
  vn_tech_standard: 'VN Tech Standards',
  vn_textbook_registry: 'VN Textbook Registry',
  vn_legal_registry: 'VN Legal Registry',
  vn_registry: 'VN Registry',
  web_html_meta: 'Web HTML Meta',
  html_head: 'Web HTML Meta',
  wayback_html_meta: 'Wayback Archive',
  serpapi: 'Google Scholar',
  local_db: 'Local Corpus',
  known_papers: 'Known Papers',
};

function formatLiveSourceName(key: string): string {
  const normalized = key.trim().toLowerCase();
  return (
    SOURCE_DISPLAY_NAMES[normalized] ??
    key
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (ch) => ch.toUpperCase())
  );
}

function buildPipelineReasoningLines(
  status: EssayStatus,
  effectiveStepIndex: number,
  liveSourcesEntries: Array<[string, unknown]>,
  lang: 'vi' | 'en',
): string[] {
  const lines: string[] = [];

  lines.push(
    lang === 'vi'
      ? '[01/08] GROBID TEI-XML · Bóc tách bố cục & phân vùng tài liệu'
      : '[01/08] GROBID TEI-XML · Structural section & layout segmentation',
  );

  if (effectiveStepIndex >= 1) {
    lines.push(
      lang === 'vi'
        ? '[02/08] STYLE ENGINE · Nhận diện quy chuẩn trích dẫn học thuật'
        : '[02/08] STYLE ENGINE · Citation format & delimiter classification',
    );
  }

  if (effectiveStepIndex >= 2 || status.citations_found > 0 || status.references_found > 0) {
    lines.push(
      lang === 'vi'
        ? `[03/08] PARSER · Bóc tách ${status.citations_found} trích dẫn & ${status.references_found} tài liệu tham khảo`
        : `[03/08] PARSER · Extracted ${status.citations_found} in-text markers & ${status.references_found} references`,
    );
  }

  if (effectiveStepIndex >= 3 || status.linked > 0) {
    lines.push(
      lang === 'vi'
        ? `[04/08] LINKER · Ánh xạ hai chiều ${status.linked} liên kết In-text ↔ Bibliography`
        : `[04/08] LINKER · Resolved ${status.linked} bidirectional In-text ↔ Bibliography edges`,
    );
  }

  if (effectiveStepIndex >= 4 || liveSourcesEntries.length > 0) {
    const sourcePreview =
      liveSourcesEntries
        .slice(0, 4)
        .map(([k]) => formatLiveSourceName(k))
        .join(' · ') || 'Crossref · OpenAlex';
    const countLabel = liveSourcesEntries.length > 0 ? String(liveSourcesEntries.length) : SCHOLARLY_APIS_LABEL;
    lines.push(
      lang === 'vi'
        ? `[05/08] FEDERATED IO · Truy vấn ${countLabel} CSDL (${sourcePreview})`
        : `[05/08] FEDERATED IO · Querying ${countLabel} registries (${sourcePreview})`,
    );
  }

  if (effectiveStepIndex >= 5) {
    lines.push(
      lang === 'vi'
        ? '[06/08] NEURAL DIFF · Đối sánh ngữ nghĩa Bi-Encoder & Cross-Encoder'
        : '[06/08] NEURAL DIFF · Bi-Encoder & Cross-Encoder metadata comparison',
    );
  }

  if (effectiveStepIndex >= 6) {
    lines.push(
      lang === 'vi'
        ? `[07/08] SYMBOLIC ENGINE · Rà soát ${SYMBOLIC_RULES_COUNT} luật hình thức & hiệu chỉnh Platt`
        : `[07/08] SYMBOLIC ENGINE · Evaluating ${SYMBOLIC_RULES_COUNT} formal rules & Platt calibration`,
    );
  }

  if (effectiveStepIndex >= 7) {
    lines.push(
      lang === 'vi'
        ? '[08/08] CIS SCORER · Tổng hợp điểm Toàn vẹn Trích dẫn & báo cáo'
        : '[08/08] CIS SCORER · Aggregating Citation Integrity Score & report',
    );
  }

  return lines;
}

function classifyLiveSourceTone(rawStatus: string): {
  dotClass: string;
  pillClass: string;
} {
  const val = rawStatus.trim().toLowerCase();
  if (val === 'ok' || val === 'done' || val === 'hit' || val === 'success') {
    return {
      dotClass: 'bg-emerald-500',
      pillClass:
        'bg-emerald-50/80 dark:bg-emerald-950/50 border-emerald-200/80 dark:border-emerald-800/70 text-emerald-800 dark:text-emerald-200',
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
    };
  }
  return {
    dotClass: 'bg-indigo-500 animate-pulse',
    pillClass:
      'bg-indigo-50/80 dark:bg-indigo-950/50 border-indigo-200/80 dark:border-indigo-800/70 text-indigo-800 dark:text-indigo-200',
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
  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const {
    activeSingleCheck,
    syncSingleCheckFromStatus,
    acknowledgeSingleCheck,
    registerProcessingPageMount,
  } = useVerificationProgress();

  const numericId = id ? parseInt(id, 10) : null;
  const essayId = numericId !== null && !isNaN(numericId) ? numericId : null;

  const [statusEntry, setStatusEntry] = useState<{
    essayId: number;
    snap: EssayStatus;
  } | null>(null);
  const status =
    essayId !== null && statusEntry?.essayId === essayId
      ? statusEntry.snap
      : null;
  const [displayedStepIndex, setDisplayedStepIndex] = useState<number>(0);
  const [redirecting, setRedirecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [finalElapsedSeconds, setFinalElapsedSeconds] = useState<number | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    setDisplayedStepIndex(0);
    setRedirecting(false);
    setErrorMsg(null);
    setFinalElapsedSeconds(null);
  }, [essayId]);

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
      setStatusEntry({ essayId, snap });
      syncSingleCheckFromStatus(essayId, snap);
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
      const streamed = await streamEssayEvents(essayId, applySnap, controller.signal);
      if (cancelled || streamed) return;
      void tick();
      timer = setInterval(tick, 800);
    })();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [essayId, queryClient, syncSingleCheckFromStatus]);

  const rawStepIndex = status
    ? typeof status.step_index === 'number' && Number.isFinite(status.step_index)
      ? status.step_index
      : (STEP_KEY_TO_INDEX[status.step] ?? 0)
    : 0;
  const backendIndex = Math.max(0, Math.min(rawStepIndex, STEP_LABELS.length - 1));

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
  }, [displayedStepIndex, targetStepIndex, isQueued, isFailed, backendIndex]);

  const effectiveStepIndex = isFailed ? backendIndex : displayedStepIndex;
  const visualDone = isDone && !isFailed && displayedStepIndex >= STEP_LABELS.length;

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
  }, [essayId, visualDone, isFailed, id, navigate, queryClient, acknowledgeSingleCheck]);

  const progress = status
    ? Math.round(
        (Math.min(effectiveStepIndex, STEP_LABELS.length) /
          STEP_LABELS.length) *
          100,
      )
    : 0;

  const effectiveProgress = isQueued ? 0 : progress;
  const trackedFilename =
    essayId !== null &&
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

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-10">
      {/* Executive Header Banner */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 text-[11px] font-mono font-semibold text-indigo-700 dark:text-indigo-300">
              <Terminal className="h-3 w-3" />
              {lang === 'vi'
                ? 'TIẾN TRÌNH KIỂM CHỨNG THỜI GIAN THỰC'
                : 'LIVE VERIFICATION TELEMETRY'}
            </span>
            {essayId && (
              <Badge variant="secondary" className="font-mono text-[11px]">
                ID #{essayId}
              </Badge>
            )}
            {trackedFilename && (
              <Badge
                variant="outline"
                data-testid="processing-filename-badge"
                title={trackedFilename}
                className="font-mono text-[11px] max-w-[200px] sm:max-w-[260px] truncate"
              >
                {trackedFilename}
              </Badge>
            )}
            {isQueued && queuePos !== null && (
              <Badge className="font-mono text-[11px] bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-300 border border-amber-300/70 dark:border-amber-700/70">
                {lang === 'vi' ? `Hàng đợi #${queuePos}` : `Queue #${queuePos}`}
              </Badge>
            )}
            <LiveElapsedTimer
              key={essayId ?? 'none'}
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
                    ? 'Đang phân tích tài liệu học thuật'
                    : 'Analyzing document'}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {isFailed
              ? lang === 'vi'
                ? 'Quá trình phân tích đã dừng lại do gặp sự cố kỹ thuật — không chuyển hướng tự động.'
                : 'The verification pipeline stopped due to an error — inspect details or upload another file below.'
              : visualDone
                ? lang === 'vi'
                  ? 'Đang chuyển hướng tới báo cáo kiểm chứng chi tiết…'
                  : 'Redirecting to your verification report…'
                : isQueued
                  ? lang === 'vi'
                    ? 'Hệ thống đang điều phối lưu lượng theo thứ tự nộp (FIFO) để đảm bảo tốc độ ổn định và tránh giới hạn truy cập từ các CSDL học thuật.'
                    : 'Your submission is queued in FIFO order to prevent external scholarly API rate limiting during peak traffic.'
                  : lang === 'vi'
                    ? 'Quá trình bóc tách GROBID và đối chiếu đa CSDL học thuật có thể mất 30–60 giây tùy độ dài PDF.'
                    : 'This may take a few minutes depending on document size.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="rounded-xl shrink-0"
          >
            <Link to="/upload?new=1" data-testid="processing-new-upload-btn">
              <Upload className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>{t('upload.checkAnotherFile')}</span>
            </Link>
          </Button>
          {id && !isFailed && (
            <Button asChild variant="outline" size="sm" className="rounded-xl shrink-0">
              <Link
                to={`/verification/report/${id}`}
                onClick={() => {
                  if (essayId !== null) acknowledgeSingleCheck(essayId);
                }}
              >
                <span>{lang === 'vi' ? 'Mở Báo cáo' : 'Open Report'}</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Queued FIFO banner during high-traffic deadline bursts */}
      {isQueued && (
        <div
          data-testid="queued-processing-banner"
          className="rounded-2xl border border-indigo-200 dark:border-indigo-800/80 bg-indigo-50/80 dark:bg-indigo-950/40 p-4 text-xs text-indigo-900 dark:text-indigo-200 flex items-start gap-3"
        >
          <Loader2 className="h-5 w-5 text-indigo-600 dark:text-indigo-400 animate-spin shrink-0 mt-0.5" />
          <div>
            <p className="font-bold font-display">
              {lang === 'vi'
                ? `Bài nộp đang trong hàng đợi thông minh${queuePos ? ` — Vị trí hiện tại: #${queuePos}` : ''}`
                : `Submission in smart admission queue${queuePos ? ` — Current position: #${queuePos}` : ''}`}
            </p>
            <p className="mt-0.5 text-indigo-800/90 dark:text-indigo-300/90">
              {lang === 'vi'
                ? 'Trang này sẽ tự động cập nhật ngay khi tới lượt phân tích tài liệu của bạn — không cần tải lại trang.'
                : 'This page updates automatically as soon as a worker slot opens — no refresh needed.'}
            </p>
          </div>
        </div>
      )}

      {/* Failed Pipeline Alert + Credit Refund Reassurance + Action Buttons */}
      {isFailed && (
        <Alert
          variant="destructive"
          data-testid="failed-pipeline-alert"
          className="rounded-2xl border-rose-300 dark:border-rose-800 bg-rose-50/90 dark:bg-rose-950/40"
        >
          <AlertTriangle className="h-5 w-5" />
          <AlertTitle className="font-display font-bold">
            {lang === 'vi' ? 'Lỗi tiến trình phân tích' : 'Pipeline error'}
          </AlertTitle>
          <AlertDescription className="space-y-3 mt-1.5">
            <p className="text-sm leading-relaxed">
              {errorMsg ??
                status?.error ??
                (lang === 'vi'
                  ? 'Đã xảy ra lỗi không xác định — vui lòng thử tải lại tài liệu.'
                  : 'Unknown error — please try uploading the document again.')}
            </p>

            {status?.quota_charged === false && (
              <div
                data-testid="quota-refund-badge"
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200/90 dark:border-emerald-800/80 text-xs font-medium text-emerald-800 dark:text-emerald-200"
              >
                <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>
                  {lang === 'vi'
                    ? 'Lượt tải lên trong tháng của bạn đã được hoàn lại (không trừ hạn ngạch)'
                    : 'Your monthly upload credit was automatically refunded'}
                </span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <Button
                asChild
                size="sm"
                className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
              >
                <Link
                  to="/upload"
                  data-testid="failed-upload-another-btn"
                  onClick={() => {
                    if (essayId !== null) acknowledgeSingleCheck(essayId);
                  }}
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>
                    {lang === 'vi' ? 'Tải lại tài liệu khác' : 'Upload Another Document'}
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
                  onClick={() => {
                    if (essayId !== null) acknowledgeSingleCheck(essayId);
                  }}
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
                ? 'Phát hiện tài liệu PDF dạng ảnh quét (Scanned PDF — Thiếu lớp văn bản số hóa)'
                : 'Scanned / Image-Only PDF Detected (Missing Digital Text Layer)'}
            </p>
            <p className="mt-0.5">
              {diagnostics.warning_message ||
                (lang === 'vi'
                  ? 'Tài liệu có mật độ văn bản số hóa rất thấp; hệ thống tự động kích hoạt nhánh khôi phục OCR nếu khả dụng.'
                  : 'Low extractable text density detected; OCR fallback recovery will run where supported.')}
            </p>
          </div>
        </div>
      )}

      {/* Early Legacy Vietnamese Encoding Transcoding Info Pill */}
      {legacyEncoding && (
        <div
          data-testid="legacy-encoding-processing-banner"
          className="rounded-2xl border border-indigo-200 dark:border-indigo-800/80 bg-indigo-50/85 dark:bg-indigo-950/45 p-3.5 text-xs text-indigo-900 dark:text-indigo-200 flex items-start gap-3"
        >
          <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold font-display">
              {lang === 'vi'
                ? `Phát hiện bảng mã tiếng Việt cũ (${String(legacyEncoding).toUpperCase()}) — Đã tự động chuyển mã sang chuẩn Unicode NFC${legacyPagesCount ? ` (${legacyPagesCount} trang)` : ''}`
                : `Legacy Vietnamese encoding detected (${String(legacyEncoding).toUpperCase()}) — Automatically transcoded to Unicode NFC${legacyPagesCount ? ` (${legacyPagesCount} ${legacyPagesCount === 1 ? 'page' : 'pages'})` : ''}`}
            </p>
          </div>
        </div>
      )}

      {/* Early OCR Pages Recovered Info Pill */}
      {ocrRecoveredPages.length > 0 && (
        <div
          data-testid="ocr-recovered-processing-banner"
          className="rounded-2xl border border-teal-200 dark:border-teal-800/80 bg-teal-50/85 dark:bg-teal-950/45 p-3.5 text-xs text-teal-900 dark:text-teal-200 flex items-start gap-3"
        >
          <FileCheck className="h-4 w-4 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold font-display">
              {lang === 'vi'
                ? `Đã khôi phục lớp văn bản OCR tự động trên ${ocrRecoveredPages.length} trang (${ocrRecoveredPages.map((p) => `tr.${p}`).join(', ')})`
                : `OCR text layer automatically recovered on ${ocrRecoveredPages.length} ${ocrRecoveredPages.length === 1 ? 'page' : 'pages'} (${ocrRecoveredPages.map((p) => `p.${p}`).join(', ')})`}
            </p>
          </div>
        </div>
      )}

      {/* 4 Live Telemetry Stat Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          idx="01"
          icon={<Quote className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />}
          value={status?.citations_found ?? '—'}
          label={lang === 'vi' ? 'Trích dẫn' : 'Citations'}
        />
        <StatCard
          idx="02"
          icon={<FileText className="h-4 w-4 text-slate-600 dark:text-slate-400" />}
          value={status?.references_found ?? '—'}
          label={lang === 'vi' ? 'Tài liệu TK' : 'References'}
        />
        <StatCard
          idx="03"
          icon={
            <GitMerge className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          }
          value={status?.linked ?? '—'}
          label={lang === 'vi' ? 'Đã liên kết' : 'Linked'}
          highlight
        />
        <StatCard
          idx="04"
          icon={
            <Database className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          }
          value={
            status?.references_found
              ? status.references_found
              : status?.citations_found
                ? status.citations_found
                : '—'
          }
          label={lang === 'vi' ? 'Cần xác minh' : 'To verify'}
        />
      </div>

      {/* IDE Pipeline Execution Window */}
      <Card className="p-0 overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
        {/* Top Window Chrome */}
        <div className="px-4 sm:px-6 py-3.5 bg-slate-50/80 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400/80 inline-block" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80 inline-block" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80 inline-block" />
            </div>
            <Separator orientation="vertical" className="h-4" />
            <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">
              integrity_pipeline.py · Verification Pipeline
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
              {isFailed
                ? 'FAILED'
                : visualDone
                  ? 'COMPLETE'
                  : isQueued
                    ? `QUEUED${queuePos ? ` (#${queuePos})` : ''}`
                    : 'EXECUTING'}
            </span>
            <Badge
              variant="secondary"
              className={`font-mono text-xs ${
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
          {/* Progress Bar & Live #29 ReasoningStream Telemetry */}
          <div>
            <Progress value={effectiveProgress} className="h-2.5" />
            {status && !visualDone && !isFailed && (
              <>
                <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-2">
                  &gt; <ThinkingStateText text={status.message} />
                </p>
                {!isQueued && (
                  <ReasoningStream
                    data-testid="processing-reasoning-stream"
                    lines={buildPipelineReasoningLines(
                      status,
                      effectiveStepIndex,
                      liveSourcesEntries,
                      lang,
                    )}
                    visibleLines={3}
                    lineHeightPx={20}
                    stepMs={360}
                    className="mt-2.5 rounded-xl bg-slate-50/90 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800/80 px-3 py-1.5 font-mono text-[11px] text-slate-600 dark:text-slate-300"
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
                      ? 'bg-rose-50/70 dark:bg-rose-950/35 border-rose-300 dark:border-rose-800 shadow-2xs'
                      : s === 'active'
                        ? 'bg-indigo-50/60 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700 shadow-2xs'
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
                            ? 'bg-white dark:bg-slate-900 border border-indigo-200/90 dark:border-indigo-700/80 shadow-xs'
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
                            className="inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-950 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300"
                          >
                            <AlertCircle className="h-3 w-3" />
                            {lang === 'vi' ? 'Lỗi' : 'Failed'}
                          </span>
                        )}
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                          {step.tag}
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
                          {status.citations_found} citations
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                          <FileText className="h-3 w-3 text-emerald-500" />
                          {status.references_found} references
                        </span>
                      </div>
                    )}

                    {idx === 3 && status && effectiveStepIndex >= 3 && (
                      <div className="flex gap-3 mt-2 text-xs font-mono">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300">
                          <Check className="h-3 w-3" />
                          {status.linked} linked
                        </span>
                      </div>
                    )}

                    {idx === 4 && liveSourcesEntries.length > 0 && (
                      <div
                        data-testid="live-sources-queried"
                        className="flex flex-wrap items-center gap-1.5 mt-2.5"
                      >
                        {liveSourcesEntries.map(([sourceKey, sourceState]) => {
                          const tone = classifyLiveSourceTone(String(sourceState));
                          return (
                            <span
                              key={sourceKey}
                              data-testid={`live-source-pill-${sourceKey}`}
                              data-source-status={String(sourceState)}
                              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-mono ${tone.pillClass}`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full shrink-0 ${tone.dotClass}`}
                              />
                              <span className="font-semibold">
                                {formatLiveSourceName(sourceKey)}
                              </span>
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
          className="p-6 rounded-2xl bg-emerald-50/90 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center shadow-xs"
        >
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-900/60 mb-3">
            <FileCheck className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h3 className="font-display text-lg font-bold text-emerald-800 dark:text-emerald-200 mb-1">
            {lang === 'vi' ? 'Kiểm chứng hoàn tất!' : 'Analysis Complete'}
          </h3>
          <p className="text-sm font-mono text-emerald-700 dark:text-emerald-300">
            {lang === 'vi'
              ? 'Đang mở báo cáo Citation Debugger…'
              : 'Redirecting to verification report…'}
          </p>
        </div>
      )}
    </div>
  );
}

function StatCard({
  idx,
  icon,
  value,
  label,
  highlight,
}: {
  idx: string;
  icon: React.ReactNode;
  value: number | string;
  label: string;
  highlight?: boolean;
}) {
  return (
    <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
      <div className="flex items-center justify-between mb-2.5">
        <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800">
          {icon}
        </div>
        <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
          {idx}
        </span>
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
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">{label}</p>
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
      className="inline-flex items-center gap-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400"
    >
      <Clock className="h-3.5 w-3.5" />
      {shownSeconds.toFixed(1)}s
    </span>
  );
}
