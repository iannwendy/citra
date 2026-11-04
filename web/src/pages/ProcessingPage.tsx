import { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type EssayStatus } from '@/api/client';
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
    detailsEn: 'Extracting scholarly text, sections, and XML structure from PDF / DOCX',
    detailsVi: 'Bóc tách văn bản học thuật và cấu trúc từ tài liệu PDF / DOCX',
    tag: 'GROBID v0.9.1 · DOCX',
  },
  {
    labelEn: 'Detecting citation style',
    labelVi: 'Nhận diện chuẩn trích dẫn học thuật',
    detailsEn: 'Auto-classifying 11 styles (APA · IEEE · Vancouver · Harvard · MLA · Chicago · VN Legal)',
    detailsVi: 'Tự động phân loại 11 chuẩn (APA · IEEE · Vancouver · Harvard · MLA · Chicago · Pháp luật VN)',
    tag: 'STYLE ENGINE',
  },
  {
    labelEn: 'Extracting citations & references',
    labelVi: 'Trích xuất trích dẫn trong bài & Danh mục tham khảo',
    detailsEn: 'Scanning for in-text citations and bibliography',
    detailsVi: 'Quét toàn bộ marker trong bài và mục tài liệu tham khảo cuối bài',
    tag: 'LAYER 1 · PARSER',
  },
  {
    labelEn: 'Linking citations to references',
    labelVi: 'Ánh xạ hai chiều Trích dẫn ↔ Tài liệu tham khảo',
    detailsEn: 'Bidirectional citation-reference matching',
    detailsVi: 'Đối chiếu hai chiều để phát hiện trích dẫn mồ côi hoặc chưa trích dẫn',
    tag: 'LINKING GRAPH',
  },
  {
    labelEn: `Retrieving source metadata across ${SCHOLARLY_APIS_LABEL} registries`,
    labelVi: `Truy hồi dữ liệu từ hệ thống ${SCHOLARLY_APIS_LABEL} CSDL học thuật & tri thức liên hợp`,
    detailsEn: 'Querying Crossref, OpenAlex, DataCite, DOAJ, OpenAIRE/HAL, NCBI/bioRxiv, DBLP, arXiv, OpenLibrary, Europe PMC, Hugging Face, GitHub, NPM/PyPI, Wikidata/OpenCitations, IETF RFC & ACL FTS5',
    detailsVi: 'Truy vấn phân tầng Crossref, OpenAlex, DataCite, DOAJ, OpenAIRE/HAL, NCBI/bioRxiv, DBLP, arXiv, OpenLibrary, Europe PMC, Hugging Face, GitHub, NPM/PyPI, Wikidata/OpenCitations, IETF RFC & ACL FTS5',
    tag: `${SCHOLARLY_APIS_LABEL} INDEXES`,
  },
  {
    labelEn: 'Comparing candidate publications & neural evidence',
    labelVi: 'Đối chiếu đa trường & bằng chứng ngữ nghĩa (Title, Authors, Year, Venue, DOI)',
    detailsEn: 'Sentence-BERT evidence alignment, fuzzy string, and author Jaccard matching',
    detailsVi: 'Tính toán độ tương đồng ngữ nghĩa Sentence-BERT, fuzzy string và Jaccard tác giả',
    tag: 'NEURAL DIFF',
  },
  {
    labelEn: `Applying ${SYMBOLIC_RULES_COUNT} neuro-symbolic rules & Platt calibration`,
    labelVi: `Kích hoạt hệ ${SYMBOLIC_RULES_COUNT} luật suy diễn hình thức & hiệu chỉnh Platt`,
    detailsEn: 'Explainable verification logic, Retraction Watch & Wayback Machine checks',
    detailsVi: 'Suy diễn nhãn xác minh có giải thích, kiểm tra bài rút lại (Retraction Watch) & Wayback Machine',
    tag: `${SYMBOLIC_RULES_COUNT} SYMBOLIC RULES`,
  },
  {
    labelEn: 'Generating verification report',
    labelVi: 'Tổng hợp báo cáo & Điểm Toàn vẹn Trích dẫn (CIS)',
    detailsEn: 'Compiling interactive findings, explanations, and CIS score (0–100)',
    detailsVi: 'Hoàn tất bảng kiểm chứng tương tác và điểm số CIS (0–100)',
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
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';

  const numericId = id ? parseInt(id, 10) : null;
  const essayId = numericId !== null && !isNaN(numericId) ? numericId : null;

  const [status, setStatus] = useState<EssayStatus | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (essayId === null) return;
    let cancelled = false;
    let consecutiveErrors = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = async () => {
      try {
        const snap = await api.getEssayStatus(essayId);
        if (cancelled) return;
        consecutiveErrors = 0;
        setStatus(snap);
        if (snap.status === 'failed' || snap.status === 'completed') {
          if (timer) clearInterval(timer);
        }
      } catch (err) {
        consecutiveErrors += 1;
        if (!cancelled && consecutiveErrors >= 5) {
          if (timer) clearInterval(timer);
          setStatus({
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
          });
        }
      }
    };
    void tick();
    timer = setInterval(tick, 1500);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [essayId]);

  useEffect(() => {
    if (essayId === null) return;
    const done = status?.status === 'completed';
    const failed = status?.status === 'failed';
    if (!done && !failed) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (cancelled) return;
      setRedirecting(true);
      timer = setTimeout(
        () => navigate(`/verification/report/${id}`),
        failed ? 3000 : 1500
      );
    };

    if (done) {
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
  }, [essayId, status?.status, id, navigate, queryClient]);

  const backendIndex = status
    ? Math.min(STEP_KEY_TO_INDEX[status.step] ?? 0, STEP_LABELS.length - 1)
    : 0;

  const progress = status
    ? Math.round(
        ((backendIndex + (status.status === 'completed' ? 1 : 0)) /
          STEP_LABELS.length) *
          100
      )
    : 0;

  const isDone = status?.status === 'completed';
  const isFailed = status?.status === 'failed';

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-10">
      {/* Executive Header Banner */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1.5">
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
            {status?.elapsed_seconds !== undefined && status.elapsed_seconds > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-mono text-slate-500 dark:text-slate-400">
                <Clock className="h-3.5 w-3.5" />
                {status.elapsed_seconds.toFixed(1)}s
              </span>
            )}
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            {isFailed
              ? lang === 'vi'
                ? 'Phân tích gặp sự cố'
                : 'Analysis failed'
              : isDone
                ? lang === 'vi'
                  ? 'Phân tích hoàn tất'
                  : 'Analysis complete'
                : lang === 'vi'
                  ? 'Đang phân tích tài liệu học thuật'
                  : 'Analyzing document'}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {isFailed
              ? lang === 'vi'
                ? 'Đã xảy ra lỗi trong quá trình xử lý pipeline.'
                : 'An error occurred during processing.'
              : isDone
                ? lang === 'vi'
                  ? 'Đang chuyển hướng tới báo cáo kiểm chứng chi tiết…'
                  : 'Redirecting to your verification report…'
                : lang === 'vi'
                  ? 'Quá trình bóc tách GROBID và đối chiếu đa CSDL học thuật có thể mất 30–60 giây tùy độ dài PDF.'
                  : 'This may take a few minutes depending on document size.'}
          </p>
        </div>

        {id && (
          <Button asChild variant="outline" size="sm" className="rounded-xl shrink-0">
            <Link to={`/verification/report/${id}`}>
              <span>{lang === 'vi' ? 'Mở Báo cáo' : 'Open Report'}</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        )}
      </div>

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
              {isFailed ? 'FAILED' : isDone ? 'COMPLETE' : 'EXECUTING'}
            </span>
            <Badge
              variant="secondary"
              className="font-mono text-xs bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
            >
              {progress}%
            </Badge>
          </div>
        </div>

        <div className="p-4 sm:p-6 space-y-6">
          {/* Progress Bar */}
          <div>
            <Progress value={progress} className="h-2.5" />
            {status && !isDone && !isFailed && (
              <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-2">
                &gt; {status.message}
              </p>
            )}
          </div>

          {/* 8-Step Pipeline Trace */}
          <div className="space-y-2.5">
            {STEP_LABELS.map((step, idx) => {
              const s = stepStatus(idx, backendIndex, isDone || isFailed);

              return (
                <div
                  key={idx}
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
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'bg-slate-200/70 dark:bg-slate-800'
                    }`}
                  >
                    {s === 'completed' ? (
                      <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    ) : s === 'active' ? (
                      <Loader2 className="h-4 w-4 text-white animate-spin" />
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

                    {idx === 2 && status && (
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

                    {idx === 3 && status && (
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

      {/* Source retrieval tiles */}
      <Card
        data-testid="federated-source-retrieval-card"
        className="p-6 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs"
      >
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              {lang === 'vi'
                ? `Trạng thái Truy vấn ${SCHOLARLY_APIS_LABEL} CSDL Học thuật & Tri thức Liên hợp`
                : `Federated ${SCHOLARLY_APIS_LABEL} Source Retrieval`}
            </h3>
          </div>
          {!isDone && !isFailed && (
            <span className="inline-flex items-center gap-1.5 text-xs font-mono text-indigo-600 dark:text-indigo-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              QUERYING
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {([
            'local_db',
            'crossref',
            'openalex',
            'datacite',
            'doaj',
            'openaire_hal',
            'ncbi_biorxiv',
            'dblp',
            'arxiv',
            'openlibrary',
            'europepmc',
            'huggingface',
            'tech_standard',
            'wikidata_opencitations',
            'doi_ra',
            'known_papers',
          ] as const).map((db) => (
            <SourceTile
              key={db}
              name={db}
              state={status?.sources_queried[db]}
            />
          ))}
        </div>
      </Card>

      {/* Completion banner */}
      {(isDone || redirecting) && (
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
        {value}
      </p>
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">{label}</p>
    </Card>
  );
}

function SourceTile({
  name,
  state,
}: {
  name: string;
  state: string | undefined;
}) {
  const displayNameMap: Record<string, string> = {
    crossref: 'Crossref',
    openalex: 'OpenAlex',
    datacite: 'DataCite (Zenodo/OSF)',
    doaj: 'DOAJ Open Access',
    openaire_hal: 'OpenAIRE / HAL',
    ncbi_biorxiv: 'NCBI / bioRxiv',
    dblp: 'DBLP (CS/AI)',
    arxiv: 'arXiv Preprints',
    openlibrary: 'OpenLibrary / Books',
    europepmc: 'Europe PMC',
    huggingface: 'Hugging Face Hub',
    tech_standard: 'IETF RFC / PyPI / NPM / GitHub',
    wikidata_opencitations: 'Wikidata / OpenCitations',
    doi_ra: 'Global DOI RA',
    local_db: 'Local ACL FTS5 (128K+)',
    known_papers: 'Seminal Whitelist',
    vn_legal: 'VN Legal Registry',
  };
  const displayName =
    displayNameMap[name] ?? name.charAt(0).toUpperCase() + name.slice(1);

  let color = 'slate';
  let label = 'Pending';

  if (state === 'ok') {
    color = 'emerald';
    label = 'Connected · OK';
  } else if (state === 'partial') {
    color = 'amber';
    label = 'Partial Hit';
  } else if (state?.startsWith('queried')) {
    color = 'slate';
    label = 'Queried · 0 Hits';
  } else if (state?.startsWith('failed')) {
    color = 'red';
    const n = state.split(':')[1];
    label = `Failed${n ? ` (${n})` : ''}`;
  }

  const colors: Record<string, string> = {
    emerald:
      'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300',
    amber:
      'bg-amber-50/70 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300',
    red: 'bg-red-50/70 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300',
    slate:
      'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400',
  };

  return (
    <div className={`p-3.5 rounded-xl border transition-all ${colors[color]}`}>
      <p className="text-xs font-semibold">{displayName}</p>
      <p className="text-[11px] font-mono mt-1">{label}</p>
    </div>
  );
}
