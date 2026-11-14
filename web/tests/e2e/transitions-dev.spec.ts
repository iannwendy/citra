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
    expect(['150ms', '.15s', '0.15s']).toContain(tokens.durationQuick);
    expect(['250ms', '.25s', '0.25s']).toContain(tokens.durationFast);
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

    // 4. Verify Platform nav dropdown (#05 Dropdown + #21 SymmetricChevron) smooth .is-open -> .is-closing exit
    const navTrigger = page.getByRole('button', { name: /Platform|Nền tảng/i }).first();
    await expect(navTrigger).toBeVisible();
    await navTrigger.click();
    const dropdownMenu = page.locator('.t-dropdown.is-open').first();
    await expect(dropdownMenu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.t-dropdown')).toHaveCount(0, { timeout: 2000 });

    // 5. Verify Interactive Debugger (#interactive-demo): Auto-Tour progress bar, hover pause, and per-digit NumberPopIn
    const demoSection = page.locator('#interactive-demo');
    await demoSection.scrollIntoViewIfNeeded();
    const autoTourBar = demoSection.getByTestId('debugger-autotour-progress');
    await expect(autoTourBar).toBeVisible();
    await expect(autoTourBar).toHaveAttribute('data-paused', 'false');

    await demoSection.getByTestId('debugger-bezel').hover();
    await expect(autoTourBar).toHaveAttribute('data-paused', 'true');

    await demoSection.getByRole('option').first().click();
    await expect(autoTourBar).toHaveCount(0);
    const activeConf = demoSection.getByTestId('debugger-active-confidence');
    await expect(activeConf).toHaveText('99%');

    // 6. Verify 4-Stage Pipeline (#how-it-works): .t-tabs-pill real geometry + causal DirectionalStageSlide
    const pipelineSection = page.locator('#how-it-works');
    await pipelineSection.scrollIntoViewIfNeeded();
    const pipelinePill = pipelineSection.getByTestId('pipeline-tabs-pill');
    await expect(pipelinePill).toBeVisible();
    const pillBox = await pipelinePill.boundingBox();
    expect(pillBox?.width ?? 0).toBeGreaterThan(40);
    expect(pillBox?.height ?? 0).toBeGreaterThan(24);

    const stageTabs = pipelineSection.getByRole('tab');
    await expect(stageTabs).toHaveCount(4);
    await stageTabs.nth(2).click();
    await expect(pipelineSection.getByTestId('pipeline-stage-slide')).toHaveAttribute(
      'data-direction',
      '1',
    );
    await stageTabs.nth(0).click();
    await expect(pipelineSection.getByTestId('pipeline-stage-slide')).toHaveAttribute(
      'data-direction',
      '-1',
    );

    // 7. Verify Landing #taxonomy TactileToggle (#27) + per-digit NumberPopIn (#02)
    const landingToggle = page.getByTestId('landing-billing-toggle');
    await landingToggle.scrollIntoViewIfNeeded();
    await expect(page.getByTestId('landing-price-pro')).toHaveText('$20');
    await expect(page.getByTestId('landing-price-ultra')).toHaveText('$200');
    await landingToggle.click();
    await expect(page.getByTestId('landing-price-pro')).toHaveText('$16');
    await expect(page.getByTestId('landing-price-ultra')).toHaveText('$160');
    await expect(
      page.getByTestId('landing-price-pro').locator('.t-digit').first(),
    ).toHaveAttribute('data-same', '');
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
    await expect(page.getByTestId('pro-price-display')).toHaveText('$16');
    await expect(page.getByTestId('ultra-price-display')).toHaveText('$160');
    await toggleMonthly.click();
    await expect(toggleMonthly).toHaveAttribute('data-pill-active', 'true');
    await expect(page.getByTestId('pro-price-display')).toHaveText('$20');
    await expect(page.getByTestId('ultra-price-display')).toHaveText('$200');

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

  test('4. Dashboard, Upload, Settings & Citation Debugger IDE: NumberPopIn (#02), CardResize (#01), DonutChart (#35), SubtleNumber (#36), SoftTextSwap (#34), StreamingText (#30), Modal (#06) & ErrorShake (#12)', async ({
    page,
  }) => {
    setupAuthenticatedPage(page);
    await page.goto('/dashboard');
    await waitForAuth(page);

    // StatCards use NumberPopIn (.t-digit-group) & Sidebar renders shared layoutId active indicator
    await expect(page.locator('.t-digit-group').first()).toBeVisible();
    const sidebarIndicator = page.getByTestId('sidebar-active-indicator');
    await expect(sidebarIndicator).toBeVisible();
    await expect(
      page.locator('aside a[href="/upload"]'),
    ).toHaveAttribute('data-view-transition', 'true');

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
    // Verify 100% DonutChart segment renders a complete 360-degree closed ring (two closed Z sub-paths, zero radial gap)
    const donutSegPath = await page.locator('.t-donut path.t-donut-seg').first().getAttribute('d');
    expect(donutSegPath).toMatch(/^M.*A.*A.*ZM.*A.*A.*Z$/);
    await expect(page.locator('.t-subtle-number').first()).toBeVisible();
    await expect(page.locator('.t-text-soft').first()).toBeVisible();
    await expect(page.locator('.t-stream').first()).toBeVisible();

    // Navigate to SettingsPage and verify Delete Account modal (.t-modal.is-open) + Error Shake (.t-input.is-error)
    await page.goto('/settings');
    await waitForAuth(page);
    const deleteBtn = page.getByTestId('settings-delete-account-btn');
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();
    const deleteModal = page.getByTestId('delete-account-modal');
    await expect(deleteModal.locator('.t-modal.is-open')).toBeVisible();
    await page.getByTestId('delete-account-confirm-btn').click();
    const deletePwdInput = page.getByTestId('delete-account-password-input');
    await expect(deletePwdInput).toHaveClass(/is-error/);
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
    for (const publicRoute of [
      '/',
      '/pricing',
      '/login',
      '/register',
      '/forgot-password',
      '/privacy',
    ]) {
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
      '/sandbox',
      '/history',
      '/verification/report/1',
      '/profile',
      '/settings',
    ]) {
      await page.goto(authRoute);
      await waitForAuth(page);
      await page.waitForTimeout(250);

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

    // Verify AppLayout mobile slide-over drawer (#07 Panel Reveal tokens) on iPhone 14 Pro Max (430x932)
    await page.goto('/dashboard');
    await waitForAuth(page);
    const openNavBtn = page.getByRole('button', { name: 'Open navigation menu' });
    await expect(openNavBtn).toBeVisible();
    await openNavBtn.click();
    const mobileAside = page.locator('aside').first();
    await expect(mobileAside).toHaveClass(/translate-x-0/);
    const closeNavBtn = page.getByRole('button', { name: 'Close navigation menu' });
    await expect(closeNavBtn).toBeVisible();
    await closeNavBtn.click();
    await expect(mobileAside).toHaveClass(/-translate-x-full/);
  });

  test('7. Processing Page: MatrixDotLoader (#31) active step badge matches light and dark theme polarity without inversion', async ({
    page,
  }) => {
    setupAuthenticatedPage(page);
    await page.addInitScript(() => {
      localStorage.setItem('theme', 'light');
    });

    const activeSnapshot = {
      status: 'processing',
      queue_position: null,
      step: 'parsing',
      step_index: 0,
      total_steps: 8,
      message: 'Parsing PDF structure...',
      citations_found: 0,
      references_found: 0,
      linked: 0,
      sources_queried: {},
      elapsed_seconds: 0.5,
      finished_at: null,
      error: null,
    };

    await page.route('**/api/essays/109/events', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream; charset=utf-8',
        body: `data: ${JSON.stringify(activeSnapshot)}\n\n`,
      });
    });
    await page.route('**/api/essays/109/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(activeSnapshot),
      });
    });

    await page.goto('/verification/processing/109');
    await waitForAuth(page);

    const step1 = page.getByTestId('pipeline-step-1');
    await expect(step1).toHaveAttribute('data-step-status', 'active');

    const matrix = step1.locator('.t-matrix');
    await expect(matrix).toBeVisible();
    await expect(matrix).toHaveAttribute('data-variant', 'scan');
    await expect(matrix.locator('i')).toHaveCount(16);

    // Verify #29 ReasoningStream (.t-reason + vertical mask-image fade) on ProcessingPage
    const reasoningStream = page.getByTestId('processing-reasoning-stream');
    await expect(reasoningStream).toBeVisible();
    await expect(reasoningStream).toContainText('[01/08] GROBID TEI-XML');
    const viewportMask = await reasoningStream
      .locator('.t-reason-viewport')
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return s.maskImage || s.webkitMaskImage || '';
      });
    expect(viewportMask).toContain('linear-gradient');

    const readLoaderMetrics = () =>
      page.evaluate(() => {
        const parseRgb = (cssColor: string): [number, number, number] => {
          const m = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
          if (!m) return [0, 0, 0];
          return [Number(m[1]), Number(m[2]), Number(m[3])];
        };
        const luminance = ([r, g, b]: [number, number, number]): number => {
          const lin = (c: number) => {
            const s = c / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
          };
          return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
        };

        const matrixEl = document.querySelector(
          '[data-testid="pipeline-step-1"] .t-matrix',
        ) as HTMLElement | null;
        const badgeEl = matrixEl?.parentElement as HTMLElement | null;
        if (!matrixEl || !badgeEl) {
          throw new Error('Active step MatrixDotLoader or badge container missing');
        }

        const badgeBg = getComputedStyle(badgeEl).backgroundColor;
        const bodyBg = getComputedStyle(document.body).backgroundColor;
        const matrixStyle = getComputedStyle(matrixEl);

        return {
          isDarkHtml: document.documentElement.classList.contains('dark'),
          bodyBg,
          bodyLuminance: luminance(parseRgb(bodyBg)),
          badgeBg,
          badgeLuminance: luminance(parseRgb(badgeBg)),
          matrixBase: matrixStyle.getPropertyValue('--matrix-base').trim(),
          matrixActive: matrixStyle.getPropertyValue('--matrix-active').trim().toLowerCase(),
        };
      });

    // Light mode: both page canvas and active loader badge must be light (not inverted dark #1C1A15)
    const lightMetrics = await readLoaderMetrics();
    expect(lightMetrics.isDarkHtml).toBe(false);
    expect(lightMetrics.bodyLuminance).toBeGreaterThan(0.85);
    expect(
      lightMetrics.badgeLuminance,
      `Expected light badge surface in light mode, got ${lightMetrics.badgeBg}`,
    ).toBeGreaterThan(0.8);
    expect(lightMetrics.matrixActive).toBe('#10b981');

    // Switch to Dark mode via the real sidebar theme toggle
    const themeToggle = page.locator('button[title^="Theme:"]').first();
    await expect(themeToggle).toBeVisible();
    for (let i = 0; i < 3; i++) {
      const isDark = await page.evaluate(() =>
        document.documentElement.classList.contains('dark'),
      );
      if (isDark) break;
      await themeToggle.click();
    }
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.classList.contains('dark')),
      )
      .toBe(true);

    // Dark mode: wait for 300ms theme transition to settle, then verify both page canvas and active loader badge are dark (not inverted white #FBFAF6)
    await expect
      .poll(async () => (await readLoaderMetrics()).badgeLuminance, {
        message: 'Expected active step loader badge to settle to a dark surface in dark mode',
      })
      .toBeLessThan(0.15);

    const darkMetrics = await readLoaderMetrics();
    expect(darkMetrics.isDarkHtml).toBe(true);
    expect(darkMetrics.bodyLuminance).toBeLessThan(0.05);
    expect(
      darkMetrics.badgeLuminance,
      `Expected dark badge surface in dark mode, got ${darkMetrics.badgeBg}`,
    ).toBeLessThan(0.15);
    expect(darkMetrics.matrixActive).toBe('#34d399');
    expect(lightMetrics.badgeLuminance).toBeGreaterThan(darkMetrics.badgeLuminance);
  });
});
