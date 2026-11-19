import { test, expect, type Page } from '@playwright/test';
import { clearAuthState } from './helpers';

test.use({
  baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
});

const OVERHAUL_VIEWPORTS = [
  { name: '375x812', width: 375, height: 812 },
  { name: '390x844', width: 390, height: 844 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '1440x900', width: 1440, height: 900 },
] as const;

const PUBLIC_AND_AUTH_ROUTES = [
  '/',
  '/pricing',
  '/login',
  '/register',
  '/forgot-password',
  '/privacy',
  '/terms',
  '/missing-route-404',
] as const;

const FORBIDDEN_TRUST_STRINGS = [
  'LEGAL DRAFT',
  'BẢN NHÁP',
  '[CHECK:',
  '[KIỂM TRA:',
  '4242',
  '4444',
] as const;

const RAW_ENUM_LEAKS = [
  'SUSPECTED_HALLUCINATION',
  'METADATA_ERROR',
  'MISSING_REFERENCE',
  'IN_TEXT_MISMATCH',
] as const;

async function waitForRouteReady(
  page: Page,
  route: (typeof PUBLIC_AND_AUTH_ROUTES)[number],
): Promise<void> {
  switch (route) {
    case '/':
      await expect(page.getByTestId('guest-instant-checker')).toBeVisible();
      break;
    case '/pricing':
      await expect(page.getByTestId('plan-card-pro')).toBeVisible();
      break;
    case '/login':
    case '/register':
    case '/forgot-password':
      await expect(page.locator('form').first()).toBeVisible();
      break;
    case '/privacy':
      await expect(page.getByTestId('privacy-policy-page')).toBeVisible();
      break;
    case '/terms':
      await expect(page.getByTestId('terms-page')).toBeVisible();
      break;
    case '/missing-route-404':
      await expect(page.getByTestId('not-found-page')).toBeVisible();
      break;
  }
  await page.evaluate(() => document.fonts.ready);
}

async function assertZeroHorizontalOverflow(page: Page, contextLabel: string): Promise<void> {
  const metrics = await page.evaluate(
    () =>
      new Promise<{ scrollWidth: number; innerWidth: number }>((resolve) => {
        requestAnimationFrame(() => {
          resolve({
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
          });
        });
      }),
  );
  expect(
    metrics.scrollWidth,
    `Horizontal overflow on ${contextLabel}: scrollWidth=${metrics.scrollWidth} > innerWidth=${metrics.innerWidth}`,
  ).toBeLessThanOrEqual(metrics.innerWidth);
}

test.describe('CITRA UI/UX & Non-Tech Experience Overhaul — Master E2E Verification (Tasks 0.1–3.2)', () => {
  test('1. Zero Horizontal Overflow & Zero Console/Page Errors across 5 viewports × 8 routes × Light/Dark × EN/VI', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    clearAuthState(page);

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        consoleErrors.push(text);
      }
    });
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);

    for (const locale of ['en', 'vi'] as const) {
      for (const theme of ['light', 'dark'] as const) {
        await page.evaluate(
          ({ lang, mode }) => {
            localStorage.setItem('language', lang);
            localStorage.setItem('i18nextLng', lang);
            localStorage.setItem('theme', mode);
          },
          { lang: locale, mode: theme },
        );

        for (const route of PUBLIC_AND_AUTH_ROUTES) {
          await page.setViewportSize({ width: 1440, height: 900 });
          await page.goto(route);
          await waitForRouteReady(page, route);

          await expect
            .poll(() =>
              page.evaluate(() => document.documentElement.classList.contains('dark')),
            )
            .toBe(theme === 'dark');

          for (const vp of OVERHAUL_VIEWPORTS) {
            await page.setViewportSize({ width: vp.width, height: vp.height });
            await assertZeroHorizontalOverflow(
              page,
              `${route} [${locale.toUpperCase()} · ${theme}] @ ${vp.name}`,
            );
          }
        }
      }
    }

    expect(pageErrors, 'Expected zero uncaught pageerror exceptions').toEqual([]);
    expect(consoleErrors, 'Expected zero console.error messages').toEqual([]);
  });

  test('2. Above-the-Fold RegisterPage (1440x900, EN & VI), Email-First Auto-Username & LoginPage Eye SVG DOM Invariant', async ({
    page,
  }) => {
    clearAuthState(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto('/register');

    for (const locale of ['en', 'vi'] as const) {
      await page.evaluate((lang: string) => {
        localStorage.setItem('language', lang);
        localStorage.setItem('i18nextLng', lang);
        localStorage.setItem('theme', 'light');
      }, locale);

      await page.goto('/register');
      await page.evaluate(() => document.fonts.ready);

      // Verify scrollY === 0 and submit button is 100% above the 900px fold
      const scrollY = await page.evaluate(() => window.scrollY);
      expect(scrollY).toBe(0);

      const submitBtn = page.locator('form button[type="submit"]');
      await expect(submitBtn).toBeVisible();
      const box = await submitBtn.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBeGreaterThan(0);
      expect(
        box!.y + box!.height,
        `Register submit button bottom (${box!.y + box!.height}px) must fit <= 900px in ${locale.toUpperCase()}`,
      ).toBeLessThanOrEqual(900);

      // Verify AuthSplitShell left showcase has zero <button> elements
      const leftPanelButtonCount = await page.evaluate(() => {
        const form = document.querySelector('form');
        const allButtons = Array.from(document.querySelectorAll('button'));
        return allButtons.filter((btn) => {
          if (!form) return false;
          // Left panel precedes the right-side card/form in DOM order, excluding top-bar theme/lang controls inside right panel
          const pos = btn.compareDocumentPosition(form);
          const precedesForm = Boolean(pos & Node.DOCUMENT_POSITION_FOLLOWING);
          const hasSvg = Boolean(btn.querySelector('svg'));
          return precedesForm && hasSvg;
        }).length;
      });
      expect(leftPanelButtonCount).toBe(0);

      // Verify typing #email auto-populates sanitized #username (`student.kltn+2026@tdtu.edu.vn` -> `student.kltn_2026`)
      const emailInput = page.locator('#email');
      const usernameInput = page.locator('#username');
      await emailInput.fill('student.kltn+2026@tdtu.edu.vn');
      await expect(usernameInput).toHaveValue('student.kltn_2026');

      // Manual edit to #username locks out subsequent email auto-overwrites
      await usernameInput.fill('custom_scholar_26');
      await emailInput.fill('another.author+thesis@tdtu.edu.vn');
      await expect(usernameInput).toHaveValue('custom_scholar_26');

      // Verify statutory PDPL 91/2025/QH15 consent checkbox is unchecked by default and links to /privacy & /terms
      const consentCheckbox = page.getByTestId('register-privacy-consent-checkbox');
      await expect(consentCheckbox).not.toBeChecked();
      await expect(page.locator('form a[href="/privacy"]')).toBeVisible();
      await expect(page.locator('form a[href="/terms"]')).toBeVisible();

      // Verify LoginPage #password Eye button is the FIRST <button><svg> in DOM order + data-lang/lang + humanized AuthSplitShell
      await page.goto('/login');
      await page.evaluate(() => document.fonts.ready);

      const loginEditorialRoot = page.locator('.solva-editorial-root').first();
      await expect(loginEditorialRoot).toHaveAttribute('data-lang', locale);
      await expect(loginEditorialRoot).toHaveAttribute('lang', locale);

      const loginAudit = await page.evaluate(() => {
        const firstSvgInButton = document.querySelector('button svg');
        const firstSvgButton = firstSvgInButton?.closest('button') ?? null;
        const passwordInput = document.getElementById('password');
        const passwordWrapper = passwordInput?.parentElement ?? null;
        return {
          hasFirstSvgButton: Boolean(firstSvgButton),
          isInsidePasswordField: Boolean(
            firstSvgButton && passwordWrapper && passwordWrapper.contains(firstSvgButton),
          ),
          bodyText: document.body.innerText,
        };
      });
      expect(loginAudit.hasFirstSvgButton).toBe(true);
      expect(
        loginAudit.isInsidePasswordField,
        `Expected first <button><svg> on /login (${locale}) to be #password Eye toggle`,
      ).toBe(true);
      expect(loginAudit.bodyText).not.toContain('NLI:');
      expect(loginAudit.bodyText).not.toContain('expr:');

      if (locale === 'vi') {
        expect(loginAudit.bodyText).not.toContain('SSO · RBAC');
      }

      // Clicking that first SVG button toggles #password visibility cleanly
      const firstSvgBtn = page.locator('button:has(svg)').first();
      await expect(page.locator('#password')).toHaveAttribute('type', 'password');
      await firstSvgBtn.click();
      await expect(page.locator('#password')).toHaveAttribute('type', 'text');
    }
  });

  test('3. Commercial & Legal Trust Gate, Interactive 3-Role #workspaces (#workspaces-teacher) & /missing-route-404 Recovery', async ({
    page,
  }) => {
    clearAuthState(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    const trustRoutes = ['/', '/pricing', '/privacy', '/terms'] as const;

    for (const locale of ['en', 'vi'] as const) {
      await page.goto('/');
      await page.evaluate((lang: string) => {
        localStorage.setItem('language', lang);
        localStorage.setItem('i18nextLng', lang);
        localStorage.setItem('theme', 'light');
      }, locale);

      for (const route of trustRoutes) {
        await page.goto(route);
        await waitForRouteReady(page, route);

        // Expand every FAQ button one-by-one on / (#faq) and /pricing (#pricing-faq)
        if (route === '/' || route === '/pricing') {
          const faqContainer = page.locator(route === '/pricing' ? '#pricing-faq' : '#faq');
          const faqButtons = faqContainer.locator('button[aria-expanded]');
          const faqCount = await faqButtons.count();
          expect(
            faqCount,
            `Expected > 0 FAQ accordion buttons on ${route} (${locale})`,
          ).toBeGreaterThan(0);
          for (let i = 0; i < faqCount; i++) {
            const btn = faqButtons.nth(i);
            if ((await btn.getAttribute('aria-expanded')) === 'false') {
              await btn.click();
            }
            const faqText = await faqContainer.innerText();
            for (const forbidden of FORBIDDEN_TRUST_STRINGS) {
              expect(
                faqText,
                `FAQ item #${i} on ${route} (${locale}) must not expose "${forbidden}"`,
              ).not.toContain(forbidden);
            }
          }
        }

        if (route === '/pricing') {
          const pricingRoot = page.getByTestId('pricing-page');
          await expect(pricingRoot).toHaveAttribute('data-lang', locale);
          await expect(pricingRoot).toHaveAttribute('lang', locale);

          // Open desktop Platform / Nền tảng dropdown so its items are audited for non-tech parity too
          const pricingDropdownBtn = page
            .locator('nav[aria-label="Pricing Navigation"]')
            .getByRole('button', { name: /Platform|Nền tảng/i });
          await pricingDropdownBtn.click();
          await expect(page.locator('.t-dropdown.is-open').first()).toBeVisible();
        }

        const fullText = await page.evaluate(
          () => `${document.body.innerText}\n${document.body.textContent ?? ''}`,
        );

        for (const forbidden of FORBIDDEN_TRUST_STRINGS) {
          expect(
            fullText,
            `Route ${route} (${locale}) must not expose "${forbidden}" in production mode`,
          ).not.toContain(forbidden);
        }

        if (route === '/pricing') {
          for (const pricingJargon of [
            'GROBID TEI',
            'ONNX INT8',
            'SerpAPI',
            'mã DOI ảo giác',
            'Orthogonal Mapping',
            'Citation Debugger',
          ]) {
            expect(
              fullText,
              `/pricing (${locale}) must not expose raw technical jargon "${pricingJargon}"`,
            ).not.toContain(pricingJargon);
          }
          await page.keyboard.press('Escape');
        }

        if (route === '/' || route === '/pricing') {
          expect(fullText).toContain('© 2026 CITRA');
        }

        if (route === '/privacy') {
          const privacyRoot = page.getByTestId('privacy-policy-page');
          await expect(privacyRoot).toBeVisible();
          await expect(privacyRoot).toHaveAttribute('data-lang', locale);
          await expect(privacyRoot).toHaveAttribute('lang', locale);
          expect(fullText).toContain('91/2025/QH15');
          expect(fullText).toMatch(/356\/2025\/N[ĐD]-CP/);
          if (locale === 'vi') {
            expect(fullText).toContain('356/2025/NĐ-CP');
          }
          expect(fullText).toContain('iannwendii@gmail.com');
          expect(fullText).toContain('card_last4');
        }

        if (route === '/terms') {
          await expect(page.getByTestId('terms-page')).toBeVisible();
          expect(fullText).toContain('91/2025/QH15');
          expect(fullText).toContain('iannwendii@gmail.com');
        }
      }
    }

    // Verify interactive #workspaces 3-role tabs & #workspaces-teacher URL/Footer activation
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('language', 'en');
      localStorage.setItem('i18nextLng', 'en');
    });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);

    const workspacesSection = page.locator('#workspaces');
    await workspacesSection.scrollIntoViewIfNeeded();
    await expect(page.getByTestId('workspace-tab-student')).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await page.getByTestId('workspace-tab-admin').click();
    await expect(page.getByTestId('workspace-tab-admin')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('#workspace-panel-admin')).toBeVisible();

    // Click Footer Teacher Classroom link (`#workspaces-teacher`) -> activates teacher tab
    const footerTeacherLink = page
      .locator('footer a[href*="#workspaces-teacher"]')
      .first();
    await footerTeacherLink.scrollIntoViewIfNeeded();
    await footerTeacherLink.click();
    await expect(page.getByTestId('workspace-tab-teacher')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('#workspace-panel-teacher')).toBeVisible();

    // Direct navigation to `/#workspaces-teacher` from another route also activates teacher tab
    await page.goto('/pricing');
    await page.goto('/#workspaces-teacher');
    await expect(page.getByTestId('workspace-tab-teacher')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('#workspace-panel-teacher')).toBeVisible();

    // Verify /missing-route-404 ->/#try-instant quick card & "Back to Home" recovery
    await page.goto('/missing-route-404');
    const notFoundPage = page.getByTestId('not-found-page');
    await expect(notFoundPage).toBeVisible();
    await expect(notFoundPage).toContainText('/missing-route-404');
    await expect(notFoundPage.locator('a[href="/#try-instant"]')).toBeVisible();

    const backHomeCta = page.getByTestId('not-found-home-cta');
    await expect(backHomeCta).toContainText(/Back to Home|Về trang chủ/i);
    await backHomeCta.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('guest-instant-checker')).toBeVisible();
  });

  test('4. Live Unauthenticated GuestInstantChecker (#try-instant): 3 Presets, Custom Input, Split-View Diff, cited_doi Highlight, Trace Toggle & /register CTA at 1440x900 & 375x812 (<= 6 public-verify calls)', async ({
    browser,
  }) => {
    test.setTimeout(120_000);

    let totalPublicVerifyCalls = 0;

    // Budgeted to 4 calls (EN 1440x900: all 3 presets + 1 custom) + 2 calls (VI 375x812: ai_invented + 1 custom) = 6 <= 6/min Nginx IP limit
    const scenarios = [
      {
        viewport: { width: 1440, height: 900 },
        lang: 'en' as const,
        realIp: `203.0.113.${40 + Math.floor(Math.random() * 80)}`,
        submittedHeader: 'Submitted in Your Draft',
        officialHeader: 'Official Library Record',
        presets: [
          {
            testId: 'guest-preset-economics',
            expectedDoi: '10.2307/1914185',
          },
          {
            testId: 'guest-preset-biomedical',
            expectedDoi: '10.1056/NEJMoa2034577',
          },
          {
            testId: 'guest-preset-ai_invented',
            expectedDoi: '10.1093/qje/qjae994',
            expectHallucinationDoiClass: true,
          },
        ],
      },
      {
        viewport: { width: 375, height: 812 },
        lang: 'vi' as const,
        realIp: `198.51.100.${40 + Math.floor(Math.random() * 80)}`,
        submittedHeader: 'Trích dẫn bạn đưa vào',
        officialHeader: 'Hồ sơ gốc trên thư viện học thuật',
        presets: [
          {
            testId: 'guest-preset-ai_invented',
            expectedDoi: '10.1093/qje/qjae994',
            expectHallucinationDoiClass: true,
          },
        ],
      },
    ];

    for (const sc of scenarios) {
      const context = await browser.newContext({
        viewport: sc.viewport,
        extraHTTPHeaders: {
          'X-Real-IP': sc.realIp,
        },
      });
      const page = await context.newPage();
      clearAuthState(page);

      page.on('request', (req) => {
        if (
          req.url().includes('/api/essays/sandbox/public-verify') &&
          req.method() === 'POST'
        ) {
          totalPublicVerifyCalls += 1;
        }
      });

      await page.addInitScript((lang: string) => {
        localStorage.setItem('language', lang);
        localStorage.setItem('i18nextLng', lang);
        localStorage.setItem('theme', 'light');
      }, sc.lang);

      await page.goto('/');
      await page.evaluate(() => document.fonts.ready);

      const checker = page.getByTestId('guest-instant-checker');
      await checker.scrollIntoViewIfNeeded();
      await expect(checker).toBeVisible();

      // 1. Exercise budgeted one-click presets without authentication
      for (const preset of sc.presets) {
        const verifyRespPromise = page.waitForResponse(
          (resp) =>
            resp.url().includes('/api/essays/sandbox/public-verify') &&
            resp.request().method() === 'POST',
        );
        await checker.getByTestId(preset.testId).click();
        const verifyResp = await verifyRespPromise;
        expect(verifyResp.status()).toBe(200);

        const resultCard = checker.getByTestId('guest-checker-result-0');
        await expect(resultCard).toBeVisible();
        await expect(resultCard).toContainText(sc.submittedHeader);
        await expect(resultCard).toContainText(sc.officialHeader);

        const citedDoiChip = checker.getByTestId('guest-checker-cited-doi-0');
        await expect(citedDoiChip).toBeVisible();
        await expect(citedDoiChip).toContainText(preset.expectedDoi);
        if (preset.expectHallucinationDoiClass) {
          await expect(citedDoiChip).toHaveClass(/text-red-700|border-red-500/);
        }

        // Default collapsed result card never leaks raw uppercase enum identifiers
        const cardVisibleText = await resultCard.innerText();
        for (const rawEnum of RAW_ENUM_LEAKS) {
          expect(cardVisibleText).not.toContain(rawEnum);
        }
      }

      // 2. Test custom reference input -> live verification
      const customReference =
        'Acemoglu, D., Johnson, S., & Robinson, J. A. (2001). The colonial origins of comparative development: An empirical investigation. American Economic Review, 91(5), 1369-1401. https://doi.org/10.1257/aer.91.5.1369';
      const textarea = checker.locator('#guest-citations-textarea');
      await textarea.fill(customReference);

      const customVerifyPromise = page.waitForResponse(
        (resp) =>
          resp.url().includes('/api/essays/sandbox/public-verify') &&
          resp.request().method() === 'POST',
      );
      await checker.getByTestId('guest-checker-submit').click();
      const customResp = await customVerifyPromise;
      expect(customResp.status()).toBe(200);

      const customDoiChip = checker.getByTestId('guest-checker-cited-doi-0');
      await expect(customDoiChip).toBeVisible();
      await expect(customDoiChip).toContainText('10.1257/aer.91.5.1369');

      // 3. Expand & collapse progressive-disclosure Technical Rule Trace
      const traceToggle = checker.getByTestId('guest-checker-trace-toggle');
      const tracePanel = checker.getByTestId('guest-checker-trace-panel');
      await expect(traceToggle).toHaveAttribute('aria-expanded', 'false');
      await expect(tracePanel).toBeHidden();

      await traceToggle.click();
      await expect(traceToggle).toHaveAttribute('aria-expanded', 'true');
      await expect(tracePanel).toBeVisible();
      await expect(tracePanel).toContainText(/\bR[-0-9A-Z_]+/);

      await assertZeroHorizontalOverflow(
        page,
        `/#try-instant expanded trace (${sc.lang}) @ ${sc.viewport.width}x${sc.viewport.height}`,
      );

      await traceToggle.click();
      await expect(traceToggle).toHaveAttribute('aria-expanded', 'false');

      // 4. Verify full-document upload CTA points to /register and navigates cleanly
      const fullUploadCta = checker.getByTestId('guest-checker-full-upload-cta');
      await expect(fullUploadCta).toHaveAttribute('href', '/register');
      await fullUploadCta.click();
      await expect(page).toHaveURL(/\/register$/);

      await context.close();
    }

    expect(
      totalPublicVerifyCalls,
      'Total POST /api/essays/sandbox/public-verify calls must stay <= 6 for single-IP Nginx rate-limit safety',
    ).toBeLessThanOrEqual(6);
  });

  test('5. Mobile Pricing UX (375x812 & 390x844) & High-Contrast .solva-pro-card-surface in Light and Dark Modes', async ({
    page,
  }) => {
    clearAuthState(page);

    for (const vp of [
      { width: 375, height: 812, label: '375x812' },
      { width: 390, height: 844, label: '390x844' },
    ]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');
      await page.evaluate(() => document.fonts.ready);

      // Open mobile drawer on / and click mobile-menu-pricing-link -> /pricing
      const hamburgerBtn = page.getByRole('button', {
        name: /toggle navigation menu/i,
      });
      await expect(hamburgerBtn).toBeVisible();
      await hamburgerBtn.click();

      const mobilePricingLink = page.getByTestId('mobile-menu-pricing-link');
      await expect(mobilePricingLink).toBeVisible();
      await mobilePricingLink.click();
      await expect(page).toHaveURL(/\/pricing$/);
      await assertZeroHorizontalOverflow(page, `/pricing @ ${vp.label}`);

      for (const targetLang of ['EN', 'VI'] as const) {
        const langBtn = page.locator(
          'header button[title*="English"], header button[title*="Tiếng Việt"]',
        );
        if ((await langBtn.textContent())?.trim() !== targetLang) {
          await langBtn.click();
        }

        const compareMatrix = page.locator('#compare-matrix');
        await compareMatrix.scrollIntoViewIfNeeded();

        const tierTabs = page.getByTestId('mobile-compare-tier-tabs');
        await expect(tierTabs).toBeVisible();
        await expect(compareMatrix.locator('table')).toBeHidden();

        const tabs = tierTabs.getByRole('tab');
        await expect(tabs).toHaveCount(3);

        for (let idx = 0; idx < 3; idx++) {
          await tabs.nth(idx).click();
          await expect(tabs.nth(idx)).toHaveAttribute('aria-selected', 'true');

          const clipCheck = await page.evaluate(() => {
            const tablist = document.querySelector(
              '[data-testid="mobile-compare-tier-tabs"]',
            ) as HTMLElement;
            const panel = document.querySelector(
              '[data-testid="mobile-compare-tier-panel"]',
            ) as HTMLElement;
            const tabEls = Array.from(
              tablist.querySelectorAll<HTMLElement>('[role="tab"]'),
            );
            const clippedTabs = tabEls
              .filter((el) => el.scrollWidth > el.clientWidth + 1)
              .map((el) => el.textContent);
            return {
              clippedTabs,
              panelOverflows: panel.scrollWidth > panel.clientWidth + 1,
              minTabHeight: Math.min(
                ...tabEls.map((el) => el.getBoundingClientRect().height),
              ),
            };
          });
          expect(clipCheck.clippedTabs).toEqual([]);
          expect(clipCheck.panelOverflows).toBe(false);
          expect(clipCheck.minTabHeight).toBeGreaterThanOrEqual(44);
          await assertZeroHorizontalOverflow(
            page,
            `/pricing #compare-matrix tab ${idx} (${targetLang}) @ ${vp.label}`,
          );
        }
      }
    }

    // Verify .solva-pro-card-surface WCAG AAA/AA contrast in both Light & Dark modes on / and /pricing
    await page.setViewportSize({ width: 1440, height: 900 });

    const measureProCardContrast = () =>
      page.evaluate(() => {
        const parseRgba = (css: string): [number, number, number, number] => {
          const m = css.match(
            /rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\s*\)/i,
          );
          if (!m) return [0, 0, 0, 1];
          return [
            Number(m[1]),
            Number(m[2]),
            Number(m[3]),
            m[4] !== undefined ? Number(m[4]) : 1,
          ];
        };
        const relLum = ([r, g, b]: [number, number, number]) => {
          const ch = (v: number) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
          };
          return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
        };
        const contrast = (
          fg: [number, number, number],
          bg: [number, number, number],
        ) => {
          const l1 = relLum(fg);
          const l2 = relLum(bg);
          return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        };

        const surface = document.querySelector(
          '.solva-pro-card-surface',
        ) as HTMLElement | null;
        if (!surface) return null;

        const surfStyle = getComputedStyle(surface);
        const [sr, sg, sb, sa] = parseRgba(surfStyle.backgroundColor);

        const headingEl = surface.querySelector(
          'h2, h3, [data-testid="pro-price-display"], [data-testid="landing-price-pro"]',
        ) as HTMLElement | null;
        const bodyEl = surface.querySelector('p, li span') as HTMLElement | null;
        if (!headingEl || !bodyEl) return null;

        const [hr, hg, hb] = parseRgba(getComputedStyle(headingEl).color);
        const [br, bg, bb] = parseRgba(getComputedStyle(bodyEl).color);

        return {
          surfaceAlpha: sa,
          headingContrast: contrast([hr, hg, hb], [sr, sg, sb]),
          bodyContrast: contrast([br, bg, bb], [sr, sg, sb]),
        };
      });

    for (const route of ['/', '/pricing'] as const) {
      for (const theme of ['light', 'dark'] as const) {
        await page.goto(route);
        await page.evaluate((mode: string) => {
          localStorage.setItem('theme', mode);
          localStorage.setItem('language', 'vi');
          localStorage.setItem('i18nextLng', 'vi');
        }, theme);
        await page.goto(route);
        await page.evaluate(() => document.fonts.ready);

        await expect
          .poll(() =>
            page.evaluate(() => document.documentElement.classList.contains('dark')),
          )
          .toBe(theme === 'dark');

        const proSurface = page.locator('.solva-pro-card-surface').first();
        await proSurface.scrollIntoViewIfNeeded();
        await expect(proSurface).toBeVisible();

        const metrics = await measureProCardContrast();
        expect(metrics).not.toBeNull();
        expect(
          metrics!.surfaceAlpha,
          `.solva-pro-card-surface on ${route} (${theme}) must have high-opacity surface backing`,
        ).toBeGreaterThanOrEqual(0.92);
        expect(
          metrics!.headingContrast,
          `Heading/price contrast on ${route} (${theme})`,
        ).toBeGreaterThanOrEqual(10);
        expect(
          metrics!.bodyContrast,
          `Body copy contrast on ${route} (${theme})`,
        ).toBeGreaterThanOrEqual(4.5);

        if (route === '/pricing') {
          await expect(page.getByTestId('pro-price-display')).toHaveText(
            /^\$(16|20)$/,
          );
          await expect(page.getByTestId('pro-vnd-equivalent')).toBeVisible();
        } else {
          await expect(page.getByTestId('landing-price-pro')).toHaveText(
            /^\$(16|20)$/,
          );
        }
      }
    }
  });

  test('6. Non-Tech Copy Clarity, Progressive Disclosure Toggles & Desktop Platform Dropdown Keyboard/Pointer Dismissal', async ({
    page,
  }) => {
    clearAuthState(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.addInitScript(() => {
      localStorage.setItem('language', 'en');
      localStorage.setItem('i18nextLng', 'en');
      localStorage.setItem('theme', 'light');
    });

    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);

    const root = page.locator('.solva-editorial-root');
    await expect(root).toHaveAttribute('data-lang', 'en');
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.classList.contains('dark')),
      )
      .toBe(false);

    // 1. Toggle Light -> Dark -> System -> Light via header ThemeToggle
    const themeToggleBtn = page
      .locator('header button[aria-label*="Current theme"]')
      .first();
    await expect(themeToggleBtn).toBeVisible();
    await themeToggleBtn.click(); // light -> dark
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.classList.contains('dark')),
      )
      .toBe(true);
    await themeToggleBtn.click(); // dark -> system
    await themeToggleBtn.click(); // system -> light
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.classList.contains('dark')),
      )
      .toBe(false);

    // 2. Verify zero raw uppercase enum leaks on collapsed marketing surfaces in EN, then toggle to VI and verify again
    for (const expectedLang of ['en', 'vi'] as const) {
      if (expectedLang === 'vi') {
        const langBtn = page.locator('header button[title*="Tiếng Việt"]').first();
        await expect(langBtn).toBeVisible();
        await langBtn.click();
      }
      await expect(root).toHaveAttribute('data-lang', expectedLang);

      // Ensure technical drawers are collapsed before auditing primary marketing copy
      await expect(page.getByTestId('debugger-technical-trace-toggle')).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      await expect(
        page.getByTestId('benchmark-technical-details-toggle'),
      ).toHaveAttribute('aria-expanded', 'false');

      const visibleMarketingText = await page.evaluate(() => document.body.innerText);
      for (const rawEnum of RAW_ENUM_LEAKS) {
        expect(
          visibleMarketingText,
          `Collapsed LandingPage (${expectedLang}) must not leak raw enum "${rawEnum}"`,
        ).not.toContain(rawEnum);
      }
    }

    // 3. Verify progressive-disclosure toggles (`debugger-technical-trace-toggle` & `benchmark-technical-details-toggle`) expand cleanly
    const debuggerSection = page.locator('#interactive-demo');
    await debuggerSection.scrollIntoViewIfNeeded();
    const debuggerTraceToggle = debuggerSection.getByTestId(
      'debugger-technical-trace-toggle',
    );
    await expect(debuggerTraceToggle).toHaveAttribute('aria-expanded', 'false');
    await debuggerTraceToggle.click();
    await expect(debuggerTraceToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(debuggerSection).toContainText(/R0[1-9]|R[12][0-9]|R30/);
    await debuggerTraceToggle.click();
    await expect(debuggerTraceToggle).toHaveAttribute('aria-expanded', 'false');

    const benchSection = page.getByTestId('benchmark-120k-section');
    await benchSection.scrollIntoViewIfNeeded();
    const benchToggle = benchSection.getByTestId('benchmark-technical-details-toggle');
    await expect(benchToggle).toHaveAttribute('aria-expanded', 'false');
    await benchToggle.click();
    await expect(benchToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(benchSection.getByRole('tab')).toHaveCount(3);
    await benchToggle.click();
    await expect(benchToggle).toHaveAttribute('aria-expanded', 'false');

    // 4. Verify desktop Platform / Nền tảng dropdown dismisses on Escape (restoring focus) and on outside click
    await page.evaluate(() => window.scrollTo(0, 0));
    const navTrigger = page
      .getByRole('button', { name: /Platform|Nền tảng/i })
      .first();
    await expect(navTrigger).toBeVisible();

    await navTrigger.click();
    await expect(page.locator('.t-dropdown.is-open').first()).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('.t-dropdown')).toHaveCount(0, { timeout: 2000 });
    await expect(navTrigger).toBeFocused();

    await navTrigger.click();
    await expect(page.locator('.t-dropdown.is-open').first()).toBeVisible();
    await page.mouse.click(24, 240);
    await expect(page.locator('.t-dropdown')).toHaveCount(0, { timeout: 2000 });
  });
});
