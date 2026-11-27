import { useState, useEffect } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PlanTier, User, UserCreate, UserUpdate } from '@/api/client';
import { api } from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { validatePasswordClient } from '@/lib/utils';
import { formatUserError, resolveAcademicLang } from '@/lib/academicTaxonomy';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { TactileToggle } from '@/components/ui/transitions';

interface UserFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: User | null; // undefined = create mode, User = edit mode
  currentUserId?: number;
  onSuccess: () => void;
}

interface FieldErrors {
  username?: string;
  password?: string;
  email?: string;
}

const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,48}[a-zA-Z0-9]$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function UserFormDialog({
  open,
  onOpenChange,
  user,
  currentUserId,
  onSuccess,
}: UserFormDialogProps) {
  const { t, i18n } = useTranslation();
  const lang = resolveAcademicLang(i18n.resolvedLanguage || i18n.language);
  const { user: authUser } = useAuth();
  const isEdit = Boolean(user);
  const effectiveCurrentUserId = currentUserId ?? authUser?.id;
  const isSelfEdit = Boolean(
    isEdit &&
      user &&
      effectiveCurrentUserId !== undefined &&
      user.id === effectiveCurrentUserId,
  );

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [institution, setInstitution] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'user' | 'teacher' | 'admin'>('user');
  const [planTier, setPlanTier] = useState<PlanTier>('basic');
  const [planTierTouched, setPlanTierTouched] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [canOverrideVerdicts, setCanOverrideVerdicts] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      if (user) {
        setUsername(user.username);
        setEmail(user.email ?? '');
        setFullName(user.full_name ?? '');
        setInstitution(user.institution ?? '');
        setPassword('');
        setRole(user.role as 'user' | 'teacher' | 'admin');
        setPlanTier(
          user.plan_tier ??
            (user.role === 'admin' ? 'ultra' : user.role === 'teacher' ? 'pro' : 'basic'),
        );
        setPlanTierTouched(false);
        setIsActive(user.is_active);
        setCanOverrideVerdicts(Boolean(user.can_override_verdicts));
      } else {
        setUsername('');
        setEmail('');
        setFullName('');
        setInstitution('');
        setPassword('');
        setRole('user');
        setPlanTier('basic');
        setPlanTierTouched(false);
        setIsActive(true);
        setCanOverrideVerdicts(false);
      }
      setError('');
      setFieldErrors({});
    }
  }, [open, user]);

  const clearFieldError = (field: keyof FieldErrors) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
    if (error) setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const nextFieldErrors: FieldErrors = {};
    const trimmedUsername = username.trim();
    const trimmedEmail = email.trim();

    if (!isEdit && !trimmedUsername) {
      nextFieldErrors.username =
        lang === 'vi'
          ? 'Vui lòng nhập tên đăng nhập.'
          : 'Please enter a username.';
    } else if (
      trimmedUsername &&
      (trimmedUsername.length < 3 ||
        trimmedUsername.length > 50 ||
        !USERNAME_RE.test(trimmedUsername) ||
        trimmedUsername.includes('..'))
    ) {
      nextFieldErrors.username =
        lang === 'vi'
          ? 'Tên đăng nhập gồm 3–50 ký tự (chữ cái, số, ., _, -), không có dấu chấm liên tiếp.'
          : 'Username must be 3–50 characters (letters, numbers, ., _, -), without consecutive dots.';
    }

    if (!isEdit && !password) {
      nextFieldErrors.password =
        lang === 'vi'
          ? 'Vui lòng nhập mật khẩu (tối thiểu 6 ký tự).'
          : 'Please enter a password (at least 6 characters).';
    } else if (password) {
      const pwCheck = validatePasswordClient(password, lang);
      if (!pwCheck.valid) {
        nextFieldErrors.password = pwCheck.error || t('admin.genericError');
      }
    }

    if (trimmedEmail && !EMAIL_RE.test(trimmedEmail)) {
      nextFieldErrors.email =
        lang === 'vi'
          ? 'Vui lòng nhập địa chỉ email hợp lệ.'
          : 'Please enter a valid email address.';
    }

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      return;
    }

    setFieldErrors({});

    const safeRole = isSelfEdit && user ? user.role : role;
    const safeIsActive = isSelfEdit ? true : isActive;

    const payload: UserCreate | UserUpdate = isEdit
      ? {
          username: trimmedUsername || undefined,
          email: trimmedEmail || undefined,
          full_name: fullName.trim() || undefined,
          institution: institution.trim() || undefined,
          role: safeRole || undefined,
          plan_tier: planTier,
          is_active: safeIsActive ?? undefined,
          can_override_verdicts: safeRole === 'user' ? false : canOverrideVerdicts,
          ...(password ? { password } : {}),
        }
      : {
          username: trimmedUsername,
          password,
          email: trimmedEmail || undefined,
          full_name: fullName.trim() || undefined,
          institution: institution.trim() || undefined,
          role: safeRole,
          plan_tier: planTier,
          is_active: safeIsActive,
          can_override_verdicts: safeRole === 'user' ? false : canOverrideVerdicts,
        };

    setLoading(true);
    try {
      if (isEdit && user) {
        await api.updateUser(user.id, payload as UserUpdate);
      } else {
        await api.createUser(payload as UserCreate);
      }
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      setError(formatUserError(err, lang, t('admin.genericError')));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="shrink-0 px-5 pt-5 pb-3.5 border-b border-slate-200 dark:border-slate-800 pr-12 text-left">
          <DialogTitle className="text-xl font-bold">
            {isEdit ? t('admin.editUserTitle') : t('admin.createNewUserTitle')}
          </DialogTitle>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="flex flex-col flex-1 min-h-0"
        >
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="user-form-username">
                {isEdit
                  ? lang === 'vi'
                    ? 'Tên đăng nhập'
                    : 'Username'
                  : t('admin.usernameRequiredLabel')}
              </Label>
              <Input
                id="user-form-username"
                type="text"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  clearFieldError('username');
                }}
                maxLength={50}
                disabled={loading}
                aria-invalid={Boolean(fieldErrors.username)}
                placeholder={t('admin.usernameExamplePlaceholder')}
                className={
                  fieldErrors.username
                    ? 'border-rose-400 focus-visible:ring-rose-500/30'
                    : undefined
                }
              />
              {fieldErrors.username && (
                <p
                  role="alert"
                  className="text-xs text-rose-600 dark:text-rose-400"
                >
                  {fieldErrors.username}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="user-form-password">
                {isEdit
                  ? lang === 'vi'
                    ? 'Đặt lại mật khẩu (tùy chọn)'
                    : 'Reset Password (optional)'
                  : t('admin.passwordRequiredLabel')}
              </Label>
              <Input
                id="user-form-password"
                type="password"
                data-testid="user-form-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  clearFieldError('password');
                }}
                maxLength={128}
                disabled={loading}
                aria-invalid={Boolean(fieldErrors.password)}
                placeholder={
                  isEdit
                    ? lang === 'vi'
                      ? 'Để trống nếu giữ nguyên mật khẩu hiện tại'
                      : 'Leave blank to keep current password'
                    : t('admin.passwordMinPlaceholder')
                }
                className={
                  fieldErrors.password
                    ? 'border-rose-400 focus-visible:ring-rose-500/30'
                    : undefined
                }
              />
              {fieldErrors.password && (
                <p
                  role="alert"
                  className="text-xs text-rose-600 dark:text-rose-400"
                >
                  {fieldErrors.password}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="user-form-fullname">{t('admin.fullNameLabel')}</Label>
                <Input
                  id="user-form-fullname"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  maxLength={120}
                  disabled={loading}
                  placeholder={t('admin.fullNameExamplePlaceholder')}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="user-form-email">{t('admin.emailLabel')}</Label>
                <Input
                  id="user-form-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    clearFieldError('email');
                  }}
                  disabled={loading}
                  aria-invalid={Boolean(fieldErrors.email)}
                  placeholder={t('admin.emailExamplePlaceholder')}
                  className={
                    fieldErrors.email
                      ? 'border-rose-400 focus-visible:ring-rose-500/30'
                      : undefined
                  }
                />
                {fieldErrors.email && (
                  <p
                    role="alert"
                    className="text-xs text-rose-600 dark:text-rose-400"
                  >
                    {fieldErrors.email}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="user-form-institution">
                {lang === 'vi' ? 'Đơn vị / Lớp' : 'Institution / Class'}
              </Label>
              <Input
                id="user-form-institution"
                type="text"
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                maxLength={255}
                disabled={loading}
                placeholder={t('admin.institutionExamplePlaceholder')}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="user-form-role">{t('admin.tableRole')}</Label>
                <Select
                  id="user-form-role"
                  value={role}
                  onChange={(e) => {
                    if (isSelfEdit) return;
                    const nextRole = e.target.value as 'user' | 'teacher' | 'admin';
                    setRole(nextRole);
                    if (!isEdit) {
                      setCanOverrideVerdicts(nextRole !== 'user');
                      if (!planTierTouched) {
                        setPlanTier(
                          nextRole === 'admin'
                            ? 'ultra'
                            : nextRole === 'teacher'
                              ? 'pro'
                              : 'basic',
                        );
                      }
                    }
                  }}
                  disabled={loading || isSelfEdit}
                  wrapperClassName="w-full"
                >
                  <option value="user">
                    {lang === 'vi' ? 'Sinh viên' : 'Student'}
                  </option>
                  <option value="teacher">{t('admin.roleTeacher')}</option>
                  <option value="admin">{t('admin.roleAdmin')}</option>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="user-form-plan-tier-select">
                  {lang === 'vi' ? 'Gói dịch vụ' : 'Plan Tier'}
                </Label>
                <Select
                  id="user-form-plan-tier-select"
                  data-testid="user-form-plan-tier"
                  value={planTier}
                  onChange={(e) => {
                    setPlanTier(e.target.value as PlanTier);
                    setPlanTierTouched(true);
                  }}
                  disabled={loading}
                  wrapperClassName="w-full"
                >
                  <option value="basic">CITRA Basic</option>
                  <option value="pro">CITRA Pro</option>
                  <option value="ultra">CITRA Ultra</option>
                </Select>
              </div>
            </div>

            {isSelfEdit && (
              <div
                data-testid="self-lockout-guard-note"
                className="flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200/80 dark:border-amber-800/80 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300"
              >
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                <span>
                  {lang === 'vi'
                    ? 'Không thể tự hạ quyền hoặc khóa tài khoản đang đăng nhập.'
                    : 'You cannot demote or deactivate your own account.'}
                </span>
              </div>
            )}

            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-3">
                <TactileToggle
                  id="user-form-active-switch"
                  aria-labelledby="user-form-active-label"
                  checked={isSelfEdit ? true : isActive}
                  onChange={(next) => {
                    if (!isSelfEdit) setIsActive(next);
                  }}
                  disabled={loading || isSelfEdit}
                />
                <span
                  id="user-form-active-label"
                  className="text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  {(isSelfEdit ? true : isActive)
                    ? t('admin.active')
                    : t('admin.inactive')}
                </span>
              </div>

              {role !== 'user' && (
                <div className="flex items-start gap-3">
                  <TactileToggle
                    id="user-form-override-switch"
                    aria-labelledby="user-form-override-label"
                    checked={canOverrideVerdicts}
                    onChange={setCanOverrideVerdicts}
                    disabled={loading}
                    className="mt-0.5"
                  />
                  <div className="min-w-0">
                    <span
                      id="user-form-override-label"
                      className="block text-sm font-medium text-slate-700 dark:text-slate-300"
                    >
                      {t('admin.canOverrideVerdictsLabel')}
                    </span>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                      {lang === 'vi'
                        ? 'Cho phép xác nhận hoặc điều chỉnh kết quả kiểm chứng trích dẫn của sinh viên.'
                        : 'Allows confirming or adjusting automated citation verification verdicts.'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="shrink-0 px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/95 flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-2.5">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('admin.savingBtn')}
                </>
              ) : isEdit ? (
                t('admin.saveChangesBtn')
              ) : (
                t('admin.createUser')
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
