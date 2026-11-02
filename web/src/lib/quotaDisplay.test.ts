import { describe, it, expect } from 'vitest';
import { formatLimit, getQuotaView, isUnlimitedValue, unlimitedLabel } from './quotaDisplay';
import { QUOTA_BY_TIER } from '@/test-utils';

describe('quotaDisplay', () => {
  it('treats sentinel values (>= 9999) and null as unlimited', () => {
    expect(isUnlimitedValue(999999)).toBe(true);
    expect(isUnlimitedValue(9999)).toBe(true);
    expect(isUnlimitedValue(null)).toBe(true);
    expect(isUnlimitedValue(1000)).toBe(false);
    expect(isUnlimitedValue(0)).toBe(false);
  });

  it('formats limits with localized Unlimited label', () => {
    expect(formatLimit(999999, 'en')).toBe('Unlimited');
    expect(formatLimit(9999, 'vi')).toBe('Không giới hạn');
    expect(formatLimit(1000, 'en')).toBe('1,000');
    expect(formatLimit(50, 'en', { forceUnlimited: true })).toBe('Unlimited');
    expect(unlimitedLabel('vi')).toBe('Không giới hạn');
  });

  it('admin quota view never exposes raw sentinel numbers', () => {
    const view = getQuotaView(
      { ...QUOTA_BY_TIER.ultra, monthly_uploads_used: 0, monthly_uploads_limit: 999999, max_pages_per_pdf: 9999 },
      'en',
      { isAdmin: true },
    );
    expect(view.usage).toBe('Unlimited');
    expect(view.pages).toBe('Unlimited');
    expect(view.fileSize).toBe('100 MB');
    expect(view.exhausted).toBe(false);
    expect(JSON.stringify(view)).not.toMatch(/9999/);
  });

  it('admin is unlimited even when backend reports Ultra numbers', () => {
    const view = getQuotaView(QUOTA_BY_TIER.ultra, 'vi', { isAdmin: true });
    expect(view.usage).toBe('Không giới hạn');
    expect(view.uploadsUnlimited).toBe(true);
  });

  it('regular users keep their numeric usage and exhausted state', () => {
    const basic = getQuotaView({ ...QUOTA_BY_TIER.basic, monthly_uploads_used: 3 }, 'en');
    expect(basic.usage).toBe('3/3');
    expect(basic.exhausted).toBe(true);
    expect(basic.percent).toBe(100);
    expect(basic.pages).toBe('15');
  });
});
