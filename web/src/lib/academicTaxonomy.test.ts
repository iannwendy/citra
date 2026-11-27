import { createElement } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import {
  normalizeVerdictKey,
  getVerdictDisplay,
  normalizeMappingStatusKey,
  getMappingStatusDisplay,
  getCisBand,
  formatCisScore,
  getSourceDisplayName,
  formatLocalizedDate,
  formatLocalizedDateTime,
  formatIntentLabel,
  formatStanceLabel,
  formatUserError,
  getScannedPdfNotice,
  formatCitationStyleLabel,
  isInstitutionalAuthor,
  looksLikeTitleSentence,
  normalizeAcademicAuthorDisplay,
  resolveDisplayAuthors,
  splitRawAuthorString,
  formatAcademicAuthorShort,
  sanitizeReasoningForDisplay,
} from './academicTaxonomy';
import { validatePasswordClient } from './utils';
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

  describe('getCisBand & formatCisScore', () => {
    it('returns unified 4-tier CIS bands matching HelpModal thresholds (85+, 70–84, 50–69, <50) in VI and EN', () => {
      const exVi = getCisBand(92, 'vi');
      expect(exVi.key).toBe('excellent');
      expect(exVi.label).toBe('Xuất sắc');
      expect(exVi.badgeClass).toContain('emerald');
      expect(exVi.dotClass).toContain('emerald');
      expect(getCisBand(85, 'en').key).toBe('excellent');
      expect(getCisBand(85, 'en').label).toBe('Excellent');

      const goodVi = getCisBand(84.9, 'vi');
      expect(goodVi.key).toBe('good');
      expect(goodVi.label).toBe('Khá tốt');
      expect(goodVi.textClass).toContain('indigo');
      expect(getCisBand(70, 'en').key).toBe('good');
      expect(getCisBand(70, 'en').label).toBe('Good');

      const revVi = getCisBand(69.9, 'vi');
      expect(revVi.key).toBe('review');
      expect(revVi.label).toBe('Cần rà soát');
      expect(revVi.textClass).toContain('amber');
      expect(getCisBand(50, 'en').key).toBe('review');
      expect(getCisBand(50, 'en').label).toBe('Needs Review');

      const critVi = getCisBand(49.9, 'vi');
      expect(critVi.key).toBe('critical');
      expect(critVi.label).toBe('Cần kiểm tra kỹ');
      expect(critVi.badgeClass).toContain('rose');
      expect(getCisBand(0, 'en').key).toBe('critical');
      expect(getCisBand(0, 'en').label).toBe('Needs Careful Review');
      expect(getCisBand(Number.NaN, 'en').key).toBe('critical');
    });

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

  describe('getSourceDisplayName', () => {
    it('maps internal source keys to clean VI & EN human names with zero SQLite/ACL/CSL-JSON/REST API leaks', () => {
      for (const localKey of ['local_db', 'local_acl', 'local_papers', 'known_papers']) {
        expect(getSourceDisplayName(localKey, 'vi')).toBe('Thư viện học thuật CITRA');
        expect(getSourceDisplayName(localKey, 'en')).toBe('CITRA Scholarly Library');
      }
      expect(getSourceDisplayName('crossref', 'en')).toBe('Crossref');
      expect(getSourceDisplayName('openalex', 'en')).toBe('OpenAlex');
      expect(getSourceDisplayName('doi_ra', 'vi')).toBe('Hệ thống đăng ký DOI quốc tế');
      expect(getSourceDisplayName('doi', 'en')).toBe('Global DOI Registry');
      expect(getSourceDisplayName('ncbi', 'en')).toBe('PubMed / bioRxiv');
      expect(getSourceDisplayName('entrez', 'vi')).toBe('PubMed / bioRxiv');
      expect(getSourceDisplayName('wayback', 'vi')).toBe('Kho lưu trữ web (Wayback)');
      expect(getSourceDisplayName('wayback_html_meta', 'en')).toBe('Web Archive (Wayback)');
      expect(getSourceDisplayName('web_html_meta', 'vi')).toBe('Trang web gốc');
      expect(getSourceDisplayName('web_html_meta', 'en')).toBe('Source Web Page');

      // Defensive normalization of legacy developer labels
      expect(getSourceDisplayName('Crossref REST API', 'en')).toBe('Crossref');
      expect(getSourceDisplayName('OpenAlex Scholarly Graph', 'en')).toBe('OpenAlex');
      expect(getSourceDisplayName('Local ACL (SQLite FTS5)', 'vi')).toBe(
        'Thư viện học thuật CITRA',
      );
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

    it('translates backend HTTPException leaks (share token, auth codes, corrupt uploads, byte limits, DB/job recovery, admin & billing) cleanly in VI & EN', () => {
      // Fixed share token regex bug
      expect(formatUserError('API 400: Share token has expired', 'vi')).toBe(
        'Liên kết chia sẻ không hợp lệ hoặc đã hết hạn.',
      );
      expect(formatUserError('API 400: Invalid share token structure', 'en')).toBe(
        'This share link is invalid or has expired.',
      );
      expect(formatUserError('Invalid or tampered share token signature', 'vi')).toBe(
        'Liên kết chia sẻ không hợp lệ hoặc đã hết hạn.',
      );

      // Machine error codes
      expect(
        formatUserError('API 403: {"detail":"ACCOUNT_NOT_ACTIVATED: Account is not activated"}', 'vi'),
      ).toBe('Tài khoản chưa được kích hoạt. Vui lòng kiểm tra email để xác nhận.');
      expect(formatUserError('ACCOUNT_NOT_ACTIVATED: Please activate', 'en')).toBe(
        "Your account isn't activated yet. Please check your email for the activation link.",
      );
      expect(formatUserError('API 403: API_KEY_REQUIRES_PRO: Pro required', 'vi')).toBe(
        'Tính năng tạo khóa API dành cho gói Pro trở lên.',
      );
      expect(formatUserError('API_KEY_REQUIRES_PRO: upgrade', 'en')).toBe(
        'API keys are available on Pro plans and above.',
      );
      expect(formatUserError('PRIVACY_CONSENT_REQUIRED: consent missing', 'vi')).toBe(
        'Vui lòng xác nhận đồng ý Chính sách bảo mật trước khi tiếp tục.',
      );
      expect(formatUserError('PRIVACY_CONSENT_REQUIRED: consent missing', 'en')).toBe(
        'Please confirm the Privacy Policy before continuing.',
      );

      // Corrupt / invalid file uploads
      expect(formatUserError('API 400: Invalid PDF file: missing %PDF- header', 'vi')).toBe(
        'Tệp không đúng định dạng chuẩn hoặc bị lỗi. Vui lòng lưu lại tệp PDF/Word và thử tải lên lại.',
      );
      expect(
        formatUserError('Invalid DOCX file: missing OOXML PK archive header', 'en'),
      ).toBe(
        "This file appears damaged or isn't a valid document format. Please re-save it and try again.",
      );
      expect(formatUserError('Invalid RIS file: missing TY - record header', 'vi')).toContain(
        'Tệp không đúng định dạng chuẩn',
      );

      // Password UTF-8 byte & avatar limits (and client validator parity)
      expect(formatUserError('Password cannot exceed 72 UTF-8 bytes.', 'vi')).toBe(
        'Mật khẩu hơi dài (tối đa khoảng 50 ký tự nếu có dấu tiếng Việt). Vui lòng chọn mật khẩu ngắn hơn.',
      );
      expect(formatUserError('Password cannot exceed 72 UTF-8 bytes.', 'en')).toBe(
        'Password is too long. Please use a shorter password (under 64 characters).',
      );
      const pwVi = validatePasswordClient('ễ'.repeat(30), 'vi');
      expect(pwVi.valid).toBe(false);
      expect(pwVi.error).not.toMatch(/72\s*byte/i);
      const pwEn = validatePasswordClient('ễ'.repeat(30), 'en');
      expect(pwEn.valid).toBe(false);
      expect(pwEn.error).not.toMatch(/72\s*utf-?8/i);

      expect(
        formatUserError('Avatar file too large. Max size is 2097152 bytes (2MB)', 'vi'),
      ).toBe('Ảnh đại diện vượt quá 2 MB. Vui lòng chọn ảnh nhẹ hơn.');
      expect(
        formatUserError('Avatar file too large. Max size is 2097152 bytes (2MB)', 'en'),
      ).toBe('Profile photo exceeds the 2 MB limit. Please choose a smaller image.');

      // Transient DB / orphaned job / duplicates / admin / billing
      expect(formatUserError('API 503: Transient database disk I/O error', 'vi')).toBe(
        'Hệ thống đang bận lưu dữ liệu. Vui lòng thử lại sau vài giây.',
      );
      expect(formatUserError('SQLite: database is locked', 'en')).toBe(
        'The system is briefly busy. Please try again in a few seconds.',
      );
      expect(
        formatUserError('Orphaned analysis job failed after exceeding recovery attempts', 'vi'),
      ).toBe('Phiên kiểm tra trước bị gián đoạn. Vui lòng bấm kiểm tra lại bài viết.');
      expect(formatUserError('Orphaned analysis job failed', 'en')).toBe(
        'The previous check was interrupted. Please run the check again.',
      );
      expect(formatUserError('API 409: Username already exists', 'vi')).toBe(
        'Tên đăng nhập này đã có người sử dụng.',
      );
      expect(formatUserError('API 409: Email already exists', 'en')).toBe(
        'This email is already registered.',
      );
      expect(formatUserError('Cannot demote the last active admin', 'vi')).toBe(
        'Không thể hạ quyền hoặc khóa quản trị viên hoạt động cuối cùng.',
      );
      expect(formatUserError('Cannot deactivate the last active admin', 'en')).toBe(
        'You cannot demote or deactivate the last active administrator.',
      );
      expect(formatUserError("Promo code 'PRO20' already exists", 'vi')).toBe(
        'Mã khuyến mãi này đã tồn tại.',
      );
      expect(formatUserError("Promo code 'PRO20' already exists", 'en')).toBe(
        'This promo code already exists.',
      );
      expect(formatUserError('Transaction for vnp_TxnRef not found', 'vi')).toBe(
        'Giao dịch thanh toán chưa hoàn tất. Vui lòng thử lại.',
      );
      expect(formatUserError('PCI-DSS violation: Only last 4 digits allowed', 'en')).toBe(
        'Payment could not be completed. Please try again.',
      );
      expect(formatUserError('HTTP 400: UNKNOWN_CODE: Plain fallback text', 'en')).toBe(
        'Plain fallback text',
      );
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

    it('Round 3 [P2-R2-2/3]: collapses split/polluted/inverted Vietnamese institutional authors, capitalizes lowercase authors, and rejects title sentences', () => {
      // Split single-word institutional tokens
      expect(
        formatAcademicAuthorShort(['Ban', 'Chấp', 'hành', 'Trung', 'ương'], null, 'vi'),
      ).toBe('Ban Chấp hành Trung ương');
      expect(formatAcademicAuthorShort(['Chính', 'phủ'], null, 'vi')).toBe('Chính phủ');
      expect(formatAcademicAuthorShort(['Quốc', 'hội'], null, 'vi')).toBe('Quốc hội');

      // Institutional authors polluted with legal statute noise (R44 & R25 real DB shapes)
      expect(
        formatAcademicAuthorShort(
          ['Ban Chấp Hành Trung Ương', 'Bộ Chính Trị', 'Nghị Quyết Số 57-nq/tư', 'Nghị Quyết 57-nq/tư'],
          null,
          'vi',
        ),
      ).toBe('Ban Chấp hành Trung ương');
      expect(
        formatAcademicAuthorShort(
          ['Thủ Tướng Chính Phủ', 'Quyết Định Số 569/qđ-ttg', 'Quyết Định 569/qđ-ttg'],
          null,
          'vi',
        ),
      ).toBe('Thủ tướng Chính phủ');
      expect(
        formatAcademicAuthorShort(
          ['chính phủ', 'nghị định số 13/2023/nđ-cp', 'nghị định 13/2023/nđ-cp'],
          null,
          'vi',
        ),
      ).toBe('Chính phủ');
      expect(
        formatAcademicAuthorShort(['quốc hội', 'luật sở hữu trí tuệ'], null, 'vi'),
      ).toBe('Quốc hội');
      expect(
        formatAcademicAuthorShort(['quốc hội', 'bộ luật dân sự'], null, 'vi'),
      ).toBe('Quốc hội');
      expect(isInstitutionalAuthor('bộ luật dân sự')).toBe(false);

      // Inverted institutional DB record ("Nam Đ. C. V.") recovered from raw text
      expect(
        resolveDisplayAuthors(
          ['Nam Đ. C. V.'],
          '2. Đảng Cộng sản Việt Nam (2021). Văn kiện Đại hội đại biểu toàn quốc lần thứ XIII.',
        ),
      ).toEqual(['Đảng Cộng sản Việt Nam']);

      // Lowercase Western author names capitalized properly
      expect(
        formatAcademicAuthorShort(
          ['vaswani A.', 'shazeer N.', 'parmar N.'],
          null,
          'en',
        ),
      ).toBe('Vaswani et al.');
      expect(
        formatAcademicAuthorShort(
          ['devlin J.', 'chang M. W.', 'lee K.', 'toutanova K.'],
          null,
          'en',
        ),
      ).toBe('Devlin et al.');
      expect(normalizeAcademicAuthorDisplay('vaswani A.')).toBe('Vaswani A.');

      // Title sentence never surname-split into "mới et al."
      const r44Ref4Title =
        'Nghiên cứu đề xuất đổi mới và hoàn thiện thể chế phát triển khoa học - công nghệ và đổi mới sáng tạo ở Việt Nam giai đoạn 2021 - 2030';
      expect(looksLikeTitleSentence(r44Ref4Title)).toBe(true);
      const formattedRef4 = formatAcademicAuthorShort([r44Ref4Title], r44Ref4Title, 'vi');
      expect(formattedRef4).toBe('Nghiên cứu đề xuất đổi mới…');
      expect(formattedRef4).not.toContain('et al.');
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

      // Round 3 [P3-R2-1]: Full fake-domain sentence including scholarly registry tail translated 100% into VI
      const rawDomainFull =
        "URL domain 'example.com' is a placeholder/fake domain (example.com, test.com, localhost, etc.) and does not belong to a scholarly registry.";
      const viDomainFull = sanitizeReasoningForDisplay(rawDomainFull, 'vi');
      expect(viDomainFull).toBe(
        "Tên miền URL 'example.com' là tên miền mẫu hoặc không tồn tại thực tế (như example.com, test.com, localhost...) và không thuộc cơ sở dữ liệu học thuật.",
      );
      expect(viDomainFull).not.toContain('does not belong');
      expect(viDomainFull).not.toContain('scholarly registry');

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
