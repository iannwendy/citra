/**
 * E2E Tests for Dark Mode
 * Tests theme switching and persistence
 */
import { test, expect } from '@playwright/test';
import { setupAuthenticatedPage, waitForAuth } from './helpers';

// ============================================================
// Dark Mode Tests
// ============================================================

test.describe('Dark Mode', () => {
  test.beforeEach(async ({ page }) => {
    // Setup authenticated page
    setupAuthenticatedPage(page);
    await page.goto('/dashboard');
    await waitForAuth(page);
    // Clear localStorage before each test
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForURL(/\/(dashboard|login)/);
  });

  test('should have theme toggle in sidebar', async ({ page }) => {
    await page.goto('/dashboard');

    // Look for theme toggle button - it has title starting with "Theme:"
    const themeToggle = page.locator('button[title^="Theme:"]');
    await expect(themeToggle).toBeVisible();
  });

  test('should toggle between light, dark, and system themes', async ({ page }) => {
    await page.goto('/dashboard');

    const themeToggle = page.locator('button[title^="Theme:"]').first();

    // Get initial theme from title
    const initialTitle = await themeToggle.getAttribute('title') || '';
    const initialTheme = initialTitle.replace('Theme: ', '');

    // Click to cycle through themes
    await themeToggle.click();
    const secondTitle = await themeToggle.getAttribute('title') || '';
    const secondTheme = secondTitle.replace('Theme: ', '');
    expect(secondTheme).not.toBe(initialTheme);

    // Click again
    await themeToggle.click();
    const thirdTitle = await themeToggle.getAttribute('title') || '';
    const thirdTheme = thirdTitle.replace('Theme: ', '');
    expect(thirdTheme).not.toBe(secondTheme);

    // Should cycle back to initial after 3 clicks
    await themeToggle.click();
    const fourthTitle = await themeToggle.getAttribute('title') || '';
    const fourthTheme = fourthTitle.replace('Theme: ', '');
    expect(fourthTheme).toBe(initialTheme);
  });

  test('should persist theme in localStorage', async ({ page }) => {
    await page.goto('/dashboard');

    const themeToggle = page.locator('button[title^="Theme:"]').first();
    await themeToggle.click();

    // Check localStorage
    const storedTheme = await page.evaluate(() => localStorage.getItem('theme'));
    expect(['light', 'dark', 'system']).toContain(storedTheme);
  });

  test('should apply dark class to html element when dark mode is active', async ({ page }) => {
    await page.goto('/dashboard');

    const themeToggle = page.locator('button[title^="Theme:"]').first();
    await expect(themeToggle).toBeVisible();

    // Click until dark mode is active
    for (let i = 0; i < 3; i++) {
      const currentTitle = (await themeToggle.getAttribute('title')) || '';
      if (currentTitle.includes('Dark')) break;
      await themeToggle.click();
    }

    await expect(themeToggle).toHaveAttribute('title', /Dark/);
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('should respect system preference when set to system', async ({ page }) => {
    await page.goto('/dashboard');

    const themeToggle = page.locator('button[title^="Theme:"]').first();
    await expect(themeToggle).toBeVisible();

    // Click to set system theme (click until we reach system)
    for (let i = 0; i < 3; i++) {
      const title = (await themeToggle.getAttribute('title')) || '';
      if (title.includes('System')) break;
      await themeToggle.click();
    }

    await expect(themeToggle).toHaveAttribute('title', /System/);

    // Theme should match system preference
    const prefersDark = await page.evaluate(() =>
      window.matchMedia('(prefers-color-scheme: dark)').matches
    );

    if (prefersDark) {
      await expect(page.locator('html')).toHaveClass(/dark/);
    } else {
      await expect(page.locator('html')).not.toHaveClass(/dark/);
    }
  });

  test('should persist theme across page reload', async ({ page }) => {
    await page.goto('/dashboard');

    const themeToggle = page.locator('button[title^="Theme:"]').first();
    await expect(themeToggle).toBeVisible();

    // Set to dark mode
    for (let i = 0; i < 3; i++) {
      const title = (await themeToggle.getAttribute('title')) || '';
      if (title.includes('Dark')) break;
      await themeToggle.click();
    }

    await expect(themeToggle).toHaveAttribute('title', /Dark/);
    await expect(page.locator('html')).toHaveClass(/dark/);

    // Reload page
    await page.reload();
    await page.waitForURL(/\/(dashboard|login)/);
    await waitForAuth(page);

    // Dark mode should persist
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('should toggle theme toggle icon based on current theme', async ({ page }) => {
    await page.goto('/dashboard');

    const themeToggle = page.locator('button[title^="Theme:"]').first();
    await expect(themeToggle.locator('svg').first()).toBeVisible();

    const initialIcon = await themeToggle.locator('svg').first().innerHTML();

    // Toggle
    await themeToggle.click();

    await expect
      .poll(async () => themeToggle.locator('svg').first().innerHTML())
      .not.toBe(initialIcon);
  });
});

// ============================================================
// Dark Mode UI Tests
// ============================================================

test.describe('Dark Mode UI Components', () => {
  test.beforeEach(async ({ page }) => {
    setupAuthenticatedPage(page);
    // Set dark theme in localStorage before loading
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('theme', 'dark');
    });
    await page.goto('/dashboard');
    await waitForAuth(page);
  });

  test('should have dark mode styling on dashboard', async ({ page }) => {
    // Verify dark class is applied
    const hasDarkClass = await page.evaluate(() =>
      document.documentElement.classList.contains('dark')
    );
    expect(hasDarkClass).toBe(true);

    // Check that content is visible
    const mainContent = page.locator('main');
    await expect(mainContent).toBeVisible();
  });

  test('should display cards correctly in dark mode', async ({ page }) => {
    // Cards should be visible
    const mainContent = page.locator('main');
    await expect(mainContent).toBeVisible();
  });

  test('should toggle to light mode correctly', async ({ page }) => {
    // Set to dark first via localStorage
    await page.evaluate(() => localStorage.setItem('theme', 'dark'));
    await page.reload();
    await page.waitForLoadState('networkidle');

    const themeToggle = page.locator('button[title^="Theme:"]').first();

    // Verify dark mode
    const hasDarkClass = await page.evaluate(() =>
      document.documentElement.classList.contains('dark')
    );
    expect(hasDarkClass).toBe(true);

    // Click to switch to light (click until we get light)
    for (let i = 0; i < 3; i++) {
      const title = (await themeToggle.getAttribute('title')) || '';
      if (title.includes('Light')) break;
      await themeToggle.click();
    }

    await expect(themeToggle).toHaveAttribute('title', /Light/);
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });
});
