import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { api, type Class, type ClassCreate } from '@/api/client';
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
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Reset when dialog opens/closes
  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
      setError('');
    }
  }, [open]);

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
      setError(err instanceof Error ? err.message : t('teacher.createClassFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-class-title"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 max-w-md w-full max-h-[90dvh] overflow-y-auto p-4 sm:p-6 shadow-2xl animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2
            id="create-class-title"
            className="font-display text-lg font-bold text-slate-900 dark:text-white"
          >
            {t('teacher.createClassModalTitle')}
          </h2>
          <button
            onClick={onClose}
            aria-label={t('teacher.closeModal')}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
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
    </div>
  );
}
