/**
 * useModalA11y — accessibility plumbing for hand-rolled (non-Radix) modals.
 *
 * Gives a custom overlay the same behaviour as the shadcn/Radix Dialog:
 *  - `role="dialog"`, `aria-modal="true"`, `aria-labelledby` props
 *  - Escape closes the modal
 *  - Tab / Shift+Tab focus is trapped inside the dialog
 *  - initial focus moves into the dialog and is restored on close
 *
 * @example
 *   const { dialogProps, titleId } = useModalA11y(open, onClose);
 *   return open ? <div {...dialogProps}><h2 id={titleId}>Title</h2>…</div> : null;
 */
import { useCallback, useEffect, useId, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function getFocusable(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('aria-hidden') && el.getAttribute('aria-disabled') !== 'true',
  );
}

export interface ModalA11yOptions {
  /** Element to focus when opened (defaults to the first focusable element). */
  initialFocusRef?: RefObject<HTMLElement>;
  /** Disable Escape-to-close (e.g. while a payment is processing). */
  disableEscape?: boolean;
}

export interface ModalA11yResult<T extends HTMLElement> {
  ref: RefObject<T>;
  titleId: string;
  descriptionId: string;
  dialogProps: {
    ref: RefObject<T>;
    role: 'dialog';
    'aria-modal': true;
    'aria-labelledby': string;
    tabIndex: -1;
  };
}

export function useModalA11y<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onClose: () => void,
  { initialFocusRef, disableEscape = false }: ModalA11yOptions = {},
): ModalA11yResult<T> {
  const ref = useRef<T>(null);
  const reactId = useId();
  const titleId = `modal-title-${reactId}`;
  const descriptionId = `modal-desc-${reactId}`;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const disableEscapeRef = useRef(disableEscape);
  disableEscapeRef.current = disableEscape;

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const container = ref.current;
    if (!container) return;
    if (event.key === 'Escape') {
      if (disableEscapeRef.current) return;
      event.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = getFocusable(container);
    if (focusable.length === 0) {
      event.preventDefault();
      container.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const inside = active ? container.contains(active) : false;
    if (event.shiftKey) {
      if (!inside || active === first || active === container) {
        event.preventDefault();
        last.focus();
      }
    } else if (!inside || active === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusInitial = () => {
      const container = ref.current;
      if (!container) return;
      const target = initialFocusRef?.current ?? getFocusable(container)[0] ?? container;
      target.focus({ preventScroll: true });
    };
    focusInitial();
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function' && previouslyFocused.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, handleKeyDown]);

  return {
    ref,
    titleId,
    descriptionId,
    dialogProps: {
      ref,
      role: 'dialog',
      'aria-modal': true,
      'aria-labelledby': titleId,
      tabIndex: -1,
    },
  };
}
