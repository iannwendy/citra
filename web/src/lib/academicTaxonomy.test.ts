import { createElement } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import {
  normalizeVerdictKey,
  getVerdictDisplay,
  normalizeMappingStatusKey,
  getMappingStatusDisplay,
  formatCisScore,
  formatLocalizedDate,
  formatLocalizedDateTime,
  formatIntentLabel,
  formatStanceLabel,
  formatUserError,
  getScannedPdfNotice,
  formatCitationStyleLabel,
  isInstitutionalAuthor,
  splitRawAuthorString,
  formatAcademicAuthorShort,
  sanitizeReasoningForDisplay,
} from './academicTaxonomy';
import { DecisionSupportBanner } from '@/components/DecisionSupportBanner';

describe('academicTaxonomy — unified verdict, mapping, CIS, dates, errors & notices', () => {
  describe('normalizeVerdictKey & getVerdictDisplay', () => {
    it('normalizes legacy, uppercase, hyphenated, and alias verdict variants into 5 canonical keys', () => {
      expect(normalizeVerdictKey('VERIFIED')).toBe('verified');
      expect(normalizeVerdictKey('likely_verified')).toBe('verified');
      expect(normalizeVerdictKey('METADATA_ERROR')).toBe('metadata_error');
      expect(normalizeVerdictKey('source-mismatch')).toBe('metadata_error');
      expect(normalizeVerdictKey('incomplete_metadata')).toBe('metadata_error');
      expect(normalizeVerdictKey('HALLUCINATED')).toBe('suspected_hallucination');
      expect(normalizeVerdictKey('suspected_hallucination')).toBe('suspected_hallucination');
      expect(normalizeVerdictKey('likely_hallucinated')).toBe('suspected_hallucination');
      expect(normalizeVerdictKey('url_resource')).toBe('resource');
      expect(normalizeVerdictKey('web_resource')).toBe('resource');
      expect(normalizeVerdictKey('legal_resource')).toBe('resource');
      expect(normalizeVerdictKey('unverifiable')).toBe('unresolved');
      expect(normalizeVerdictKey(null)).toBe('unresolved');
      expect(normalizeVerdictKey(undefined)).toBe('unresolved');
    });

    it('returns non-accusatory VI and EN labels and WCAG AA style classes without raw enums or Bịa đặt', () => {
      const viNotFound = getVerdictDisplay('SUSPECTED_HALLUCINATION', 'vi');
      expect(viNotFound.key).toBe('suspected_hallucination');
      expect(viNotFound.label).toBe('Không tìm thấy nguồn');
      expect(viNotFound.label).not.toMatch(/bịa đặt|hallucination/i);
      expect(viNotFound.badgeClass).toContain('text-red-700');

      const enNotFound = getVerdictDisplay('hallucinated', 'en');
      expect(enNotFound.label).toBe('Source Not Found');
      expect(enNotFound.label).not.toMatch(/hallucinat/i);

      expect(getVerdictDisplay('verified', 'vi').label).toBe('Đã xác minh');
      expect(getVerdictDisplay('verified', 'en').label).toBe('Verified');

      expect(getVerdictDisplay('metadata_error', 'vi').label).toBe('Sai lệch thông tin');
      expect(getVerdictDisplay('metadata_error', 'en').label).toBe('Details Mismatch');

      expect(getVerdictDisplay('unresolved', 'vi').label).toBe('Chưa đủ dữ liệu');
      expect(getVerdictDisplay('unresolved', 'en').label).toBe('Unverified');

      expect(getVerdictDisplay('legal_resource', 'vi').label).toBe('Nguồn Web / Văn bản');
      expect(getVerdictDisplay('web_resource', 'en').label).toBe('Web / Legal Source');
    });
  });

  describe('normalizeMappingStatusKey & getMappingStatusDisplay', () => {
    it('supports all 8 Layer-1 mapping statuses plus not_applicable in VI and EN', () => {
      const cases = [
        ['matched', 'Đã liên kết', 'Linked'],
        ['missing_reference', 'Thiếu nguồn', 'No Reference'],
        ['uncited_reference', 'Chưa trích dẫn', 'Not Cited'],
        ['in_text_mismatch', 'Sai lệch', 'Mismatch'],
        ['duplicate_reference', 'Trùng lặp', 'Duplicate'],
        ['ambiguous_mapping', 'Mơ hồ', 'Ambiguous'],
        ['style_inconsistent', 'Sai chuẩn', 'Style Issue'],
        ['unresolved', 'Chưa xác định', 'Unresolved'],
        ['not_applicable', 'Không áp dụng', 'Not Applicable'],
      ] as const;

      for (const [raw, expectedVi, expectedEn] of cases) {
        expect(normalizeMappingStatusKey(raw.toUpperCase())).toBe(raw);
        const vi = getMappingStatusDisplay(raw, 'vi');
        const en = getMappingStatusDisplay(raw, 'en');
        expect(vi.label).toBe(expectedVi);
        expect(en.label).toBe(expectedEn);
        expect(vi.description.length).toBeGreaterThan(10);
        expect(en.description.length).toBeGreaterThan(10);
      }

      expect(normalizeMappingStatusKey('LINKED')).toBe('matched');
      expect(normalizeMappingStatusKey('missing_ref')).toBe('missing_reference');
      expect(normalizeMappingStatusKey('n/a')).toBe('not_applicable');
    });
  });

  describe('formatCisScore', () => {
    it('formats numeric scores as XX.X / 100 (never %) and returns — for null/NaN/unscannable', () => {
      expect(formatCisScore(91.5)).toBe('91.5 / 100');
      expect(formatCisScore(100)).toBe('100.0 / 100');
      expect(formatCisScore(0)).toBe('0.0 / 100');
      expect(formatCisScore(84.46, { decimals: 0 })).toBe('84 / 100');
      expect(formatCisScore(91.5)).not.toContain('%');
      expect(formatCisScore(91.5, { isUnscannable: true })).toBe('—');
      expect(formatCisScore(null)).toBe('—');
      expect(formatCisScore(undefined)).toBe('—');
      expect(formatCisScore(Number.NaN)).toBe('—');
    });
  });

  describe('formatLocalizedDate & formatLocalizedDateTime', () => {
    it('formats VI as DD/MM/YYYY and EN as MMM D, YYYY, returning — for invalid values', () => {
      expect(formatLocalizedDate('2026-11-27', 'vi')).toBe('27/11/2026');
      expect(formatLocalizedDate('2026-11-27', 'en')).toBe('Nov 27, 2026');
      expect(formatLocalizedDate(null, 'vi')).toBe('—');
      expect(formatLocalizedDate('not-a-date', 'en')).toBe('—');
    });

    it('formats 24h datetimes with explicit timezone markers in VI and EN', () => {
      // 2026-11-27T01:20:00Z = 08:20 in Asia/Ho_Chi_Minh (GMT+7)
      expect(formatLocalizedDateTime('2026-11-27T01:20:00Z', 'vi')).toBe(
        '27/11/2026 · 08:20 (GMT+7)',
      );
      const enDt = formatLocalizedDateTime('2026-11-27T01:20:00Z', 'en');
      expect(enDt).toMatch(/^Nov 27, 2026, \d{2}:20 \(UTC(?:[+-]\d+(?::\d{2})?)?\)$/);
      expect(formatLocalizedDateTime('', 'vi')).toBe('—');
    });
  });

  describe('formatIntentLabel & formatStanceLabel', () => {
    it('localizes citation intents and stances in VI and EN', () => {
      expect(formatIntentLabel('methodology', 'vi')).toBe('Phương pháp');
      expect(formatIntentLabel('methodology', 'en')).toBe('Methodology');
      expect(formatIntentLabel('background', 'vi')).toBe('Cơ sở lý thuyết');
      expect(formatIntentLabel('background', 'en')).toBe('Background');
      expect(formatIntentLabel('result_comparison', 'vi')).toBe('So sánh kết quả');
      expect(formatIntentLabel('result_comparison', 'en')).toBe('Result Comparison');

      expect(formatStanceLabel('supported', 'vi')).toBe('Được nguồn ủng hộ');
      expect(formatStanceLabel('supported', 'en')).toBe('Supported');
      expect(formatStanceLabel('partially_supported', 'vi')).toBe('Ủng hộ một phần');
      expect(formatStanceLabel('partially_supported', 'en')).toBe('Partially Supported');
      expect(formatStanceLabel('neutral', 'vi')).toBe('Trung lập');
      expect(formatStanceLabel('neutral', 'en')).toBe('Neutral');
      expect(formatStanceLabel('contradiction_risk', 'vi')).toBe('Nguy cơ mâu thuẫn');
      expect(formatStanceLabel('contradiction_risk', 'en')).toBe('Contradiction Risk');
    });
  });

  describe('formatUserError', () => {
    it('strips API 4xx/5xx prefixes, unwraps FastAPI JSON detail, and translates common errors cleanly', () => {
      expect(
        formatUserError(new Error('API 401: {"detail":"Invalid username or password"}'), 'vi'),
      ).toBe('Tên đăng nhập/email hoặc mật khẩu chưa đúng. Vui lòng kiểm tra lại.');
      expect(
        formatUserError(new Error('API 401: {"detail":"Invalid username or password"}'), 'en'),
      ).toBe('Incorrect username/email or password. Please try again.');

      expect(formatUserError('API 400: {"detail":"Invalid activation token"}', 'vi')).toBe(
        'Liên kết kích hoạt không hợp lệ hoặc đã hết hạn.',
      );
      expect(formatUserError('API 400: Invalid password reset link', 'vi')).toBe(
        'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.',
      );
      expect(formatUserError('API 404: Share link not found', 'vi')).toBe(
        'Liên kết chia sẻ không hợp lệ hoặc đã hết hạn.',
      );
      expect(formatUserError('API 400: Invalid share token format', 'en')).toBe(
        'This share link is invalid or has expired.',
      );
      expect(formatUserError('API 404: Invalid class join code', 'vi')).toBe(
        'Mã tham gia lớp không đúng. Vui lòng kiểm tra lại với giảng viên.',
      );
      expect(
        formatUserError('API 404: {"detail":"Promo code \'SAVE50\' was not found"}', 'vi'),
      ).toBe('Mã giảm giá không tồn tại hoặc đã hết hạn.');
      expect(
        formatUserError('API 404: {"detail":"Promo code \'SAVE50\' was not found"}', 'en'),
      ).toBe('Promo code not found or expired.');
      expect(
        formatUserError(
          'API 429: Please wait 30 seconds before requesting another password setup email',
          'vi',
        ),
      ).toBe('Bạn vừa gửi yêu cầu. Vui lòng đợi 30 giây rồi thử lại.');
      expect(formatUserError('API 404: Checkout session not found', 'vi')).toBe(
        'Không tìm thấy phiên thanh toán. Vui lòng bắt đầu lại từ trang Bảng giá.',
      );
      expect(formatUserError('API 404: Essay not found', 'vi')).toBe(
        'Không tìm thấy báo cáo này. Tài liệu có thể đã bị xóa hoặc đường dẫn không đúng.',
      );
      expect(formatUserError('API 404: Essay not found', 'en')).toBe(
        'Report not found. This document may have been deleted or the link is no longer valid.',
      );
      expect(formatUserError('API 403: Not your class', 'vi')).toBe(
        'Bạn không có quyền truy cập nội dung này.',
      );
      expect(formatUserError('API 403: Access denied', 'en')).toBe(
        'You do not have permission to access this content.',
      );
      expect(formatUserError(new TypeError('Failed to fetch'), 'vi')).toBe(
        'Không thể kết nối máy chủ. Vui lòng kiểm tra mạng và thử lại.',
      );
      expect(formatUserError(new TypeError('NetworkError when attempting to fetch'), 'en')).toBe(
        'Unable to reach the server. Please check your connection and try again.',
      );
    });

    it('never leaks raw JSON objects and falls back gracefully on unknown errors', () => {
      expect(formatUserError('API 500: {"foo":"bar"}', 'vi', 'Lỗi tùy chỉnh')).toBe(
        'Lỗi tùy chỉnh',
      );
      expect(formatUserError(null, 'en')).toBe('Something went wrong. Please try again.');
    });
  });

  describe('getScannedPdfNotice', () => {
    it('returns clear VI and EN notices with and without page counts', () => {
      const viWithCounts = getScannedPdfNotice('vi', 12, 12);
      expect(viWithCounts.badgeLabel).toBe('PDF dạng ảnh quét');
      expect(viWithCounts.title).toContain('PDF dạng ảnh quét');
      expect(viWithCounts.description).toContain('12/12');

      const enWithCounts = getScannedPdfNotice('en', 8, 10);
      expect(enWithCounts.badgeLabel).toBe('Scanned Image PDF');
      expect(enWithCounts.description).toContain('8 of 10');

      expect(getScannedPdfNotice('vi').description.length).toBeGreaterThan(20);
      expect(getScannedPdfNotice('en').description.length).toBeGreaterThan(20);
    });
  });

  describe('DecisionSupportBanner', () => {
    it('renders warm non-accusatory academic copy in compact and card variants across VI and EN', async () => {
      await i18n.changeLanguage('vi');
      const { rerender } = render(createElement(DecisionSupportBanner, { variant: 'card' }));
      expect(screen.getByTestId('decision-support-banner').textContent).toContain(
        'Công cụ hỗ trợ rà soát học thuật',
      );
      expect(screen.getByTestId('decision-support-banner').textContent).toContain(
        'Không tìm thấy nguồn',
      );

      rerender(createElement(DecisionSupportBanner, { variant: 'compact', lang: 'en' }));
      expect(screen.getByTestId('decision-support-banner').textContent).toContain(
        'Academic Decision-Support Notice',
      );
      expect(screen.getByTestId('decision-support-banner').textContent).toContain(
        'Final judgment always rests with instructors and reviewers',
      );
    });
  });

  describe('formatCitationStyleLabel', () => {
    it('localizes APA-LIKE, IEEE-LIKE, MIXED, and suppresses UNKNOWN', () => {
      expect(formatCitationStyleLabel('APA-LIKE', 'vi')).toBe('Gần chuẩn APA');
      expect(formatCitationStyleLabel('APA_LIKE', 'en')).toBe('APA-like');
      expect(formatCitationStyleLabel('IEEE-LIKE', 'vi')).toBe('Gần chuẩn IEEE');
      expect(formatCitationStyleLabel('IEEE_LIKE', 'en')).toBe('IEEE-like');
      expect(formatCitationStyleLabel('MIXED', 'vi')).toBe('Hỗn hợp');
      expect(formatCitationStyleLabel('MIXED', 'en')).toBe('Mixed');
      expect(formatCitationStyleLabel('UNKNOWN', 'vi')).toBe('');
      expect(formatCitationStyleLabel(null, 'en')).toBe('');
    });
  });

  describe('formatAcademicAuthorShort & institutional Vietnamese/global authors', () => {
    it('recognizes and preserves Vietnamese and global institutional authors without splitting, inverting, or adding et al.', () => {
      expect(isInstitutionalAuthor('Ban Chấp hành Trung ương')).toBe(true);
      expect(isInstitutionalAuthor('Đảng Cộng sản Việt Nam')).toBe(true);
      expect(isInstitutionalAuthor('Quốc hội')).toBe(true);
      expect(isInstitutionalAuthor('Thủ tướng Chính phủ')).toBe(true);
      expect(isInstitutionalAuthor('Bộ Giáo dục và Đào tạo')).toBe(true);
      expect(isInstitutionalAuthor('Viện Khoa học Xã hội Việt Nam')).toBe(true);
      expect(isInstitutionalAuthor('World Health Organization')).toBe(true);
      expect(isInstitutionalAuthor('WHO')).toBe(true);
      expect(isInstitutionalAuthor('UNESCO')).toBe(true);

      expect(formatAcademicAuthorShort(['Ban Chấp hành Trung ương'], null, 'vi')).toBe(
        'Ban Chấp hành Trung ương',
      );
      expect(formatAcademicAuthorShort(['Đảng Cộng sản Việt Nam'], null, 'vi')).toBe(
        'Đảng Cộng sản Việt Nam',
      );
      expect(formatAcademicAuthorShort(['Quốc hội'], null, 'vi')).toBe('Quốc hội');
      expect(formatAcademicAuthorShort(['Thủ tướng Chính phủ'], null, 'vi')).toBe(
        'Thủ tướng Chính phủ',
      );
      expect(formatAcademicAuthorShort(['Bộ Giáo dục và Đào tạo'], null, 'vi')).toBe(
        'Bộ Giáo dục và Đào tạo',
      );
      expect(formatAcademicAuthorShort(['World Bank'], null, 'en')).toBe('World Bank');

      // Ensure institutional names with "và" or commas are NOT broken by splitRawAuthorString
      expect(splitRawAuthorString('Bộ Giáo dục và Đào tạo')).toEqual([
        'Bộ Giáo dục và Đào tạo',
      ]);
      expect(splitRawAuthorString('Bộ Văn hóa, Thể thao và Du lịch')).toEqual([
        'Bộ Văn hóa, Thể thao và Du lịch',
      ]);
    });

    it('falls back cleanly to truncated title instead of bare numeric garbage like "4"', () => {
      expect(
        formatAcademicAuthorShort(
          ['4'],
          '[4] Nghị quyết số 57-NQ/TW về phát triển khoa học công nghệ',
          'vi',
        ),
      ).toMatch(/^Nghị quyết số 57-NQ\/TW/);
      expect(formatAcademicAuthorShort(['4'], null, 'vi')).toBe('Tài liệu tham khảo');
      expect(formatAcademicAuthorShort([], '4. Luật Dữ liệu năm 2024', 'vi')).toBe(
        'Luật Dữ liệu năm 2024',
      );
    });

    it('formats Western and Vietnamese personal authors cleanly', () => {
      expect(formatAcademicAuthorShort(['N. Reimers', 'I. Gurevych'], null, 'en')).toBe(
        'Reimers & Gurevych',
      );
      expect(
        formatAcademicAuthorShort(['De Choudhury, M.', 'Gamon, M.', 'Counts, S.'], null, 'en'),
      ).toBe('De Choudhury et al.');
      expect(formatAcademicAuthorShort(['Nguyễn Văn An'], null, 'vi')).toBe('Nguyễn Văn An');
    });
  });

  describe('sanitizeReasoningForDisplay', () => {
    it('strips raw [Neural: ...] debug logs and translates common English diagnostics into natural non-accusatory VI/EN', () => {
      const rawDoi =
        'DOI 10.1234/fake.2025 matches known fabricated DOI pattern [Neural: content alignment score=0.52, intent=background, stance=neutral, evidence_sim=0.44]';
      const viDoi = sanitizeReasoningForDisplay(rawDoi, 'vi');
      expect(viDoi).not.toContain('[Neural:');
      expect(viDoi).not.toMatch(/fabricated|matches known/i);
      expect(viDoi).toContain('10.1234/fake.2025');
      expect(viDoi).toContain('tiền tố thử nghiệm/không hợp lệ');

      const enDoi = sanitizeReasoningForDisplay(rawDoi, 'en');
      expect(enDoi).not.toContain('[Neural:');
      expect(enDoi).not.toMatch(/\bfabricated\b/i);
      expect(enDoi).toContain('invalid/unregistered test prefix');

      const rawDomain =
        "URL domain 'fake-journal.example.com' is a placeholder/fake domain [Neural: score=0.10]";
      expect(sanitizeReasoningForDisplay(rawDomain, 'vi')).toBe(
        "Tên miền URL 'fake-journal.example.com' là tên miền mẫu hoặc không tồn tại thực tế.",
      );
      expect(sanitizeReasoningForDisplay(rawDomain, 'en')).toBe(
        "URL domain 'fake-journal.example.com' is a placeholder or non-existent domain.",
      );

      expect(
        sanitizeReasoningForDisplay('Year mismatch (2021 vs 2017) and Title mismatch', 'vi'),
      ).toContain('Sai lệch năm xuất bản (2021 so với 2017)');
      expect(
        sanitizeReasoningForDisplay('điểm căn chỉnh ngữ cảnh Neural = 0.52 [trung bình]', 'vi'),
      ).toBe('mức độ liên quan ngữ cảnh: 52%');
      expect(
        sanitizeReasoningForDisplay('Kiểm tra liên kết thành công (HTTP 200 OK).', 'vi'),
      ).toBe('Kiểm tra liên kết thành công (liên kết hoạt động).');
      expect(
        sanitizeReasoningForDisplay('Link check succeeded (HTTP 200 OK).', 'en'),
      ).toBe('Link check succeeded (link active).');
    });
  });
});
