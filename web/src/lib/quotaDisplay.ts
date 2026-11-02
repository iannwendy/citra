/**
 * Quota display helpers.
 *
 * Admin accounts (and any plan limit at or above the sentinel) must never show
 * raw numbers like `0/999999` or `9999 pages` — they render "Unlimited" /
 * "Không giới hạn" instead (cross-agent contract C3).
 */
import type { UserQuota } from '@/api/client';

/** Any limit >= this value is a backend "no practical limit" sentinel. */
export const UNLIMITED_SENTINEL = 9999;

export type DisplayLang = 'vi' | 'en';

export function unlimitedLabel(lang: DisplayLang): string {
  return lang === 'vi' ? 'Không giới hạn' : 'Unlimited';
}

export function isUnlimitedValue(value: number | null | undefined): boolean {
  return value == null || !Number.isFinite(value) || value >= UNLIMITED_SENTINEL;
}

/** Format one limit value, returning the localized "Unlimited" label for sentinels. */
export function formatLimit(
  value: number | null | undefined,
  lang: DisplayLang,
  { forceUnlimited = false }: { forceUnlimited?: boolean } = {},
): string {
  if (forceUnlimited || isUnlimitedValue(value)) return unlimitedLabel(lang);
  return (value as number).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US');
}

export interface QuotaView {
  /** True when monthly uploads have no practical limit (admin or sentinel). */
  uploadsUnlimited: boolean;
  /** "3/50" or "Unlimited" */
  usage: string;
  /** "50" or "Unlimited" */
  uploadsLimit: string;
  /** "25 MB" or "Unlimited" */
  fileSize: string;
  /** "100" or "Unlimited" */
  pages: string;
  /** 0–100 usage percentage for meters (0 when unlimited). */
  percent: number;
  /** Whether the user has exhausted the monthly quota. */
  exhausted: boolean;
}

export function getQuotaView(
  quota: UserQuota,
  lang: DisplayLang,
  { isAdmin = false }: { isAdmin?: boolean } = {},
): QuotaView {
  const uploadsUnlimited = isAdmin || isUnlimitedValue(quota.monthly_uploads_limit);
  const pagesUnlimited = isAdmin || isUnlimitedValue(quota.max_pages_per_pdf);
  const sizeUnlimited = isUnlimitedValue(quota.max_file_size_mb);
  const used = quota.monthly_uploads_used ?? 0;
  const limit = quota.monthly_uploads_limit ?? 0;
  return {
    uploadsUnlimited,
    usage: uploadsUnlimited ? unlimitedLabel(lang) : `${used}/${limit}`,
    uploadsLimit: formatLimit(limit, lang, { forceUnlimited: uploadsUnlimited }),
    fileSize: sizeUnlimited ? unlimitedLabel(lang) : `${quota.max_file_size_mb} MB`,
    pages: formatLimit(quota.max_pages_per_pdf, lang, { forceUnlimited: pagesUnlimited }),
    percent: uploadsUnlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100)),
    exhausted: !uploadsUnlimited && used >= limit,
  };
}
