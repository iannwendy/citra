import { test, expect, type Page } from '@playwright/test';

async function loginReal(page: Page, username: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/username|tên đăng nhập/i).fill(username);
  await page.getByLabel(/password|mật khẩu/i).first().fill(password);
  await page.getByRole('button', { name: /sign in|đăng nhập/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
}

test.describe('Comprehensive Audit Regression Suite (2026-11-11: BUG-01 to BUG-11)', () => {
  test('1. Public typography, links & console hygiene (/login, /pricing, /api/health)', async ({
    page,
    request,
  }) => {
    const consoleWarningsAndErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        consoleWarningsAndErrors.push(msg.text());
      }
    });

    // BUG-02: /api/health message is consistent with container_running
    const healthResp = await request.get('http://127.0.0.1:8000/api/health');
    expect(healthResp.ok()).toBe(true);
    const healthJson = (await healthResp.json()) as {
      grobid: { available: boolean; container_running: boolean | null; message: string };
    };
    if (!healthJson.grobid.available && healthJson.grobid.container_running === false) {
      expect(healthJson.grobid.message).not.toContain('GROBID container running');
    }

    // BUG-08 & BUG-10: /login hero heading preserves word spaces and current version
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/login');
    const loginH2Text = await page.locator('h2.font-solva-serif').textContent();
    expect(loginH2Text).toBeTruthy();
    expect(loginH2Text).toMatch(/\s/);
    expect(loginH2Text).not.toContain('Verifyeverycitation');
    expect(loginH2Text).not.toContain('Xácminhmọitríchdẫn');
    await expect(page.getByText('SourceLogic v2.3')).toHaveCount(0);

    // BUG-07 & BUG-08: /pricing has zero hrefless <a> tags, valid /#interactive-demo link, and spaced h1
    await page.goto('/pricing');
    const pricingH1Text = await page.locator('h1.font-solva-serif').textContent();
    expect(pricingH1Text).not.toContain('integrity.Simple');
    const hreflessAnchors = await page.locator('a:not([href])').count();
    expect(hreflessAnchors).toBe(0);
    const deadLocalDemoAnchors = await page.locator('a[href="#interactive-demo"]').count();
    expect(deadLocalDemoAnchors).toBe(0);

    // BUG-11: Zero React Router v7 future flag warnings and zero unused preload warnings
    const routerOrPreloadWarnings = consoleWarningsAndErrors.filter(
      (line) =>
        line.includes('React Router Future Flag Warning') ||
        line.includes('was preloaded using link preload but not used'),
    );
    expect(routerOrPreloadWarnings).toEqual([]);
  });

  test('2. BillingSuccessPage strict payment session verification guard (BUG-01)', async ({
    page,
  }) => {
    await loginReal(page, 'user', 'user123');

    // Direct navigation without session_id or vnp_SecureHash must NOT show payment succeeded
    await page.goto('/billing/success');
    await expect(page.getByTestId('billing-verification-missing')).toBeVisible();
    await expect(page.getByText(/PAYMENT SUCCEEDED|THANH TOÁN THÀNH CÔNG/i)).toHaveCount(0);

    // Forged session_id must render explicit verification error state
    await page.goto('/billing/success?session_id=cs_forged_audit_check_999');
    await expect(page.getByTestId('billing-verification-error')).toBeVisible();
    await expect(page.getByText(/PAYMENT SUCCEEDED|THANH TOÁN THÀNH CÔNG/i)).toHaveCount(0);
  });

  test('3. Authenticated landmark semantics, Upload telemetry, Sandbox EN i18n, and Admin modals (BUG-03, BUG-05, BUG-06, BUG-10)', async ({
    page,
  }) => {
    await loginReal(page, 'admin', 'admin123');

    // BUG-06: Authenticated /pricing inside AppLayout has zero nested <main><main>
    await page.goto('/pricing');
    await expect(page.locator('#pricing-main-content')).toBeVisible();
    expect(await page.locator('main main').count()).toBe(0);

    // BUG-05: /admin/promos create modal has role="dialog", aria-modal="true", and closes on Escape
    await page.goto('/admin/promos');
    await page.getByTestId('create-promo-btn').click();
    const promoModal = page.getByTestId('promo-form-modal');
    await expect(promoModal).toBeVisible();
    const dialogPanel = promoModal.getByRole('dialog');
    await expect(dialogPanel).toBeVisible();
    await expect(dialogPanel).toHaveAttribute('aria-modal', 'true');
    await page.keyboard.press('Escape');
    await expect(promoModal).toHaveCount(0);

    // BUG-03: /admin/system renders friendly cache stat labels without raw snake_case keys
    await page.goto('/admin/system');
    await expect(page.getByTestId('health-status-pill')).toBeVisible();
    const cacheStats = page.getByTestId('cache-stats');
    await expect(cacheStats).toBeVisible();
    await expect(cacheStats).not.toContainText('total_hits');
    await expect(cacheStats).not.toContainText('avg_hit_count');

    // BUG-03: /upload shows KB size and BIBTEX PARSER for small .bib file
    await page.goto('/upload');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'audit-sample.bib',
      mimeType: 'application/x-bibtex',
      buffer: Buffer.from('@article{vaswani2017, title={Attention Is All You Need}, year={2017}}\n'.repeat(20)),
    });
    await expect(page.getByText('audit-sample.bib')).toBeVisible();
    await expect(page.locator('main')).toContainText('KB');
    await expect(page.locator('main')).toContainText('BIBTEX PARSER');
    await expect(page.locator('main')).not.toContainText('0.00 MB');

    // BUG-10a: /sandbox Instant Check in English emits pure English Layer 1 notes
    await page.evaluate(() => localStorage.setItem('i18nextLng', 'en'));
    await page.goto('/sandbox');
    await page.getByTestId('sandbox-mode-raw-btn').click();
    await page.getByTestId('sandbox-verify-submit-btn').click();
    await expect(page.locator('main')).not.toContainText('Kiểm tra trực tiếp danh mục tham khảo');
  });
});
