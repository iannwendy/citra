import { test, expect, type Page } from '@playwright/test';

/**
 * E2E + Responsive Suite: Background Verification Progress Persistence
 *
 * Verifies:
 * 1. "Kiểm Tra Mới" (Single Check) preserves & restores live ProcessingPage UI
 *    when switching to other web sections (/dashboard, /history) and returning,
 *    supports "Kiểm tra tài liệu khác" (/upload?new=1), survives F5 reload,
 *    and displays background completion banner.
 * 2. "Kiểm Tra Hàng Loạt" (Batch Check) keeps its queue & concurrent worker pool
 *    alive across tab switches, updates sidebar badge live, survives F5 reload,
 *    and restores completed list without unexpected auto-redirects.
 * 3. Full Responsive Matrix across Mobile (375x812, 414x896), Tablet (768x1024,
 *    1024x768), and Desktop (1440x900) — zero horizontal overflow even with
 *    long unbroken filenames, plus interactive mobile sticky header progress pill
 *    and slide-over drawer badges on 375x812.
 */

const PRO_USER = {
  id: 10,
  username: 'pro_researcher',
  role: 'user',
  email: 'researcher@citra.edu.vn',
  full_name: 'Nguyễn Minh Khoa',
  is_active: true,
  avatar_url: null,
  last_login_at: '2026-11-06T08:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  institution: 'ĐHQG TP.HCM',
  can_override_verdicts: false,
  plan_tier: 'pro',
  billing_cycle: 'monthly',
  subscription_status: 'active',
  cancel_at_period_end: false,
  current_period_end: '2026-12-06T00:00:00Z',
  quota: {
    monthly_uploads_used: 3,
    monthly_uploads_limit: 50,
    monthly_uploads_remaining: 47,
    max_file_size_mb: 25,
    max_pages_per_pdf: 100,
    max_citations_per_essay: 200,
    max_batch_files: 10,
    allowed_export_formats: ['json', 'csv', 'pdf', 'docx'],
    allow_batch_upload: true,
    allow_deep_inspector: true,
    allow_serpapi_fallback: false,
    quota_reset_at: '2026-12-01T00:00:00Z',
  },
};

const VIEWPORTS = [
  { name: 'Mobile Small (375x812)', width: 375, height: 812 },
  { name: 'Mobile Large (414x896)', width: 414, height: 896 },
  { name: 'Tablet Portrait (768x1024)', width: 768, height: 1024 },
  { name: 'Tablet Landscape (1024x768)', width: 1024, height: 768 },
  { name: 'Desktop (1440x900)', width: 1440, height: 900 },
] as const;

interface MockEssayStatus {
  status: 'queued' | 'processing' | 'completed' | 'failed';
  queue_position: number | null;
  step: string;
  step_index: number;
  total_steps: number;
  message: string;
  citations_found: number;
  references_found: number;
  linked: number;
  sources_queried: Record<string, string>;
  elapsed_seconds: number;
  finished_at: number | null;
  error: string | null;
}

function buildStatus(overrides: Partial<MockEssayStatus> = {}): MockEssayStatus {
  return {
    status: 'processing',
    queue_position: null,
    step: 'retrieving',
    step_index: 4,
    total_steps: 8,
    message: 'Đang truy vấn Crossref & OpenAlex...',
    citations_found: 24,
    references_found: 21,
    linked: 20,
    sources_queried: {
      crossref: 'done',
      openalex: 'running',
      semantic_scholar: 'pending',
    },
    elapsed_seconds: 5.4,
    finished_at: null,
    error: null,
    ...overrides,
  };
}

function buildReport(essayId: number, filename: string) {
  return {
    essay_id: essayId,
    filename,
    num_pages: 14,
    num_citations: 24,
    style_profile: {
      style: 'APA_LIKE',
      confidence: 0.96,
      apa_count: 22,
      ieee_count: 1,
      mixed_count: 1,
      features: {},
      ratios: {},
      explanation: 'Most citations follow APA format',
    },
    linking_summary: {
      matched: 23,
      missing_reference: 1,
      uncited_reference: 0,
      in_text_mismatch: 0,
      duplicate_reference: 0,
      ambiguous_mapping: 0,
      style_inconsistent: 0,
      unresolved: 0,
    },
    verdicts: [],
    cis: {
      score: 95.8,
      components: {
        verified_ratio: 0.96,
        metadata_accuracy: 0.97,
        in_text_bib_consistency: 0.95,
        format_consistency: 0.94,
        identifier_validity: 0.96,
      },
      weights_used: {},
      num_citations: 24,
      num_unresolved: 1,
      disclaimer: 'Decision support tool.',
    },
    disclaimer: 'Decision support tool.',
  };
}

async function assertNoHorizontalOverflow(page: Page, contextLabel: string) {
  const metrics = await page.evaluate(() => {
    const docWidth = document.documentElement.scrollWidth;
    const winWidth = window.innerWidth;
    const main = document.getElementById('main-content');
    const mainScrollWidth = main ? main.scrollWidth : 0;
    const mainClientWidth = main ? main.clientWidth : 0;
    const mainOverflow = main ? mainScrollWidth > mainClientWidth + 1 : false;
    return {
      docWidth,
      winWidth,
      mainScrollWidth,
      mainClientWidth,
      hasOverflow: docWidth > winWidth + 1 || mainOverflow,
    };
  });

  expect(
    metrics.hasOverflow,
    `Horizontal overflow detected at ${contextLabel}: doc=${metrics.docWidth}/${metrics.winWidth}, main=${metrics.mainScrollWidth}/${metrics.mainClientWidth}`,
  ).toBe(false);
}

interface MockServerController {
  statuses: Map<number, MockEssayStatus>;
  filenames: Map<number, string>;
  setNextEssayId: (id: number) => void;
}

async function setupMockBackend(page: Page): Promise<MockServerController> {
  const statuses = new Map<number, MockEssayStatus>();
  const filenames = new Map<number, string>();
  let nextEssayId = 77;

  await page.context().addInitScript(
    ({ token, user }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.setItem('i18nextLng', 'vi');
    },
    { token: 'mock-jwt-pro-token', user: PRO_USER },
  );

  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(PRO_USER),
    }),
  );

  await page.route('**/api/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(PRO_USER),
    }),
  );

  await page.route('**/api/teacher/enrolled-classes', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }),
  );

  await page.route('**/api/teacher/classes', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }),
  );

  await page.route('**/api/essays/stats', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        total_essays: 4,
        total_citations: 120,
        avg_cis: 93.4,
        verified_ratio: 0.94,
      }),
    }),
  );

  // Status polling endpoint: GET /api/essays/:id/status
  await page.route(/\/api\/essays\/(\d+)\/status$/, (route) => {
    const match = route.request().url().match(/\/api\/essays\/(\d+)\/status$/);
    const id = match ? Number(match[1]) : 77;
    const snap = statuses.get(id) ?? buildStatus();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(snap),
    });
  });

  // Essay report endpoint: GET /api/essays/:id or /api/essays/:id/report
  await page.route(/\/api\/essays\/(\d+)(\/report)?$/, (route) => {
    if (route.request().method() !== 'GET') {
      return route.continue();
    }
    const match = route
      .request()
      .url()
      .match(/\/api\/essays\/(\d+)(?:\/report)?$/);
    const id = match ? Number(match[1]) : 77;
    const snap = statuses.get(id);
    if (snap && snap.status !== 'completed') {
      return route.fulfill({
        status: 425,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Analysis still in progress' }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        buildReport(id, filenames.get(id) ?? `Document_${id}.pdf`),
      ),
    });
  });

  // Upload & list endpoint: POST / GET /api/essays
  await page.route(/\/api\/essays(\?.*)?$/, async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      const id = nextEssayId++;
      // Extract filename from multipart payload if present
      const postBuffer = req.postDataBuffer();
      let extractedName = `Uploaded_${id}.pdf`;
      if (postBuffer) {
        const textSample = postBuffer.toString('utf8', 0, Math.min(postBuffer.length, 2048));
        const fnMatch = textSample.match(/filename="([^"]+)"/);
        if (fnMatch?.[1]) {
          extractedName = fnMatch[1];
        }
      }
      filenames.set(id, extractedName);
      if (!statuses.has(id)) {
        statuses.set(id, buildStatus());
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          essay_id: id,
          filename: extractedName,
          num_pages: 14,
          num_citations: 0,
          summary: { status: statuses.get(id)?.status ?? 'processing' },
        }),
      });
    }

    // GET /api/essays
    const items = Array.from(filenames.entries()).map(([id, filename]) => ({
      id,
      filename,
      num_pages: 14,
      num_citations: 24,
      cis_score: 95.8,
      status: statuses.get(id)?.status ?? 'processing',
      uploaded_at: '2026-11-06T09:00:00Z',
      user_id: PRO_USER.id,
    }));
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(items),
    });
  });

  return {
    statuses,
    filenames,
    setNextEssayId: (id: number) => {
      nextEssayId = id;
    },
  };
}

function dummyPdfPayload(name: string) {
  return {
    name,
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF'),
  };
}

test.describe('Background Verification Progress Persistence (E2E + Responsive)', () => {
  test('Single Check ("Kiểm tra mới") restores live ProcessingPage across tab switches, F5 reload, ?new=1, and background completion', async ({
    page,
  }) => {
    const server = await setupMockBackend(page);
    server.setNextEssayId(77);
    server.statuses.set(
      77,
      buildStatus({
        status: 'processing',
        step: 'retrieving',
        step_index: 4,
      }),
    );

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/upload');

    const longFilename = 'Luan_Van_Thac_Si_Kiem_Chung_Trich_Dan_2026.pdf';
    await page.locator('input[type="file"]').setInputFiles(dummyPdfPayload(longFilename));
    await page.getByRole('button', { name: /Bắt đầu xác minh/i }).click();

    // 1. Landed on ProcessingPage with filename badge & "Check Another File" button
    await expect(page).toHaveURL(/\/verification\/processing\/77$/);
    await expect(page.getByTestId('processing-filename-badge')).toContainText(longFilename);
    await expect(page.getByTestId('processing-new-upload-btn')).toBeVisible();

    const sidebarNav = page.getByRole('navigation');

    // 2. Navigate away to Dashboard & History while analysis continues in background
    await sidebarNav.getByRole('link', { name: /Bảng điều khiển/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId('sidebar-single-progress-badge')).toBeVisible();
    await expect(page.getByTestId('sidebar-single-progress-badge')).toContainText('50%');

    // Update backend step to 'comparing' (step index 5 -> 63%) while user is on History
    server.statuses.set(
      77,
      buildStatus({
        status: 'processing',
        step: 'comparing',
        step_index: 5,
      }),
    );
    await sidebarNav.getByRole('link', { name: /Lịch sử/i }).click();
    await expect(page).toHaveURL(/\/history$/);
    await expect(page.getByTestId('sidebar-single-progress-badge')).toContainText('63%');

    // 3. Click "Kiểm tra mới" (/upload) -> AUTOMATICALLY restores live ProcessingPage!
    await sidebarNav.getByRole('link', { name: /Kiểm tra mới/i }).click();
    await expect(page).toHaveURL(/\/verification\/processing\/77$/);
    await expect(page.getByTestId('processing-filename-badge')).toContainText(longFilename);

    // 4. Test F5 browser reload while on Dashboard -> sessionStorage hydrates & restores
    await sidebarNav.getByRole('link', { name: /Bảng điều khiển/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.reload();
    await expect(page.getByTestId('sidebar-single-progress-badge')).toBeVisible();

    await sidebarNav.getByRole('link', { name: /Kiểm tra mới/i }).click();
    await expect(page).toHaveURL(/\/verification\/processing\/77$/);

    // 5. Click "Kiểm tra tài liệu khác" (?new=1) -> opens UploadPage dropzone + active banner
    await page.getByTestId('processing-new-upload-btn').click();
    await expect(page).toHaveURL(/\/upload\?new=1$/);
    await expect(page.getByTestId('active-single-check-banner')).toBeVisible();
    await expect(page.getByTestId('active-single-check-banner')).toContainText(longFilename);
    await expect(page.locator('input[type="file"]')).toBeAttached();

    // 6. Switch back to Dashboard and let pipeline complete in background
    await sidebarNav.getByRole('link', { name: /Bảng điều khiển/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    server.statuses.set(
      77,
      buildStatus({
        status: 'completed',
        step: 'done',
        step_index: 7,
        finished_at: Math.floor(Date.now() / 1000),
      }),
    );

    await expect(page.getByTestId('sidebar-single-progress-badge')).toHaveCount(0);

    // 7. Return to "Kiểm tra mới" -> shows recent completion banner with direct report link
    await sidebarNav.getByRole('link', { name: /Kiểm tra mới/i }).click();
    await expect(page).toHaveURL(/\/upload$/);
    await expect(page.getByTestId('recent-single-check-banner')).toBeVisible();
    await expect(page.getByTestId('recent-single-check-banner')).toContainText(longFilename);

    // Clicking "Mở báo cáo" navigates to report & clears the banner on subsequent visits
    await page
      .getByTestId('recent-single-check-banner')
      .getByRole('link', { name: /Mở báo cáo/i })
      .click();
    await expect(page).toHaveURL(/\/verification\/report\/77$/);

    await sidebarNav.getByRole('link', { name: /Kiểm tra mới/i }).click();
    await expect(page.getByTestId('recent-single-check-banner')).toHaveCount(0);
  });

  test('Batch Check ("Kiểm tra hàng loạt") keeps worker pool & progress alive across tab switches, F5 reload, and background completion', async ({
    page,
  }) => {
    const server = await setupMockBackend(page);
    server.setNextEssayId(201);

    // File 201 completes immediately; 202, 203, 204 stay processing until we flip them
    server.statuses.set(
      201,
      buildStatus({ status: 'completed', step: 'done', step_index: 8 }),
    );
    server.statuses.set(
      202,
      buildStatus({ status: 'processing', step: 'extracting', step_index: 2 }),
    );
    server.statuses.set(
      203,
      buildStatus({ status: 'processing', step: 'linking', step_index: 3 }),
    );
    server.statuses.set(
      204,
      buildStatus({ status: 'processing', step: 'checking', step_index: 6 }),
    );

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/batch-upload');

    await page.locator('input[type="file"]').setInputFiles([
      dummyPdfPayload('Batch_Manuscript_01.pdf'),
      dummyPdfPayload('Batch_Manuscript_02.pdf'),
      dummyPdfPayload('Batch_Manuscript_03.pdf'),
      dummyPdfPayload('Batch_Manuscript_04.pdf'),
    ]);

    await page.getByRole('button', { name: /Bắt đầu xác minh/i }).click();
    await expect(page.getByTestId('batch-background-active-banner')).toBeVisible();

    const sidebarNav = page.getByRole('navigation');

    // Wait until essay 201 finishes so badge reads 1/4
    await expect(page.getByTestId('sidebar-batch-progress-badge')).toContainText('1/4');

    // Switch away to Dashboard & Settings while remaining 3 essays are still processing
    await sidebarNav.getByRole('link', { name: /Bảng điều khiển/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId('sidebar-batch-progress-badge')).toContainText('1/4');

    // Complete essay 202 while user is on Settings!
    server.statuses.set(
      202,
      buildStatus({ status: 'completed', step: 'done', step_index: 8 }),
    );
    await sidebarNav.getByRole('link', { name: /Cài đặt/i }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId('sidebar-batch-progress-badge')).toContainText('2/4');

    // Return to "Kiểm tra hàng loạt" -> full file queue & live statuses are intact!
    await sidebarNav.getByRole('link', { name: /Kiểm tra hàng loạt/i }).click();
    await expect(page).toHaveURL(/\/batch-upload$/);
    await expect(page.getByTestId('batch-background-active-banner')).toBeVisible();
    await expect(page.getByText('Batch_Manuscript_01.pdf')).toBeVisible();
    await expect(page.getByText('Batch_Manuscript_04.pdf')).toBeVisible();

    // Reload browser (F5) mid-batch -> sessionStorage restores all 4 files & resumes polling 203 & 204
    await page.reload();
    await expect(page.getByText('Batch_Manuscript_01.pdf')).toBeVisible();
    await expect(page.getByText('Batch_Manuscript_04.pdf')).toBeVisible();
    await expect(page.getByTestId('sidebar-batch-progress-badge')).toContainText('2/4');

    // Switch back to Dashboard and let 203 & 204 finish in background
    await sidebarNav.getByRole('link', { name: /Bảng điều khiển/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    server.statuses.set(
      203,
      buildStatus({ status: 'completed', step: 'done', step_index: 8 }),
    );
    server.statuses.set(
      204,
      buildStatus({ status: 'completed', step: 'done', step_index: 8 }),
    );

    await expect(page.getByTestId('sidebar-batch-progress-badge')).toHaveCount(0);

    // Return to /batch-upload -> shows all 4 completed + background completion notice WITHOUT auto-redirecting away
    await sidebarNav.getByRole('link', { name: /Kiểm tra hàng loạt/i }).click();
    await expect(page).toHaveURL(/\/batch-upload$/);
    await expect(page.getByTestId('batch-background-completed-notice')).toBeVisible();
    await expect(page.getByText('Batch_Manuscript_01.pdf')).toBeVisible();
    await expect(page.getByText('Batch_Manuscript_04.pdf')).toBeVisible();

    // Ensure no delayed auto-redirect hijacks the user after 1.5s
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/\/batch-upload$/);
  });

  test('Mobile 375x812 interactive drawer badges & sticky header progress pill restore active progress cleanly', async ({
    page,
  }) => {
    const server = await setupMockBackend(page);
    server.setNextEssayId(88);
    server.statuses.set(
      88,
      buildStatus({
        status: 'processing',
        step: 'retrieving',
        step_index: 4,
      }),
    );

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/upload');

    const superLongUnbrokenName =
      'SuperLongUnbrokenAcademicManuscriptFileName_2026_Final_Revised_Submission_v12.pdf';
    await page
      .locator('input[type="file"]')
      .setInputFiles(dummyPdfPayload(superLongUnbrokenName));
    await page.getByRole('button', { name: /Bắt đầu xác minh/i }).click();

    await expect(page).toHaveURL(/\/verification\/processing\/88$/);
    await expect(page.getByTestId('processing-filename-badge')).toBeVisible();
    await assertNoHorizontalOverflow(page, 'ProcessingPage @ 375x812 (long filename)');

    // Open mobile navigation drawer -> verify live badge on "Kiểm tra mới" -> tap "Bảng điều khiển"
    await page.getByRole('button', { name: 'Open navigation menu' }).click();
    await expect(page.getByTestId('sidebar-single-progress-badge')).toBeVisible();
    await page.getByRole('link', { name: /Bảng điều khiển/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    // Sticky mobile header bar displays compact progress pill within 375px bounds
    const mobilePill = page.getByTestId('mobile-active-progress-pill');
    await expect(mobilePill).toBeVisible();
    await expect(mobilePill).toContainText('50%');

    const box = await mobilePill.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(375);
    }
    await assertNoHorizontalOverflow(page, 'Dashboard with mobile-active-progress-pill @ 375x812');

    // Tapping the mobile sticky progress pill immediately restores ProcessingPage!
    await mobilePill.click();
    await expect(page).toHaveURL(/\/verification\/processing\/88$/);
    await expect(page.getByTestId('processing-filename-badge')).toBeVisible();
  });

  for (const vp of VIEWPORTS) {
    test(`Zero horizontal overflow across all progress banners, badges & batch states at ${vp.name}`, async ({
      page,
    }) => {
      const server = await setupMockBackend(page);
      server.statuses.set(
        95,
        buildStatus({
          status: 'queued',
          queue_position: 3,
          step: 'parsing',
          step_index: 0,
        }),
      );
      server.statuses.set(
        301,
        buildStatus({ status: 'processing', step: 'comparing', step_index: 5 }),
      );

      // Pre-seed sessionStorage with long filenames for both Single Check and Batch Check
      await page.context().addInitScript((userId: number) => {
        sessionStorage.setItem(
          `citra_single_check_v1_${userId}`,
          JSON.stringify({
            essayId: 95,
            filename:
              'Very_Long_Unbroken_Single_Check_Dissertation_Title_For_Overflow_Stress_Test_2026.pdf',
            fileSize: 524288,
            classId: null,
            status: 'queued',
            step: 'parsing',
            stepIndex: 0,
            totalSteps: 8,
            progress: 0,
            message: 'Queued (#3)',
            queuePosition: 3,
            error: null,
            startedAt: Date.now(),
            acknowledged: false,
          }),
        );
        sessionStorage.setItem(
          `citra_batch_check_v1_${userId}`,
          JSON.stringify({
            savedAt: Date.now(),
            targetClassId: null,
            hasAutoNavigated: false,
            files: [
              {
                id: 'resp-batch-1',
                fileName:
                  'Batch_Long_Unbroken_Paper_Identifier_0001_Deep_Citation_Verification.pdf',
                fileSize: 204800,
                status: 'completed',
                progress: 100,
                essayId: 300,
              },
              {
                id: 'resp-batch-2',
                fileName:
                  'Batch_Long_Unbroken_Paper_Identifier_0002_Neuro_Symbolic_Verification.pdf',
                fileSize: 307200,
                status: 'processing',
                progress: 63,
                essayId: 301,
              },
            ],
          }),
        );
      }, PRO_USER.id);

      await page.setViewportSize({ width: vp.width, height: vp.height });

      // 1. Dashboard (mobile pill on <1024px, desktop sidebar badges on >=1024px)
      await page.goto('/dashboard');
      if (vp.width < 1024) {
        await expect(page.getByTestId('mobile-active-progress-pill')).toBeVisible();
      } else {
        await expect(page.getByTestId('sidebar-single-progress-badge')).toBeVisible();
        await expect(page.getByTestId('sidebar-batch-progress-badge')).toBeVisible();
      }
      await assertNoHorizontalOverflow(page, `/dashboard @ ${vp.name}`);

      // 2. Auto-restored ProcessingPage (via /upload)
      await page.goto('/upload');
      await expect(page).toHaveURL(/\/verification\/processing\/95$/);
      await expect(page.getByTestId('processing-filename-badge')).toBeVisible();
      await expect(page.getByTestId('processing-new-upload-btn')).toBeVisible();
      await assertNoHorizontalOverflow(page, `/verification/processing/95 @ ${vp.name}`);

      // 3. UploadPage ?new=1 with active-single-check-banner
      await page.goto('/upload?new=1');
      await expect(page.getByTestId('active-single-check-banner')).toBeVisible();
      await assertNoHorizontalOverflow(page, `/upload?new=1 @ ${vp.name}`);

      // 4. Active BatchUploadPage with batch-background-active-banner
      await page.goto('/batch-upload');
      await expect(page.getByTestId('batch-background-active-banner')).toBeVisible();
      await assertNoHorizontalOverflow(page, `/batch-upload (active) @ ${vp.name}`);
    });
  }
});
