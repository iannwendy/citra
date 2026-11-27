import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { encodeQrMatrix } from '@/lib/qrCode';
import { toSafeExternalHref } from '@/lib/utils';
import { formatUserError, resolveAcademicLang } from '@/lib/academicTaxonomy';
import { isDemoEvaluatorMode } from '@/lib/productFacts';
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
  ChevronDown,
  Fingerprint,
  Globe,
  Smartphone,
  QrCode,
  Building2,
  KeyRound,
  ExternalLink,
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

/** Validate MM/YY expiration date against current calendar month/year */
export function isValidExpiry(expiry: string): boolean {
  const match = /^(\d{2})\/(\d{2})$/.exec(expiry.trim());
  if (!match) return false;
  const month = parseInt(match[1], 10);
  const year2 = parseInt(match[2], 10);
  if (month < 1 || month > 12) return false;
  const fullYear = 2000 + year2;
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  if (fullYear < currentYear || fullYear > currentYear + 25) return false;
  if (fullYear === currentYear && month < currentMonth) return false;
  return true;
}

/* ---------- Official Brand SVG Badges ---------- */

function VisaLogo({ active = true }: { active?: boolean }) {
  return (
    <span
      className={`inline-flex items-center justify-center px-2 py-0.5 rounded-md border text-[10px] font-black italic tracking-tighter select-none transition-all ${
        active
          ? 'bg-[#1A1F71] text-white border-[#1A1F71] shadow-sm'
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
          ? 'bg-slate-900 text-white border-slate-800 shadow-sm'
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
          ? 'bg-[#006FCF] text-white border-[#006FCF] shadow-sm'
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
          ? 'bg-emerald-700 text-white border-emerald-700 shadow-sm'
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
          ? 'bg-white dark:bg-slate-900 border-[#005BAA]/40 shadow-sm'
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
  { code: 'NCB', short: 'NCB', name_vi: 'NH Quốc Dân (NCB)', name_en: 'NCB Bank' },
  { code: 'VIETCOMBANK', short: 'VCB', name_vi: 'Vietcombank', name_en: 'Vietcombank' },
  { code: 'TECHCOMBANK', short: 'TCB', name_vi: 'Techcombank', name_en: 'Techcombank' },
  { code: 'BIDV', short: 'BIDV', name_vi: 'BIDV', name_en: 'BIDV' },
  { code: 'VIETINBANK', short: 'CTG', name_vi: 'VietinBank', name_en: 'VietinBank' },
  { code: 'MBBANK', short: 'MB', name_vi: 'MB Bank', name_en: 'MB Bank' },
  { code: 'ACB', short: 'ACB', name_vi: 'ACB', name_en: 'ACB' },
  { code: 'VPBANK', short: 'VPB', name_vi: 'VPBank', name_en: 'VPBank' },
];

function sanitizeCheckoutFeature(feature: string, lang: 'vi' | 'en', planTier: string): string {
  if (/serpapi/i.test(feature) || /google scholar fallback/i.test(feature)) {
    return lang === 'vi'
      ? 'Mở rộng tìm kiếm trên Google Scholar cho sách in & tài liệu hiếm'
      : 'Extended Google Scholar lookup for books & rare sources';
  }
  if (/auto-?fix\s+studio/i.test(feature)) {
    return lang === 'vi'
      ? 'Tự động sửa & chuẩn hóa trích dẫn 1 chạm'
      : '1-Click Auto-Fix & Citation Formatting';
  }
  if (lang === 'vi') {
    if (/document\s+inspector/i.test(feature)) {
      return 'Trình đọc đối chiếu trang PDF & đánh dấu vị trí trích dẫn';
    }
    if (/deep\s+neural\s+sentence-?bert/i.test(feature)) {
      return 'Đối chiếu ngữ nghĩa sâu giữa câu trích dẫn và tài liệu gốc (Việt ↔ Anh)';
    }
    if (/batch\s+check/i.test(feature)) {
      return 'Tải lên & kiểm tra đồng thời tối đa 10 bản thảo PDF/DOCX';
    }
    if (/batch\s+upload/i.test(feature)) {
      return 'Tải lên & kiểm tra đồng thời tối đa 50 bản thảo PDF/DOCX';
    }
    if (/override\s+verdict/i.test(feature)) {
      return 'Không giới hạn lớp học, sinh viên & quyền giảng viên duyệt kết luận';
    }
    if (/class\s+zip/i.test(feature)) {
      return 'Xuất báo cáo tổng hợp cả lớp (.ZIP) & bảng thống kê CSV';
    }
  }
  if (
    planTier === 'ultra' &&
    (/unlimited\s+(?:uploads|checks|pdf|manuscripts)/i.test(feature) ||
      /không giới hạn\s+(?:lượt|tài liệu|bản thảo|tải)/i.test(feature))
  ) {
    return lang === 'vi'
      ? 'Lên đến 1.000 lượt kiểm tra/tháng'
      : 'Up to 1,000 manuscript checks / month';
  }
  return feature;
}

function formatCheckoutPlanName(
  planTier: string,
  planName: string,
  lang: 'vi' | 'en',
): string {
  if (lang !== 'vi') return planName;
  const normalizedTier = planTier.toLowerCase();
  if (normalizedTier === 'pro') return 'Gói CITRA Pro';
  if (normalizedTier === 'ultra') return 'Gói CITRA Ultra';
  return planName.startsWith('Gói ') ? planName : `Gói ${planName}`;
}

function formatBillingCycleLabel(cycle: string, lang: 'vi' | 'en'): string {
  if (cycle === 'annual') {
    return lang === 'vi' ? 'Theo năm' : 'Annual';
  }
  return lang === 'vi' ? 'Theo tháng' : 'Monthly';
}

function formatPromoError(
  err: unknown,
  lang: 'vi' | 'en',
  usdToVndRate: number,
): string {
  const raw =
    typeof err === 'string'
      ? err
      : err instanceof Error
        ? err.message
        : err && typeof err === 'object' && 'detail' in err
          ? String((err as { detail?: unknown }).detail ?? '')
          : '';

  if (/exactly\s+6\s+alphanumeric/i.test(raw)) {
    return lang === 'vi'
      ? 'Mã giảm giá phải gồm đúng 6 ký tự chữ và số (A–Z, 0–9).'
      : 'Promo code must be exactly 6 alphanumeric characters (A-Z, 0-9).';
  }

  if (lang === 'vi') {
    if (/was\s+not\s+found/i.test(raw)) {
      return 'Mã giảm giá không tồn tại. Vui lòng kiểm tra lại.';
    }
    if (/currently\s+inactive/i.test(raw)) {
      return 'Mã giảm giá này hiện chưa được kích hoạt.';
    }
    if (/has\s+expired/i.test(raw)) {
      return 'Mã giảm giá này đã hết hạn sử dụng.';
    }
    const tierMatch = raw.match(/only\s+valid\s+for\s+the\s+citra\s+(\w+)\s+plan/i);
    if (tierMatch) {
      return `Mã giảm giá này chỉ áp dụng cho gói CITRA ${tierMatch[1]}.`;
    }
    const cycleMatch = raw.match(/only\s+valid\s+for\s+(monthly|annual)\s+billing/i);
    if (cycleMatch) {
      return `Mã giảm giá này chỉ áp dụng cho chu kỳ thanh toán ${
        cycleMatch[1].toLowerCase() === 'annual' ? 'theo năm' : 'theo tháng'
      }.`;
    }
    const minMatch = raw.match(/minimum\s+order\s+of\s+\$?([\d.,]+)/i);
    if (minMatch) {
      const minUsd = Number.parseFloat(minMatch[1].replace(/,/g, ''));
      if (Number.isFinite(minUsd)) {
        return `Mã giảm giá này yêu cầu đơn hàng tối thiểu ${formatVnd(minUsd * usdToVndRate)} ($${minUsd.toFixed(2)} USD).`;
      }
    }
    if (/maximum\s+redemption\s+limit/i.test(raw)) {
      return 'Mã giảm giá này đã hết lượt sử dụng.';
    }
    if (/already\s+used\s+promo\s+code/i.test(raw)) {
      return 'Bạn đã sử dụng mã giảm giá này trước đó.';
    }
  }

  return formatUserError(
    err,
    lang,
    lang === 'vi'
      ? 'Mã giảm giá không tồn tại hoặc đã hết hạn.'
      : 'Promo code not found or expired.',
  );
}

function renderPromoErrorText(msg: string) {
  const match = msg.match(/^(.*?)(\(A[–-]Z,\s*0[–-]9\))(.*)$/);
  if (!match) return msg;
  return (
    <>
      {match[1]}
      <span className="whitespace-nowrap">{match[2]}</span>
      {match[3]}
    </>
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
  const { t, i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const lang = resolveAcademicLang(i18n.language);

  const sessionId = searchParams.get('session_id') || '';
  const planParam = (searchParams.get('plan') || '').toLowerCase();
  const billingParam = (searchParams.get('billing') || '').toLowerCase();

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
  const [vnpayCardNumber, setVnpayCardNumber] = useState('');
  const [vnpayCardHolder, setVnpayCardHolder] = useState('');
  const [vnpayIssueDate, setVnpayIssueDate] = useState('');
  const [vnpayOtpCode, setVnpayOtpCode] = useState('');
  const [vnpayModalError, setVnpayModalError] = useState<string | null>(null);

  // Card form state (clean empty inputs with placeholders; users can type or use test guide in demo mode)
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [cardholderName, setCardholderName] = useState('');
  const [cardBrand, setCardBrand] = useState<CardBrand>('visa');
  const [billingCountry, setBillingCountry] = useState('VN');
  const [billingZip, setBillingZip] = useState('');

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
    let active = true;

    if (!sessionId) {
      if (planParam === 'pro' || planParam === 'ultra') {
        setLoading(true);
        setError(null);
        const cycle = billingParam === 'monthly' ? 'monthly' : 'annual';
        api
          .createCheckoutSession({
            plan_tier: planParam,
            billing_cycle: cycle,
          })
          .then((session) => {
            if (!active) return;
            const safeUrl = toSafeExternalHref(session.checkout_url);
            if (safeUrl) {
              window.location.href = safeUrl;
            } else if (
              session.checkout_url.startsWith('/') &&
              !session.checkout_url.startsWith('//')
            ) {
              navigate(session.checkout_url, { replace: true });
            } else {
              setError(
                lang === 'vi'
                  ? 'Không thể mở phiên thanh toán. Vui lòng thử lại từ trang Bảng giá.'
                  : 'Unable to open checkout session. Please try again from Pricing.',
              );
              setLoading(false);
            }
          })
          .catch((err) => {
            if (!active) return;
            setError(
              formatUserError(
                err,
                lang,
                lang === 'vi'
                  ? 'Không thể khởi tạo phiên thanh toán. Vui lòng thử lại từ trang Bảng giá.'
                  : 'Unable to start checkout session. Please try again from Pricing.',
              ),
            );
            setLoading(false);
          });
        return () => {
          active = false;
        };
      }

      setError(
        lang === 'vi'
          ? 'Không tìm thấy phiên thanh toán. Vui lòng chọn gói cước từ trang Bảng giá.'
          : 'Checkout session not found. Please select a plan from the Pricing page.',
      );
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
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
          formatUserError(
            err,
            lang,
            lang === 'vi'
              ? 'Không tìm thấy phiên thanh toán. Vui lòng bắt đầu lại từ trang Bảng giá.'
              : 'Checkout session not found. Please start again from Pricing.',
          ),
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [sessionId, planParam, billingParam, lang, navigate]);

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
    if (!cardholderName.trim()) {
      setCardholderName('NGUYEN VAN A');
    }
    if (!billingZip.trim()) {
      setBillingZip('700000');
    }
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
    const activeRate = details?.usd_to_vnd_rate ?? details?.vnpay?.usd_to_vnd_rate ?? 25000;
    if (!targetCode) {
      setPromoError(
        lang === 'vi'
          ? 'Vui lòng nhập mã giảm giá.'
          : 'Please enter a promo code.',
      );
      setPromoSuccessMsg(null);
      return;
    }

    if (!/^[A-Z0-9]{6}$/.test(targetCode)) {
      setPromoError(
        lang === 'vi'
          ? 'Mã giảm giá phải gồm đúng 6 ký tự chữ và số (A–Z, 0–9).'
          : 'Promo code must be exactly 6 alphanumeric characters (A-Z, 0-9).',
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
      const updatedRate = updated.usd_to_vnd_rate ?? updated.vnpay?.usd_to_vnd_rate ?? activeRate;
      const updatedDiscountUsd = updated.discount_usd ?? 0;
      const updatedDiscountVnd =
        updated.discount_vnd ?? Math.round(updatedDiscountUsd * updatedRate);
      setPromoSuccessMsg(
        lang === 'vi'
          ? `Đã áp dụng mã ${updated.promo_code}: Giảm -${formatVnd(updatedDiscountVnd)} (-$${updatedDiscountUsd.toFixed(2)} USD)!`
          : `Applied code ${updated.promo_code}: Saved -$${updatedDiscountUsd.toFixed(2)} USD!`,
      );
    } catch (err) {
      setPromoError(formatPromoError(err, lang, activeRate));
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
        formatUserError(
          err,
          lang,
          lang === 'vi'
            ? 'Không thể gỡ mã giảm giá. Vui lòng thử lại.'
            : 'Failed to remove promo code.',
        ),
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
        formatUserError(
          err,
          lang,
          lang === 'vi'
            ? 'Thanh toán thất bại. Vui lòng thử lại.'
            : 'Payment verification failed. Please try again.',
        ),
      );
      setSubmitting(false);
      setWalletModalMethod(null);
    }
  };

  const handlePaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId) return;

    if (details && (details.amount_usd <= 0 || details.payment_mode === 'promo_waiver')) {
      await executePaymentVerification({
        method: 'card',
        brand: 'promo_waiver',
        last4: 'FREE',
      });
      return;
    }

    const digits = cardNumber.replace(/\D/g, '');
    if (digits === '4000000000000002') {
      setError(
        lang === 'vi'
          ? 'Thẻ của bạn đã bị ngân hàng phát hành từ chối. Vui lòng dùng thẻ khác.'
          : 'Your card was declined by the issuing bank. Please try another card.',
      );
      return;
    }

    if (digits.length < 13 || digits.length > 19 || !isValidLuhn(digits)) {
      setError(
        lang === 'vi'
          ? 'Số thẻ chưa hợp lệ. Vui lòng kiểm tra lại số thẻ của bạn.'
          : 'Invalid card number. Please double-check the card digits.',
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
      const safeRedirectUrl = toSafeExternalHref(res.payment_url);
      if (res.external_redirect && safeRedirectUrl) {
        window.location.href = safeRedirectUrl;
        return;
      }
      setVnpayModalOpen(true);
    } catch (err) {
      setError(
        formatUserError(
          err,
          lang,
          lang === 'vi'
            ? 'Không thể kết nối cổng thanh toán VNPay. Vui lòng thử lại.'
            : 'Failed to connect to VNPay gateway. Please try again.',
        ),
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
          res.vnp_response_code
            ? lang === 'vi'
              ? `${msg} (Mã lỗi: ${res.vnp_response_code})`
              : `${msg} (Error code: ${res.vnp_response_code})`
            : msg,
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
        formatUserError(
          err,
          lang,
          lang === 'vi'
            ? 'Xác thực giao dịch VNPay thất bại. Vui lòng thử lại.'
            : 'VNPay transaction authorization failed. Please try again.',
        ),
      );
      setSubmitting(false);
    }
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

  const rawFeatures = lang === 'vi' ? details.features_vi : details.features_en;
  const features = rawFeatures.map((f) =>
    sanitizeCheckoutFeature(f, lang, details.plan_tier),
  );
  const displayMerchantName =
    !details.merchant_name || /SourceLogic/i.test(details.merchant_name)
      ? lang === 'vi'
        ? 'CITRA Việt Nam'
        : 'CITRA'
      : details.merchant_name;
  const isSandboxMode =
    isDemoEvaluatorMode() || details.payment_mode === 'stripe_demo';
  const showEvaluatorPromoHints = isDemoEvaluatorMode();
  const displayPlanName = formatCheckoutPlanName(
    details.plan_tier,
    details.plan_name,
    lang,
  );
  const billingCycleLabel = formatBillingCycleLabel(details.billing_cycle, lang);
  const subtotalUsd = details.subtotal_usd ?? details.amount_usd;
  const discountUsd = details.discount_usd ?? 0;
  const usdToVndRate = details.usd_to_vnd_rate ?? details.vnpay?.usd_to_vnd_rate ?? 25000;
  const amountVnd = details.amount_vnd ?? Math.round(details.amount_usd * usdToVndRate);
  const subtotalVnd = Math.round(subtotalUsd * usdToVndRate);
  const discountVnd = details.discount_vnd ?? Math.round(discountUsd * usdToVndRate);
  const annualSavingsVnd = Math.round((details.annual_savings_usd ?? 0) * usdToVndRate);
  const monthlyEquivalentVnd = Math.round(
    (details.monthly_equivalent_usd ?? 0) * usdToVndRate,
  );

  return (
    <div
      className="max-w-6xl mx-auto rounded-3xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-2xl bg-white dark:bg-slate-900 my-2 sm:my-4"
      data-testid="stripe-demo-checkout-page"
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[640px]">
        {/* ============================================================
            LEFT COLUMN — Stripe & VNPay Order Summary & Promo Code
            ============================================================ */}
        <div
          className="lg:col-span-5 bg-[#F4F2EC]/90 dark:bg-slate-950 text-slate-900 dark:text-white border-b lg:border-b-0 lg:border-r border-[#E7E3D9] dark:border-slate-800 p-5 sm:p-8 flex flex-col justify-between relative overflow-hidden transition-colors"
          data-testid="checkout-order-summary-panel"
        >
          <div className="space-y-6 relative z-10">
            {/* Back link & Security Badge */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Link
                to="/pricing?canceled=1"
                className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="w-[24px] h-[24px] rounded-[6px] bg-white dark:bg-[#1E1C17] border border-[#E7E3D9] dark:border-[#332F26] shadow-sm flex items-center justify-center p-0.5 shrink-0">
                  <img
                    src="/citra-logo.png"
                    alt="CITRA Logo"
                    width={15}
                    height={15}
                    className="object-contain select-none dark:brightness-150 dark:drop-shadow-[0_0_2px_rgba(255,255,255,0.45)]"
                  />
                </span>
                <span className="font-solva-sans text-sm font-medium tracking-[-0.02em] text-slate-900 dark:text-white">
                  {displayMerchantName}
                </span>
              </Link>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/90 dark:border-emerald-800/70 text-emerald-800 dark:text-emerald-300 font-mono text-[10px] font-semibold uppercase tracking-wider">
                <Lock className="h-3 w-3 shrink-0" />
                {isSandboxMode
                  ? lang === 'vi'
                    ? 'Chế độ thử nghiệm'
                    : 'Test Mode'
                  : lang === 'vi'
                    ? 'Bảo mật thanh toán'
                    : 'Secure Checkout'}
              </span>
            </div>

            {/* Plan Title & Price */}
            <div className="space-y-2 pt-1">
              <p className="text-xs font-mono uppercase tracking-wider font-semibold text-indigo-600 dark:text-indigo-300">
                {lang === 'vi'
                  ? `ĐĂNG KÝ GÓI ${details.billing_cycle === 'annual' ? 'THEO NĂM (-20%)' : 'THEO THÁNG'}`
                  : `SUBSCRIBE TO ${details.billing_cycle.toUpperCase()} PLAN`}
              </p>
              <h1 className="font-solva-serif font-normal text-2xl sm:text-3xl tracking-tight text-slate-900 dark:text-white">
                {displayPlanName}
              </h1>
              {lang === 'vi' ? (
                <>
                  <div className="flex items-baseline gap-2.5 pt-1 flex-wrap">
                    <span
                      className="font-display text-3xl sm:text-4xl font-bold text-slate-900 dark:text-white whitespace-nowrap"
                      data-testid="checkout-amount-display"
                    >
                      {formatVnd(amountVnd)}
                    </span>
                    {discountVnd > 0 && (
                      <span className="text-base font-mono text-slate-400 dark:text-slate-500 line-through whitespace-nowrap">
                        {formatVnd(subtotalVnd)}
                      </span>
                    )}
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-mono whitespace-nowrap">
                      / {details.billing_cycle === 'annual' ? 'năm' : 'tháng'}
                    </span>
                  </div>
                  <div
                    className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-sky-50 dark:bg-sky-500/15 border border-sky-200/90 dark:border-sky-400/30 text-[#005BAA] dark:text-sky-200 text-xs font-mono font-medium flex-wrap"
                    data-testid="checkout-vnd-amount-display"
                  >
                    <CreditCard className="h-3.5 w-3.5 shrink-0" />
                    <span>≈ ${details.amount_usd.toFixed(2)} USD</span>
                    <span className="text-[10px] text-sky-700/75 dark:text-sky-300/70">
                      (1 USD = {formatVnd(usdToVndRate)})
                    </span>
                  </div>
                </>
              ) : (
                <>
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
                      USD / {details.billing_cycle === 'annual' ? 'year' : 'month'}
                    </span>
                  </div>
                  <div
                    className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-sky-50 dark:bg-sky-500/15 border border-sky-200/90 dark:border-sky-400/30 text-[#005BAA] dark:text-sky-200 text-xs font-mono font-medium"
                    data-testid="checkout-vnd-amount-display"
                  >
                    <VNPayLogo active />
                    <span>≈ {formatVnd(amountVnd)}</span>
                    <span className="text-[10px] text-sky-700/75 dark:text-sky-300/70">
                      (1 USD = {formatVnd(usdToVndRate)})
                    </span>
                  </div>
                </>
              )}
              {details.billing_cycle === 'annual' && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-500/20 border border-emerald-200/90 dark:border-emerald-400/30 text-emerald-700 dark:text-emerald-300 text-xs font-mono font-medium">
                  <Sparkles className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    {lang === 'vi'
                      ? `Chỉ ${formatVnd(monthlyEquivalentVnd)}/tháng · Tiết kiệm ${formatVnd(annualSavingsVnd)}/năm`
                      : `Only $${details.monthly_equivalent_usd}/mo · Save $${details.annual_savings_usd}/yr`}
                  </span>
                </div>
              )}
            </div>

            {/* Promo Code Box */}
            <div
              className="p-3.5 rounded-2xl bg-white/95 dark:bg-slate-900/90 border border-[#E7E3D9] dark:border-slate-800 shadow-sm space-y-2.5"
              data-testid="checkout-promo-section"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                  {lang === 'vi' ? 'Mã giảm giá' : 'Promo Code'}
                </span>
              </div>

              {details.promo_code ? (
                <div
                  className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300"
                  data-testid="checkout-applied-promo-badge"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded bg-emerald-600 text-white dark:bg-emerald-500/25 font-mono text-xs font-bold tracking-wider dark:text-emerald-200">
                        {details.promo_code}
                      </span>
                      <span className="text-xs font-mono font-semibold text-emerald-700 dark:text-emerald-300">
                        {lang === 'vi'
                          ? `-${formatVnd(discountVnd)} (-$${discountUsd.toFixed(2)})`
                          : `-$${discountUsd.toFixed(2)} USD`}
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
                    aria-label={lang === 'vi' ? 'Gỡ mã giảm giá' : 'Remove promo code'}
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
                            .replace(/[^A-Z0-9_-]/g, '')
                            .slice(0, 32),
                        );
                        setPromoError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleApplyPromoCode();
                        }
                      }}
                      maxLength={32}
                      placeholder={
                        lang === 'vi'
                          ? 'Nhập mã giảm giá (6 ký tự)'
                          : 'Enter 6-character promo code'
                      }
                      data-testid="checkout-promo-input"
                      className="h-9 bg-[#FBFAF6] dark:bg-slate-950 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white font-mono text-xs uppercase tracking-wider placeholder:text-slate-400 dark:placeholder:text-slate-500 rounded-xl"
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

                  {/* Neutral Demo Promo Chips (only in explicit evaluator demo mode) */}
                  {showEvaluatorPromoHints && (
                    <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                      <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                        {lang === 'vi' ? 'Thử nhanh:' : 'Try:'}
                      </span>
                      {[
                        { code: 'CITRA2', label: '-20%' },
                        {
                          code: 'SAVE10',
                          label: lang === 'vi' ? `-${formatVnd(10 * usdToVndRate)}` : '-$10',
                        },
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
                  )}
                </div>
              )}

              {promoError && (
                <p
                  className="text-[11px] text-red-600 dark:text-red-400 flex items-center gap-1.5 pt-0.5"
                  data-testid="checkout-promo-error"
                >
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>{renderPromoErrorText(promoError)}</span>
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
              <div className="flex items-center justify-between gap-2 text-slate-600 dark:text-slate-300">
                <span>
                  {displayPlanName} ({billingCycleLabel})
                </span>
                <span
                  className="font-mono font-medium text-slate-900 dark:text-slate-200 whitespace-nowrap"
                  data-testid="checkout-subtotal-display"
                >
                  {lang === 'vi' ? formatVnd(subtotalVnd) : `$${subtotalUsd.toFixed(2)}`}
                </span>
              </div>
              {details.annual_savings_usd > 0 && (
                <div className="flex items-center justify-between gap-2 text-emerald-700 dark:text-emerald-400 font-medium">
                  <span>
                    {lang === 'vi'
                      ? 'Ưu đãi chu kỳ năm (-20%)'
                      : 'Annual Billing Discount (20%)'}
                  </span>
                  <span className="font-mono text-right">
                    {lang === 'vi'
                      ? `Đã áp dụng ưu đãi (-${formatVnd(annualSavingsVnd)})`
                      : `Included (-$${details.annual_savings_usd}.00)`}
                  </span>
                </div>
              )}
              {discountUsd > 0 && (
                <div
                  className="flex items-center justify-between gap-2 text-emerald-700 dark:text-emerald-400 font-medium"
                  data-testid="checkout-discount-row"
                >
                  <span>
                    {lang === 'vi' ? 'Mã giảm giá' : 'Promo Code'} (
                    {details.promo_code})
                  </span>
                  <span className="font-mono whitespace-nowrap">
                    {lang === 'vi' ? `-${formatVnd(discountVnd)}` : `-$${discountUsd.toFixed(2)}`}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 pt-3 border-t border-[#E7E3D9] dark:border-slate-800 text-sm font-bold text-slate-900 dark:text-white">
                <span>
                  {lang === 'vi' ? 'Tổng thanh toán hôm nay' : 'Total due today'}
                </span>
                <span
                  className="font-mono whitespace-nowrap"
                  data-testid="checkout-total-due-display"
                >
                  {lang === 'vi'
                    ? formatVnd(amountVnd)
                    : `$${details.amount_usd.toFixed(2)} USD`}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-[#005BAA] dark:text-sky-300 font-mono font-medium">
                <span>
                  {lang === 'vi'
                    ? 'Quy đổi thẻ quốc tế (USD):'
                    : 'VNPay Gateway Equivalent (VND):'}
                </span>
                <span data-testid="checkout-total-vnd-line" className="whitespace-nowrap">
                  {lang === 'vi' ? (
                    <>
                      ${details.amount_usd.toFixed(2)} USD
                      {discountUsd > 0 ? ` (-$${discountUsd.toFixed(2)})` : ''}
                    </>
                  ) : (
                    <>
                      {formatVnd(amountVnd)}
                      {discountVnd > 0 ? ` (-${formatVnd(discountVnd)})` : ''}
                    </>
                  )}
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
              {lang === 'vi' ? 'Xử lý bởi' : 'Powered by'}{' '}
              <strong className="text-slate-900 dark:text-white">Stripe</strong> &amp;{' '}
              <strong className="text-[#005BAA] dark:text-sky-300">VNPAY</strong>
            </span>
            <span className="font-mono text-[10px]">
              {lang === 'vi' ? 'Bảo mật chuẩn ngân hàng' : 'Bank-grade security'}
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

            {/* Express Checkout Buttons (Desktop/Tablet shortcut; hidden on mobile to avoid duplicate rows above tabs) */}
            <div
              className="hidden sm:block space-y-2"
              data-testid="express-checkout-section"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                  {lang === 'vi'
                    ? 'Thanh toán nhanh 1 chạm'
                    : 'Express One-Click Checkout'}
                </span>
                <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400">
                  {lang === 'vi' ? 'VNPAY-QR · Sinh trắc học' : 'VNPAY-QR · Biometric'}
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
                  className="h-11 rounded-xl bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-900 dark:text-white border-2 border-slate-200 dark:border-slate-700 font-semibold text-sm flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer active:scale-[0.99]"
                >
                  <GooglePaySvg className="w-4 h-4" />
                  <span className="tracking-tight font-sans font-semibold">
                    Google Pay
                  </span>
                </button>
              </div>
            </div>

            {/* Divider (visible on sm+ alongside Express row) */}
            <div className="hidden sm:flex relative items-center py-0.5">
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
              className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700"
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
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-300 shadow-sm ring-1 ring-indigo-500/20 dark:ring-indigo-400/35'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <CreditCard className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{lang === 'vi' ? 'Thẻ quốc tế' : 'Card'}</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={paymentMethod === 'vnpay'}
                data-testid="method-tab-vnpay"
                onClick={() => setPaymentMethod('vnpay')}
                className={`py-2 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  paymentMethod === 'vnpay'
                    ? 'bg-white dark:bg-slate-900 text-[#005BAA] dark:text-sky-300 shadow-sm ring-1 ring-[#005BAA]/25 dark:ring-sky-400/45'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
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
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm ring-1 ring-slate-300 dark:ring-slate-600'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
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
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm ring-1 ring-slate-300 dark:ring-slate-600'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
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
                {/* Collapsible Test Card Helper (only in Sandbox/Demo mode) */}
                {isSandboxMode && (
                  <details className="group rounded-2xl bg-slate-50/90 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 px-3.5 py-2.5">
                    <summary className="list-none flex items-center justify-between gap-2 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer select-none">
                      <span className="inline-flex items-center gap-1.5">
                        <CreditCard className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                        <span>
                          {lang === 'vi'
                            ? 'Hướng dẫn thẻ thử nghiệm'
                            : 'Test card guide'}
                        </span>
                      </span>
                      <ChevronDown className="h-3.5 w-3.5 text-slate-400 transition-transform duration-200 group-open:rotate-180" />
                    </summary>
                    <div className="grid grid-cols-3 gap-2 pt-2.5">
                      <button
                        type="button"
                        data-testid="autofill-visa-btn"
                        onClick={() => handleAutofillTestCard('visa')}
                        className={`py-1.5 px-2.5 rounded-xl text-xs font-mono font-semibold border transition-all cursor-pointer ${
                          cardBrand === 'visa'
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                            : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
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
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                            : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
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
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                            : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        Amex •••• 0005
                      </button>
                    </div>
                  </details>
                )}

                {/* Card Number with Network Detection Badge */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="card-number" className="text-xs font-semibold">
                      {lang === 'vi'
                        ? 'Số thẻ tín dụng / ghi nợ quốc tế'
                        : 'Card number (VISA / Mastercard / Amex / JCB)'}
                    </Label>
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
                      required={!(details.amount_usd <= 0 || details.payment_mode === 'promo_waiver')}
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
                      required={!(details.amount_usd <= 0 || details.payment_mode === 'promo_waiver')}
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
                      required={!(details.amount_usd <= 0 || details.payment_mode === 'promo_waiver')}
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
                    placeholder={lang === 'vi' ? 'HO TEN IN TREN THE' : 'FULL NAME ON CARD'}
                    autoComplete="cc-name"
                    className="text-sm h-11 rounded-xl uppercase"
                    required={!(details.amount_usd <= 0 || details.payment_mode === 'promo_waiver')}
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
                      required={!(details.amount_usd <= 0 || details.payment_mode === 'promo_waiver')}
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
                        ? 'Đang xử lý thanh toán...'
                        : 'Processing payment...'}
                    </>
                  ) : (
                    <>
                      <Lock className="h-4 w-4 mr-2" />
                      {lang === 'vi'
                        ? `Thanh toán ${formatVnd(amountVnd)} & Kích hoạt ${displayPlanName}`
                        : `Pay $${details.amount_usd.toFixed(2)} & Activate ${details.plan_name}`}
                    </>
                  )}
                </Button>
              </form>
            ) : paymentMethod === 'vnpay' ? (
              /* Dedicated VNPay Payment Gateway Panel */
              <div
                className="p-4 sm:p-5 rounded-2xl border border-[#005BAA]/30 dark:border-sky-400/35 bg-gradient-to-b from-sky-50/70 to-white dark:from-slate-900 dark:to-slate-950 space-y-4"
                data-testid="vnpay-tab-panel"
              >
                {/* Header & Amount in VND */}
                <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-200/80 dark:border-slate-700/80">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-10 h-10 rounded-xl bg-white dark:bg-slate-950 border border-sky-200/90 dark:border-sky-400/35 shadow-sm flex items-center justify-center shrink-0"
                      data-testid="vnpay-panel-logo-badge"
                    >
                      <span className="font-sans font-black text-[10px] tracking-tighter leading-none select-none">
                        <span className="text-[#ED1C24]">VN</span>
                        <span className="text-[#005BAA] dark:text-sky-300">PAY</span>
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h3 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                          {lang === 'vi'
                            ? 'Cổng thanh toán VNPAY-QR & ATM'
                            : 'VNPAY-QR & Domestic ATM Gateway'}
                        </h3>
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300">
                        {lang === 'vi'
                          ? 'Hỗ trợ 40+ Ngân hàng Việt Nam (VietQR, NCB, Vietcombank, BIDV, Techcombank...)'
                          : 'Supports 40+ Vietnamese banks via VNPAY-QR, Domestic ATM & International Cards'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* VND Exchange Breakdown Box */}
                <div className="p-3 rounded-xl bg-sky-50/90 dark:bg-slate-950/90 border border-sky-200/80 dark:border-slate-700 text-slate-900 dark:text-white flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-300 block">
                      {lang === 'vi'
                        ? 'Số tiền thanh toán qua VNPay (VND)'
                        : 'VNPay Settlement Amount (VND)'}
                    </span>
                    <span
                      className="font-display text-xl sm:text-2xl font-bold text-emerald-700 dark:text-emerald-300"
                      data-testid="vnpay-panel-amount-vnd"
                    >
                      {formatVnd(amountVnd)}
                    </span>
                  </div>
                  <div className="text-right font-mono text-[11px] text-slate-600 dark:text-slate-200">
                    <div>
                      ${details.amount_usd.toFixed(2)} USD × {formatVnd(usdToVndRate)}
                    </div>
                  </div>
                </div>

                {/* Channel Selector */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-900 dark:text-slate-100">
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
                          ? 'border-[#005BAA] dark:border-sky-400 bg-sky-50/90 dark:bg-sky-950/80 text-[#005BAA] dark:text-sky-100 ring-1 ring-[#005BAA]/30 dark:ring-sky-400/40'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/90 text-slate-700 dark:text-slate-200 hover:border-sky-400/70'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <Building2 className="h-4 w-4 text-[#005BAA] dark:text-sky-300" />
                        <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-200">
                          ATM / NAPAS
                        </span>
                      </div>
                      <p className="text-xs font-bold">
                        {lang === 'vi' ? 'Thẻ ATM nội địa' : 'Domestic ATM Card'}
                      </p>
                      <p className="text-[10px] text-slate-600 dark:text-slate-300">
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
                          ? 'border-[#005BAA] dark:border-sky-400 bg-sky-50/90 dark:bg-sky-950/80 text-[#005BAA] dark:text-sky-100 ring-1 ring-[#005BAA]/30 dark:ring-sky-400/40'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/90 text-slate-700 dark:text-slate-200 hover:border-sky-400/70'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <QrCode className="h-4 w-4 text-[#ED1C24] dark:text-rose-400" />
                        <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-200">
                          VietQR
                        </span>
                      </div>
                      <p className="text-xs font-bold">
                        {lang === 'vi' ? 'Quét mã VNPAY-QR' : 'Scan VNPAY-QR'}
                      </p>
                      <p className="text-[10px] text-slate-600 dark:text-slate-300">
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
                          ? 'border-[#005BAA] dark:border-sky-400 bg-sky-50/90 dark:bg-sky-950/80 text-[#005BAA] dark:text-sky-100 ring-1 ring-[#005BAA]/30 dark:ring-sky-400/40'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/90 text-slate-700 dark:text-slate-200 hover:border-sky-400/70'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <CreditCard className="h-4 w-4 text-indigo-600 dark:text-indigo-300" />
                        <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-200">
                          Visa / MC
                        </span>
                      </div>
                      <p className="text-xs font-bold">
                        {lang === 'vi' ? 'Thẻ quốc tế VNPay' : 'Intl Card via VNPay'}
                      </p>
                      <p className="text-[10px] text-slate-600 dark:text-slate-300">
                        Visa / MC / JCB
                      </p>
                    </button>
                  </div>
                </div>

                {/* Bank Grid Selector (for ATM channel) */}
                {vnpayChannel === 'atm' && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <Label className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {lang === 'vi'
                          ? '2. Chọn ngân hàng thanh toán:'
                          : '2. Select Issuing Bank:'}
                      </Label>
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
                                ? 'border-[#005BAA] dark:border-sky-400 bg-[#005BAA] dark:bg-sky-600 text-white font-bold shadow-sm'
                                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/90 text-slate-700 dark:text-slate-200 hover:border-sky-400'
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

                {/* Collapsible VNPay Test Card Guide (only in Demo/Sandbox mode) */}
                {isSandboxMode && (
                  <details className="group rounded-xl bg-slate-50/90 dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-700 px-3 py-2.5 text-[11px] text-slate-700 dark:text-slate-200">
                    <summary className="list-none flex items-center justify-between gap-2 font-medium cursor-pointer select-none">
                      <span>
                        {lang === 'vi'
                          ? 'Hướng dẫn thẻ thử nghiệm (Ngân hàng NCB)'
                          : 'Test card guide (NCB Bank)'}
                      </span>
                      <ChevronDown className="h-3.5 w-3.5 text-slate-400 transition-transform duration-200 group-open:rotate-180" />
                    </summary>
                    <div className="font-mono text-[11px] grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 text-slate-600 dark:text-slate-300 pt-2">
                      <span>• {lang === 'vi' ? 'Số thẻ' : 'Card'}: 9704198526191432198</span>
                      <span>• {lang === 'vi' ? 'Chủ thẻ' : 'Holder'}: NGUYEN VAN A</span>
                      <span>• {lang === 'vi' ? 'Ngày phát hành' : 'Issued'}: 07/15</span>
                      <span>• OTP: 123456</span>
                    </div>
                  </details>
                )}

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
                        ? 'Đang kết nối cổng thanh toán VNPay...'
                        : 'Opening VNPay Gateway...'}
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
                      ? 'Số thẻ thật của bạn được bảo mật trực tiếp trên thiết bị và không bao giờ chia sẻ với CITRA.'
                      : 'Your real card number stays private on your device and is never shared with CITRA.'}
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
                        ? `Mở Apple Pay · ${formatVnd(amountVnd)}`
                        : `Continue with Apple Pay · $${details.amount_usd.toFixed(2)} USD`}
                    </>
                  ) : (
                    <>
                      <GooglePaySvg className="w-4 h-4 mr-2" />
                      {lang === 'vi'
                        ? `Mở Google Pay · ${formatVnd(amountVnd)}`
                        : `Continue with Google Pay · $${details.amount_usd.toFixed(2)} USD`}
                    </>
                  )}
                </Button>
              </div>
            )}

            {/* Sensitive Payment Data Notice (DLCN-02, Luật 91/2025/QH15 & NĐ 356/2025/NĐ-CP) */}
            <div
              data-testid="checkout-sensitive-data-notice"
              className="rounded-[14px] border border-[#E7E3D9] dark:border-[#332F26] bg-[#F4F2EC]/85 dark:bg-[#1E1C17]/80 p-3.5 flex items-start gap-3 font-solva-sans text-[11.5px] leading-[18px] text-[#56524A] dark:text-[#A8A296]"
            >
              <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-white dark:bg-[#141310] border border-[#E7E3D9] dark:border-[#332F26] text-[#1C1A15] dark:text-[#FBFAF6] shadow-sm">
                <Lock className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <span className="font-medium text-[#1C1A15] dark:text-[#FBFAF6]">
                  {t('privacyCompliance.checkoutSensitiveTitle')}:{' '}
                </span>
                {t('privacyCompliance.checkoutSensitiveBody')}{' '}
                <Link
                  to="/privacy#sensitive-data"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-[#1C1A15] dark:text-[#FBFAF6] underline underline-offset-4 decoration-[#1C1A15]/40 dark:decoration-[#FBFAF6]/40 hover:opacity-75 transition-opacity"
                >
                  <span>{t('privacyCompliance.policyLinkLabel')}</span>
                  <ExternalLink className="h-3 w-3" />
                </Link>
                .
              </div>
            </div>

            <p className="text-[11px] text-center text-slate-500 flex items-center justify-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              {lang === 'vi'
                ? 'Bảo mật thanh toán chuẩn ngân hàng: Không lưu số thẻ hay mã OTP. Nâng cấp tức thì.'
                : 'Bank-grade checkout security: Card numbers and OTP are never stored. Instant upgrade.'}
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
                  <div className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-sm font-black text-xs tracking-tight flex items-center gap-0.5">
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
                        ? 'Thanh toán qua VNPAY'
                        : 'Pay with VNPAY'}
                    </h3>
                    <p className="text-[11px] font-mono text-slate-500">
                      {lang === 'vi' ? 'Mã đơn hàng:' : 'Order ID:'}{' '}
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
                  aria-label={lang === 'vi' ? 'Đóng cổng thanh toán VNPay' : 'Close VNPay modal'}
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Order Amount Summary */}
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
                      ? 'bg-white dark:bg-slate-900 text-[#005BAA] dark:text-sky-400 shadow-sm'
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
                      ? 'bg-white dark:bg-slate-900 text-[#ED1C24] dark:text-rose-400 shadow-sm'
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
                  {/* 1-Click Test Card Helper (only in Demo/Test Mode) */}
                  {isSandboxMode && (
                    <div className="space-y-1.5">
                      <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block">
                        {lang === 'vi'
                          ? 'Chế độ thử nghiệm — điền nhanh thẻ mẫu:'
                          : 'Test mode — quick-fill sample card:'}
                      </span>
                      <div className="grid grid-cols-3 gap-1.5">
                        <button
                          type="button"
                          data-testid="vnpay-testcard-00"
                          onClick={() => handleAutofillVNPayTestCard('00')}
                          className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border transition-all cursor-pointer ${
                            vnpayCardNumber === '9704198526191432198'
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          {lang === 'vi' ? '✓ Thành công' : '✓ Approved'}
                        </button>
                        <button
                          type="button"
                          data-testid="vnpay-testcard-51"
                          onClick={() => handleAutofillVNPayTestCard('51')}
                          className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border transition-all cursor-pointer ${
                            vnpayCardNumber === '9704195798621412'
                              ? 'bg-amber-600 text-white border-amber-600'
                              : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          {lang === 'vi' ? '⚠ Thiếu số dư' : '⚠ Low balance'}
                        </button>
                        <button
                          type="button"
                          data-testid="vnpay-testcard-12"
                          onClick={() => handleAutofillVNPayTestCard('12')}
                          className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border transition-all cursor-pointer ${
                            vnpayCardNumber === '9704193360968149'
                              ? 'bg-rose-600 text-white border-rose-600'
                              : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          {lang === 'vi' ? '✕ Thẻ bị khóa' : '✕ Locked card'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Card Number */}
                  <div className="flex flex-col gap-1">
                    <Label
                      htmlFor="vnpay-card-number"
                      className="text-xs font-semibold flex items-center gap-1 h-4"
                    >
                      {lang === 'vi'
                        ? 'Số thẻ ATM nội địa'
                        : 'Domestic ATM Card Number'}
                    </Label>
                    <Input
                      id="vnpay-card-number"
                      data-testid="vnpay-card-number-input"
                      value={vnpayCardNumber}
                      onChange={(e) =>
                        setVnpayCardNumber(e.target.value.replace(/\D/g, '').slice(0, 19))
                      }
                      placeholder="9704 1985 2619 1432 198"
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
                          ? 'Mã xác thực OTP'
                          : 'OTP Verification Code'}
                      </Label>
                      {isSandboxMode && (
                        <span className="text-[10px] font-mono text-emerald-600">
                          {lang === 'vi' ? 'Mã thử nghiệm: 123456' : 'Test code: 123456'}
                        </span>
                      )}
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
                    <span>{lang === 'vi' ? 'Quét mã VietQR · VNPAY-QR' : 'Scan VietQR · VNPAY-QR'}</span>
                  </div>

                  {/* Real ISO/IEC 18004 QR Code Frame */}
                  <div className="w-44 h-44 mx-auto p-2.5 rounded-2xl bg-white border-2 border-[#005BAA] shadow-md flex flex-col items-center justify-center relative">
                    {(() => {
                      const rawUrl = vnpayGatewayData?.payment_url ?? '';
                      const qrPayload =
                        rawUrl && new TextEncoder().encode(rawUrl).length <= 390
                          ? rawUrl
                          : `vnpay://pay?order=${encodeURIComponent(
                              vnpayGatewayData?.vnp_txn_ref || sessionId,
                            )}&amount=${encodeURIComponent(
                              String(vnpayGatewayData?.vnp_amount || 0),
                            )}`;
                      const qrMatrix = encodeQrMatrix(qrPayload);
                      const quietZone = 2;
                      const viewSize = qrMatrix.length + quietZone * 2;
                      return (
                        <svg
                          data-testid="vnpay-iso-qr-svg"
                          viewBox={`0 0 ${viewSize} ${viewSize}`}
                          shapeRendering="crispEdges"
                          className="w-full h-full text-slate-900"
                          aria-label="VNPAY-QR Code"
                        >
                          <rect x="0" y="0" width={viewSize} height={viewSize} fill="#ffffff" />
                          {qrMatrix.map((row, rIdx) =>
                            row.map((cell, cIdx) =>
                              cell === 1 ? (
                                <rect
                                  key={`${rIdx}-${cIdx}`}
                                  x={cIdx + quietZone}
                                  y={rIdx + quietZone}
                                  width={1}
                                  height={1}
                                  fill="#0f172a"
                                />
                              ) : null,
                            ),
                          )}
                        </svg>
                      );
                    })()}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <span className="px-1.5 py-0.5 rounded bg-white border border-[#005BAA] text-[9px] font-black shadow-sm">
                        <span className="text-[#ED1C24]">VN</span>
                        <span className="text-[#005BAA]">PAY</span>
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-400 max-w-xs mx-auto">
                    {isSandboxMode
                      ? lang === 'vi'
                        ? 'Đây là cổng thanh toán mô phỏng — nhấn nút bên dưới để xác nhận thanh toán thử nghiệm.'
                        : 'This is a test checkout — click below to confirm the test QR payment.'
                      : lang === 'vi'
                        ? 'Mở ứng dụng ngân hàng để quét mã VNPAY-QR, sau đó nhấn xác nhận bên dưới.'
                        : 'Open your banking app to scan the VNPAY-QR code, then click confirm below.'}
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
                        ? 'Đang xác thực giao dịch & kích hoạt gói...'
                        : 'Verifying Payment & Activating Plan...'}
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      {vnpayModalTab === 'qr'
                        ? lang === 'vi'
                          ? `Xác nhận thanh toán VNPAY-QR · ${formatVnd(vnpayGatewayData.amount_vnd)}`
                          : `Confirm VNPAY-QR Payment · ${formatVnd(vnpayGatewayData.amount_vnd)}`
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
            className="fixed inset-0 z-[100] bg-black/65 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
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
                    <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {lang === 'vi' ? 'Thanh toán nhanh bảo mật' : 'Secure Express Checkout'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="wallet-modal-close-btn"
                  onClick={() => setWalletModalMethod(null)}
                  aria-label={lang === 'vi' ? 'Đóng ví điện tử' : 'Close wallet modal'}
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
                    {displayMerchantName}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">
                    {lang === 'vi' ? 'Gói đăng ký:' : 'Subscription:'}
                  </span>
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    {displayPlanName} ({billingCycleLabel})
                  </span>
                </div>
                {details.promo_code && discountUsd > 0 && (
                  <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
                    <span>
                      {lang === 'vi' ? 'Mã giảm giá' : 'Promo'} ({details.promo_code}):
                    </span>
                    <span className="font-mono">
                      {lang === 'vi' ? `-${formatVnd(discountVnd)}` : `-$${discountUsd.toFixed(2)}`}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-white">
                  <span>{lang === 'vi' ? 'Tổng cộng:' : 'Total:'}</span>
                  <span className="font-mono">
                    {lang === 'vi'
                      ? `${formatVnd(amountVnd)} ($${details.amount_usd.toFixed(2)})`
                      : `$${details.amount_usd.toFixed(2)} USD`}
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
                        ? 'Đang xác nhận thanh toán...'
                        : 'Confirming payment...'}
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      {lang === 'vi'
                        ? `Xác nhận thanh toán ${formatVnd(amountVnd)}`
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
            className="fixed inset-0 z-[120] bg-[#FBFAF6]/[0.92] dark:bg-[#141310]/[0.92] backdrop-blur-md flex items-center justify-center p-4"
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
                      <span>{lang === 'vi' ? 'VNPAY ĐÃ XÁC THỰC' : 'VNPAY VERIFIED'}</span>
                    </>
                  ) : celebrationGateway === 'apple_pay' ? (
                    <>
                      <AppleLogoSvg className="w-3.5 h-3.5" />
                      <span>APPLE PAY</span>
                    </>
                  ) : celebrationGateway === 'google_pay' ? (
                    <>
                      <GooglePaySvg className="w-3.5 h-3.5" />
                      <span>GOOGLE PAY</span>
                    </>
                  ) : (
                    <>
                      <Lock className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                      <span>{lang === 'vi' ? 'STRIPE BẢO MẬT' : 'STRIPE SECURED'}</span>
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
                        ? `Đang kích hoạt ${displayPlanName}...`
                        : `Setting up your ${details.plan_name} plan...`
                      : lang === 'vi'
                        ? `Chào mừng đến với ${displayPlanName}!`
                        : `Welcome to ${details.plan_name}!`}
                </h2>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 max-w-sm mx-auto">
                  {celebrationStage === 'verifying'
                    ? lang === 'vi'
                      ? 'Đang xác nhận giao dịch với ngân hàng phát hành.'
                      : 'Confirming your payment with the issuing bank.'
                    : celebrationStage === 'provisioning'
                      ? lang === 'vi'
                        ? 'Mở khóa hạn mức tải bài viết, xuất báo cáo Word/PDF và 15+ thư viện học thuật.'
                        : 'Unlocking higher check limits, Word/PDF exports, and 15+ academic libraries.'
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
                        ? 'bg-emerald-600 border-emerald-600 text-white font-bold shadow-sm'
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
