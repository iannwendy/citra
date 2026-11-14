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
  Terminal,
  Clock,
  ArrowRight,
  Upload,
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
} from '@/components/ui/transitions';

/* ============================================================
   ProcessingPage — Real-time pipeline progress (Scholarly Precision v2.0)
   Polls GET /essays/{id}/status for live step/source updates.
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

function stepStatus(
  idx: number,
  backendIndex: number,
  done: boolean
): 'completed' | 'active' | 'pending' | 'error' {
  if (done || idx < backendIndex) return 'completed';
  if (idx === backendIndex) return 'active';
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
  const queryClient = useQueryClient();

  useEffect(() => {
    setDisplayedStepIndex(0);
    setRedirecting(false);
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
    };

    const tick = async () => {
      try {
        const snap = await api.getEssayStatus(essayId);
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
          setStatusEntry({ essayId, snap: failedSnap });
          syncSingleCheckFromStatus(essayId, failedSnap);
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
  }, [essayId, syncSingleCheckFromStatus]);

  const backendIndex = status
    ? Math.min(STEP_KEY_TO_INDEX[status.step] ?? 0, STEP_LABELS.length - 1)
    : 0;

  const isDone = status?.status === 'completed';
  const isFailed = status?.status === 'failed';
  const isQueued = status?.status === 'queued';
  const queuePos = status?.queue_position ?? null;

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

  const visualDone = isDone && displayedStepIndex >= STEP_LABELS.length;

  useEffect(() => {
    if (essayId === null) return;
    if (!visualDone && !isFailed) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (cancelled) return;
      setRedirecting(true);
      timer = setTimeout(() => {
        acknowledgeSingleCheck(essayId);
        navigate(`/verification/report/${id}`);
      }, isFailed ? 3000 : 1200);
    };

    if (visualDone) {
      void queryClient.invalidateQueries({ queryKey: ['essays'] });
      api
        .getEssay(essayId)
        .then((report) => {
          if (report) queryClient.setQueryData(['essay-report', essayId], report);
        })
        .catch(() => {})
        .finally(finish);
    } else {
      finish();
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [essayId, visualDone, isFailed, id, navigate, queryClient, acknowledgeSingleCheck]);

  const progress = status
    ? Math.round(
        (Math.min(displayedStepIndex, STEP_LABELS.length) /
          STEP_LABELS.length) *
          100
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
            <LiveElapsedTimer key={essayId ?? 'none'} status={status} />
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
                ? 'Đã xảy ra lỗi trong quá trình xử lý pipeline.'
                : 'An error occurred during processing.'
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
          {id && (
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

      {/* Failed banner */}
      {isFailed && (
        <Alert variant="destructive" className="rounded-2xl">
          <AlertTriangle className="h-5 w-5" />
          <AlertTitle>Pipeline error</AlertTitle>
          <AlertDescription>
            {status?.error ??
              'Unknown error — please try uploading the document again.'}
          </AlertDescription>
        </Alert>
      )}

      {/* Scanned PDF Guardrail banner during/after processing */}
      {status?.document_diagnostics?.is_scanned_pdf && (
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
              {status.document_diagnostics.warning_message}
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
              className="font-mono text-xs bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
            >
              <SubtleNumber value={effectiveProgress} suffix="%" />
            </Badge>
          </div>
        </div>

        <div className="p-4 sm:p-6 space-y-6">
          {/* Progress Bar */}
          <div>
            <Progress value={effectiveProgress} className="h-2.5" />
            {status && !visualDone && !isFailed && (
              <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-2">
                &gt; <ThinkingStateText text={status.message} />
              </p>
            )}
          </div>

          {/* 8-Step Pipeline Trace */}
          <div className="space-y-2.5">
            {STEP_LABELS.map((step, idx) => {
              const s = isQueued
                ? 'pending'
                : stepStatus(idx, displayedStepIndex, visualDone || isFailed);

              return (
                <div
                  key={idx}
                  data-testid={`pipeline-step-${idx + 1}`}
                  data-step-status={s}
                  className={`flex items-start gap-3.5 p-3 rounded-xl border transition-all duration-200 ${
                    s === 'active'
                      ? 'bg-indigo-50/60 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700 shadow-2xs'
                      : s === 'completed'
                        ? 'bg-emerald-50/30 dark:bg-emerald-950/15 border-emerald-200/70 dark:border-emerald-900/50'
                        : 'bg-slate-50/50 dark:bg-slate-950/40 border-slate-200/60 dark:border-slate-800/70'
                  }`}
                >
                  <div
                    className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all duration-300 ${
                      s === 'completed'
                        ? 'bg-emerald-100 dark:bg-emerald-900/60'
                        : s === 'active'
                          ? 'bg-white dark:bg-slate-900 border border-indigo-200/90 dark:border-indigo-700/80 shadow-xs'
                          : 'bg-slate-200/70 dark:bg-slate-800'
                    }`}
                  >
                    {s === 'completed' ? (
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
                          s === 'completed'
                            ? 'text-slate-900 dark:text-slate-100'
                            : s === 'active'
                              ? 'text-indigo-700 dark:text-indigo-300 font-semibold'
                              : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {lang === 'vi' ? step.labelVi : step.labelEn}
                      </p>
                      <div className="flex items-center gap-2 shrink-0">
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

                    {idx === 2 && status && displayedStepIndex >= 2 && (
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

                    {idx === 3 && status && displayedStepIndex >= 3 && (
                      <div className="flex gap-3 mt-2 text-xs font-mono">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300">
                          <Check className="h-3 w-3" />
                          {status.linked} linked
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Completion banner */}
      {(visualDone || redirecting) && (
        <div className="p-6 rounded-2xl bg-emerald-50/90 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center shadow-xs">
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

function LiveElapsedTimer({ status }: { status: EssayStatus | null }) {
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

  const shownSeconds = Math.max(displaySeconds, serverElapsed);

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

