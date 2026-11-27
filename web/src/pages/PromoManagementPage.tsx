import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Tag,
  Plus,
  Search,
  Loader2,
  X,
  Copy,
  Check,
  Sparkles,
  Pencil,
  Trash2,
  Calendar,
  RefreshCw,
} from 'lucide-react';
import { useRole } from '@/hooks/useRole';
import { useModalA11y } from '@/hooks/useModalA11y';
import { useToast } from '@/contexts/ToastContext';
import {
  api,
  type PromoCodeItem,
  type PromoCodeCreatePayload,
  type PromoSummaryStats,
} from '@/api/client';
import {
  formatLocalizedDate,
  formatUserError,
  resolveAcademicLang,
} from '@/lib/academicTaxonomy';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  StudioWindowHeader,
  SlidingFilterPills,
} from '@/components/ui/studio-visuals';
import {
  DonutChart,
  IconSwap,
  NumberPopIn,
  TactileToggle,
} from '@/components/ui/transitions';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const PROMO_REGEX = /^[A-Z0-9]{6}$/;
const USD_TO_VND_RATE = 25000;

function generateFallback6CharCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i += 1) {
    result += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return result;
}

function getLocalTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Serialize a calendar date (YYYY-MM-DD) as local end-of-day (23:59:59+HH:MM)
 * so Vietnam GMT+7 dates never roll over to +1 day via UTC midnight drift.
 */
function toLocalEndOfDayIso(dateYmd: string): string {
  const [y, m, d] = dateYmd.split('-').map(Number);
  const localEnd = new Date(y, m - 1, d, 23, 59, 59, 0);
  const tzOffsetMin = -localEnd.getTimezoneOffset();
  const sign = tzOffsetMin >= 0 ? '+' : '-';
  const absMin = Math.abs(tzOffsetMin);
  const hh = String(Math.floor(absMin / 60)).padStart(2, '0');
  const mm = String(absMin % 60).padStart(2, '0');
  return `${dateYmd}T23:59:59${sign}${hh}:${mm}`;
}

/**
 * Extract the intended calendar date (YYYY-MM-DD) from a stored promo expires_at
 * string without UTC+7 rollover on legacy UTC midnight/end-of-day sentinels.
 */
function extractPromoExpiryYmd(
  raw: string | null | undefined,
  lang: 'vi' | 'en',
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (
    /^\d{4}-\d{2}-\d{2}(?:$|[T ](?:00:00:00|23:59:59)(?:\.\d+)?(?:Z|\+00:00)?$)/i.test(
      trimmed,
    )
  ) {
    return trimmed.slice(0, 10);
  }
  const dt = new Date(trimmed);
  if (Number.isNaN(dt.getTime())) return trimmed.slice(0, 10);
  if (lang === 'vi') {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(dt);
    const map: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== 'literal') map[part.type] = part.value;
    }
    if (map.year && map.month && map.day) {
      return `${map.year}-${map.month}-${map.day}`;
    }
  }
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatPromoExpiryDate(
  raw: string | null | undefined,
  lang: 'vi' | 'en',
): string {
  const ymd = extractPromoExpiryYmd(raw, lang);
  if (!ymd) return '—';
  return formatLocalizedDate(ymd, lang);
}

/** Format USD amount cleanly without rounding fractional cents (e.g. $12.50 -> $12.50, $20.00 -> $20). */
function formatUsdAmount(value: number): string {
  if (!Number.isFinite(value)) return '$0';
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? `$${rounded}` : `$${rounded.toFixed(2)}`;
}

function formatVndApprox(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '';
  const vnd = Math.round(usd * USD_TO_VND_RATE);
  return `≈ ${vnd.toLocaleString('vi-VN')} ₫`;
}

export function PromoManagementPage() {
  const { i18n } = useTranslation();
  const lang = resolveAcademicLang(i18n.resolvedLanguage || i18n.language);
  const { isAdmin } = useRole();
  const toast = useToast();
  const navigate = useNavigate();

  const [promos, setPromos] = useState<PromoCodeItem[]>([]);
  const [stats, setStats] = useState<PromoSummaryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'percent' | 'fixed'>('all');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'active' | 'paused' | 'ended'
  >('all');

  // Create / Edit Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPromo, setEditingPromo] = useState<PromoCodeItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [formError, setFormError] = useState('');
  const [codeError, setCodeError] = useState('');
  const [expiresError, setExpiresError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{
    discountValue?: string;
    maxDiscountUsd?: string;
    minOrderUsd?: string;
    maxUses?: string;
    maxUsesPerUser?: string;
  }>({});

  // Form fields
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('percent');
  const [discountValue, setDiscountValue] = useState('20');
  const [maxDiscountUsd, setMaxDiscountUsd] = useState('');
  const [minOrderUsd, setMinOrderUsd] = useState('0');
  const [applicableTiers, setApplicableTiers] = useState<'all' | 'pro' | 'ultra'>('all');
  const [applicableCycles, setApplicableCycles] = useState<'all' | 'monthly' | 'annual'>('all');
  const [maxUses, setMaxUses] = useState('');
  const [maxUsesPerUser, setMaxUsesPerUser] = useState('1');
  const [expiresAt, setExpiresAt] = useState('');
  const [isActive, setIsActive] = useState(true);

  // Delete confirmation state
  const [deletingPromo, setDeletingPromo] = useState<PromoCodeItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const todayIso = useMemo(() => getLocalTodayIso(), []);

  const formDialog = useModalA11y(modalOpen, () => setModalOpen(false), {
    disableEscape: submitting,
  });
  const deleteDialog = useModalA11y(Boolean(deletingPromo), () => setDeletingPromo(null), {
    disableEscape: deleting,
  });

  useEffect(() => {
    if (!isAdmin) {
      navigate('/dashboard', { replace: true });
    }
  }, [isAdmin, navigate]);

  const loadPromos = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.listAdminPromoCodes();
      setPromos(res.promos || []);
      if (res.stats) {
        setStats(res.stats);
      }
    } catch (err) {
      setError(
        formatUserError(
          err,
          lang,
          lang === 'vi'
            ? 'Không thể tải danh sách mã giảm giá.'
            : 'Failed to load promo codes.',
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [lang]);

  useEffect(() => {
    void loadPromos();
  }, [loadPromos]);

  const openCreateModal = () => {
    setEditingPromo(null);
    setCode('');
    setDescription('');
    setDiscountType('percent');
    setDiscountValue('20');
    setMaxDiscountUsd('');
    setMinOrderUsd('0');
    setApplicableTiers('all');
    setApplicableCycles('all');
    setMaxUses('');
    setMaxUsesPerUser('1');
    setExpiresAt('');
    setIsActive(true);
    setFormError('');
    setCodeError('');
    setExpiresError('');
    setFieldErrors({});
    setModalOpen(true);
  };

  const openEditModal = (promo: PromoCodeItem) => {
    setEditingPromo(promo);
    setCode(promo.code);
    setDescription(promo.description || '');
    setDiscountType(promo.discount_type);
    setDiscountValue(String(promo.discount_value));
    setMaxDiscountUsd(
      promo.max_discount_usd != null ? String(promo.max_discount_usd) : '',
    );
    setMinOrderUsd(String(promo.min_amount_usd ?? 0));
    setApplicableTiers((promo.applicable_tiers as 'all' | 'pro' | 'ultra') || 'all');
    setApplicableCycles(
      (promo.applicable_cycles as 'all' | 'monthly' | 'annual') || 'all',
    );
    setMaxUses(promo.max_uses != null ? String(promo.max_uses) : '');
    setMaxUsesPerUser(String(promo.max_uses_per_user ?? 1));
    setExpiresAt(extractPromoExpiryYmd(promo.expires_at, lang) ?? '');
    setIsActive(promo.is_active);
    setFormError('');
    setCodeError('');
    setExpiresError('');
    setFieldErrors({});
    setModalOpen(true);
  };

  const handleGenerateRandomCode = async () => {
    setGeneratingCode(true);
    setFormError('');
    setCodeError('');
    try {
      const res = await api.generateAdminPromoCode();
      setCode(res.code.toUpperCase().slice(0, 6));
    } catch {
      setCode(generateFallback6CharCode());
    } finally {
      setGeneratingCode(false);
    }
  };

  const handleCopyCode = async (targetCode: string) => {
    try {
      await navigator.clipboard?.writeText(targetCode);
    } catch {
      // ignore clipboard errors in headless environments
    }
    setCopiedCode(targetCode);
    toast.success(
      lang === 'vi' ? 'Đã sao chép mã khuyến mãi' : 'Promo Code Copied',
      targetCode,
    );
    setTimeout(() => {
      setCopiedCode((prev) => (prev === targetCode ? null : prev));
    }, 1800);
  };

  const handleToggleActive = async (promo: PromoCodeItem) => {
    if (promo.is_expired || promo.is_exhausted) {
      toast.info(
        lang === 'vi'
          ? 'Không thể bật/tắt mã đã kết thúc'
          : 'Cannot toggle ended promo code',
        promo.is_expired
          ? lang === 'vi'
            ? `Mã ${promo.code} đã hết hạn — hãy bấm Chỉnh sửa để gia hạn ngày sử dụng.`
            : `${promo.code} has expired — click Edit to extend its expiration date.`
          : lang === 'vi'
            ? `Mã ${promo.code} đã hết lượt dùng — hãy bấm Chỉnh sửa để tăng giới hạn lượt.`
            : `${promo.code} is depleted — click Edit to increase its usage limit.`,
      );
      return;
    }

    try {
      const updated = await api.updateAdminPromoCode(promo.id, {
        is_active: !promo.is_active,
      });
      setPromos((prev) => prev.map((item) => (item.id === promo.id ? updated : item)));
      if (updated.is_expired || updated.is_exhausted) {
        toast.info(
          lang === 'vi' ? 'Đã lưu trạng thái mã' : 'Promo Status Saved',
          `${promo.code} · ${
            updated.is_expired
              ? lang === 'vi'
                ? 'Hết hạn'
                : 'Expired'
              : lang === 'vi'
                ? 'Hết lượt'
                : 'Depleted'
          }`,
        );
      } else {
        toast.success(
          lang === 'vi' ? 'Đã cập nhật trạng thái mã' : 'Promo Status Updated',
          `${promo.code} · ${
            updated.is_active
              ? lang === 'vi'
                ? 'Đang chạy'
                : 'Active'
              : lang === 'vi'
                ? 'Tạm dừng'
                : 'Paused'
          }`,
        );
      }
    } catch (err) {
      setError(
        formatUserError(
          err,
          lang,
          lang === 'vi'
            ? 'Không thể cập nhật trạng thái mã giảm giá.'
            : 'Failed to toggle promo code status.',
        ),
      );
    }
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setCodeError('');
    setExpiresError('');
    setFieldErrors({});

    const normalizedCode = code.trim().toUpperCase();
    if (!editingPromo && !PROMO_REGEX.test(normalizedCode)) {
      const msg =
        normalizedCode.length > 6
          ? lang === 'vi'
            ? `Mã giảm giá phải gồm đúng 6 ký tự chữ in hoa hoặc số (A-Z, 0-9). Hiện đang có ${normalizedCode.length} ký tự.`
            : `Promo code must be exactly 6 uppercase alphanumeric characters (A-Z, 0-9). Currently ${normalizedCode.length} characters.`
          : lang === 'vi'
            ? 'Mã giảm giá phải gồm đúng 6 ký tự chữ in hoa hoặc số (A-Z, 0-9).'
            : 'Promo code must be exactly 6 uppercase alphanumeric characters (A-Z, 0-9).';
      setCodeError(msg);
      return;
    }

    const parsedValue = Number(discountValue);
    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
      setFieldErrors({
        discountValue:
          lang === 'vi'
            ? 'Giá trị giảm giá phải lớn hơn 0.'
            : 'Discount value must be greater than 0.',
      });
      return;
    }
    if (discountType === 'percent' && parsedValue > 100) {
      setFieldErrors({
        discountValue:
          lang === 'vi'
            ? 'Phần trăm giảm giá không được vượt quá 100%.'
            : 'Percentage discount cannot exceed 100%.',
      });
      return;
    }

    const parsedMaxDiscount =
      maxDiscountUsd.trim() !== '' ? Number(maxDiscountUsd) : null;
    if (
      parsedMaxDiscount !== null &&
      (!Number.isFinite(parsedMaxDiscount) || parsedMaxDiscount <= 0)
    ) {
      setFieldErrors({
        maxDiscountUsd:
          lang === 'vi'
            ? 'Mức giảm tối đa (USD) phải lớn hơn 0.'
            : 'Max discount cap (USD) must be greater than 0.',
      });
      return;
    }

    const parsedMinOrder = minOrderUsd.trim() !== '' ? Number(minOrderUsd) : 0;
    if (!Number.isFinite(parsedMinOrder) || parsedMinOrder < 0) {
      setFieldErrors({
        minOrderUsd:
          lang === 'vi'
            ? 'Giá trị đơn tối thiểu không hợp lệ.'
            : 'Minimum order amount must be 0 or greater.',
      });
      return;
    }

    const parsedMaxUses = maxUses.trim() !== '' ? parseInt(maxUses, 10) : null;
    if (
      parsedMaxUses !== null &&
      (!Number.isFinite(parsedMaxUses) || parsedMaxUses < 1)
    ) {
      setFieldErrors({
        maxUses:
          lang === 'vi'
            ? 'Giới hạn lượt dùng tối đa phải từ 1 trở lên.'
            : 'Global max uses must be at least 1.',
      });
      return;
    }

    const parsedPerUser =
      maxUsesPerUser.trim() !== '' ? parseInt(maxUsesPerUser, 10) : 1;
    if (!Number.isFinite(parsedPerUser) || parsedPerUser < 1) {
      setFieldErrors({
        maxUsesPerUser:
          lang === 'vi'
            ? 'Giới hạn mỗi người dùng phải từ 1 trở lên.'
            : 'Max uses per user must be at least 1.',
      });
      return;
    }

    const trimmedExpiry = expiresAt.trim();
    const originalExpiry = extractPromoExpiryYmd(editingPromo?.expires_at, lang) ?? '';
    if (
      trimmedExpiry &&
      trimmedExpiry < todayIso &&
      (!editingPromo || trimmedExpiry !== originalExpiry)
    ) {
      const msg =
        lang === 'vi'
          ? 'Ngày hết hạn không thể ở trong quá khứ.'
          : 'Expiration date cannot be in the past.';
      setExpiresError(msg);
      return;
    }

    const expiresIso = trimmedExpiry ? toLocalEndOfDayIso(trimmedExpiry) : null;

    setSubmitting(true);
    try {
      if (editingPromo) {
        const updated = await api.updateAdminPromoCode(editingPromo.id, {
          description: description.trim() || null,
          discount_type: discountType,
          discount_value: parsedValue,
          max_discount_usd: discountType === 'percent' ? parsedMaxDiscount : null,
          min_amount_usd: parsedMinOrder,
          applicable_tiers: applicableTiers,
          applicable_cycles: applicableCycles,
          max_uses: parsedMaxUses,
          max_uses_per_user: parsedPerUser,
          expires_at: expiresIso,
          is_active: isActive,
        });
        setPromos((prev) =>
          prev.map((item) => (item.id === editingPromo.id ? updated : item)),
        );
        toast.success(
          lang === 'vi' ? 'Đã cập nhật mã giảm giá' : 'Promo Code Updated',
          updated.code,
        );
      } else {
        const payload: PromoCodeCreatePayload = {
          code: normalizedCode,
          description: description.trim() || null,
          discount_type: discountType,
          discount_value: parsedValue,
          max_discount_usd: discountType === 'percent' ? parsedMaxDiscount : null,
          min_amount_usd: parsedMinOrder,
          applicable_tiers: applicableTiers,
          applicable_cycles: applicableCycles,
          max_uses: parsedMaxUses,
          max_uses_per_user: parsedPerUser,
          expires_at: expiresIso,
          is_active: isActive,
        };
        const created = await api.createAdminPromoCode(payload);
        setPromos((prev) => [created, ...prev]);
        toast.success(
          lang === 'vi' ? 'Đã tạo mã giảm giá mới' : 'Promo Code Created',
          `${created.code} · ${
            created.discount_type === 'percent'
              ? lang === 'vi'
                ? `Giảm ${created.discount_value}%`
                : `${created.discount_value}% off`
              : lang === 'vi'
                ? `Giảm ${formatUsdAmount(created.discount_value)}`
                : `${formatUsdAmount(created.discount_value)} off`
          }`,
        );
      }
      setModalOpen(false);
    } catch (err) {
      setFormError(
        formatUserError(
          err,
          lang,
          lang === 'vi'
            ? 'Không thể lưu mã giảm giá.'
            : 'Failed to save promo code.',
        ),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingPromo) return;
    setDeleting(true);
    try {
      const targetCode = deletingPromo.code;
      await api.deleteAdminPromoCode(deletingPromo.id);
      setPromos((prev) => prev.filter((item) => item.id !== deletingPromo.id));
      setDeletingPromo(null);
      toast.info(
        lang === 'vi' ? 'Đã xóa mã giảm giá' : 'Promo Code Deleted',
        targetCode,
      );
    } catch (err) {
      setError(
        formatUserError(
          err,
          lang,
          lang === 'vi'
            ? 'Không thể xóa mã giảm giá.'
            : 'Failed to delete promo code.',
        ),
      );
    } finally {
      setDeleting(false);
    }
  };

  const filtered = promos.filter((p) => {
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      p.code.toLowerCase().includes(q) ||
      (p.description ?? '').toLowerCase().includes(q);
    const matchesType = typeFilter === 'all' || p.discount_type === typeFilter;
    const isEnded = p.is_expired || p.is_exhausted;
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && p.is_active && !isEnded) ||
      (statusFilter === 'paused' && !p.is_active && !isEnded) ||
      (statusFilter === 'ended' && isEnded);
    return matchesSearch && matchesType && matchesStatus;
  });

  const hasActiveFilters =
    Boolean(searchQuery.trim()) ||
    typeFilter !== 'all' ||
    statusFilter !== 'all';

  const resetFilters = () => {
    setSearchQuery('');
    setTypeFilter('all');
    setStatusFilter('all');
  };

  const activeCount = promos.filter(
    (p) => p.is_active && !p.is_expired && !p.is_exhausted,
  ).length;
  const pausedCount = promos.filter(
    (p) => !p.is_active && !p.is_expired && !p.is_exhausted,
  ).length;
  const endedCount = promos.filter((p) => p.is_expired || p.is_exhausted).length;
  const totalRedemptions = promos.reduce((acc, p) => acc + (p.used_count || 0), 0);
  const totalSavedUsd = stats?.total_discount_usd ?? 0;

  const formatDiscountBadge = (promo: PromoCodeItem) => {
    if (promo.discount_type === 'percent') {
      const cap =
        promo.max_discount_usd != null
          ? lang === 'vi'
            ? ` (tối đa ${formatUsdAmount(promo.max_discount_usd)})`
            : ` (max ${formatUsdAmount(promo.max_discount_usd)})`
          : '';
      return `-${promo.discount_value}%${cap}`;
    }
    return `-$${promo.discount_value.toFixed(2)}`;
  };

  const formatScopeLabel = (promo: PromoCodeItem) => {
    const tierLabel =
      promo.applicable_tiers === 'all'
        ? lang === 'vi'
          ? 'Mọi gói'
          : 'All Plans'
        : promo.applicable_tiers === 'pro'
          ? lang === 'vi'
            ? 'Gói Pro'
            : 'CITRA Pro'
        : promo.applicable_tiers === 'ultra'
          ? lang === 'vi'
            ? 'Gói Ultra'
            : 'CITRA Ultra'
          : String(promo.applicable_tiers).toUpperCase();
    const cycleLabel =
      promo.applicable_cycles === 'all'
        ? lang === 'vi'
          ? 'Mọi chu kỳ'
          : 'All Cycles'
        : promo.applicable_cycles === 'annual'
          ? lang === 'vi'
            ? 'Theo năm'
            : 'Annual'
          : lang === 'vi'
            ? 'Theo tháng'
            : 'Monthly';
    return `${tierLabel} · ${cycleLabel}`;
  };

  const normalizedLiveCode = code.trim().toUpperCase();
  const hasInvalidCodeChars =
    !editingPromo &&
    normalizedLiveCode.length > 0 &&
    /[^A-Z0-9]/.test(normalizedLiveCode);
  const isCodeTooLong = !editingPromo && normalizedLiveCode.length > 6;
  const inlineCodeHint = codeError
    ? codeError
    : isCodeTooLong
      ? lang === 'vi'
        ? `Mã ưu đãi phải gồm đúng 6 ký tự (đang nhập ${normalizedLiveCode.length} ký tự).`
        : `Promo code must be exactly 6 characters (${normalizedLiveCode.length} entered).`
      : hasInvalidCodeChars
        ? lang === 'vi'
          ? 'Chỉ cho phép chữ cái in hoa (A-Z) và chữ số (0-9).'
          : 'Only uppercase letters (A-Z) and digits (0-9) are allowed.'
        : '';

  return (
    <div className="space-y-5 pb-10">
      {/* Clean Header */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 flex items-center justify-center shrink-0">
            <Tag className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
              {lang === 'vi' ? 'Mã giảm giá' : 'Promo Codes'}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {lang === 'vi'
                ? 'Tạo mã giảm giá, quản lý giới hạn áp dụng và theo dõi lượt sử dụng.'
                : 'Create promo codes, manage usage limits, and track redemptions.'}
            </p>
          </div>
        </div>

        <Button
          size="sm"
          data-testid="create-promo-btn"
          onClick={openCreateModal}
          className="gap-2 rounded-xl h-9 shadow-sm shrink-0 cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          {lang === 'vi' ? 'Tạo mã giảm giá' : 'Create Promo Code'}
        </Button>
      </div>

      {/* Promo Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <Card className="lg:col-span-4 p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm flex items-center gap-4">
          <DonutChart
            size={78}
            thickness={10}
            segments={
              promos.length > 0
                ? [
                    { value: activeCount, color: '#10b981' },
                    { value: pausedCount, color: '#f59e0b' },
                    { value: endedCount, color: '#94a3b8' },
                  ]
                : [{ value: 1, color: '#cbd5e1' }]
            }
            centerContent={
              <span className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                <NumberPopIn value={activeCount} />
              </span>
            }
          />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">
              {lang === 'vi' ? 'Tổng quan mã khuyến mãi' : 'Promo Overview'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {lang === 'vi'
                ? `${activeCount} đang chạy · ${pausedCount} tạm dừng${
                    endedCount > 0 ? ` · ${endedCount} hết hạn / hết lượt` : ''
                  }`
                : `${activeCount} active · ${pausedCount} paused${
                    endedCount > 0 ? ` · ${endedCount} expired / depleted` : ''
                  }`}
            </p>
          </div>
        </Card>

        <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-4 gap-3.5">
          <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm flex flex-col justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {lang === 'vi' ? 'Tổng số mã' : 'Total Codes'}
            </span>
            <p
              data-testid="kpi-total-promos"
              className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100"
            >
              <NumberPopIn value={promos.length} />
            </p>
          </Card>

          <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm flex flex-col justify-between">
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              {lang === 'vi' ? 'Đang chạy' : 'Active'}
            </span>
            <p
              data-testid="kpi-active-promos"
              className="mt-2 text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400"
            >
              <NumberPopIn value={activeCount} />
            </p>
          </Card>

          <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm flex flex-col justify-between">
            <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
              {lang === 'vi' ? 'Lượt đã dùng' : 'Total Uses'}
            </span>
            <p
              data-testid="kpi-total-redemptions"
              className="mt-2 text-2xl font-bold font-mono tabular-nums text-indigo-600 dark:text-indigo-400"
            >
              <NumberPopIn value={totalRedemptions} />
            </p>
          </Card>

          <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm flex flex-col justify-between">
            <span className="text-xs font-medium text-violet-600 dark:text-violet-400">
              {lang === 'vi' ? 'Tổng tiền đã giảm' : 'Total Discounts Given'}
            </span>
            <div className="mt-2">
              <p className="text-2xl font-bold font-mono tabular-nums text-violet-600 dark:text-violet-400">
                ${totalSavedUsd.toFixed(2)}
              </p>
              {lang === 'vi' && totalSavedUsd > 0 && (
                <p className="text-[11px] font-mono text-slate-400 dark:text-slate-500 mt-0.5">
                  {formatVndApprox(totalSavedUsd)}
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="p-4 rounded-2xl">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Promo Campaigns Studio */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <StudioWindowHeader
          title={lang === 'vi' ? 'DANH SÁCH MÃ GIẢM GIÁ' : 'PROMO CAMPAIGNS'}
          badge={
            <Badge
              variant="secondary"
              className="font-mono text-[11px] bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60 whitespace-nowrap"
            >
              {filtered.length} / {promos.length}
            </Badge>
          }
          rightSlot={
            <div className="flex flex-wrap items-center gap-2">
              <SlidingFilterPills
                value={statusFilter}
                onChange={setStatusFilter}
                ariaLabel={lang === 'vi' ? 'Lọc trạng thái' : 'Filter status'}
                options={[
                  { key: 'all', label: lang === 'vi' ? 'Tất cả' : 'All' },
                  { key: 'active', label: lang === 'vi' ? 'Đang chạy' : 'Active' },
                  { key: 'paused', label: lang === 'vi' ? 'Tạm dừng' : 'Paused' },
                  {
                    key: 'ended',
                    label: lang === 'vi' ? 'Hết hạn / Hết lượt' : 'Expired / Depleted',
                  },
                ]}
              />
              <button
                type="button"
                onClick={() => void loadPromos()}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                title={lang === 'vi' ? 'Làm mới' : 'Refresh'}
                aria-label={
                  lang === 'vi'
                    ? 'Làm mới danh sách mã giảm giá'
                    : 'Refresh promo codes'
                }
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          }
        />

        {/* Search + Discount Type Pills */}
        <div className="p-4 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/40 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <Input
              type="text"
              data-testid="promo-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                lang === 'vi'
                  ? 'Tìm mã ưu đãi hoặc tên chiến dịch...'
                  : 'Search promo code or campaign...'
              }
              aria-label={
                lang === 'vi'
                  ? 'Tìm mã ưu đãi hoặc tên chiến dịch'
                  : 'Search promo code or campaign'
              }
              className="pl-10 pr-9 rounded-xl"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label={lang === 'vi' ? 'Xóa tìm kiếm' : 'Clear search'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <SlidingFilterPills
            value={typeFilter}
            onChange={setTypeFilter}
            ariaLabel={lang === 'vi' ? 'Loại giảm giá' : 'Discount type'}
            options={[
              { key: 'all', label: lang === 'vi' ? 'Mọi loại' : 'All Types' },
              { key: 'percent', label: '%' },
              { key: 'fixed', label: '$ USD' },
            ]}
          />
        </div>

        {/* Table Content */}
        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center">
            <Loader2 className="h-8 w-8 text-indigo-600 animate-spin mb-4" />
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {lang === 'vi' ? 'Đang tải chiến dịch...' : 'Loading campaigns...'}
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-3">
              <Tag className="h-6 w-6 text-slate-400" />
            </div>
            {promos.length > 0 && hasActiveFilters ? (
              <>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-1">
                  {lang === 'vi'
                    ? 'Không có mã nào khớp bộ lọc'
                    : 'No promo codes match your filters'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto mb-4">
                  {lang === 'vi'
                    ? 'Hãy thử thay đổi từ khóa tìm kiếm hoặc đặt lại bộ lọc.'
                    : 'Try adjusting your search query or resetting active filters.'}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="promo-reset-filters-btn"
                  onClick={resetFilters}
                  className="gap-2 rounded-xl"
                >
                  <X className="h-3.5 w-3.5" />
                  {lang === 'vi' ? 'Xóa bộ lọc' : 'Reset Filters'}
                </Button>
              </>
            ) : (
              <>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-1">
                  {lang === 'vi' ? 'Chưa có mã giảm giá nào' : 'No promo codes yet'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto mb-4">
                  {lang === 'vi'
                    ? 'Tạo mã ưu đãi đầu tiên để áp dụng khi người dùng nâng cấp gói.'
                    : 'Create your first promo code to offer discounts at checkout.'}
                </p>
                <Button size="sm" onClick={openCreateModal} className="gap-2 rounded-xl">
                  <Plus className="h-4 w-4" />
                  {lang === 'vi' ? 'Tạo mã đầu tiên' : 'Create First Promo Code'}
                </Button>
              </>
            )}
          </div>
        ) : (
          <>
            {/* Mobile & Tablet (< lg) Stacked Campaign Cards — Zero Cramped Table Collapse */}
            <div
              data-testid="promo-mobile-cards"
              className="lg:hidden divide-y divide-slate-100 dark:divide-slate-800"
            >
              {filtered.map((promo) => {
                const effectiveActive =
                  promo.is_active && !promo.is_expired && !promo.is_exhausted;
                const isLockedEnded = promo.is_expired || promo.is_exhausted;
                const toggleDisabledTooltip = promo.is_expired
                  ? lang === 'vi'
                    ? 'Mã đã hết hạn — bấm Chỉnh sửa để gia hạn ngày sử dụng'
                    : 'Code has expired — click Edit to extend its expiration date'
                  : promo.is_exhausted
                    ? lang === 'vi'
                      ? 'Mã đã hết lượt dùng — bấm Chỉnh sửa để tăng giới hạn lượt'
                      : 'Code has reached its usage limit — click Edit to increase max uses'
                    : undefined;
                return (
                  <div
                    key={`mobile-${promo.id}`}
                    className="p-4 space-y-3 bg-white dark:bg-slate-900"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50/90 dark:bg-indigo-950/80 border border-dashed border-indigo-300 dark:border-indigo-700 font-mono text-xs font-bold tracking-widest text-indigo-700 dark:text-indigo-300 whitespace-nowrap">
                            <Tag className="h-3 w-3 shrink-0" />
                            {promo.code}
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleCopyCode(promo.code)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            title={lang === 'vi' ? 'Sao chép mã' : 'Copy code'}
                            aria-label={
                              lang === 'vi'
                                ? `Sao chép mã ${promo.code}`
                                : `Copy code ${promo.code}`
                            }
                          >
                            <IconSwap
                              active={copiedCode === promo.code}
                              iconA={<Copy className="h-3.5 w-3.5" />}
                              iconB={<Check className="h-3.5 w-3.5 text-emerald-500" />}
                            />
                          </button>
                        </div>
                        {promo.description && (
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 break-words">
                            {promo.description}
                          </p>
                        )}
                      </div>
                      {effectiveActive ? (
                        <Badge
                          variant="verified"
                          className="px-2 py-0.5 rounded-full text-[11px] shrink-0 whitespace-nowrap"
                        >
                          {lang === 'vi' ? 'Đang chạy' : 'Active'}
                        </Badge>
                      ) : promo.is_expired ? (
                        <Badge
                          variant="destructive"
                          className="px-2 py-0.5 rounded-full text-[11px] shrink-0 whitespace-nowrap"
                        >
                          {lang === 'vi' ? 'Hết hạn' : 'Expired'}
                        </Badge>
                      ) : promo.is_exhausted ? (
                        <Badge
                          variant="destructive"
                          className="px-2 py-0.5 rounded-full text-[11px] shrink-0 whitespace-nowrap"
                        >
                          {lang === 'vi' ? 'Hết lượt' : 'Depleted'}
                        </Badge>
                      ) : (
                        <Badge
                          variant="secondary"
                          className="px-2 py-0.5 rounded-full text-[11px] shrink-0 whitespace-nowrap"
                        >
                          {lang === 'vi' ? 'Tạm dừng' : 'Paused'}
                        </Badge>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-300 font-mono font-bold whitespace-nowrap">
                        {formatDiscountBadge(promo)}
                      </span>
                      <span className="text-slate-600 dark:text-slate-300 font-medium whitespace-nowrap">
                        {formatScopeLabel(promo)}
                      </span>
                      <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap">
                        {promo.used_count} / {promo.max_uses != null ? promo.max_uses : '∞'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                        <Calendar className="h-3 w-3 shrink-0" />
                        {promo.expires_at
                          ? `${lang === 'vi' ? 'Hết hạn:' : 'Expires:'} ${formatPromoExpiryDate(promo.expires_at, lang)}`
                          : lang === 'vi'
                            ? 'Không giới hạn thời gian'
                            : 'No expiry'}
                      </span>
                      <div className="inline-flex items-center gap-2 shrink-0">
                        <span title={toggleDisabledTooltip} className="inline-flex">
                          <TactileToggle
                            checked={effectiveActive}
                            disabled={isLockedEnded}
                            onChange={() => void handleToggleActive(promo)}
                            aria-label={
                              isLockedEnded
                                ? toggleDisabledTooltip
                                : promo.is_active
                                  ? lang === 'vi'
                                    ? `Tạm dừng mã ${promo.code}`
                                    : `Pause promo code ${promo.code}`
                                  : lang === 'vi'
                                    ? `Kích hoạt mã ${promo.code}`
                                    : `Activate promo code ${promo.code}`
                            }
                          />
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openEditModal(promo)}
                          className="h-8 px-2.5 rounded-lg text-xs cursor-pointer"
                          title={lang === 'vi' ? 'Chỉnh sửa' : 'Edit'}
                          aria-label={
                            lang === 'vi'
                              ? `Chỉnh sửa mã ${promo.code}`
                              : `Edit promo code ${promo.code}`
                          }
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setDeletingPromo(promo)}
                          className="h-8 px-2.5 rounded-lg text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/50 cursor-pointer"
                          title={lang === 'vi' ? 'Xóa mã' : 'Delete'}
                          aria-label={
                            lang === 'vi'
                              ? `Xóa mã ${promo.code}`
                              : `Delete promo code ${promo.code}`
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="hidden lg:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/70 dark:bg-slate-800/50">
                    <TableHead className="font-mono text-[11px] uppercase tracking-wider whitespace-nowrap">
                      {lang === 'vi' ? 'Mã ưu đãi' : 'Coupon'}
                    </TableHead>
                    <TableHead className="font-mono text-[11px] uppercase tracking-wider whitespace-nowrap">
                      {lang === 'vi' ? 'Mức giảm' : 'Discount'}
                    </TableHead>
                    <TableHead className="font-mono text-[11px] uppercase tracking-wider whitespace-nowrap">
                      {lang === 'vi' ? 'Phạm vi' : 'Scope'}
                    </TableHead>
                    <TableHead className="font-mono text-[11px] uppercase tracking-wider whitespace-nowrap">
                      {lang === 'vi' ? 'Lượt dùng' : 'Usage'}
                    </TableHead>
                    <TableHead className="font-mono text-[11px] uppercase tracking-wider whitespace-nowrap">
                      {lang === 'vi' ? 'Trạng thái' : 'Status'}
                    </TableHead>
                    <TableHead className="text-right font-mono text-[11px] uppercase tracking-wider whitespace-nowrap">
                      {lang === 'vi' ? 'Thao tác' : 'Actions'}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((promo) => {
                    const effectiveActive =
                      promo.is_active && !promo.is_expired && !promo.is_exhausted;
                    const isLockedEnded = promo.is_expired || promo.is_exhausted;
                    const toggleDisabledTooltip = promo.is_expired
                      ? lang === 'vi'
                        ? 'Mã đã hết hạn — bấm Chỉnh sửa để gia hạn ngày sử dụng'
                        : 'Code has expired — click Edit to extend its expiration date'
                      : promo.is_exhausted
                        ? lang === 'vi'
                          ? 'Mã đã hết lượt dùng — bấm Chỉnh sửa để tăng giới hạn lượt'
                          : 'Code has reached its usage limit — click Edit to increase max uses'
                        : undefined;
                    const usagePct =
                      promo.max_uses != null && promo.max_uses > 0
                        ? Math.min(
                            100,
                            Math.round((promo.used_count / promo.max_uses) * 100),
                          )
                        : 0;
                    const usageBarColor =
                      usagePct >= 100
                        ? 'bg-rose-500'
                        : usagePct >= 80
                          ? 'bg-amber-500'
                          : 'bg-indigo-500';

                    return (
                      <TableRow
                        key={promo.id}
                        data-testid={`promo-row-${promo.code}`}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        {/* Ticket Coupon + Copy */}
                        <TableCell className="align-middle py-3.5">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50/90 dark:bg-indigo-950/80 border border-dashed border-indigo-300 dark:border-indigo-700 font-mono text-xs font-bold tracking-widest text-indigo-700 dark:text-indigo-300 whitespace-nowrap">
                              <Tag className="h-3 w-3 shrink-0" />
                              {promo.code}
                            </span>
                            <button
                              type="button"
                              onClick={() => void handleCopyCode(promo.code)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                              title={lang === 'vi' ? 'Sao chép mã' : 'Copy code'}
                              aria-label={
                                lang === 'vi'
                                  ? `Sao chép mã ${promo.code}`
                                  : `Copy code ${promo.code}`
                              }
                            >
                              <IconSwap
                                active={copiedCode === promo.code}
                                iconA={<Copy className="h-3.5 w-3.5" />}
                                iconB={<Check className="h-3.5 w-3.5 text-emerald-500" />}
                              />
                            </button>
                          </div>
                          {promo.description && (
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xs line-clamp-1">
                              {promo.description}
                            </p>
                          )}
                        </TableCell>

                        {/* Discount — Clean Single Symbol */}
                        <TableCell className="align-middle py-3.5 whitespace-nowrap">
                          <div className="inline-flex items-center px-2.5 py-0.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-300 font-mono text-xs font-bold whitespace-nowrap">
                            {formatDiscountBadge(promo)}
                          </div>
                          {promo.min_amount_usd > 0 && (
                            <div className="text-[11px] text-slate-400 mt-1 whitespace-nowrap">
                              {lang === 'vi'
                                ? `Đơn từ ${formatUsdAmount(promo.min_amount_usd)}`
                                : `Min ${formatUsdAmount(promo.min_amount_usd)}`}
                            </div>
                          )}
                        </TableCell>

                        {/* Scope */}
                        <TableCell className="align-middle py-3.5 whitespace-nowrap">
                          <span className="text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap">
                            {formatScopeLabel(promo)}
                          </span>
                          <div className="text-[11px] text-slate-400 mt-0.5 whitespace-nowrap">
                            {lang === 'vi'
                              ? `${promo.max_uses_per_user} lần / người`
                              : `${promo.max_uses_per_user}x / user`}
                          </div>
                        </TableCell>

                        {/* Usage Progress Bar */}
                        <TableCell className="align-middle py-3.5 whitespace-nowrap">
                          <div className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap">
                            {promo.used_count} /{' '}
                            {promo.max_uses != null ? promo.max_uses : '∞'}
                          </div>
                          {promo.max_uses != null && promo.max_uses > 0 && (
                            <div className="w-24 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mt-1.5">
                              <div
                                className={`h-full rounded-full transition-all ${usageBarColor}`}
                                style={{ width: `${usagePct}%` }}
                              />
                            </div>
                          )}
                        </TableCell>

                        {/* Status & Expiration */}
                        <TableCell className="align-middle py-3.5 whitespace-nowrap">
                          {effectiveActive ? (
                            <Badge
                              variant="verified"
                              className="px-2 py-0.5 rounded-full text-[11px] whitespace-nowrap"
                            >
                              {lang === 'vi' ? 'Đang chạy' : 'Active'}
                            </Badge>
                          ) : promo.is_expired ? (
                            <Badge
                              variant="destructive"
                              className="px-2 py-0.5 rounded-full text-[11px] whitespace-nowrap"
                            >
                              {lang === 'vi' ? 'Hết hạn' : 'Expired'}
                            </Badge>
                          ) : promo.is_exhausted ? (
                            <Badge
                              variant="destructive"
                              className="px-2 py-0.5 rounded-full text-[11px] whitespace-nowrap"
                            >
                              {lang === 'vi' ? 'Hết lượt' : 'Depleted'}
                            </Badge>
                          ) : (
                            <Badge
                              variant="secondary"
                              className="px-2 py-0.5 rounded-full text-[11px] whitespace-nowrap"
                            >
                              {lang === 'vi' ? 'Tạm dừng' : 'Paused'}
                            </Badge>
                          )}
                          <div className="flex items-center gap-1 text-[11px] text-slate-400 mt-1 whitespace-nowrap">
                            <Calendar className="h-3 w-3 shrink-0" />
                            <span>
                              {promo.expires_at
                                ? formatPromoExpiryDate(promo.expires_at, lang)
                                : lang === 'vi'
                                  ? 'Không giới hạn'
                                  : 'No expiry'}
                            </span>
                          </div>
                        </TableCell>

                        {/* TactileToggle + Edit/Delete */}
                        <TableCell className="align-middle py-3.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-2">
                            <span title={toggleDisabledTooltip} className="inline-flex">
                              <TactileToggle
                                checked={effectiveActive}
                                disabled={isLockedEnded}
                                onChange={() => void handleToggleActive(promo)}
                                data-testid={`promo-toggle-${promo.code}`}
                                aria-label={
                                  isLockedEnded
                                    ? toggleDisabledTooltip
                                    : promo.is_active
                                      ? lang === 'vi'
                                        ? `Tạm dừng mã ${promo.code}`
                                        : `Pause promo code ${promo.code}`
                                      : lang === 'vi'
                                        ? `Kích hoạt mã ${promo.code}`
                                        : `Activate promo code ${promo.code}`
                                }
                              />
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              data-testid={`promo-edit-${promo.code}`}
                              onClick={() => openEditModal(promo)}
                              className="h-8 px-2.5 rounded-lg text-xs cursor-pointer"
                              title={lang === 'vi' ? 'Chỉnh sửa' : 'Edit'}
                              aria-label={
                                lang === 'vi'
                                  ? `Chỉnh sửa mã ${promo.code}`
                                  : `Edit promo code ${promo.code}`
                              }
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              data-testid={`promo-delete-${promo.code}`}
                              onClick={() => setDeletingPromo(promo)}
                              className="h-8 px-2.5 rounded-lg text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/50 cursor-pointer"
                              title={lang === 'vi' ? 'Xóa mã' : 'Delete'}
                              aria-label={
                                lang === 'vi'
                                  ? `Xóa mã ${promo.code}`
                                  : `Delete promo code ${promo.code}`
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>

      {/* Create / Edit Promo Code Modal (Sticky Footer + Localized Inline Validation) */}
      {modalOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            data-testid="promo-form-modal"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget && !submitting) setModalOpen(false);
            }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/65 backdrop-blur-sm p-4"
          >
            <div
              {...formDialog.dialogProps}
              className="w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl my-auto outline-none"
            >
              <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
                    <Tag className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <h2
                      id={formDialog.titleId}
                      className="text-base font-bold text-slate-900 dark:text-slate-100 truncate"
                    >
                      {editingPromo
                        ? lang === 'vi'
                          ? `Chỉnh sửa mã ${editingPromo.code}`
                          : `Edit Promo Code ${editingPromo.code}`
                        : lang === 'vi'
                          ? 'Tạo mã giảm giá mới'
                          : 'Create Promo Code'}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {editingPromo
                        ? lang === 'vi'
                          ? 'Cập nhật mức giảm, giới hạn sử dụng hoặc ngày hết hạn của mã.'
                          : 'Update discount rules, usage limits, or expiration date.'
                        : lang === 'vi'
                          ? 'Mã 6 ký tự chữ in hoa & số (A-Z, 0-9)'
                          : '6-character uppercase alphanumeric code (A-Z, 0-9)'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  aria-label={lang === 'vi' ? 'Đóng cửa sổ' : 'Close dialog'}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form
                onSubmit={handleSubmitForm}
                noValidate
                className="flex flex-col flex-1 min-h-0"
              >
                <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
                  {formError && (
                    <Alert
                      variant="destructive"
                      data-testid="promo-form-server-error"
                      className="p-3 rounded-xl"
                    >
                      <AlertDescription className="text-xs">
                        {formError}
                      </AlertDescription>
                    </Alert>
                  )}

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label
                        htmlFor="promo-code-field"
                        className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                      >
                        {editingPromo
                          ? lang === 'vi'
                            ? 'Mã giảm giá (không thể đổi)'
                            : 'Promo Code (cannot be changed)'
                          : lang === 'vi'
                            ? 'Mã giảm giá (6 ký tự) *'
                            : 'Promo Code (6 chars) *'}
                      </label>
                      {!editingPromo && (
                        <span
                          data-testid="promo-code-counter"
                          className={`text-[11px] font-mono ${
                            PROMO_REGEX.test(normalizedLiveCode)
                              ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                              : isCodeTooLong || hasInvalidCodeChars
                                ? 'text-rose-600 dark:text-rose-400 font-semibold'
                                : 'text-slate-400'
                          }`}
                        >
                          {normalizedLiveCode.length}/6
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Input
                        id="promo-code-field"
                        type="text"
                        data-testid="promo-code-input"
                        value={code}
                        disabled={Boolean(editingPromo)}
                        maxLength={16}
                        aria-invalid={Boolean(inlineCodeHint)}
                        onChange={(e) => {
                          setCode(e.target.value.toUpperCase().replace(/\s+/g, ''));
                          if (codeError) setCodeError('');
                          if (formError) setFormError('');
                        }}
                        placeholder={lang === 'vi' ? 'VD: HK1206' : 'e.g. FALL26'}
                        className={`font-mono uppercase tracking-widest text-sm font-bold rounded-xl ${
                          inlineCodeHint
                            ? 'border-rose-400 focus-visible:ring-rose-500/30'
                            : ''
                        }`}
                      />
                      {!editingPromo && (
                        <Button
                          type="button"
                          variant="outline"
                          data-testid="promo-generate-btn"
                          disabled={generatingCode}
                          onClick={() => void handleGenerateRandomCode()}
                          className="shrink-0 gap-1.5 rounded-xl text-xs cursor-pointer"
                        >
                          {generatingCode ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                          )}
                          {lang === 'vi' ? 'Tạo ngẫu nhiên' : 'Auto-Generate'}
                        </Button>
                      )}
                    </div>
                    {inlineCodeHint && (
                      <p
                        role="alert"
                        data-testid="promo-code-inline-error"
                        className="mt-1.5 text-xs text-rose-600 dark:text-rose-400"
                      >
                        {inlineCodeHint}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="promo-description-field"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                    >
                      {lang === 'vi' ? 'Mô tả chiến dịch' : 'Campaign Description'}
                    </label>
                    <Input
                      id="promo-description-field"
                      type="text"
                      data-testid="promo-description-input"
                      value={description}
                      onChange={(e) => {
                        setDescription(e.target.value);
                        if (formError) setFormError('');
                      }}
                      placeholder={
                        lang === 'vi'
                          ? 'VD: Ưu đãi học kỳ mới — Giảm 30%'
                          : 'e.g. Fall Semester Offer — 30% Off'
                      }
                      className="rounded-xl text-sm"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="min-w-0">
                      <label
                        htmlFor="promo-discount-type-field"
                        className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                      >
                        {lang === 'vi' ? 'Loại giảm giá *' : 'Discount Type *'}
                      </label>
                      <Select
                        id="promo-discount-type-field"
                        data-testid="promo-discount-type-select"
                        value={discountType}
                        onChange={(e) => {
                          setDiscountType(e.target.value as 'percent' | 'fixed');
                          if (formError) setFormError('');
                        }}
                        wrapperClassName="w-full"
                        className="rounded-xl w-full"
                      >
                        <option value="percent">
                          {lang === 'vi' ? 'Theo phần trăm (%)' : 'Percentage (%)'}
                        </option>
                        <option value="fixed">
                          {lang === 'vi'
                            ? 'Số tiền cố định ($ USD)'
                            : 'Fixed Amount ($ USD)'}
                        </option>
                      </Select>
                    </div>

                    <div className="min-w-0">
                      <label
                        htmlFor="promo-discount-value-field"
                        className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                      >
                        {discountType === 'percent'
                          ? lang === 'vi'
                            ? 'Mức giảm (%) *'
                            : 'Discount Percentage (%) *'
                          : lang === 'vi'
                            ? 'Số tiền giảm ($ USD) *'
                            : 'Discount Amount ($ USD) *'}
                      </label>
                      <Input
                        id="promo-discount-value-field"
                        type="number"
                        step="0.01"
                        min="0.01"
                        max={discountType === 'percent' ? '100' : undefined}
                        data-testid="promo-discount-value-input"
                        value={discountValue}
                        aria-invalid={Boolean(fieldErrors.discountValue)}
                        onChange={(e) => {
                          setDiscountValue(e.target.value);
                          if (fieldErrors.discountValue) {
                            setFieldErrors((prev) => ({
                              ...prev,
                              discountValue: undefined,
                            }));
                          }
                          if (formError) setFormError('');
                        }}
                        className={`rounded-xl font-mono text-sm ${
                          fieldErrors.discountValue
                            ? 'border-rose-400 focus-visible:ring-rose-500/30'
                            : ''
                        }`}
                      />
                      {fieldErrors.discountValue ? (
                        <p
                          role="alert"
                          className="mt-1 text-[11px] text-rose-600 dark:text-rose-400"
                        >
                          {fieldErrors.discountValue}
                        </p>
                      ) : (
                        lang === 'vi' &&
                        discountType === 'fixed' &&
                        Number(discountValue) > 0 && (
                          <p className="mt-1 text-[11px] font-mono text-slate-400 dark:text-slate-500">
                            {`${formatVndApprox(Number(discountValue))} (quy đổi VNPay tham khảo)`}
                          </p>
                        )
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="min-w-0">
                      <label
                        htmlFor="promo-max-discount-field"
                        className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                      >
                        {lang === 'vi'
                          ? 'Giảm tối đa ($ USD, tùy chọn)'
                          : 'Max Discount Cap ($ USD, optional)'}
                      </label>
                      <Input
                        id="promo-max-discount-field"
                        type="number"
                        step="0.01"
                        min="0"
                        disabled={discountType !== 'percent'}
                        data-testid="promo-max-discount-input"
                        value={maxDiscountUsd}
                        aria-invalid={Boolean(fieldErrors.maxDiscountUsd)}
                        onChange={(e) => {
                          setMaxDiscountUsd(e.target.value);
                          if (fieldErrors.maxDiscountUsd) {
                            setFieldErrors((prev) => ({
                              ...prev,
                              maxDiscountUsd: undefined,
                            }));
                          }
                          if (formError) setFormError('');
                        }}
                        placeholder={
                          discountType === 'percent'
                            ? lang === 'vi'
                              ? 'Không giới hạn'
                              : 'No cap'
                            : lang === 'vi'
                              ? 'Chỉ áp dụng giảm %'
                              : 'Only for % discounts'
                        }
                        className={`rounded-xl font-mono text-sm ${
                          fieldErrors.maxDiscountUsd
                            ? 'border-rose-400 focus-visible:ring-rose-500/30'
                            : ''
                        }`}
                      />
                      {fieldErrors.maxDiscountUsd ? (
                        <p
                          role="alert"
                          className="mt-1 text-[11px] text-rose-600 dark:text-rose-400"
                        >
                          {fieldErrors.maxDiscountUsd}
                        </p>
                      ) : (
                        lang === 'vi' &&
                        discountType === 'percent' &&
                        Number(maxDiscountUsd) > 0 && (
                          <p className="mt-1 text-[11px] font-mono text-slate-400 dark:text-slate-500">
                            {formatVndApprox(Number(maxDiscountUsd))}
                          </p>
                        )
                      )}
                    </div>

                    <div className="min-w-0">
                      <label
                        htmlFor="promo-min-order-field"
                        className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                      >
                        {lang === 'vi'
                          ? 'Đơn tối thiểu ($ USD)'
                          : 'Minimum Order ($ USD)'}
                      </label>
                      <Input
                        id="promo-min-order-field"
                        type="number"
                        step="0.01"
                        min="0"
                        data-testid="promo-min-order-input"
                        value={minOrderUsd}
                        aria-invalid={Boolean(fieldErrors.minOrderUsd)}
                        onChange={(e) => {
                          setMinOrderUsd(e.target.value);
                          if (fieldErrors.minOrderUsd) {
                            setFieldErrors((prev) => ({
                              ...prev,
                              minOrderUsd: undefined,
                            }));
                          }
                          if (formError) setFormError('');
                        }}
                        className={`rounded-xl font-mono text-sm ${
                          fieldErrors.minOrderUsd
                            ? 'border-rose-400 focus-visible:ring-rose-500/30'
                            : ''
                        }`}
                      />
                      {fieldErrors.minOrderUsd ? (
                        <p
                          role="alert"
                          className="mt-1 text-[11px] text-rose-600 dark:text-rose-400"
                        >
                          {fieldErrors.minOrderUsd}
                        </p>
                      ) : (
                        lang === 'vi' &&
                        Number(minOrderUsd) > 0 && (
                          <p className="mt-1 text-[11px] font-mono text-slate-400 dark:text-slate-500">
                            {formatVndApprox(Number(minOrderUsd))}
                          </p>
                        )
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="min-w-0">
                      <label
                        htmlFor="promo-tiers-field"
                        className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                      >
                        {lang === 'vi' ? 'Gói sử dụng áp dụng' : 'Applicable Plans'}
                      </label>
                      <Select
                        id="promo-tiers-field"
                        data-testid="promo-tiers-select"
                        value={applicableTiers}
                        onChange={(e) =>
                          setApplicableTiers(e.target.value as 'all' | 'pro' | 'ultra')
                        }
                        wrapperClassName="w-full"
                        className="rounded-xl w-full"
                      >
                        <option value="all">
                          {lang === 'vi'
                            ? 'Tất cả gói trả phí (Pro & Ultra)'
                            : 'All Paid Plans (Pro & Ultra)'}
                        </option>
                        <option value="pro">
                          {lang === 'vi'
                            ? 'Gói Pro (Nghiên cứu)'
                            : 'CITRA Pro (Research)'}
                        </option>
                        <option value="ultra">
                          {lang === 'vi'
                            ? 'Gói Ultra (Tổ chức / Trường)'
                            : 'CITRA Ultra (Institutional)'}
                        </option>
                      </Select>
                    </div>

                    <div className="min-w-0">
                      <label
                        htmlFor="promo-cycles-field"
                        className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                      >
                        {lang === 'vi'
                          ? 'Chu kỳ thanh toán'
                          : 'Applicable Billing Cycles'}
                      </label>
                      <Select
                        id="promo-cycles-field"
                        data-testid="promo-cycles-select"
                        value={applicableCycles}
                        onChange={(e) =>
                          setApplicableCycles(
                            e.target.value as 'all' | 'monthly' | 'annual',
                          )
                        }
                        wrapperClassName="w-full"
                        className="rounded-xl w-full"
                      >
                        <option value="all">
                          {lang === 'vi'
                            ? 'Mọi chu kỳ (Tháng & Năm)'
                            : 'All Cycles (Monthly & Annual)'}
                        </option>
                        <option value="monthly">
                          {lang === 'vi' ? 'Chỉ gói Tháng' : 'Monthly Only'}
                        </option>
                        <option value="annual">
                          {lang === 'vi' ? 'Chỉ gói Năm' : 'Annual Only'}
                        </option>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="min-w-0">
                      <label
                        htmlFor="promo-max-uses-field"
                        className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                      >
                        {lang === 'vi' ? 'Tổng lượt tối đa' : 'Max Total Uses'}
                      </label>
                      <Input
                        id="promo-max-uses-field"
                        type="number"
                        min="1"
                        data-testid="promo-max-uses-input"
                        value={maxUses}
                        aria-invalid={Boolean(fieldErrors.maxUses)}
                        onChange={(e) => {
                          setMaxUses(e.target.value);
                          if (fieldErrors.maxUses) {
                            setFieldErrors((prev) => ({
                              ...prev,
                              maxUses: undefined,
                            }));
                          }
                          if (formError) setFormError('');
                        }}
                        placeholder={lang === 'vi' ? 'Không giới hạn' : 'Unlimited'}
                        className={`rounded-xl font-mono text-sm ${
                          fieldErrors.maxUses
                            ? 'border-rose-400 focus-visible:ring-rose-500/30'
                            : ''
                        }`}
                      />
                      {fieldErrors.maxUses && (
                        <p
                          role="alert"
                          className="mt-1 text-[11px] text-rose-600 dark:text-rose-400"
                        >
                          {fieldErrors.maxUses}
                        </p>
                      )}
                    </div>

                    <div className="min-w-0">
                      <label
                        htmlFor="promo-max-uses-per-user-field"
                        className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                      >
                        {lang === 'vi' ? 'Lượt / Tài khoản' : 'Max Uses / User'}
                      </label>
                      <Input
                        id="promo-max-uses-per-user-field"
                        type="number"
                        min="1"
                        data-testid="promo-max-uses-per-user-input"
                        value={maxUsesPerUser}
                        aria-invalid={Boolean(fieldErrors.maxUsesPerUser)}
                        onChange={(e) => {
                          setMaxUsesPerUser(e.target.value);
                          if (fieldErrors.maxUsesPerUser) {
                            setFieldErrors((prev) => ({
                              ...prev,
                              maxUsesPerUser: undefined,
                            }));
                          }
                          if (formError) setFormError('');
                        }}
                        className={`rounded-xl font-mono text-sm ${
                          fieldErrors.maxUsesPerUser
                            ? 'border-rose-400 focus-visible:ring-rose-500/30'
                            : ''
                        }`}
                      />
                      {fieldErrors.maxUsesPerUser && (
                        <p
                          role="alert"
                          className="mt-1 text-[11px] text-rose-600 dark:text-rose-400"
                        >
                          {fieldErrors.maxUsesPerUser}
                        </p>
                      )}
                    </div>

                    <div className="min-w-0">
                      <label
                        htmlFor="promo-expires-field"
                        className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                      >
                        {lang === 'vi' ? 'Ngày hết hạn' : 'Expiration Date'}
                      </label>
                      <Input
                        id="promo-expires-field"
                        type="date"
                        min={todayIso}
                        data-testid="promo-expires-input"
                        value={expiresAt}
                        aria-invalid={Boolean(expiresError)}
                        onChange={(e) => {
                          setExpiresAt(e.target.value);
                          if (expiresError) setExpiresError('');
                          if (formError) setFormError('');
                        }}
                        className={`rounded-xl text-sm sm:px-2.5 ${
                          expiresError
                            ? 'border-rose-400 focus-visible:ring-rose-500/30'
                            : ''
                        }`}
                      />
                      {expiresError ? (
                        <p
                          role="alert"
                          className="mt-1 text-[11px] text-rose-600 dark:text-rose-400"
                        >
                          {expiresError}
                        </p>
                      ) : (
                        <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                          {lang === 'vi'
                            ? 'Hết hiệu lực lúc 23:59 cuối ngày đã chọn'
                            : 'Expires at 23:59 on the selected date'}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 pt-1">
                    <TactileToggle
                      id="promo-active-toggle"
                      data-testid="promo-active-checkbox"
                      aria-labelledby="promo-active-label"
                      aria-label={
                        editingPromo
                          ? lang === 'vi'
                            ? 'Đang kích hoạt (áp dụng khi thanh toán)'
                            : 'Active (available at checkout)'
                          : lang === 'vi'
                            ? 'Kích hoạt mã giảm giá ngay lập tức'
                            : 'Enable promo code immediately for checkout'
                      }
                      checked={isActive}
                      onChange={setIsActive}
                      disabled={submitting}
                    />
                    <span
                      id="promo-active-label"
                      className="text-xs font-medium text-slate-700 dark:text-slate-300"
                    >
                      {editingPromo
                        ? lang === 'vi'
                          ? 'Đang kích hoạt (áp dụng khi thanh toán)'
                          : 'Active (available at checkout)'
                        : lang === 'vi'
                          ? 'Kích hoạt mã giảm giá ngay lập tức'
                          : 'Enable promo code immediately for checkout'}
                    </span>
                  </div>
                </div>

                {/* Sticky Modal Footer */}
                <div className="shrink-0 flex items-center justify-end gap-2.5 px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/95">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setModalOpen(false)}
                    className="rounded-xl"
                  >
                    {lang === 'vi' ? 'Hủy' : 'Cancel'}
                  </Button>
                  <Button
                    type="submit"
                    data-testid="promo-submit-btn"
                    disabled={submitting}
                    className="gap-2 rounded-xl cursor-pointer"
                  >
                    {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    {editingPromo
                      ? lang === 'vi'
                        ? 'Lưu thay đổi'
                        : 'Save Changes'
                      : lang === 'vi'
                        ? 'Tạo mã ưu đãi'
                        : 'Create Promo Code'}
                  </Button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )}

      {/* Delete Confirmation Modal */}
      {deletingPromo &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            data-testid="promo-delete-modal"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget && !deleting) setDeletingPromo(null);
            }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/65 backdrop-blur-sm p-4"
          >
            <div
              {...deleteDialog.dialogProps}
              className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-5 space-y-4 outline-none"
            >
              <h3
                id={deleteDialog.titleId}
                className="text-base font-bold text-slate-900 dark:text-slate-100"
              >
                {lang === 'vi'
                  ? `Xóa mã giảm giá ${deletingPromo.code}?`
                  : `Delete promo code ${deletingPromo.code}?`}
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                {lang === 'vi'
                  ? 'Hành động này sẽ xóa vĩnh viễn mã giảm giá khỏi hệ thống. Lịch sử giao dịch đã thanh toán vẫn được giữ nguyên.'
                  : 'This will permanently remove the promo code. Past billing transactions remain intact.'}
              </p>
              <div className="flex items-center justify-end gap-2.5 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDeletingPromo(null)}
                  className="rounded-xl"
                >
                  {lang === 'vi' ? 'Hủy' : 'Cancel'}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  data-testid="promo-confirm-delete-btn"
                  disabled={deleting}
                  onClick={() => void handleConfirmDelete()}
                  className="gap-2 rounded-xl cursor-pointer"
                >
                  {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {lang === 'vi' ? 'Xóa vĩnh viễn' : 'Delete Permanently'}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
export default PromoManagementPage;
