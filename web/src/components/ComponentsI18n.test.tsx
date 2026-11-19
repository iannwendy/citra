import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Routes, Route } from 'react-router-dom';
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
    fireEvent.click(screen.getByRole('button', { name: 'Ghi đè' }));
    expect(screen.getByText('✓ Đã xác minh')).toBeDefined();
    expect(screen.getByText('△ Sai lệch Metadata')).toBeDefined();
    expect(screen.getByText('Đã khớp')).toBeDefined();
    expect(screen.getByText('Thiếu nguồn')).toBeDefined();
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
    expect(enGraph.graph.children?.[0]?.label).toBe('Academic Databases');
    expect(enGraph.graph.children?.[1]?.label).toBe('Semantic Matching');

    const { unmount } = renderWithProviders(
      <CitationGraphView verdicts={[verdict]} onSelect={vi.fn()} />,
    );
    expect(screen.getByText(/Two-Layer Citation & Source Network Explorer/)).toBeDefined();
    expect(screen.getByText('All Layers')).toBeDefined();
    unmount();

    await i18n.changeLanguage('vi');
    const viGraph = buildEvidenceGraph(verdict, 'vi');
    expect(viGraph.graph.children?.[0]?.label).toBe('Cơ sở dữ liệu học thuật');
    expect(viGraph.graph.children?.[1]?.label).toBe('Đối sánh ngữ nghĩa');

    renderWithProviders(
      <CitationGraphView verdicts={[verdict]} onSelect={vi.fn()} />,
    );
    expect(screen.getByText(/Trình Khám Phá Mạng Lưới Trích Dẫn & Nguồn 2 Tầng/)).toBeDefined();
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

    fireEvent.click(screen.getByTestId('modal-cycle-monthly'));
    expect(viModal.textContent).toContain('500.000 ₫');
    expect(viModal.textContent).toContain('5.000.000 ₫');
    expect(screen.getByTestId('modal-upgrade-ultra-btn').textContent).toContain('200');
  });
});
