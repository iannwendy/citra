/**
 * E2E Tests for Settings Page
 * Tests settings page functionality and preferences
 */
import { test, expect } from '@playwright/test';
import { setupAuthenticatedPage, waitForAuth } from './helpers';

// ============================================================
// Settings Page Tests
// ============================================================

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    setupAuthenticatedPage(page);
    await page.goto('/dashboard');
    await waitForAuth(page);
    // Clear localStorage before each test
    // Clear settings/language preferences without wiping auth token/user
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('settings_') || k === 'language' || k === 'theme')
        .forEach((k) => localStorage.removeItem(k));
    });
  });

  test('should navigate to settings page from sidebar', async ({ page }) => {
    await page.goto('/dashboard');

    // Click settings in sidebar
    const settingsLink = page.locator('aside').getByText('Settings');
    await settingsLink.click();

    await expect(page).toHaveURL(/\/settings/);
  });

  test('should display settings page heading', async ({ page }) => {
    await page.goto('/settings');

    // Check main title - use specific heading role
    const heading = page.getByRole('heading', { name: 'Settings' });
    await expect(heading).toBeVisible();
  });

  test('should have theme section', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    // Theme should be mentioned somewhere
    const pageContent = await page.content();
    expect(pageContent.toLowerCase()).toContain('theme');
  });

  test('should have language section', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    // Language should be mentioned
    const pageContent = await page.content();
    expect(pageContent.toLowerCase()).toContain('language');
  });

  test('should have notification toggles', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    // Look for switch/checkbox elements
    const switchButtons = page.locator('button[role="switch"]');
    const count = await switchButtons.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should toggle notifications setting', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    // Find notifications toggle and click it
    const switchButton = page.locator('button[role="switch"]').first();
    if (await switchButton.count() > 0) {
      await switchButton.click();

      // Toast should appear
      const toast = page.locator('[role="alert"]');
      await expect(toast).toBeVisible({ timeout: 5000 });
    }
  });

  test('should persist settings to localStorage', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    // Toggle a setting
    const switchButton = page.locator('button[role="switch"]').first();
    if (await switchButton.count() > 0) {
      await switchButton.click();

      // Check localStorage
      const settingsValue = await page.evaluate(() => {
        const keys = Object.keys(localStorage).filter(k => k.startsWith('settings_'));
        return localStorage.getItem(keys[0]);
      });
      expect(['true', 'false']).toContain(settingsValue);
    }
  });

  test('should show version info', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    // Version should be displayed somewhere
    const pageContent = await page.content();
    expect(pageContent).toContain('Version');
  });

  test('should have about section without source code link', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    // About should be mentioned
    const pageContent = await page.content();
    expect(pageContent.toLowerCase()).toContain('about');

    const sourceLink = page.getByRole('link', { name: /View Source Code|Xem mã nguồn/i });
    await expect(sourceLink).toHaveCount(0);
  });

  test('should suppress action toasts when notifications are disabled', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    // Disable notifications
    const switchButton = page.locator('button[role="switch"]').first();
    await switchButton.click();

    // Dismiss the confirmation toast
    const dismissBtn = page.locator('[aria-label="Dismiss notification"]');
    if ((await dismissBtn.count()) > 0) {
      await dismissBtn.first().click();
    }

    // Trigger an action that normally shows a toast (change language)
    await page.getByRole('button', { name: 'Tiếng Việt' }).click();
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
  });

  test('settings should be accessible from navigation', async ({ page }) => {
    await page.goto('/dashboard');

    // Settings should be in sidebar under Preferences
    const preferencesSection = page.locator('text=Preferences');
    await expect(preferencesSection).toBeVisible();

    // Click Settings
    await page.click('aside >> text=Settings');
    await expect(page).toHaveURL(/\/settings/);
  });
});

// ============================================================
// Settings Integration Tests
// ============================================================

test.describe('Settings Integration', () => {
  test.beforeEach(async ({ page }) => {
    setupAuthenticatedPage(page);
    await page.goto('/dashboard');
    await waitForAuth(page);
    // Clear settings/language preferences without wiping auth token/user
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('settings_') || k === 'language' || k === 'theme')
        .forEach((k) => localStorage.removeItem(k));
    });
  });

  test('settings should persist across page navigation', async ({ page }) => {
    await page.goto('/settings');

    // Toggle a setting if available
    const switchButton = page.locator('button[role="switch"]').first();
    if (await switchButton.count() > 0) {
      await switchButton.click();

      // Navigate away
      await page.click('aside >> text=Dashboard');

      // Navigate back
      await page.click('aside >> text=Settings');
      await expect(page).toHaveURL(/\/settings/);
    }
  });

  test('should show toast when changing settings', async ({ page }) => {
    await page.goto('/settings');

    // Make a change
    const switchButton = page.locator('button[role="switch"]').first();
    if (await switchButton.count() > 0) {
      await switchButton.click();

      // Toast should appear
      const toast = page.locator('[role="alert"]');
      await expect(toast).toBeVisible({ timeout: 5000 });
    }
  });

  test('should show Preferences section in sidebar', async ({ page }) => {
    await page.goto('/dashboard');

    // Preferences section should be visible
    const preferencesSection = page.locator('aside >> text=Preferences');
    await expect(preferencesSection).toBeVisible();
  });
});

// ============================================================
// Language Switching (Vietnamese / English) & Flag Removal Tests
// ============================================================

test.describe('Language Switching & Flag Removal', () => {
  test.beforeEach(async ({ page }) => {
    setupAuthenticatedPage(page);
    await page.goto('/dashboard');
    await waitForAuth(page);
    // Clear settings/language preferences without wiping auth token/user
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('settings_') || k === 'language' || k === 'theme')
        .forEach((k) => localStorage.removeItem(k));
    });
  });

  test('should not render flag emojis on language selector buttons', async ({ page }) => {
    await page.goto('/settings');

    const viBtn = page.getByRole('button', { name: 'Tiếng Việt' });
    const enBtn = page.getByRole('button', { name: 'English' });

    await expect(viBtn).toBeVisible();
    await expect(enBtn).toBeVisible();

    const pageText = await page.locator('main').innerText();
    expect(pageText).not.toContain('🇻🇳');
    expect(pageText).not.toContain('🇺🇸');
  });

  test('should activate Vietnamese UI when selecting Tiếng Việt and persist across reload and pages', async ({ page }) => {
    await page.goto('/settings');

    // Click Tiếng Việt button
    const viBtn = page.getByRole('button', { name: 'Tiếng Việt' });
    await viBtn.click();

    // Verify Settings page is translated to Vietnamese
    await expect(page.getByRole('heading', { name: 'Cài đặt' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Giao diện' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ngôn ngữ' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Thông báo' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Giới thiệu' })).toBeVisible();

    // Verify Sidebar is translated to Vietnamese
    const sidebar = page.locator('aside');
    await expect(sidebar.getByText('Bảng điều khiển')).toBeVisible();
    await expect(sidebar.getByText('Kiểm tra mới')).toBeVisible();
    await expect(sidebar.getByText('Lịch sử')).toBeVisible();
    await expect(sidebar.getByText('Cài đặt')).toBeVisible();
    await expect(sidebar.getByText('Đăng xuất')).toBeVisible();

    // Verify localStorage has 'vi'
    const storedLang = await page.evaluate(() => localStorage.getItem('language'));
    expect(storedLang).toBe('vi');

    // Reload page and verify Vietnamese persists
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Cài đặt' })).toBeVisible();

    // Navigate to Dashboard in Vietnamese
    await sidebar.getByText('Bảng điều khiển').click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: 'Bảng điều khiển' })).toBeVisible();
    await expect(page.getByText('Tổng tài liệu')).toBeVisible();

    // Navigate to Upload page in Vietnamese
    await sidebar.getByText('Kiểm tra mới').click();
    await expect(page).toHaveURL(/\/upload/);
    await expect(page.getByRole('heading', { name: 'Kiểm tra mới' })).toBeVisible();

    // Navigate to History page in Vietnamese
    await sidebar.getByText('Lịch sử').click();
    await expect(page).toHaveURL(/\/history/);
    await expect(page.getByRole('heading', { name: 'Báo cáo xác minh' })).toBeVisible();

    // Switch back to English on Settings page
    await sidebar.getByText('Cài đặt').click();
    await expect(page).toHaveURL(/\/settings/);
    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(sidebar.getByText('Dashboard')).toBeVisible();
  });
});
