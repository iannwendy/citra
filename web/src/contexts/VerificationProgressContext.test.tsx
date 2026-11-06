import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import { api, type EssayStatus } from '@/api/client';
import i18n from '@/i18n';
import {
  renderWithProviders,
  makeUser,
  screen,
  fireEvent,
  waitFor,
} from '@/test-utils';
import {
  batchTiming,
  singlePollTiming,
} from '@/contexts/VerificationProgressContext';
import { AppLayout } from '@/components/AppLayout';
import { UploadPage } from '@/pages/UploadPage';
import { ProcessingPage } from '@/pages/ProcessingPage';
import { BatchUploadPage } from '@/pages/BatchUploadPage';

function makePdf(name: string, sizeKb = 12): File {
  return new File([new Uint8Array(sizeKb * 1024)], name, {
    type: 'application/pdf',
  });
}

function makeStatus(overrides: Partial<EssayStatus> = {}): EssayStatus {
  return {
    status: 'processing',
    queue_position: null,
    step: 'retrieving',
    step_index: 4,
    total_steps: 8,
    message: 'Querying Crossref & OpenAlex...',
    citations_found: 18,
    references_found: 15,
    linked: 14,
    sources_queried: { crossref: 'done', openalex: 'done' },
    elapsed_seconds: 6.2,
    finished_at: null,
    error: null,
    ...overrides,
  };
}

function TestWorkspaceRoutes() {
  return (
    <AppLayout>
      <Routes>
        <Route
          path="/dashboard"
          element={<div data-testid="mock-dashboard-view">Dashboard View</div>}
        />
        <Route
          path="/history"
          element={<div data-testid="mock-history-view">History View</div>}
        />
        <Route path="/upload" element={<UploadPage />} />
        <Route
          path="/verification/processing/:id"
          element={<ProcessingPage />}
        />
        <Route
          path="/verification/report/:id"
          element={<div data-testid="mock-report-view">Report View</div>}
        />
        <Route path="/batch-upload" element={<BatchUploadPage />} />
      </Routes>
    </AppLayout>
  );
}

describe('VerificationProgressContext — Cross-Tab & Reload Progress Persistence', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    batchTiming.pollIntervalMs = 10;
    singlePollTiming.pollIntervalMs = 25;
    await i18n.changeLanguage('vi');
    vi.spyOn(api, 'listEssays').mockResolvedValue([]);
    vi.spyOn(api, 'listEnrolledClasses').mockResolvedValue([]);
    vi.spyOn(api, 'listMyClasses').mockResolvedValue([]);
    vi.spyOn(api, 'getEssay').mockResolvedValue({
      essay_id: 77,
      filename: 'Luan_Van_Tot_Nghiep.pdf',
    } as never);
  });

  afterEach(() => {
    batchTiming.pollIntervalMs = 2000;
    singlePollTiming.pollIntervalMs = 2000;
    sessionStorage.clear();
  });

  it('restores Single Check ProcessingPage when switching to Dashboard and clicking "Kiểm Tra Mới" again, supports ?new=1, and surfaces background completion banner', async () => {
    let currentStatus: EssayStatus = makeStatus({
      status: 'processing',
      step: 'retrieving',
      step_index: 4,
    });

    vi.spyOn(api, 'uploadEssay').mockResolvedValue({
      essay_id: 77,
      filename: 'Luan_Van_Tot_Nghiep.pdf',
      num_pages: 14,
      num_citations: 0,
      summary: { status: 'processing' },
    } as never);
    vi.spyOn(api, 'getEssayStatus').mockImplementation(async () => currentStatus);

    const user = makeUser('user', 'pro');
    const { container } = renderWithProviders(<TestWorkspaceRoutes />, {
      user,
      initialRoute: '/upload',
    });

    // 1. Select PDF & start single check
    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [makePdf('Luan_Van_Tot_Nghiep.pdf')] },
    });

    const uploadBtn = await screen.findByRole('button', {
      name: /Bắt đầu xác minh/i,
    });
    fireEvent.click(uploadBtn);

    // 2. ProcessingPage mounts with filename badge
    expect(await screen.findByTestId('processing-filename-badge')).toBeDefined();
    expect(screen.getByTestId('processing-filename-badge').textContent).toContain(
      'Luan_Van_Tot_Nghiep.pdf',
    );

    // 3. Navigate away to Dashboard via sidebar
    fireEvent.click(screen.getByRole('link', { name: /Bảng điều khiển/i }));
    expect(await screen.findByTestId('mock-dashboard-view')).toBeDefined();

    // Sidebar live badge & mobile sticky pill remain visible while on Dashboard
    await waitFor(() => {
      expect(screen.getByTestId('sidebar-single-progress-badge')).toBeDefined();
      expect(screen.getByTestId('mobile-active-progress-pill')).toBeDefined();
    });
    expect(
      screen.getByTestId('sidebar-single-progress-badge').textContent,
    ).toContain('50%');

    // 4. Click "Kiểm tra mới" (/upload) in sidebar -> automatically restores ProcessingPage!
    fireEvent.click(screen.getByRole('link', { name: /Kiểm tra mới/i }));
    expect(await screen.findByTestId('processing-filename-badge')).toBeDefined();
    expect(screen.getByTestId('processing-filename-badge').textContent).toContain(
      'Luan_Van_Tot_Nghiep.pdf',
    );

    // 5. Click "Kiểm tra tài liệu khác" (?new=1) -> opens UploadPage dropzone with active banner
    fireEvent.click(screen.getByTestId('processing-new-upload-btn'));
    expect(await screen.findByTestId('active-single-check-banner')).toBeDefined();
    expect(
      screen.getByTestId('active-single-check-banner').textContent,
    ).toContain('Luan_Van_Tot_Nghiep.pdf');

    // 6. Switch back to Dashboard and let the essay finish in the background
    fireEvent.click(screen.getByRole('link', { name: /Bảng điều khiển/i }));
    expect(await screen.findByTestId('mock-dashboard-view')).toBeDefined();

    currentStatus = makeStatus({
      status: 'completed',
      step: 'done',
      step_index: 7,
      finished_at: 1762430400,
    });

    await waitFor(() => {
      expect(screen.queryByTestId('sidebar-single-progress-badge')).toBeNull();
    });

    // 7. Click "Kiểm tra mới" after completion -> shows recent completed banner + fresh dropzone
    fireEvent.click(screen.getByRole('link', { name: /Kiểm tra mới/i }));
    expect(await screen.findByTestId('recent-single-check-banner')).toBeDefined();
    expect(
      screen.getByTestId('recent-single-check-banner').textContent,
    ).toContain('Luan_Van_Tot_Nghiep.pdf');
  });

  it('keeps Batch Check queue & concurrency pool running across tab navigation and suppresses surprise redirect on return', async () => {
    let nextId = 200;
    const uploadGates: Array<() => void> = [];

    vi.spyOn(api, 'uploadEssay').mockImplementation(async (file) => {
      await new Promise<void>((resolve) => uploadGates.push(resolve));
      return {
        essay_id: nextId++,
        filename: file.name,
      } as never;
    });

    vi.spyOn(api, 'getEssayStatus').mockResolvedValue(
      makeStatus({ status: 'completed', step: 'done', step_index: 8 }),
    );

    const user = makeUser('user', 'pro');
    const { container } = renderWithProviders(<TestWorkspaceRoutes />, {
      user,
      initialRoute: '/batch-upload',
    });

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: {
        files: [
          makePdf('paper_1.pdf'),
          makePdf('paper_2.pdf'),
          makePdf('paper_3.pdf'),
          makePdf('paper_4.pdf'),
        ],
      },
    });

    fireEvent.click(
      screen.getByRole('button', { name: /Bắt đầu xác minh/i }),
    );

    // Wait for first 3 concurrent uploads to be in-flight
    await waitFor(() => expect(uploadGates.length).toBe(3));

    // Switch away to Dashboard while batch is actively running
    fireEvent.click(screen.getByRole('link', { name: /Bảng điều khiển/i }));
    expect(await screen.findByTestId('mock-dashboard-view')).toBeDefined();

    // Sidebar badge reflects active batch (0/4)
    expect(screen.getByTestId('sidebar-batch-progress-badge').textContent).toBe(
      '0/4',
    );

    // Release first 3 uploads while user is STILL on Dashboard; 4th upload should also start & finish!
    uploadGates.splice(0).forEach((release) => release());
    await waitFor(() => expect(uploadGates.length).toBe(1));
    uploadGates.splice(0).forEach((release) => release());

    // Wait for background batch queue to finish completely
    await waitFor(() => {
      expect(screen.queryByTestId('sidebar-batch-progress-badge')).toBeNull();
    });

    // Navigate back to "Kiểm tra hàng loạt" (/batch-upload)
    fireEvent.click(screen.getByRole('link', { name: /Kiểm tra hàng loạt/i }));

    // All 4 files are preserved with Complete status AND completion notice is shown without auto-redirecting away
    expect(
      await screen.findByTestId('batch-background-completed-notice'),
    ).toBeDefined();
    expect(screen.getByText('paper_1.pdf')).toBeDefined();
    expect(screen.getByText('paper_4.pdf')).toBeDefined();
    expect(screen.getAllByText('Hoàn tất').length).toBe(4);
  });

  it('hydrates in-flight Single Check and Batch Check from sessionStorage after browser reload (F5)', async () => {
    const user = makeUser('user', 'pro');

    sessionStorage.setItem(
      `citra_single_check_v1_${user.id}`,
      JSON.stringify({
        essayId: 91,
        filename: 'Reloaded_Thesis.pdf',
        fileSize: 24576,
        classId: null,
        status: 'processing',
        step: 'comparing',
        stepIndex: 5,
        totalSteps: 8,
        progress: 63,
        message: 'Comparing metadata...',
        queuePosition: null,
        error: null,
        startedAt: Date.now(),
        acknowledged: false,
      }),
    );

    sessionStorage.setItem(
      `citra_batch_check_v1_${user.id}`,
      JSON.stringify({
        savedAt: Date.now(),
        targetClassId: null,
        hasAutoNavigated: false,
        files: [
          {
            id: 'batch-item-1',
            fileName: 'Batch_Restored_1.pdf',
            fileSize: 10240,
            status: 'completed',
            progress: 100,
            essayId: 301,
          },
          {
            id: 'batch-item-2',
            fileName: 'Batch_Restored_2.pdf',
            fileSize: 10240,
            status: 'processing',
            progress: 50,
            essayId: 302,
          },
        ],
      }),
    );

    vi.spyOn(api, 'getEssayStatus').mockImplementation(async (essayId) => {
      if (essayId === 91) {
        return makeStatus({
          status: 'processing',
          step: 'comparing',
          step_index: 5,
        });
      }
      return makeStatus({
        status: 'processing',
        step: 'checking',
        step_index: 6,
      });
    });

    renderWithProviders(<TestWorkspaceRoutes />, {
      user,
      initialRoute: '/dashboard',
    });

    // Both sidebar badges hydrate immediately after F5 reload
    await waitFor(() => {
      expect(screen.getByTestId('sidebar-single-progress-badge')).toBeDefined();
      expect(screen.getByTestId('sidebar-batch-progress-badge')).toBeDefined();
    });
    expect(
      screen.getByTestId('sidebar-batch-progress-badge').textContent,
    ).toBe('1/2');

    // Clicking "Kiểm Tra Mới" restores ProcessingPage for essay #91
    fireEvent.click(screen.getByRole('link', { name: /Kiểm Tra Mới/i }));
    expect(await screen.findByTestId('processing-filename-badge')).toBeDefined();
    expect(screen.getByTestId('processing-filename-badge').textContent).toContain(
      'Reloaded_Thesis.pdf',
    );
  });
});
