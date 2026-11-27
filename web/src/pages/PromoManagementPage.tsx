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

export function PromoManagementPage() {
  const { i18n } = useTranslation();
  const lang = resolveAcademicLang(i18n.language);
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
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Create / Edit Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPromo, setEditingPromo] = useState<PromoCodeItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [formError, setFormError] = useState('');
  const [codeError, setCodeError] = useState('');
  const [expiresError, setExpiresError] = useState('');

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
    setExpiresAt(promo.expires_at ? promo.expires_at.slice(0, 10) : '');
    setIsActive(promo.is_active);
    setFormError('');
    setCodeError('');
    setExpiresError('');
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
    try {
      const updated = await api.updateAdminPromoCode(promo.id, {
        is_active: !promo.is_active,
      });
      setPromos((prev) => prev.map((item) => (item.id === promo.id ? updated : item)));
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
      setFormError(msg);
      return;
    }

    const parsedValue = Number(discountValue);
    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
      setFormError(
        lang === 'vi'
          ? 'Giá trị giảm giá phải lớn hơn 0.'
          : 'Discount value must be greater than 0.',
      );
      return;
    }
    if (discountType === 'percent' && parsedValue > 100) {
      setFormError(
        lang === 'vi'
          ? 'Phần trăm giảm giá không được vượt quá 100%.'
          : 'Percentage discount cannot exceed 100%.',
      );
      return;
    }

    const parsedMaxDiscount =
      maxDiscountUsd.trim() !== '' ? Number(maxDiscountUsd) : null;
    if (
      parsedMaxDiscount !== null &&
      (!Number.isFinite(parsedMaxDiscount) || parsedMaxDiscount <= 0)
    ) {
      setFormError(
        lang === 'vi'
          ? 'Mức giảm tối đa (USD) phải lớn hơn 0.'
          : 'Max discount cap (USD) must be greater than 0.',
      );
      return;
    }

    const parsedMinOrder = minOrderUsd.trim() !== '' ? Number(minOrderUsd) : 0;
    if (!Number.isFinite(parsedMinOrder) || parsedMinOrder < 0) {
      setFormError(
        lang === 'vi'
          ? 'Giá trị đơn tối thiểu không hợp lệ.'
          : 'Minimum order amount must be 0 or greater.',
      );
      return;
    }

    const parsedMaxUses = maxUses.trim() !== '' ? parseInt(maxUses, 10) : null;
    if (
      parsedMaxUses !== null &&
      (!Number.isFinite(parsedMaxUses) || parsedMaxUses < 1)
    ) {
      setFormError(
        lang === 'vi'
          ? 'Giới hạn lượt dùng tối đa phải từ 1 trở lên.'
          : 'Global max uses must be at least 1.',
      );
      return;
    }

    const parsedPerUser =
      maxUsesPerUser.trim() !== '' ? parseInt(maxUsesPerUser, 10) : 1;
    if (!Number.isFinite(parsedPerUser) || parsedPerUser < 1) {
      setFormError(
        lang === 'vi'
          ? 'Giới hạn mỗi người dùng phải từ 1 trở lên.'
          : 'Max uses per user must be at least 1.',
      );
      return;
    }

    const trimmedExpiry = expiresAt.trim();
    const originalExpiry = editingPromo?.expires_at
      ? editingPromo.expires_at.slice(0, 10)
      : '';
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
      setFormError(msg);
      return;
    }

    const expiresIso = trimmedExpiry ? `${trimmedExpiry}T23:59:59+00:00` : null;

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
          lang === 'vi' ? 'Đã tạo mã khuyến mãi mới' : 'Promo Code Created',
          `${created.code} · ${
            created.discount_type === 'percent'
              ? lang === 'vi'
                ? `Giảm ${created.discount_value}%`
                : `${created.discount_value}% OFF`
              : lang === 'vi'
                ? `Giảm $${created.discount_value}`
                : `$${created.discount_value} OFF`
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
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' &&
        p.is_active &&
        !p.is_expired &&
        !p.is_exhausted) ||
      (statusFilter === 'inactive' &&
        (!p.is_active || p.is_expired || p.is_exhausted));
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
  const pausedOrExpiredCount = Math.max(0, promos.length - activeCount);
  const totalRedemptions = promos.reduce((acc, p) => acc + (p.used_count || 0), 0);
  const totalSavedUsd = stats?.total_discount_usd ?? 0;

  const formatDiscountBadge = (promo: PromoCodeItem) => {
    if (promo.discount_type === 'percent') {
      const cap =
        promo.max_discount_usd != null
          ? lang === 'vi'
            ? ` (tối đa $${promo.max_discount_usd.toFixed(0)})`
            : ` (max $${promo.max_discount_usd.toFixed(0)})`
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
        : promo.applicable_tiers.toUpperCase();
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
                ? 'Tạo mã ưu đãi, theo dõi lượt sử dụng và bật/tắt chiến dịch chỉ với một chạm.'
                : 'Create discount coupons, track redemptions, and toggle campaigns in one click.'}
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
          {lang === 'vi' ? 'Tạo mã ưu đãi' : 'Create Promo Code'}
        </Button>
      </div>

      {/* Campaign Performance Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <Card className="lg:col-span-4 p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm flex items-center gap-4">
          <DonutChart
            size={78}
            thickness={10}
            segments={
              promos.length > 0
                ? [
                    { value: activeCount, color: '#10b981' },
                    { value: pausedOrExpiredCount, color: '#94a3b8' },
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
              {lang === 'vi' ? 'Sức khỏe chiến dịch' : 'Campaign Activity'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {lang === 'vi'
                ? `${activeCount} mã đang chạy · ${pausedOrExpiredCount} tạm dừng / hết hạn`
                : `${activeCount} live · ${pausedOrExpiredCount} paused or expired`}
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
              {lang === 'vi' ? 'Lượt áp dụng' : 'Redemptions'}
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
              {lang === 'vi' ? 'Tổng ưu đãi' : 'Total Saved'}
            </span>
            <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-violet-600 dark:text-violet-400">
              ${totalSavedUsd.toFixed(2)}
            </p>
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
          title={lang === 'vi' ? 'CHIẾN DỊCH MÃ GIẢM GIÁ' : 'PROMO CAMPAIGNS'}
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
                  { key: 'inactive', label: lang === 'vi' ? 'Tạm dừng' : 'Paused' },
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
                          ? `${lang === 'vi' ? 'HSD:' : 'Expires:'} ${formatLocalizedDate(promo.expires_at, lang)}`
                          : lang === 'vi'
                            ? 'Không giới hạn thời gian'
                            : 'No expiry'}
                      </span>
                      <div className="inline-flex items-center gap-2 shrink-0">
                        <TactileToggle
                          checked={promo.is_active}
                          onChange={() => void handleToggleActive(promo)}
                          aria-label={
                            promo.is_active
                              ? lang === 'vi'
                                ? `Tạm dừng mã ${promo.code}`
                                : `Pause promo code ${promo.code}`
                              : lang === 'vi'
                                ? `Kích hoạt mã ${promo.code}`
                                : `Activate promo code ${promo.code}`
                          }
                        />
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
                      {lang === 'vi' ? 'Kích hoạt / Thao tác' : 'Status / Actions'}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((promo) => {
                    const effectiveActive =
                      promo.is_active && !promo.is_expired && !promo.is_exhausted;
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
                                ? `Đơn từ $${promo.min_amount_usd.toFixed(0)}`
                                : `Min $${promo.min_amount_usd.toFixed(0)}`}
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
                                ? formatLocalizedDate(promo.expires_at, lang)
                                : lang === 'vi'
                                  ? 'Không giới hạn'
                                  : 'No expiry'}
                            </span>
                          </div>
                        </TableCell>

                        {/* TactileToggle + Edit/Delete */}
                        <TableCell className="align-middle py-3.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-2">
                            <TactileToggle
                              checked={promo.is_active}
                              onChange={() => void handleToggleActive(promo)}
                              data-testid={`promo-toggle-${promo.code}`}
                              aria-label={
                                promo.is_active
                                  ? lang === 'vi'
                                    ? `Tạm dừng mã ${promo.code}`
                                    : `Pause promo code ${promo.code}`
                                  : lang === 'vi'
                                    ? `Kích hoạt mã ${promo.code}`
                                    : `Activate promo code ${promo.code}`
                              }
                            />
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
                      {lang === 'vi'
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
                    <Alert variant="destructive" className="p-3 rounded-xl">
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
                            ? 'Mã giảm giá (cố định)'
                            : 'Promo Code (read-only)'
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
                        placeholder="CITRA9"
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
                        onChange={(e) => {
                          setDiscountValue(e.target.value);
                          if (formError) setFormError('');
                        }}
                        className="rounded-xl font-mono text-sm"
                      />
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
                        onChange={(e) => {
                          setMaxDiscountUsd(e.target.value);
                          if (formError) setFormError('');
                        }}
                        placeholder={
                          discountType === 'percent'
                            ? lang === 'vi'
                              ? 'Không giới hạn'
                              : 'No cap'
                            : 'N/A'
                        }
                        className="rounded-xl font-mono text-sm"
                      />
                    </div>

                    <div className="min-w-0">
                      <label
                        htmlFor="promo-min-order-field"
                        className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                      >
                        {lang === 'vi'
                          ? 'Đơn tối thiểu ($ USD)'
                          : 'Minimum Order Subtotal ($ USD)'}
                      </label>
                      <Input
                        id="promo-min-order-field"
                        type="number"
                        step="0.01"
                        min="0"
                        data-testid="promo-min-order-input"
                        value={minOrderUsd}
                        onChange={(e) => {
                          setMinOrderUsd(e.target.value);
                          if (formError) setFormError('');
                        }}
                        className="rounded-xl font-mono text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="min-w-0">
                      <label
                        htmlFor="promo-tiers-field"
                        className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                      >
                        {lang === 'vi' ? 'Gói cước áp dụng' : 'Applicable Plan Tiers'}
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
                            ? 'Tất cả gói (Pro & Ultra)'
                            : 'All Paid Plans (Pro & Ultra)'}
                        </option>
                        <option value="pro">Pro Researcher</option>
                        <option value="ultra">Ultra Institutional</option>
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
                        {lang === 'vi' ? 'Tổng lượt tối đa' : 'Global Max Uses'}
                      </label>
                      <Input
                        id="promo-max-uses-field"
                        type="number"
                        min="1"
                        data-testid="promo-max-uses-input"
                        value={maxUses}
                        onChange={(e) => {
                          setMaxUses(e.target.value);
                          if (formError) setFormError('');
                        }}
                        placeholder={lang === 'vi' ? 'Vô hạn (∞)' : 'Unlimited (∞)'}
                        className="rounded-xl font-mono text-sm"
                      />
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
                        onChange={(e) => {
                          setMaxUsesPerUser(e.target.value);
                          if (formError) setFormError('');
                        }}
                        className="rounded-xl font-mono text-sm"
                      />
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
                      {expiresError && (
                        <p
                          role="alert"
                          className="mt-1 text-[11px] text-rose-600 dark:text-rose-400"
                        >
                          {expiresError}
                        </p>
                      )}
                    </div>
                  </div>

                  <label className="flex items-center gap-2.5 pt-1 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      data-testid="promo-active-checkbox"
                      checked={isActive}
                      onChange={(e) => setIsActive(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      {editingPromo
                        ? lang === 'vi'
                          ? 'Đang kích hoạt (áp dụng khi thanh toán)'
                          : 'Active (available at checkout)'
                        : lang === 'vi'
                          ? 'Kích hoạt mã giảm giá ngay lập tức'
                          : 'Enable promo code immediately for checkout'}
                    </span>
                  </label>
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
                  {lang === 'vi' ? 'Xóa vĩnh viễn' : 'Delete Code'}
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
