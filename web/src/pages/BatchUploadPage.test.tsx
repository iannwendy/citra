import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, type EssayStatus } from '@/api/client';
import i18n from '@/i18n';
import { renderWithProviders, makeUser, QUOTA_BY_TIER, screen, fireEvent, waitFor } from '@/test-utils';
import { BatchUploadPage, BATCH_CONCURRENCY, batchTiming } from './BatchUploadPage';

function pdf(name: string, sizeMb = 0.01) {
  return new File([new ArrayBuffer(Math.round(sizeMb * 1024 * 1024))], name, {
    type: 'application/pdf',
  });
}

function addFiles(container: HTMLElement, files: File[]) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

const completed = { status: 'completed', step_index: 8, total_steps: 8 } as EssayStatus;

describe('BatchUploadPage', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    batchTiming.pollIntervalMs = 0;
    await i18n.changeLanguage('en');
    vi.spyOn(api, 'listMyClasses').mockResolvedValue([]);
  });
  afterEach(() => {
    batchTiming.pollIntervalMs = 2000;
  });

  it('uploads with a real concurrency pool of 3 (3 uploads in flight at once)', async () => {
    expect(BATCH_CONCURRENCY).toBe(3);
    let inFlight = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    let nextId = 100;
    vi.spyOn(api, 'uploadEssay').mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((r) => releases.push(r));
      inFlight--;
      return { essay_id: nextId++ } as never;
    });
    vi.spyOn(api, 'getEssayStatus').mockResolvedValue(completed);

    const { container } = renderWithProviders(<BatchUploadPage />, { user: makeUser('user', 'pro') });
    addFiles(container, [pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf'), pdf('d.pdf'), pdf('e.pdf')]);
    fireEvent.click(screen.getByRole('button', { name: /start verification/i }));

    await waitFor(() => expect(releases.length).toBe(3));
    expect(peak).toBe(3);
    // release all in a loop until every upload resolved
    await waitFor(() => {
      releases.splice(0).forEach((r) => r());
      expect(api.uploadEssay).toHaveBeenCalledTimes(5);
    });
    await waitFor(() => {
      releases.splice(0).forEach((r) => r());
      expect(screen.getAllByText('Complete').length).toBe(5);
    });
    expect(peak).toBe(3);
  });

  it('blocks and shows UpgradeModal when files exceed quota.max_batch_files', async () => {
    const spy = vi.spyOn(api, 'uploadEssay');
    const user = makeUser('user', 'pro', { quota: { ...QUOTA_BY_TIER.pro, max_batch_files: 2 } });
    const { container } = renderWithProviders(<BatchUploadPage />, { user });
    addFiles(container, [pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')]);
    fireEvent.click(screen.getByRole('button', { name: /start verification/i }));
    await waitFor(() => expect(screen.getByTestId('upgrade-modal')).toBeDefined());
    expect(screen.getByTestId('batch-quota-errors').textContent).toMatch(/up to 2 files per batch/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('blocks oversized files against quota.max_file_size_mb', async () => {
    const spy = vi.spyOn(api, 'uploadEssay');
    const { container } = renderWithProviders(<BatchUploadPage />, { user: makeUser('user', 'pro') });
    addFiles(container, [pdf('huge.pdf', 26)]);
    fireEvent.click(screen.getByRole('button', { name: /start verification/i }));
    await waitFor(() =>
      expect(screen.getByTestId('batch-quota-errors').textContent).toMatch(/huge\.pdf.*25 MB/),
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('blocks when remaining monthly uploads are fewer than queued files', async () => {
    const spy = vi.spyOn(api, 'uploadEssay');
    const user = makeUser('user', 'pro', {
      quota: { ...QUOTA_BY_TIER.pro, monthly_uploads_used: 49, monthly_uploads_remaining: 1 },
    });
    const { container } = renderWithProviders(<BatchUploadPage />, { user });
    addFiles(container, [pdf('a.pdf'), pdf('b.pdf')]);
    fireEvent.click(screen.getByRole('button', { name: /start verification/i }));
    await waitFor(() =>
      expect(screen.getByTestId('batch-quota-errors').textContent).toMatch(/Only 1 monthly checks remain/),
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('admin bypasses plan pre-checks', async () => {
    vi.spyOn(api, 'uploadEssay').mockResolvedValue({ essay_id: 1 } as never);
    vi.spyOn(api, 'getEssayStatus').mockResolvedValue(completed);
    const admin = makeUser('admin', 'ultra', {
      quota: { ...QUOTA_BY_TIER.ultra, max_batch_files: 1, monthly_uploads_remaining: 0 },
    });
    const { container } = renderWithProviders(<BatchUploadPage />, { user: admin });
    addFiles(container, [pdf('a.pdf'), pdf('b.pdf')]);
    fireEvent.click(screen.getByRole('button', { name: /start verification/i }));
    await waitFor(() => expect(api.uploadEssay).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('batch-quota-errors')).toBeNull();
  });

  it('advertises PDF & DOCX support in both languages', async () => {
    const { unmount } = renderWithProviders(<BatchUploadPage />, { user: makeUser('teacher') });
    expect(screen.getAllByText(/PDF & DOCX/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\.bib, \.ris/i).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/PDF Only/i);
    unmount();
    await i18n.changeLanguage('vi');
    renderWithProviders(<BatchUploadPage />, { user: makeUser('teacher') });
    expect(screen.getAllByText(/PDF & DOCX/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\.bib, \.ris/i).length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain('3 LUỒNG XỬ LÝ SONG SONG');
  });

  it('does not auto-redirect on mixed success/failure batch and retries failed file immediately', async () => {
    let shouldFailSecond = true;
    vi.spyOn(api, 'uploadEssay').mockImplementation(async (file: File) => {
      if (file.name === 'bad.pdf' && shouldFailSecond) {
        throw new Error('Corrupted PDF file');
      }
      return { essay_id: file.name === 'good.pdf' ? 201 : 202 } as never;
    });
    vi.spyOn(api, 'getEssayStatus').mockResolvedValue(completed);

    const { container } = renderWithProviders(<BatchUploadPage />, { user: makeUser('user', 'pro') });
    addFiles(container, [pdf('good.pdf'), pdf('bad.pdf')]);
    fireEvent.click(screen.getByRole('button', { name: /start verification/i }));

    await waitFor(() => {
      expect(screen.getByText('Complete')).toBeDefined();
      expect(screen.getByText(/Corrupted PDF file/)).toBeDefined();
    });

    // Must stay on page and NOT show "All files processed — opening report…" while a file failed
    expect(screen.queryByText(/opening report/i)).toBeNull();

    // Clicking Retry after the batch finished must immediately re-run the failed item
    shouldFailSecond = false;
    const retryBtn = screen.getByTitle(/retry/i);
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getAllByText('Complete').length).toBe(2);
    });
  });
});
