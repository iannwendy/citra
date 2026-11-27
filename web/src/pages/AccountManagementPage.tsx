import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  UserPlus,
  Search,
  Loader2,
  UserCog,
  X,
  Users,
  Trash2,
  Infinity as InfinityIcon,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { UserFormDialog } from '@/components/UserFormDialog';
import { DeleteUserDialog } from '@/components/DeleteUserDialog';
import { RoleBadge } from '@/components/RoleBadge';
import type { User } from '@/api/client';
import { api } from '@/api/client';
import { getQuotaView } from '@/lib/quotaDisplay';
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
import { DonutChart, NumberPopIn } from '@/components/ui/transitions';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export function AccountManagementPage() {
  const { t, i18n } = useTranslation();
  const lang = resolveAcademicLang(i18n.resolvedLanguage || i18n.language);
  const { user: currentUser } = useAuth();
  const { isAdmin } = useRole();
  const navigate = useNavigate();

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'teacher' | 'user'>('all');
  const [planFilter, setPlanFilter] = useState<'all' | 'basic' | 'pro' | 'ultra'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Dialogs
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deletingUser, setDeletingUser] = useState<User | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      navigate('/dashboard', { replace: true });
    }
  }, [isAdmin, navigate]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.listUsers();
      setUsers(data);
    } catch (err) {
      setError(formatUserError(err, lang, t('admin.failedLoadUsers')));
    } finally {
      setLoading(false);
    }
  }, [lang, t]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const getEffectivePlanTier = (u: User): 'basic' | 'pro' | 'ultra' => {
    if (u.role === 'admin' || u.plan_tier === 'ultra') return 'ultra';
    if (u.plan_tier === 'pro') return 'pro';
    return 'basic';
  };

  const filtered = useMemo(
    () =>
      users.filter((u) => {
        const q = searchQuery.trim().toLowerCase();
        const matchesSearch =
          !q ||
          u.username.toLowerCase().includes(q) ||
          (u.full_name ?? '').toLowerCase().includes(q) ||
          (u.email ?? '').toLowerCase().includes(q) ||
          (u.institution ?? '').toLowerCase().includes(q);

        const matchesRole = roleFilter === 'all' || u.role === roleFilter;
        const matchesPlan =
          planFilter === 'all' || getEffectivePlanTier(u) === planFilter;
        const matchesStatus =
          statusFilter === 'all' ||
          (statusFilter === 'active' && u.is_active) ||
          (statusFilter === 'inactive' && !u.is_active);

        return matchesSearch && matchesRole && matchesPlan && matchesStatus;
      }),
    [users, searchQuery, roleFilter, planFilter, statusFilter],
  );

  const hasActiveFilters =
    Boolean(searchQuery.trim()) ||
    roleFilter !== 'all' ||
    planFilter !== 'all' ||
    statusFilter !== 'all';

  const resetFilters = () => {
    setSearchQuery('');
    setRoleFilter('all');
    setPlanFilter('all');
    setStatusFilter('all');
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setFormDialogOpen(true);
  };

  const handleDelete = (user: User) => {
    setDeletingUser(user);
    setDeleteDialogOpen(true);
  };

  const StatusBadge = ({ active }: { active: boolean }) => (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap shrink-0 ${
        active
          ? 'bg-emerald-50 dark:bg-emerald-950/70 border-emerald-200/80 dark:border-emerald-800/80 text-emerald-700 dark:text-emerald-300'
          : 'bg-rose-50 dark:bg-rose-950/70 border-rose-200/80 dark:border-rose-800/80 text-rose-700 dark:text-rose-300'
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? 'bg-emerald-500' : 'bg-rose-500'}`}
      />
      {active ? t('admin.active') : t('admin.inactive')}
    </span>
  );

  const activeCount = users.filter((u) => u.is_active).length;
  const teacherCount = users.filter((u) => u.role === 'teacher').length;
  const adminCount = users.filter((u) => u.role === 'admin').length;
  const studentCount = Math.max(0, users.length - teacherCount - adminCount);

  const ultraCount = users.filter((u) => getEffectivePlanTier(u) === 'ultra').length;
  const proCount = users.filter((u) => getEffectivePlanTier(u) === 'pro').length;
  const basicCount = Math.max(0, users.length - ultraCount - proCount);
  const safeTotalUsers = Math.max(1, users.length);

  const institutionColumnLabel =
    lang === 'vi' ? 'Đơn vị / Lớp' : 'Institution / Class';

  return (
    <div className="space-y-5 pb-10">
      {/* Clean Header */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 flex items-center justify-center shrink-0">
            <Users className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
              {t('admin.accountManagement')}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {t('admin.accountManagementSubtitle')}
            </p>
          </div>
        </div>

        <Button
          size="sm"
          onClick={() => {
            setEditingUser(null);
            setFormDialogOpen(true);
          }}
          className="gap-2 rounded-xl h-9 shadow-sm shrink-0"
        >
          <UserPlus className="h-4 w-4" />
          {lang === 'vi' ? 'Tạo tài khoản' : 'Create Account'}
        </Button>
      </div>

      {/* Visual Member Ecosystem Summary — Unified Role Palette matching RoleBadge (Slate / Emerald / Violet) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <Card className="lg:col-span-6 p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row items-start sm:items-center gap-4">
          {/* Role Distribution (Donut aligned 1:1 with RoleBadge: Student=Slate, Teacher=Emerald, Admin=Violet) */}
          <div className="flex items-center gap-3.5 shrink-0">
            <DonutChart
              size={78}
              thickness={10}
              segments={
                users.length > 0
                  ? [
                      { value: studentCount, color: '#64748b' },
                      { value: teacherCount, color: '#10b981' },
                      { value: adminCount, color: '#8b5cf6' },
                    ]
                  : [{ value: 1, color: '#cbd5e1' }]
              }
              centerContent={
                <span className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  <NumberPopIn value={users.length} />
                </span>
              }
            />
            <div className="space-y-1">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                {lang === 'vi' ? 'Phân bổ vai trò' : 'Role Distribution'}
              </p>
              <div className="flex flex-col gap-1 text-[11px] text-slate-600 dark:text-slate-400">
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className="w-2 h-2 rounded-full bg-slate-500 shrink-0" />
                  {lang === 'vi' ? 'Sinh viên' : 'Students'}:{' '}
                  <strong className="font-mono text-slate-800 dark:text-slate-200">
                    {studentCount}
                  </strong>
                </span>
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                  {t('admin.teachers')}:{' '}
                  <strong className="font-mono text-slate-800 dark:text-slate-200">
                    {teacherCount}
                  </strong>
                </span>
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className="w-2 h-2 rounded-full bg-violet-500 shrink-0" />
                  {t('admin.admins')}:{' '}
                  <strong className="font-mono text-slate-800 dark:text-slate-200">
                    {adminCount}
                  </strong>
                </span>
              </div>
            </div>
          </div>

          <div
            aria-hidden="true"
            className="hidden sm:block w-px self-stretch bg-slate-200/80 dark:bg-slate-800 shrink-0"
          />

          {/* Plan Tier Distribution (Stacked Bar + Non-Colliding Palette: Amber / Indigo / Slate) */}
          <div className="flex-1 min-w-0 w-full space-y-2.5 pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-200/80 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {lang === 'vi' ? 'Phân bổ gói tài khoản' : 'Plan Tier Distribution'}
              </span>
            </div>
            <div
              data-testid="plan-tier-distribution-bar"
              className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex"
            >
              {basicCount > 0 && (
                <div
                  style={{ width: `${(basicCount / safeTotalUsers) * 100}%` }}
                  className="bg-slate-400 h-full transition-all"
                  title={`Basic: ${basicCount}`}
                />
              )}
              {proCount > 0 && (
                <div
                  style={{ width: `${(proCount / safeTotalUsers) * 100}%` }}
                  className="bg-indigo-600 h-full transition-all"
                  title={`Pro: ${proCount}`}
                />
              )}
              {ultraCount > 0 && (
                <div
                  style={{ width: `${(ultraCount / safeTotalUsers) * 100}%` }}
                  className="bg-amber-500 h-full transition-all"
                  title={`Ultra: ${ultraCount}`}
                />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span className="w-2 h-2 rounded-full bg-slate-400 shrink-0" />
                Basic:{' '}
                <strong className="font-mono text-slate-800 dark:text-slate-200">
                  {basicCount}
                </strong>
              </span>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span className="w-2 h-2 rounded-full bg-indigo-600 shrink-0" />
                Pro:{' '}
                <strong className="font-mono text-slate-800 dark:text-slate-200">
                  {proCount}
                </strong>
              </span>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                Ultra:{' '}
                <strong className="font-mono text-slate-800 dark:text-slate-200">
                  {ultraCount}
                </strong>
              </span>
            </div>
          </div>
        </Card>

        <div className="lg:col-span-6 grid grid-cols-2 sm:grid-cols-4 gap-3.5">
          <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm flex flex-col justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {t('admin.totalUsers')}
            </span>
            <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              <NumberPopIn value={users.length} />
            </p>
          </Card>

          <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm flex flex-col justify-between">
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              {lang === 'vi' ? 'Tài khoản đang hoạt động' : 'Active Accounts'}
            </span>
            <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              <NumberPopIn value={activeCount} />
            </p>
          </Card>

          <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm flex flex-col justify-between">
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              {t('admin.teachers')}
            </span>
            <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              <NumberPopIn value={teacherCount} />
            </p>
          </Card>

          <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm flex flex-col justify-between">
            <span className="text-xs font-medium text-violet-600 dark:text-violet-400">
              {t('admin.admins')}
            </span>
            <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-violet-600 dark:text-violet-400">
              <NumberPopIn value={adminCount} />
            </p>
          </Card>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="p-4 rounded-2xl">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Member Directory Studio */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <StudioWindowHeader
          title={lang === 'vi' ? 'Danh sách tài khoản' : 'User Accounts'}
          badge={
            <Badge
              variant="secondary"
              className="font-mono text-[11px] bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60 whitespace-nowrap"
            >
              {filtered.length} / {users.length}
            </Badge>
          }
          rightSlot={
            <SlidingFilterPills
              value={roleFilter}
              onChange={setRoleFilter}
              ariaLabel={t('admin.allRoles')}
              options={[
                { key: 'all', label: t('admin.allRoles') },
                { key: 'admin', label: t('admin.roleAdmin') },
                { key: 'teacher', label: t('admin.roleTeacher') },
                { key: 'user', label: lang === 'vi' ? 'Sinh viên' : 'Student' },
              ]}
            />
          }
        />

        {/* Search + Plan Tier & Status Filters */}
        <div className="p-4 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/40">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('admin.searchUsersPlaceholder')}
                aria-label={
                  lang === 'vi'
                    ? 'Tìm kiếm tài khoản theo tên đăng nhập, họ tên hoặc email'
                    : 'Search accounts by username, name, or email'
                }
                className="pl-10 pr-9 rounded-xl"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label={t('dashboard.clearSearch')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <Select
              data-testid="plan-tier-filter"
              value={planFilter}
              onChange={(e) => setPlanFilter(e.target.value as typeof planFilter)}
              aria-label={
                lang === 'vi' ? 'Lọc theo gói dịch vụ' : 'Filter by plan tier'
              }
              wrapperClassName="sm:w-40"
              className="w-full rounded-xl"
            >
              <option value="all">
                {lang === 'vi' ? 'Tất cả gói' : 'All Plans'}
              </option>
              <option value="basic">Basic</option>
              <option value="pro">Pro</option>
              <option value="ultra">Ultra</option>
            </Select>

            <Select
              data-testid="status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              aria-label={
                lang === 'vi' ? 'Lọc theo trạng thái' : 'Filter by status'
              }
              wrapperClassName="sm:w-44"
              className="w-full rounded-xl"
            >
              <option value="all">{t('admin.allStatus')}</option>
              <option value="active">{t('admin.active')}</option>
              <option value="inactive">{t('admin.inactive')}</option>
            </Select>
          </div>
        </div>

        {/* Responsive Card List (< lg) & Compact Desktop Table (>= lg) */}
        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center">
            <Loader2 className="h-8 w-8 text-indigo-600 animate-spin mb-4" />
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {t('admin.loadingUsers')}
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-3">
              <UserCog className="h-7 w-7 text-slate-400" />
            </div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-1">
              {hasActiveFilters ? t('admin.noUsersMatch') : t('admin.noUsersYet')}
            </h3>
            <p className="text-slate-500 dark:text-slate-400 text-xs mb-4">
              {hasActiveFilters
                ? t('admin.tryAdjustingFilters')
                : t('admin.createFirstUser')}
            </p>
            {hasActiveFilters && users.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={resetFilters}
                className="rounded-xl"
              >
                {lang === 'vi' ? 'Xóa bộ lọc' : 'Reset Filters'}
              </Button>
            )}
          </div>
        ) : (
          <Table className="block lg:table">
            <TableHeader className="hidden lg:table-header-group">
              <TableRow className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                <TableHead className="text-left py-3 px-2 xl:px-2.5 text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">
                  {t('admin.tableUser')}
                </TableHead>
                <TableHead className="text-left py-3 px-2 xl:px-2.5 text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">
                  {t('admin.tableRole')}
                </TableHead>
                <TableHead className="text-left py-3 px-2 xl:px-2.5 text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">
                  {lang === 'vi' ? 'Gói & lượt kiểm tra' : 'Plan & Usage'}
                </TableHead>
                <TableHead className="text-left py-3 px-2 xl:px-2.5 text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">
                  {t('admin.tableStatus')}
                </TableHead>
                <TableHead className="text-left py-3 px-2 xl:px-2.5 text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">
                  {institutionColumnLabel}
                </TableHead>
                <TableHead className="text-left py-3 px-2 xl:px-2.5 text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">
                  {lang === 'vi' ? 'Đăng nhập gần nhất' : 'Last Sign-In'}
                </TableHead>
                <TableHead className="lg:sticky lg:right-0 bg-slate-50 dark:bg-slate-800/95 text-right py-3 px-2 xl:px-2.5 text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">
                  {t('admin.tableActions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="block lg:table-row-group divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((u) => {
                const isUserAdmin = u.role === 'admin';
                const effectiveTier = getEffectivePlanTier(u);
                const limit = u.quota?.monthly_uploads_limit ?? 0;
                const used = u.quota?.monthly_uploads_used ?? 0;
                const quotaView = u.quota
                  ? getQuotaView(u.quota, lang, { isAdmin: isUserAdmin })
                  : null;
                const hasFiniteQuota = !isUserAdmin && Boolean(u.quota) && limit > 0;
                const clampedQuotaPct = hasFiniteQuota
                  ? Math.min(100, Math.max(0, Math.round((used / limit) * 100)))
                  : 0;
                const quotaBarColor =
                  clampedQuotaPct >= 100
                    ? 'bg-rose-500'
                    : clampedQuotaPct >= 80
                      ? 'bg-amber-500'
                      : 'bg-indigo-500';
                const formattedLogin = u.last_login_at
                  ? formatLocalizedDate(u.last_login_at, lang)
                  : lang === 'vi'
                    ? 'Chưa đăng nhập'
                    : 'Never';

                return (
                  <TableRow
                    key={u.id}
                    className="group flex flex-col lg:table-row p-4 lg:p-0 gap-2.5 lg:gap-0 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <TableCell className="block lg:table-cell p-0 lg:py-3 lg:px-2 xl:px-2.5 lg:max-w-[195px] xl:max-w-[215px]">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-xl overflow-hidden bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 flex items-center justify-center shrink-0 text-xs font-bold text-indigo-700 dark:text-indigo-300 uppercase">
                          {u.avatar_url ? (
                            <img
                              src={u.avatar_url}
                              alt={u.username}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            (u.full_name || u.username).slice(0, 1)
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p
                            title={u.full_name || u.username}
                            className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate"
                          >
                            {u.full_name || u.username}
                          </p>
                          <p
                            title={`${u.username}${u.email ? ` · ${u.email}` : ''}`}
                            className="text-xs text-slate-500 dark:text-slate-400 truncate"
                          >
                            {u.username}
                            {u.email && ` · ${u.email}`}
                          </p>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className="flex lg:table-cell items-center justify-between gap-2 p-0 lg:py-3 lg:px-2.5 xl:px-3 whitespace-nowrap">
                      <span className="lg:hidden text-[11px] font-mono uppercase text-slate-400">
                        {t('admin.tableRole')}
                      </span>
                      <RoleBadge role={u.role} />
                    </TableCell>

                    <TableCell
                      data-testid={`user-plan-quota-${u.id}`}
                      className="flex lg:table-cell items-center justify-between gap-2 p-0 lg:py-3 lg:px-2.5 xl:px-3 whitespace-nowrap"
                    >
                      <span className="lg:hidden text-[11px] font-mono uppercase text-slate-400">
                        {lang === 'vi' ? 'Gói & lượt kiểm tra' : 'Plan & Usage'}
                      </span>
                      <div className="space-y-1.5 min-w-[118px]">
                        <div className="inline-flex items-center gap-1.5 font-mono text-xs whitespace-nowrap">
                          <span
                            className={`px-1.5 py-0.5 rounded-md border text-[11px] font-semibold whitespace-nowrap ${
                              effectiveTier === 'ultra'
                                ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-200/80 dark:border-amber-800/80'
                                : effectiveTier === 'pro'
                                  ? 'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border-indigo-200/80 dark:border-indigo-800/80'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200/80 dark:border-slate-700'
                            }`}
                          >
                            {effectiveTier.toUpperCase()}
                          </span>
                          <span
                            title={
                              quotaView && !quotaView.uploadsUnlimited
                                ? lang === 'vi'
                                  ? 'Số lượt kiểm tra tài liệu đã dùng trong tháng này'
                                  : 'Document checks used this month'
                                : undefined
                            }
                            className="inline-flex items-center gap-1 tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap"
                          >
                            {isUserAdmin && (
                              <InfinityIcon className="h-3 w-3 text-amber-600 dark:text-amber-400 shrink-0" />
                            )}
                            {quotaView
                              ? quotaView.uploadsUnlimited
                                ? quotaView.usage
                                : `${quotaView.usage} ${lang === 'vi' ? 'lượt' : 'checks'}`
                              : '—'}
                          </span>
                        </div>
                        {hasFiniteQuota && (
                          <div className="h-1.5 w-24 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                            <div
                              data-testid={`user-quota-bar-${u.id}`}
                              style={{ width: `${clampedQuotaPct}%` }}
                              className={`h-full rounded-full transition-all ${quotaBarColor}`}
                            />
                          </div>
                        )}
                      </div>
                    </TableCell>

                    <TableCell className="flex lg:table-cell items-center justify-between gap-2 p-0 lg:py-3 lg:px-2 xl:px-2.5 whitespace-nowrap">
                      <span className="lg:hidden text-[11px] font-mono uppercase text-slate-400">
                        {t('admin.tableStatus')}
                      </span>
                      <StatusBadge active={u.is_active} />
                    </TableCell>

                    <TableCell className="flex lg:table-cell items-center justify-between gap-2 p-0 lg:py-3 lg:px-2 xl:px-2.5 text-xs text-slate-600 dark:text-slate-300 lg:max-w-[125px] xl:max-w-[140px]">
                      <span className="lg:hidden text-[11px] font-mono uppercase text-slate-400 shrink-0">
                        {institutionColumnLabel}
                      </span>
                      <span
                        title={u.institution ?? undefined}
                        className="truncate block max-w-[200px] lg:max-w-[120px] xl:max-w-[134px]"
                      >
                        {u.institution ?? '—'}
                      </span>
                    </TableCell>

                    <TableCell className="flex lg:table-cell items-center justify-between gap-2 p-0 lg:py-3 lg:px-2 xl:px-2.5 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap font-mono tabular-nums">
                      <span className="lg:hidden text-[11px] font-mono uppercase text-slate-400 font-sans">
                        {lang === 'vi' ? 'Đăng nhập gần nhất' : 'Last Sign-In'}
                      </span>
                      <span className="whitespace-nowrap">{formattedLogin}</span>
                    </TableCell>

                    <TableCell className="block lg:table-cell lg:sticky lg:right-0 bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800/60 p-0 pt-2 lg:pt-0 border-t border-slate-100 dark:border-slate-800/80 lg:border-0 lg:py-3 lg:px-2 xl:px-2.5 whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleEdit(u)}
                          className="inline-flex items-center gap-1 px-2 py-1.5 lg:p-1.5 rounded-lg text-xs font-medium text-slate-600 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition-colors cursor-pointer"
                          title={lang === 'vi' ? 'Chỉnh sửa tài khoản' : 'Edit account'}
                          aria-label={
                            lang === 'vi'
                              ? `Chỉnh sửa tài khoản ${u.username}`
                              : `Edit account ${u.username}`
                          }
                        >
                          <UserCog className="h-4 w-4 shrink-0" />
                          <span className="lg:hidden">
                            {lang === 'vi' ? 'Sửa' : 'Edit'}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(u)}
                          disabled={u.id === currentUser?.id}
                          className="inline-flex items-center gap-1 px-2 py-1.5 lg:p-1.5 rounded-lg text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/50 transition-colors disabled:opacity-30 disabled:text-slate-400 disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer"
                          title={
                            u.id === currentUser?.id
                              ? t('admin.cannotDeleteSelf')
                              : lang === 'vi'
                                ? 'Xóa tài khoản'
                                : 'Delete account'
                          }
                          aria-label={
                            u.id === currentUser?.id
                              ? t('admin.cannotDeleteSelf')
                              : lang === 'vi'
                                ? `Xóa tài khoản ${u.username}`
                                : `Delete account ${u.username}`
                          }
                        >
                          <Trash2 className="h-4 w-4 shrink-0" />
                          <span className="lg:hidden">
                            {lang === 'vi' ? 'Xóa' : 'Delete'}
                          </span>
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Dialogs */}
      <UserFormDialog
        open={formDialogOpen}
        onOpenChange={(open) => {
          setFormDialogOpen(open);
          if (!open) setEditingUser(null);
        }}
        user={editingUser}
        currentUserId={currentUser?.id}
        onSuccess={loadUsers}
      />

      <DeleteUserDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) setDeletingUser(null);
        }}
        user={deletingUser}
        currentUserId={currentUser?.id}
        onSuccess={loadUsers}
      />
    </div>
  );
}
