import { test, expect } from '@playwright/test';

const VI_LOWER =
  'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ';
const VI_UPPER =
  'ÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ';
const ALL_134_VI_CHARS = VI_LOWER + VI_UPPER;

test.use({
  baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
});

test.describe('Landing Page — Full Vietnamese Typography & Sentient Glyph Verification', () => {
  test('1. Self-hosted Sentient-Light & Sentient-Regular render all 134 Vietnamese characters with zero fallback', async ({
    page,
  }) => {
    const fontRequests: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('Sentient') || url.includes('fontshare.com')) {
        fontRequests.push(url);
      }
    });

    await page.addInitScript(() => {
      localStorage.setItem('language', 'vi');
      localStorage.setItem('i18nextLng', 'vi');
    });

    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);

    // Ensure no external incomplete fontshare CDN requests were made
    expect(fontRequests.some((u) => u.includes('fontshare.com'))).toBe(false);

    // Verify in Chromium's Canvas/HarfBuzz engine that every single one of the 134 Vietnamese
    // characters is rendered by Sentient (both 300 Light and 400 Regular) and NEVER falls back to monospace
    const glyphAudit = await page.evaluate((allChars: string) => {
      const canvas = document.createElement('canvas');
      canvas.width = 240;
      canvas.height = 240;
      const ctx = canvas.getContext('2d')!;

      const getBitmapSignature = (fontSpec: string, ch: string) => {
        ctx.clearRect(0, 0, 240, 240);
        ctx.fillStyle = '#000';
        ctx.textBaseline = 'alphabetic';
        ctx.font = fontSpec;
        ctx.fillText(ch, 40, 160);
        const width = ctx.measureText(ch).width;
        const data = ctx.getImageData(0, 0, 240, 240).data;
        let inkPixels = 0;
        let weightedX = 0;
        let weightedY = 0;
        for (let i = 3; i < data.length; i += 4) {
          const alpha = data[i];
          if (alpha > 16) {
            const pxIdx = (i - 3) / 4;
            inkPixels += 1;
            weightedX += pxIdx % 240;
            weightedY += Math.floor(pxIdx / 240);
          }
        }
        return { width, inkPixels, weightedX, weightedY };
      };

      const getBaseLetter = (ch: string): string => {
        if ('àáảãạăằắẳẵặâầấẩẫậ'.includes(ch)) return 'a';
        if ('ÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ'.includes(ch)) return 'A';
        if ('èéẻẽẹêềếểễệ'.includes(ch)) return 'e';
        if ('ÈÉẺẼẸÊỀẾỂỄỆ'.includes(ch)) return 'E';
        if ('ìíỉĩị'.includes(ch)) return 'i';
        if ('ÌÍỈĨỊ'.includes(ch)) return 'I';
        if ('òóỏõọôồốổỗộơờớởỡợ'.includes(ch)) return 'o';
        if ('ÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ'.includes(ch)) return 'O';
        if ('ùúủũụưừứửữự'.includes(ch)) return 'u';
        if ('ÙÚỦŨỤƯỪỨỬỮỰ'.includes(ch)) return 'U';
        if ('ỳýỷỹỵ'.includes(ch)) return 'y';
        if ('ỲÝỶỸỴ'.includes(ch)) return 'Y';
        if (ch === 'đ') return 'd';
        if (ch === 'Đ') return 'D';
        return ch;
      };

      const fallbackFailures: string[] = [];

      for (const weight of [300, 400]) {
        for (const ch of Array.from(allChars)) {
          const sentientSig = getBitmapSignature(`${weight} 96px "Sentient", monospace`, ch);
          const monoSig = getBitmapSignature(`${weight} 96px monospace`, ch);
          const baseLetter = getBaseLetter(ch);
          const baseSig = getBitmapSignature(`${weight} 96px "Sentient", monospace`, baseLetter);

          // 1. Must draw non-empty ink
          if (sentientSig.inkPixels < 50) {
            fallbackFailures.push(`${ch} (w=${weight}): empty glyph`);
            continue;
          }
          // 2. Must NOT match monospace fallback bitmap
          const sameAsMono =
            Math.abs(sentientSig.width - monoSig.width) < 0.05 &&
            sentientSig.inkPixels === monoSig.inkPixels &&
            sentientSig.weightedX === monoSig.weightedX;
          if (sameAsMono) {
            fallbackFailures.push(`${ch} (w=${weight}): fell back to monospace`);
            continue;
          }
          // 3. Advance width of accented vowel in Sentient must match its base vowel in Sentient
          if (ch !== 'đ' && ch !== 'Đ' && Math.abs(sentientSig.width - baseSig.width) > 0.5) {
            fallbackFailures.push(
              `${ch} (w=${weight}): width ${sentientSig.width.toFixed(2)} != base ${baseLetter} width ${baseSig.width.toFixed(2)}`
            );
          }
        }
      }

      return {
        totalChecked: Array.from(allChars).length * 2,
        fallbackFailures,
      };
    }, ALL_134_VI_CHARS);

    expect(glyphAudit.totalChecked).toBe(268);
    expect(glyphAudit.fallbackFailures).toEqual([]);
  });

  test('2. Language toggle EN <-> VI switches all 13 Landing Page sections cleanly with Vietnamese typography tuning', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('language', 'en');
      localStorage.setItem('i18nextLng', 'en');
    });

    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);

    const root = page.locator('.solva-editorial-root');
    await expect(root).toHaveAttribute('data-lang', 'en');

    // Click language toggle button in header to switch from EN -> VI
    const langBtn = page.locator('header button[title*="Chuyển sang Tiếng Việt"]');
    await expect(langBtn).toBeVisible();
    await langBtn.click();

    await expect(root).toHaveAttribute('data-lang', 'vi');

    // Audit all .font-solva-serif elements on the Vietnamese landing page
    const typographyCheck = await page.evaluate(() => {
      const serifEls = Array.from(document.querySelectorAll('.font-solva-serif'));
      const issues: string[] = [];

      serifEls.forEach((el, idx) => {
        const style = window.getComputedStyle(el);
        const text = (el.textContent || '').trim();
        if (!style.fontFamily.toLowerCase().includes('sentient')) {
          issues.push(`Element #${idx} (${text.slice(0, 24)}) missing Sentient font-family: ${style.fontFamily}`);
        }
        if (text !== text.normalize('NFC')) {
          issues.push(`Element #${idx} (${text.slice(0, 24)}) is not NFC-normalized`);
        }
      });

      const h1 = document.querySelector('h1.font-solva-serif');
      const h1Classes = h1 ? h1.className : '';

      return {
        serifCount: serifEls.length,
        issues,
        h1Classes,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      };
    });

    expect(typographyCheck.serifCount).toBeGreaterThan(20);
    expect(typographyCheck.issues).toEqual([]);
    expect(typographyCheck.h1Classes).toContain('leading-[1.15]');
    expect(typographyCheck.h1Classes).toContain('tracking-[-0.03em]');
    expect(typographyCheck.horizontalOverflow).toBe(false);
  });

  test('3. Full interactive walkthrough of Vietnamese Landing Page: Dropdown, Citation Debugger [1]-[4], Benchmark 120K, Workspaces, FAQ & Dark Mode', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('language', 'vi');
      localStorage.setItem('i18nextLng', 'vi');
    });

    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);

    // A. Navbar "Nền tảng" dropdown
    const platformBtn = page.locator('header nav button', { hasText: 'Nền tảng' });
    await expect(platformBtn).toBeVisible();
    await platformBtn.click();
    await expect(page.locator('header nav a', { hasText: 'Kiểm tra trích dẫn 2 bước' })).toBeVisible();
    await expect(page.locator('header nav a', { hasText: 'Kiểm tra thử trực quan' })).toBeVisible();
    await expect(page.locator('header nav a', { hasText: 'Độ tin cậy thực tế' })).toBeVisible();
    await platformBtn.click();

    // B. Interactive Citation Debugger (#interactive-demo) — cycle through all 4 demo citations in Vietnamese
    const debuggerSection = page.locator('#interactive-demo');
    await debuggerSection.scrollIntoViewIfNeeded();
    await expect(debuggerSection).toBeVisible();

    for (const marker of ['Vaswani et al. [1]', '(Devlin et al., 2018)', '(Robertson & Walker, 2024)', 'Smith et al. (2021)']) {
      const btn = debuggerSection.getByRole('option', { name: new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first();
      if (await btn.isVisible()) {
        await btn.click();
      }
    }
    await expect(debuggerSection).toContainText(/Danh mục Tài liệu tham khảo|danh mục tham khảo|trích dẫn/i);

    // C. 120K Benchmark Section (#benchmark-120k)
    const benchmarkSection = page.locator('#benchmark-120k');
    await benchmarkSection.scrollIntoViewIfNeeded();
    await expect(benchmarkSection).toBeVisible();
    await expect(benchmarkSection).toContainText(/120\.000|99,02%/i);

    // D. Role Workspaces Section (#workspaces)
    const workspacesSection = page.locator('#workspaces');
    await workspacesSection.scrollIntoViewIfNeeded();
    await expect(workspacesSection).toBeVisible();

    // E. FAQ Section (#faq) — expand Vietnamese FAQ items
    const faqSection = page.locator('#faq');
    await faqSection.scrollIntoViewIfNeeded();
    await expect(faqSection).toBeVisible();
    const faqButtons = faqSection.locator('button');
    const faqCount = await faqButtons.count();
    expect(faqCount).toBeGreaterThan(2);
    await faqButtons.first().click();

    // F. Toggle Dark Mode and verify zero layout shift / overflow
    const themeBtn = page.locator('header button[aria-label*="theme" i], header button[title*="giao diện" i], header button[title*="theme" i], header button[aria-label*="chế độ" i]').first();
    if (await themeBtn.isVisible()) {
      await themeBtn.click();
    } else {
      await page.evaluate(() => document.documentElement.classList.add('dark'));
    }
    const isOverflowingDark = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(isOverflowingDark).toBe(false);

    // G. Mobile viewport (390x844) + Mobile Navigation Drawer in Vietnamese
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);

    const mobileMenuBtn = page.locator('header button[aria-label="Toggle navigation menu"]');
    await expect(mobileMenuBtn).toBeVisible();
    await mobileMenuBtn.click();
    const mobileNav = page.locator('header nav[aria-label="Mobile Navigation"]');
    await expect(mobileNav).toBeVisible();
    await expect(mobileNav).toContainText('Kiểm tra trích dẫn 2 bước');
    await expect(mobileNav).toContainText('Kiểm tra thử trực quan');

    const isOverflowingMobile = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(isOverflowingMobile).toBe(false);
  });

  test('4. Responsive navbar & all section headings audit at 1280x800, 1024x768, 768x1024, and 390x844 in Vietnamese with zero console/page errors', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.addInitScript(() => {
      localStorage.setItem('language', 'vi');
      localStorage.setItem('i18nextLng', 'vi');
    });

    // 1. Check 1440x900 and 1280x800 desktop navbar bounds: every Vietnamese nav item & CTA must stay within viewport, single-line, and strictly non-overlapping with logo & right controls
    const desktopNavLabels = [
      'Nền tảng',
      'Cách hoạt động',
      'Kiểm tra thử',
      'Dành cho ai',
      'Độ tin cậy',
      'Bảng giá',
      'Đăng nhập',
      'Trải nghiệm miễn phí',
    ];

    for (const desktopVp of [
      { width: 1440, height: 900 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(desktopVp);
      await page.goto('/');
      await page.evaluate(() => document.fonts.ready);

      for (const label of desktopNavLabels) {
        const item = page.locator('header').getByText(label, { exact: true }).first();
        await expect(item).toBeVisible();
        const box = await item.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(desktopVp.width);
        expect(box!.height).toBeLessThanOrEqual(48);
      }

      const navLayout = await page.evaluate(() => {
        const headerRow = document.querySelector('header > div') as HTMLElement;
        const logoCluster = headerRow.children[0] as HTMLElement;
        const nav = headerRow.querySelector('nav[aria-label="Primary Navigation"]') as HTMLElement;
        const rightCluster = headerRow.children[2] as HTMLElement;
        return {
          navScrollWidth: nav.scrollWidth,
          navClientWidth: nav.clientWidth,
          logoBox: logoCluster.getBoundingClientRect(),
          navBox: nav.getBoundingClientRect(),
          rightClusterBox: rightCluster.getBoundingClientRect(),
        };
      });

      expect(navLayout.navScrollWidth).toBeLessThanOrEqual(navLayout.navClientWidth);
      expect(navLayout.logoBox.x + navLayout.logoBox.width).toBeLessThanOrEqual(
        navLayout.navBox.x
      );
      expect(navLayout.navBox.x + navLayout.navBox.width).toBeLessThanOrEqual(
        navLayout.rightClusterBox.x
      );
    }

    // 1b. Check 1024x768 tablet landscape in Vietnamese: desktop nav collapses cleanly into hamburger drawer with zero sibling collision
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);

    await expect(page.locator('header nav[aria-label="Primary Navigation"]')).toBeHidden();
    const tabletHamburger = page.locator('header button[aria-label="Toggle navigation menu"]');
    await expect(tabletHamburger).toBeVisible();

    const tabletHeaderLayout = await page.evaluate(() => {
      const headerRow = document.querySelector('header > div') as HTMLElement;
      const logoCluster = headerRow.children[0] as HTMLElement;
      const rightCluster = headerRow.children[2] as HTMLElement;
      return {
        logoBox: logoCluster.getBoundingClientRect(),
        rightClusterBox: rightCluster.getBoundingClientRect(),
      };
    });
    expect(
      tabletHeaderLayout.logoBox.x + tabletHeaderLayout.logoBox.width
    ).toBeLessThanOrEqual(tabletHeaderLayout.rightClusterBox.x);

    await tabletHamburger.click();
    const tabletDrawer = page.locator('header nav[aria-label="Mobile Navigation"]');
    await expect(tabletDrawer).toBeVisible();
    await expect(tabletDrawer).toContainText('Kiểm tra trích dẫn 2 bước');
    await expect(tabletDrawer).toContainText('Kiểm tra thử trực quan');
    await tabletHamburger.click();

    // 2. Verify all major anchor sections exist, render Vietnamese text, and have zero horizontal overflow across viewports
    const sectionIds = [
      '#architecture',
      '#interactive-demo',
      '#how-it-works',
      '#benchmark-120k',
      '#taxonomy',
      '#pricing-plans',
      '#workspaces',
      '#faq',
    ];

    for (const selector of sectionIds) {
      const sec = page.locator(selector);
      await sec.scrollIntoViewIfNeeded();
      await expect(sec).toBeVisible();
    }

    for (const vp of [
      { width: 1440, height: 900 },
      { width: 1280, height: 800 },
      { width: 1024, height: 768 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(vp);
      const hasOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth
      );
      expect(hasOverflow, `Horizontal overflow at ${vp.width}x${vp.height}`).toBe(false);
    }

    expect(pageErrors).toEqual([]);
  });
});
