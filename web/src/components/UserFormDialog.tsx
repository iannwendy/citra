import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { User, UserCreate, UserUpdate } from '@/api/client';
import { api } from '@/api/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface UserFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: User | null; // undefined = create mode, User = edit mode
  onSuccess: () => void;
}

export function UserFormDialog({
  open,
  onOpenChange,
  user,
  onSuccess,
}: UserFormDialogProps) {
  const { t } = useTranslation();
  const isEdit = Boolean(user);

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [institution, setInstitution] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'user' | 'teacher' | 'admin'>('user');
  const [isActive, setIsActive] = useState(true);
  const [canOverrideVerdicts, setCanOverrideVerdicts] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
        setIsActive(user.is_active);
        setCanOverrideVerdicts(Boolean(user.can_override_verdicts));
      } else {
        setUsername('');
        setEmail('');
        setFullName('');
        setInstitution('');
        setPassword('');
        setRole('user');
        setIsActive(true);
        setCanOverrideVerdicts(false);
      }
      setError('');
    }
  }, [open, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const payload: UserCreate | UserUpdate = isEdit
      ? {
          username: username || undefined,
          email: email || undefined,
          full_name: fullName || undefined,
          institution: institution.trim() || undefined,
          role: role || undefined,
          is_active: isActive ?? undefined,
          can_override_verdicts: role === 'user' ? false : canOverrideVerdicts,
          ...(password ? { password } : {}),
        }
      : {
          username,
          password,
          email: email || undefined,
          full_name: fullName || undefined,
          institution: institution.trim() || undefined,
          role,
          is_active: isActive,
          can_override_verdicts: role === 'user' ? false : canOverrideVerdicts,
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
      setError(err instanceof Error ? err.message : t('admin.genericError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader className="mb-2">
          <DialogTitle className="text-xl font-bold">
            {isEdit ? t('admin.editUserTitle') : t('admin.createNewUserTitle')}
          </DialogTitle>
        </DialogHeader>

        {error && (
          <Alert variant="destructive" className="mb-2">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t('admin.usernameRequiredLabel')}</Label>
            <Input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required={!isEdit}
              minLength={3}
              maxLength={50}
              disabled={loading}
              placeholder={t('admin.usernameExamplePlaceholder')}
            />
          </div>

          {!isEdit && (
            <div className="space-y-1.5">
              <Label>{t('admin.passwordRequiredLabel')}</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required={!isEdit}
                minLength={6}
                maxLength={128}
                disabled={loading}
                placeholder={t('admin.passwordMinPlaceholder')}
              />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t('admin.fullNameLabel')}</Label>
              <Input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                maxLength={120}
                disabled={loading}
                placeholder={t('admin.fullNameExamplePlaceholder')}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t('admin.emailLabel')}</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                placeholder={t('admin.emailExamplePlaceholder')}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t('admin.institutionClassLabel')}</Label>
            <Input
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
              <Label>{t('admin.tableRole')}</Label>
              <Select
                value={role}
                onChange={(e) => {
                  const nextRole = e.target.value as 'user' | 'teacher' | 'admin';
                  setRole(nextRole);
                  if (!isEdit) {
                    setCanOverrideVerdicts(nextRole !== 'user');
                  }
                }}
                disabled={loading}
                wrapperClassName="w-full"
              >
                <option value="user">{t('admin.roleUser')}</option>
                <option value="teacher">{t('admin.roleTeacher')}</option>
                <option value="admin">{t('admin.roleAdmin')}</option>
              </Select>
            </div>

            <div className="flex flex-col justify-end gap-2 sm:pt-4">
              <div className="flex items-center gap-3">
                <Switch
                  checked={isActive}
                  onCheckedChange={setIsActive}
                  disabled={loading}
                />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {isActive ? t('admin.active') : t('admin.inactive')}
                </span>
              </div>
              {role !== 'user' && (
                <div className="flex items-center gap-3">
                  <Switch
                    checked={canOverrideVerdicts}
                    onCheckedChange={setCanOverrideVerdicts}
                    disabled={loading}
                  />
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    {t('admin.canOverrideVerdictsLabel')}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-2.5 pt-2">
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
