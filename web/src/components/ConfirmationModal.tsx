/**
 * ConfirmationModal — Accessible confirmation dialog built on shadcn/ui Dialog.
 *
 * Replaces native `window.confirm()` so destructive actions follow the design
 * system (toast + dialog ARIA + focus trap + Escape close).
 */
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" tints the confirm button red; "default" uses indigo. */
  variant?: 'default' | 'danger';
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmationModal({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmationModalProps) {
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        className="max-w-md"
        onEscapeKeyDown={onCancel}
        onPointerDownOutside={onCancel}
      >
        <div className="flex items-start gap-4">
          {variant === 'danger' && (
            <div
              className="shrink-0 w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center"
              aria-hidden="true"
            >
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
          )}
          <DialogHeader className="flex-1 min-w-0 text-left">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="mt-1.5">{message}</DialogDescription>
          </DialogHeader>
        </div>

        <DialogFooter className="mt-4">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={submitting}
            data-testid="confirmation-cancel-btn"
            className="w-full sm:w-auto"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={variant === 'danger' ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={submitting}
            data-testid="confirmation-confirm-btn"
            className="w-full sm:w-auto"
          >
            {submitting ? 'Working...' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
