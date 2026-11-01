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
  Loader2,
} from 'lucide-react';
import { api, type BillingTransactionItem, type SubscriptionSummary } from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
        if (sessionId) {
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
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p className="text-sm font-mono text-slate-500">
          {lang === 'vi'
            ? 'Đang xác nhận giao dịch và mở khóa hạn mức Premium...'
            : 'Confirming payment and unlocking Premium quotas...'}
        </p>
      </div>
    );
  }

  const tier = subscription?.plan_tier || 'pro';
  const quota = subscription?.quota;

  return (
    <div className="max-w-2xl mx-auto py-8 space-y-6" data-testid="billing-success-page">
      <Card className="rounded-3xl border-2 border-emerald-500/40 bg-white dark:bg-slate-900 p-6 sm:p-10 shadow-xl text-center space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto ring-4 ring-emerald-500/10">
          <CheckCircle2 className="h-9 w-9" />
        </div>

        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 text-xs font-mono font-bold text-indigo-700 dark:text-indigo-300">
            <Sparkles className="h-3.5 w-3.5" />
            {lang === 'vi' ? 'THANH TOÁN THÀNH CÔNG · STRIPE VERIFIED' : 'PAYMENT SUCCEEDED · STRIPE VERIFIED'}
          </div>
          <h1 className="font-display text-2xl sm:text-4xl font-bold text-slate-900 dark:text-white">
            {lang === 'vi'
              ? `Chào mừng bạn đến với CITRA ${tier.toUpperCase()}!`
              : `Welcome to CITRA ${tier.toUpperCase()}!`}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 max-w-lg mx-auto">
            {lang === 'vi'
              ? 'Tài khoản của bạn đã được nâng cấp ngay lập tức. Toàn bộ hạn mức tải tài liệu, xuất báo cáo PDF/DOCX và các chuyên trang phân tích sâu đã sẵn sàng.'
              : 'Your account has been upgraded immediately. All elevated upload quotas, PDF/DOCX exports, and deep verification tabs are now unlocked.'}
          </p>
        </div>

        {/* Receipt Summary Box */}
        {transaction && (
          <div
            className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 p-4 text-left space-y-2.5 text-xs"
            data-testid="billing-receipt-box"
          >
            <div className="flex items-center justify-between font-mono text-slate-500 pb-2 border-b border-slate-200 dark:border-slate-700">
              <span>{lang === 'vi' ? 'BIÊN LAI THANH TOÁN STRIPE' : 'STRIPE PAYMENT RECEIPT'}</span>
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
              <span className="font-mono font-bold text-slate-900 dark:text-white">
                ${transaction.amount_usd.toFixed(2)} USD
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">{lang === 'vi' ? 'Phương thức:' : 'Payment method:'}</span>
              <span className="font-mono uppercase text-slate-700 dark:text-slate-300 flex items-center gap-1">
                <CreditCard className="h-3.5 w-3.5 text-indigo-500" />
                {transaction.payment_method === 'apple_pay'
                  ? `APPLE PAY (${(transaction.card_brand || 'VISA').toUpperCase()} •••• ${transaction.card_last4 || '4242'})`
                  : transaction.payment_method === 'google_pay'
                    ? `GOOGLE PAY (${(transaction.card_brand || 'VISA').toUpperCase()} •••• ${transaction.card_last4 || '4242'})`
                    : `${transaction.card_brand || 'VISA'} •••• ${transaction.card_last4 || '4242'}`}
              </span>
            </div>
          </div>
        )}

        {/* Unlocked Quotas Grid */}
        {quota && (
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="p-3 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200/60 dark:border-indigo-800/60">
              <p className="font-display text-xl font-bold text-indigo-700 dark:text-indigo-300">
                {quota.monthly_uploads_limit}
              </p>
              <p className="text-[11px] text-slate-500">
                {lang === 'vi' ? 'Tài liệu / tháng' : 'Uploads / month'}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200/60 dark:border-indigo-800/60">
              <p className="font-display text-xl font-bold text-indigo-700 dark:text-indigo-300">
                {quota.max_pages_per_pdf}
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
