import { test, expect } from '@playwright/test';
import { setupAuthenticatedPage, waitForAuth } from './helpers';

/**
 * Playwright tests for Essay Integrity Checker frontend
 * Tests new features: Help Modal, DOCX Export button
 */

test.describe('Help Modal', () => {
  test.beforeEach(async ({ page }) => {
    // Use authenticated page setup for reliable testing
    setupAuthenticatedPage(page);
    await page.goto('/dashboard');
    await waitForAuth(page);
  });

  test('should open help modal with Ctrl+/ shortcut', async ({ page }) => {
    // Press Ctrl+/ to open help
    await page.keyboard.press('Control+/');

    // Check modal is visible
    await expect(page.locator('h3:has-text("Welcome to CITRA")')).toBeVisible();
  });

  test('should close help modal with Escape', async ({ page }) => {
    // Open help modal
    await page.keyboard.press('Control+/');
    await expect(page.locator('h3:has-text("Welcome to CITRA")')).toBeVisible();

    // Press Escape to close
    await page.keyboard.press('Escape');
    await expect(page.locator('h3:has-text("Welcome to CITRA")')).not.toBeVisible();
  });

  test('should show all help sections', async ({ page }) => {
    await page.keyboard.press('Control+/');

    // Check sidebar sections exist - use more specific selectors
    await expect(page.getByRole('button', { name: 'Overview' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Getting Started' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Understanding Verdicts' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Keyboard Shortcuts' })).toBeVisible();
  });

  test('should navigate between help sections', async ({ page }) => {
    await page.keyboard.press('Control+/');

    // Click on Getting Started
    await page.getByRole('button', { name: 'Getting Started' }).click();
    await expect(page.locator('h3:has-text("Getting Started")')).toBeVisible();

    // Click on Understanding Verdicts
    await page.getByRole('button', { name: 'Understanding Verdicts' }).click();
    await expect(page.locator('h3:has-text("Understanding Verdicts")')).toBeVisible();

    // Click on Keyboard Shortcuts
    await page.getByRole('button', { name: 'Keyboard Shortcuts' }).click();
    await expect(page.locator('h3:has-text("Keyboard Shortcuts")')).toBeVisible();
  });

  test('should show verdict explanations', async ({ page }) => {
    await page.keyboard.press('Control+/');
    await page.getByRole('button', { name: 'Understanding Verdicts' }).click();

    // Check all verdict types are explained
    await expect(page.getByRole('heading', { name: 'VERIFIED' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'METADATA_ERROR' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'SUSPECTED_HALLUCINATION' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'UNRESOLVED' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'RESOURCE' })).toBeVisible();
  });
});

test.describe('DOCX Export Button', () => {
  test.beforeEach(async ({ page }) => {
    // Use authenticated page setup for reliable testing
    setupAuthenticatedPage(page);
    await page.goto('/dashboard');
    await waitForAuth(page);
  });

  test('should have DOCX button on essay page', async ({ page }) => {
    // Go to history
    await page.click('text=History');
    await page.waitForURL('/history');

    // Check if there are any essays
    const essayLinks = page.locator('[data-testid="essay-item"], a[href*="/verification/report/"], a[href^="/essays/"]');
    const essays = await essayLinks.count();

    if (essays > 0) {
      // Click on first essay
      await essayLinks.first().click();
      await page.waitForURL(/\/(verification\/report|essays)\/\d+/);

      // Check DOCX button exists
      await expect(page.locator('a:has-text("DOCX"), button:has-text("DOCX")').first()).toBeVisible();
    }
  });

  test('should have export buttons visible', async ({ page }) => {
    // Go to history
    await page.click('text=History');
    await page.waitForURL('/history');

    const essayLinks = page.locator('[data-testid="essay-item"], a[href*="/verification/report/"], a[href^="/essays/"]');
    const essays = await essayLinks.count();

    if (essays > 0) {
      await essayLinks.first().click();
      await page.waitForURL(/\/(verification\/report|essays)\/\d+/);

      // All export formats should be visible
      await expect(page.locator('a:has-text("JSON"), button:has-text("JSON")').first()).toBeVisible();
      await expect(page.locator('a:has-text("CSV"), button:has-text("CSV")').first()).toBeVisible();
      await expect(page.locator('a:has-text("PDF"), button:has-text("PDF")').first()).toBeVisible();
      await expect(page.locator('a:has-text("DOCX"), button:has-text("DOCX")').first()).toBeVisible();
    }
  });
});
