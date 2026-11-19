import { test, expect } from '@playwright/test';
import { setupAuthenticatedPage, waitForAuth } from './helpers';

/**
 * E2E Tests for Navigation Flow
 * Uses authenticated mock for reliable testing
 */
test.describe('Navigation', () => {

  // Set up authenticated session before each test
  test.beforeEach(async ({ page }) => {
    setupAuthenticatedPage(page);
    await page.goto('/dashboard');
    await waitForAuth(page);
  });

  test('should navigate from Dashboard to Upload', async ({ page }) => {
    await page.getByRole('link', { name: /new check/i }).first().click();
    await expect(page).toHaveURL(/\/upload/);
  });

  test('should hide Live Sandbox from sidebar while keeping direct /sandbox URL accessible', async ({ page }) => {
    await expect(page.locator('aside').getByRole('link', { name: /live sandbox/i })).toHaveCount(0);
    await page.goto('/sandbox');
    await expect(page).toHaveURL(/\/sandbox/);
    await expect(page.getByTestId('sandbox-page')).toBeVisible();
  });

  test('should navigate from Dashboard to History via sidebar', async ({ page }) => {
    await page.getByRole('link', { name: /history/i }).click();
    await expect(page).toHaveURL(/\/history/);
  });

  test('should navigate back to Dashboard when clicking the CITRA logo', async ({ page }) => {
    await page.getByRole('link', { name: /new check/i }).first().click();
    await expect(page).toHaveURL(/\/upload/);

    await page.getByRole('link', { name: /go to dashboard/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('should keep sidebar open on page navigation', async ({ page }) => {
    // Navigate to upload
    await page.getByRole('link', { name: /new check/i }).first().click();
    await expect(page).toHaveURL(/\/upload/);

    // Sidebar should still be visible
    await expect(page.getByRole('link', { name: /dashboard/i }).first()).toBeVisible();

    // Navigate to history
    await page.getByRole('link', { name: /history/i }).first().click();
    await expect(page).toHaveURL(/\/history/);

    // Sidebar should still be visible
    await expect(page.getByRole('link', { name: /dashboard/i }).first()).toBeVisible();
  });

  test('should show loading state on protected route access', async ({ page }) => {
    // Clear auth state
    page.addInitScript(() => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    });

    // Access protected route
    await page.goto('/dashboard');

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);
  });

  test('should redirect legacy /home route to /dashboard', async ({ page }) => {
    await page.goto('/home');
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
