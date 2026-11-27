import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { User } from '@/api/client';
import { api } from '@/api/client';
import { formatUserError, resolveAcademicLang } from '@/lib/academicTaxonomy';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface DeleteUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User | null;
  currentUserId?: number;
  onSuccess: () => void;
}

export function DeleteUserDialog({
  open,
  onOpenChange,
  user,
  currentUserId,
  onSuccess,
}: DeleteUserDialogProps) {
  const { t, i18n } = useTranslation();
  const lang = resolveAcademicLang(i18n.language);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isSelf = currentUserId !== undefined && user?.id === currentUserId;

  useEffect(() => {
    if (!open) {
      setError('');
    }
  }, [open]);

  const handleDelete = async () => {
    if (!user || isSelf) return;
    setLoading(true);
    setError('');
    try {
      await api.deleteUser(user.id);
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      setError(formatUserError(err, lang, t('admin.deleteFailed')));
    } finally {
      setLoading(false);
    }
  };

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" hideCloseButton>
        <div className="flex items-start gap-4 mb-3">
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950 shrink-0">
            <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <DialogTitle className="text-lg font-bold mb-1">
              {t('admin.deleteUserTitle')}
            </DialogTitle>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {t('admin.deleteUserConfirmPrefix')}{' '}
              <span className="font-semibold text-slate-900 dark:text-white">
                {user.full_name?.trim() ? `${user.full_name} (@${user.username})` : user.username}
              </span>
              {t('admin.deleteUserConfirmSuffix')}
            </p>
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              {lang === 'vi'
                ? 'Tất cả bài nộp, báo cáo và phiên đăng nhập của tài khoản này sẽ bị xóa vĩnh viễn. Nếu chỉ muốn tạm ngưng quyền truy cập, bạn có thể tắt trạng thái hoạt động trong mục Chỉnh sửa.'
                : 'All submissions, reports, and active sessions for this account will be permanently removed. To temporarily suspend access instead, turn off Account Active in Edit.'}
            </p>
          </div>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-3">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {isSelf && (
          <Alert variant="warning" className="mb-3">
            <AlertDescription>
              {t('admin.cannotDeleteOwnAccount')}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-2.5">
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {t('common.cancel')}
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={loading || isSelf}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('admin.deletingBtn')}
              </>
            ) : (
              t('admin.deleteUserTitle')
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
