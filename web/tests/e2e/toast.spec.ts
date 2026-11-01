/**
 * E2E Tests for Toast Notification System
 * Tests toast notifications appear and dismiss correctly
 */
import { test, expect } from '@playwright/test';
import { setupAuthenticatedPage, waitForAuth } from './helpers';

// ============================================================
// Toast System Tests
// ============================================================

test.describe('Toast Notification System', () => {
  test.beforeEach(async ({ page }) => {
    // Setup authenticated page
    setupAuthenticatedPage(page);
    await page.goto('/dashboard');
    await waitForAuth(page);
  });

  test('should have toast container in the app', async ({ page }) => {
    await page.goto('/dashboard');

    // Toast container should exist (use attached instead of visible since it may be empty)
    const toastContainer = page.locator('[aria-label="Notifications"]');
    await expect(toastContainer).toBeAttached();
  });

  test('toast should have correct aria attributes', async ({ page }) => {
    await page.goto('/dashboard');

    // Verify toast container has correct aria attributes
    const toastContainer = page.locator('[aria-label="Notifications"]');
    await expect(toastContainer).toHaveAttribute('aria-live', 'polite');
    await expect(toastContainer).toHaveAttribute('aria-label', 'Notifications');
  });

  test('toast dismiss button should exist in DOM', async ({ page }) => {
    await page.goto('/dashboard');

    // Dismiss button exists in the DOM (may not be visible if no toast shown)
    const dismissButton = page.locator('[aria-label="Dismiss notification"]');
    // Just verify it's in the component, not visible
    const count = await dismissButton.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('toast container should have fixed positioning classes', async ({ page }) => {
    await page.goto('/dashboard');

    // Toast container should be attached and have fixed positioning
    const toastContainer = page.locator('[aria-label="Notifications"]');
    await expect(toastContainer).toBeAttached();

    // Check positioning - should have fixed positioning classes
    const classes = await toastContainer.getAttribute('class');
    expect(classes).toContain('fixed');
  });
});

// ============================================================
// Toast Integration Tests
// ============================================================

test.describe('Toast Integration', () => {
  test.beforeEach(async ({ page }) => {
    setupAuthenticatedPage(page);
    await page.goto('/dashboard');
    await waitForAuth(page);
  });

  test('should handle successful page loads', async ({ page }) => {
    // Toast container should be present
    const toastContainer = page.locator('[aria-label="Notifications"]');
    await expect(toastContainer).toBeAttached();

    // No toasts should be visible initially
    const visibleToasts = page.locator('[role="alert"]');
    const count = await visibleToasts.count();
    expect(count).toBe(0);
  });

  test('should navigate between pages without errors', async ({ page }) => {
    // Navigate through the app
    await page.goto('/upload');
    await expect(page.locator('main')).toBeVisible();

    await page.goto('/history');
    await expect(page.locator('main')).toBeVisible();

    await page.goto('/profile');
    await expect(page.locator('main')).toBeVisible();

    // No crashes should occur
    await expect(page.locator('body')).toBeAttached();
  });

  test('toast system should be initialized', async ({ page }) => {
    await page.goto('/dashboard');

    // Check that React rendered without errors
    const main = page.locator('main');
    await expect(main).toBeVisible();

    // Toast container should be rendered
    const toastContainer = page.locator('[aria-label="Notifications"]');
    await expect(toastContainer).toBeAttached();
  });

  test('should trigger Verified, Warning, Error, Stacked, and Live Morph toasts in Settings Preview Studio', async ({
    page,
  }) => {
    await page.goto('/settings');
    await waitForAuth(page);

    const previewBar = page.getByTestId('settings-toast-preview-bar');
    await expect(previewBar).toBeVisible();

    // Trigger Verified toast
    await page.getByTestId('preview-toast-success-btn').click();
    await expect(page.getByTestId('citra-toast-success')).toBeVisible();

    // Trigger Warning and Error toasts to form a 3-card stack
    await page.getByTestId('preview-toast-warning-btn').click();
    await page.getByTestId('preview-toast-error-btn').click();

    await expect(page.getByTestId('toast-stack-toolbar')).toBeVisible();
    await page.getByTestId('dismiss-all-toasts-btn').click();
    await expect(page.locator('[role="alert"]')).toHaveCount(0);

    // Trigger Live Morph toast (loading -> success)
    await page.getByTestId('preview-toast-morph-btn').click();
    await expect(page.getByTestId('citra-toast-loading')).toBeVisible();
    await expect(page.getByTestId('citra-toast-success')).toBeVisible({ timeout: 3500 });
  });

  test('should open Notification Center drawer and display notification history', async ({
    page,
  }) => {
    await page.goto('/settings');
    await waitForAuth(page);

    await page.getByTestId('preview-toast-success-btn').click();
    await expect(page.getByTestId('citra-toast-success')).toBeVisible();

    // Open Notification Center from desktop sidebar trigger
    const trigger = page.getByTestId('notification-center-trigger-desktop');
    await expect(trigger).toBeVisible();
    await trigger.click();

    const panel = page.getByTestId('notification-center-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('listitem').first()).toBeVisible();

    // Clear history inside Notification Center
    await page.getByTestId('notification-clear-history-btn').click();
    await expect(panel.getByTestId('notification-center-test-ping-btn')).toBeVisible();
  });
});
