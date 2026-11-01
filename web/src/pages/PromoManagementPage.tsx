import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Tag,
  Plus,
  Search,
  Loader2,
  X,
  ShieldCheck,
  Terminal,
  Copy,
  Check,
  Sparkles,
  Power,
  Pencil,
  Trash2,
  Percent,
  DollarSign,
  Calendar,
  RefreshCw,
} from 'lucide-react';
import { useRole } from '@/hooks/useRole';
import {
  api,
  type PromoCodeItem,
  type PromoCodeCreatePayload,
  type PromoSummaryStats,
} from '@/api/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
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

export function PromoManagementPage() {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const { isAdmin } = useRole();
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
        err instanceof Error
          ? err.message
          : lang === 'vi'
          ? 'Không thể tải danh sách mã giảm giá.'
          : 'Failed to load promo codes.'
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
    setModalOpen(true);
  };

  const openEditModal = (promo: PromoCodeItem) => {
    setEditingPromo(promo);
    setCode(promo.code);
    setDescription(promo.description || '');
    setDiscountType(promo.discount_type);
    setDiscountValue(String(promo.discount_value));
    setMaxDiscountUsd(promo.max_discount_usd != null ? String(promo.max_discount_usd) : '');
    setMinOrderUsd(String(promo.min_amount_usd ?? 0));
    setApplicableTiers((promo.applicable_tiers as 'all' | 'pro' | 'ultra') || 'all');
    setApplicableCycles((promo.applicable_cycles as 'all' | 'monthly' | 'annual') || 'all');
    setMaxUses(promo.max_uses != null ? String(promo.max_uses) : '');
    setMaxUsesPerUser(String(promo.max_uses_per_user ?? 1));
    setExpiresAt(promo.expires_at ? promo.expires_at.slice(0, 10) : '');
    setIsActive(promo.is_active);
    setFormError('');
    setModalOpen(true);
  };

  const handleGenerateRandomCode = async () => {
    setGeneratingCode(true);
    setFormError('');
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
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : lang === 'vi'
          ? 'Không thể cập nhật trạng thái mã giảm giá.'
          : 'Failed to toggle promo code status.'
      );
    }
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const normalizedCode = code.trim().toUpperCase();
    if (!editingPromo && !PROMO_REGEX.test(normalizedCode)) {
      setFormError(
        lang === 'vi'
          ? 'Mã giảm giá phải gồm đúng 6 ký tự chữ in hoa hoặc số (A-Z, 0-9).'
          : 'Promo code must be exactly 6 uppercase alphanumeric characters (A-Z, 0-9).'
      );
      return;
    }

    const parsedValue = Number(discountValue);
    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
      setFormError(
        lang === 'vi'
          ? 'Giá trị giảm giá phải lớn hơn 0.'
          : 'Discount value must be greater than 0.'
      );
      return;
    }
    if (discountType === 'percent' && parsedValue > 100) {
      setFormError(
        lang === 'vi'
          ? 'Phần trăm giảm giá không được vượt quá 100%.'
          : 'Percentage discount cannot exceed 100%.'
      );
      return;
    }

    const parsedMaxDiscount =
      maxDiscountUsd.trim() !== '' ? Number(maxDiscountUsd) : null;
    if (parsedMaxDiscount !== null && (!Number.isFinite(parsedMaxDiscount) || parsedMaxDiscount <= 0)) {
      setFormError(
        lang === 'vi'
          ? 'Mức giảm tối đa (USD) phải lớn hơn 0.'
          : 'Max discount cap (USD) must be greater than 0.'
      );
      return;
    }

    const parsedMinOrder = minOrderUsd.trim() !== '' ? Number(minOrderUsd) : 0;
    if (!Number.isFinite(parsedMinOrder) || parsedMinOrder < 0) {
      setFormError(
        lang === 'vi'
          ? 'Giá trị đơn tối thiểu không hợp lệ.'
          : 'Minimum order amount must be 0 or greater.'
      );
      return;
    }

    const parsedMaxUses = maxUses.trim() !== '' ? parseInt(maxUses, 10) : null;
    if (parsedMaxUses !== null && (!Number.isFinite(parsedMaxUses) || parsedMaxUses < 1)) {
      setFormError(
        lang === 'vi'
          ? 'Giới hạn lượt dùng tối đa phải từ 1 trở lên.'
          : 'Global max uses must be at least 1.'
      );
      return;
    }

    const parsedPerUser =
      maxUsesPerUser.trim() !== '' ? parseInt(maxUsesPerUser, 10) : 1;
    if (!Number.isFinite(parsedPerUser) || parsedPerUser < 1) {
      setFormError(
        lang === 'vi'
          ? 'Giới hạn mỗi người dùng phải từ 1 trở lên.'
          : 'Max uses per user must be at least 1.'
      );
      return;
    }

    const expiresIso = expiresAt.trim()
      ? `${expiresAt.trim()}T23:59:59+00:00`
      : null;

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
          prev.map((item) => (item.id === editingPromo.id ? updated : item))
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
      }
      setModalOpen(false);
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : lang === 'vi'
          ? 'Không thể lưu mã giảm giá.'
          : 'Failed to save promo code.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingPromo) return;
    setDeleting(true);
    try {
      await api.deleteAdminPromoCode(deletingPromo.id);
      setPromos((prev) => prev.filter((item) => item.id !== deletingPromo.id));
      setDeletingPromo(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : lang === 'vi'
          ? 'Không thể xóa mã giảm giá.'
          : 'Failed to delete promo code.'
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
      (statusFilter === 'active' && p.is_active && !p.is_expired && !p.is_exhausted) ||
      (statusFilter === 'inactive' && (!p.is_active || p.is_expired || p.is_exhausted));
    return matchesSearch && matchesType && matchesStatus;
  });

  const activeCount = promos.filter(
    (p) => p.is_active && !p.is_expired && !p.is_exhausted
  ).length;
  const totalRedemptions = promos.reduce((acc, p) => acc + (p.used_count || 0), 0);
  const totalSavedUsd = stats?.total_discount_usd ?? 0;

  const formatDiscountBadge = (promo: PromoCodeItem) => {
    if (promo.discount_type === 'percent') {
      const cap =
        promo.max_discount_usd != null
          ? ` (max $${promo.max_discount_usd.toFixed(2)})`
          : '';
      return `${promo.discount_value}% OFF${cap}`;
    }
    return `$${promo.discount_value.toFixed(2)} OFF`;
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

  return (
    <div className="space-y-6 pb-10">
      {/* Executive Header Card */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5 flex-wrap mb-2.5">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 text-[11px] font-mono font-semibold text-indigo-700 dark:text-indigo-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                {lang === 'vi'
                  ? 'QUẢN TRỊ KHUYẾN MÃI & DOANH THU'
                  : 'REVENUE & PROMO ENGINE'}
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200/70 dark:border-emerald-800/70 text-[11px] font-mono text-emerald-700 dark:text-emerald-300">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                6-CHAR ISO COUPON STANDARD
              </span>
            </div>

            <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
              {lang === 'vi' ? 'Quản lý Mã giảm giá (Promo Codes)' : 'Promo Code Management'}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
              {lang === 'vi'
                ? 'Tạo và kiểm soát mã khuyến mãi 6 ký tự cho thanh toán Stripe, Apple Pay và Google Pay với giới hạn lượt dùng, gói áp dụng và thời hạn.'
                : 'Create and govern 6-character promotional codes across Stripe Card, Apple Pay, and Google Pay checkouts with granular tier, cycle, and redemption limits.'}
            </p>
          </div>

          <Button
            size="sm"
            data-testid="create-promo-btn"
            onClick={openCreateModal}
            className="gap-2 rounded-xl h-9 shadow-xs shrink-0 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            {lang === 'vi' ? 'Tạo mã 6 ký tự' : 'Create Promo Code'}
          </Button>
        </div>
      </div>

      {/* Architectural Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {lang === 'vi' ? 'Tổng số mã' : 'Total Promo Codes'}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              01
            </span>
          </div>
          <p
            data-testid="kpi-total-promos"
            className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100"
          >
            {promos.length}
          </p>
        </Card>

        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              {lang === 'vi' ? 'Đang hoạt động' : 'Active Campaigns'}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400">
              02
            </span>
          </div>
          <p
            data-testid="kpi-active-promos"
            className="text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400"
          >
            {activeCount}
          </p>
        </Card>

        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
              {lang === 'vi' ? 'Tổng lượt sử dụng' : 'Total Redemptions'}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400">
              03
            </span>
          </div>
          <p
            data-testid="kpi-total-redemptions"
            className="text-2xl font-bold font-mono tabular-nums text-indigo-600 dark:text-indigo-400"
          >
            {totalRedemptions}
          </p>
        </Card>

        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-violet-600 dark:text-violet-400">
              {lang === 'vi' ? 'Tổng tiền đã giảm' : 'Total Discount Saved'}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-violet-50 dark:bg-violet-950/80 text-violet-600 dark:text-violet-400">
              04
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-violet-600 dark:text-violet-400">
            ${totalSavedUsd.toFixed(2)}
          </p>
        </Card>
      </div>

      {/* Error */}
      {error && (
        <Alert variant="destructive" className="card p-4 rounded-2xl">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* IDE Container for Filters + Promo Table */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        {/* IDE Window Chrome */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
            </div>
            <Separator orientation="vertical" className="h-4" />
            <Terminal className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
            <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-200">
              billing_engine.promo_codes
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              {lang === 'vi'
                ? `Hiển thị ${filtered.length} / ${promos.length} mã`
                : `Showing ${filtered.length} of ${promos.length} codes`}
            </span>
            <button
              type="button"
              onClick={() => void loadPromos()}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title={lang === 'vi' ? 'Làm mới' : 'Refresh'}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="p-4 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/40">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                type="text"
                data-testid="promo-search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  lang === 'vi'
                    ? 'Tìm theo mã 6 ký tự hoặc mô tả chiến dịch...'
                    : 'Search by 6-char code or campaign description...'
                }
                className="pl-10 rounded-xl"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <Select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
              className="sm:w-48 rounded-xl"
            >
              <option value="all">
                {lang === 'vi' ? 'Mọi loại giảm giá' : 'All Discount Types'}
              </option>
              <option value="percent">
                {lang === 'vi' ? 'Giảm theo % (Percent)' : 'Percentage (%)'}
              </option>
              <option value="fixed">
                {lang === 'vi' ? 'Giảm cố định ($ USD)' : 'Fixed Amount ($ USD)'}
              </option>
            </Select>

            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="sm:w-44 rounded-xl"
            >
              <option value="all">
                {lang === 'vi' ? 'Mọi trạng thái' : 'All Statuses'}
              </option>
              <option value="active">
                {lang === 'vi' ? 'Đang hoạt động' : 'Active'}
              </option>
              <option value="inactive">
                {lang === 'vi' ? 'Tạm dừng / Hết hạn' : 'Paused / Expired'}
              </option>
            </Select>
          </div>
        </div>

        {/* Table Content */}
        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center">
            <Loader2 className="h-8 w-8 text-indigo-600 animate-spin mb-4" />
            <p className="text-sm font-mono text-slate-600 dark:text-slate-300">
              {lang === 'vi' ? 'Đang tải danh sách mã giảm giá...' : 'Loading promo codes...'}
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-3">
              <Tag className="h-6 w-6 text-slate-400" />
            </div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-1">
              {lang === 'vi' ? 'Không tìm thấy mã giảm giá' : 'No promo codes found'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-4">
              {lang === 'vi'
                ? 'Hãy thử thay đổi bộ lọc hoặc tạo mã giảm giá 6 ký tự mới cho chiến dịch của bạn.'
                : 'Try adjusting your filters or create a new 6-character promotional code.'}
            </p>
            <Button size="sm" onClick={openCreateModal} className="gap-2 rounded-xl">
              <Plus className="h-4 w-4" />
              {lang === 'vi' ? 'Tạo mã giảm giá đầu tiên' : 'Create First Promo Code'}
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/70 dark:bg-slate-800/50">
                  <TableHead className="font-mono text-[11px] uppercase tracking-wider">
                    {lang === 'vi' ? 'Mã (6 ký tự)' : 'Code (6-Char)'}
                  </TableHead>
                  <TableHead className="font-mono text-[11px] uppercase tracking-wider">
                    {lang === 'vi' ? 'Mức giảm & Điều kiện' : 'Discount & Rules'}
                  </TableHead>
                  <TableHead className="font-mono text-[11px] uppercase tracking-wider">
                    {lang === 'vi' ? 'Phạm vi áp dụng' : 'Applicable Scope'}
                  </TableHead>
                  <TableHead className="font-mono text-[11px] uppercase tracking-wider">
                    {lang === 'vi' ? 'Lượt dùng' : 'Redemptions'}
                  </TableHead>
                  <TableHead className="font-mono text-[11px] uppercase tracking-wider">
                    {lang === 'vi' ? 'Trạng thái' : 'Status'}
                  </TableHead>
                  <TableHead className="text-right font-mono text-[11px] uppercase tracking-wider">
                    {lang === 'vi' ? 'Thao tác' : 'Actions'}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((promo) => {
                  const effectiveActive =
                    promo.is_active && !promo.is_expired && !promo.is_exhausted;
                  return (
                    <TableRow
                      key={promo.id}
                      data-testid={`promo-row-${promo.code}`}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      {/* Code + Description */}
                      <TableCell className="align-top py-3.5">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200 dark:border-indigo-800 font-mono text-xs font-bold tracking-widest text-indigo-700 dark:text-indigo-300">
                            <Tag className="h-3 w-3" />
                            {promo.code}
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleCopyCode(promo.code)}
                            className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            title={lang === 'vi' ? 'Sao chép mã' : 'Copy code'}
                          >
                            {copiedCode === promo.code ? (
                              <Check className="h-3.5 w-3.5 text-emerald-500" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                        {promo.description && (
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xs line-clamp-2">
                            {promo.description}
                          </p>
                        )}
                      </TableCell>

                      {/* Discount & Min Order */}
                      <TableCell className="align-top py-3.5">
                        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-300 font-mono text-xs font-semibold">
                          {promo.discount_type === 'percent' ? (
                            <Percent className="h-3 w-3" />
                          ) : (
                            <DollarSign className="h-3 w-3" />
                          )}
                          {formatDiscountBadge(promo)}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1">
                          {promo.min_amount_usd > 0
                            ? lang === 'vi'
                              ? `Đơn tối thiểu: $${promo.min_amount_usd.toFixed(2)}`
                              : `Min subtotal: $${promo.min_amount_usd.toFixed(2)}`
                            : lang === 'vi'
                            ? 'Không yêu cầu đơn tối thiểu'
                            : 'No minimum subtotal'}
                        </div>
                      </TableCell>

                      {/* Scope */}
                      <TableCell className="align-top py-3.5">
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                          {formatScopeLabel(promo)}
                        </span>
                        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1">
                          {lang === 'vi'
                            ? `Tối đa ${promo.max_uses_per_user} lần / tài khoản`
                            : `Max ${promo.max_uses_per_user}x per user`}
                        </div>
                      </TableCell>

                      {/* Redemptions */}
                      <TableCell className="align-top py-3.5">
                        <div className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {promo.used_count} / {promo.max_uses != null ? promo.max_uses : '∞'}
                        </div>
                        {promo.max_uses != null && promo.max_uses > 0 && (
                          <div className="w-24 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mt-1.5">
                            <div
                              className="h-full bg-indigo-600 dark:bg-indigo-400 rounded-full"
                              style={{
                                width: `${Math.min(
                                  100,
                                  Math.round((promo.used_count / promo.max_uses) * 100)
                                )}%`,
                              }}
                            />
                          </div>
                        )}
                      </TableCell>

                      {/* Status & Expiration */}
                      <TableCell className="align-top py-3.5">
                        {effectiveActive ? (
                          <Badge
                            variant="verified"
                            className="px-2 py-0.5 rounded-full text-[11px] font-mono"
                          >
                            {lang === 'vi' ? 'Hoạt động' : 'Active'}
                          </Badge>
                        ) : promo.is_expired ? (
                          <Badge
                            variant="destructive"
                            className="px-2 py-0.5 rounded-full text-[11px] font-mono"
                          >
                            {lang === 'vi' ? 'Hết hạn' : 'Expired'}
                          </Badge>
                        ) : promo.is_exhausted ? (
                          <Badge
                            variant="destructive"
                            className="px-2 py-0.5 rounded-full text-[11px] font-mono"
                          >
                            {lang === 'vi' ? 'Hết lượt' : 'Depleted'}
                          </Badge>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="px-2 py-0.5 rounded-full text-[11px] font-mono"
                          >
                            {lang === 'vi' ? 'Tạm dừng' : 'Paused'}
                          </Badge>
                        )}
                        {promo.expires_at && (
                          <div className="flex items-center gap-1 text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1">
                            <Calendar className="h-3 w-3" />
                            <span>{promo.expires_at.slice(0, 10)}</span>
                          </div>
                        )}
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="align-top py-3.5 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            data-testid={`promo-toggle-${promo.code}`}
                            onClick={() => void handleToggleActive(promo)}
                            className="h-8 px-2.5 rounded-lg text-xs cursor-pointer"
                            title={
                              promo.is_active
                                ? lang === 'vi'
                                  ? 'Tạm dừng mã'
                                  : 'Pause promo code'
                                : lang === 'vi'
                                ? 'Kích hoạt mã'
                                : 'Activate promo code'
                            }
                          >
                            <Power
                              className={`h-3.5 w-3.5 ${
                                promo.is_active ? 'text-emerald-600' : 'text-slate-400'
                              }`}
                            />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            data-testid={`promo-edit-${promo.code}`}
                            onClick={() => openEditModal(promo)}
                            className="h-8 px-2.5 rounded-lg text-xs cursor-pointer"
                            title={lang === 'vi' ? 'Chỉnh sửa' : 'Edit'}
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
        )}
      </div>

      {/* Create / Edit Promo Code Modal */}
      {modalOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            data-testid="promo-form-modal"
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4 overflow-y-auto"
          >
            <div className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl my-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
                  <Tag className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {editingPromo
                      ? lang === 'vi'
                        ? `Chỉnh sửa mã ${editingPromo.code}`
                        : `Edit Promo Code ${editingPromo.code}`
                      : lang === 'vi'
                      ? 'Tạo mã giảm giá 6 ký tự mới'
                      : 'Create 6-Character Promo Code'}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {lang === 'vi'
                      ? 'Chuẩn mã 6 ký tự chữ in hoa & số (A-Z, 0-9)'
                      : 'Strict 6-character uppercase alphanumeric format (A-Z, 0-9)'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitForm} className="p-5 space-y-4">
              {formError && (
                <Alert variant="destructive" className="p-3 rounded-xl">
                  <AlertDescription className="text-xs">{formError}</AlertDescription>
                </Alert>
              )}

              {/* 6-Character Code Input + Auto-Generator */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {lang === 'vi' ? 'Mã giảm giá (Đúng 6 ký tự) *' : 'Promo Code (Strictly 6 chars) *'}
                  </label>
                  <span
                    className={`text-[11px] font-mono ${
                      PROMO_REGEX.test(code.trim().toUpperCase())
                        ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                        : 'text-slate-400'
                    }`}
                  >
                    {code.trim().length}/6
                  </span>
                </div>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    data-testid="promo-code-input"
                    value={code}
                    disabled={Boolean(editingPromo)}
                    maxLength={6}
                    onChange={(e) =>
                      setCode(
                        e.target.value
                          .toUpperCase()
                          .replace(/[^A-Z0-9]/g, '')
                          .slice(0, 6)
                      )
                    }
                    placeholder="CITRA9"
                    className="font-mono uppercase tracking-widest text-sm font-bold rounded-xl"
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
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  {lang === 'vi' ? 'Mô tả chiến dịch' : 'Campaign Description'}
                </label>
                <Input
                  type="text"
                  data-testid="promo-description-input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={
                    lang === 'vi'
                      ? 'VD: Học bổng nghiên cứu học kỳ mùa thu — Giảm 30%'
                      : 'e.g. Academic Fall Semester Grant — 30% Off'
                  }
                  className="rounded-xl text-sm"
                />
              </div>

              {/* Discount Type & Discount Value */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {lang === 'vi' ? 'Loại giảm giá *' : 'Discount Type *'}
                  </label>
                  <Select
                    data-testid="promo-discount-type-select"
                    value={discountType}
                    onChange={(e) =>
                      setDiscountType(e.target.value as 'percent' | 'fixed')
                    }
                    className="rounded-xl w-full"
                  >
                    <option value="percent">
                      {lang === 'vi' ? 'Theo phần trăm (%)' : 'Percentage (%)'}
                    </option>
                    <option value="fixed">
                      {lang === 'vi' ? 'Số tiền cố định ($ USD)' : 'Fixed Amount ($ USD)'}
                    </option>
                  </Select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {discountType === 'percent'
                      ? lang === 'vi'
                        ? 'Mức giảm (%) *'
                        : 'Discount Percentage (%) *'
                      : lang === 'vi'
                      ? 'Số tiền giảm ($ USD) *'
                      : 'Discount Amount ($ USD) *'}
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={discountType === 'percent' ? '100' : undefined}
                    data-testid="promo-discount-value-input"
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    className="rounded-xl font-mono text-sm"
                  />
                </div>
              </div>

              {/* Max Discount Cap & Min Order Subtotal */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {lang === 'vi'
                      ? 'Giảm tối đa ($ USD, tùy chọn)'
                      : 'Max Discount Cap ($ USD, optional)'}
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    disabled={discountType !== 'percent'}
                    data-testid="promo-max-discount-input"
                    value={maxDiscountUsd}
                    onChange={(e) => setMaxDiscountUsd(e.target.value)}
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

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {lang === 'vi'
                      ? 'Đơn tối thiểu ($ USD)'
                      : 'Minimum Order Subtotal ($ USD)'}
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    data-testid="promo-min-order-input"
                    value={minOrderUsd}
                    onChange={(e) => setMinOrderUsd(e.target.value)}
                    className="rounded-xl font-mono text-sm"
                  />
                </div>
              </div>

              {/* Applicable Tiers & Billing Cycles */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {lang === 'vi' ? 'Gói cước áp dụng' : 'Applicable Plan Tiers'}
                  </label>
                  <Select
                    data-testid="promo-tiers-select"
                    value={applicableTiers}
                    onChange={(e) =>
                      setApplicableTiers(e.target.value as 'all' | 'pro' | 'ultra')
                    }
                    className="rounded-xl w-full"
                  >
                    <option value="all">
                      {lang === 'vi' ? 'Tất cả gói (Pro & Ultra)' : 'All Paid Plans (Pro & Ultra)'}
                    </option>
                    <option value="pro">Pro Researcher</option>
                    <option value="ultra">Ultra Institutional</option>
                  </Select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {lang === 'vi' ? 'Chu kỳ thanh toán' : 'Applicable Billing Cycles'}
                  </label>
                  <Select
                    data-testid="promo-cycles-select"
                    value={applicableCycles}
                    onChange={(e) =>
                      setApplicableCycles(e.target.value as 'all' | 'monthly' | 'annual')
                    }
                    className="rounded-xl w-full"
                  >
                    <option value="all">
                      {lang === 'vi' ? 'Mọi chu kỳ (Tháng & Năm)' : 'All Cycles (Monthly & Annual)'}
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

              {/* Max Uses, Max Uses Per User, Expiration Date */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {lang === 'vi' ? 'Tổng lượt dùng tối đa' : 'Global Max Uses'}
                  </label>
                  <Input
                    type="number"
                    min="1"
                    data-testid="promo-max-uses-input"
                    value={maxUses}
                    onChange={(e) => setMaxUses(e.target.value)}
                    placeholder={lang === 'vi' ? 'Vô hạn (∞)' : 'Unlimited (∞)'}
                    className="rounded-xl font-mono text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {lang === 'vi' ? 'Lượt / Tài khoản' : 'Max Uses / User'}
                  </label>
                  <Input
                    type="number"
                    min="1"
                    data-testid="promo-max-uses-per-user-input"
                    value={maxUsesPerUser}
                    onChange={(e) => setMaxUsesPerUser(e.target.value)}
                    className="rounded-xl font-mono text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {lang === 'vi' ? 'Ngày hết hạn' : 'Expiration Date'}
                  </label>
                  <Input
                    type="date"
                    data-testid="promo-expires-input"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    className="rounded-xl font-mono text-sm"
                  />
                </div>
              </div>

              {/* Active Toggle */}
              <label className="flex items-center gap-2.5 pt-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  data-testid="promo-active-checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  {lang === 'vi'
                    ? 'Kích hoạt mã giảm giá ngay lập tức'
                    : 'Enable promo code immediately for checkout'}
                </span>
              </label>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200 dark:border-slate-800">
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
                    ? 'Tạo mã 6 ký tự'
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
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4"
          >
            <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-5 space-y-4">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {lang === 'vi'
                  ? `Xóa mã giảm giá ${deletingPromo.code}?`
                  : `Delete promo code ${deletingPromo.code}?`}
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                {lang === 'vi'
                  ? 'Hành động này sẽ xóa vĩnh viễn mã giảm giá khỏi hệ thống. Các giao dịch đã thanh toán trước đó vẫn được giữ nguyên lịch sử.'
                  : 'This will permanently remove the promo code. Historical billing transactions that already redeemed this code will remain intact.'}
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
