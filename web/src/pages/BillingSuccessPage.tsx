import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2,
  Sparkles,
  Upload,
  Settings,
  CreditCard,
  ShieldCheck,
} from 'lucide-react';
import { api, type BillingTransactionItem, type SubscriptionSummary } from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatLimit } from '@/lib/quotaDisplay';
import { Badge } from '@/components/ui/badge';

/* ============================================================
   CITRA — Billing Success & Receipt Page (v2.2)
   Confirms Stripe Demo/Test session & displays unlocked quotas
   ============================================================ */

export function BillingSuccessPage() {
  const { i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const { refreshUser } = useAuth();
  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';

  const sessionId = searchParams.get('session_id') || '';

  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(null);
  const [transaction, setTransaction] = useState<BillingTransactionItem | null>(null);

  useEffect(() => {
    let active = true;
    async function finalize() {
      try {
        // Collect any vnp_* parameters if redirected from VNPay ReturnURL
        const vnpParams: Record<string, string> = {};
        searchParams.forEach((value, key) => {
          if (key.startsWith('vnp_')) {
            vnpParams[key] = value;
          }
        });

        if (vnpParams.vnp_SecureHash && vnpParams.vnp_TxnRef) {
          const vnpRes = await api.verifyVNPayReturn({
            vnp_params: vnpParams,
            session_id: sessionId || null,
          });
          if (active) {
            setSubscription(vnpRes.subscription);
            setTransaction(vnpRes.transaction);
          }
        } else if (sessionId) {
          const res = await api.verifyCheckoutSession({ session_id: sessionId });
          if (active) {
            setSubscription(res.subscription);
            setTransaction(res.transaction);
          }
        } else {
          const subRes = await api.getMySubscription();
          if (active) {
            setSubscription(subRes.subscription);
            setTransaction(subRes.transactions[0] ?? null);
          }
        }
        await refreshUser();
      } catch {
        // Fallback to loading current subscription
        try {
          const subRes = await api.getMySubscription();
          if (active) {
            setSubscription(subRes.subscription);
            setTransaction(subRes.transactions[0] ?? null);
          }
        } catch {
          // ignore
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void finalize();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  if (loading) {
    return (
      <div className="min-h-[65vh] flex flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="relative w-16 h-16 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full border-2 border-dashed border-indigo-500/40 dark:border-sky-400/40 animate-orbital-spin" />
          <div className="absolute inset-1.5 rounded-full border-2 border-transparent border-t-emerald-500 border-r-[#005BAA] animate-orbital-reverse" />
          <Sparkles className="h-6 w-6 text-emerald-600 dark:text-emerald-400 animate-pulse" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-display font-bold text-slate-900 dark:text-white">
            {lang === 'vi'
              ? 'Đang hoàn tất nâng cấp gói cước...'
              : 'Finalizing your plan upgrade...'}
          </p>
          <p className="text-xs font-mono text-slate-500 dark:text-slate-400">
            {lang === 'vi'
              ? 'Đang xác nhận giao dịch và mở khóa hạn mức Premium...'
              : 'Confirming payment and unlocking Premium quotas...'}
          </p>
        </div>
      </div>
    );
  }

  const tier = subscription?.plan_tier || 'pro';
  const quota = subscription?.quota;
  const isVNPay =
    transaction?.payment_method === 'vnpay' ||
    transaction?.payment_mode?.startsWith('vnpay') ||
    Boolean(transaction?.vnp_txn_ref);
  const amountVnd =
    transaction?.amount_vnd ??
    Math.round((transaction?.amount_usd ?? 0) * (transaction?.usd_to_vnd_rate ?? 25000));
  const formatVndStr = (v: number) =>
    `${Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ₫`;

  return (
    <div className="max-w-2xl mx-auto py-6 sm:py-8 space-y-6 animate-hero-reveal" data-testid="billing-success-page">
      <Card className="relative overflow-hidden rounded-3xl border-2 border-emerald-500/40 bg-white dark:bg-slate-900 p-6 sm:p-10 shadow-2xl text-center space-y-6">
        {/* Ambient Celebration Glow */}
        <div className="pointer-events-none absolute -top-28 left-1/2 -translate-x-1/2 w-96 h-64 rounded-full bg-gradient-to-b from-emerald-400/20 via-sky-400/10 to-transparent blur-3xl" />

        {/* Animated Stroke-Draw Checkmark Badge */}
        <div className="relative z-10 flex items-center justify-center pt-1">
          <div className="w-20 h-20 rounded-3xl bg-emerald-500/15 dark:bg-emerald-500/20 border-2 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto ring-8 ring-emerald-500/10 shadow-lg animate-icon-pop">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="w-10 h-10 stroke-current"
              strokeWidth={2.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6 9 17l-5-5" className="animate-stroke-draw" />
            </svg>
          </div>
        </div>

        <div className="relative z-10 space-y-2.5">
          <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-800 text-xs font-mono font-bold text-emerald-700 dark:text-emerald-300 shadow-2xs">
            <Sparkles className="h-3.5 w-3.5" />
            {isVNPay
              ? lang === 'vi'
                ? 'THANH TOÁN THÀNH CÔNG · VNPAY VERIFIED'
                : 'PAYMENT SUCCEEDED · VNPAY VERIFIED'
              : lang === 'vi'
                ? 'THANH TOÁN THÀNH CÔNG · STRIPE VERIFIED'
                : 'PAYMENT SUCCEEDED · STRIPE VERIFIED'}
          </div>
          <h1 className="font-display text-2xl sm:text-4xl font-bold text-slate-900 dark:text-white tracking-tight">
            {lang === 'vi'
              ? `Chào mừng bạn đến với CITRA ${tier.toUpperCase()}!`
              : `Welcome to CITRA ${tier.toUpperCase()}!`}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 max-w-lg mx-auto">
            {lang === 'vi'
              ? 'Tài khoản của bạn đã được nâng cấp ngay lập tức. Toàn bộ hạn mức tải tài liệu, xuất báo cáo PDF/DOCX và các chuyên trang phân tích sâu đã sẵn sàng.'
              : 'Your account has been upgraded immediately. All elevated upload quotas, PDF/DOCX exports, and deep verification tabs are now unlocked.'}
          </p>

          {/* Celebratory Unlocked Feature Pills */}
          <div className="flex items-center justify-center gap-2 flex-wrap pt-1">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#F4F2EC] dark:bg-slate-800 border border-[#E7E3D9] dark:border-slate-700 text-[11px] font-mono font-semibold text-slate-700 dark:text-slate-200">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              {lang === 'vi' ? 'Xuất PDF & DOCX' : 'PDF & DOCX Export'}
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#F4F2EC] dark:bg-slate-800 border border-[#E7E3D9] dark:border-slate-700 text-[11px] font-mono font-semibold text-slate-700 dark:text-slate-200">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              {lang === 'vi' ? '15+ Nguồn học thuật' : '15+ Scholarly APIs'}
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#F4F2EC] dark:bg-slate-800 border border-[#E7E3D9] dark:border-slate-700 text-[11px] font-mono font-semibold text-slate-700 dark:text-slate-200">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              {lang === 'vi' ? '28 Luật Symbolic' : '28 Symbolic Rules'}
            </span>
          </div>
        </div>

        {/* Receipt Summary Box */}
        {transaction && (
          <div
            className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 p-4 text-left space-y-2.5 text-xs"
            data-testid="billing-receipt-box"
          >
            <div className="flex items-center justify-between font-mono text-slate-500 pb-2 border-b border-slate-200 dark:border-slate-700">
              <span>
                {isVNPay
                  ? lang === 'vi'
                    ? 'BIÊN LAI THANH TOÁN VNPAY (HMAC-SHA512)'
                    : 'VNPAY PAYMENT RECEIPT (HMAC-SHA512)'
                  : lang === 'vi'
                    ? 'BIÊN LAI THANH TOÁN STRIPE'
                    : 'STRIPE PAYMENT RECEIPT'}
              </span>
              <Badge className="bg-emerald-600 text-white text-[10px]">PAID</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">{lang === 'vi' ? 'Gói đăng ký:' : 'Plan:'}</span>
              <span className="font-semibold text-slate-900 dark:text-white">
                CITRA {transaction.plan_name} ({transaction.billing_cycle})
              </span>
            </div>
            {transaction.promo_code && (transaction.discount_usd ?? 0) > 0 && (
              <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
                <span>{lang === 'vi' ? 'Mã giảm giá:' : 'Promo code:'}</span>
                <span className="font-mono font-semibold">
                  {transaction.promo_code} (-${(transaction.discount_usd ?? 0).toFixed(2)} USD)
                </span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-slate-500">{lang === 'vi' ? 'Số tiền đã thanh toán:' : 'Amount paid:'}</span>
              <span
                className="font-mono font-bold text-slate-900 dark:text-white"
                data-testid="receipt-amount-paid"
              >
                {isVNPay
                  ? `${formatVndStr(amountVnd)} VND ($${transaction.amount_usd.toFixed(2)} USD)`
                  : `$${transaction.amount_usd.toFixed(2)} USD`}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">{lang === 'vi' ? 'Phương thức:' : 'Payment method:'}</span>
              <span
                className="font-mono uppercase text-slate-700 dark:text-slate-300 flex items-center gap-1"
                data-testid="receipt-payment-method"
              >
                <CreditCard className="h-3.5 w-3.5 text-indigo-500" />
                {isVNPay
                  ? `VNPAY · ${(transaction.vnp_bank_code || transaction.card_brand || 'NCB').toUpperCase()} •••• ${transaction.card_last4 || '2198'}`
                  : transaction.payment_method === 'apple_pay'
                    ? `APPLE PAY (${(transaction.card_brand || 'VISA').toUpperCase()} •••• ${transaction.card_last4 || '4242'})`
                    : transaction.payment_method === 'google_pay'
                      ? `GOOGLE PAY (${(transaction.card_brand || 'VISA').toUpperCase()} •••• ${transaction.card_last4 || '4242'})`
                      : `${transaction.card_brand || 'VISA'} •••• ${transaction.card_last4 || '4242'}`}
              </span>
            </div>
            {isVNPay && transaction.vnp_txn_ref && (
              <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 pt-1 border-t border-slate-200/70 dark:border-slate-700/70">
                <span>vnp_TxnRef / vnp_TransactionNo:</span>
                <span data-testid="receipt-vnp-txn-ref">
                  {transaction.vnp_txn_ref}
                  {transaction.vnp_transaction_no
                    ? ` · #${transaction.vnp_transaction_no}`
                    : ''}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Unlocked Quotas Grid */}
        {quota && (
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="p-3 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200/60 dark:border-indigo-800/60">
              <p className="font-display text-xl font-bold text-indigo-700 dark:text-indigo-300">
                {formatLimit(quota.monthly_uploads_limit, lang === 'vi' ? 'vi' : 'en')}
              </p>
              <p className="text-[11px] text-slate-500">
                {lang === 'vi' ? 'Tài liệu / tháng' : 'Uploads / month'}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200/60 dark:border-indigo-800/60">
              <p className="font-display text-xl font-bold text-indigo-700 dark:text-indigo-300">
                {formatLimit(quota.max_pages_per_pdf, lang === 'vi' ? 'vi' : 'en')}
              </p>
              <p className="text-[11px] text-slate-500">
                {lang === 'vi' ? 'Trang tối đa / PDF' : 'Max pages / PDF'}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200/60 dark:border-indigo-800/60">
              <p className="font-display text-xl font-bold text-indigo-700 dark:text-indigo-300">
                {quota.max_file_size_mb} MB
              </p>
              <p className="text-[11px] text-slate-500">
                {lang === 'vi' ? 'Dung lượng file' : 'Max file size'}
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <Button
            asChild
            data-testid="success-go-upload-btn"
            className="w-full sm:w-auto rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white h-11 px-6 font-semibold"
          >
            <Link to="/upload">
              <Upload className="h-4 w-4 mr-2" />
              {lang === 'vi' ? 'Tải tài liệu kiểm chứng ngay' : 'Upload Manuscript Now'}
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            className="w-full sm:w-auto rounded-xl h-11 px-5"
          >
            <Link to="/settings">
              <Settings className="h-4 w-4 mr-2" />
              {lang === 'vi' ? 'Quản lý gói cước & Hóa đơn' : 'Manage Subscription'}
            </Link>
          </Button>
        </div>

        <p className="text-[11px] text-slate-400 flex items-center justify-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
          {lang === 'vi'
            ? 'Hóa đơn điện tử đã được lưu trong mục Cài đặt > Gói cước & Thanh toán.'
            : 'Your invoice has been saved under Settings > Subscription & Billing.'}
        </p>
      </Card>
    </div>
  );
}
