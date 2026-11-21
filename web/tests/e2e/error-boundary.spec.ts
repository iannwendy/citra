/**
 * E2E Tests for Error Boundaries
 * Tests error handling and fallback UI
 */
import { test, expect } from '@playwright/test';
import { setupAuthenticatedPage, waitForAuth } from './helpers';

// ============================================================
// Error Boundary Tests
// ============================================================

test.describe('Error Boundary', () => {
  test.beforeEach(async ({ page }) => {
    // Setup authenticated page
    setupAuthenticatedPage(page);
    await page.goto('/dashboard');
    await waitForAuth(page);
  });

  test('should display dashboard without errors', async ({ page }) => {
    // Navigate to dashboard which should load normally
    await page.goto('/dashboard');

    // Dashboard should load without error boundary fallback
    const pageContent = await page.locator('main').first();
    await expect(pageContent).toBeVisible();

    // Should NOT see error fallback
    const errorFallback = page.locator('text=Something went wrong');
    await expect(errorFallback).not.toBeVisible();
  });

  test('should not crash entire app when navigating', async ({ page }) => {
    await page.goto('/dashboard');

    // Verify app is still functional by checking sidebar navigation
    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible();

    // Navigate to other pages to ensure app is still working
    await page.click('text=New Check');
    await expect(page).toHaveURL(/\/upload/);

    // Navigate back
    await page.click('text=Dashboard');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('should handle API errors gracefully', async ({ page }) => {
    await page.goto('/dashboard');

    // Intercept API calls and force failure
    await page.route('**/api/**', (route) => {
      route.abort('failed');
    });

    // Reload to trigger the error
    await page.reload();

    // The app should handle failed API requests gracefully without crashing #root into GlobalErrorFallback
    await expect(page.locator('#root')).not.toBeEmpty();
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
  });
});

// ============================================================
// App Stability Tests
// ============================================================

test.describe('App Stability', () => {
  test.beforeEach(async ({ page }) => {
    setupAuthenticatedPage(page);
    await page.goto('/dashboard');
    await waitForAuth(page);
  });

  test('should render all major pages without crashing', async ({ page }) => {
    // Test dashboard
    await expect(page.locator('main')).toBeVisible();

    // Test upload page
    await page.goto('/upload');
    await expect(page.locator('main')).toBeVisible();

    // Test history page
    await page.goto('/history');
    await expect(page.locator('main')).toBeVisible();

    // Test profile page
    await page.goto('/profile');
    await expect(page.locator('main')).toBeVisible();
  });

  test('should handle navigation without errors', async ({ page }) => {
    // Navigate around the app
    const pages = ['/dashboard', '/upload', '/history', '/profile'];

    for (const pagePath of pages) {
      await page.goto(pagePath);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('main')).toBeVisible();
      await expect(page.getByText('Something went wrong')).toHaveCount(0);
    }
  });
});
