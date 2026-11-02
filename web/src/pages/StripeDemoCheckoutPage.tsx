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
  QrCode,
  Building2,
  KeyRound,
  ExternalLink,
  Copy,
} from 'lucide-react';
import {
  api,
  type CheckoutSessionDetails,
  type PaymentMethodType,
  type VNPayPaymentUrlResponse,
} from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useModalA11y } from '@/hooks/useModalA11y';
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

function VNPayLogo({ active = true }: { active?: boolean }) {
  return (
    <span
      className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded-md border text-[9px] font-black tracking-tight select-none transition-all ${
        active
          ? 'bg-white dark:bg-slate-900 border-[#005BAA]/40 shadow-2xs'
          : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 opacity-65'
      }`}
      title="VNPAY Payment Gateway"
    >
      <span className="text-[#ED1C24] font-black">VN</span>
      <span className="text-[#005BAA] dark:text-[#3898FF] font-black">PAY</span>
    </span>
  );
}

/** Format integer VND amount with dot thousands separator (e.g. 500.000 ₫) */
export function formatVnd(amountVnd: number): string {
  const rounded = Math.round(amountVnd || 0);
  return `${rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ₫`;
}

const VNPAY_BANKS_UI = [
  { code: 'NCB', short: 'NCB', name_vi: 'NH Quốc Dân (NCB Sandbox)', name_en: 'NCB Bank (Official Sandbox)' },
  { code: 'VIETCOMBANK', short: 'VCB', name_vi: 'Vietcombank', name_en: 'Vietcombank' },
  { code: 'TECHCOMBANK', short: 'TCB', name_vi: 'Techcombank', name_en: 'Techcombank' },
  { code: 'BIDV', short: 'BIDV', name_vi: 'BIDV', name_en: 'BIDV' },
  { code: 'VIETINBANK', short: 'CTG', name_vi: 'VietinBank', name_en: 'VietinBank' },
  { code: 'MBBANK', short: 'MB', name_vi: 'MB Bank', name_en: 'MB Bank' },
  { code: 'ACB', short: 'ACB', name_vi: 'ACB', name_en: 'ACB' },
  { code: 'VPBANK', short: 'VPB', name_vi: 'VPBank', name_en: 'VPBank' },
];

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

  // Selected Payment Method tab: 'card' | 'vnpay' | 'apple_pay' | 'google_pay'
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

  // VNPay Payment Gateway state (vnpay.js.org / sandbox.vnpayment.vn v2.1.0)
  const [vnpayChannel, setVnpayChannel] = useState<'atm' | 'qr' | 'intcard'>('atm');
  const [vnpayBankCode, setVnpayBankCode] = useState<string>('NCB');
  const [vnpayGatewayData, setVnpayGatewayData] = useState<VNPayPaymentUrlResponse | null>(null);
  const [vnpayModalOpen, setVnpayModalOpen] = useState(false);
  // Accessible dialog semantics (Escape, focus trap/restore) for the custom
  // VNPay gateway + wallet sheets. Escape is ignored while a payment submits.
  const vnpayDialog = useModalA11y<HTMLDivElement>(vnpayModalOpen, () => setVnpayModalOpen(false), {
    disableEscape: submitting,
  });
  const walletDialog = useModalA11y<HTMLDivElement>(
    walletModalMethod !== null,
    () => setWalletModalMethod(null),
    { disableEscape: submitting },
  );
  const [vnpayModalTab, setVnpayModalTab] = useState<'atm' | 'qr'>('atm');
  const [vnpayCardNumber, setVnpayCardNumber] = useState('9704198526191432198');
  const [vnpayCardHolder, setVnpayCardHolder] = useState('NGUYEN VAN A');
  const [vnpayIssueDate, setVnpayIssueDate] = useState('07/15');
  const [vnpayOtpCode, setVnpayOtpCode] = useState('123456');
  const [vnpayModalError, setVnpayModalError] = useState<string | null>(null);
  const [vnpayShowSignedUrl, setVnpayShowSignedUrl] = useState(false);
  const [vnpayCopiedUrl, setVnpayCopiedUrl] = useState(false);

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

  // Luxury Post-Payment Loading & "Welcome to Plan" Celebration Overlay State
  const [celebrationStage, setCelebrationStage] = useState<
    null | 'verifying' | 'provisioning' | 'welcome'
  >(null);
  const [celebrationGateway, setCelebrationGateway] = useState<
    'stripe' | 'vnpay' | 'apple_pay' | 'google_pay'
  >('stripe');

  const runPostPaymentCelebration = async (
    gateway: 'stripe' | 'vnpay' | 'apple_pay' | 'google_pay',
    targetUrl: string,
  ) => {
    const isTestEnv =
      typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test';
    const stepMs = isTestEnv ? 12 : 620;

    setCelebrationGateway(gateway);
    setCelebrationStage('verifying');
    await new Promise((resolve) => setTimeout(resolve, stepMs));
    setCelebrationStage('provisioning');
    await new Promise((resolve) => setTimeout(resolve, stepMs));
    setCelebrationStage('welcome');
    await new Promise((resolve) => setTimeout(resolve, isTestEnv ? 12 : 950));
    navigate(targetUrl);
  };

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
      setWalletModalMethod(null);
      await runPostPaymentCelebration(
        params.method === 'apple_pay'
          ? 'apple_pay'
          : params.method === 'google_pay'
            ? 'google_pay'
            : 'stripe',
        `/billing/success?session_id=${encodeURIComponent(sessionId)}`,
      );
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

  const handleLaunchVNPayGateway = async (
    overrideBankCode?: string,
    overrideChannel?: 'atm' | 'qr' | 'intcard',
  ) => {
    if (!sessionId) return;
    setError(null);
    setVnpayModalError(null);
    setSubmitting(true);

    const activeChannel = overrideChannel ?? vnpayChannel;
    const effectiveBankCode =
      overrideBankCode ??
      (activeChannel === 'qr'
        ? 'VNPAYQR'
        : activeChannel === 'intcard'
          ? 'INTCARD'
          : vnpayBankCode || 'NCB');

    try {
      const res = await api.createVNPayPaymentUrl({
        session_id: sessionId,
        bank_code: effectiveBankCode,
        locale: lang === 'vi' ? 'vn' : 'en',
        return_url: `${window.location.origin}/billing/success?session_id=${encodeURIComponent(sessionId)}`,
      });
      setVnpayGatewayData(res);
      setVnpayModalTab(activeChannel === 'qr' ? 'qr' : 'atm');
      if (res.external_redirect && res.payment_url) {
        window.location.href = res.payment_url;
        return;
      }
      setVnpayModalOpen(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : lang === 'vi'
            ? 'Không thể khởi tạo URL thanh toán VNPay.'
            : 'Failed to create VNPay payment URL.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleAutofillVNPayTestCard = (scenario: '00' | '51' | '12') => {
    setVnpayModalError(null);
    setVnpayBankCode('NCB');
    setVnpayCardHolder('NGUYEN VAN A');
    setVnpayIssueDate('07/15');
    setVnpayOtpCode('123456');
    if (scenario === '00') {
      setVnpayCardNumber('9704198526191432198');
    } else if (scenario === '51') {
      setVnpayCardNumber('9704195798621412');
    } else {
      setVnpayCardNumber('9704193360968149');
    }
  };

  const handleConfirmVNPayAuthorize = async () => {
    if (!sessionId) return;
    setVnpayModalError(null);
    setSubmitting(true);

    try {
      const res = await api.authorizeVNPaySandbox({
        session_id: sessionId,
        bank_code: vnpayModalTab === 'qr' ? 'VNPAYQR' : vnpayBankCode || 'NCB',
        payment_channel: vnpayModalTab === 'qr' ? 'qr' : vnpayChannel,
        card_number: vnpayCardNumber,
        card_holder: vnpayCardHolder,
        issue_date: vnpayIssueDate,
        otp_code: vnpayOtpCode,
      });

      if (!res.is_success) {
        const msg = lang === 'vi' ? res.message_vi : res.message_en;
        setVnpayModalError(
          `[vnp_ResponseCode: ${res.vnp_response_code}] ${msg}`,
        );
        setSubmitting(false);
        return;
      }

      await refreshUser();
      setVnpayModalOpen(false);
      await runPostPaymentCelebration(
        'vnpay',
        res.return_url || `/billing/success?session_id=${encodeURIComponent(sessionId)}`,
      );
    } catch (err) {
      setVnpayModalError(
        err instanceof Error
          ? err.message
          : lang === 'vi'
            ? 'Xác thực giao dịch VNPay thất bại.'
            : 'VNPay transaction authorization failed.',
      );
      setSubmitting(false);
    }
  };

  const handleCopySignedUrl = () => {
    if (!vnpayGatewayData?.payment_url) return;
    void navigator.clipboard?.writeText(vnpayGatewayData.payment_url);
    setVnpayCopiedUrl(true);
    setTimeout(() => setVnpayCopiedUrl(false), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p className="text-sm font-mono text-slate-500">
          {lang === 'vi'
            ? 'Đang kết nối cổng thanh toán bảo mật Stripe & VNPay...'
            : 'Connecting to Secure Checkout (Stripe & VNPay)...'}
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
  const usdToVndRate = details.usd_to_vnd_rate ?? details.vnpay?.usd_to_vnd_rate ?? 25000;
  const amountVnd = details.amount_vnd ?? Math.round(details.amount_usd * usdToVndRate);
  const discountVnd = details.discount_vnd ?? Math.round(discountUsd * usdToVndRate);

  return (
    <div
      className="max-w-6xl mx-auto rounded-3xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-2xl bg-white dark:bg-slate-900 my-2 sm:my-4"
      data-testid="stripe-demo-checkout-page"
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[640px]">
        {/* ============================================================
            LEFT COLUMN — Stripe & VNPay Order Summary & 6-Char Promo Code
            ============================================================ */}
        <div
          className="lg:col-span-5 bg-[#F4F2EC]/90 dark:bg-slate-950 text-slate-900 dark:text-white border-b lg:border-b-0 lg:border-r border-[#E7E3D9] dark:border-slate-800 p-5 sm:p-8 flex flex-col justify-between relative overflow-hidden transition-colors"
          data-testid="checkout-order-summary-panel"
        >
          <div className="space-y-6 relative z-10">
            {/* Back link & Test Mode Badge */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Link
                to="/pricing?canceled=1"
                className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white transition-colors"
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
                <span className="font-solva-sans text-sm font-medium tracking-[-0.02em] text-slate-900 dark:text-white">
                  {details.merchant_name}
                </span>
              </Link>
              <span className="px-2.5 py-0.5 rounded-md bg-amber-100/90 dark:bg-amber-400/20 border border-amber-300/90 dark:border-amber-400/40 text-amber-800 dark:text-amber-300 font-mono text-[10px] font-bold uppercase tracking-wider">
                STRIPE · VNPAY SANDBOX
              </span>
            </div>

            {/* Plan Title & Price */}
            <div className="space-y-2 pt-1">
              <p className="text-xs font-mono uppercase tracking-wider font-semibold text-indigo-600 dark:text-indigo-300">
                {lang === 'vi'
                  ? `ĐĂNG KÝ GÓI ${details.billing_cycle === 'annual' ? 'THEO NĂM (-20%)' : 'THEO THÁNG'}`
                  : `SUBSCRIBE TO ${details.billing_cycle.toUpperCase()} PLAN`}
              </p>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
                {details.plan_name}
              </h1>
              <div className="flex items-baseline gap-2.5 pt-1 flex-wrap">
                <span
                  className="font-display text-4xl sm:text-5xl font-bold text-slate-900 dark:text-white"
                  data-testid="checkout-amount-display"
                >
                  ${details.amount_usd.toFixed(2)}
                </span>
                {discountUsd > 0 && (
                  <span className="text-lg font-mono text-slate-400 dark:text-slate-500 line-through">
                    ${subtotalUsd.toFixed(2)}
                  </span>
                )}
                <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
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
              <div
                className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-sky-50 dark:bg-sky-500/15 border border-sky-200/90 dark:border-sky-400/30 text-[#005BAA] dark:text-sky-200 text-xs font-mono font-medium"
                data-testid="checkout-vnd-amount-display"
              >
                <VNPayLogo active />
                <span>
                  ≈ {formatVnd(amountVnd)} VND
                </span>
                <span className="text-[10px] text-sky-700/75 dark:text-sky-300/70">
                  (1 USD = {formatVnd(usdToVndRate)})
                </span>
              </div>
              {details.billing_cycle === 'annual' && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-500/20 border border-emerald-200/90 dark:border-emerald-400/30 text-emerald-700 dark:text-emerald-300 text-xs font-mono font-medium">
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
              className="p-3.5 rounded-2xl bg-white/95 dark:bg-slate-900/90 border border-[#E7E3D9] dark:border-slate-800 shadow-2xs space-y-2.5"
              data-testid="checkout-promo-section"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                  {lang === 'vi' ? 'Mã giảm giá (6 ký tự)' : 'Promo Code (6 chars)'}
                </span>
                <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                  A-Z · 0-9
                </span>
              </div>

              {details.promo_code ? (
                <div
                  className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300"
                  data-testid="checkout-applied-promo-badge"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-emerald-600 text-white dark:bg-emerald-500/25 font-mono text-xs font-bold tracking-wider dark:text-emerald-200">
                        {details.promo_code}
                      </span>
                      <span className="text-xs font-mono font-semibold text-emerald-700 dark:text-emerald-300">
                        -${discountUsd.toFixed(2)} USD
                      </span>
                    </div>
                    {details.promo_details?.description && (
                      <p className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80 truncate mt-0.5">
                        {details.promo_details.description}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    data-testid="checkout-promo-remove-btn"
                    disabled={promoLoading}
                    onClick={handleRemovePromoCode}
                    className="p-1.5 rounded-lg hover:bg-emerald-200/60 dark:hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 hover:text-emerald-950 dark:hover:text-white transition-colors cursor-pointer shrink-0"
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
                      className="h-9 bg-[#FBFAF6] dark:bg-slate-950 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white font-mono text-xs uppercase tracking-widest placeholder:text-slate-400 dark:placeholder:text-slate-600 rounded-xl"
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
                    <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
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
                        className="px-2 py-0.5 rounded-md bg-[#F4F2EC] hover:bg-indigo-50 dark:bg-slate-800/90 dark:hover:bg-indigo-950 border border-slate-300/90 hover:border-indigo-400 dark:border-slate-700 dark:hover:border-indigo-500/50 text-[10px] font-mono text-slate-700 hover:text-indigo-700 dark:text-slate-300 dark:hover:text-indigo-200 transition-colors cursor-pointer"
                      >
                        {chip.code} ({chip.label})
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {promoError && (
                <p
                  className="text-[11px] text-red-600 dark:text-red-400 flex items-center gap-1.5 pt-0.5"
                  data-testid="checkout-promo-error"
                >
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>{promoError}</span>
                </p>
              )}

              {promoSuccessMsg && !promoError && (
                <p
                  className="text-[11px] text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 pt-0.5"
                  data-testid="checkout-promo-success"
                >
                  <Check className="h-3.5 w-3.5 shrink-0" />
                  <span>{promoSuccessMsg}</span>
                </p>
              )}
            </div>

            {/* Line Items Summary */}
            <div className="space-y-2.5 pt-3 border-t border-[#E7E3D9] dark:border-slate-800 text-xs">
              <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                <span>
                  {details.plan_name} (
                  {details.billing_cycle === 'annual' ? 'Annual' : 'Monthly'})
                </span>
                <span className="font-mono font-medium text-slate-900 dark:text-slate-200" data-testid="checkout-subtotal-display">
                  ${subtotalUsd.toFixed(2)}
                </span>
              </div>
              {details.annual_savings_usd > 0 && (
                <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-400 font-medium">
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
                  className="flex items-center justify-between text-emerald-700 dark:text-emerald-400 font-medium"
                  data-testid="checkout-discount-row"
                >
                  <span>
                    {lang === 'vi' ? 'Mã giảm giá' : 'Promo Code'} (
                    {details.promo_code})
                  </span>
                  <span className="font-mono">-${discountUsd.toFixed(2)}</span>
                </div>
              )}
              <div className="flex items-center justify-between pt-3 border-t border-[#E7E3D9] dark:border-slate-800 text-sm font-bold text-slate-900 dark:text-white">
                <span>
                  {lang === 'vi' ? 'Tổng thanh toán hôm nay' : 'Total due today'}
                </span>
                <span className="font-mono" data-testid="checkout-total-due-display">
                  ${details.amount_usd.toFixed(2)} USD
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-[#005BAA] dark:text-sky-300 font-mono font-medium">
                <span>
                  {lang === 'vi'
                    ? 'Quy đổi cổng VNPay (VND):'
                    : 'VNPay Gateway Equivalent (VND):'}
                </span>
                <span data-testid="checkout-total-vnd-line">
                  {formatVnd(amountVnd)}
                  {discountVnd > 0 ? ` (-${formatVnd(discountVnd)})` : ''}
                </span>
              </div>
            </div>

            {/* Included Highlights */}
            <div className="space-y-2 pt-1">
              <p className="text-[11px] font-mono uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
                {lang === 'vi'
                  ? 'Quyền lợi kích hoạt ngay:'
                  : 'Instant activation includes:'}
              </p>
              <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
                {features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="pt-6 border-t border-[#E7E3D9] dark:border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 relative z-10 flex-wrap gap-2">
            <span className="flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              Powered by <strong className="text-slate-900 dark:text-white">Stripe</strong> &amp;{' '}
              <strong className="text-[#005BAA] dark:text-sky-300">VNPAY</strong>
            </span>
            <span className="font-mono text-[10px]">
              PCI-DSS Level 1 · HMAC-SHA512
            </span>
          </div>
        </div>

        {/* ============================================================
            RIGHT COLUMN — Express Wallets + VNPay + International Card
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
                <div className="flex items-center gap-1 flex-wrap">
                  <VNPayLogo active={paymentMethod === 'vnpay'} />
                  <VisaLogo active={paymentMethod === 'card' && cardBrand === 'visa'} />
                  <MastercardLogo active={paymentMethod === 'card' && cardBrand === 'mastercard'} />
                  <AmexLogo active={paymentMethod === 'card' && cardBrand === 'amex'} />
                  <JcbLogo active={paymentMethod === 'card' && cardBrand === 'jcb'} />
                </div>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {lang === 'vi'
                  ? `Tài khoản nhận gói: ${details.customer_email}`
                  : `Subscribing account: ${details.customer_email}`}
              </p>
            </div>

            {/* Express Checkout Buttons (VNPay QR, Apple Pay & Google Pay) */}
            <div
              className="space-y-2"
              data-testid="express-checkout-section"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                  {lang === 'vi'
                    ? 'Thanh toán nhanh 1 chạm (Express)'
                    : 'Express One-Click Checkout'}
                </span>
                <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400">
                  VNPAY-QR · Biometric
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {/* Express VNPAY-QR / ATM Button */}
                <button
                  type="button"
                  data-testid="express-vnpay-btn"
                  disabled={submitting}
                  onClick={() => {
                    setPaymentMethod('vnpay');
                    void handleLaunchVNPayGateway('NCB', 'atm');
                  }}
                  className="h-11 rounded-xl bg-gradient-to-r from-[#005BAA] to-[#0072CE] hover:from-[#004A8F] hover:to-[#005BAA] text-white font-semibold text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer active:scale-[0.99] px-3"
                >
                  <QrCode className="w-4 h-4 shrink-0" />
                  <span className="tracking-tight font-sans font-bold">
                    VNPAY-QR / ATM
                  </span>
                </button>

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
                  ? 'Hoặc chọn cổng thanh toán'
                  : 'Or select payment method'}
              </span>
              <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
            </div>

            {/* Payment Method Tabs (4 methods: Card, VNPay, Apple Pay, Google Pay) */}
            <div
              className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-800"
              role="tablist"
            >
              <button
                type="button"
                role="tab"
                aria-selected={paymentMethod === 'card'}
                data-testid="method-tab-card"
                onClick={() => setPaymentMethod('card')}
                className={`py-2 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  paymentMethod === 'card'
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <CreditCard className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{lang === 'vi' ? 'Thẻ Quốc Tế' : 'Card'}</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={paymentMethod === 'vnpay'}
                data-testid="method-tab-vnpay"
                onClick={() => setPaymentMethod('vnpay')}
                className={`py-2 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  paymentMethod === 'vnpay'
                    ? 'bg-white dark:bg-slate-900 text-[#005BAA] dark:text-sky-400 shadow-2xs ring-1 ring-[#005BAA]/25'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <VNPayLogo active={paymentMethod === 'vnpay'} />
                <span className="truncate">VNPay</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={paymentMethod === 'apple_pay'}
                data-testid="method-tab-apple-pay"
                onClick={() => setPaymentMethod('apple_pay')}
                className={`py-2 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  paymentMethod === 'apple_pay'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <AppleLogoSvg className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Apple Pay</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={paymentMethod === 'google_pay'}
                data-testid="method-tab-google-pay"
                onClick={() => setPaymentMethod('google_pay')}
                className={`py-2 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  paymentMethod === 'google_pay'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <GooglePaySvg className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Google Pay</span>
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
                  <div className="flex flex-col gap-1.5">
                    <Label
                      htmlFor="card-expiry"
                      className="text-xs font-semibold flex items-center gap-1 h-4"
                    >
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
                  <div className="flex flex-col gap-1.5">
                    <Label
                      htmlFor="card-cvc"
                      className="text-xs font-semibold flex items-center gap-1 h-4"
                    >
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
                <div className="flex flex-col gap-1.5">
                  <Label
                    htmlFor="cardholder-name"
                    className="text-xs font-semibold flex items-center gap-1 h-4"
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
                  <div className="flex flex-col gap-1.5">
                    <Label
                      htmlFor="billing-country"
                      className="text-xs font-semibold flex items-center gap-1 h-4"
                    >
                      <Globe className="h-3 w-3 text-slate-400 shrink-0" />
                      <span>
                        {lang === 'vi'
                          ? 'Quốc gia thanh toán'
                          : 'Billing country'}
                      </span>
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
                  <div className="flex flex-col gap-1.5">
                    <Label
                      htmlFor="billing-zip"
                      className="text-xs font-semibold flex items-center gap-1 h-4"
                    >
                      <span>
                        {lang === 'vi'
                          ? 'Mã bưu chính (ZIP / Postal)'
                          : 'Postal / ZIP code'}
                      </span>
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
            ) : paymentMethod === 'vnpay' ? (
              /* Dedicated VNPay Payment Gateway Panel (v2.1.0 HMAC-SHA512) */
              <div
                className="p-4 sm:p-5 rounded-2xl border border-[#005BAA]/30 dark:border-sky-500/30 bg-gradient-to-b from-sky-50/70 to-white dark:from-slate-900 dark:to-slate-900/90 space-y-4"
                data-testid="vnpay-tab-panel"
              >
                {/* Header & Amount in VND */}
                <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-200/80 dark:border-slate-800">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-10 h-10 rounded-xl bg-white dark:bg-slate-900 border border-sky-200/90 dark:border-sky-500/30 shadow-2xs flex items-center justify-center shrink-0"
                      data-testid="vnpay-panel-logo-badge"
                    >
                      <span className="font-sans font-black text-[10px] tracking-tighter leading-none select-none">
                        <span className="text-[#ED1C24]">VN</span>
                        <span className="text-[#005BAA] dark:text-sky-400">PAY</span>
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h3 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                          {lang === 'vi'
                            ? 'Cổng thanh toán VNPAY-QR & ATM'
                            : 'VNPAY-QR & Domestic ATM Gateway'}
                        </h3>
                        <Badge
                          variant="secondary"
                          className="text-[9px] font-mono bg-sky-100 dark:bg-sky-950 text-[#005BAA] dark:text-sky-300 border-sky-300/60"
                        >
                          v2.1.0 · HMAC-SHA512
                        </Badge>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {lang === 'vi'
                          ? 'Hỗ trợ 40+ Ngân hàng Việt Nam (VietQR, NCB, Vietcombank, BIDV, Techcombank...)'
                          : 'Supports 40+ Vietnamese banks via VNPAY-QR, Domestic ATM & International Cards'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* VND Exchange Breakdown Box */}
                <div className="p-3 rounded-xl bg-sky-50/90 dark:bg-slate-900 border border-sky-200/80 dark:border-slate-800 text-slate-900 dark:text-white flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                      {lang === 'vi'
                        ? 'Số tiền thanh toán qua VNPay (VND)'
                        : 'VNPay Settlement Amount (VND)'}
                    </span>
                    <span
                      className="font-display text-xl sm:text-2xl font-bold text-emerald-700 dark:text-emerald-400"
                      data-testid="vnpay-panel-amount-vnd"
                    >
                      {formatVnd(amountVnd)}
                    </span>
                  </div>
                  <div className="text-right font-mono text-[11px] text-slate-600 dark:text-slate-300">
                    <div>
                      ${details.amount_usd.toFixed(2)} USD × {formatVnd(usdToVndRate)}
                    </div>
                    <div className="text-[10px] text-[#005BAA] dark:text-sky-300 font-semibold">
                      vnp_Amount = {amountVnd * 100}
                    </div>
                  </div>
                </div>

                {/* Channel Selector */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">
                    {lang === 'vi'
                      ? '1. Chọn kênh thanh toán VNPay:'
                      : '1. Select VNPay Payment Channel:'}
                  </Label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <button
                      type="button"
                      data-testid="vnpay-channel-atm"
                      onClick={() => {
                        setVnpayChannel('atm');
                        if (vnpayBankCode === 'VNPAYQR' || vnpayBankCode === 'INTCARD') {
                          setVnpayBankCode('NCB');
                        }
                      }}
                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                        vnpayChannel === 'atm'
                          ? 'border-[#005BAA] bg-sky-50/90 dark:bg-sky-950/60 text-[#005BAA] dark:text-sky-300 ring-1 ring-[#005BAA]/30'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <Building2 className="h-4 w-4 text-[#005BAA] dark:text-sky-400" />
                        <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                          VNBANK
                        </span>
                      </div>
                      <p className="text-xs font-bold">
                        {lang === 'vi' ? 'Thẻ ATM Nội Địa' : 'Domestic ATM Card'}
                      </p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">
                        {lang === 'vi' ? 'NCB, VCB, TCB, BIDV...' : '40+ Vietnam Banks'}
                      </p>
                    </button>

                    <button
                      type="button"
                      data-testid="vnpay-channel-qr"
                      onClick={() => {
                        setVnpayChannel('qr');
                        setVnpayBankCode('VNPAYQR');
                      }}
                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                        vnpayChannel === 'qr'
                          ? 'border-[#005BAA] bg-sky-50/90 dark:bg-sky-950/60 text-[#005BAA] dark:text-sky-300 ring-1 ring-[#005BAA]/30'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <QrCode className="h-4 w-4 text-[#ED1C24]" />
                        <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                          VNPAYQR
                        </span>
                      </div>
                      <p className="text-xs font-bold">
                        {lang === 'vi' ? 'Quét Mã VNPAY-QR' : 'Scan VNPAY-QR'}
                      </p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">
                        {lang === 'vi' ? 'App Banking / Ví VNPay' : 'Banking App / VietQR'}
                      </p>
                    </button>

                    <button
                      type="button"
                      data-testid="vnpay-channel-intcard"
                      onClick={() => {
                        setVnpayChannel('intcard');
                        setVnpayBankCode('INTCARD');
                      }}
                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                        vnpayChannel === 'intcard'
                          ? 'border-[#005BAA] bg-sky-50/90 dark:bg-sky-950/60 text-[#005BAA] dark:text-sky-300 ring-1 ring-[#005BAA]/30'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <CreditCard className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                        <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                          INTCARD
                        </span>
                      </div>
                      <p className="text-xs font-bold">
                        {lang === 'vi' ? 'Thẻ Quốc Tế VNPay' : 'Intl Card via VNPay'}
                      </p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">
                        Visa / MC / JCB
                      </p>
                    </button>
                  </div>
                </div>

                {/* Bank Grid Selector (for ATM channel) */}
                {vnpayChannel === 'atm' && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold">
                        {lang === 'vi'
                          ? '2. Chọn ngân hàng thanh toán:'
                          : '2. Select Issuing Bank:'}
                      </Label>
                      <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400">
                        {lang === 'vi'
                          ? 'Khuyên dùng: NCB (Thẻ Test Sandbox)'
                          : 'Recommended: NCB (Official Sandbox)'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {VNPAY_BANKS_UI.map((bank) => {
                        const selected = vnpayBankCode === bank.code;
                        return (
                          <button
                            key={bank.code}
                            type="button"
                            data-testid={`vnpay-bank-${bank.code}`}
                            onClick={() => setVnpayBankCode(bank.code)}
                            className={`py-2 px-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between gap-1 ${
                              selected
                                ? 'border-[#005BAA] bg-[#005BAA] text-white font-bold shadow-2xs'
                                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-sky-400'
                            }`}
                          >
                            <span className="text-xs font-mono truncate">
                              {bank.short}
                            </span>
                            {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Official VNPay Sandbox Test Card Hint */}
                <div className="p-3 rounded-xl bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/70 text-[11px] text-amber-900 dark:text-amber-200 space-y-1">
                  <div className="font-semibold flex items-center justify-between">
                    <span>
                      {lang === 'vi'
                        ? 'Thông tin thẻ Test chuẩn VNPay Sandbox (Ngân hàng NCB):'
                        : 'Official VNPay Sandbox Test Credentials (NCB Bank):'}
                    </span>
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-amber-200/70 dark:bg-amber-900 text-amber-900 dark:text-amber-200">
                      NCB SANDBOX
                    </span>
                  </div>
                  <div className="font-mono text-[11px] grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 text-amber-800 dark:text-amber-300">
                    <span>• Số thẻ: 9704198526191432198</span>
                    <span>• Chủ thẻ: NGUYEN VAN A</span>
                    <span>• Ngày phát hành: 07/15</span>
                    <span>• Mã OTP: 123456</span>
                  </div>
                </div>

                {/* Launch VNPay Gateway Button */}
                <Button
                  type="button"
                  disabled={submitting}
                  data-testid="vnpay-launch-gateway-btn"
                  onClick={() => void handleLaunchVNPayGateway()}
                  className="w-full h-12 rounded-xl bg-gradient-to-r from-[#005BAA] to-[#0072CE] hover:from-[#004A8F] hover:to-[#005BAA] text-white font-semibold text-sm shadow-lg cursor-pointer"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      {lang === 'vi'
                        ? 'Đang tạo chữ ký HMAC-SHA512 & kết nối VNPay...'
                        : 'Generating HMAC-SHA512 Signature & Opening VNPay...'}
                    </>
                  ) : (
                    <>
                      <QrCode className="h-4 w-4 mr-2" />
                      {lang === 'vi'
                        ? `Thanh toán qua VNPay · ${formatVnd(amountVnd)}`
                        : `Pay with VNPay · ${formatVnd(amountVnd)} ($${details.amount_usd.toFixed(2)})`}
                    </>
                  )}
                </Button>
              </div>
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
                ? 'Chuẩn bảo mật PCI-DSS & HMAC-SHA512: Không lưu số thẻ/OTP. Nâng cấp tức thì.'
                : 'PCI-DSS & HMAC-SHA512 Verified: Raw PAN/OTP never stored. Instant upgrade.'}
            </p>
          </div>
        </div>
      </div>

      {/* ============================================================
          VNPAY v2.1.0 INTERACTIVE SANDBOX PAYMENT GATEWAY MODAL
          Implements official NCB ATM card + OTP flow & VNPAY-QR scan
          with live HMAC-SHA512 signed URL inspection and ReturnURL verification.
          ============================================================ */}
      {vnpayModalOpen &&
        vnpayGatewayData &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
            data-testid="vnpay-gateway-modal"
            onClick={(e) => {
              if (e.target === e.currentTarget && !submitting) {
                setVnpayModalOpen(false);
              }
            }}
          >
            <div
              {...vnpayDialog.dialogProps}
              className="w-full max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-5 sm:p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] space-y-4 outline-none"
            >
              {/* Mobile Drag Handle Pill */}
              <div className="sm:hidden w-10 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 mx-auto -mt-1 mb-1" />

              {/* VNPay Gateway Header */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-2xs font-black text-xs tracking-tight flex items-center gap-0.5">
                    <span className="text-[#ED1C24]">VN</span>
                    <span className="text-[#005BAA] dark:text-[#3898FF]">PAY</span>
                    <span className="ml-1 text-[9px] font-mono text-emerald-600 dark:text-emerald-400">
                      GATEWAY
                    </span>
                  </div>
                  <div>
                    <h3
                      id={vnpayDialog.titleId}
                      className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white"
                    >
                      {lang === 'vi'
                        ? 'Cổng Thanh Toán VNPAY Sandbox v2.1.0'
                        : 'VNPAY Sandbox Payment Gateway v2.1.0'}
                    </h3>
                    <p className="text-[11px] font-mono text-slate-500">
                      Mã đơn (vnp_TxnRef):{' '}
                      <strong
                        className="text-slate-800 dark:text-slate-200"
                        data-testid="vnpay-modal-txn-ref"
                      >
                        {vnpayGatewayData.vnp_txn_ref}
                      </strong>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="vnpay-modal-close-btn"
                  disabled={submitting}
                  onClick={() => setVnpayModalOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Order Summary & Cryptographic Checksum Inspector */}
              <div
                className="p-3.5 rounded-2xl bg-[#F4F2EC]/90 dark:bg-slate-950 border border-[#E7E3D9] dark:border-slate-800 text-slate-900 dark:text-white space-y-2 text-xs"
                data-testid="vnpay-signature-inspector"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-600 dark:text-slate-400">
                    {lang === 'vi' ? 'Số tiền thanh toán:' : 'Payment Amount:'}
                  </span>
                  <span
                    className="font-display text-lg font-bold text-emerald-700 dark:text-emerald-400"
                    data-testid="vnpay-modal-amount-vnd"
                  >
                    {formatVnd(vnpayGatewayData.amount_vnd)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  <span>vnp_Amount (×100):</span>
                  <span className="text-[#005BAA] dark:text-sky-300 font-semibold">
                    {vnpayGatewayData.vnp_amount}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  <span>vnp_TmnCode / Hash:</span>
                  <span className="text-emerald-700 dark:text-emerald-300 font-semibold">
                    {vnpayGatewayData.tmn_code} · HMAC-SHA512
                  </span>
                </div>

                {/* Toggle Signed URL Inspector */}
                <div className="pt-1.5 border-t border-[#E7E3D9] dark:border-slate-800 flex items-center justify-between gap-2 flex-wrap">
                  <button
                    type="button"
                    data-testid="vnpay-toggle-signed-url-btn"
                    onClick={() => setVnpayShowSignedUrl((prev) => !prev)}
                    className="text-[11px] font-mono text-[#005BAA] hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300 underline cursor-pointer"
                  >
                    {vnpayShowSignedUrl
                      ? lang === 'vi'
                        ? 'Ẩn URL chữ ký số vnp_SecureHash'
                        : 'Hide signed vnp_SecureHash URL'
                      : lang === 'vi'
                        ? 'Xem URL chuẩn VNPay & vnp_SecureHash'
                        : 'Inspect signed VNPay URL & vnp_SecureHash'}
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopySignedUrl}
                      className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer"
                    >
                      <Copy className="h-3 w-3" />
                      {vnpayCopiedUrl
                        ? lang === 'vi'
                          ? 'Đã chép'
                          : 'Copied'
                        : 'Copy URL'}
                    </button>
                    <a
                      href={vnpayGatewayData.payment_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-sky-100 hover:bg-sky-200 dark:bg-sky-900/70 dark:hover:bg-sky-800 text-[#005BAA] dark:text-sky-200"
                    >
                      <ExternalLink className="h-3 w-3" />
                      sandbox.vnpayment.vn
                    </a>
                  </div>
                </div>

                {vnpayShowSignedUrl && (
                  <div
                    className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 font-mono text-[10px] text-slate-700 dark:text-slate-300 break-all max-h-28 overflow-y-auto"
                    data-testid="vnpay-signed-url-box"
                  >
                    {vnpayGatewayData.payment_url}
                  </div>
                )}
              </div>

              {/* Modal Payment Mode Switcher: ATM Card vs VNPAY-QR */}
              <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
                <button
                  type="button"
                  data-testid="vnpay-modal-tab-atm"
                  onClick={() => {
                    setVnpayModalTab('atm');
                    setVnpayModalError(null);
                  }}
                  className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    vnpayModalTab === 'atm'
                      ? 'bg-white dark:bg-slate-900 text-[#005BAA] dark:text-sky-400 shadow-2xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <Building2 className="h-3.5 w-3.5" />
                  <span>
                    {lang === 'vi'
                      ? `Thẻ ATM (${vnpayBankCode === 'VNPAYQR' ? 'NCB' : vnpayBankCode})`
                      : `ATM Card (${vnpayBankCode === 'VNPAYQR' ? 'NCB' : vnpayBankCode})`}
                  </span>
                </button>
                <button
                  type="button"
                  data-testid="vnpay-modal-tab-qr"
                  onClick={() => {
                    setVnpayModalTab('qr');
                    setVnpayModalError(null);
                  }}
                  className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    vnpayModalTab === 'qr'
                      ? 'bg-white dark:bg-slate-900 text-[#ED1C24] dark:text-rose-400 shadow-2xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <QrCode className="h-3.5 w-3.5" />
                  <span>{lang === 'vi' ? 'Quét mã VNPAY-QR' : 'Scan VNPAY-QR'}</span>
                </button>
              </div>

              {vnpayModalError && (
                <div
                  className="p-3 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300 flex items-start gap-2"
                  data-testid="vnpay-modal-error"
                >
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{vnpayModalError}</span>
                </div>
              )}

              {vnpayModalTab === 'atm' ? (
                <div className="space-y-3">
                  {/* 1-Click VNPay Sandbox Test Scenarios */}
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block">
                      {lang === 'vi'
                        ? 'Chọn nhanh kịch bản Thẻ Test NCB Sandbox:'
                        : 'Quick-Fill NCB Sandbox Test Card Scenarios:'}
                    </span>
                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        data-testid="vnpay-testcard-00"
                        onClick={() => handleAutofillVNPayTestCard('00')}
                        className={`py-1.5 px-2 rounded-lg text-[11px] font-mono font-semibold border transition-all cursor-pointer ${
                          vnpayCardNumber === '9704198526191432198'
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        ✓ NCB ••2198 (00)
                      </button>
                      <button
                        type="button"
                        data-testid="vnpay-testcard-51"
                        onClick={() => handleAutofillVNPayTestCard('51')}
                        className={`py-1.5 px-2 rounded-lg text-[11px] font-mono font-semibold border transition-all cursor-pointer ${
                          vnpayCardNumber === '9704195798621412'
                            ? 'bg-amber-600 text-white border-amber-600'
                            : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        ⚠ Hết tiền (51)
                      </button>
                      <button
                        type="button"
                        data-testid="vnpay-testcard-12"
                        onClick={() => handleAutofillVNPayTestCard('12')}
                        className={`py-1.5 px-2 rounded-lg text-[11px] font-mono font-semibold border transition-all cursor-pointer ${
                          vnpayCardNumber === '9704193360968149'
                            ? 'bg-rose-600 text-white border-rose-600'
                            : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        ✕ Khóa thẻ (12)
                      </button>
                    </div>
                  </div>

                  {/* Card Number */}
                  <div className="flex flex-col gap-1">
                    <Label
                      htmlFor="vnpay-card-number"
                      className="text-xs font-semibold flex items-center gap-1 h-4"
                    >
                      {lang === 'vi'
                        ? 'Số thẻ ATM nội địa (Ngân hàng NCB Sandbox)'
                        : 'Domestic ATM Card Number (NCB Sandbox)'}
                    </Label>
                    <Input
                      id="vnpay-card-number"
                      data-testid="vnpay-card-number-input"
                      value={vnpayCardNumber}
                      onChange={(e) =>
                        setVnpayCardNumber(e.target.value.replace(/\D/g, '').slice(0, 19))
                      }
                      placeholder="9704198526191432198"
                      className="font-mono text-sm h-10 rounded-xl"
                    />
                  </div>

                  {/* Card Holder & Issue Date */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="flex flex-col gap-1">
                      <Label
                        htmlFor="vnpay-card-holder"
                        className="text-xs font-semibold flex items-center gap-1 h-4"
                      >
                        {lang === 'vi' ? 'Tên chủ thẻ (Không dấu)' : 'Cardholder Name'}
                      </Label>
                      <Input
                        id="vnpay-card-holder"
                        data-testid="vnpay-card-holder-input"
                        value={vnpayCardHolder}
                        onChange={(e) => setVnpayCardHolder(e.target.value.toUpperCase())}
                        placeholder="NGUYEN VAN A"
                        className="font-mono text-xs h-10 rounded-xl uppercase"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label
                        htmlFor="vnpay-issue-date"
                        className="text-xs font-semibold flex items-center gap-1 h-4"
                      >
                        {lang === 'vi' ? 'Ngày phát hành (MM/YY)' : 'Issue Date (MM/YY)'}
                      </Label>
                      <Input
                        id="vnpay-issue-date"
                        data-testid="vnpay-issue-date-input"
                        value={vnpayIssueDate}
                        onChange={(e) => setVnpayIssueDate(formatExpiryInput(e.target.value))}
                        placeholder="07/15"
                        maxLength={5}
                        className="font-mono text-xs h-10 rounded-xl"
                      />
                    </div>
                  </div>

                  {/* OTP Input */}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between h-4">
                      <Label
                        htmlFor="vnpay-otp"
                        className="text-xs font-semibold flex items-center gap-1 h-4"
                      >
                        <KeyRound className="h-3.5 w-3.5 text-[#005BAA]" />
                        {lang === 'vi'
                          ? 'Mã xác thực OTP Sandbox (Mặc định: 123456)'
                          : 'Sandbox OTP Code (Default: 123456)'}
                      </Label>
                      <span className="text-[10px] font-mono text-emerald-600">
                        OTP = 123456
                      </span>
                    </div>
                    <Input
                      id="vnpay-otp"
                      data-testid="vnpay-otp-input"
                      value={vnpayOtpCode}
                      onChange={(e) =>
                        setVnpayOtpCode(e.target.value.replace(/\D/g, '').slice(0, 8))
                      }
                      placeholder="123456"
                      className="font-mono text-sm tracking-widest h-10 rounded-xl"
                    />
                  </div>
                </div>
              ) : (
                /* VNPAY-QR / VietQR Interactive Scanner View */
                <div
                  className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 text-center space-y-3"
                  data-testid="vnpay-qr-scanner-view"
                >
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-100 dark:bg-sky-950 text-[#005BAA] dark:text-sky-300 text-[11px] font-semibold">
                    <QrCode className="h-3.5 w-3.5" />
                    <span>VietQR · VNPAY-QR EMVCo Dynamic Code</span>
                  </div>

                  {/* Stylized QR Code Frame */}
                  <div className="w-44 h-44 mx-auto p-3 rounded-2xl bg-white border-2 border-[#005BAA] shadow-md flex flex-col items-center justify-center relative">
                    <svg
                      viewBox="0 0 120 120"
                      className="w-full h-full text-slate-900"
                      aria-label="VNPAY-QR Code"
                    >
                      {/* Top-left finder */}
                      <rect x="6" y="6" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="6" />
                      <rect x="14" y="14" width="14" height="14" fill="currentColor" />
                      {/* Top-right finder */}
                      <rect x="84" y="6" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="6" />
                      <rect x="92" y="14" width="14" height="14" fill="currentColor" />
                      {/* Bottom-left finder */}
                      <rect x="6" y="84" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="6" />
                      <rect x="14" y="92" width="14" height="14" fill="currentColor" />
                      {/* Data modules */}
                      <rect x="44" y="10" width="8" height="8" fill="currentColor" />
                      <rect x="60" y="10" width="12" height="8" fill="currentColor" />
                      <rect x="44" y="24" width="12" height="8" fill="currentColor" />
                      <rect x="64" y="24" width="8" height="12" fill="currentColor" />
                      <rect x="10" y="44" width="12" height="8" fill="currentColor" />
                      <rect x="28" y="48" width="8" height="12" fill="currentColor" />
                      <rect x="84" y="46" width="10" height="10" fill="currentColor" />
                      <rect x="100" y="52" width="12" height="8" fill="currentColor" />
                      <rect x="12" y="64" width="16" height="8" fill="currentColor" />
                      <rect x="44" y="84" width="12" height="8" fill="currentColor" />
                      <rect x="64" y="88" width="8" height="16" fill="currentColor" />
                      <rect x="84" y="80" width="14" height="10" fill="currentColor" />
                      <rect x="102" y="96" width="12" height="14" fill="currentColor" />
                      <rect x="46" y="102" width="14" height="10" fill="currentColor" />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <span className="px-1.5 py-0.5 rounded bg-white border border-[#005BAA] text-[9px] font-black shadow-xs">
                        <span className="text-[#ED1C24]">VN</span>
                        <span className="text-[#005BAA]">PAY</span>
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-400 max-w-xs mx-auto">
                    {lang === 'vi'
                      ? 'Trong môi trường Sandbox, nhấn nút bên dưới để giả lập quét mã VNPAY-QR thành công và nhận callback chữ ký số.'
                      : 'In Sandbox mode, click confirm below to simulate an instant VNPAY-QR mobile banking scan and signed callback.'}
                  </p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-1 space-y-2">
                <Button
                  type="button"
                  disabled={submitting}
                  data-testid="vnpay-confirm-pay-btn"
                  onClick={() => void handleConfirmVNPayAuthorize()}
                  className="w-full h-12 rounded-xl bg-gradient-to-r from-[#005BAA] to-[#0072CE] hover:from-[#004A8F] hover:to-[#005BAA] text-white font-semibold text-sm shadow-lg cursor-pointer"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      {lang === 'vi'
                        ? 'Đang xác thực chữ ký HMAC-SHA512 & kích hoạt gói...'
                        : 'Verifying HMAC-SHA512 Signature & Activating Plan...'}
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      {vnpayModalTab === 'qr'
                        ? lang === 'vi'
                          ? `Xác nhận đã quét VNPAY-QR · ${formatVnd(vnpayGatewayData.amount_vnd)}`
                          : `Simulate VNPAY-QR Scan · ${formatVnd(vnpayGatewayData.amount_vnd)}`
                        : lang === 'vi'
                          ? `Xác nhận OTP & Thanh toán ${formatVnd(vnpayGatewayData.amount_vnd)}`
                          : `Verify OTP & Pay ${formatVnd(vnpayGatewayData.amount_vnd)}`}
                    </>
                  )}
                </Button>
                <button
                  type="button"
                  data-testid="vnpay-cancel-btn"
                  disabled={submitting}
                  onClick={() => setVnpayModalOpen(false)}
                  className="w-full text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 py-1 cursor-pointer text-center"
                >
                  {lang === 'vi' ? 'Hủy giao dịch VNPay' : 'Cancel Transaction'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

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
            <div
              {...walletDialog.dialogProps}
              className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-5 sm:p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] space-y-4 sm:space-y-5 outline-none"
            >
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
                    <h3
                      id={walletDialog.titleId}
                      className="font-display text-base font-bold text-slate-900 dark:text-white"
                    >
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

      {/* ============================================================
          POST-PAYMENT LUXURY LOADING & "WELCOME TO PLAN" CELEBRATION OVERLAY
          3-stage cinematic transition:
          1. 'verifying' -> Cryptographic & Bank Settlement Handshake
          2. 'provisioning' -> Unlocking CITRA Pro / Ultra Quotas
          3. 'welcome' -> Celebration Reveal ("Welcome to CITRA Pro / Ultra!")
          ============================================================ */}
      {celebrationStage &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[120] bg-[#FBFAF6]/92 dark:bg-[#141310]/92 backdrop-blur-md flex items-center justify-center p-4"
            data-testid="checkout-payment-celebration-overlay"
          >
            <div className="relative w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-[#E7E3D9] dark:border-slate-800 shadow-2xl p-7 sm:p-9 text-center space-y-6 overflow-hidden">
              {/* Ambient Radial Celebration Glow */}
              <div
                className={`pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full blur-3xl transition-all duration-700 ${
                  celebrationStage === 'welcome'
                    ? 'bg-emerald-400/25 dark:bg-emerald-500/20 scale-110'
                    : 'bg-indigo-400/20 dark:bg-sky-500/15 scale-95'
                }`}
              />

              {/* Visual Stage Icon / Orbital Spinner / Stroke-Draw Checkmark */}
              <div className="relative z-10 flex items-center justify-center pt-1">
                {celebrationStage !== 'welcome' ? (
                  <div className="relative w-20 h-20 flex items-center justify-center">
                    {/* Outer Orbital Ring */}
                    <div className="absolute inset-0 rounded-full border-2 border-dashed border-indigo-500/40 dark:border-sky-400/40 animate-orbital-spin" />
                    {/* Inner Reverse Orbital Ring */}
                    <div className="absolute inset-2 rounded-full border-2 border-transparent border-t-emerald-500 border-r-[#005BAA] dark:border-t-emerald-400 dark:border-r-sky-400 animate-orbital-reverse" />
                    {/* Center Icon */}
                    <div className="w-12 h-12 rounded-2xl bg-[#F4F2EC] dark:bg-slate-800 border border-[#E7E3D9] dark:border-slate-700 flex items-center justify-center shadow-sm">
                      {celebrationStage === 'verifying' ? (
                        <ShieldCheck className="h-6 w-6 text-[#005BAA] dark:text-sky-400 animate-pulse" />
                      ) : (
                        <Sparkles className="h-6 w-6 text-emerald-600 dark:text-emerald-400 animate-pulse" />
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="relative w-20 h-20 flex items-center justify-center">
                    <div className="w-20 h-20 rounded-3xl bg-emerald-500/15 dark:bg-emerald-500/20 border-2 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-lg ring-8 ring-emerald-500/10 animate-icon-pop">
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
                )}
              </div>

              {/* Gateway Badge */}
              <div className="relative z-10">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#F4F2EC] dark:bg-slate-800 border border-[#E7E3D9] dark:border-slate-700 text-[11px] font-mono font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                  {celebrationGateway === 'vnpay' ? (
                    <>
                      <VNPayLogo active />
                      <span>VNPAY HMAC-SHA512 VERIFIED</span>
                    </>
                  ) : celebrationGateway === 'apple_pay' ? (
                    <>
                      <AppleLogoSvg className="w-3.5 h-3.5" />
                      <span>APPLE PAY BIOMETRIC TOKEN</span>
                    </>
                  ) : celebrationGateway === 'google_pay' ? (
                    <>
                      <GooglePaySvg className="w-3.5 h-3.5" />
                      <span>GOOGLE PAY EMVCO TOKEN</span>
                    </>
                  ) : (
                    <>
                      <Lock className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                      <span>STRIPE PCI-DSS LEVEL 1</span>
                    </>
                  )}
                </span>
              </div>

              {/* Dynamic Headline & Subtitle */}
              <div className="relative z-10 space-y-2">
                <h2
                  className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight"
                  data-testid="celebration-stage-title"
                >
                  {celebrationStage === 'verifying'
                    ? lang === 'vi'
                      ? 'Đang xác thực giao dịch bảo mật...'
                      : 'Verifying Secure Transaction...'
                    : celebrationStage === 'provisioning'
                      ? lang === 'vi'
                        ? `Đang kích hoạt gói ${details.plan_name}...`
                        : `Provisioning ${details.plan_name} Workspace...`
                      : lang === 'vi'
                        ? `Chào mừng đến với ${details.plan_name}!`
                        : `Welcome to ${details.plan_name}!`}
                </h2>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 max-w-sm mx-auto">
                  {celebrationStage === 'verifying'
                    ? lang === 'vi'
                      ? 'Đối chiếu chữ ký mật mã & xác nhận thanh toán từ ngân hàng phát hành.'
                      : 'Validating cryptographic signature and confirming settlement with issuing bank.'
                    : celebrationStage === 'provisioning'
                      ? lang === 'vi'
                        ? 'Mở khóa hạn mức tải tài liệu, xuất báo cáo PDF/DOCX và 15+ nguồn học thuật.'
                        : 'Unlocking elevated document quotas, PDF/DOCX exports, and 15+ scholarly APIs.'
                      : lang === 'vi'
                        ? 'Tài khoản của bạn đã được nâng cấp thành công. Đang mở biên lai điện tử...'
                        : 'Your workspace is now upgraded. Opening your official payment receipt...'}
                </p>
              </div>

              {/* 3-Step Progress Bar & Milestones */}
              <div className="relative z-10 space-y-3 pt-1">
                <div className="h-2 w-full rounded-full bg-[#ECE9E0] dark:bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ease-out ${
                      celebrationStage === 'welcome'
                        ? 'w-full bg-gradient-to-r from-emerald-500 to-teal-500'
                        : celebrationStage === 'provisioning'
                          ? 'w-2/3 bg-gradient-to-r from-[#005BAA] to-emerald-500'
                          : 'w-1/3 bg-gradient-to-r from-indigo-600 to-[#005BAA]'
                    }`}
                  />
                </div>

                <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono">
                  <div
                    className={`py-1 px-2 rounded-lg border flex items-center justify-center gap-1 ${
                      celebrationStage === 'verifying'
                        ? 'bg-sky-50 dark:bg-sky-950/60 border-sky-300 dark:border-sky-700 text-[#005BAA] dark:text-sky-300 font-bold'
                        : 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 font-semibold'
                    }`}
                  >
                    <Check className="h-3 w-3 shrink-0" />
                    <span className="truncate">{lang === 'vi' ? 'Xác thực' : 'Verified'}</span>
                  </div>
                  <div
                    className={`py-1 px-2 rounded-lg border flex items-center justify-center gap-1 ${
                      celebrationStage === 'verifying'
                        ? 'bg-[#F4F2EC] dark:bg-slate-800/60 border-[#E7E3D9] dark:border-slate-800 text-slate-400'
                        : celebrationStage === 'provisioning'
                          ? 'bg-sky-50 dark:bg-sky-950/60 border-sky-300 dark:border-sky-700 text-[#005BAA] dark:text-sky-300 font-bold'
                          : 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 font-semibold'
                    }`}
                  >
                    <Sparkles className="h-3 w-3 shrink-0" />
                    <span className="truncate">{lang === 'vi' ? 'Mở khóa' : 'Quotas'}</span>
                  </div>
                  <div
                    className={`py-1 px-2 rounded-lg border flex items-center justify-center gap-1 ${
                      celebrationStage === 'welcome'
                        ? 'bg-emerald-600 border-emerald-600 text-white font-bold shadow-xs'
                        : 'bg-[#F4F2EC] dark:bg-slate-800/60 border-[#E7E3D9] dark:border-slate-800 text-slate-400'
                    }`}
                  >
                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                    <span className="truncate">{lang === 'vi' ? 'Hoàn tất' : 'Welcome'}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
