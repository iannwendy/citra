import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import vi from './locales/vi.json';

function collectKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...collectKeys(v as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

function collectLeafEntries(
  obj: Record<string, unknown>,
  prefix = '',
): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...collectLeafEntries(v as Record<string, unknown>, path));
    } else if (typeof v === 'string') {
      out.push({ key: path, value: v });
    }
  }
  return out;
}

const VIETNAMESE_DIACRITIC_REGEX =
  /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

const ALLOWLISTED_PROPER_NOUNS = [
  'Tôn Đức Thắng',
  'Nguyễn Văn A',
  'Đặng',
  'Luật',
  'Nghị định',
  'Thông tư',
];

function stripAllowlistedProperNouns(text: string): string {
  let result = text;
  for (const noun of ALLOWLISTED_PROPER_NOUNS) {
    result = result.split(noun).join('');
  }
  return result;
}

describe('en.json and vi.json locale parity & Vietnamese leakage guard', () => {
  it('maintains 100% key parity between en.json and vi.json', () => {
    const enKeys = new Set(collectKeys(en as Record<string, unknown>));
    const viKeys = new Set(collectKeys(vi as Record<string, unknown>));

    const missingInEn = [...viKeys].filter((k) => !enKeys.has(k));
    const missingInVi = [...enKeys].filter((k) => !viKeys.has(k));

    expect(missingInEn).toEqual([]);
    expect(missingInVi).toEqual([]);
  });

  it('contains no unintended Vietnamese diacritics or sentences in en.json', () => {
    const entries = collectLeafEntries(en as Record<string, unknown>);
    const leakedEntries = entries.filter(({ value }) => {
      const cleaned = stripAllowlistedProperNouns(value);
      return VIETNAMESE_DIACRITIC_REGEX.test(cleaned);
    });

    expect(leakedEntries).toEqual([]);
  });
});
