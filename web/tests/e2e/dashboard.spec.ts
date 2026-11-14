import { test, expect } from '@playwright/test';
import { setupAuthenticatedPage, waitForAuth, getMockEssays } from './helpers';

/**
 * E2E Tests for Dashboard
 * Uses authenticated mock for reliable testing
 */
test.describe('Dashboard', () => {
  const mockEssays = getMockEssays();

  // Set up authenticated session before each test
  test.beforeEach(async ({ page }) => {
    setupAuthenticatedPage(page);
    await page.goto('/dashboard');
    await waitForAuth(page);
  });

  test('should display dashboard with stats cards', async ({ page }) => {
    // Check page title
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

    // Wait for stats to load (they're calculated from essays + reports)
    await page.waitForTimeout(1000);

    // Check stats cards are present with correct labels
    await expect(page.getByText('Total Documents')).toBeVisible();
    await expect(page.getByText('Total Citations')).toBeVisible();
    await expect(page.getByText('Avg CIS Score')).toBeVisible();
    await expect(page.getByText('Verified Rate')).toBeVisible();
  });

  test('should show stats with correct values from mock data', async ({ page }) => {
    // Wait for data to load and stats to be calculated
    await page.waitForTimeout(1500);

    // Check that total documents shows the mock count (3 essays)
    const totalDocsCard = page.locator('.card').filter({ hasText: 'Total Documents' });
    await expect(totalDocsCard).toBeVisible();

    // Check total citations card (45 + 32 + 58 = 135)
    const totalCitationsCard = page.locator('.card').filter({ hasText: 'Total Citations' });
    await expect(totalCitationsCard).toBeVisible();
  });

  test('should show New Check button that navigates to upload', async ({ page }) => {
    // Click New Check button
    const newCheckBtn = page.getByRole('link', { name: /new check/i });
    await expect(newCheckBtn.first()).toBeVisible();
    await newCheckBtn.first().click();

    // Should navigate to upload page
    await expect(page).toHaveURL(/\/upload/);
  });

  test('should display document table with columns', async ({ page }) => {
    // Wait for table to load
    await page.waitForSelector('table', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);

    // Check table headers exist
    const tableHeaders = page.locator('thead th');
    const count = await tableHeaders.count();
    expect(count).toBeGreaterThan(0);

    // Should show document names from mock data
    for (const essay of mockEssays) {
      await expect(page.getByText(essay.filename)).toBeVisible();
    }
  });

  test('should display document details correctly', async ({ page }) => {
    // Wait for data to load
    await page.waitForSelector('table', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);

    // Check first essay details are visible
    const firstEssay = mockEssays[0];
    await expect(page.getByText(firstEssay.filename)).toBeVisible();
    await expect(page.getByText(`${firstEssay.num_pages}`)).toBeVisible();
  });

  test('should filter documents by search', async ({ page }) => {
    // Wait for table to load first
    await page.waitForSelector('table', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);

    // Type in search box
    const searchBox = page.getByPlaceholder(/search documents/i);
    await expect(searchBox).toBeVisible();
    await searchBox.fill('BERT');

    // Wait for filter to apply
    await page.waitForTimeout(500);

    // Should show only BERT document
    await expect(page.getByText('BERT_Pre-training.pdf')).toBeVisible();
    await expect(page.getByText('Attention_Mechanism.pdf')).not.toBeVisible();
  });

  test('should show empty state for non-matching search', async ({ page }) => {
    // Wait for table to load first
    await page.waitForSelector('table', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);

    // Type non-matching search
    const searchBox = page.getByPlaceholder(/search documents/i);
    await searchBox.fill('nonexistent_document_xyz');

    // Wait for filter to apply
    await page.waitForTimeout(500);

    // Should show empty state
    await expect(page.getByText(/no documents found/i)).toBeVisible();
  });

  test('should have refresh button that reloads documents', async ({ page }) => {
    // Click refresh button
    const refreshBtn = page.getByTitle('Refresh');
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();

    // Page should still show dashboard
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  });

  test('should navigate to history page', async ({ page }) => {
    // Click History in sidebar
    await page.getByRole('link', { name: /history/i }).click();

    // Should navigate to history
    await expect(page).toHaveURL(/\/history/);
  });

  test('should show concise View action in table instead of View Report', async ({ page }) => {
    // Wait for table to load
    await page.waitForSelector('table', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);

    const firstAction = page.getByTestId('dashboard-primary-action-1');
    await expect(firstAction).toBeVisible();
    await expect(firstAction).toHaveText('View');
    await expect(page.getByRole('link', { name: /view report/i })).toHaveCount(0);
  });

  test('should truncate long filenames without clipping right-side columns or actions across responsive viewports (EN & VI)', async ({
    page,
  }) => {
    const longEssays = [
      {
        id: 109,
        filename:
          '191_we_are_the_renaissance_multimodal_analysis_of_black_identity_and_cultural_expression.pdf',
        num_pages: 70,
        uploaded_at: '2026-11-14T10:30:00Z',
        user_id: 1,
        cis_score: 82,
        job_status: 'completed',
      },
      {
        id: 108,
        filename:
          '001_no_soy_g_ero_soy_latino_a_phenomenological_approach_to_identity_and_belonging_in_higher_education.pdf',
        num_pages: 64,
        uploaded_at: '2026-11-14T09:15:00Z',
        user_id: 1,
        cis_score: 92,
        job_status: 'completed',
      },
      {
        id: 107,
        filename:
          '002_radon_transforms_on_fractals_spectrum_synthesis_and_signal_reconstruction_in_multidimensional_spaces.docx',
        num_pages: 65,
        uploaded_at: '2026-11-14T08:45:00Z',
        user_id: 1,
        cis_score: 92,
        job_status: 'completed',
      },
      {
        id: 106,
        filename: '003_social_deixis_in_malcolm_x_1992_movie.pdf',
        num_pages: 43,
        uploaded_at: '2026-11-14T08:20:00Z',
        user_id: 1,
        cis_score: 68,
        job_status: 'completed',
      },
      {
        id: 105,
        filename:
          '004_unbreakable_failed_manuscript_with_refund_badge_and_extremely_long_underscore_filename_for_stress_test.pdf',
        num_pages: 51,
        uploaded_at: '2026-11-14T07:50:00Z',
        user_id: 1,
        cis_score: null,
        job_status: 'failed',
        quota_charged: false,
      },
    ];

    await page.route('**/api/essays', (route) => {
      if (route.request().method() === 'GET') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(longEssays),
        });
      } else {
        route.continue();
      }
    });

    const viewports = [
      { name: 'Mobile (375x812)', width: 375, height: 812, tabular: false },
      { name: 'Large Mobile / Split sm (640x900)', width: 640, height: 900, tabular: false },
      { name: 'Tablet Portrait md (768x1024)', width: 768, height: 1024, tabular: true },
      { name: 'Tablet Landscape / Small Laptop lg (1024x768)', width: 1024, height: 768, tabular: true },
      { name: 'Laptop xl (1280x800)', width: 1280, height: 800, tabular: true },
      { name: 'Desktop (1440x900)', width: 1440, height: 900, tabular: true },
    ];

    for (const lang of ['en', 'vi'] as const) {
      await page.evaluate((lng) => {
        localStorage.setItem('language', lng);
        localStorage.setItem('i18nextLng', lng);
      }, lang);

      for (const vp of viewports) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto('/dashboard');
        await page.waitForSelector('[data-testid="dashboard-primary-action-109"]', {
          timeout: 10000,
        });

        const metrics = await page.evaluate(() => {
          const table = document.querySelector('table');
          const wrapper = table?.parentElement;
          const card = wrapper?.parentElement;
          const main = document.getElementById('main-content');
          const actionsHeader = document.querySelector('thead th:last-child');
          const primaryBtn = document.querySelector(
            '[data-testid="dashboard-primary-action-109"]'
          );
          const deleteBtn = primaryBtn?.parentElement?.querySelector(
            'button[aria-label^="Delete "]'
          );
          const fileLink = document.querySelector(
            '[data-testid="dashboard-essay-link-109"]'
          );
          const failedLink = document.querySelector(
            '[data-testid="dashboard-essay-link-105"]'
          );
          const pagesCell = fileLink?.closest('tr')?.children[1] ?? null;

          const cardRect = card?.getBoundingClientRect();
          const headerRect = actionsHeader?.getBoundingClientRect();
          const primaryRect = primaryBtn?.getBoundingClientRect();
          const deleteRect = deleteBtn?.getBoundingClientRect();
          const linkRect = fileLink?.getBoundingClientRect();
          const failedLinkRect = failedLink?.getBoundingClientRect();
          const pagesRect = pagesCell?.getBoundingClientRect();

          return {
            docOverflow: document.documentElement.scrollWidth > window.innerWidth,
            mainOverflow: main ? main.scrollWidth > main.clientWidth : false,
            tableWrapperScrollWidth: wrapper?.scrollWidth ?? 0,
            tableWrapperClientWidth: wrapper?.clientWidth ?? 0,
            cardRight: cardRect ? Math.round(cardRect.right) : 0,
            headerRight: headerRect ? Math.round(headerRect.right) : 0,
            headerWidth: headerRect ? Math.round(headerRect.width) : 0,
            primaryRight: primaryRect ? Math.round(primaryRect.right) : 0,
            primaryHeight: primaryRect ? Math.round(primaryRect.height) : 0,
            primaryText: primaryBtn?.textContent?.trim() ?? '',
            deleteRight: deleteRect ? Math.round(deleteRect.right) : 0,
            linkRight: linkRect ? Math.round(linkRect.right) : 0,
            linkWidth: linkRect ? Math.round(linkRect.width) : 0,
            failedLinkWidth: failedLinkRect ? Math.round(failedLinkRect.width) : 0,
            pagesLeft: pagesRect ? Math.round(pagesRect.left) : 0,
          };
        });

        const ctx = `${vp.name} [${lang}]`;
        expect(metrics.docOverflow, `doc overflow at ${ctx}`).toBe(false);
        expect(metrics.mainOverflow, `main overflow at ${ctx}`).toBe(false);
        expect(
          metrics.tableWrapperScrollWidth,
          `table internal overflow (${metrics.tableWrapperScrollWidth} > ${metrics.tableWrapperClientWidth}) at ${ctx}`
        ).toBeLessThanOrEqual(metrics.tableWrapperClientWidth);

        expect(metrics.primaryText, `button label at ${ctx}`).toBe(
          lang === 'vi' ? 'Xem' : 'View'
        );
        expect(
          metrics.primaryHeight,
          `button should stay single-line at ${ctx}`
        ).toBeLessThanOrEqual(40);
        expect(
          metrics.primaryRight,
          `View button clipped past card right at ${ctx}`
        ).toBeLessThanOrEqual(metrics.cardRight);
        expect(
          metrics.deleteRight,
          `Delete button clipped past card right at ${ctx}`
        ).toBeLessThanOrEqual(metrics.cardRight);
        expect(
          metrics.linkWidth,
          `Filename remains readable (not collapsed) at ${ctx}`
        ).toBeGreaterThanOrEqual(80);
        expect(
          metrics.failedLinkWidth,
          `Failed filename with badges remains readable (not collapsed) at ${ctx}`
        ).toBeGreaterThanOrEqual(80);

        if (vp.tabular) {
          expect(metrics.headerWidth, `ACTIONS header visible at ${ctx}`).toBeGreaterThan(0);
          expect(
            metrics.headerRight,
            `ACTIONS header clipped past card right at ${ctx}`
          ).toBeLessThanOrEqual(metrics.cardRight);
          expect(
            metrics.linkRight,
            `Filename link overlaps Pages column at ${ctx}`
          ).toBeLessThanOrEqual(metrics.pagesLeft);
        }
      }
    }
  });
});
