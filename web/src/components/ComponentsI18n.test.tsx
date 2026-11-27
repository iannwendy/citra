import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Routes, Route, useLocation } from 'react-router-dom';
import i18n from '@/i18n';
import { renderWithProviders, makeUser, screen, fireEvent } from '@/test-utils';
import { makeVerdict } from '@/test-fixtures';
import { getPlainMappingLabel, getPlainVerdictLabel } from '@/lib/verdictExplanation';
import {
  VerdictBadge,
  VerdictBadgeCompact,
  VerdictIcon,
  getVerdictColor,
  getVerdictUnderlineClass,
} from './VerdictBadge';
import { MappingStatusBadge, MappingStatusBadgeCompact } from './MappingStatusBadge';
import { UpgradeModal } from './UpgradeModal';
import { RoleBadge } from './RoleBadge';
import { OverrideControls } from './OverrideControls';
import { UserFormDialog } from './UserFormDialog';
import { DeleteUserDialog } from './DeleteUserDialog';
import { CitationGraphView } from './CitationGraph/CitationGraphView';
import { buildEvidenceGraph } from './CitationGraph/EvidenceGraph';
import { ProtectedRoute } from './ProtectedRoute';
import { HelpModal } from './HelpModal';
import { EssaySortSelect } from './EssaySortSelect';
import { AppLayout } from './AppLayout';

describe('Task 5.6 — Localized components in EN and VI', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  it('localizes MappingStatusBadge and RoleBadge in EN and VI', async () => {
    await i18n.changeLanguage('en');
    const { unmount } = renderWithProviders(
      <div>
        <MappingStatusBadge status="matched" />
        <MappingStatusBadge status="missing_reference" />
        <RoleBadge role="user" />
        <RoleBadge role="teacher" />
      </div>,
    );
    expect(screen.getByText('Linked')).toBeDefined();
    expect(screen.getByText('No Reference')).toBeDefined();
    expect(screen.getByText('Student')).toBeDefined();
    expect(screen.getByText('Teacher')).toBeDefined();
    unmount();

    await i18n.changeLanguage('vi');
    renderWithProviders(
      <div>
        <MappingStatusBadge status="matched" />
        <MappingStatusBadge status="missing_reference" />
        <RoleBadge role="user" />
        <RoleBadge role="teacher" />
      </div>,
    );
    expect(screen.getByText('Đã liên kết')).toBeDefined();
    expect(screen.getByText('Thiếu nguồn')).toBeDefined();
    expect(screen.getByText('Sinh viên')).toBeDefined();
    expect(screen.getByText('Giảng viên')).toBeDefined();
  });

  it('localizes OverrideControls modal options in VI', async () => {
    await i18n.changeLanguage('vi');
    const verdict = makeVerdict({ citation_id: 'v1', label: 'metadata_error', mapping_status: 'matched' });
    renderWithProviders(
      <OverrideControls verdict={verdict} onOverride={vi.fn().mockResolvedValue(undefined)} />,
      { user: makeUser('admin') },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cập nhật kết quả kiểm tra' }));
    expect(screen.getByText('✓ Đã xác minh')).toBeDefined();
    expect(screen.getByText('△ Sai lệch thông tin')).toBeDefined();
    fireEvent.click(screen.getByTestId('override-mapping-toggle'));
    expect(screen.getAllByText('Khớp trong bài & danh mục').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Thiếu trong danh mục')).toBeDefined();
  });

  it('localizes UserFormDialog and DeleteUserDialog in VI', async () => {
    await i18n.changeLanguage('vi');
    const targetUser = {
      ...makeUser('user'),
      id: 99,
      username: 'sv_test',
      is_active: true,
    };
    renderWithProviders(
      <>
        <UserFormDialog open={true} onOpenChange={vi.fn()} onSuccess={vi.fn()} />
        <DeleteUserDialog
          open={true}
          onOpenChange={vi.fn()}
          user={targetUser}
          currentUserId={1}
          onSuccess={vi.fn()}
        />
      </>,
      { user: makeUser('admin') },
    );
    expect(screen.getByText('Tạo người dùng mới')).toBeDefined();
    expect(screen.getByText('Tên đăng nhập *')).toBeDefined();
    expect(screen.getByText('Mật khẩu *')).toBeDefined();
    expect(screen.getAllByText('Xóa người dùng').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Hành động này không thể hoàn tác/)).toBeDefined();
  });

  it('localizes CitationGraphView and buildEvidenceGraph in EN and VI', async () => {
    const verdict = makeVerdict({
      citation_id: 'v1',
      citation_raw: 'Vaswani et al. (2017). Attention Is All You Need.',
      label: 'verified',
      mapping_status: 'matched',
      triggered_rules: ['R-DOI-EXACT'],
    });

    await i18n.changeLanguage('en');
    const enGraph = buildEvidenceGraph(verdict, 'en');
    expect(enGraph.graph.children?.[0]?.label).toBe('Academic Libraries');
    expect(enGraph.graph.children?.[1]?.label).toBe('Content Comparison');

    const { unmount } = renderWithProviders(
      <CitationGraphView verdicts={[verdict]} onSelect={vi.fn()} />,
    );
    expect(screen.getByText(/Citation & Source Verification Network/)).toBeDefined();
    expect(screen.getByText('All Layers')).toBeDefined();
    unmount();

    await i18n.changeLanguage('vi');
    const viGraph = buildEvidenceGraph(verdict, 'vi');
    expect(viGraph.graph.children?.[0]?.label).toBe('Thư viện học thuật');
    expect(viGraph.graph.children?.[1]?.label).toBe('So sánh nội dung');

    renderWithProviders(
      <CitationGraphView verdicts={[verdict]} onSelect={vi.fn()} />,
    );
    expect(screen.getByText(/Mạng lưới đối chiếu trích dẫn & nguồn gốc/)).toBeDefined();
    expect(screen.getByText('Tất cả tầng')).toBeDefined();
  });
});

describe('Task 2.3 — Non-Tech Verdict Clarity, Mapping Case-Insensitivity & UpgradeModal Copy', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  it('VerdictBadge, VerdictBadgeCompact, and VerdictIcon render localized labels & actionable tooltips in EN and VI with WCAG AA contrast and whitespace-nowrap', async () => {
    const verdictPairs = [
      ['VERIFIED', 'verified'],
      ['METADATA_ERROR', 'metadata_error'],
      ['SUSPECTED_HALLUCINATION', 'suspected_hallucination'],
      ['UNRESOLVED', 'unresolved'],
      ['RESOURCE', 'resource'],
    ] as const;

    await i18n.changeLanguage('en');
    const { container: enContainer, unmount: unmountEn } = renderWithProviders(
      <div>
        {verdictPairs.flatMap(([upper, lower]) => [
          <div key={`full-${upper}`} data-testid={`vb-${upper}`}>
            <VerdictBadge verdict={upper} />
          </div>,
          <div key={`full-${lower}`} data-testid={`vb-${lower}`}>
            <VerdictBadge verdict={lower} />
          </div>,
          <div key={`compact-${lower}`} data-testid={`vbc-${lower}`}>
            <VerdictBadgeCompact verdict={lower} />
          </div>,
          <div key={`icon-${lower}`} data-testid={`vbi-${lower}`}>
            <VerdictIcon verdict={lower} />
          </div>,
        ])}
      </div>,
    );

    expect(enContainer.textContent).not.toContain('SUSPECTED_HALLUCINATION');
    expect(enContainer.textContent).not.toContain('METADATA_ERROR');
    expect(enContainer.innerHTML).not.toContain('text-emerald-600');
    expect(enContainer.innerHTML).not.toContain('text-amber-600');
    expect(enContainer.innerHTML).not.toContain('text-red-600');
    expect(enContainer.innerHTML).toContain('text-emerald-700');
    expect(enContainer.innerHTML).toContain('text-amber-800');
    expect(enContainer.innerHTML).toContain('text-red-700');

    for (const [upper, lower] of verdictPairs) {
      const plainEn = getPlainVerdictLabel(upper, 'en');
      const upperBadge = screen.getByTestId(`vb-${upper}`).firstElementChild as HTMLElement;
      const lowerBadge = screen.getByTestId(`vb-${lower}`).firstElementChild as HTMLElement;
      const compactBadge = screen.getByTestId(`vbc-${lower}`).firstElementChild as HTMLElement;
      const iconBadge = screen.getByTestId(`vbi-${lower}`).firstElementChild as HTMLElement;

      expect(upperBadge.className).toContain('whitespace-nowrap');
      expect(lowerBadge.className).toContain('whitespace-nowrap');
      expect(upperBadge.getAttribute('title')).toContain(plainEn.actionHint);
      expect(lowerBadge.getAttribute('title')).toContain(plainEn.actionHint);
      expect(compactBadge.getAttribute('title')).toContain(plainEn.actionHint);
      expect(iconBadge.getAttribute('title')).toContain(plainEn.actionHint);
    }
    unmountEn();

    await i18n.changeLanguage('vi');
    const { container: viContainer } = renderWithProviders(
      <div>
        {verdictPairs.flatMap(([upper, lower]) => [
          <div key={`vi-full-${upper}`} data-testid={`vi-vb-${upper}`}>
            <VerdictBadge verdict={upper} />
          </div>,
          <div key={`vi-full-${lower}`} data-testid={`vi-vb-${lower}`}>
            <VerdictBadge verdict={lower} />
          </div>,
          <div key={`vi-compact-${lower}`} data-testid={`vi-vbc-${lower}`}>
            <VerdictBadgeCompact verdict={lower} />
          </div>,
          <div key={`vi-icon-${lower}`} data-testid={`vi-vbi-${lower}`}>
            <VerdictIcon verdict={lower} />
          </div>,
        ])}
      </div>,
    );

    expect(viContainer.textContent).not.toContain('SUSPECTED_HALLUCINATION');
    expect(viContainer.textContent).not.toContain('METADATA_ERROR');
    expect(viContainer.innerHTML).not.toContain('Potentially hallucinated source detected');
    expect(viContainer.innerHTML).not.toContain('Source verified');
    expect(viContainer.innerHTML).not.toContain('Suspected hallucination');

    for (const [upper, lower] of verdictPairs) {
      const plainVi = getPlainVerdictLabel(upper, 'vi');
      const upperBadge = screen.getByTestId(`vi-vb-${upper}`).firstElementChild as HTMLElement;
      const lowerBadge = screen.getByTestId(`vi-vb-${lower}`).firstElementChild as HTMLElement;
      const compactBadge = screen.getByTestId(`vi-vbc-${lower}`).firstElementChild as HTMLElement;
      const iconBadge = screen.getByTestId(`vi-vbi-${lower}`).firstElementChild as HTMLElement;

      expect(upperBadge.className).toContain('whitespace-nowrap');
      expect(upperBadge.getAttribute('title')).toContain(plainVi.actionHint);
      expect(lowerBadge.getAttribute('title')).toContain(plainVi.actionHint);
      expect(compactBadge.getAttribute('title')).toContain(plainVi.actionHint);
      expect(iconBadge.getAttribute('title')).toContain(plainVi.actionHint);
    }

    // Verify getVerdictColor & getVerdictUnderlineClass resolve dark-mode-paired bgClass accurately
    expect(getVerdictColor('VERIFIED')).toBe('border-emerald-400');
    expect(getVerdictColor('metadata_error')).toBe('border-amber-400');
    expect(getVerdictColor('suspected_hallucination')).toBe('border-red-400');
    expect(getVerdictUnderlineClass('VERIFIED')).toBe('decoration-emerald-500');
    expect(getVerdictUnderlineClass('metadata_error')).toBe('decoration-amber-500');
    expect(getVerdictUnderlineClass('suspected_hallucination')).toBe('decoration-red-500');
  });

  it('MappingStatusBadge and MappingStatusBadgeCompact handle both lowercase and uppercase statuses with localized actionable tooltips and whitespace-nowrap', async () => {
    const statusPairs = [
      { lower: 'matched', upper: 'MATCHED', en: 'Linked', vi: 'Đã liên kết' },
      { lower: 'missing_reference', upper: 'MISSING_REFERENCE', en: 'No Reference', vi: 'Thiếu nguồn' },
      { lower: 'uncited_reference', upper: 'UNCITED_REFERENCE', en: 'Not Cited', vi: 'Chưa trích dẫn' },
      { lower: 'in_text_mismatch', upper: 'IN_TEXT_MISMATCH', en: 'Mismatch', vi: 'Sai lệch' },
      { lower: 'duplicate_reference', upper: 'DUPLICATE_REFERENCE', en: 'Duplicate', vi: 'Trùng lặp' },
      { lower: 'ambiguous_mapping', upper: 'AMBIGUOUS_MAPPING', en: 'Ambiguous', vi: 'Mơ hồ' },
      { lower: 'style_inconsistent', upper: 'STYLE_INCONSISTENT', en: 'Style Issue', vi: 'Sai chuẩn' },
    ] as const;

    expect(getPlainMappingLabel('IN_TEXT_MISMATCH', 'vi').actionHint).toContain('hãy chỉnh lại cho khớp.');

    await i18n.changeLanguage('en');
    const { container: enContainer, unmount: unmountEn } = renderWithProviders(
      <div>
        {statusPairs.map(({ lower, upper }) => (
          <div key={lower}>
            <div data-testid={`mb-low-${lower}`}>
              <MappingStatusBadge status={lower} />
            </div>
            <div data-testid={`mb-up-${upper}`}>
              <MappingStatusBadge status={upper} />
            </div>
            <div data-testid={`mbc-up-${upper}`}>
              <MappingStatusBadgeCompact status={upper} />
            </div>
          </div>
        ))}
      </div>,
    );

    expect(enContainer.textContent).not.toContain('Unresolved');
    expect(enContainer.textContent).not.toContain('IN_TEXT_MISMATCH');
    expect(enContainer.textContent).not.toContain('MISSING_REFERENCE');

    for (const { lower, upper, en } of statusPairs) {
      const plainEn = getPlainMappingLabel(upper, 'en');
      const lowBadge = screen.getByTestId(`mb-low-${lower}`).firstElementChild as HTMLElement;
      const upBadge = screen.getByTestId(`mb-up-${upper}`).firstElementChild as HTMLElement;
      const compactBadge = screen.getByTestId(`mbc-up-${upper}`).firstElementChild as HTMLElement;

      expect(lowBadge.textContent).toBe(en);
      expect(upBadge.textContent).toBe(en);
      expect(lowBadge.className).toContain('whitespace-nowrap');
      expect(upBadge.className).toContain('whitespace-nowrap');
      expect(lowBadge.getAttribute('title')).toContain(plainEn.actionHint);
      expect(upBadge.getAttribute('title')).toContain(plainEn.actionHint);
      expect(compactBadge.getAttribute('title')).toContain(plainEn.actionHint);
    }
    unmountEn();

    await i18n.changeLanguage('vi');
    const { container: viContainer } = renderWithProviders(
      <div>
        {statusPairs.map(({ lower, upper }) => (
          <div key={lower}>
            <div data-testid={`vi-mb-low-${lower}`}>
              <MappingStatusBadge status={lower} />
            </div>
            <div data-testid={`vi-mb-up-${upper}`}>
              <MappingStatusBadge status={upper} />
            </div>
            <div data-testid={`vi-mbc-up-${upper}`}>
              <MappingStatusBadgeCompact status={upper} />
            </div>
          </div>
        ))}
      </div>,
    );

    expect(viContainer.textContent).not.toContain('Chưa xác định');
    expect(viContainer.textContent).not.toContain('Unresolved');

    for (const { lower, upper, vi: viLabel } of statusPairs) {
      const plainVi = getPlainMappingLabel(upper, 'vi');
      const lowBadge = screen.getByTestId(`vi-mb-low-${lower}`).firstElementChild as HTMLElement;
      const upBadge = screen.getByTestId(`vi-mb-up-${upper}`).firstElementChild as HTMLElement;
      const compactBadge = screen.getByTestId(`vi-mbc-up-${upper}`).firstElementChild as HTMLElement;

      expect(lowBadge.textContent).toBe(viLabel);
      expect(upBadge.textContent).toBe(viLabel);
      expect(upBadge.className).toContain('whitespace-nowrap');
      expect(lowBadge.getAttribute('title')).toContain(plainVi.actionHint);
      expect(upBadge.getAttribute('title')).toContain(plainVi.actionHint);
      expect(compactBadge.getAttribute('title')).toContain(plainVi.actionHint);
    }
  });

  it('UpgradeModal renders warm non-tech benefit copy in EN and VI with zero ML/infra jargon, zero Tailwind v4 dead classes, zero feature badge truncation, and Vietnamese VND equivalents', async () => {
    await i18n.changeLanguage('en');
    const { unmount: unmountEn } = renderWithProviders(
      <Routes>
        <Route
          path="/"
          element={
            <UpgradeModal
              open={true}
              onOpenChange={vi.fn()}
              featureName="Interactive Document Inspector & Full Export"
            />
          }
        />
      </Routes>,
      { user: makeUser('user', 'basic') },
    );

    const enModal = screen.getByTestId('upgrade-modal');
    expect(enModal.textContent).not.toContain('ONNX INT8');
    expect(enModal.textContent).not.toContain('MiniLM');
    expect(enModal.textContent).not.toContain('Sentence-BERT');
    expect(enModal.textContent).not.toContain('SerpAPI');
    expect(enModal.innerHTML).not.toContain('shadow-xs');
    expect(enModal.innerHTML).not.toContain('py-0.2');
    expect(enModal.innerHTML).not.toContain('class="truncate"');
    expect(screen.getByTestId('modal-upgrade-pro-btn').textContent).toContain('192');
    expect(screen.getByTestId('modal-upgrade-ultra-btn').textContent).toContain('1,920');

    fireEvent.click(screen.getByTestId('modal-cycle-monthly'));
    expect(screen.getByTestId('modal-upgrade-pro-btn').textContent).toContain('20');
    expect(screen.getByTestId('modal-upgrade-ultra-btn').textContent).toContain('200');
    unmountEn();

    await i18n.changeLanguage('vi');
    renderWithProviders(
      <Routes>
        <Route
          path="/"
          element={
            <UpgradeModal
              open={true}
              onOpenChange={vi.fn()}
              featureName="Trình đọc đối chiếu trang PDF & Xuất báo cáo Word"
            />
          }
        />
      </Routes>,
      { user: makeUser('teacher', 'pro') },
    );

    const viModal = screen.getByTestId('upgrade-modal');
    expect(viModal.textContent).not.toContain('ONNX INT8');
    expect(viModal.textContent).not.toContain('MiniLM');
    expect(viModal.textContent).not.toContain('Sentence-BERT');
    expect(viModal.textContent).not.toContain('SerpAPI');
    expect(viModal.innerHTML).not.toContain('shadow-xs');
    expect(viModal.innerHTML).not.toContain('py-0.2');
    expect(viModal.innerHTML).not.toContain('class="truncate"');
    expect(viModal.textContent).toContain('400.000 ₫');
    expect(viModal.textContent).toContain('4.000.000 ₫');
    expect(viModal.textContent).toContain('$1.920/năm');
    expect(viModal.textContent).not.toContain('$1,920');

    fireEvent.click(screen.getByTestId('modal-cycle-monthly'));
    expect(viModal.textContent).toContain('500.000 ₫');
    expect(viModal.textContent).toContain('5.000.000 ₫');
    expect(screen.getByTestId('modal-upgrade-ultra-btn').textContent).toContain('5.000.000 ₫');
    expect(viModal.textContent).toContain('~$200/tháng');
  });

  it('Round 1: eliminates VI machine-translated calques on VerdictBadge (UNRESOLVED & LIKELY_VERIFIED) and enforces triggeredRules parity + actionable tooltips across VerdictBadge, VerdictBadgeCompact, and VerdictIcon', async () => {
    // 1. EN actionable tooltips & triggeredRules parity across all 3 exports
    await i18n.changeLanguage('en');
    const { unmount: unmountEn } = renderWithProviders(
      <div>
        <div data-testid="en-vb-inc">
          <VerdictBadge verdict="METADATA_ERROR" triggeredRules={['R-INCOMPLETE-METADATA']} />
        </div>
        <div data-testid="en-vbc-inc">
          <VerdictBadgeCompact verdict="metadata_error" triggeredRules={['R-INCOMPLETE-METADATA']} />
        </div>
        <div data-testid="en-vbi-inc">
          <VerdictIcon verdict="metadata_error" triggeredRules={['R-INCOMPLETE-METADATA']} />
        </div>
        <div data-testid="en-vb-legal">
          <VerdictBadge verdict="RESOURCE" triggeredRules={['R-VN-LEGAL-VERIFIED']} />
        </div>
        <div data-testid="en-vbc-legal">
          <VerdictBadgeCompact verdict="resource" triggeredRules={['R-VN-LEGAL-VERIFIED']} />
        </div>
        <div data-testid="en-vbi-legal">
          <VerdictIcon verdict="resource" triggeredRules={['R-VN-LEGAL-VERIFIED']} />
        </div>
      </div>,
    );

    const expectedEnIncompleteTitle =
      'Incomplete Reference — Citation is missing required details (author, publication year, or venue); add the missing details to complete this entry.';
    const expectedEnLegalTitle =
      'Legal Statute — Recognized legal statute or government regulation; no action needed (not penalized in your score).';

    for (const id of ['en-vb-inc', 'en-vbc-inc', 'en-vbi-inc']) {
      const el = screen.getByTestId(id).firstElementChild as HTMLElement;
      expect(el.getAttribute('title')).toBe(expectedEnIncompleteTitle);
    }
    for (const id of ['en-vb-legal', 'en-vbc-legal', 'en-vbi-legal']) {
      const el = screen.getByTestId(id).firstElementChild as HTMLElement;
      expect(el.getAttribute('title')).toBe(expectedEnLegalTitle);
      expect(el.querySelector('svg.lucide-scale')).not.toBeNull();
    }
    unmountEn();

    // 2. VI natural academic labels (zero calques) + actionable tooltips & triggeredRules parity
    await i18n.changeLanguage('vi');
    const { container: viContainer } = renderWithProviders(
      <div>
        <div data-testid="vi-vb-unres">
          <VerdictBadge verdict="UNRESOLVED" />
        </div>
        <div data-testid="vi-vb-likely">
          <VerdictBadge verdict="LIKELY_VERIFIED" />
        </div>
        <div data-testid="vi-vb-inc">
          <VerdictBadge verdict="METADATA_ERROR" triggeredRules={['R-INCOMPLETE-METADATA']} />
        </div>
        <div data-testid="vi-vbc-inc">
          <VerdictBadgeCompact verdict="metadata_error" triggeredRules={['R-INCOMPLETE-METADATA']} />
        </div>
        <div data-testid="vi-vbi-inc">
          <VerdictIcon verdict="metadata_error" triggeredRules={['R-INCOMPLETE-METADATA']} />
        </div>
        <div data-testid="vi-vb-legal">
          <VerdictBadge verdict="RESOURCE" triggeredRules={['R-VN-LEGAL-VERIFIED']} />
        </div>
        <div data-testid="vi-vbc-legal">
          <VerdictBadgeCompact verdict="resource" triggeredRules={['R-VN-LEGAL-VERIFIED']} />
        </div>
        <div data-testid="vi-vbi-legal">
          <VerdictIcon verdict="resource" triggeredRules={['R-VN-LEGAL-VERIFIED']} />
        </div>
      </div>,
    );

    expect(screen.getByTestId('vi-vb-unres').textContent).toBe('Chưa đủ dữ liệu');
    expect(screen.getByTestId('vi-vb-likely').textContent).toBe('Đã xác minh');
    expect(viContainer.textContent).not.toContain('Chưa giải quyết');
    expect(viContainer.textContent).not.toContain('Có thể đã xác minh');
    expect(viContainer.textContent).not.toContain('Bịa đặt');
    expect(viContainer.textContent).not.toContain('Khả năng cao bịa đặt');

    const expectedViIncompleteTitle =
      'Thiếu quy cách trích dẫn — Mục tham khảo thiếu tác giả, năm xuất bản hoặc nơi công bố (chỉ là thiếu sót trình bày); hãy bổ sung đầy đủ các thông tin còn thiếu.';
    const expectedViLegalTitle =
      'Văn bản pháp luật — Văn bản quy phạm pháp luật đã nhận diện; không cần chỉnh sửa và không bị tính điểm trừ trích dẫn.';

    for (const id of ['vi-vb-inc', 'vi-vbc-inc', 'vi-vbi-inc']) {
      const el = screen.getByTestId(id).firstElementChild as HTMLElement;
      expect(el.getAttribute('title')).toBe(expectedViIncompleteTitle);
    }
    for (const id of ['vi-vb-legal', 'vi-vbc-legal', 'vi-vbi-legal']) {
      const el = screen.getByTestId(id).firstElementChild as HTMLElement;
      expect(el.getAttribute('title')).toBe(expectedViLegalTitle);
      expect(el.querySelector('svg.lucide-scale')).not.toBeNull();
    }
  });

  it('Round 1: UpgradeModal pins Lock icon with rounded-lg feature pill, wraps VND currency units in whitespace-nowrap, keeps audience subtitles full-width below card header rows, and sets aria-pressed on billing cycle buttons', async () => {
    await i18n.changeLanguage('en');
    const { unmount: unmountEn } = renderWithProviders(
      <Routes>
        <Route
          path="/"
          element={
            <UpgradeModal
              open={true}
              onOpenChange={vi.fn()}
              featureName="Interactive Document Inspector & Full Export"
            />
          }
        />
      </Routes>,
      { user: makeUser('user', 'basic') },
    );

    expect(screen.getByRole('button', { name: 'Close' })).toBeDefined();
    expect(screen.getByRole('group', { name: 'Billing cycle toggle' })).toBeDefined();
    expect(screen.getByTestId('modal-cycle-annual').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('modal-cycle-monthly').getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByTestId('modal-cycle-monthly'));
    expect(screen.getByTestId('modal-cycle-annual').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('modal-cycle-monthly').getAttribute('aria-pressed')).toBe('true');
    unmountEn();

    await i18n.changeLanguage('vi');
    renderWithProviders(
      <Routes>
        <Route
          path="/"
          element={
            <UpgradeModal
              open={true}
              onOpenChange={vi.fn()}
              featureName="Trình đọc đối chiếu trang PDF & Xuất báo cáo Word"
            />
          }
        />
      </Routes>,
      { user: makeUser('teacher', 'pro') },
    );

    const viModal = screen.getByTestId('upgrade-modal');
    const lockSvg = viModal.querySelector('svg.lucide-lock');
    expect(lockSvg).not.toBeNull();
    const featurePill = lockSvg!.parentElement as HTMLElement;
    expect(featurePill.className).toContain('items-start');
    expect(featurePill.className).toContain('rounded-lg');
    expect(featurePill.className).not.toContain('rounded-full');
    expect(featurePill.className).not.toContain('flex-wrap');

    // Localized close & billing group ARIA in VI
    expect(screen.getByRole('button', { name: 'Đóng' })).toBeDefined();
    expect(screen.getByRole('group', { name: 'Chọn chu kỳ thanh toán' })).toBeDefined();

    // Non-breaking VND currency units (annual)
    const proVndAnnual = screen.getByTestId('modal-pro-vnd-equivalent');
    const ultraVndAnnual = screen.getByTestId('modal-ultra-vnd-equivalent');
    expect(proVndAnnual.textContent).toBe(
      'Thanh toán 4.800.000 ₫/năm (~$192/năm) qua VNPay hoặc thẻ quốc tế',
    );
    expect(ultraVndAnnual.textContent).toBe(
      'Thanh toán 48.000.000 ₫/năm (~$1.920/năm) qua VNPay hoặc thẻ quốc tế',
    );
    expect(viModal.querySelectorAll('span.whitespace-nowrap').length).toBeGreaterThanOrEqual(4);

    // Non-breaking VND currency units (monthly)
    fireEvent.click(screen.getByTestId('modal-cycle-monthly'));
    expect(proVndAnnual.textContent).toBe(
      'Thanh toán hàng tháng (~$20/tháng) qua VNPay hoặc thẻ quốc tế',
    );
    expect(ultraVndAnnual.textContent).toBe(
      'Thanh toán hàng tháng (~$200/tháng) qua VNPay hoặc thẻ quốc tế',
    );
    expect(viModal.querySelectorAll('span.whitespace-nowrap').length).toBeGreaterThanOrEqual(2);

    // Card header geometry: audience subtitle sits full-width outside the [Icon + Title | Badge] flex-wrap top row
    const ultraHeading = screen.getByText('CITRA Ultra');
    const ultraTopRow = ultraHeading.closest('div.justify-between') as HTMLElement;
    expect(ultraTopRow).not.toBeNull();
    expect(ultraTopRow.className).toContain('flex-wrap');
    expect(ultraTopRow.textContent).not.toContain('Phòng Lab, Bộ môn & Hội đồng luận án');
    expect(ultraTopRow.nextElementSibling?.textContent).toBe('Phòng Lab, Bộ môn & Hội đồng luận án');
  });

  it('Phase 1B: ProtectedRoute preserves ?redirect= on login and shows localized toast on unauthorized access; HelpModal, EssaySortSelect & AppLayout enforce global shell polish', async () => {
    function LoginProbe() {
      const loc = useLocation();
      return <div data-testid="login-probe">{`${loc.pathname}${loc.search}`}</div>;
    }

    // 1. Unauthenticated ProtectedRoute -> /login?redirect=%2Fadmin%2Fusers%3Ftab%3Dactive
    await i18n.changeLanguage('en');
    const { unmount: u1 } = renderWithProviders(
      <Routes>
        <Route path="/login" element={<LoginProbe />} />
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute requiredRoles={['admin']}>
              <div>Admin Secret</div>
            </ProtectedRoute>
          }
        />
      </Routes>,
      { user: null, initialRoute: '/admin/users?tab=active' },
    );
    expect(screen.getByTestId('login-probe').textContent).toBe(
      '/login?redirect=%2Fadmin%2Fusers%3Ftab%3Dactive',
    );
    u1();

    // 2. Authenticated non-admin hitting admin route -> /dashboard + localized VI toast
    await i18n.changeLanguage('vi');
    const { unmount: u2 } = renderWithProviders(
      <Routes>
        <Route path="/dashboard" element={<div data-testid="dash-home">Dashboard</div>} />
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute requiredRoles={['admin']}>
              <div>Admin Secret</div>
            </ProtectedRoute>
          }
        />
      </Routes>,
      { user: makeUser('user', 'pro'), initialRoute: '/admin/users' },
    );
    expect(screen.getByTestId('dash-home')).toBeDefined();
    expect(screen.getByText('Bạn không có quyền truy cập trang này.')).toBeDefined();
    u2();

    // 3. HelpModal in VI: unified taxonomy, no raw enums, no Neuro-Symbolic Engine box, localized BƯỚC 01, no Ctrl+D/Ctrl+U
    const { container: helpContainer, unmount: u3 } = renderWithProviders(
      <HelpModal isOpen={true} onClose={vi.fn()} />,
    );
    expect(helpContainer.textContent).not.toContain('Neuro-Symbolic Engine');
    expect(helpContainer.textContent).not.toContain('30 Symbolic Rules');
    fireEvent.click(screen.getByRole('button', { name: /Bắt đầu/i }));
    expect(helpContainer.textContent).toContain('BƯỚC 01');
    expect(helpContainer.textContent).not.toContain('STEP 01');
    expect(helpContainer.textContent).toContain('5MB–100MB');
    fireEvent.click(screen.getByRole('button', { name: /Hiểu về kết quả/i }));
    expect(helpContainer.textContent).toContain('Không tìm thấy nguồn');
    expect(helpContainer.textContent).toContain('Sai lệch thông tin');
    expect(helpContainer.textContent).not.toContain('SUSPECTED_HALLUCINATION');
    expect(helpContainer.textContent).not.toContain('R-INCOMPLETE-METADATA');
    expect(helpContainer.textContent).not.toContain('Khả năng cao bịa đặt');
    fireEvent.click(screen.getByRole('button', { name: /Phím tắt/i }));
    expect(helpContainer.textContent).not.toContain('Ctrl+D');
    expect(helpContainer.textContent).not.toContain('Ctrl+U');
    u3();

    // 4. EssaySortSelect widens container to avoid clipping chevron
    const { container: sortContainer, unmount: u4 } = renderWithProviders(
      <EssaySortSelect value="date_desc" onChange={vi.fn()} />,
    );
    expect((sortContainer.firstElementChild as HTMLElement).className).toContain('sm:min-w-[232px]');
    expect(screen.getByTestId('essay-sort-select').className).toContain('pr-9');
    u4();

    // 5. AppLayout in VI includes /sandbox, localizes footer & ARIA labels, never hijacks Ctrl+D / Ctrl+U
    const { container: layoutContainer } = renderWithProviders(
      <Routes>
        <Route
          path="/dashboard"
          element={
            <AppLayout>
              <div>Body</div>
            </AppLayout>
          }
        />
      </Routes>,
      { user: makeUser('admin', 'ultra'), initialRoute: '/dashboard' },
    );
    expect(layoutContainer.querySelector('aside a[href="/sandbox"]')).not.toBeNull();
    expect(layoutContainer.textContent).toContain('Kiểm tra nhanh');
    expect(screen.getByTestId('app-footer').textContent).toContain(
      '© 2026 CITRA. Bảo lưu mọi quyền.',
    );
    expect(screen.getByRole('navigation', { name: 'Điều hướng chính' })).toBeDefined();

    const ctrlDEvent = new KeyboardEvent('keydown', {
      key: 'd',
      ctrlKey: true,
      cancelable: true,
    });
    window.dispatchEvent(ctrlDEvent);
    expect(ctrlDEvent.defaultPrevented).toBe(false);

    const ctrlUEvent = new KeyboardEvent('keydown', {
      key: 'u',
      ctrlKey: true,
      cancelable: true,
    });
    window.dispatchEvent(ctrlUEvent);
    expect(ctrlUEvent.defaultPrevented).toBe(false);
  });

  it('Loop Round 2: HelpModal wraps header subtitle & footer without truncate in VI & EN, and AppLayout uses concise VI sidebar label "Nhật ký duyệt bài" for /admin/audit', async () => {
    // 1. HelpModal VI
    await i18n.changeLanguage('vi');
    const { unmount: uVi } = renderWithProviders(
      <HelpModal isOpen={true} onClose={vi.fn()} />,
    );
    const viSub = screen.getByTestId('help-modal-subtitle');
    const viFooter = screen.getByTestId('help-modal-footer-note');
    expect(viSub.textContent).toBe('Cách kiểm tra trích dẫn và đọc hiểu kết quả');
    expect(viSub.className).toContain('whitespace-normal');
    expect(viSub.className).not.toContain('truncate');
    expect(viFooter.textContent).toBe(
      'Công cụ hỗ trợ — Giảng viên & tác giả quyết định cuối cùng.',
    );
    expect(viFooter.className).toContain('whitespace-normal');
    expect(viFooter.className).not.toContain('truncate');
    uVi();

    // 2. HelpModal EN
    await i18n.changeLanguage('en');
    const { unmount: uEn } = renderWithProviders(
      <HelpModal isOpen={true} onClose={vi.fn()} />,
    );
    const enSub = screen.getByTestId('help-modal-subtitle');
    const enFooter = screen.getByTestId('help-modal-footer-note');
    expect(enSub.textContent).toBe('How to check citations and understand your report');
    expect(enSub.className).toContain('whitespace-normal');
    expect(enSub.className).not.toContain('truncate');
    expect(enFooter.textContent).toBe(
      'Decision support — final judgment rests with humans.',
    );
    expect(enFooter.className).toContain('whitespace-normal');
    expect(enFooter.className).not.toContain('truncate');
    uEn();

    // 3. AppLayout VI admin sidebar audit log link uses concise non-truncating label
    await i18n.changeLanguage('vi');
    const { container: viLayout, unmount: uViLayout } = renderWithProviders(
      <Routes>
        <Route
          path="/dashboard"
          element={
            <AppLayout>
              <div>Body</div>
            </AppLayout>
          }
        />
      </Routes>,
      { user: makeUser('admin', 'ultra'), initialRoute: '/dashboard' },
    );
    const auditLinkVi = viLayout.querySelector('aside a[href="/admin/audit"]');
    expect(auditLinkVi?.textContent).toBe('Nhật ký duyệt bài');
    uViLayout();

    // 4. AppLayout EN admin sidebar keeps "Citation Review Log"
    await i18n.changeLanguage('en');
    const { container: enLayout } = renderWithProviders(
      <Routes>
        <Route
          path="/dashboard"
          element={
            <AppLayout>
              <div>Body</div>
            </AppLayout>
          }
        />
      </Routes>,
      { user: makeUser('admin', 'ultra'), initialRoute: '/dashboard' },
    );
    const auditLinkEn = enLayout.querySelector('aside a[href="/admin/audit"]');
    expect(auditLinkEn?.textContent).toBe('Citation Review Log');
  });
});
