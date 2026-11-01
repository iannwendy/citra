import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Lock,
  ShieldCheck,
  CreditCard,
  CheckCircle2,
  Sparkles,
  Loader2,
  AlertCircle,
  Tag,
  X,
  Check,
  Fingerprint,
  Globe,
  Smartphone,
} from 'lucide-react';
import {
  api,
  type CheckoutSessionDetails,
  type PaymentMethodType,
} from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

/* ============================================================
   CITRA — Interactive Stripe Checkout Sandbox (v2.4)
   Supports:
   - Express Checkout: Apple Pay & Google Pay interactive wallet sheets
   - International Cards: VISA, Mastercard, Amex, JCB with Luhn & Expiry validation
   - 6-Character Promo Code real-time validation & discount breakdown
   - PCI-DSS Level 1 client-side tokenization (never transmits raw PAN/CVV)
   ============================================================ */

export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'jcb';

/** Auto-detect card brand from raw digits */
export function detectCardBrand(digits: string): CardBrand {
  if (/^4/.test(digits)) return 'visa';
  if (/^(5[1-5]|2(22[1-9]|2[3-9]\d|[3-6]\d\d|7[01]\d|720))/.test(digits)) {
    return 'mastercard';
  }
  if (/^3[47]/.test(digits)) return 'amex';
  if (/^35/.test(digits)) return 'jcb';
  return 'visa';
}

/** Standard Luhn checksum validation for credit/debit card numbers */
export function isValidLuhn(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19 || !/^\d+$/.test(digits)) {
    return false;
  }
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits.charAt(i), 10);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

/** Format card number into groups of 4 digits */
function formatCardNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 16);
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

/** Format expiry as MM/YY */
function formatExpiryInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length >= 3) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }
  return digits;
}

/** Validate MM/YY expiration date */
export function isValidExpiry(expiry: string): boolean {
  const match = /^(\d{2})\/(\d{2})$/.exec(expiry.trim());
  if (!match) return false;
  const month = parseInt(match[1], 10);
  const year2 = parseInt(match[2], 10);
  if (month < 1 || month > 12) return false;
  const fullYear = 2000 + year2;
  // Valid for current/future years (2026+)
  if (fullYear < 2026 || fullYear > 2045) return false;
  return true;
}

/* ---------- Official Brand SVG Badges ---------- */

function VisaLogo({ active = true }: { active?: boolean }) {
  return (
    <span
      className={`inline-flex items-center justify-center px-2 py-0.5 rounded-md border text-[10px] font-black italic tracking-tighter select-none transition-all ${
        active
          ? 'bg-[#1A1F71] text-white border-[#1A1F71] shadow-2xs'
          : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 opacity-60'
      }`}
    >
      VISA
    </span>
  );
}

function MastercardLogo({ active = true }: { active?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md border select-none transition-all ${
        active
          ? 'bg-slate-900 text-white border-slate-800 shadow-2xs'
          : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 opacity-60'
      }`}
      title="Mastercard"
    >
      <span className="w-2.5 h-2.5 rounded-full bg-[#EB001B] inline-block" />
      <span className="w-2.5 h-2.5 rounded-full bg-[#F79E1B] -ml-1 inline-block mix-blend-screen" />
      <span className="text-[9px] font-bold tracking-tight ml-0.5">MC</span>
    </span>
  );
}

function AmexLogo({ active = true }: { active?: boolean }) {
  return (
    <span
      className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded-md border text-[9px] font-extrabold tracking-tight select-none transition-all ${
        active
          ? 'bg-[#006FCF] text-white border-[#006FCF] shadow-2xs'
          : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 opacity-60'
      }`}
    >
      AMEX
    </span>
  );
}

function JcbLogo({ active = true }: { active?: boolean }) {
  return (
    <span
      className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded-md border text-[9px] font-extrabold tracking-tight select-none transition-all ${
        active
          ? 'bg-emerald-700 text-white border-emerald-700 shadow-2xs'
          : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 opacity-60'
      }`}
    >
      JCB
    </span>
  );
}

function AppleLogoSvg({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

function GooglePaySvg({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

const BILLING_COUNTRIES = [
  { code: 'VN', name_vi: 'Việt Nam (VN)', name_en: 'Vietnam (VN)' },
  { code: 'US', name_vi: 'Hoa Kỳ (US)', name_en: 'United States (US)' },
  { code: 'SG', name_vi: 'Singapore (SG)', name_en: 'Singapore (SG)' },
  { code: 'GB', name_vi: 'Vương quốc Anh (GB)', name_en: 'United Kingdom (GB)' },
  { code: 'JP', name_vi: 'Nhật Bản (JP)', name_en: 'Japan (JP)' },
  { code: 'AU', name_vi: 'Úc (AU)', name_en: 'Australia (AU)' },
  { code: 'CA', name_vi: 'Canada (CA)', name_en: 'Canada (CA)' },
  { code: 'DE', name_vi: 'Đức (DE)', name_en: 'Germany (DE)' },
  { code: 'FR', name_vi: 'Pháp (FR)', name_en: 'France (FR)' },
  { code: 'KR', name_vi: 'Hàn Quốc (KR)', name_en: 'South Korea (KR)' },
];

export function StripeDemoCheckoutPage() {
  const { i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';

  const sessionId = searchParams.get('session_id') || '';

  const [details, setDetails] = useState<CheckoutSessionDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selected Payment Method tab: 'card' | 'apple_pay' | 'google_pay'
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>('card');

  // Interactive Apple Pay / Google Pay Wallet Modal state
  const [walletModalMethod, setWalletModalMethod] = useState<'apple_pay' | 'google_pay' | null>(null);
  const [walletSelectedCard, setWalletSelectedCard] = useState<{
    brand: CardBrand;
    last4: string;
    label: string;
  }>({
    brand: 'visa',
    last4: '4242',
    label: 'Visa Signature •••• 4242',
  });

  // Card form state (pre-filled with Stripe official test card 4242 for instant sandbox testing)
  const [cardNumber, setCardNumber] = useState('4242 4242 4242 4242');
  const [expiry, setExpiry] = useState('12/28');
  const [cvc, setCvc] = useState('424');
  const [cardholderName, setCardholderName] = useState('NGUYEN VAN A');
  const [cardBrand, setCardBrand] = useState<CardBrand>('visa');
  const [billingCountry, setBillingCountry] = useState('VN');
  const [billingZip, setBillingZip] = useState('700000');

  // Promo code state (6-character alphanumeric)
  const [promoInput, setPromoInput] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoSuccessMsg, setPromoSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setError(
        lang === 'vi'
          ? 'Thiếu mã phiên thanh toán (session_id).'
          : 'Missing checkout session_id.',
      );
      setLoading(false);
      return;
    }

    let active = true;
    api
      .getCheckoutSessionDetails(sessionId)
      .then((res) => {
        if (!active) return;
        setDetails(res);
        if (res.customer_name) {
          setCardholderName(res.customer_name.toUpperCase());
        }
      })
      .catch((err) => {
        if (!active) return;
        setError(
          err instanceof Error
            ? err.message
            : lang === 'vi'
              ? 'Không tìm thấy phiên thanh toán.'
              : 'Checkout session not found.',
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [sessionId, lang]);

  const handleCardNumberChange = (raw: string) => {
    const formatted = formatCardNumber(raw);
    setCardNumber(formatted);
    const digits = formatted.replace(/\D/g, '');
    if (digits.length >= 1) {
      setCardBrand(detectCardBrand(digits));
    }
  };

  const handleExpiryChange = (raw: string) => {
    setExpiry(formatExpiryInput(raw));
  };

  const handleAutofillTestCard = (brand: CardBrand) => {
    setCardBrand(brand);
    setError(null);
    if (brand === 'visa') {
      setCardNumber('4242 4242 4242 4242');
      setExpiry('12/28');
      setCvc('424');
    } else if (brand === 'mastercard') {
      setCardNumber('5555 5555 5555 4444');
      setExpiry('11/29');
      setCvc('555');
    } else if (brand === 'amex') {
      setCardNumber('3782 8224 6310 005');
      setExpiry('10/29');
      setCvc('1234');
    } else {
      setCardNumber('3530 1113 3330 0000');
      setExpiry('08/29');
      setCvc('353');
    }
  };

  const handleApplyPromoCode = async (codeOverride?: string) => {
    if (!sessionId) return;
    const targetCode = (codeOverride ?? promoInput).trim().toUpperCase();
    if (targetCode.length !== 6 || !/^[A-Z0-9]{6}$/.test(targetCode)) {
      setPromoError(
        lang === 'vi'
          ? 'Mã giảm giá phải gồm đúng 6 ký tự chữ hoặc số (VD: CITRA2).'
          : 'Promo code must be exactly 6 alphanumeric characters (e.g. CITRA2).',
      );
      setPromoSuccessMsg(null);
      return;
    }

    setPromoLoading(true);
    setPromoError(null);
    setPromoSuccessMsg(null);
    try {
      const updated = await api.applyCheckoutSessionPromo(sessionId, targetCode);
      setDetails(updated);
      setPromoInput('');
      setPromoSuccessMsg(
        lang === 'vi'
          ? `Đã áp dụng mã ${updated.promo_code}: Giảm -$${(updated.discount_usd ?? 0).toFixed(2)} USD!`
          : `Applied code ${updated.promo_code}: Saved -$${(updated.discount_usd ?? 0).toFixed(2)} USD!`,
      );
    } catch (err) {
      setPromoError(
        err instanceof Error
          ? err.message
          : lang === 'vi'
            ? 'Mã giảm giá không hợp lệ hoặc đã hết lượt sử dụng.'
            : 'Invalid or expired promo code.',
      );
    } finally {
      setPromoLoading(false);
    }
  };

  const handleRemovePromoCode = async () => {
    if (!sessionId) return;
    setPromoLoading(true);
    setPromoError(null);
    setPromoSuccessMsg(null);
    try {
      const updated = await api.applyCheckoutSessionPromo(sessionId, null);
      setDetails(updated);
    } catch (err) {
      setPromoError(
        err instanceof Error ? err.message : 'Failed to remove promo code.',
      );
    } finally {
      setPromoLoading(false);
    }
  };

  const executePaymentVerification = async (params: {
    method: PaymentMethodType;
    brand: string;
    last4: string;
  }) => {
    if (!sessionId) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.verifyCheckoutSession({
        session_id: sessionId,
        payment_method: params.method,
        card_last4: params.last4,
        card_brand: params.brand,
        billing_country: billingCountry,
        billing_zip: billingZip,
      });
      await refreshUser();
      navigate(`/billing/success?session_id=${encodeURIComponent(sessionId)}`);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : lang === 'vi'
            ? 'Thanh toán thất bại. Vui lòng thử lại.'
            : 'Payment verification failed. Please try again.',
      );
      setSubmitting(false);
      setWalletModalMethod(null);
    }
  };

  const handlePaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId) return;

    const digits = cardNumber.replace(/\D/g, '');
    if (digits === '4000000000000002') {
      setError(
        lang === 'vi'
          ? 'Thẻ của bạn đã bị ngân hàng phát hành từ chối (card_declined). Vui lòng dùng thẻ khác.'
          : 'Your card was declined by the issuing bank (card_declined). Please try another card.',
      );
      return;
    }

    if (digits.length < 13 || digits.length > 19 || !isValidLuhn(digits)) {
      setError(
        lang === 'vi'
          ? 'Số thẻ không hợp lệ (sai chuẩn Luhn). Vui lòng kiểm tra lại hoặc dùng thẻ test 4242 4242 4242 4242.'
          : 'Invalid card number (failed Luhn check). Please check your card or use test card 4242 4242 4242 4242.',
      );
      return;
    }

    if (!isValidExpiry(expiry)) {
      setError(
        lang === 'vi'
          ? 'Ngày hết hạn thẻ (MM/YY) không hợp lệ hoặc thẻ đã hết hạn.'
          : 'Invalid or expired card expiration date (MM/YY).',
      );
      return;
    }

    const cleanCvc = cvc.replace(/\D/g, '');
    if (cleanCvc.length < 3 || cleanCvc.length > 4) {
      setError(
        lang === 'vi'
          ? 'Mã bảo mật CVC/CVV phải gồm 3 hoặc 4 chữ số.'
          : 'Security code (CVC/CVV) must be 3 or 4 digits.',
      );
      return;
    }

    if (cardholderName.trim().length < 2) {
      setError(
        lang === 'vi'
          ? 'Vui lòng nhập đầy đủ họ tên chủ thẻ.'
          : 'Please enter the cardholder full name.',
      );
      return;
    }

    await executePaymentVerification({
      method: 'card',
      brand: cardBrand,
      last4: digits.slice(-4),
    });
  };

  const handleOpenWalletSheet = (method: 'apple_pay' | 'google_pay') => {
    setError(null);
    setWalletModalMethod(method);
  };

  const handleConfirmWalletPayment = async () => {
    if (!walletModalMethod) return;
    await executePaymentVerification({
      method: walletModalMethod,
      brand: walletSelectedCard.brand,
      last4: walletSelectedCard.last4,
    });
  };

  if (loading) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p className="text-sm font-mono text-slate-500">
          {lang === 'vi'
            ? 'Đang kết nối cổng thanh toán bảo mật Stripe...'
            : 'Connecting to Stripe Secure Checkout...'}
        </p>
      </div>
    );
  }

  if (!details) {
    return (
      <div className="max-w-lg mx-auto my-12 p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-4">
        <AlertCircle className="h-10 w-10 text-red-500 mx-auto" />
        <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
          {lang === 'vi' ? 'Phiên thanh toán không hợp lệ' : 'Invalid Checkout Session'}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">{error}</p>
        <Button asChild className="rounded-xl bg-indigo-600 text-white">
          <Link to="/pricing">{lang === 'vi' ? 'Quay lại Bảng giá' : 'Return to Pricing'}</Link>
        </Button>
      </div>
    );
  }

  const features = lang === 'vi' ? details.features_vi : details.features_en;
  const subtotalUsd = details.subtotal_usd ?? details.amount_usd;
  const discountUsd = details.discount_usd ?? 0;

  return (
    <div
      className="max-w-6xl mx-auto rounded-3xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-2xl bg-white dark:bg-slate-900 my-2 sm:my-4"
      data-testid="stripe-demo-checkout-page"
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[640px]">
        {/* ============================================================
            LEFT COLUMN — Stripe Order Summary & 6-Char Promo Code Engine
            ============================================================ */}
        <div className="lg:col-span-5 bg-slate-950 text-white p-5 sm:p-8 flex flex-col justify-between relative overflow-hidden">
          <div className="space-y-6 relative z-10">
            {/* Back link & Test Mode Badge */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Link
                to="/pricing?canceled=1"
                className="inline-flex items-center gap-2 text-xs font-medium text-slate-300 hover:text-white transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="w-[24px] h-[24px] rounded-[6px] bg-white dark:bg-[#1E1C17] border border-[#E7E3D9] dark:border-[#332F26] shadow-2xs flex items-center justify-center p-0.5 shrink-0">
                  <img
                    src="/citra-logo.png"
                    alt="CITRA Logo"
                    width={15}
                    height={15}
                    className="object-contain select-none dark:brightness-150 dark:drop-shadow-[0_0_2px_rgba(255,255,255,0.45)]"
                  />
                </span>
                <span className="font-solva-sans text-sm font-medium tracking-[-0.02em] text-white">
                  {details.merchant_name}
                </span>
              </Link>
              <span className="px-2.5 py-0.5 rounded-md bg-amber-400/20 border border-amber-400/40 text-amber-300 font-mono text-[10px] font-bold uppercase tracking-wider">
                STRIPE SANDBOX
              </span>
            </div>

            {/* Plan Title & Price */}
            <div className="space-y-2 pt-1">
              <p className="text-xs font-mono uppercase tracking-wider text-indigo-300">
                {lang === 'vi'
                  ? `ĐĂNG KÝ GÓI ${details.billing_cycle === 'annual' ? 'THEO NĂM (-20%)' : 'THEO THÁNG'}`
                  : `SUBSCRIBE TO ${details.billing_cycle.toUpperCase()} PLAN`}
              </p>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">
                {details.plan_name}
              </h1>
              <div className="flex items-baseline gap-2.5 pt-1 flex-wrap">
                <span
                  className="font-display text-4xl sm:text-5xl font-bold text-white"
                  data-testid="checkout-amount-display"
                >
                  ${details.amount_usd.toFixed(2)}
                </span>
                {discountUsd > 0 && (
                  <span className="text-lg font-mono text-slate-500 line-through">
                    ${subtotalUsd.toFixed(2)}
                  </span>
                )}
                <span className="text-xs text-slate-400 font-mono">
                  USD /{' '}
                  {details.billing_cycle === 'annual'
                    ? lang === 'vi'
                      ? 'năm'
                      : 'year'
                    : lang === 'vi'
                      ? 'tháng'
                      : 'month'}
                </span>
              </div>
              {details.billing_cycle === 'annual' && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-xs font-mono">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>
                    {lang === 'vi'
                      ? `Chỉ $${details.monthly_equivalent_usd}/tháng · Tiết kiệm $${details.annual_savings_usd}/năm`
                      : `Only $${details.monthly_equivalent_usd}/mo · Save $${details.annual_savings_usd}/yr`}
                  </span>
                </div>
              )}
            </div>

            {/* 6-Character Promo Code Box */}
            <div
              className="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2.5"
              data-testid="checkout-promo-section"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5 text-indigo-400" />
                  {lang === 'vi' ? 'Mã giảm giá (6 ký tự)' : 'Promo Code (6 chars)'}
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  A-Z · 0-9
                </span>
              </div>

              {details.promo_code ? (
                <div
                  className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300"
                  data-testid="checkout-applied-promo-badge"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-emerald-500/25 font-mono text-xs font-bold tracking-wider text-emerald-200">
                        {details.promo_code}
                      </span>
                      <span className="text-xs font-mono font-semibold text-emerald-300">
                        -${discountUsd.toFixed(2)} USD
                      </span>
                    </div>
                    {details.promo_details?.description && (
                      <p className="text-[11px] text-emerald-300/80 truncate mt-0.5">
                        {details.promo_details.description}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    data-testid="checkout-promo-remove-btn"
                    disabled={promoLoading}
                    onClick={handleRemovePromoCode}
                    className="p-1.5 rounded-lg hover:bg-emerald-500/20 text-emerald-300 hover:text-white transition-colors cursor-pointer shrink-0"
                    title={lang === 'vi' ? 'Gỡ mã giảm giá' : 'Remove promo code'}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input
                      value={promoInput}
                      onChange={(e) => {
                        setPromoInput(
                          e.target.value
                            .toUpperCase()
                            .replace(/[^A-Z0-9]/g, '')
                            .slice(0, 6),
                        );
                        setPromoError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleApplyPromoCode();
                        }
                      }}
                      maxLength={6}
                      placeholder={lang === 'vi' ? 'VD: CITRA2' : 'E.G. CITRA2'}
                      data-testid="checkout-promo-input"
                      className="h-9 bg-slate-950 border-slate-700 text-white font-mono text-xs uppercase tracking-widest placeholder:text-slate-600 rounded-xl"
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={promoLoading}
                      data-testid="checkout-promo-apply-btn"
                      onClick={() => void handleApplyPromoCode()}
                      className="h-9 px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shrink-0 cursor-pointer"
                    >
                      {promoLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : lang === 'vi' ? (
                        'Áp dụng'
                      ) : (
                        'Apply'
                      )}
                    </Button>
                  </div>

                  {/* Quick 1-click Demo Promo Chips */}
                  <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                    <span className="text-[10px] font-mono text-slate-400">
                      {lang === 'vi' ? 'Thử nhanh:' : 'Try:'}
                    </span>
                    {[
                      { code: 'CITRA2', label: '-20%' },
                      { code: 'TDTU50', label: '-50% Pro' },
                      { code: 'SAVE10', label: '-$10' },
                    ].map((chip) => (
                      <button
                        key={chip.code}
                        type="button"
                        data-testid={`quick-promo-${chip.code}`}
                        onClick={() => {
                          setPromoInput(chip.code);
                          void handleApplyPromoCode(chip.code);
                        }}
                        className="px-2 py-0.5 rounded-md bg-slate-800/90 hover:bg-indigo-950 border border-slate-700 hover:border-indigo-500/50 text-[10px] font-mono text-slate-300 hover:text-indigo-200 transition-colors cursor-pointer"
                      >
                        {chip.code} ({chip.label})
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {promoError && (
                <p
                  className="text-[11px] text-red-400 flex items-center gap-1.5 pt-0.5"
                  data-testid="checkout-promo-error"
                >
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>{promoError}</span>
                </p>
              )}

              {promoSuccessMsg && !promoError && (
                <p
                  className="text-[11px] text-emerald-400 flex items-center gap-1.5 pt-0.5"
                  data-testid="checkout-promo-success"
                >
                  <Check className="h-3.5 w-3.5 shrink-0" />
                  <span>{promoSuccessMsg}</span>
                </p>
              )}
            </div>

            {/* Line Items Summary */}
            <div className="space-y-2.5 pt-3 border-t border-slate-800 text-xs">
              <div className="flex items-center justify-between text-slate-300">
                <span>
                  {details.plan_name} (
                  {details.billing_cycle === 'annual' ? 'Annual' : 'Monthly'})
                </span>
                <span className="font-mono" data-testid="checkout-subtotal-display">
                  ${subtotalUsd.toFixed(2)}
                </span>
              </div>
              {details.annual_savings_usd > 0 && (
                <div className="flex items-center justify-between text-emerald-400">
                  <span>
                    {lang === 'vi'
                      ? 'Ưu đãi chu kỳ năm (-20%)'
                      : 'Annual Billing Discount (20%)'}
                  </span>
                  <span className="font-mono">
                    Included (-${details.annual_savings_usd}.00)
                  </span>
                </div>
              )}
              {discountUsd > 0 && (
                <div
                  className="flex items-center justify-between text-emerald-400 font-medium"
                  data-testid="checkout-discount-row"
                >
                  <span>
                    {lang === 'vi' ? 'Mã giảm giá' : 'Promo Code'} (
                    {details.promo_code})
                  </span>
                  <span className="font-mono">-${discountUsd.toFixed(2)}</span>
                </div>
              )}
              <div className="flex items-center justify-between pt-3 border-t border-slate-800 text-sm font-bold text-white">
                <span>
                  {lang === 'vi' ? 'Tổng thanh toán hôm nay' : 'Total due today'}
                </span>
                <span className="font-mono" data-testid="checkout-total-due-display">
                  ${details.amount_usd.toFixed(2)} USD
                </span>
              </div>
            </div>

            {/* Included Highlights */}
            <div className="space-y-2 pt-1">
              <p className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                {lang === 'vi'
                  ? 'Quyền lợi kích hoạt ngay:'
                  : 'Instant activation includes:'}
              </p>
              <ul className="space-y-1.5 text-xs text-slate-300">
                {features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="pt-6 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400 relative z-10 flex-wrap gap-2">
            <span className="flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-emerald-400" />
              Powered by <strong className="text-white">Stripe</strong>
            </span>
            <span className="font-mono text-[10px]">
              PCI-DSS Level 1 · 256-bit TLS
            </span>
          </div>
        </div>

        {/* ============================================================
            RIGHT COLUMN — Express Wallets (Apple/Google Pay) + Card Form
            ============================================================ */}
        <div className="lg:col-span-7 p-5 sm:p-8 lg:p-10 flex flex-col justify-center">
          <div className="max-w-lg mx-auto w-full space-y-5">
            {/* Header */}
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
                  {lang === 'vi'
                    ? 'Phương thức thanh toán'
                    : 'Payment Method'}
                </h2>
                <div className="flex items-center gap-1">
                  <VisaLogo active={cardBrand === 'visa'} />
                  <MastercardLogo active={cardBrand === 'mastercard'} />
                  <AmexLogo active={cardBrand === 'amex'} />
                  <JcbLogo active={cardBrand === 'jcb'} />
                </div>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {lang === 'vi'
                  ? `Tài khoản nhận gói: ${details.customer_email}`
                  : `Subscribing account: ${details.customer_email}`}
              </p>
            </div>

            {/* Express Checkout Buttons (Apple Pay & Google Pay) */}
            <div
              className="space-y-2"
              data-testid="express-checkout-section"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                  {lang === 'vi'
                    ? 'Thanh toán nhanh 1 chạm (Express)'
                    : 'Express One-Click Wallets'}
                </span>
                <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400">
                  Biometric Tokenized
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Apple Pay Button */}
                <button
                  type="button"
                  data-testid="express-apple-pay-btn"
                  disabled={submitting}
                  onClick={() => handleOpenWalletSheet('apple_pay')}
                  className="h-11 rounded-xl bg-black hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-black font-semibold text-sm flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer active:scale-[0.99]"
                >
                  <AppleLogoSvg className="w-4 h-4 -mt-0.5" />
                  <span className="tracking-tight font-sans font-semibold">
                    Apple Pay
                  </span>
                </button>

                {/* Google Pay Button */}
                <button
                  type="button"
                  data-testid="express-google-pay-btn"
                  disabled={submitting}
                  onClick={() => handleOpenWalletSheet('google_pay')}
                  className="h-11 rounded-xl bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-900 dark:text-white border-2 border-slate-200 dark:border-slate-700 font-semibold text-sm flex items-center justify-center gap-2 shadow-2xs transition-all cursor-pointer active:scale-[0.99]"
                >
                  <GooglePaySvg className="w-4 h-4" />
                  <span className="tracking-tight font-sans font-semibold">
                    Google Pay
                  </span>
                </button>
              </div>
            </div>

            {/* Divider */}
            <div className="relative flex items-center py-0.5">
              <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
              <span className="flex-shrink mx-3 text-[11px] font-mono uppercase text-slate-400">
                {lang === 'vi'
                  ? 'Hoặc thanh toán bằng thẻ'
                  : 'Or pay with card'}
              </span>
              <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
            </div>

            {/* Payment Method Tabs */}
            <div
              className="grid grid-cols-3 gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-800"
              role="tablist"
            >
              <button
                type="button"
                role="tab"
                aria-selected={paymentMethod === 'card'}
                data-testid="method-tab-card"
                onClick={() => setPaymentMethod('card')}
                className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  paymentMethod === 'card'
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <CreditCard className="h-3.5 w-3.5" />
                <span>{lang === 'vi' ? 'Thẻ Quốc Tế' : 'Card'}</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={paymentMethod === 'apple_pay'}
                data-testid="method-tab-apple-pay"
                onClick={() => setPaymentMethod('apple_pay')}
                className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  paymentMethod === 'apple_pay'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <AppleLogoSvg className="w-3.5 h-3.5" />
                <span>Apple Pay</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={paymentMethod === 'google_pay'}
                data-testid="method-tab-google-pay"
                onClick={() => setPaymentMethod('google_pay')}
                className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  paymentMethod === 'google_pay'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <GooglePaySvg className="w-3.5 h-3.5" />
                <span>Google Pay</span>
              </button>
            </div>

            {error && (
              <div
                className="p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300 flex items-center gap-2"
                data-testid="checkout-error-banner"
              >
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {paymentMethod === 'card' ? (
              <form onSubmit={handlePaySubmit} className="space-y-4">
                {/* Quick Autofill Stripe Test Card Banner */}
                <div className="p-3 rounded-2xl bg-indigo-50/90 dark:bg-indigo-950/50 border border-indigo-200/80 dark:border-indigo-800/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5">
                      <CreditCard className="h-3.5 w-3.5 text-indigo-600" />
                      {lang === 'vi'
                        ? 'Thẻ Test Stripe Demo (1-Click):'
                        : 'Stripe Demo Test Cards (1-Click):'}
                    </span>
                    <Badge variant="secondary" className="text-[10px] font-mono">
                      SANDBOX
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      data-testid="autofill-visa-btn"
                      onClick={() => handleAutofillTestCard('visa')}
                      className={`py-1.5 px-2.5 rounded-xl text-xs font-mono font-semibold border transition-all cursor-pointer ${
                        cardBrand === 'visa'
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      Visa •••• 4242
                    </button>
                    <button
                      type="button"
                      data-testid="autofill-mastercard-btn"
                      onClick={() => handleAutofillTestCard('mastercard')}
                      className={`py-1.5 px-2.5 rounded-xl text-xs font-mono font-semibold border transition-all cursor-pointer ${
                        cardBrand === 'mastercard'
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      MC •••• 4444
                    </button>
                    <button
                      type="button"
                      data-testid="autofill-amex-btn"
                      onClick={() => handleAutofillTestCard('amex')}
                      className={`py-1.5 px-2.5 rounded-xl text-xs font-mono font-semibold border transition-all cursor-pointer ${
                        cardBrand === 'amex'
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      Amex •••• 0005
                    </button>
                  </div>
                </div>

                {/* Card Number with Network Detection Badge */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="card-number" className="text-xs font-semibold">
                      {lang === 'vi'
                        ? 'Số thẻ tín dụng / ghi nợ quốc tế'
                        : 'Card number (VISA / Mastercard / Amex / JCB)'}
                    </Label>
                    <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400">
                      {isValidLuhn(cardNumber.replace(/\D/g, ''))
                        ? '✓ Luhn Verified'
                        : ''}
                    </span>
                  </div>
                  <div className="relative">
                    <Input
                      id="card-number"
                      data-testid="stripe-card-number-input"
                      value={cardNumber}
                      onChange={(e) => handleCardNumberChange(e.target.value)}
                      placeholder="4242 4242 4242 4242"
                      autoComplete="cc-number"
                      inputMode="numeric"
                      className="font-mono text-sm h-11 rounded-xl pr-24"
                      required
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
                      {cardBrand === 'visa' && <VisaLogo active />}
                      {cardBrand === 'mastercard' && <MastercardLogo active />}
                      {cardBrand === 'amex' && <AmexLogo active />}
                      {cardBrand === 'jcb' && <JcbLogo active />}
                    </div>
                  </div>
                </div>

                {/* Expiry & CVC */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="card-expiry" className="text-xs font-semibold">
                      {lang === 'vi'
                        ? 'Ngày hết hạn (MM/YY)'
                        : 'Expiration (MM/YY)'}
                    </Label>
                    <Input
                      id="card-expiry"
                      data-testid="stripe-expiry-input"
                      value={expiry}
                      onChange={(e) => handleExpiryChange(e.target.value)}
                      placeholder="12/28"
                      autoComplete="cc-exp"
                      inputMode="numeric"
                      maxLength={5}
                      className="font-mono text-sm h-11 rounded-xl"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="card-cvc" className="text-xs font-semibold">
                      CVC / CVV
                    </Label>
                    <Input
                      id="card-cvc"
                      data-testid="stripe-cvc-input"
                      value={cvc}
                      onChange={(e) =>
                        setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))
                      }
                      placeholder="424"
                      autoComplete="cc-csc"
                      inputMode="numeric"
                      maxLength={4}
                      className="font-mono text-sm h-11 rounded-xl"
                      required
                    />
                  </div>
                </div>

                {/* Cardholder Name */}
                <div className="space-y-1.5">
                  <Label
                    htmlFor="cardholder-name"
                    className="text-xs font-semibold"
                  >
                    {lang === 'vi'
                      ? 'Họ và tên chủ thẻ (in trên thẻ)'
                      : 'Cardholder name'}
                  </Label>
                  <Input
                    id="cardholder-name"
                    data-testid="stripe-cardholder-input"
                    value={cardholderName}
                    onChange={(e) =>
                      setCardholderName(e.target.value.toUpperCase())
                    }
                    placeholder="FULL NAME ON CARD"
                    autoComplete="cc-name"
                    className="text-sm h-11 rounded-xl uppercase"
                    required
                  />
                </div>

                {/* Billing Country & Postal Code (Stripe Address Element) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="billing-country"
                      className="text-xs font-semibold flex items-center gap-1"
                    >
                      <Globe className="h-3 w-3 text-slate-400" />
                      {lang === 'vi'
                        ? 'Quốc gia thanh toán'
                        : 'Billing country'}
                    </Label>
                    <select
                      id="billing-country"
                      data-testid="stripe-billing-country-select"
                      value={billingCountry}
                      onChange={(e) => setBillingCountry(e.target.value)}
                      className="w-full h-11 px-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {BILLING_COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {lang === 'vi' ? c.name_vi : c.name_en}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="billing-zip"
                      className="text-xs font-semibold"
                    >
                      {lang === 'vi'
                        ? 'Mã bưu chính (ZIP / Postal)'
                        : 'Postal / ZIP code'}
                    </Label>
                    <Input
                      id="billing-zip"
                      data-testid="stripe-billing-zip-input"
                      value={billingZip}
                      onChange={(e) => setBillingZip(e.target.value.slice(0, 12))}
                      placeholder="700000"
                      autoComplete="postal-code"
                      className="font-mono text-sm h-11 rounded-xl"
                      required
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={submitting}
                  data-testid="stripe-pay-submit-btn"
                  className="w-full h-12 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm shadow-lg cursor-pointer"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      {lang === 'vi'
                        ? 'Đang mã hóa & xử lý giao dịch Stripe...'
                        : 'Tokenizing & Processing Stripe Payment...'}
                    </>
                  ) : (
                    <>
                      <Lock className="h-4 w-4 mr-2" />
                      {lang === 'vi'
                        ? `Thanh toán $${details.amount_usd.toFixed(2)} & Kích hoạt ${details.plan_name}`
                        : `Pay $${details.amount_usd.toFixed(2)} & Activate ${details.plan_name}`}
                    </>
                  )}
                </Button>
              </form>
            ) : (
              /* Dedicated Apple Pay / Google Pay Tab Panel */
              <div
                className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-center space-y-4"
                data-testid="wallet-tab-panel"
              >
                <div className="w-12 h-12 rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 flex items-center justify-center mx-auto shadow-md">
                  {paymentMethod === 'apple_pay' ? (
                    <AppleLogoSvg className="w-6 h-6" />
                  ) : (
                    <GooglePaySvg className="w-6 h-6" />
                  )}
                </div>
                <div className="space-y-1">
                  <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                    {paymentMethod === 'apple_pay'
                      ? lang === 'vi'
                        ? 'Thanh toán qua Apple Pay (Touch ID / Face ID)'
                        : 'Pay with Apple Pay (Touch ID / Face ID)'
                      : lang === 'vi'
                        ? 'Thanh toán nhanh với Google Pay'
                        : 'Fast Checkout with Google Pay'}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                    {lang === 'vi'
                      ? 'Thông tin thẻ của bạn được mã hóa bằng Token thiết bị chuẩn EMVCo, không chia sẻ số thẻ thật với hệ thống.'
                      : 'Your card details are tokenized via EMVCo device credentials and never shared directly with merchants.'}
                  </p>
                </div>

                <Button
                  type="button"
                  disabled={submitting}
                  data-testid="wallet-tab-launch-btn"
                  onClick={() =>
                    handleOpenWalletSheet(
                      paymentMethod === 'apple_pay' ? 'apple_pay' : 'google_pay',
                    )
                  }
                  className="w-full h-12 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 font-semibold text-sm shadow-lg cursor-pointer"
                >
                  {paymentMethod === 'apple_pay' ? (
                    <>
                      <AppleLogoSvg className="w-4 h-4 mr-2" />
                      {lang === 'vi'
                        ? `Mở Apple Pay · $${details.amount_usd.toFixed(2)} USD`
                        : `Continue with Apple Pay · $${details.amount_usd.toFixed(2)} USD`}
                    </>
                  ) : (
                    <>
                      <GooglePaySvg className="w-4 h-4 mr-2" />
                      {lang === 'vi'
                        ? `Mở Google Pay · $${details.amount_usd.toFixed(2)} USD`
                        : `Continue with Google Pay · $${details.amount_usd.toFixed(2)} USD`}
                    </>
                  )}
                </Button>
              </div>
            )}

            <p className="text-[11px] text-center text-slate-500 flex items-center justify-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              {lang === 'vi'
                ? 'Chuẩn bảo mật PCI-DSS: Không lưu số thẻ/CVV. Nâng cấp tài khoản tức thì.'
                : 'PCI-DSS Compliant: Raw card/CVV never stored. Instant plan upgrade.'}
            </p>
          </div>
        </div>
      </div>

      {/* ============================================================
          APPLE PAY / GOOGLE PAY INTERACTIVE BIOMETRIC WALLET SHEET MODAL
          Rendered via createPortal to document.body so it sits above
          all AppLayout headers/footers on mobile & desktop viewports.
          ============================================================ */}
      {walletModalMethod &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] bg-black/65 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
            data-testid="wallet-payment-modal"
            onClick={(e) => {
              if (e.target === e.currentTarget && !submitting) {
                setWalletModalMethod(null);
              }
            }}
          >
            <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-5 sm:p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] space-y-4 sm:space-y-5">
              {/* Mobile Drag Handle Pill */}
              <div className="sm:hidden w-10 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 mx-auto -mt-1 mb-1" />

              {/* Modal Header */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 flex items-center justify-center">
                    {walletModalMethod === 'apple_pay' ? (
                      <AppleLogoSvg className="w-5 h-5" />
                    ) : (
                      <GooglePaySvg className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                      {walletModalMethod === 'apple_pay'
                        ? 'Apple Pay'
                        : 'Google Pay'}
                    </h3>
                    <p className="text-[11px] font-mono text-slate-500">
                      Stripe Express Tokenization (Mock)
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="wallet-modal-close-btn"
                  onClick={() => setWalletModalMethod(null)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Simulated Wallet Card Selector */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  {lang === 'vi' ? 'Thẻ liên kết trong ví:' : 'Wallet Payment Card:'}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    {
                      brand: 'visa' as CardBrand,
                      last4: '4242',
                      label: 'Visa Signature •••• 4242',
                    },
                    {
                      brand: 'mastercard' as CardBrand,
                      last4: '4444',
                      label: 'Mastercard World •••• 4444',
                    },
                  ].map((c) => {
                    const selected = walletSelectedCard.last4 === c.last4;
                    return (
                      <button
                        key={c.last4}
                        type="button"
                        data-testid={`wallet-card-${c.brand}`}
                        onClick={() => setWalletSelectedCard(c)}
                        className={`p-2.5 rounded-xl border text-left text-xs font-mono transition-all cursor-pointer ${
                          selected
                            ? 'border-indigo-600 bg-indigo-50/80 dark:bg-indigo-950/60 text-indigo-900 dark:text-indigo-200 font-bold'
                            : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          {c.brand === 'visa' ? (
                            <VisaLogo active={selected} />
                          ) : (
                            <MastercardLogo active={selected} />
                          )}
                          {selected && (
                            <Check className="h-3.5 w-3.5 text-indigo-600" />
                          )}
                        </div>
                        <span className="block truncate">•••• {c.last4}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Summary */}
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">
                    {lang === 'vi' ? 'Đơn vị nhận:' : 'Pay to:'}
                  </span>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {details.merchant_name}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">
                    {lang === 'vi' ? 'Gói đăng ký:' : 'Subscription:'}
                  </span>
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    {details.plan_name} ({details.billing_cycle})
                  </span>
                </div>
                {details.promo_code && discountUsd > 0 && (
                  <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
                    <span>Promo ({details.promo_code}):</span>
                    <span className="font-mono">-${discountUsd.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-white">
                  <span>{lang === 'vi' ? 'Tổng cộng:' : 'Total:'}</span>
                  <span className="font-mono">
                    ${details.amount_usd.toFixed(2)} USD
                  </span>
                </div>
              </div>

              {/* Biometric Confirmation */}
              <div className="flex flex-col items-center gap-3 pt-1">
                <div className="w-11 h-11 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  {walletModalMethod === 'apple_pay' ? (
                    <Fingerprint className="w-5 h-5" />
                  ) : (
                    <Smartphone className="w-5 h-5" />
                  )}
                </div>
                <Button
                  type="button"
                  disabled={submitting}
                  data-testid="wallet-confirm-pay-btn"
                  onClick={handleConfirmWalletPayment}
                  className="w-full h-12 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm shadow-lg cursor-pointer"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      {lang === 'vi'
                        ? 'Đang xác thực sinh trắc học...'
                        : 'Verifying Biometric Token...'}
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      {lang === 'vi'
                        ? `Xác nhận thanh toán $${details.amount_usd.toFixed(2)}`
                        : `Confirm & Pay $${details.amount_usd.toFixed(2)}`}
                    </>
                  )}
                </Button>
                <button
                  type="button"
                  data-testid="wallet-cancel-btn"
                  disabled={submitting}
                  onClick={() => setWalletModalMethod(null)}
                  className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 py-1 cursor-pointer"
                >
                  {lang === 'vi' ? 'Hủy giao dịch' : 'Cancel'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
