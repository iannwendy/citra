import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Search } from 'lucide-react';
import { api, type ClassStudent } from '@/api/client';
import { formatUserError, resolveAcademicLang } from '@/lib/academicTaxonomy';
import { useDebounce } from '@/hooks/useDebounce';
import { useModalA11y } from '@/hooks/useModalA11y';
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
  const { t, i18n } = useTranslation();
  const lang = resolveAcademicLang(i18n.resolvedLanguage || i18n.language);
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
          setError(formatUserError(e, lang, t('teacher.loadStudentsFailed')));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, debouncedSearch, lang, t]);

  const { dialogProps, titleId } = useModalA11y<HTMLDivElement>(open, onClose);

  if (!open) return null;

  const q = search.trim().toLowerCase();
  const candidates = users.filter(
    (u) =>
      !existingStudentIds.includes(u.id) &&
      (!q ||
        u.username.toLowerCase().includes(q) ||
        (u.full_name ?? '').toLowerCase().includes(q) ||
        (u.email ?? '').toLowerCase().includes(q)),
  );

  const searchPlaceholder =
    lang === 'vi'
      ? 'Tìm theo họ tên, email hoặc tên đăng nhập…'
      : 'Search by name, email, or username…';
  const minCharsHint =
    lang === 'vi'
      ? 'Nhập ít nhất 2 ký tự để tìm sinh viên theo họ tên, email hoặc tên đăng nhập'
      : 'Type at least 2 characters to search all students by name, email, or username';

  const handleAdd = async (studentId: number) => {
    setSubmitting(true);
    setError('');
    try {
      await api.addStudentToClass(classId, studentId);
      onAdded();
      onClose();
    } catch (err) {
      setError(formatUserError(err, lang, t('teacher.addStudentFailed')));
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 !mt-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        {...dialogProps}
        className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 max-w-md w-full max-h-[90dvh] overflow-y-auto p-4 sm:p-6 shadow-2xl animate-scale-in outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2
            id={titleId}
            className="font-display text-lg font-bold text-slate-900 dark:text-white"
          >
            {t('teacher.addStudentModalTitle')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('teacher.closeModal')}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
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
            placeholder={searchPlaceholder}
            aria-label={t('teacher.searchStudentsAria')}
            className="pl-10"
          />
        </div>

        {search.trim().length < 2 && (
          <p
            data-testid="student-search-hint"
            className="text-xs text-slate-500 dark:text-slate-400 mb-3"
          >
            {minCharsHint}
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
            <li
              data-testid="student-search-empty-state"
              className="text-sm text-slate-500 dark:text-slate-400 px-2 py-6 text-center"
            >
              {q.length < 2
                ? lang === 'vi'
                  ? 'Nhập tên hoặc email sinh viên để tìm kiếm...'
                  : 'Type a student name or email to search...'
                : t('teacher.noMatchingStudents')}
            </li>
          ) : (
            candidates.map((u) => (
              <li
                key={u.id}
                className="flex items-center justify-between gap-2 p-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
              >
                <div className="min-w-0">
                  {u.full_name ? (
                    <>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {u.full_name}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {u.username}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {u.username}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  onClick={() => handleAdd(u.id)}
                  disabled={submitting}
                  className="shrink-0"
                >
                  {t('teacher.addStudentBtn')}
                </Button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
