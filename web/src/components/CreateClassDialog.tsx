import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { api, type Class, type ClassCreate } from '@/api/client';
import { formatUserError, resolveAcademicLang } from '@/lib/academicTaxonomy';
import { useModalA11y } from '@/hooks/useModalA11y';
import { UpgradeModal } from '@/components/UpgradeModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

export interface CreateClassDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (cls: Class) => void;
}

/**
 * CreateClassDialog — modal for teachers to create a new class.
 *
 * Calls `api.createClass` and bubbles the result to the parent via onCreated.
 * Closes on success; surfaces error in-component.
 */
export function CreateClassDialog({
  open,
  onClose,
  onCreated,
}: CreateClassDialogProps) {
  const { t, i18n } = useTranslation();
  const lang = resolveAcademicLang(i18n.resolvedLanguage || i18n.language);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // Reset when dialog opens/closes
  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
      setError('');
      setUpgradeOpen(false);
    }
  }, [open]);

  const { dialogProps, titleId } = useModalA11y<HTMLDivElement>(open, onClose, {
    disableEscape: upgradeOpen,
  });

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const data: ClassCreate = {
        name: name.trim(),
        description: description.trim() || undefined,
      };
      const cls = await api.createClass(data);
      onCreated(cls);
      onClose();
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : t('teacher.createClassFailed');
      const friendlyMsg = formatUserError(err, lang, t('teacher.createClassFailed'));
      setError(friendlyMsg);
      if (
        /API\s+(402|403)\b|HTTP\s+(402|403)\b|CLASS_LIMIT|limit|upgrade|max_classes|tối đa|giới hạn/i.test(
          rawMsg,
        )
      ) {
        setUpgradeOpen(true);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {createPortal(
        <div
          className="fixed inset-0 !mt-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in"
          onClick={onClose}
        >
          <div
            {...dialogProps}
            className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 max-w-md w-full max-h-[90dvh] overflow-y-auto p-4 sm:p-6 shadow-2xl animate-scale-in outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 mb-5">
              <h2
                id={titleId}
                className="font-display text-lg font-bold text-slate-900 dark:text-white"
              >
                {t('teacher.createClassModalTitle')}
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

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="class-name">
                  {t('teacher.classNameLabel')} <span className="text-rose-500">*</span>
                </Label>
                <Input
                  id="class-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={
                    lang === 'vi'
                      ? 'VD: Kinh tế lượng — K26 (HK1 2026)'
                      : 'e.g., Macroeconomics — Fall 2026 (Sec. 02)'
                  }
                  required
                  maxLength={120}
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="class-desc">{t('teacher.classDescriptionLabel')}</Label>
                <Textarea
                  id="class-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={
                    lang === 'vi'
                      ? 'VD: Lớp khóa luận tốt nghiệp thứ Ba, ca 2 (hiển thị cho sinh viên trong lớp)'
                      : 'e.g., Senior thesis seminar — visible to enrolled students'
                  }
                  maxLength={1000}
                  rows={3}
                />
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={onClose}>
                  {t('teacher.cancelBtn')}
                </Button>
                <Button
                  type="submit"
                  disabled={submitting || !name.trim()}
                >
                  {submitting ? t('teacher.creatingBtn') : t('teacher.createBtn')}
                </Button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}
      <UpgradeModal
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        featureName={
          lang === 'vi' ? 'Quản lý lớp học & bài nộp' : 'Classroom Management'
        }
        reasonDescription={error || undefined}
      />
    </>
  );
}
