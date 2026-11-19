import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Sparkles,
  Check,
  Lock,
  ArrowRight,
  ShieldCheck,
  Zap,
  Building2,
  Loader2,
  CreditCard,
  X,
} from 'lucide-react';
import { api, type BillingCycle } from '@/api/client';
import { SCHOLARLY_APIS_LABEL } from '@/lib/productFacts';
import { useRole } from '@/hooks/useRole';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reasonTitle?: string;
  reasonDescription?: string;
  featureName?: string;
}

export function UpgradeModal({
  open,
  onOpenChange,
  reasonTitle,
  reasonDescription,
  featureName,
}: UpgradeModalProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { isPro, isUltra } = useRole();
  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const highlightUltra = isPro || isUltra;

  const [billingCycle, setBillingCycle] = useState<BillingCycle>('annual');
  const [loadingTier, setLoadingTier] = useState<'pro' | 'ultra' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCheckout = async (tier: 'pro' | 'ultra') => {
    setLoadingTier(tier);
    setError(null);
    try {
      const session = await api.createCheckoutSession({
        plan_tier: tier,
        billing_cycle: billingCycle,
      });
      onOpenChange(false);
      if (session.checkout_url.startsWith('http')) {
        window.location.href = session.checkout_url;
      } else {
        navigate(session.checkout_url);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t(
              'upgradeModal.checkoutInitError',
              lang === 'vi'
                ? 'Không thể khởi tạo phiên thanh toán. Vui lòng thử lại sau giây lát.'
                : 'Could not start the checkout session. Please try again in a moment.',
            ),
      );
    } finally {
      setLoadingTier(null);
    }
  };

  const proMonthlyDisplay = billingCycle === 'annual' ? 16 : 20;
  const ultraMonthlyDisplay = billingCycle === 'annual' ? 160 : 200;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideCloseButton
        className="flex flex-col gap-0 p-0 sm:p-0 sm:max-w-3xl max-h-[90dvh] overflow-hidden border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
        data-testid="upgrade-modal"
      >
        {/* Top Banner */}
        <div className="shrink-0 bg-gradient-to-r from-indigo-950 via-indigo-900 to-slate-900 px-5 sm:px-6 py-4 sm:py-5 text-white relative overflow-hidden">
          <div className="flex items-start justify-between gap-4 relative z-10">
            <div className="space-y-1.5 min-w-0">
              <div className="inline-flex flex-wrap items-center gap-1.5 max-w-full px-2.5 py-0.5 rounded-full bg-amber-400/20 border border-amber-300/30 text-amber-200 text-[11px] font-mono font-semibold leading-snug">
                <Lock className="h-3 w-3 shrink-0" />
                <span className="break-words">
                  {featureName
                    ? lang === 'vi'
                      ? `TÍNH NĂNG PREMIUM · ${featureName.toUpperCase()}`
                      : `PREMIUM FEATURE · ${featureName.toUpperCase()}`
                    : t(
                        'upgradeModal.badgeDefault',
                        lang === 'vi'
                          ? 'NÂNG CẤP TÀI KHOẢN CITRA PREMIUM'
                          : 'UPGRADE TO CITRA PREMIUM',
                      )}
                </span>
              </div>
              <DialogHeader className="text-left">
                <DialogTitle className="font-display text-xl sm:text-2xl font-bold text-white">
                  {reasonTitle ||
                    (highlightUltra
                      ? t(
                          'upgradeModal.titleUltra',
                          lang === 'vi'
                            ? 'Nâng cấp lên CITRA Ultra cho Phòng Lab & Bộ môn'
                            : 'Upgrade to CITRA Ultra for Labs & Departments',
                        )
                      : t(
                          'upgradeModal.titlePro',
                          lang === 'vi'
                            ? 'Mở khóa trọn bộ công cụ kiểm chứng trích dẫn học thuật'
                            : 'Verify Every Citation with Complete Confidence',
                        ))}
                </DialogTitle>
                <DialogDescription className="text-indigo-100/90 text-sm">
                  {reasonDescription ||
                    (highlightUltra
                      ? t(
                          'upgradeModal.descUltra',
                          lang === 'vi'
                            ? 'Bạn đang sử dụng gói CITRA Pro. Nâng cấp lên Ultra để kiểm tra tới 1.000 bản thảo/tháng (tối đa 100MB, 500 trang), tra cứu mở rộng trên Google Scholar, không giới hạn lớp học và tải trọn bộ báo cáo cả lớp (.ZIP).'
                            : 'You are currently on CITRA Pro. Upgrade to Ultra for up to 1,000 manuscript checks/month (up to 100MB, 500 pages), extended Google Scholar discovery, unlimited classrooms, and full-cohort ZIP export.',
                        )
                      : t(
                          'upgradeModal.descPro',
                          lang === 'vi'
                            ? 'Gói Basic miễn phí hỗ trợ 3 tài liệu/tháng (tối đa 5MB, 15 trang). Nâng cấp để kiểm tra trọn vẹn khóa luận, đối chiếu trang PDF trực quan và xuất báo cáo chuẩn học thuật Word/PDF.'
                            : 'The free Basic plan includes 3 documents/month (up to 5MB, 15 pages). Upgrade to verify full-length theses, inspect citations directly on PDF pages, and export polished Word & PDF reports.',
                        ))}
                </DialogDescription>
              </DialogHeader>
            </div>
            <DialogClose className="rounded-lg p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 shrink-0 cursor-pointer">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogClose>
          </div>
        </div>

        <div
          data-testid="upgrade-modal-body"
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6 space-y-5"
        >
          {/* Billing Cycle Toggle */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200/80 dark:border-slate-800">
            <div className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <span>
                {t(
                  'upgradeModal.annualSavingsHint',
                  lang === 'vi'
                    ? 'Chọn chu kỳ thanh toán theo năm để tiết kiệm ngay 20% (tặng hơn 2 tháng sử dụng)'
                    : 'Choose annual billing to save 20% instantly (over 2 months free)',
                )}
              </span>
            </div>
            <div
              className="inline-flex items-center p-1 rounded-xl bg-slate-200/80 dark:bg-slate-900 border border-slate-300/60 dark:border-slate-700 shrink-0"
              role="group"
              aria-label="Billing cycle toggle"
            >
              <button
                type="button"
                data-testid="modal-cycle-monthly"
                onClick={() => setBillingCycle('monthly')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  billingCycle === 'monthly'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {t('upgradeModal.monthly', lang === 'vi' ? 'Theo tháng' : 'Monthly')}
              </button>
              <button
                type="button"
                data-testid="modal-cycle-annual"
                onClick={() => setBillingCycle('annual')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                  billingCycle === 'annual'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <span>{t('upgradeModal.annual', lang === 'vi' ? 'Theo năm' : 'Annual')}</span>
                <span className="px-1.5 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-mono font-bold">
                  -20%
                </span>
              </button>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {/* Plan Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* PRO PLAN */}
            <div
              className={`rounded-2xl p-5 flex flex-col justify-between relative ${
                highlightUltra
                  ? 'border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 shadow-sm'
                  : 'border-2 border-indigo-600 dark:border-indigo-500 bg-indigo-50/30 dark:bg-indigo-950/20 shadow-md'
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-indigo-600 text-white shrink-0">
                      <Zap className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                        CITRA Pro
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        {t(
                          'upgradeModal.proAudience',
                          lang === 'vi'
                            ? 'Khóa luận, Nghiên cứu sinh & Giảng viên'
                            : 'Thesis writers, Researchers & Lecturers',
                        )}
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant={highlightUltra ? 'secondary' : 'default'}
                    className={
                      highlightUltra
                        ? 'text-[10px] font-mono whitespace-nowrap shrink-0'
                        : 'bg-indigo-600 text-white text-[10px] font-mono whitespace-nowrap shrink-0'
                    }
                  >
                    {isPro
                      ? lang === 'vi'
                        ? 'GÓI HIỆN TẠI'
                        : 'CURRENT PLAN'
                      : isUltra
                        ? lang === 'vi'
                          ? 'ĐÃ BAO GỒM'
                          : 'INCLUDED'
                        : lang === 'vi'
                          ? 'PHỔ BIẾN NHẤT'
                          : 'MOST POPULAR'}
                  </Badge>
                </div>

                <div className="pt-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-display text-3xl font-bold text-slate-900 dark:text-white">
                      ${proMonthlyDisplay}
                    </span>
                    <span className="text-xs text-slate-600 dark:text-slate-400">
                      / {lang === 'vi' ? 'tháng' : 'month'}
                    </span>
                    {billingCycle === 'annual' && (
                      <span className="text-xs line-through text-slate-500 dark:text-slate-400 ml-1">
                        $20
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] font-mono text-emerald-700 dark:text-emerald-300 mt-0.5">
                    {billingCycle === 'annual'
                      ? lang === 'vi'
                        ? 'Thanh toán $192/năm (Tiết kiệm $48/năm)'
                        : 'Billed $192/year (Save $48/year)'
                      : lang === 'vi'
                        ? 'Thanh toán $20 định kỳ hàng tháng'
                        : 'Billed $20 monthly'}
                  </p>
                  {lang === 'vi' && (
                    <p
                      data-testid="modal-pro-vnd-equivalent"
                      className="text-[11px] font-mono font-medium text-slate-700 dark:text-slate-300 mt-0.5"
                    >
                      {billingCycle === 'annual'
                        ? '≈ 400.000 ₫/tháng · 4.800.000 ₫/năm qua VNPay'
                        : '≈ 500.000 ₫/tháng qua VNPay & thẻ quốc tế'}
                    </p>
                  )}
                </div>

                <ul className="space-y-2 text-xs text-slate-700 dark:text-slate-300 pt-2 border-t border-slate-200/80 dark:border-slate-800">
                  {(lang === 'vi'
                    ? [
                        '50 bản thảo (.PDF, .DOCX, .BIB, .RIS) / tháng (tối đa 25MB, 100 trang)',
                        'Kiểm chứng tới 200 trích dẫn / bài & tải lên đồng thời 10 tệp',
                        'Mở khóa trình đọc đối chiếu trang PDF, giải thích chi tiết & sơ đồ nguồn',
                        'Tự động chuẩn hóa danh mục (APA, IEEE, BibTeX) & xuất báo cáo Word, PDF, CSV',
                        `Đối chiếu sâu trên ${SCHOLARLY_APIS_LABEL} thư viện học thuật quốc tế & hiểu ngữ cảnh Việt – Anh`,
                      ]
                    : [
                        '50 manuscript checks (.PDF, .DOCX, .BIB, .RIS) / month (up to 25MB, 100 pages)',
                        'Up to 200 citations / document + 10-file simultaneous upload',
                        'Interactive PDF page-to-source reader, step-by-step reasoning & source map',
                        'Clean bibliography formatting (APA, IEEE, BibTeX) & Word, PDF, CSV reports',
                        `Deep cross-checking across ${SCHOLARLY_APIS_LABEL} scholarly libraries with semantic context matching`,
                      ]
                  ).map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <Check className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <Button
                type="button"
                variant={highlightUltra ? 'outline' : 'default'}
                data-testid="modal-upgrade-pro-btn"
                onClick={() => handleCheckout('pro')}
                disabled={highlightUltra || loadingTier !== null}
                className={`w-full mt-5 font-semibold rounded-xl h-10 ${
                  highlightUltra
                    ? 'opacity-70 cursor-not-allowed'
                    : 'bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer'
                }`}
              >
                {loadingTier === 'pro' ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <CreditCard className="h-4 w-4 mr-2" />
                )}
                {isPro
                  ? lang === 'vi'
                    ? 'Đang sử dụng gói CITRA Pro'
                    : 'Current Plan · CITRA Pro'
                  : isUltra
                    ? lang === 'vi'
                      ? 'Đã mở khóa trong CITRA Ultra'
                      : 'Included in CITRA Ultra'
                    : lang === 'vi'
                      ? `Nâng cấp Pro · $${billingCycle === 'annual' ? '192/năm' : '20/tháng'}`
                      : `Upgrade to Pro · $${billingCycle === 'annual' ? '192/yr' : '20/mo'}`}
              </Button>
            </div>

            {/* ULTRA PLAN */}
            <div
              className={`rounded-2xl p-5 flex flex-col justify-between relative ${
                highlightUltra
                  ? 'border-2 border-violet-600 dark:border-violet-500 bg-violet-50/30 dark:bg-violet-950/20 shadow-md'
                  : 'border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm'
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-violet-600 text-white shrink-0">
                      <Building2 className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                        CITRA Ultra
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        {t(
                          'upgradeModal.ultraAudience',
                          lang === 'vi'
                            ? 'Phòng Lab, Bộ môn & Hội đồng luận án'
                            : 'Research Labs, Departments & Review Boards',
                        )}
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant={highlightUltra ? 'default' : 'secondary'}
                    className={
                      highlightUltra
                        ? 'bg-violet-600 text-white text-[10px] font-mono whitespace-nowrap shrink-0'
                        : 'text-[10px] font-mono whitespace-nowrap shrink-0'
                    }
                  >
                    {isUltra
                      ? lang === 'vi'
                        ? 'GÓI HIỆN TẠI'
                        : 'CURRENT PLAN'
                      : highlightUltra
                        ? lang === 'vi'
                          ? 'KHUYÊN DÙNG NÂNG CẤP'
                          : 'RECOMMENDED UPGRADE'
                        : lang === 'vi'
                          ? 'PHÒNG LAB'
                          : 'LABS & INSTITUTION'}
                  </Badge>
                </div>

                <div className="pt-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-display text-3xl font-bold text-slate-900 dark:text-white">
                      ${ultraMonthlyDisplay}
                    </span>
                    <span className="text-xs text-slate-600 dark:text-slate-400">
                      / {lang === 'vi' ? 'tháng' : 'month'}
                    </span>
                    {billingCycle === 'annual' && (
                      <span className="text-xs line-through text-slate-500 dark:text-slate-400 ml-1">
                        $200
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] font-mono text-emerald-700 dark:text-emerald-300 mt-0.5">
                    {billingCycle === 'annual'
                      ? lang === 'vi'
                        ? 'Thanh toán $1,920/năm (Tiết kiệm $480/năm)'
                        : 'Billed $1,920/year (Save $480/year)'
                      : lang === 'vi'
                        ? 'Thanh toán $200 định kỳ hàng tháng'
                        : 'Billed $200 monthly'}
                  </p>
                  {lang === 'vi' && (
                    <p
                      data-testid="modal-ultra-vnd-equivalent"
                      className="text-[11px] font-mono font-medium text-slate-700 dark:text-slate-300 mt-0.5"
                    >
                      {billingCycle === 'annual'
                        ? '≈ 4.000.000 ₫/tháng · 48.000.000 ₫/năm qua VNPay'
                        : '≈ 5.000.000 ₫/tháng qua VNPay & thẻ quốc tế'}
                    </p>
                  )}
                </div>

                <ul className="space-y-2 text-xs text-slate-700 dark:text-slate-300 pt-2 border-t border-slate-200/80 dark:border-slate-800">
                  {(lang === 'vi'
                    ? [
                        'Hạn mức quy mô bộ môn lên tới 1.000 bản thảo / tháng',
                        'Tối đa 100MB & 500 trang / bài (Luận án Tiến sĩ & Sách chuyên khảo)',
                        'Rà soát hàng loạt công suất lớn tới 50 tài liệu cùng lúc',
                        'Tra cứu mở rộng trên Google Scholar cho sách hiếm & kiểm tra DOI/liên kết sống',
                        'Không giới hạn lớp học, sinh viên & tải trọn bộ báo cáo cả lớp (.ZIP)',
                      ]
                    : [
                        'Department-scale volume up to 1,000 manuscripts / month',
                        'Up to 100MB & 500 pages / file (Doctoral Dissertations & Monographs)',
                        'High-volume batch verification up to 50 files at once',
                        'Extended Google Scholar discovery for rare books & live DOI/link checks',
                        'Unlimited classrooms, students & full-cohort archive export (.ZIP)',
                      ]
                  ).map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <Check className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400 shrink-0 mt-0.5" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <Button
                type="button"
                variant={highlightUltra && !isUltra ? 'default' : 'outline'}
                data-testid="modal-upgrade-ultra-btn"
                onClick={() => handleCheckout('ultra')}
                disabled={isUltra || loadingTier !== null}
                className={`w-full mt-5 font-semibold rounded-xl h-10 ${
                  isUltra
                    ? 'opacity-70 cursor-not-allowed'
                    : highlightUltra
                      ? 'bg-violet-600 hover:bg-violet-700 text-white cursor-pointer'
                      : 'border-violet-600/40 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/40 cursor-pointer'
                }`}
              >
                {loadingTier === 'ultra' ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <CreditCard className="h-4 w-4 mr-2" />
                )}
                {isUltra
                  ? lang === 'vi'
                    ? 'Đang sử dụng gói CITRA Ultra'
                    : 'Current Plan · CITRA Ultra'
                  : lang === 'vi'
                    ? `Nâng cấp Ultra · $${billingCycle === 'annual' ? '1,920/năm' : '200/tháng'}`
                    : `Upgrade to Ultra · $${billingCycle === 'annual' ? '1,920/yr' : '200/mo'}`}
              </Button>
            </div>
          </div>

          {/* Footer link to full pricing comparison */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-2 border-t border-slate-200/80 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              {t(
                'upgradeModal.secureFooter',
                lang === 'vi'
                  ? 'Thanh toán bảo mật qua Stripe & VNPay-QR/ATM · Hủy gia hạn bất cứ lúc nào'
                  : 'Secure checkout via Stripe & VNPay-QR/ATM · Cancel anytime with 1 click',
              )}
            </span>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                navigate('/pricing');
              }}
              className="inline-flex items-center gap-1 font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
            >
              {t(
                'upgradeModal.comparePlansLink',
                lang === 'vi' ? 'Xem bảng so sánh chi tiết 3 gói' : 'Compare all 3 plans in detail',
              )}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
