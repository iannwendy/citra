import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import { api, type EssayStatus } from '@/api/client';
import i18n from '@/i18n';
import { renderWithProviders, makeUser, screen } from '@/test-utils';
import { ProcessingPage } from './ProcessingPage';

const queuedStatusFixture: EssayStatus = {
  status: 'queued',
  queue_position: 4,
  step: 'parse',
  step_index: 0,
  total_steps: 8,
  message: 'Queued in admission queue (#4)',
  citations_found: 0,
  references_found: 0,
  linked: 0,
  sources_queried: {},
  elapsed_seconds: 1.8,
  finished_at: null,
  error: null,
};

describe('ProcessingPage FIFO Admission Queue UI', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  it('renders FIFO queue position badge and banner in English when status is queued', async () => {
    vi.spyOn(api, 'getEssayStatus').mockResolvedValue(queuedStatusFixture);

    renderWithProviders(
      <Routes>
        <Route path="/verification/processing/:id" element={<ProcessingPage />} />
      </Routes>,
      {
        user: makeUser('user'),
        initialRoute: '/verification/processing/77',
      },
    );

    expect(
      await screen.findByText('Queued for analysis (Position #4)'),
    ).toBeDefined();
    expect(screen.getByTestId('queued-processing-banner')).toBeDefined();
    expect(
      screen.getByText('Submission in smart admission queue — Current position: #4'),
    ).toBeDefined();
    expect(screen.getByText('QUEUED (#4)')).toBeDefined();
  });

  it('renders FIFO queue position badge and banner in Vietnamese when status is queued', async () => {
    await i18n.changeLanguage('vi');
    vi.spyOn(api, 'getEssayStatus').mockResolvedValue({
      ...queuedStatusFixture,
      queue_position: 2,
    });

    renderWithProviders(
      <Routes>
        <Route path="/verification/processing/:id" element={<ProcessingPage />} />
      </Routes>,
      {
        user: makeUser('user'),
        initialRoute: '/verification/processing/77',
      },
    );

    expect(
      await screen.findByText('Đang xếp hàng xử lý (Vị trí #2)'),
    ).toBeDefined();
    expect(screen.getByTestId('queued-processing-banner')).toBeDefined();
    expect(
      screen.getByText('Bài nộp đang trong hàng đợi thông minh — Vị trí hiện tại: #2'),
    ).toBeDefined();
    expect(screen.getByText('Hàng đợi #2')).toBeDefined();
    expect(screen.getByText('QUEUED (#2)')).toBeDefined();
  });
});
