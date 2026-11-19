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
  const lang: 'en' | 'vi' = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const { user: currentUser } = useAuth();
  const { isAdmin } = useRole();
  const navigate = useNavigate();

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'teacher' | 'user'>('all');
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
      setError(err instanceof Error ? err.message : t('admin.failedLoadUsers'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const filtered = useMemo(
    () =>
      users.filter((u) => {
        const q = searchQuery.toLowerCase();
        const matchesSearch =
          !q ||
          u.username.toLowerCase().includes(q) ||
          (u.full_name ?? '').toLowerCase().includes(q) ||
          (u.email ?? '').toLowerCase().includes(q);

        const matchesRole = roleFilter === 'all' || u.role === roleFilter;
        const matchesStatus =
          statusFilter === 'all' ||
          (statusFilter === 'active' && u.is_active) ||
          (statusFilter === 'inactive' && !u.is_active);

        return matchesSearch && matchesRole && matchesStatus;
      }),
    [users, searchQuery, roleFilter, statusFilter],
  );

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
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
        active
          ? 'bg-emerald-50 dark:bg-emerald-950/70 border-emerald-200/80 dark:border-emerald-800/80 text-emerald-700 dark:text-emerald-300'
          : 'bg-rose-50 dark:bg-rose-950/70 border-rose-200/80 dark:border-rose-800/80 text-rose-700 dark:text-rose-300'
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-rose-500'}`}
      />
      {active ? t('admin.active') : t('admin.inactive')}
    </span>
  );

  const dateLocale = lang === 'vi' ? 'vi-VN' : 'en-US';

  const activeCount = users.filter((u) => u.is_active).length;
  const teacherCount = users.filter((u) => u.role === 'teacher').length;
  const adminCount = users.filter((u) => u.role === 'admin').length;
  const studentCount = Math.max(0, users.length - teacherCount - adminCount);

  const ultraCount = users.filter(
    (u) => u.role === 'admin' || u.plan_tier === 'ultra',
  ).length;
  const proCount = users.filter(
    (u) => u.role !== 'admin' && u.plan_tier === 'pro',
  ).length;
  const basicCount = Math.max(0, users.length - ultraCount - proCount);
  const safeTotalUsers = Math.max(1, users.length);

  return (
    <div className="space-y-5 pb-10">
      {/* Clean Header */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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
          className="gap-2 rounded-xl h-9 shadow-xs shrink-0"
        >
          <UserPlus className="h-4 w-4" />
          {t('admin.createUser')}
        </Button>
      </div>

      {/* Visual Member Ecosystem Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <Card className="lg:col-span-5 p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs flex items-center gap-4">
          <DonutChart
            size={80}
            thickness={10}
            segments={
              users.length > 0
                ? [
                    { value: studentCount, color: '#10b981' },
                    { value: teacherCount, color: '#6366f1' },
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
          <div className="flex-1 min-w-0 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {lang === 'vi' ? 'Phân bổ gói tài khoản' : 'Plan Tier Distribution'}
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                {basicCount} Basic · {proCount} Pro · {ultraCount} Ultra
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
              {ultraCount > 0 && (
                <div
                  style={{ width: `${(ultraCount / safeTotalUsers) * 100}%` }}
                  className="bg-violet-500 h-full transition-all"
                />
              )}
              {proCount > 0 && (
                <div
                  style={{ width: `${(proCount / safeTotalUsers) * 100}%` }}
                  className="bg-indigo-500 h-full transition-all"
                />
              )}
              {basicCount > 0 && (
                <div
                  style={{ width: `${(basicCount / safeTotalUsers) * 100}%` }}
                  className="bg-slate-400 h-full transition-all"
                />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                {lang === 'vi' ? 'Sinh viên' : 'Students'}: {studentCount}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-indigo-500" />
                {t('admin.teachers')}: {teacherCount}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-violet-500" />
                {t('admin.admins')}: {adminCount}
              </span>
            </div>
          </div>
        </Card>

        <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-4 gap-3.5">
          <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs flex flex-col justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {t('admin.totalUsers')}
            </span>
            <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              <NumberPopIn value={users.length} />
            </p>
          </Card>

          <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs flex flex-col justify-between">
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              {t('admin.active')}
            </span>
            <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              <NumberPopIn value={activeCount} />
            </p>
          </Card>

          <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs flex flex-col justify-between">
            <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
              {t('admin.teachers')}
            </span>
            <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-indigo-600 dark:text-indigo-400">
              <NumberPopIn value={teacherCount} />
            </p>
          </Card>

          <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs flex flex-col justify-between">
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
          title={lang === 'vi' ? 'DANH BẠ TÀI KHOẢN' : 'MEMBER DIRECTORY'}
          badge={
            <Badge
              variant="secondary"
              className="font-mono text-[11px] bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60"
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
                { key: 'user', label: t('admin.roleUser') },
              ]}
            />
          }
        />

        {/* Search & Synchronized Select Filters */}
        <div className="p-4 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/40">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('admin.searchUsersPlaceholder')}
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
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}
              className="sm:w-40 rounded-xl"
            >
              <option value="all">{t('admin.allRoles')}</option>
              <option value="admin">{t('admin.roleAdmin')}</option>
              <option value="teacher">{t('admin.roleTeacher')}</option>
              <option value="user">{t('admin.roleUser')}</option>
            </Select>

            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="sm:w-40 rounded-xl"
            >
              <option value="all">{t('admin.allStatus')}</option>
              <option value="active">{t('admin.active')}</option>
              <option value="inactive">{t('admin.inactive')}</option>
            </Select>
          </div>
        </div>

        {/* Table */}
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
              {searchQuery || roleFilter !== 'all' || statusFilter !== 'all'
                ? t('admin.noUsersMatch')
                : t('admin.noUsersYet')}
            </h3>
            <p className="text-slate-500 dark:text-slate-400 text-xs">
              {searchQuery || roleFilter !== 'all' || statusFilter !== 'all'
                ? t('admin.tryAdjustingFilters')
                : t('admin.createFirstUser')}
            </p>
          </div>
        ) : (
          <Table className="block md:table">
            <TableHeader className="hidden md:table-header-group">
              <TableRow className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                <TableHead className="text-left py-3 px-3 lg:px-4 text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {t('admin.tableUser')}
                </TableHead>
                <TableHead className="text-left py-3 px-3 lg:px-4 text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {t('admin.tableRole')}
                </TableHead>
                <TableHead className="text-left py-3 px-3 lg:px-4 text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {lang === 'vi' ? 'Gói / Hạn ngạch' : 'Plan / Quota'}
                </TableHead>
                <TableHead className="text-left py-3 px-3 lg:px-4 text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {t('admin.tableStatus')}
                </TableHead>
                <TableHead className="text-left py-3 px-3 lg:px-4 text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {t('admin.tableClass')}
                </TableHead>
                <TableHead className="hidden lg:table-cell text-left py-3 px-4 text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {t('admin.tableLastLogin')}
                </TableHead>
                <TableHead className="text-right py-3 px-3 lg:px-4 text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {t('admin.tableActions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="block md:table-row-group divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((u) => {
                const isUserAdmin = u.role === 'admin';
                const limit = u.quota?.monthly_uploads_limit ?? 0;
                const used = u.quota?.monthly_uploads_used ?? 0;
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

                return (
                  <TableRow
                    key={u.id}
                    className="flex flex-col md:table-row p-4 md:p-0 gap-2.5 md:gap-0 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <TableCell className="block md:table-cell p-0 md:py-3 md:px-3 lg:px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl overflow-hidden bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 flex items-center justify-center shrink-0 text-xs font-bold text-indigo-700 dark:text-indigo-300 uppercase">
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
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                            {u.full_name || u.username}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                            {u.username}
                            {u.email && ` · ${u.email}`}
                          </p>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className="flex md:table-cell items-center justify-between p-0 md:py-3 md:px-3 lg:px-4">
                      <span className="md:hidden text-[11px] font-mono uppercase text-slate-400">
                        {t('admin.tableRole')}
                      </span>
                      <RoleBadge role={u.role} />
                    </TableCell>

                    <TableCell
                      data-testid={`user-plan-quota-${u.id}`}
                      className="flex md:table-cell items-center justify-between p-0 md:py-3 md:px-3 lg:px-4"
                    >
                      <span className="md:hidden text-[11px] font-mono uppercase text-slate-400">
                        {lang === 'vi' ? 'Gói / Hạn ngạch' : 'Plan / Quota'}
                      </span>
                      <div className="space-y-1.5 min-w-[128px]">
                        <div className="inline-flex items-center gap-2 font-mono text-xs">
                          <span
                            className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold ${
                              u.plan_tier === 'ultra'
                                ? 'bg-violet-50 dark:bg-violet-950/70 text-violet-700 dark:text-violet-300 border-violet-200/80 dark:border-violet-800/80'
                                : u.plan_tier === 'pro'
                                  ? 'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border-indigo-200/80 dark:border-indigo-800/80'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200/80 dark:border-slate-700'
                            }`}
                          >
                            {(u.plan_tier || 'basic').toUpperCase()}
                          </span>
                          <span className="inline-flex items-center gap-1 tabular-nums text-slate-600 dark:text-slate-300">
                            {isUserAdmin && <InfinityIcon className="h-3 w-3 text-violet-500" />}
                            {u.quota
                              ? getQuotaView(u.quota, lang, { isAdmin: isUserAdmin }).usage
                              : '—'}
                          </span>
                        </div>
                        {hasFiniteQuota && (
                          <div className="h-1.5 w-28 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                            <div
                              data-testid={`user-quota-bar-${u.id}`}
                              style={{ width: `${clampedQuotaPct}%` }}
                              className={`h-full rounded-full transition-all ${quotaBarColor}`}
                            />
                          </div>
                        )}
                      </div>
                    </TableCell>

                    <TableCell className="flex md:table-cell items-center justify-between p-0 md:py-3 md:px-3 lg:px-4">
                      <span className="md:hidden text-[11px] font-mono uppercase text-slate-400">
                        {t('admin.tableStatus')}
                      </span>
                      <StatusBadge active={u.is_active} />
                    </TableCell>

                    <TableCell className="flex md:table-cell items-center justify-between p-0 md:py-3 md:px-3 lg:px-4 text-sm text-slate-600 dark:text-slate-300">
                      <span className="md:hidden text-[11px] font-mono uppercase text-slate-400">
                        {t('admin.tableClass')}
                      </span>
                      <span className="truncate max-w-[180px]">
                        {u.institution ?? '—'}
                      </span>
                    </TableCell>

                    <TableCell className="flex md:hidden lg:table-cell items-center justify-between p-0 md:py-3 md:px-4 text-xs text-slate-500 dark:text-slate-400">
                      <span className="md:hidden text-[11px] font-mono uppercase text-slate-400">
                        {t('admin.tableLastLogin')}
                      </span>
                      <span>
                        {u.last_login_at
                          ? new Date(u.last_login_at).toLocaleDateString(dateLocale, {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })
                          : '—'}
                      </span>
                    </TableCell>

                    <TableCell className="block md:table-cell p-0 pt-2 md:pt-0 border-t border-slate-100 dark:border-slate-800/80 md:border-0 md:py-3 md:px-3 lg:px-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => handleEdit(u)}
                          className="p-2 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition-colors cursor-pointer"
                          title={lang === 'vi' ? 'Chỉnh sửa người dùng' : 'Edit user'}
                        >
                          <UserCog className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(u)}
                          disabled={u.id === currentUser?.id}
                          className="p-2 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                          title={
                            u.id === currentUser?.id
                              ? t('admin.cannotDeleteSelf')
                              : lang === 'vi'
                                ? 'Xóa người dùng'
                                : 'Delete user'
                          }
                        >
                          <X className="h-4 w-4" />
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
