import { test, expect, type Page } from '@playwright/test';
import { setupAuthenticatedPage, waitForAuth } from './helpers';

const REALISTIC_ESSAYS = [
  {
    id: 119,
    filename: 'VietDepression_PLOS_ONE.pdf',
    num_pages: 20,
    uploaded_at: '2026-11-16T10:30:00Z',
    user_id: 1,
    cis_score: 99,
    num_citations: 45,
    num_verdicts: 45,
    num_verified: 44,
    job_status: 'completed',
  },
  {
    id: 117,
    filename: 'essay_02_mixed.pdf',
    num_pages: 2,
    uploaded_at: '2026-11-15T14:20:00Z',
    user_id: 1,
    cis_score: 72,
    num_citations: 18,
    num_verdicts: 18,
    num_verified: 13,
    job_status: 'completed',
  },
  {
    id: 114,
    filename:
      '096_uit_vnuhcm_CS114_K21_KHTN_18520166_PhamManhTien_CapstoneProjectReport.pdf',
    num_pages: 8,
    uploaded_at: '2026-11-15T09:00:00Z',
    user_id: 1,
    cis_score: 0,
    num_citations: 12,
    num_verdicts: 12,
    num_verified: 0,
    job_status: 'completed',
  },
  {
    id: 113,
    filename: 'TranThanhPhuoc_523H0002_523H0054.pdf',
    num_pages: 98,
    uploaded_at: '2026-11-14T16:45:00Z',
    user_id: 1,
    cis_score: 85,
    num_citations: 64,
    num_verdicts: 64,
    num_verified: 54,
    job_status: 'completed',
  },
  {
    id: 110,
    filename:
      '190_contract_design_in_venture_capital_incentives_monitoring.pdf',
    num_pages: 41,
    uploaded_at: '2026-11-13T11:15:00Z',
    user_id: 1,
    cis_score: 100,
    num_citations: 52,
    num_verdicts: 52,
    num_verified: 52,
    job_status: 'completed',
  },
  {
    id: 105,
    filename:
      '004_unbreakable_failed_manuscript_with_refund_badge_and_long_filename.pdf',
    num_pages: 51,
    uploaded_at: '2026-11-12T08:00:00Z',
    user_id: 1,
    cis_score: null,
    num_citations: 0,
    num_verdicts: 0,
    num_verified: 0,
    job_status: 'failed',
    quota_charged: false,
  },
];

async function installSortingMocks(page: Page) {
  setupAuthenticatedPage(page);

  await page.route('**/api/essays/stats', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        total_essays: 5,
        total_citations: 191,
        verified: 163,
        metadata_error: 18,
        suspected_hallucination: 6,
        unresolved: 4,
        resource: 0,
      }),
    }),
  );

  await page.route(/\/api\/essays$/, (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(REALISTIC_ESSAYS),
      });
    } else {
      route.continue();
    }
  });
}

async function getDashboardOrderedIds(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid^="dashboard-essay-link-"]'),
    ).map((el) =>
      Number((el.getAttribute('data-testid') || '').replace('dashboard-essay-link-', '')),
    ),
  );
}

async function getHistoryOrderedFilenames(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid="essay-item"]')).map(
      (card) => card.querySelector('p[title]')?.getAttribute('title') ?? '',
    ),
  );
}

test.describe('Dashboard & History Sorting + Full Responsive Matrix', () => {
  test('Dashboard supports dropdown sorting, clickable column headers, aria-sort sync, and search combination', async ({
    page,
  }) => {
    await installSortingMocks(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard');
    await waitForAuth(page);
    await page.waitForSelector('[data-testid="dashboard-essay-link-119"]');

    // Default: date_desc (Newest -> Oldest)
    expect(await getDashboardOrderedIds(page)).toEqual([119, 117, 114, 113, 110, 105]);
    const sortSelect = page.getByTestId('essay-sort-select');
    await expect(sortSelect).toHaveValue('date_desc');
    await expect(page.locator('thead th').nth(3)).toHaveAttribute('aria-sort', 'descending');

    // Alphabet A -> Z via dropdown (004 < 096 < 190 < essay_02 < TranThanhPhuoc < VietDepression)
    await sortSelect.selectOption('name_asc');
    expect(await getDashboardOrderedIds(page)).toEqual([105, 114, 110, 117, 113, 119]);
    await expect(page.locator('thead th').nth(0)).toHaveAttribute('aria-sort', 'ascending');

    // Alphabet Z -> A via dropdown
    await sortSelect.selectOption('name_desc');
    expect(await getDashboardOrderedIds(page)).toEqual([119, 113, 117, 110, 114, 105]);
    await expect(page.locator('thead th').nth(0)).toHaveAttribute('aria-sort', 'descending');

    // CIS High -> Low via dropdown (100, 99, 85, 72, 0, failed null last)
    await sortSelect.selectOption('cis_desc');
    expect(await getDashboardOrderedIds(page)).toEqual([110, 119, 113, 117, 114, 105]);
    await expect(page.locator('thead th').nth(2)).toHaveAttribute('aria-sort', 'descending');

    // CIS Low -> High via dropdown (0/100 first, ..., 100/100, failed null STILL last)
    await sortSelect.selectOption('cis_asc');
    expect(await getDashboardOrderedIds(page)).toEqual([114, 117, 113, 119, 110, 105]);
    await expect(page.locator('thead th').nth(2)).toHaveAttribute('aria-sort', 'ascending');

    // Date Oldest -> Newest via dropdown
    await sortSelect.selectOption('date_asc');
    expect(await getDashboardOrderedIds(page)).toEqual([105, 110, 113, 114, 117, 119]);

    // Clickable column headers sync with dropdown
    await page.getByTestId('dashboard-sort-col-pages').click();
    await expect(sortSelect).toHaveValue('pages_desc');
    expect(await getDashboardOrderedIds(page)).toEqual([113, 105, 110, 119, 114, 117]);

    await page.getByTestId('dashboard-sort-col-pages').click();
    await expect(sortSelect).toHaveValue('pages_asc');
    expect(await getDashboardOrderedIds(page)).toEqual([117, 114, 119, 110, 105, 113]);

    await page.getByTestId('dashboard-sort-col-name').click();
    await expect(sortSelect).toHaveValue('name_asc');
    expect(await getDashboardOrderedIds(page)).toEqual([105, 114, 110, 117, 113, 119]);

    // Combine Search + CIS High -> Low
    await page.getByTestId('dashboard-sort-col-cis').click();
    await expect(sortSelect).toHaveValue('cis_desc');
    const searchInput = page.getByPlaceholder(/search documents/i);
    await searchInput.fill('o');
    // Matches: 110 (100), 119 (99), 113 (85), 114 (0), 105 (failed null) — excludes essay_02_mixed.pdf
    expect(await getDashboardOrderedIds(page)).toEqual([110, 119, 113, 114, 105]);

    await page.getByRole('button', { name: /clear search/i }).click();
    expect(await getDashboardOrderedIds(page)).toEqual([110, 119, 113, 117, 114, 105]);
  });

  test('History supports sorting across date, alphabet, CIS, and pages with rank updates in EN & VI', async ({
    page,
  }) => {
    await installSortingMocks(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/history');
    await waitForAuth(page);
    await page.waitForSelector('[data-testid="essay-item"]');

    const sortSelect = page.getByTestId('essay-sort-select');
    await expect(sortSelect).toHaveValue('date_desc');
    expect((await getHistoryOrderedFilenames(page))[0]).toBe('VietDepression_PLOS_ONE.pdf');

    // Alphabet A -> Z
    await sortSelect.selectOption('name_asc');
    expect(await getHistoryOrderedFilenames(page)).toEqual([
      '004_unbreakable_failed_manuscript_with_refund_badge_and_long_filename.pdf',
      '096_uit_vnuhcm_CS114_K21_KHTN_18520166_PhamManhTien_CapstoneProjectReport.pdf',
      '190_contract_design_in_venture_capital_incentives_monitoring.pdf',
      'essay_02_mixed.pdf',
      'TranThanhPhuoc_523H0002_523H0054.pdf',
      'VietDepression_PLOS_ONE.pdf',
    ]);

    // CIS Low -> High (0/100 becomes #1, failed stays at #6)
    await sortSelect.selectOption('cis_asc');
    const cisAscNames = await getHistoryOrderedFilenames(page);
    expect(cisAscNames[0]).toBe(
      '096_uit_vnuhcm_CS114_K21_KHTN_18520166_PhamManhTien_CapstoneProjectReport.pdf',
    );
    expect(cisAscNames[5]).toBe(
      '004_unbreakable_failed_manuscript_with_refund_badge_and_long_filename.pdf',
    );
    await expect(page.getByTestId('essay-item').first()).toContainText('#1');

    // Verify Vietnamese localization on History
    await page.evaluate(() => {
      localStorage.setItem('language', 'vi');
      localStorage.setItem('i18nextLng', 'vi');
    });
    await page.goto('/history');
    await page.waitForSelector('[data-testid="essay-item"]');
    const viSelect = page.getByTestId('essay-sort-select');
    await expect(viSelect).toContainText('Ngày tải: Mới nhất');
    await viSelect.selectOption('cis_desc');
    expect((await getHistoryOrderedFilenames(page))[0]).toBe(
      '190_contract_design_in_venture_capital_incentives_monitoring.pdf',
    );
  });

  test('Responsive verification: Sort & Search controls and tables never overflow or overlap across Mobile, Tablet, Laptop, and Desktop (EN & VI)', async ({
    page,
  }) => {
    await installSortingMocks(page);

    const viewports = [
      { name: 'Mobile Compact (320x568)', width: 320, height: 568, tabular: false },
      { name: 'Mobile Small (375x812)', width: 375, height: 812, tabular: false },
      { name: 'Mobile Large (414x896)', width: 414, height: 896, tabular: false },
      { name: 'Split sm (640x900)', width: 640, height: 900, tabular: false },
      { name: 'Tablet Portrait md (768x1024)', width: 768, height: 1024, tabular: true },
      { name: 'Tablet Landscape lg (1024x768)', width: 1024, height: 768, tabular: true },
      { name: 'Laptop xl (1280x800)', width: 1280, height: 800, tabular: true },
      { name: 'Desktop (1440x900)', width: 1440, height: 900, tabular: true },
    ] as const;

    for (const lang of ['en', 'vi'] as const) {
      await page.addInitScript((lng) => {
        localStorage.setItem('language', lng);
        localStorage.setItem('i18nextLng', lng);
      }, lang);

      for (const vp of viewports) {
        await page.setViewportSize({ width: vp.width, height: vp.height });

        for (const route of ['/dashboard', '/history'] as const) {
          await page.goto(route);
          if (route === '/dashboard') {
            await page.waitForSelector('[data-testid="dashboard-essay-link-119"]');
          } else {
            await page.waitForSelector('[data-testid="essay-item"]');
          }

          // Actively exercise sorting at this viewport
          const sortSelect = page.getByTestId('essay-sort-select');
          await expect(sortSelect).toBeVisible();
          await sortSelect.selectOption('cis_desc');

          if (route === '/dashboard') {
            expect((await getDashboardOrderedIds(page))[0]).toBe(110);
          } else {
            expect((await getHistoryOrderedFilenames(page))[0]).toBe(
              '190_contract_design_in_venture_capital_incentives_monitoring.pdf',
            );
          }

          const layout = await page.evaluate((currentRoute) => {
            const main = document.getElementById('main-content');
            const selectEl = document.querySelector<HTMLElement>(
              '[data-testid="essay-sort-select"]',
            );
            const searchEl = document.querySelector<HTMLElement>(
              'input[aria-label="Search documents"]',
            );
            const chromeCard = selectEl?.closest('.rounded-2xl');

            const sRect = selectEl?.getBoundingClientRect();
            const qRect = searchEl?.getBoundingClientRect();
            const cRect = chromeCard?.getBoundingClientRect();

            const controlsOverlap =
              sRect && qRect
                ? !(
                    sRect.right <= qRect.left + 1 ||
                    sRect.left >= qRect.right - 1 ||
                    sRect.bottom <= qRect.top + 1 ||
                    sRect.top >= qRect.bottom - 1
                  )
                : false;

            const table =
              currentRoute === '/dashboard' ? document.querySelector('table') : null;
            const tableWrapper = table?.parentElement ?? null;
            const actionsHeader = table?.querySelector('thead th:last-child') ?? null;
            const fileLink = document.querySelector(
              '[data-testid="dashboard-essay-link-114"]',
            );
            const pagesCell = fileLink?.closest('tr')?.children[1] ?? null;

            return {
              docOverflow: document.documentElement.scrollWidth > window.innerWidth,
              mainOverflow: main ? main.scrollWidth > main.clientWidth : false,
              selectHeight: sRect ? Math.round(sRect.height) : 0,
              selectInsideCard:
                sRect && cRect
                  ? Math.round(sRect.left) >= Math.round(cRect.left) &&
                    Math.round(sRect.right) <= Math.round(cRect.right)
                  : false,
              searchInsideCard:
                qRect && cRect
                  ? Math.round(qRect.left) >= Math.round(cRect.left) &&
                    Math.round(qRect.right) <= Math.round(cRect.right)
                  : false,
              controlsOverlap,
              tableOverflow: tableWrapper
                ? tableWrapper.scrollWidth > tableWrapper.clientWidth
                : false,
              headerInsideCard:
                actionsHeader && cRect
                  ? Math.round(actionsHeader.getBoundingClientRect().right) <=
                    Math.round(cRect.right)
                  : true,
              linkNotOverlappingPages:
                fileLink && pagesCell
                  ? Math.round(fileLink.getBoundingClientRect().right) <=
                    Math.round(pagesCell.getBoundingClientRect().left)
                  : true,
            };
          }, route);

          const ctx = `${route} @ ${vp.name} [${lang}]`;
          expect(layout.docOverflow, `docOverflow at ${ctx}`).toBe(false);
          expect(layout.mainOverflow, `mainOverflow at ${ctx}`).toBe(false);
          expect(layout.selectHeight, `select touch height at ${ctx}`).toBeGreaterThanOrEqual(34);
          expect(layout.selectInsideCard, `sort select inside card at ${ctx}`).toBe(true);
          expect(layout.searchInsideCard, `search input inside card at ${ctx}`).toBe(true);
          expect(layout.controlsOverlap, `sort & search overlap at ${ctx}`).toBe(false);

          if (route === '/dashboard' && vp.tabular) {
            expect(layout.tableOverflow, `tableOverflow at ${ctx}`).toBe(false);
            expect(layout.headerInsideCard, `ACTIONS header inside card at ${ctx}`).toBe(true);
            expect(
              layout.linkNotOverlappingPages,
              `filename overlaps Pages column at ${ctx}`,
            ).toBe(true);
          }
        }
      }
    }
  });
});
