import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import i18n from './index';
import en from './locales/en.json';
import vi from './locales/vi.json';

describe('i18n configuration and Task 5.1 translation fixes', () => {
  it('translates dashboard.noDocumentsAdmin and dashboard.noDocumentsTeacher to English in en.json', () => {
    expect(en.dashboard.noDocumentsAdmin).toBe('No submissions in the system yet.');
    expect(en.dashboard.noDocumentsTeacher).toBe('No submissions in your classes yet.');
    expect(vi.dashboard.noDocumentsAdmin).toBe('Chưa có bài nộp nào trong hệ thống.');
    expect(vi.dashboard.noDocumentsTeacher).toBe('Chưa có bài nộp nào trong lớp bạn phụ trách.');
  });

  it('defines override.errorToast in both en.json and vi.json and resolves via i18n.t', () => {
    expect(en.override.errorToast).toBe('Failed to update verdict override. Please try again.');
    expect(vi.override.errorToast).toBe(
      'Không thể cập nhật phán quyết ghi đè. Vui lòng thử lại.',
    );
    expect(i18n.t('override.errorToast', { lng: 'en' })).toBe(
      'Failed to update verdict override. Please try again.',
    );
    expect(i18n.t('override.errorToast', { lng: 'vi' })).toBe(
      'Không thể cập nhật phán quyết ghi đè. Vui lòng thử lại.',
    );
  });

  it('unifies language detection fallback to startsWith("vi") ? "vi" : "en" across EssayPage and GoogleOnboardingModal', () => {
    const essayPageSrc = fs.readFileSync(
      path.resolve(__dirname, '../pages/EssayPage.tsx'),
      'utf8',
    );
    const onboardingSrc = fs.readFileSync(
      path.resolve(__dirname, '../components/GoogleOnboardingModal.tsx'),
      'utf8',
    );

    expect(essayPageSrc).not.toContain("startsWith('en') ? 'en' : 'vi'");
    expect(essayPageSrc).toContain("i18n.language?.startsWith('vi') ? 'vi' : 'en'");
    expect(onboardingSrc).toContain("i18n.language?.startsWith('vi') ? 'vi' : 'en'");
  });
});
