import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Upload,
  X,
  Loader2,
  AlertCircle,
  Quote,
  Database,
  GitBranch,
  Layers,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  GraduationCap,
  KeyRound,
  FlaskConical,
} from 'lucide-react';
import { api, type Class } from '../api/client';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { useToast } from '@/contexts/ToastContext';
import { UpgradeModal } from '@/components/UpgradeModal';
import { FileFormatIcon } from '@/components/FileFormatIcon';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';

/* ============================================================
   SourceLogic — Upload Page Component (Scholarly Precision v2.0)
   Academic Source Verification Workspace
   ============================================================ */

const ACCEPTED_EXTENSIONS = ['.pdf', '.docx'];
const ACCEPTED_MIME = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
};

export function UploadPage() {
  const { t, i18n } = useTranslation();
  const { refreshUser } = useAuth();
  const toast = useToast();
  const { isUser, isTeacher, isAdmin, planTier, isBasic, quota, canBatchUpload } = useRole();
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrolledClasses, setEnrolledClasses] = useState<Class[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joiningClass, setJoiningClass] = useState(false);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState<{
    title?: string;
    description?: string;
    feature?: string;
  }>({});
  const navigate = useNavigate();

  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';

  useEffect(() => {
    api
      .listEnrolledClasses()
      .then((list) => setEnrolledClasses(list))
      .catch(() => setEnrolledClasses([]));
  }, []);

  const handleJoinClass = async () => {
    const code = joinCodeInput.trim().toUpperCase();
    if (!code) return;
    setJoiningClass(true);
    try {
      const joined = await api.joinClassByCode(code);
      setEnrolledClasses((prev) =>
        prev.some((c) => c.id === joined.id) ? prev : [joined, ...prev]
      );
      setSelectedClassId(joined.id);
      setJoinCodeInput('');
      toast.success(
        lang === 'vi'
          ? `Đã tham gia lớp học "${joined.name}" thành công!`
          : `Successfully enrolled in "${joined.name}"!`
      );
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : lang === 'vi'
            ? 'Mã tham gia lớp không hợp lệ'
            : 'Invalid class join code'
      );
    } finally {
      setJoiningClass(false);
    }
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        const droppedFile = e.dataTransfer.files[0];
        const ext = droppedFile.name
          .substring(droppedFile.name.lastIndexOf('.'))
          .toLowerCase();
        if (!ACCEPTED_EXTENSIONS.includes(ext)) {
          setError(t('upload.onlyPdfSupported'));
          return;
        }
        setError(null);
        setFile(droppedFile);
      }
    },
    [t]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const picked = e.target.files[0];
      const ext = picked.name
        .substring(picked.name.lastIndexOf('.'))
        .toLowerCase();
      if (!ACCEPTED_EXTENSIONS.includes(ext)) {
        setError(t('upload.onlyPdfSupported'));
        return;
      }
      setError(null);
      setFile(picked);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    // Client-side monthly upload quota pre-check
    if (quota.monthly_uploads_remaining <= 0) {
      const msg =
        lang === 'vi'
          ? `Bạn đã sử dụng hết hạn mức ${quota.monthly_uploads_limit} lượt kiểm tra PDF/tháng của gói ${planTier.toUpperCase()}. Vui lòng nâng cấp lên gói Pro (50 bài/tháng) hoặc Ultra (1.000 bài/tháng).`
          : `You have reached the monthly limit of ${quota.monthly_uploads_limit} PDF checks on the ${planTier.toUpperCase()} plan. Upgrade to Pro (50 checks/mo) or Ultra (1,000 checks/mo).`;
      setError(msg);
      setUpgradeReason({
        title:
          lang === 'vi'
            ? 'Đã hết lượt kiểm tra PDF trong tháng'
            : 'Monthly PDF Upload Quota Reached',
        description: msg,
        feature: '50–1,000 Monthly PDF Checks',
      });
      setUpgradeModalOpen(true);
      return;
    }

    // Client-side file size pre-check against current plan quota
    const maxBytes = quota.max_file_size_mb * 1024 * 1024;
    if (file.size > maxBytes) {
      const msg =
        lang === 'vi'
          ? `File vượt quá giới hạn dung lượng gói ${planTier.toUpperCase()} (${quota.max_file_size_mb} MB). Vui lòng nâng cấp lên gói Pro (25 MB) hoặc Ultra (100 MB).`
          : `File exceeds the ${planTier.toUpperCase()} plan size limit (${quota.max_file_size_mb} MB). Upgrade to Pro (25 MB) or Ultra (100 MB).`;
      setError(msg);
      setUpgradeReason({
        title:
          lang === 'vi'
            ? 'Tài liệu vượt quá dung lượng gói Basic (5 MB)'
            : 'Manuscript Exceeds Plan File Size Limit',
        description: msg,
        feature: '25MB–100MB PDF Upload',
      });
      setUpgradeModalOpen(true);
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const response = await api.uploadEssay(file, selectedClassId);
      await refreshUser();
      navigate(`/verification/processing/${response.essay_id}`);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : t('upload.uploadFailed');
      setError(errMsg);
      setUploading(false);
      if (
        errMsg.includes('402') ||
        errMsg.includes('413') ||
        errMsg.toLowerCase().includes('quota') ||
        errMsg.toLowerCase().includes('limit') ||
        errMsg.toLowerCase().includes('upgrade')
      ) {
        setUpgradeReason({
          title:
            lang === 'vi'
              ? 'Đã chạm giới hạn gói cước hiện tại'
              : 'Plan Quota or Limit Reached',
          description: errMsg.replace(/^API \d+:\s*/, ''),
          feature: 'Elevated Upload Quota & Page Limit',
        });
        setUpgradeModalOpen(true);
      }
    }
  };

  const pipelinePillars = [
    {
      step: '01',
      icon: Quote,
      title: t('auth.featureExtraction'),
      desc: t('auth.featureExtractionDesc'),
      tag: 'GROBID TEI-XML',
      tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    },
    {
      step: '02',
      icon: Database,
      title: t('auth.featureRetrieval'),
      desc: t('auth.featureRetrievalDesc'),
      tag: '7 Scholarly DBs',
      tone: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
    },
    {
      step: '03',
      icon: GitBranch,
      title: t('auth.featureVerification'),
      desc: t('auth.featureVerificationDesc'),
      tag: 'Rules R01–R12 · CIS',
      tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-8">
      {/* Executive Header Banner */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1.5">
          {!isUser && (
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 text-[11px] font-mono font-semibold text-indigo-700 dark:text-indigo-300">
                <Sparkles className="h-3 w-3" />
                {lang === 'vi'
                  ? 'KIỂM CHỨNG ĐƠN TÀI LIỆU · LAYER 1–2'
                  : 'SINGLE MANUSCRIPT VERIFICATION · LAYER 1–2'}
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-[11px] font-mono text-slate-600 dark:text-slate-300">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                GROBID v0.8.0 ONLINE
              </span>
            </div>
          )}
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            {t('upload.title')}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {t('upload.subtitle')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-10 rounded-xl font-medium"
          >
            <Link to="/sandbox" data-testid="upload-open-sandbox-link">
              <FlaskConical className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              <span>{t('nav.liveSandbox')}</span>
            </Link>
          </Button>
          {canBatchUpload && (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-10 rounded-xl font-medium"
            >
              <Link to="/batch-upload" data-testid="batch-check-link">
                <Layers className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                <span>{t('nav.batchCheck')}</span>
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Subscription Plan Quota & Limits Strip */}
      <div
        className="rounded-2xl bg-gradient-to-r from-slate-50 via-white to-indigo-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-indigo-950/30 border border-slate-200/90 dark:border-slate-800 px-4 py-3.5 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        data-testid="upload-quota-banner"
      >
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <Badge
            className={
              planTier === 'ultra'
                ? 'bg-violet-600 text-white font-mono uppercase'
                : planTier === 'pro'
                  ? 'bg-indigo-600 text-white font-mono uppercase'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono uppercase'
            }
          >
            {planTier.toUpperCase()} PLAN
          </Badge>
          <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
            {lang === 'vi'
              ? `Lượt kiểm tra tháng: ${quota.monthly_uploads_used}/${quota.monthly_uploads_limit}`
              : `Monthly Checks: ${quota.monthly_uploads_used}/${quota.monthly_uploads_limit}`}
          </span>
          <span className="text-slate-400">·</span>
          <span className="text-slate-600 dark:text-slate-400 font-mono">
            {lang === 'vi'
              ? `Tối đa ${quota.max_file_size_mb} MB · ${quota.max_pages_per_pdf} trang / PDF`
              : `Max ${quota.max_file_size_mb} MB · ${quota.max_pages_per_pdf} pages / PDF`}
          </span>
        </div>

        {isBasic && (
          <button
            type="button"
            data-testid="upload-open-upgrade-modal-btn"
            onClick={() => {
              setUpgradeReason({
                title:
                  lang === 'vi'
                    ? 'Nâng cấp lên CITRA Pro hoặc Ultra'
                    : 'Upgrade to CITRA Pro or Ultra',
              });
              setUpgradeModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-colors shrink-0 cursor-pointer"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>
              {lang === 'vi'
                ? 'Mở khóa 50 bài/tháng & 100 trang'
                : 'Unlock 50 docs/mo & 100 pages'}
            </span>
          </button>
        )}
      </div>

      {/* Main IDE Dropzone Container */}
      <Card className="p-0 overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
        {/* Top Window Chrome */}
        <div className="px-4 sm:px-6 py-3.5 bg-slate-50/80 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400/80 inline-block" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80 inline-block" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80 inline-block" />
            </div>
            <Separator orientation="vertical" className="h-4 shrink-0" />
            <span className="font-mono text-xs text-slate-600 dark:text-slate-300 font-medium truncate">
              manuscript_ingest.pdf / .docx
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="font-mono text-[10px] whitespace-nowrap shrink-0 bg-indigo-50/80 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800"
            >
              PDF + DOCX
            </Badge>
            <Badge
              variant="outline"
              className="font-mono text-[11px] whitespace-nowrap shrink-0 bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-400"
            >
              {lang === 'vi'
                ? `Tối đa: ${quota.max_file_size_mb}MB`
                : `Max size: ${quota.max_file_size_mb}MB`}
            </Badge>
          </div>
        </div>

        <div className="p-4 sm:p-8">
          {/* Cohort / Class Enrollment & Assignment Bar */}
          <div className="mb-5 p-3.5 rounded-2xl bg-slate-50/90 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 shrink-0">
                <GraduationCap className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 dark:text-white">
                  {lang === 'vi'
                    ? 'Nộp bài vào Lớp học / Học phần (Tùy chọn)'
                    : 'Submit to Cohort / Class (Optional)'}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  {lang === 'vi'
                    ? 'Chọn lớp đã tham gia hoặc nhập mã CITRA-XXXX từ giảng viên'
                    : 'Select an enrolled class or enter a CITRA-XXXX join code from your instructor'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto min-w-0">
              {enrolledClasses.length > 0 && (
                <select
                  aria-label="Select class"
                  data-testid="upload-class-select"
                  value={selectedClassId ?? ''}
                  onChange={(e) =>
                    setSelectedClassId(e.target.value ? Number(e.target.value) : null)
                  }
                  className="h-9 px-3 rounded-xl text-xs font-mono w-full sm:w-auto max-w-full truncate bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200"
                >
                  <option value="">
                    {lang === 'vi' ? '— Kiểm tra cá nhân —' : '— Personal Check —'}
                  </option>
                  {enrolledClasses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name.length > 36 ? `${c.name.slice(0, 35)}…` : c.name} {c.join_code ? `(${c.join_code})` : ''}
                    </option>
                  ))}
                </select>
              )}

              {isUser && (
                <div className="flex items-center gap-1.5 w-full sm:w-auto">
                  <div className="relative flex-1 sm:flex-initial min-w-0">
                    <KeyRound className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      data-testid="join-class-code-input"
                      value={joinCodeInput}
                      onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                      placeholder="CITRA-XXXX"
                      maxLength={16}
                      className="h-9 w-full sm:w-32 pl-8 pr-2.5 rounded-xl text-xs font-mono uppercase bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    data-testid="join-class-submit-btn"
                    disabled={!joinCodeInput.trim() || joiningClass}
                    onClick={handleJoinClass}
                    className="h-9 rounded-xl text-xs font-semibold"
                  >
                    {joiningClass ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : lang === 'vi' ? (
                      'Tham gia lớp'
                    ) : (
                      'Join Class'
                    )}
                  </Button>
                </div>
              )}
            </div>
          </div>
          {/* Interactive Dropzone */}
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={`
              relative border-2 border-dashed rounded-2xl p-6 sm:p-12 text-center transition-all duration-200 cursor-pointer
              ${
                dragActive
                  ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/50 scale-[1.01] shadow-inner'
                  : file
                    ? 'border-emerald-500/80 bg-emerald-50/40 dark:bg-emerald-950/25'
                    : 'border-slate-300 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 bg-slate-50/60 dark:bg-slate-950/60 hover:bg-indigo-50/30 dark:hover:bg-slate-900'
              }
            `}
          >
            <input
              type="file"
              accept={Object.values(ACCEPTED_MIME).flat().join(',')}
              onChange={handleChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />

            {file ? (
              /* File selected state */
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 max-w-xl w-full mx-auto bg-white dark:bg-slate-900 p-3.5 sm:p-4 rounded-2xl border border-emerald-200 dark:border-emerald-800/80 shadow-xs overflow-hidden">
                <div className="flex items-center gap-3 min-w-0 w-full sm:w-auto sm:flex-1">
                  <FileFormatIcon filename={file.name} size="lg" />
                  <div className="text-left min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <p
                        className="font-semibold text-sm sm:text-base text-slate-900 dark:text-white truncate min-w-0 flex-1"
                        title={file.name}
                      >
                        {file.name}
                      </p>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 shrink-0">
                        <CheckCircle2 className="h-3 w-3" /> READY
                      </span>
                    </div>
                    <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                      {(file.size / 1024 / 1024).toFixed(2)} MB ·{' '}
                      {file.name.toLowerCase().endsWith('.docx')
                        ? 'application/vnd.openxmlformats (.docx)'
                        : 'application/pdf'}{' '}
                      {!isUser ? ' · GROBID / XML' : ''}
                    </p>
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                    setError(null);
                  }}
                  aria-label="Remove file"
                  className="relative z-10 shrink-0 p-2 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/50 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            ) : (
              /* Dropzone default state */
              <div className="max-w-md mx-auto">
                <div className="flex items-center justify-center gap-3 mb-4">
                  <FileFormatIcon format="pdf" size="md" />
                  <div className="w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 flex items-center justify-center shadow-xs">
                    <Upload className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <FileFormatIcon format="docx" size="md" />
                </div>
                <p className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-white mb-1.5">
                  {t('upload.dropDocument')}
                </p>
                <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mb-4">
                  PDF &amp; DOCX · APA, IEEE, MLA, Chicago, Harvard, Vancouver
                </p>
                <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-indigo-600 dark:text-indigo-400 shadow-2xs">
                  {t('upload.orBrowse')}
                </span>
              </div>
            )}
          </div>

          {/* Error message */}
          {error && (
            <Alert variant="destructive" className="mt-4 rounded-xl">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Action Bar */}
          <div className="mt-6 pt-5 border-t border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-xs font-mono text-slate-500 dark:text-slate-400 min-w-0">
              {lang === 'vi'
                ? 'Pipeline: Bóc tách PDF/DOCX → 28+ CSDL Học thuật → 28 Luật Neuro-Symbolic'
                : 'Pipeline: PDF/DOCX Extraction → 28+ Scholarly Indexes → 28 Symbolic Rules'}
            </div>

            <Button
              size="lg"
              onClick={handleUpload}
              disabled={!file || uploading}
              className="w-full sm:w-auto shrink-0 whitespace-nowrap h-11 px-7 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-md shadow-indigo-600/20 disabled:opacity-50 btn-shimmer"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{t('upload.uploading')}</span>
                </>
              ) : (
                <>
                  <span>{t('upload.startVerification')}</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </div>
      </Card>

      {/* 3-Step Verification Pipeline Architecture Strip (Teacher / Admin only) */}
      {!isUser && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {pipelinePillars.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <Card
                key={pillar.step}
                className="p-4 rounded-2xl bg-white/90 dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 shadow-2xs flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className={`p-2 rounded-xl border ${pillar.tone}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                      STEP {pillar.step} · {pillar.tag}
                    </span>
                  </div>
                  <h3 className="font-display font-bold text-sm text-slate-900 dark:text-white">
                    {pillar.title}
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                    {pillar.desc}
                  </p>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <UpgradeModal
        open={upgradeModalOpen}
        onOpenChange={setUpgradeModalOpen}
        reasonTitle={upgradeReason.title}
        reasonDescription={upgradeReason.description}
        featureName={upgradeReason.feature}
      />
    </div>
  );
}
