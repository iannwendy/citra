/**
 * Cross-browser clipboard copy helper with iOS Safari / Mobile WebView fallback.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // 1. Modern Async Clipboard API (when available and permitted)
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand fallback (e.g., iOS Safari after async await or non-HTTPS)
    }
  }

  // 2. Synchronous textarea + document.execCommand('copy') fallback for iOS Safari & mobile browsers
  if (typeof document !== 'undefined') {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '0';
      textarea.style.left = '0';
      textarea.style.width = '1px';
      textarea.style.height = '1px';
      textarea.style.padding = '0';
      textarea.style.border = 'none';
      textarea.style.outline = 'none';
      textarea.style.boxShadow = 'none';
      textarea.style.background = 'transparent';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus({ preventScroll: true });
      textarea.select();
      textarea.setSelectionRange(0, text.length);
      const copied = typeof document.execCommand === 'function' ? document.execCommand('copy') : true;
      document.body.removeChild(textarea);
      return Boolean(copied);
    } catch {
      return false;
    }
  }

  return false;
}
