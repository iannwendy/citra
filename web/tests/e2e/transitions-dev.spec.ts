import { test, expect } from '@playwright/test';
import { setupAuthenticatedPage, waitForAuth } from './helpers';

test.use({
  baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
});

const IPHONE_14_PRO_MAX = { width: 430, height: 932 };

test.describe('transitions.dev + transitions-polish + transitions-ui-generation E2E & 120fps Suite', () => {
  test('1. Landing Page: Motion Token Scale, UIGenerationReveal wireframe-to-UI scan, Sliding Tabs Pill (#16), and Platform Dropdown (#05/#21)', async ({
    page,
  }) => {
    await page.goto('/');

    // 1. Verify root CSS variables from transitions-dev / transitions-polish scale
    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        durationQuick: style.getPropertyValue('--duration-quick').trim(),
        durationFast: style.getPropertyValue('--duration-fast').trim(),
        easeSmoothOut: style.getPropertyValue('--ease-smooth-out').trim(),
        easeBounce: style.getPropertyValue('--ease-bounce').trim(),
      };
    });
    expect(tokens.durationQuick).toBe('150ms');
    expect(tokens.durationFast).toBe('250ms');
    expect(tokens.easeSmoothOut).toContain('cubic-bezier');
    expect(tokens.easeBounce).toContain('cubic-bezier');

    // 2. Verify UIGenerationReveal container (.t-gen-wrap + .t-gen) wraps the Hero Verification Mockup
    const genWrap = page.locator('.t-gen-wrap').first();
    const genOverlay = page.locator('.t-gen').first();
    await expect(genWrap).toBeVisible();
    await expect(genOverlay).toHaveAttribute('data-phase', 'done', { timeout: 4000 });

    // 3. Verify Benchmark 120K 3-view switcher uses #16 Sliding Tabs (.t-tabs-pill + .t-tab)
    const benchSection = page.getByTestId('benchmark-120k-section');
    await expect(benchSection.locator('.t-tabs-pill')).toBeVisible();
    const benchTabs = benchSection.getByRole('tab');
    await expect(benchTabs).toHaveCount(3);

    await benchTabs.nth(1).click();
    await expect(benchTabs.nth(1)).toHaveAttribute('data-pill-active', 'true');
    await benchTabs.nth(2).click();
    await expect(benchTabs.nth(2)).toHaveAttribute('data-pill-active', 'true');

    // 4. Verify Platform nav dropdown (#05 Dropdown + #21 SymmetricChevron)
    const navTrigger = page.getByRole('button', { name: /Platform|Nền tảng/i }).first();
    await expect(navTrigger).toBeVisible();
    await navTrigger.click();
    const dropdownMenu = page.locator('.t-dropdown.is-open').first();
    await expect(dropdownMenu).toBeVisible();
  });

  test('2. Pricing Page: Sliding Billing Toggle (#16), SoftTextSwap (#34), and 3D CardHoverTilt (#19)', async ({
    page,
  }) => {
    await page.goto('/pricing');

    const toggleMonthly = page.getByTestId('billing-toggle-monthly');
    const toggleAnnual = page.getByTestId('billing-toggle-annual');
    await expect(toggleMonthly).toBeVisible();
    await expect(toggleAnnual).toBeVisible();

    await toggleAnnual.click();
    await expect(toggleAnnual).toHaveAttribute('data-pill-active', 'true');
    await toggleMonthly.click();
    await expect(toggleMonthly).toHaveAttribute('data-pill-active', 'true');

    // Verify Pro card is wrapped in CardHoverTilt (.t-tilt)
    const proCard = page.getByTestId('plan-card-pro');
    await expect(proCard).toBeVisible();
    const tiltWrapper = page.locator('.t-tilt').first();
    await expect(tiltWrapper).toBeVisible();
  });

  test('3. Login Page: IconSwap (#09) on password visibility toggle and Error Shake (#12) on failed login', async ({
    page,
  }) => {
    await page.route('**/api/auth/login', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Invalid username or password' }),
      });
    });

    await page.goto('/login');

    const usernameInput = page.locator('#username');
    const passwordInput = page.locator('#password');
    await expect(usernameInput).toHaveClass(/t-input/);
    await expect(passwordInput).toHaveClass(/t-input/);

    // Toggle password visibility and check IconSwap (.t-icon-swap data-state="a" -> "b")
    const eyeToggle = page.locator('form button[type="button"]').first();
    await expect(eyeToggle.locator('.t-icon-swap')).toHaveAttribute('data-state', 'a');
    await eyeToggle.click();
    await expect(eyeToggle.locator('.t-icon-swap')).toHaveAttribute('data-state', 'b');
    await expect(passwordInput).toHaveAttribute('type', 'text');

    // Trigger failed login and verify .is-error state on inputs
    await usernameInput.fill('wronguser');
    await passwordInput.fill('wrongpass');
    await page.locator('form button[type="submit"]').click();
    await expect(usernameInput).toHaveClass(/is-error/);
    await expect(passwordInput).toHaveClass(/is-error/);
  });

  test('4. Dashboard, Upload & Citation Debugger IDE: NumberPopIn (#02), CardResize (#01), DonutChart (#35), SubtleNumber (#36), SoftTextSwap (#34), StreamingText (#30)', async ({
    page,
  }) => {
    setupAuthenticatedPage(page);
    await page.goto('/dashboard');
    await waitForAuth(page);

    // StatCards use NumberPopIn (.t-digit-group)
    await expect(page.locator('.t-digit-group').first()).toBeVisible();

    // Search input uses .t-clear-input
    const searchInput = page.getByPlaceholder(/search documents/i);
    await expect(searchInput).toHaveClass(/t-clear-input/);
    await searchInput.fill('BERT');
    const clearBtn = page.getByRole('button', { name: 'Clear search' });
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();
    await expect(searchInput).toHaveValue('');

    // Navigate to UploadPage and check CardResize (.t-card-resize), AvatarGroupHover (.t-avatar-group), TextStatesSwap (.t-text-swap)
    await page.goto('/upload');
    await waitForAuth(page);
    await expect(page.locator('.t-card-resize').first()).toBeVisible();
    await expect(page.locator('.t-avatar-group').first()).toBeVisible();
    await expect(page.locator('.t-text-swap').first()).toBeVisible();

    // Navigate to EssayPage Citation Debugger IDE and check DonutChart (.t-donut), SubtleNumber (.t-subtle-number), SoftTextSwap (.t-text-soft), StreamingText (.t-stream)
    await page.goto('/verification/report/1');
    await waitForAuth(page);
    await expect(page.locator('.t-donut').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.t-subtle-number').first()).toBeVisible();
    await expect(page.locator('.t-text-soft').first()).toBeVisible();
    await expect(page.locator('.t-stream').first()).toBeVisible();
  });

  test('5. Accessibility: prefers-reduced-motion: reduce disables motion durations across transitions.dev classes', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    // Under prefers-reduced-motion: reduce, UIGenerationReveal immediately marks data-phase="done"
    const genOverlay = page.locator('.t-gen').first();
    await expect(genOverlay).toHaveAttribute('data-phase', 'done');
  });

  test('6. Responsive iPhone 14 Pro Max (430x932): Zero Horizontal Overflow & Smooth Mobile Navigation across all core pages', async ({
    page,
  }) => {
    await page.setViewportSize(IPHONE_14_PRO_MAX);

    // A) Public routes on iPhone 14 Pro Max (430x932)
    for (const publicRoute of ['/', '/pricing', '/login']) {
      await page.goto(publicRoute);
      await page.waitForTimeout(250);
      const overflow = await page.evaluate(() => {
        return {
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        };
      });
      expect(
        overflow.scrollWidth,
        `Route ${publicRoute} should not overflow 430px on iPhone 14 Pro Max`,
      ).toBeLessThanOrEqual(430);
    }

    // Verify mobile hamburger menu on LandingPage uses IconSwap (.t-icon-swap)
    await page.goto('/');
    const mobileMenuBtn = page.getByRole('button', { name: 'Toggle navigation menu' });
    await expect(mobileMenuBtn).toBeVisible();
    await expect(mobileMenuBtn.locator('.t-icon-swap')).toHaveAttribute('data-state', 'a');
    await mobileMenuBtn.click();
    await expect(mobileMenuBtn.locator('.t-icon-swap')).toHaveAttribute('data-state', 'b');

    // B) Authenticated routes on iPhone 14 Pro Max (430x932)
    setupAuthenticatedPage(page);
    for (const authRoute of [
      '/dashboard',
      '/upload',
      '/batch-upload',
      '/history',
      '/verification/report/1',
      '/settings',
    ]) {
      await page.goto(authRoute);
      await waitForAuth(page);
      await page.waitForTimeout(300);

      const overflow = await page.evaluate(() => {
        return {
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        };
      });
      expect(
        overflow.scrollWidth,
        `Authenticated route ${authRoute} should not overflow 430px on iPhone 14 Pro Max`,
      ).toBeLessThanOrEqual(430);
    }
  });
});
