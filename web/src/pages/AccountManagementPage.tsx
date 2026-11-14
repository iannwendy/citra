import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  UserPlus,
  Search,
  Loader2,
  UserCog,
  ImageIcon,
  X,
  ShieldCheck,
  Terminal,
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

export function AccountManagementPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';
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
    loadUsers();
  }, [loadUsers]);

  const filtered = users.filter((u) => {
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
  });

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setFormDialogOpen(true);
  };

  const handleDelete = (user: User) => {
    setDeletingUser(user);
    setDeleteDialogOpen(true);
  };

  const StatusBadge = ({ active }: { active: boolean }) => (
    <Badge
      variant={active ? 'verified' : 'destructive'}
      className="px-2 py-0.5 rounded-full text-xs font-mono font-medium"
    >
      {active ? t('admin.active') : t('admin.inactive')}
    </Badge>
  );

  const dateLocale = i18n.language?.startsWith('vi') ? 'vi-VN' : 'en-US';

  const activeCount = users.filter((u) => u.is_active).length;
  const teacherCount = users.filter((u) => u.role === 'teacher').length;
  const adminCount = users.filter((u) => u.role === 'admin').length;

  return (
    <div className="space-y-6 pb-10">
      {/* Executive Header Card */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5 flex-wrap mb-2.5">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 text-[11px] font-mono font-semibold text-indigo-700 dark:text-indigo-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                {lang === 'vi' ? 'QUẢN TRỊ ĐỊNH DANH & PHÂN QUYỀN' : 'IAM IDENTITY DIRECTORY'}
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200/70 dark:border-emerald-800/70 text-[11px] font-mono text-emerald-700 dark:text-emerald-300">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                RBAC ENFORCED
              </span>
            </div>

            <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
              {t('admin.accountManagement')}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
              {t('admin.accountManagementSubtitle')}
            </p>
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
      </div>

      {/* Architectural Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {t('admin.totalUsers')}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              01
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {users.length}
          </p>
        </Card>

        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              {t('admin.active')}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400">
              02
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
            {activeCount}
          </p>
        </Card>

        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
              {t('admin.teachers')}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400">
              03
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-indigo-600 dark:text-indigo-400">
            {teacherCount}
          </p>
        </Card>

        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-violet-600 dark:text-violet-400">
              {t('admin.admins')}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-violet-50 dark:bg-violet-950/80 text-violet-600 dark:text-violet-400">
              04
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-violet-600 dark:text-violet-400">
            {adminCount}
          </p>
        </Card>
      </div>

      {/* Error */}
      {error && (
        <Alert variant="destructive" className="card p-4 rounded-2xl">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* IDE Container for Filters + User Table */}
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
              iam_directory.users
            </span>
          </div>
          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
            {t('admin.showingUsers', { shown: filtered.length, total: users.length })}
          </span>
        </div>

        {/* Filters */}
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
              className="sm:w-44 rounded-xl"
            >
              <option value="all">{t('admin.allRoles')}</option>
              <option value="admin">{t('admin.roleAdmin')}</option>
              <option value="teacher">{t('admin.roleTeacher')}</option>
              <option value="user">{t('admin.roleUser')}</option>
            </Select>

            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="sm:w-44 rounded-xl"
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
            <p className="text-sm font-mono text-slate-600 dark:text-slate-300">
              {t('admin.loadingUsers')}
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4">
              <UserCog className="h-8 w-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
              {searchQuery || roleFilter !== 'all' || statusFilter !== 'all'
                ? t('admin.noUsersMatch')
                : t('admin.noUsersYet')}
            </h3>
            <p className="text-slate-600 dark:text-slate-300 text-sm">
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
                <TableHead className="hidden lg:table-cell text-left py-3 px-4 text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {t('admin.tableMemberSince')}
                </TableHead>
                <TableHead className="text-right py-3 px-3 lg:px-4 text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {t('admin.tableActions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="block md:table-row-group divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((u) => (
                <TableRow
                  key={u.id}
                  className="flex flex-col md:table-row p-4 md:p-0 gap-2.5 md:gap-0 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <TableCell className="block md:table-cell p-0 md:py-3 md:px-3 lg:px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl overflow-hidden bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 flex items-center justify-center shrink-0">
                        {u.avatar_url ? (
                          <img
                            src={u.avatar_url}
                            alt={u.username}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <ImageIcon className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                          {u.full_name || u.username}
                        </p>
                        <p className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate">
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
                      <span className="tabular-nums text-slate-600 dark:text-slate-300">
                        {u.quota
                          ? getQuotaView(u.quota, lang, { isAdmin: u.role === 'admin' }).usage
                          : '—'}
                      </span>
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
                    <span className="truncate max-w-[180px]">{u.institution ?? '—'}</span>
                  </TableCell>
                  <TableCell className="flex md:hidden lg:table-cell items-center justify-between p-0 md:py-3 md:px-4 text-xs font-mono text-slate-600 dark:text-slate-300">
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
                  <TableCell className="flex md:hidden lg:table-cell items-center justify-between p-0 md:py-3 md:px-4 text-xs font-mono text-slate-600 dark:text-slate-300">
                    <span className="md:hidden text-[11px] font-mono uppercase text-slate-400">
                      {t('admin.tableMemberSince')}
                    </span>
                    <span>
                      {u.created_at
                        ? new Date(u.created_at).toLocaleDateString(dateLocale, {
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
                        onClick={() => handleEdit(u)}
                        className="p-2 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition-colors"
                        title="Edit user"
                      >
                        <UserCog className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(u)}
                        disabled={u.id === currentUser?.id}
                        className="p-2 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        title={
                          u.id === currentUser?.id
                            ? t('admin.cannotDeleteSelf')
                            : 'Delete user'
                        }
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Footer count */}
      {!loading && (
        <p className="text-xs font-mono text-slate-500 dark:text-slate-400">
          {t('admin.showingUsers', { shown: filtered.length, total: users.length })}
        </p>
      )}

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
