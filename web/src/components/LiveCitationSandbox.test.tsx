import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from '@/api/client';
import i18n from '@/i18n';
import { renderWithProviders, screen, fireEvent, waitFor } from '@/test-utils';
import { LiveCitationSandbox } from './LiveCitationSandbox';

const sampleResponse = {
  count: 2,
  style: 'apa',
  database_total_papers: 128626,
  items: [
    {
      index: 1,
      paper_id: 101,
      title: 'Attention Is All You Need',
      authors: ['Ashish Vaswani', 'Noam Shazeer'],
      authors_text: 'Ashish Vaswani; Noam Shazeer',
      year: '2017',
      venue: 'NeurIPS',
      doi: '10.48550/arXiv.1706.03762',
      cite_in_text: true,
      include_in_references: true,
      in_text_year_override: '',
      in_text_context: 'Transformer architectures dispense with recurrence',
      mutation_preset: 'clean',
      original: {
        title: 'Attention Is All You Need',
        authors_text: 'Ashish Vaswani; Noam Shazeer',
        year: '2017',
        venue: 'NeurIPS',
        doi: '10.48550/arXiv.1706.03762',
      },
    },
    {
      index: 2,
      paper_id: 102,
      title: 'BERT Pre-training of Deep Bidirectional Transformers',
      authors: ['Jacob Devlin', 'Ming-Wei Chang'],
      authors_text: 'Jacob Devlin; Ming-Wei Chang',
      year: '2019',
      venue: 'NAACL',
      doi: '10.18653/v1/N19-1423',
      cite_in_text: true,
      include_in_references: true,
      in_text_year_override: '',
      in_text_context: 'Bidirectional pretraining improves language understanding',
      mutation_preset: 'clean',
      original: {
        title: 'BERT Pre-training of Deep Bidirectional Transformers',
        authors_text: 'Jacob Devlin; Ming-Wei Chang',
        year: '2019',
        venue: 'NAACL',
        doi: '10.18653/v1/N19-1423',
      },
    },
  ],
};

describe('LiveCitationSandbox i18n', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  it('renders English preset badges, buttons, and checkboxes with no Vietnamese strings', async () => {
    vi.spyOn(api, 'sampleSandboxAclPapers').mockResolvedValue(sampleResponse);

    renderWithProviders(<LiveCitationSandbox lang="en" />);

    fireEvent.click(screen.getByTestId('sandbox-random-acl-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('sandbox-paper-card-0')).toBeDefined();
    });

    // Cycle presets on card 0 and verify English badges
    expect(screen.getAllByText('✓ CANONICAL ACL RECORD').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId('sandbox-preset-wrong-year-0'));
    expect(screen.getByText('⚡ WRONG YEAR (METADATA_ERROR)')).toBeDefined();

    fireEvent.click(screen.getByTestId('sandbox-preset-wrong-author-0'));
    expect(screen.getByText('⚡ WRONG AUTHOR (METADATA_ERROR)')).toBeDefined();

    fireEvent.click(screen.getByTestId('sandbox-preset-hallucinated-0'));
    expect(screen.getByText('🚨 HALLUCINATED SOURCE')).toBeDefined();

    fireEvent.click(screen.getByTestId('sandbox-preset-intext-mismatch-0'));
    expect(screen.getByText('🔗 IN-TEXT ↔ REF YEAR MISMATCH')).toBeDefined();

    const text = document.body.textContent ?? '';
    expect(text).toContain('Canonical ACL');
    expect(text).toContain('Wrong Year');
    expect(text).toContain('Wrong Author');
    expect(text).toContain('Hallucinate');
    expect(text).toContain('In-text ↔ Ref Year Drift');
    expect(text).toContain('Cited in Body Text (In-Text)');
    expect(text).toContain('Included in Bibliography (References)');

    // Ensure no Vietnamese strings leaked into English mode
    expect(text).not.toContain('CHUẨN GỐC CSDL ACL');
    expect(text).not.toContain('LỖI NĂM');
    expect(text).not.toContain('LỖI TÁC GIẢ');
    expect(text).not.toContain('NGUỒN BỊA ĐẶT');
    expect(text).not.toContain('Gốc ACL');
    expect(text).not.toContain('Sửa sai Năm');
    expect(text).not.toContain('Sửa sai Tác giả');
    expect(text).not.toContain('Bịa nguồn giả');
    expect(text).not.toContain('Trích dẫn trong bài');
    expect(text).not.toContain('Có trong mục References cuối bài');
  });

  it('renders Vietnamese preset badges, buttons, and checkboxes when lang="vi"', async () => {
    await i18n.changeLanguage('vi');
    vi.spyOn(api, 'sampleSandboxAclPapers').mockResolvedValue(sampleResponse);

    renderWithProviders(<LiveCitationSandbox lang="vi" />);

    fireEvent.click(screen.getByTestId('sandbox-random-acl-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('sandbox-paper-card-0')).toBeDefined();
    });

    const text = document.body.textContent ?? '';
    expect(text).toContain('✓ CHUẨN GỐC CSDL ACL');
    expect(text).toContain('Gốc ACL');
    expect(text).toContain('Sửa sai Năm');
    expect(text).toContain('Sửa sai Tác giả');
    expect(text).toContain('Bịa nguồn giả (Hallucination)');
    expect(text).toContain('Trích dẫn trong bài (Body In-Text)');
    expect(text).toContain('Có trong mục References cuối bài');
  });

  it('uses explicit light and dark theme classes on the studio header and mode switcher instead of dark-only styling', () => {
    renderWithProviders(<LiveCitationSandbox lang="en" />);

    const header = screen.getByTestId('sandbox-studio-header');
    expect(header.className).toContain('from-slate-50');
    expect(header.className).toContain('text-slate-900');
    expect(header.className).toContain('dark:from-slate-950');
    expect(header.className).toContain('dark:text-slate-50');
    expect(header.className).not.toContain('to-violet-950');

    const rawBtn = screen.getByTestId('sandbox-mode-raw-btn');
    expect(rawBtn.className).toContain('text-slate-600');
    expect(rawBtn.className).toContain('dark:text-slate-300');
  });
});
