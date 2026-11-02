import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import { api } from '@/api/client';
import i18n from '@/i18n';
import {
  renderWithProviders,
  makeUser,
  screen,
  fireEvent,
} from '@/test-utils';
import { makeReport, makeVerdict } from '@/test-fixtures';
import { DocumentInspectorPage } from './DocumentInspectorPage';

const reportFixture = makeReport({
  essay_id: 42,
  filename: 'thesis.pdf',
  num_pages: 5,
  num_citations: 2,
  verdicts: [
    makeVerdict({
      citation_id: 'v1',
      citation_raw: '[1] Vaswani et al. (2017). Attention Is All You Need.',
      label: 'verified',
      mapping_status: 'matched',
      context: 'Transformer architecture was introduced by [1] in 2017.',
      triggered_rules: ['R01'],
      mismatched_fields: [],
    }),
    makeVerdict({
      citation_id: 'v2',
      citation_raw: '[2] Fake Author (2099). Synthetic Quantum Hallucinations.',
      label: 'suspected_hallucination',
      mapping_status: 'missing_reference',
      context: 'Quantum hallucinations were claimed in [2].',
      triggered_rules: ['R03'],
      mismatched_fields: ['title', 'year'],
    }),
  ],
});

describe('DocumentInspectorPage i18n', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  it('renders localized strings in English and opens localized CitationPopup', async () => {
    vi.spyOn(api, 'getEssay').mockResolvedValue(reportFixture);

    renderWithProviders(
      <Routes>
        <Route
          path="/verification/inspector/:id"
          element={<DocumentInspectorPage />}
        />
      </Routes>,
      {
        user: makeUser('teacher'),
        initialRoute: '/verification/inspector/42',
      },
    );

    expect(await screen.findByText('Document View')).toBeDefined();
    expect(screen.getByText('Context Stream')).toBeDefined();
    expect(screen.getByText('PDF Page Preview')).toBeDefined();
    expect(screen.getByText('Citation List')).toBeDefined();
    expect(
      screen.getByText('Document Inspector · 5 pages · 2 citations'),
    ).toBeDefined();

    fireEvent.click(screen.getByTestId('page-citation-item-1'));
    expect(await screen.findByText('Citation Detail')).toBeDefined();
    expect(screen.getByText('In-text Citation')).toBeDefined();
    expect(screen.getByText('What we found')).toBeDefined();
    expect(screen.getByText('Triggered Rules')).toBeDefined();
    expect(screen.getByText('View full report')).toBeDefined();
  });

  it('renders localized strings in Vietnamese and opens localized CitationPopup', async () => {
    await i18n.changeLanguage('vi');
    vi.spyOn(api, 'getEssay').mockResolvedValue(reportFixture);

    renderWithProviders(
      <Routes>
        <Route
          path="/verification/inspector/:id"
          element={<DocumentInspectorPage />}
        />
      </Routes>,
      {
        user: makeUser('teacher'),
        initialRoute: '/verification/inspector/42',
      },
    );

    expect(await screen.findByText('Chế độ xem tài liệu')).toBeDefined();
    expect(screen.getByText('Luồng ngữ cảnh')).toBeDefined();
    expect(screen.getByText('Xem trước trang PDF')).toBeDefined();
    expect(screen.getByText('Danh sách trích dẫn')).toBeDefined();
    expect(
      screen.getByText('Trình kiểm tra tài liệu · 5 trang · 2 trích dẫn'),
    ).toBeDefined();

    fireEvent.click(screen.getByTestId('page-citation-item-1'));
    expect(await screen.findByText('Chi tiết trích dẫn')).toBeDefined();
    expect(screen.getByText('Trích dẫn trong bài')).toBeDefined();
    expect(screen.getByText('Kết quả phân tích')).toBeDefined();
    expect(screen.getByText('Luật được kích hoạt')).toBeDefined();
    expect(screen.getByText('Xem báo cáo đầy đủ')).toBeDefined();
  });
});
