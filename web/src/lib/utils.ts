import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F]/;

/**
 * Validate and normalize an untrusted external URL so only `http:` and `https:`
 * schemes can ever be rendered into `<a href={...}>` or navigated via `window.location`.
 */
export function toSafeExternalHref(raw?: string | null): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '—' || trimmed === '#') return null;
  if (CONTROL_CHARS_RE.test(trimmed) || /\\/.test(trimmed)) return null;
  if (!/^https?:\/\/[^/\s\\]/i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (!parsed.hostname) {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

/**
 * Safely resolve either a full `http(s)://(dx.)doi.org/10.xxxx/...` URL or a bare
 * `10.xxxx/...` DOI identifier into a navigable `https://doi.org/...` link, blocking
 * `javascript:` / `data:` / `vbscript:` schemes and non-DOI phishing hostnames.
 */
export function toSafeDoiHref(raw?: string | null): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '—') return null;
  if (CONTROL_CHARS_RE.test(trimmed) || /\\/.test(trimmed)) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    const safeUrl = toSafeExternalHref(trimmed);
    if (!safeUrl) return null;
    try {
      const parsed = new URL(safeUrl);
      const host = parsed.hostname.toLowerCase();
      if (host !== 'doi.org' && host !== 'dx.doi.org') {
        return null;
      }
      if (!/^\/10\.\d{2,9}\/\S+$/i.test(parsed.pathname)) {
        return null;
      }
      return safeUrl;
    } catch {
      return null;
    }
  }

  const cleanDoi = trimmed
    .replace(/^doi:\s*/i, '')
    .replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, '')
    .trim();

  if (!/^10\.\d{2,9}\/\S+$/i.test(cleanDoi)) {
    return null;
  }

  const encoded = encodeURI(cleanDoi)
    .replace(/#/g, '%23')
    .replace(/\?/g, '%3F');
  return toSafeExternalHref(`https://doi.org/${encoded}`);
}

export interface PasswordValidationResult {
  valid: boolean;
  reason?: 'too_short' | 'too_long' | 'utf8_bytes';
  error?: string;
}

/**
 * Shared client-side password validator aligned with FastAPI + bcrypt limits:
 * - 6..128 characters
 * - not whitespace-only
 * - <= 72 UTF-8 bytes (bcrypt truncation ceiling)
 */
export function validatePasswordClient(
  password: string,
  lang: 'en' | 'vi' = 'en',
): PasswordValidationResult {
  if (typeof password !== 'string' || password.length < 6 || !password.trim()) {
    return {
      valid: false,
      reason: 'too_short',
      error:
        lang === 'vi'
          ? 'Mật khẩu phải có tối thiểu 6 ký tự và không chỉ gồm khoảng trắng.'
          : 'Password must be at least 6 characters and not whitespace-only.',
    };
  }
  if (password.length > 128) {
    return {
      valid: false,
      reason: 'too_long',
      error:
        lang === 'vi'
          ? 'Mật khẩu không được vượt quá 128 ký tự.'
          : 'Password must not exceed 128 characters.',
    };
  }
  if (new TextEncoder().encode(password).length > 72) {
    return {
      valid: false,
      reason: 'utf8_bytes',
      error:
        lang === 'vi'
          ? 'Mật khẩu hơi dài (tối đa khoảng 50 ký tự nếu có dấu tiếng Việt). Vui lòng chọn mật khẩu ngắn hơn.'
          : 'Password is too long. Please use a shorter password (under 64 characters).',
    };
  }
  return { valid: true };
}
