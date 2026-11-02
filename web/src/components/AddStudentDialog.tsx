import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Search } from 'lucide-react';
import { api, type ClassStudent } from '@/api/client';
import { useDebounce } from '@/hooks/useDebounce';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

export interface AddStudentDialogProps {
  open: boolean;
  classId: number;
  existingStudentIds: number[];
  onClose: () => void;
  onAdded: () => void;
}

/**
 * AddStudentDialog — search and add students to a class.
 *
 * Lists users with role='user' (students), filters out those already enrolled,
 * and supports debounced server-side search by username/email/full_name (Contract C1).
 */
export function AddStudentDialog({
  open,
  classId,
  existingStudentIds,
  onClose,
  onAdded,
}: AddStudentDialogProps) {
  const { t } = useTranslation();
  const [users, setUsers] = useState<ClassStudent[]>([]);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setSearch('');
    }
  }, [open]);

  // Load students list when dialog opens or debounced search changes
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    const trimmed = debouncedSearch.trim();
    api
      .listStudents(trimmed.length >= 2 ? trimmed : undefined)
      .then((data) => {
        if (!cancelled) setUsers(data);
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : t('teacher.loadStudentsFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, debouncedSearch, t]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const q = search.trim().toLowerCase();
  const candidates = users.filter(
    (u) =>
      !existingStudentIds.includes(u.id) &&
      (!q ||
        u.username.toLowerCase().includes(q) ||
        (u.full_name ?? '').toLowerCase().includes(q) ||
        (u.email ?? '').toLowerCase().includes(q))
  );

  const handleAdd = async (studentId: number) => {
    setSubmitting(true);
    setError('');
    try {
      await api.addStudentToClass(classId, studentId);
      onAdded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('teacher.addStudentFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-student-title"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 max-w-md w-full max-h-[90dvh] overflow-y-auto p-4 sm:p-6 shadow-2xl animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2
            id="add-student-title"
            className="font-display text-lg font-bold text-slate-900 dark:text-white"
          >
            {t('teacher.addStudentModalTitle')}
          </h2>
          <button
            onClick={onClose}
            aria-label={t('teacher.closeModal')}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <div className="relative mb-2">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('teacher.searchStudentsPlaceholder')}
            aria-label={t('teacher.searchStudentsAria')}
            className="pl-10"
          />
        </div>

        {search.trim().length < 2 && (
          <p
            data-testid="student-search-hint"
            className="text-xs text-slate-500 dark:text-slate-400 mb-3"
          >
            {t('teacher.searchStudentsMinCharsHint')}
          </p>
        )}

        {error && (
          <Alert variant="destructive" className="mb-3">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <ul
          className="max-h-80 overflow-y-auto space-y-1 divide-y divide-slate-100 dark:divide-slate-800"
          aria-busy={loading}
        >
          {loading ? (
            <li className="text-sm text-slate-500 px-2 py-6 text-center">
              {t('teacher.loadingStudents')}
            </li>
          ) : candidates.length === 0 ? (
            <li className="text-sm text-slate-500 px-2 py-6 text-center">
              {t('teacher.noMatchingStudents')}
            </li>
          ) : (
            candidates.map((u) => (
              <li
                key={u.id}
                className="flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {u.username}
                  </p>
                  {u.full_name && (
                    <p className="text-xs text-slate-500 truncate">
                      {u.full_name}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  onClick={() => handleAdd(u.id)}
                  disabled={submitting}
                >
                  {t('teacher.addStudentBtn')}
                </Button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
