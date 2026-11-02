import { describe, it, expect, vi, beforeEach } from 'vitest';
import i18n from '@/i18n';
import { renderWithProviders, makeUser, screen, fireEvent } from '@/test-utils';
import { makeVerdict } from '@/test-fixtures';
import { MappingStatusBadge } from './MappingStatusBadge';
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
