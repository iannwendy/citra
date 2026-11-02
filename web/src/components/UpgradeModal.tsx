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
} from 'lucide-react';
import { api, type BillingCycle } from '@/api/client';
import { SCHOLARLY_APIS_LABEL } from '@/lib/productFacts';
import {
  Dialog,
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
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';

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
          : lang === 'vi'
            ? 'Không thể khởi tạo phiên thanh toán Stripe.'
            : 'Could not initialize Stripe checkout session.',
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
        className="sm:max-w-3xl p-0 overflow-hidden border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
        data-testid="upgrade-modal"
      >
        {/* Top Banner */}
        <div className="bg-gradient-to-r from-indigo-950 via-indigo-900 to-slate-900 px-6 py-5 text-white relative overflow-hidden">
          <div className="flex items-start justify-between gap-4 relative z-10">
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-400/20 border border-amber-300/30 text-amber-200 text-[11px] font-mono font-semibold">
                <Lock className="h-3 w-3" />
                {featureName
                  ? lang === 'vi'
                    ? `TÍNH NĂNG PREMIUM · ${featureName.toUpperCase()}`
                    : `PREMIUM FEATURE · ${featureName.toUpperCase()}`
                  : lang === 'vi'
                    ? 'NÂNG CẤP TÀI KHOẢN CITRA PREMIUM'
                    : 'UPGRADE TO CITRA PREMIUM'}
              </div>
              <DialogHeader className="text-left">
                <DialogTitle className="font-display text-xl sm:text-2xl font-bold text-white">
                  {reasonTitle ||
                    (lang === 'vi'
                      ? 'Mở khóa toàn bộ sức mạnh kiểm chứng học thuật'
                      : 'Unlock Full Academic Verification Power')}
                </DialogTitle>
                <DialogDescription className="text-indigo-100/90 text-sm">
                  {reasonDescription ||
                    (lang === 'vi'
                      ? 'Gói Basic miễn phí giới hạn 3 tài liệu/tháng (tối đa 5MB, 15 trang) và không hỗ trợ xuất PDF/DOCX hay phân tích sâu.'
                      : 'The free Basic plan is limited to 3 documents/month (max 5MB, 15 pages) without PDF/DOCX exports or deep inspection.')}
                </DialogDescription>
              </DialogHeader>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          {/* Billing Cycle Toggle */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200/80 dark:border-slate-800">
            <div className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <span>
                {lang === 'vi'
                  ? 'Chọn chu kỳ thanh toán theo năm để tiết kiệm ngay 20% (Tặng >2 tháng miễn phí)'
                  : 'Choose annual billing to save 20% instantly (Over 2 months free)'}
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
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                {lang === 'vi' ? 'Theo tháng' : 'Monthly'}
              </button>
              <button
                type="button"
                data-testid="modal-cycle-annual"
                onClick={() => setBillingCycle('annual')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                  billingCycle === 'annual'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <span>{lang === 'vi' ? 'Theo năm' : 'Annual'}</span>
                <span className="px-1.5 py-0.2 rounded-full bg-emerald-500 text-white text-[10px] font-mono font-bold">
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
            <div className="rounded-2xl border-2 border-indigo-600 dark:border-indigo-500 bg-indigo-50/30 dark:bg-indigo-950/20 p-5 flex flex-col justify-between relative shadow-md">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-indigo-600 text-white">
                      <Zap className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                        CITRA Pro
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {lang === 'vi'
                          ? 'Luận văn, Nghiên cứu sinh & Giảng viên'
                          : 'Thesis writers, Researchers & Lecturers'}
                      </p>
                    </div>
                  </div>
                  <Badge className="bg-indigo-600 text-white text-[10px] font-mono">
                    {lang === 'vi' ? 'PHỔ BIẾN NHẤT' : 'MOST POPULAR'}
                  </Badge>
                </div>

                <div className="pt-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-display text-3xl font-bold text-slate-900 dark:text-white">
                      ${proMonthlyDisplay}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      / {lang === 'vi' ? 'tháng' : 'month'}
                    </span>
                    {billingCycle === 'annual' && (
                      <span className="text-xs line-through text-slate-400 ml-1">
                        $20
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
                    {billingCycle === 'annual'
                      ? lang === 'vi'
                        ? 'Thanh toán $192/năm (Tiết kiệm $48/năm)'
                        : 'Billed $192/year (Save $48/year)'
                      : lang === 'vi'
                        ? 'Thanh toán $20 định kỳ hàng tháng'
                        : 'Billed $20 monthly'}
                  </p>
                </div>

                <ul className="space-y-2 text-xs text-slate-700 dark:text-slate-300 pt-2 border-t border-slate-200/80 dark:border-slate-800">
                  {(lang === 'vi'
                    ? [
                        '50 tài liệu PDF / tháng (Tối đa 25MB, 100 trang/bài)',
                        'Kiểm chứng tới 200 trích dẫn / bài + Batch 10 files',
                        'Mở khóa Document Inspector, Logic Trace & Đồ thị',
                        'Xuất báo cáo chuẩn học thuật PDF, DOCX (Word), CSV',
                        `Đầy đủ ${SCHOLARLY_APIS_LABEL} nguồn học thuật + Deep Neural Sentence-BERT`,
                      ]
                    : [
                        '50 PDF checks / month (Up to 25MB, 100 pages/doc)',
                        'Up to 200 citations / doc + 10-file Batch Upload',
                        'Unlock Document Inspector, Logic Trace & Evidence Graph',
                        'Export academic reports in PDF, DOCX (Word) & CSV',
                        `All ${SCHOLARLY_APIS_LABEL} Scholarly APIs + Deep Neural Sentence-BERT`,
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
                data-testid="modal-upgrade-pro-btn"
                onClick={() => handleCheckout('pro')}
                disabled={loadingTier !== null}
                className="w-full mt-5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl h-10 cursor-pointer"
              >
                {loadingTier === 'pro' ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <CreditCard className="h-4 w-4 mr-2" />
                )}
                {lang === 'vi'
                  ? `Nâng cấp Pro · $${billingCycle === 'annual' ? '192/năm' : '20/tháng'}`
                  : `Upgrade to Pro · $${billingCycle === 'annual' ? '192/yr' : '20/mo'}`}
              </Button>
            </div>

            {/* ULTRA PLAN */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between relative shadow-xs">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-violet-600 text-white">
                      <Building2 className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                        CITRA Ultra
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {lang === 'vi'
                          ? 'Phòng Lab, Bộ môn & Hội đồng luận án'
                          : 'Research Labs, Departments & Review Boards'}
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-[10px] font-mono">
                    {lang === 'vi' ? 'PHÒNG LAB' : 'LABS & INSTITUTION'}
                  </Badge>
                </div>

                <div className="pt-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-display text-3xl font-bold text-slate-900 dark:text-white">
                      ${ultraMonthlyDisplay}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      / {lang === 'vi' ? 'tháng' : 'month'}
                    </span>
                    {billingCycle === 'annual' && (
                      <span className="text-xs line-through text-slate-400 ml-1">
                        $200
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
                    {billingCycle === 'annual'
                      ? lang === 'vi'
                        ? 'Thanh toán $1,920/năm (Tiết kiệm $480/năm)'
                        : 'Billed $1,920/year (Save $480/year)'
                      : lang === 'vi'
                        ? 'Thanh toán $200 định kỳ hàng tháng'
                        : 'Billed $200 monthly'}
                  </p>
                </div>

                <ul className="space-y-2 text-xs text-slate-700 dark:text-slate-300 pt-2 border-t border-slate-200/80 dark:border-slate-800">
                  {(lang === 'vi'
                    ? [
                        'Không giới hạn lượt kiểm tra (1.000 bài/tháng)',
                        'Tối đa 100MB & 500 trang (Luận án Tiến sĩ & Sách)',
                        'Batch Upload công suất lớn tới 50 PDF cùng lúc',
                        'Mở khóa SerpAPI Google Scholar Fallback & Active Link Check',
                        'Không giới hạn Lớp học, Sinh viên & Xuất Class ZIP',
                      ]
                    : [
                        'Unlimited monthly checks (1,000 manuscripts/mo)',
                        'Up to 100MB & 500 pages (Dissertations & Monographs)',
                        'High-throughput Batch Upload up to 50 PDFs at once',
                        'SerpAPI Google Scholar Fallback & Live DOI Reachability',
                        'Unlimited Classrooms, Students & Full Class ZIP Export',
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
                variant="outline"
                data-testid="modal-upgrade-ultra-btn"
                onClick={() => handleCheckout('ultra')}
                disabled={loadingTier !== null}
                className="w-full mt-5 border-violet-600/40 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/40 font-semibold rounded-xl h-10 cursor-pointer"
              >
                {loadingTier === 'ultra' ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <CreditCard className="h-4 w-4 mr-2" />
                )}
                {lang === 'vi'
                  ? `Nâng cấp Ultra · $${billingCycle === 'annual' ? '1,920/năm' : '200/tháng'}`
                  : `Upgrade to Ultra · $${billingCycle === 'annual' ? '1,920/yr' : '200/mo'}`}
              </Button>
            </div>
          </div>

          {/* Footer link to full pricing comparison */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-2 border-t border-slate-200/80 dark:border-slate-800 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              {lang === 'vi'
                ? 'Thanh toán bảo mật qua Stripe & VNPay-QR/ATM · Hủy gia hạn bất cứ lúc nào'
                : 'Secure checkout via Stripe & VNPay-QR/ATM · Cancel anytime with 1 click'}
            </span>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                navigate('/pricing');
              }}
              className="inline-flex items-center gap-1 font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
            >
              {lang === 'vi' ? 'Xem bảng so sánh chi tiết 3 gói' : 'Compare all 3 plans in detail'}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
