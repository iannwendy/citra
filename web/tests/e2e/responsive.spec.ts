import { test, expect, Page } from '@playwright/test';
import { setupAuthenticatedPage, clearAuthState } from './helpers';

/**
 * Full Responsive E2E Test Suite (Tablet & Mobile)
 *
 * Verifies:
 * 1. Zero horizontal overflow (`document.documentElement.scrollWidth <= window.innerWidth`)
 *    across Mobile (375x812, 414x896) and Tablet (768x1024, 1024x768).
 * 2. LandingPage mobile navigation drawer & interactive citation debugger on 375x812.
 * 3. AppLayout sticky mobile/tablet header bar & slide-over navigation drawer on 375x812 & 768x1024.
 * 4. Single-DOM responsive table-to-card layout on Dashboard, AccountManagement, AuditLog, and EssayPage.
 * 5. Citation Debugger IDE & diagnostic pages on Mobile and Tablet.
 * 6. Modals & Dialogs (HelpModal, UserFormDialog, CreateClassDialog) fitting within 375x812 viewport.
 */

const VIEWPORTS = [
  { name: 'Mobile Small (375x812)', width: 375, height: 812 },
  { name: 'Mobile Large (414x896)', width: 414, height: 896 },
  { name: 'Tablet Portrait (768x1024)', width: 768, height: 1024 },
  { name: 'Tablet Landscape (1024x768)', width: 1024, height: 768 },
] as const;

function setupAllResponsiveMocks(page: Page): void {
  setupAuthenticatedPage(page);

  // Mock Teacher endpoints (/api/teacher/*)
  page.route('**/api/teacher/dashboard', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        total_classes: 2,
        total_students: 28,
        total_essays: 64,
        pending_reviews: 3,
        classes: [
          {
            id: 10,
            name: 'CS101 Academic Writing',
            description: 'Fall 2026 Research Methods Cohort',
            teacher_id: 1,
            join_code: 'CITRA-1010',
            created_at: '2026-09-01T00:00:00Z',
            student_count: 18,
            essay_count: 42,
          },
          {
            id: 11,
            name: 'AI402 Deep Learning Seminar',
            description: 'Graduate seminar on neural citation verification',
            teacher_id: 1,
            join_code: 'CITRA-1011',
            created_at: '2026-09-05T00:00:00Z',
            student_count: 10,
            essay_count: 22,
          },
        ],
      }),
    })
  );

  page.route('**/api/teacher/classes', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 10,
            name: 'CS101 Academic Writing',
            description: 'Fall 2026 Research Methods Cohort',
            teacher_id: 1,
            join_code: 'CITRA-1010',
            created_at: '2026-09-01T00:00:00Z',
            student_count: 18,
            essay_count: 42,
          },
        ]),
      });
    } else {
      route.continue();
    }
  });

  page.route('**/api/teacher/enrolled-classes', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  );

  page.route('**/api/teacher/classes/10/students', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 2, username: 'john_doe', full_name: 'John Doe', email: 'john@example.com' },
      ]),
    })
  );

  page.route('**/api/teacher/classes/10/essays', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 1,
          filename: 'BERT_Pre-training.pdf',
          num_pages: 16,
          uploaded_at: '2026-09-10T10:00:00Z',
          user_id: 2,
          username: 'john_doe',
        },
      ]),
    })
  );

  page.route('**/api/teacher/classes/10/analytics', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        class_id: 10,
        class_name: 'CS101 Academic Writing',
        total_students: 18,
        total_essays: 42,
        average_cis: 91.4,
        verdict_breakdown: {
          verified: 310,
          metadata_error: 24,
          suspected_hallucination: 5,
          unresolved: 8,
          resource: 12,
        },
        shared_hallucinations: [],
      }),
    })
  );

  page.route('**/api/teacher/classes/10/pending-reviews', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          verdict_id: 101,
          essay_id: 1,
          filename: 'BERT_Pre-training.pdf',
          student_username: 'john_doe',
          citation_raw: 'Vaswani et al. (2019)',
          label: 'metadata_error',
          confidence: 0.76,
          reasoning: 'Publication year mismatch (cited 2019 vs canonical 2017).',
        },
      ]),
    })
  );

  // Mock Admin endpoints
  page.route('**/api/users', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 1,
            username: 'admin',
            email: 'admin@example.com',
            full_name: 'Administrator',
            institution: 'Faculty of IT',
            role: 'admin',
            is_active: true,
            avatar_url: null,
            last_login_at: '2026-01-01T00:00:00Z',
            created_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 2,
            username: 'john_doe',
            email: 'john@example.com',
            full_name: 'John Doe',
            institution: 'CS101 Cohort',
            role: 'user',
            is_active: true,
            avatar_url: null,
            last_login_at: '2026-01-02T00:00:00Z',
            created_at: '2026-01-01T00:00:00Z',
          },
        ]),
      });
    } else {
      route.continue();
    }
  });

  const auditEntries = [
    {
      id: 1,
      verdict_id: 101,
      user: 'admin',
      original_label: 'suspected_hallucination',
      new_label: 'metadata_error',
      note: 'Verified conference preprint year discrepancy',
      logged_at: '2026-01-15T12:00:00Z',
    },
  ];
  page.route('**/api/audit/logs*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(auditEntries),
    })
  );
  page.route('**/api/audit/log*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(auditEntries),
    })
  );
  page.route('**/api/audit/stats*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        total_overrides: 1,
        by_user: { admin: 1 },
        by_new_label: { metadata_error: 1 },
      }),
    })
  );

  page.route('**/api/system/health', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        totals: {
          users: 42,
          admins: 2,
          teachers: 6,
          students: 34,
          essays: 128,
          verdicts: 1840,
        },
        verdict_label_counts: {
          verified: 1520,
          metadata_error: 210,
          suspected_hallucination: 65,
          unresolved: 45,
        },
      }),
    })
  );

  // Mock Document Inspector endpoint
  page.route(/\/api\/essays\/\d+\/inspector/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        essay_id: 1,
        filename: 'BERT_Pre-training.pdf',
        full_text:
          'Recent advances in transformer architectures (Vaswani et al., 2017) have enabled bidirectional language representations.',
        citations: [
          {
            occurrence_id: 'o1',
            marker: '(Vaswani et al., 2017)',
            start_char: 46,
            end_char: 68,
            verdict_label: 'verified',
            confidence: 0.98,
            reference_id: 'r1',
          },
        ],
        references: [
          {
            reference_id: 'r1',
            raw_text:
              'Vaswani, A., Shazeer, N., Parmar, N., et al. (2017). Attention Is All You Need. NeurIPS.',
            title: 'Attention Is All You Need',
            authors: ['Ashish Vaswani', 'Noam Shazeer'],
            year: 2017,
            doi: '10.48550/arXiv.1706.03762',
            is_cited: true,
            citation_count: 1,
          },
        ],
      }),
    })
  );
}

async function assertNoHorizontalOverflow(page: Page, routeName: string) {
  const overflow = await page.evaluate(() => {
    const docWidth = document.documentElement.scrollWidth;
    const winWidth = window.innerWidth;
    const main = document.getElementById('main-content');
    const mainScrollWidth = main ? main.scrollWidth : 0;
    const mainClientWidth = main ? main.clientWidth : 0;
    const mainOverflow = main ? mainScrollWidth > mainClientWidth : false;
    return {
      docWidth,
      winWidth,
      mainScrollWidth,
      mainClientWidth,
      hasOverflow: docWidth > winWidth || mainOverflow,
    };
  });
  expect(
    overflow.hasOverflow,
    `Expected no horizontal overflow on ${routeName} (doc=${overflow.docWidth}/${overflow.winWidth}, main=${overflow.mainScrollWidth}/${overflow.mainClientWidth})`
  ).toBe(false);
}

test.describe('Responsive Layout — Public & Auth Pages', () => {
  for (const vp of VIEWPORTS) {
    test(`renders public & auth routes without horizontal overflow at ${vp.name}`, async ({
      page,
    }) => {
      clearAuthState(page);
      await page.setViewportSize({ width: vp.width, height: vp.height });

      const publicRoutes = ['/', '/login', '/register', '/forgot-password'];
      for (const route of publicRoutes) {
        await page.goto(route);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(300);
        await assertNoHorizontalOverflow(page, `${route} @ ${vp.name}`);
      }
    });
  }

  test('LandingPage mobile menu drawer opens, closes, and interactive debugger tabs switch on 375x812', async ({
    page,
  }) => {
    clearAuthState(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Open mobile navigation menu on LandingPage
    const menuBtn = page.getByRole('button', { name: /toggle navigation menu/i });
    await expect(menuBtn).toBeVisible();
    await menuBtn.click();

    // Mobile drawer links should be visible
    await expect(page.getByRole('link', { name: /2-layer architecture|kiến trúc 2 tầng/i }).first()).toBeVisible();

    // Close mobile navigation menu
    await menuBtn.click();

    // Switch interactive Citation Debugger tabs on mobile (375px)
    const rulesTab = page.getByRole('tab', { name: /2\.\s*symbolic rules/i });
    await rulesTab.click();
    await assertNoHorizontalOverflow(page, '/ (Symbolic Rules tab) @ 375x812');

    const retrievalTab = page.getByRole('tab', { name: /3\.\s*source retrieval/i });
    await retrievalTab.click();
    await assertNoHorizontalOverflow(page, '/ (Source Retrieval tab) @ 375x812');
  });

  test('Solva Editorial LandingPage 12-section interactive states, pipeline tabs, taxonomy switch, and FAQ accordion work cleanly', async ({
    page,
  }) => {
    clearAuthState(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify all local painterly assets load with naturalWidth > 0
    const brokenImages = await page.evaluate(async () => {
      const imgs = Array.from(document.querySelectorAll('img'));
      await Promise.all(
        imgs.map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise<void>((res) => {
                img.addEventListener('load', () => res(), { once: true });
                img.addEventListener('error', () => res(), { once: true });
              })
        )
      );
      return imgs
        .filter((img) => !img.complete || img.naturalWidth === 0)
        .map((img) => img.getAttribute('src'));
    });
    expect(brokenImages).toEqual([]);

    // 1. Test Platform dropdown open & close
    const platformBtn = page.getByRole('button', { name: /platform|nền tảng/i });
    await expect(platformBtn).toBeVisible();
    await platformBtn.click();
    await expect(page.getByText(/orthogonal mapping & verification|tách biệt mapping/i)).toBeVisible();

    // 1.5. Test 120K-Paper Benchmark section & interactive 3-tab explorer
    await expect(page.getByTestId('hero-benchmark-120k-strip')).toBeVisible();
    const benchSection = page.getByTestId('benchmark-120k-section');
    await expect(benchSection).toBeVisible();
    await expect(benchSection.getByText(/B5 · HybridMLScorer/i)).toBeVisible();

    const classesTab = benchSection.getByRole('tab', {
      name: /4 classes & 15 sub-taxonomies|4 nhãn & 15 nhóm lỗi/i,
    });
    await classesTab.click();
    await expect(benchSection.getByText(/SUSPECTED_HALLUCINATION/i)).toBeVisible();

    const calibrationTab = benchSection.getByRole('tab', {
      name: /platt calibration & 95% ci|hiệu chỉnh platt & bootstrap 95% ci/i,
    });
    await calibrationTab.click();
    await expect(benchSection.getByText(/0\.0433/i).first()).toBeVisible();

    // 2. Test Use Cases / Pipeline 4-tab switcher
    const stage3Btn = page.getByRole('tab', { name: /neuro-symbolic rules|3\. luật neuro-symbolic/i });
    await stage3Btn.click();
    await expect(page.getByText(/STAGE 03/i)).toBeVisible();

    // 3. Test Pricing Plans & Benefits squircle billing switch (Monthly $20 -> Yearly -20% $16)
    const billingSwitch = page.getByRole('switch', { name: /toggle billing cycle/i });
    await expect(billingSwitch).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText('$20', { exact: true })).toBeVisible();
    await billingSwitch.click();
    await expect(billingSwitch).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('$16', { exact: true })).toBeVisible();

    // 4. Verify macOS red, yellow, green window controls exist in Hero & Debugger
    await expect(page.getByLabel('macOS window controls')).toHaveCount(2);

    // 4. Test FAQ 2-column independent accordion
    const faqItem2 = page.getByRole('button', {
      name: /how does the two-layer orthogonal output model work|mô hình 2 tầng trực giao/i,
    });
    await expect(faqItem2).toHaveAttribute('aria-expanded', 'false');
    await faqItem2.click();
    await expect(faqItem2).toHaveAttribute('aria-expanded', 'true');

    await assertNoHorizontalOverflow(page, '/ (Solva Desktop 1440x900)');
  });

  test('Scholarly source logos in Hero Ticker, Mockup Widgets, and Citation Debugger link to official project homepages across Mobile, Tablet, and Desktop', async ({
    page,
  }) => {
    clearAuthState(page);

    const expectedTickerLinks: Array<{ slug: string; href: string }> = [
      { slug: 'crossref', href: 'https://www.crossref.org' },
      { slug: 'openalex', href: 'https://openalex.org' },
      { slug: 'semantic-scholar', href: 'https://www.semanticscholar.org' },
      { slug: 'pubmed-ncbi', href: 'https://pubmed.ncbi.nlm.nih.gov' },
      { slug: 'arxiv', href: 'https://arxiv.org' },
      { slug: 'europe-pmc', href: 'https://europepmc.org' },
      { slug: 'dblp', href: 'https://dblp.org' },
      { slug: 'doaj', href: 'https://doaj.org' },
      { slug: 'orcid', href: 'https://orcid.org' },
      { slug: 'unpaywall', href: 'https://unpaywall.org' },
      { slug: 'datacite', href: 'https://datacite.org' },
      { slug: 'grobid-tei', href: 'https://grobid.readthedocs.io' },
    ];

    for (const vp of [
      { name: 'Mobile (375x812)', width: 375, height: 812 },
      { name: 'Tablet Portrait (768x1024)', width: 768, height: 1024 },
      { name: 'Tablet Landscape (1024x768)', width: 1024, height: 768 },
      { name: 'Desktop (1440x900)', width: 1440, height: 900 },
    ]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      const ticker = page.getByTestId('hero-scholarly-ticker');
      await ticker.scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await expect(ticker).toBeVisible();

      for (let i = 0; i < expectedTickerLinks.length; i++) {
        const { slug, href } = expectedTickerLinks[i];
        const link = page.getByTestId(`hero-ticker-logo-${slug}-${i}`);
        await expect(link).toHaveAttribute('href', href);
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      }

      // Verify comfortable touch/click target height (>= 34px) and clickability on every viewport
      const firstLogoBox = await page
        .getByTestId('hero-ticker-logo-crossref-0')
        .boundingBox();
      expect(firstLogoBox).not.toBeNull();
      expect(firstLogoBox!.height).toBeGreaterThanOrEqual(34);

      // Verify marquee continues running after clicking/focusing a logo (never gets stuck paused)
      const openAlexLink = page.getByTestId('hero-ticker-logo-openalex-1');
      await openAlexLink.focus();
      await page.mouse.move(0, 0);
      const playState = await ticker
        .locator('.animate-solva-marquee')
        .evaluate((el) => window.getComputedStyle(el).animationPlayState);
      expect(playState).toBe('running');

      await assertNoHorizontalOverflow(page, `/ (Hero Ticker) @ ${vp.name}`);
    }
  });
});

test.describe('Responsive Layout — Authenticated Workspaces (Student, Teacher, Admin)', () => {
  for (const vp of VIEWPORTS) {
    test(`renders core authenticated routes without horizontal overflow at ${vp.name}`, async ({
      page,
    }) => {
      setupAllResponsiveMocks(page);
      await page.setViewportSize({ width: vp.width, height: vp.height });

      const routes = [
        '/dashboard',
        '/upload',
        '/sandbox',
        '/batch',
        '/history',
        '/verification/report/1',
        '/verification/report/1/issues',
        '/verification/report/1/trace',
        '/verification/report/1/orphans',
        '/verification/report/1/inspector',
        '/teacher/classes',
        '/teacher/classes/10',
        '/teacher/reviews',
        '/admin/users',
        '/admin/audit',
        '/admin/health',
        '/profile',
        '/settings',
      ];

      for (const route of routes) {
        await page.goto(route);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(400);
        await assertNoHorizontalOverflow(page, `${route} @ ${vp.name}`);
      }
    });
  }

  test('AppLayout sticky mobile/tablet header and slide-over drawer work on Mobile (375x812) and Tablet (768x1024)', async ({
    page,
  }) => {
    setupAllResponsiveMocks(page);

    for (const vp of [
      { width: 375, height: 812 },
      { width: 768, height: 1024 },
    ]) {
      await page.setViewportSize(vp);
      await page.goto('/dashboard');
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      const openNavBtn = page.getByRole('button', { name: /open navigation menu/i });
      await expect(openNavBtn).toBeVisible();

      // Open drawer
      await openNavBtn.click();
      const sidebar = page.locator('aside');
      await expect(sidebar).toHaveClass(/translate-x-0/);

      // Verify CITRA brand link and Close (X) button inside mobile drawer header are vertically centered on the exact same line
      const drawerHeaderAlignment = await page.evaluate(() => {
        const aside = document.querySelector('[data-testid="app-sidebar"]');
        const brand = aside?.querySelector('a[aria-label="Go to dashboard"]');
        const closeBtn = aside?.querySelector('[data-testid="mobile-sidebar-close-btn"]');
        if (!brand || !closeBtn) return null;
        const bRect = brand.getBoundingClientRect();
        const cRect = closeBtn.getBoundingClientRect();
        return {
          brandCenterY: bRect.top + bRect.height / 2,
          closeCenterY: cRect.top + cRect.height / 2,
          deltaY: Math.abs(bRect.top + bRect.height / 2 - (cRect.top + cRect.height / 2)),
        };
      });
      expect(drawerHeaderAlignment).not.toBeNull();
      expect(drawerHeaderAlignment!.deltaY).toBeLessThanOrEqual(1.5);

      // Navigate via drawer Workspace link (History) and verify auto-close
      await sidebar.getByRole('link', { name: /history|lịch sử/i }).first().click();
      await expect(page).toHaveURL(/\/history/);
      await expect(sidebar).toHaveClass(/-translate-x-full/);

      // Re-open drawer -> open ChatGPT-style Account Popover -> click Settings -> verify both popover and drawer close
      await openNavBtn.click();
      await expect(sidebar).toHaveClass(/translate-x-0/);
      await page.getByTestId('sidebar-account-trigger').click();
      const popover = page.getByTestId('sidebar-account-popover');
      await expect(popover).toHaveAttribute('data-open', 'true');
      await popover.getByRole('link', { name: /settings|cài đặt/i }).click();
      await expect(page).toHaveURL(/\/settings/);
      await expect(popover).toHaveAttribute('data-open', 'false');
      await expect(sidebar).toHaveClass(/-translate-x-full/);
    }
  });

  test('Auth top bar on compact 320x568 mobile never overlaps CITRA brand mark in Vietnamese or English', async ({
    page,
  }) => {
    clearAuthState(page);
    await page.addInitScript(() => {
      localStorage.setItem('i18nextLng', 'vi');
      localStorage.setItem('language', 'vi');
    });
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');
    await assertNoHorizontalOverflow(page, '/login (VI) @ 320x568');

    const metrics = await page.evaluate(() => {
      const topControls = Array.from(document.querySelectorAll('a, button'))
        .map((el) => ({
          label: (el.getAttribute('aria-label') || el.textContent || '').trim(),
          rect: el.getBoundingClientRect(),
        }))
        .filter((x) => x.rect.width > 0 && x.rect.height > 0 && x.rect.top < 70);
      const citra = topControls.find((x) => x.label.includes('CITRA'));
      const home = topControls.find((x) => /trang chủ|home/i.test(x.label));
      if (!citra || !home) return null;
      return {
        gapPx: home.rect.left - citra.rect.right,
      };
    });
    expect(metrics).not.toBeNull();
    expect(metrics!.gapPx).toBeGreaterThanOrEqual(16);
  });

  test('Single-DOM responsive tables render cleanly on Mobile (375x812) and Tablet (768x1024)', async ({
    page,
  }) => {
    setupAllResponsiveMocks(page);

    // 1. Mobile (375x812) — tables transform into vertical cards without duplicating DOM nodes
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/dashboard');
    await page.waitForSelector('table', { timeout: 5000 });
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByText('BERT_Pre-training.pdf')).toHaveCount(1);
    await assertNoHorizontalOverflow(page, '/dashboard table @ 375x812');

    await page.goto('/admin/users');
    await page.waitForSelector('table', { timeout: 5000 });
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByText('john_doe')).toBeVisible();
    await assertNoHorizontalOverflow(page, '/admin/users table @ 375x812');

    // 2. Tablet (768x1024) — tables render in tabular row mode without horizontal overflow
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/dashboard');
    await page.waitForSelector('table', { timeout: 5000 });
    await expect(page.getByRole('table')).toBeVisible();
    await assertNoHorizontalOverflow(page, '/dashboard table @ 768x1024');

    await page.goto('/admin/users');
    await page.waitForSelector('table', { timeout: 5000 });
    await expect(page.getByRole('table')).toBeVisible();
    await assertNoHorizontalOverflow(page, '/admin/users table @ 768x1024');
  });

  test('Modals and Dialogs fit cleanly within Mobile (375x812) viewport', async ({
    page,
  }) => {
    setupAllResponsiveMocks(page);
    await page.setViewportSize({ width: 375, height: 812 });

    // 1. UserFormDialog on /admin/users
    await page.goto('/admin/users');
    await page.waitForSelector('table', { timeout: 5000 });
    await page.getByRole('button', { name: /create user|tạo người dùng/i }).click();
    const userDialog = page.getByRole('dialog');
    await expect(userDialog).toBeVisible();
    const userDialogBox = await userDialog.boundingBox();
    expect(userDialogBox).not.toBeNull();
    expect(userDialogBox!.width).toBeLessThanOrEqual(375);
    await assertNoHorizontalOverflow(page, 'UserFormDialog @ 375x812');

    // 2. CreateClassDialog on /teacher/classes
    await page.goto('/teacher/classes');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /tạo lớp|create class/i }).click();
    const classDialog = page.getByRole('dialog');
    await expect(classDialog).toBeVisible();
    const classDialogBox = await classDialog.boundingBox();
    expect(classDialogBox).not.toBeNull();
    expect(classDialogBox!.width).toBeLessThanOrEqual(375);
    await assertNoHorizontalOverflow(page, 'CreateClassDialog @ 375x812');
  });

  test('Long underscore-connected filename does not overflow across Mobile, Tablet, Laptop, and Desktop viewports', async ({
    page,
  }) => {
    setupAllResponsiveMocks(page);
    const longFilename =
      'VietDepression_for_Detecting_Depression_Related_Language_in_Vietnamese_YouTube_Comments_and_Social_Media_Discourse.pdf';

    await page.route(/\/api\/essays$/, (route) => {
      if (route.request().method() === 'GET') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 1,
              filename: longFilename,
              num_pages: 18,
              uploaded_at: '2026-10-25T10:00:00Z',
              cis_score: 88.5,
              status: 'completed',
            },
          ]),
        });
      } else {
        route.continue();
      }
    });

    await page.route(/\/api\/essays\/1$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          essay_id: 1,
          filename: longFilename,
          num_pages: 18,
          num_citations: 2,
          extracted_citations: [],
          references: [],
          verdicts: [
            {
              citation_id: 'cit_1',
              citation_raw: 'Nguyen et al. (2024)',
              label: 'verified',
              confidence: 0.95,
              mapping_status: 'matched',
              matched_sources: [],
              mismatched_fields: [],
              triggered_rules: ['R-WELL-LINKED'],
              reasoning: 'Verified match.',
            },
          ],
          cis: {
            score: 88.5,
            verified_count: 1,
            metadata_error_count: 0,
            suspected_hallucination_count: 0,
            unresolved_count: 0,
            resource_count: 0,
            total_count: 1,
          },
        }),
      })
    );

    for (const vp of [
      { name: '375x812', width: 375, height: 812 },
      { name: '640x900', width: 640, height: 900 },
      { name: '768x1024', width: 768, height: 1024 },
      { name: '1024x768', width: 1024, height: 768 },
      { name: '1280x800', width: 1280, height: 800 },
      { name: '1440x900', width: 1440, height: 900 },
    ]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      for (const route of ['/dashboard', '/history', '/verification/report/1']) {
        await page.goto(route);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(400);
        await assertNoHorizontalOverflow(page, `${route} (long filename) @ ${vp.name}`);

        if (route === '/dashboard') {
          const tableOverflow = await page.evaluate(() => {
            const table = document.querySelector('table');
            const wrapper = table?.parentElement;
            return wrapper ? wrapper.scrollWidth > wrapper.clientWidth : false;
          });
          expect(
            tableOverflow,
            `Expected no internal table overflow on /dashboard @ ${vp.name}`
          ).toBe(false);
        }
      }

      // Verify EssayHeader h1 boundingBox stays within the viewport
      const h1Box = await page.locator('h1').first().boundingBox();
      expect(h1Box).not.toBeNull();
      expect(h1Box!.x + h1Box!.width).toBeLessThanOrEqual(vp.width);
    }
  });

  test('Verification Report Split-Pane IDE has no extra whitespace gap between citation list and manuscript context across responsive viewports', async ({
    page,
  }) => {
    setupAllResponsiveMocks(page);

    const manyVerdicts = Array.from({ length: 24 }, (_, idx) => ({
      citation_id: `cit_${idx + 1}`,
      citation_raw: `[${idx + 1}] Nguyen D. Q., Nguyen A. T. (2020). PhoBERT: Pre-trained language models for Vietnamese. Findings of EMNLP 2020, pp 1037-1042. https://doi.org/10.18653/v1/2020.findings-emnlp.92`,
      label: 'verified',
      confidence: 0.99,
      mapping_status: 'matched',
      url_status: 'alive',
      url_status_code: 200,
      matched_sources: [
        {
          source: 'local_db',
          similarity_score: 0.99,
          matched_fields: ['title', 'authors', 'year', 'doi'],
        },
      ],
      mismatched_fields: [],
      triggered_rules: ['R-DOI-TITLE-AUTHOR', 'R-LOCAL_DB_VERIFIED'],
      reasoning: 'Verified exact match in ACL Anthology.',
      best_candidate: {
        title: 'PhoBERT: Pre-trained language models for Vietnamese',
        authors: ['Dat Quoc Nguyen', 'Anh Tuan Nguyen'],
        year: 2020,
        venue: 'Findings of the Association for Computational Linguistics: EMNLP 2020',
        doi: '10.18653/v1/2020.findings-emnlp.92',
        url: 'https://doi.org/10.18653/v1/2020.findings-emnlp.92',
      },
    }));

    await page.route(/\/api\/essays\/35(\/report)?$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          essay_id: 35,
          filename: 'demo_29.09.docx',
          num_pages: 23,
          num_citations: 24,
          extracted_citations: manyVerdicts.map((v, idx) => ({
            id: v.citation_id,
            raw_text: v.citation_raw,
            page_num: (idx % 12) + 1,
            context:
              'Pretrained transformers such as PhoBERT [4] capture surrounding context to help resolve lexical ambiguity.',
          })),
          references: [],
          verdicts: manyVerdicts,
          cis: {
            score: 100.0,
            verified_count: 24,
            metadata_error_count: 0,
            suspected_hallucination_count: 0,
            unresolved_count: 0,
            resource_count: 0,
            total_count: 24,
          },
        }),
      })
    );

    for (const vp of [
      { name: 'Mobile (375x812)', width: 375, height: 812 },
      { name: 'Tablet (768x1024)', width: 768, height: 1024 },
      { name: 'Laptop (1024x768)', width: 1024, height: 768 },
      { name: 'Desktop (1440x900)', width: 1440, height: 900 },
    ]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/verification/report/35');
      await page.waitForSelector('[role="listbox"]', { timeout: 5000 });
      await assertNoHorizontalOverflow(page, `/verification/report/35 @ ${vp.name}`);

      const metrics = await page.evaluate(() => {
        const listbox = document.querySelector('[role="listbox"]');
        const detailStage = document.querySelector('[data-testid="citation-detail-stage"]');
        if (!listbox || !detailStage) return null;
        const leftPane = listbox.parentElement?.parentElement ?? listbox.parentElement ?? listbox;
        const leftRect = leftPane.getBoundingClientRect();
        const detailRect = detailStage.getBoundingClientRect();
        const isSideBySide = detailRect.left >= leftRect.right - 2;
        const gap = isSideBySide
          ? Math.abs(detailRect.left - leftRect.right)
          : Math.abs(detailRect.top - leftRect.bottom);
        return {
          gap,
          isSideBySide,
          listboxHeight: listbox.getBoundingClientRect().height,
        };
      });

      expect(metrics).not.toBeNull();
      expect(
        metrics!.gap,
        `Expected no large whitespace gap between citation list and detail inspector at ${vp.name}`
      ).toBeLessThanOrEqual(24);
    }
  });

  test('UpgradeModal on Basic plan upload limit error scrolls smoothly to CTA buttons and footer without bottom clipping across laptop and mobile viewports', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('token', 'mock-basic-token');
      localStorage.setItem('i18nextLng', 'en');
    });

    await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
      const url = route.request().url();
      if (url.includes('/api/auth/me')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 999,
            username: 'basic_tester',
            email: 'basic@example.com',
            full_name: 'Basic Plan Student',
            role: 'user',
            plan_tier: 'basic',
            is_active: true,
            needs_onboarding: false,
            quota: {
              monthly_uploads_used: 0,
              monthly_uploads_limit: 3,
              monthly_uploads_remaining: 3,
              max_file_size_mb: 5,
              max_pages_per_pdf: 15,
              max_citations_per_essay: 30,
              max_batch_files: 1,
              allowed_export_formats: ['json'],
              allow_batch_upload: false,
              allow_deep_inspector: false,
              allow_serpapi_fallback: false,
              quota_reset_at: '2026-12-01T00:00:00Z',
            },
          }),
        });
      }
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 413,
          contentType: 'application/json',
          body: JSON.stringify({
            detail:
              'PDF page limit exceeded (20 pages uploaded; maximum allowed on the Basic plan is 15 pages). Please upgrade to Pro or Ultra.',
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[]',
      });
    });

    for (const vp of [
      { name: 'Laptop 13-14in (1440x740)', width: 1440, height: 740 },
      { name: 'Compact Laptop (1280x720)', width: 1280, height: 720 },
      { name: 'Mobile SE (375x667)', width: 375, height: 667 },
    ]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/upload', { waitUntil: 'domcontentloaded' });

      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles({
        name: 'thesis_20_pages.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 dummy'),
      });

      await page.locator('button.btn-shimmer').click();

      const modal = page.getByTestId('upgrade-modal');
      await expect(modal).toBeVisible();
      await page.waitForTimeout(300);

      const initialLayout = await page.evaluate(() => {
        const dialog = document.querySelector('[data-testid="upgrade-modal"]') as HTMLElement;
        const banner = dialog.children[0] as HTMLElement;
        const dRect = dialog.getBoundingClientRect();
        const bRect = banner.getBoundingClientRect();
        return {
          bannerTopDelta: Math.abs(bRect.top - dRect.top),
          bannerLeftDelta: Math.abs(bRect.left - dRect.left),
          dialogOverflowsItself: dialog.scrollHeight > dialog.clientHeight + 2,
          dialogRect: dRect,
        };
      });

      expect(
        initialLayout.bannerTopDelta,
        `Expected full-bleed header banner flush with top of UpgradeModal at ${vp.name}`
      ).toBeLessThanOrEqual(2);
      expect(
        initialLayout.bannerLeftDelta,
        `Expected full-bleed header banner flush with left edge of UpgradeModal at ${vp.name}`
      ).toBeLessThanOrEqual(2);
      expect(
        initialLayout.dialogOverflowsItself,
        `Expected UpgradeModal outer container not to clip overflowing rows at ${vp.name}`
      ).toBe(false);

      // Scroll down inside the modal using mouse wheel
      const { dialogRect } = initialLayout;
      await page.mouse.move(
        dialogRect.left + dialogRect.width / 2,
        dialogRect.top + dialogRect.height * 0.65
      );
      await page.mouse.wheel(0, 1400);
      await page.waitForTimeout(250);

      const afterScroll = await page.evaluate(() => {
        const dialog = document.querySelector('[data-testid="upgrade-modal"]') as HTMLElement;
        const proBtn = document.querySelector('[data-testid="modal-upgrade-pro-btn"]') as HTMLElement;
        const ultraBtn = document.querySelector('[data-testid="modal-upgrade-ultra-btn"]') as HTMLElement;
        const footerBtn = Array.from(dialog.querySelectorAll('button')).find((b) =>
          b.textContent?.includes('Compare all 3 plans')
        ) as HTMLElement | undefined;

        const dRect = dialog.getBoundingClientRect();
        const proRect = proBtn.getBoundingClientRect();
        const ultraRect = ultraBtn.getBoundingClientRect();
        const fRect = footerBtn?.getBoundingClientRect();

        return {
          dialogBottom: dRect.bottom,
          proBottom: proRect.bottom,
          ultraBottom: ultraRect.bottom,
          footerBottom: fRect?.bottom ?? Infinity,
        };
      });

      expect(
        afterScroll.proBottom,
        `Expected Pro CTA button completely visible inside modal after scrolling at ${vp.name}`
      ).toBeLessThanOrEqual(afterScroll.dialogBottom);
      expect(
        afterScroll.ultraBottom,
        `Expected Ultra CTA button completely visible inside modal after scrolling at ${vp.name}`
      ).toBeLessThanOrEqual(afterScroll.dialogBottom);
      expect(
        afterScroll.footerBottom,
        `Expected footer comparison link completely visible inside modal after scrolling at ${vp.name}`
      ).toBeLessThanOrEqual(afterScroll.dialogBottom);

      // Close modal via Close button
      await modal.getByRole('button', { name: /close/i }).click();
      await expect(modal).toBeHidden();
    }
  });

  test('Authenticated /pricing reveals all 3 plan cards on desktop without scrolling to the bottom, and sidebar active indicator is symmetrically inset inside nav pill', async ({
    page,
  }) => {
    setupAllResponsiveMocks(page);

    // 1. Verify sidebar active indicator on /dashboard is symmetrically rounded and strictly inside the nav pill
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    const indicator = page.getByTestId('sidebar-active-indicator');
    await expect(indicator).toBeVisible();

    const sidebarGeometry = await page.evaluate(() => {
      const ind = document.querySelector('[data-testid="sidebar-active-indicator"]') as HTMLElement;
      const link = ind.closest('a') as HTMLElement;
      const indRect = ind.getBoundingClientRect();
      const linkRect = link.getBoundingClientRect();
      const style = getComputedStyle(ind);
      return {
        leftInset: indRect.left - linkRect.left,
        topInset: indRect.top - linkRect.top,
        bottomInset: linkRect.bottom - indRect.bottom,
        topLeftRadius: style.borderTopLeftRadius,
        topRightRadius: style.borderTopRightRadius,
      };
    });

    expect(sidebarGeometry.leftInset).toBeGreaterThanOrEqual(4);
    expect(sidebarGeometry.topInset).toBeGreaterThanOrEqual(6);
    expect(sidebarGeometry.bottomInset).toBeGreaterThanOrEqual(6);
    expect(sidebarGeometry.topLeftRadius).toBe(sidebarGeometry.topRightRadius);

    // 2. Verify /pricing at 1440x800 (and 1440x740) reveals all 3 plan cards on partial scroll without needing to scroll to the bottom
    for (const vp of [
      { name: 'Desktop 1440x800', width: 1440, height: 800 },
      { name: 'Laptop 1440x740', width: 1440, height: 740 },
    ]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/pricing', { waitUntil: 'domcontentloaded' });
      await page.getByTestId('plan-card-pro').waitFor({ state: 'attached' });

      // Scroll halfway down (320px out of ~5100px) inside AppLayout's #main-content
      await page.evaluate(() => {
        const main = document.getElementById('main-content');
        if (main) {
          main.scrollTop = 320;
          main.dispatchEvent(new Event('scroll', { bubbles: false }));
        }
      });

      await expect
        .poll(
          async () =>
            page.evaluate(() => {
              const basic = document.querySelector('[data-testid="plan-card-basic"]')?.parentElement;
              const pro = document
                .querySelector('[data-testid="plan-card-pro"]')
                ?.closest('[style*="opacity"]');
              const ultra = document.querySelector('[data-testid="plan-card-ultra"]')?.parentElement;
              return {
                basic: basic ? Number(getComputedStyle(basic).opacity) : 0,
                pro: pro ? Number(getComputedStyle(pro).opacity) : 0,
                ultra: ultra ? Number(getComputedStyle(ultra).opacity) : 0,
              };
            }),
          {
            message: `Expected all 3 pricing plan cards to reveal on partial scroll at ${vp.name}`,
            timeout: 2500,
          }
        )
        .toEqual({
          basic: expect.closeTo(1, 1),
          pro: expect.closeTo(1, 1),
          ultra: expect.closeTo(1, 1),
        });
    }
  });

  test('Network Play Step-by-Step (step-0) renders long multi-line titles and unbroken URLs cleanly without bottom text slicing across desktop and laptop viewports', async ({
    page,
  }) => {
    setupAllResponsiveMocks(page);

    const verdicts = [
      {
        citation_id: 'cit_coppersmith',
        numeric_index: 2,
        citation_raw:
          '[2] Coppersmith, G., Dredze, M., & Harman, C. (2014). Quantifying Mental Health Signals in Twitter. Workshop on Computational Linguistics and Clinical Psychology.',
        label: 'verified',
        confidence: 0.98,
        mapping_status: 'matched',
        matched_sources: [
          {
            source: 'crossref',
            title: 'Quantifying Mental Health Signals in Twitter.',
            authors: ['Glen Coppersmith', 'Mark Dredze', 'Craig Harman'],
            year: '2014',
            venue: 'CLPsych',
            doi: '10.3115/v1/W14-3207',
            similarity_score: 0.98,
            matched_fields: ['title', 'authors', 'year', 'doi'],
          },
        ],
        mismatched_fields: [],
        triggered_rules: ['R-DOI-TITLE-AUTHOR'],
        reasoning: 'Verified exact match in Crossref.',
      },
      {
        citation_id: 'cit_super_long',
        numeric_index: 3,
        citation_raw:
          '[3] Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J., Jones, L. (2023). Cross-Lingual Neuro-Symbolic Citation Integrity Verification Across Heterogeneous Scholarly Repositories With Calibrated Abstention Guardrails and Multi-Tier Retrieval. Transactions of the Association for Computational Linguistics.',
        label: 'verified',
        confidence: 0.99,
        mapping_status: 'matched',
        matched_sources: [
          {
            source: 'openalex',
            title:
              'Cross-Lingual Neuro-Symbolic Citation Integrity Verification Across Heterogeneous Scholarly Repositories With Calibrated Abstention Guardrails and Multi-Tier Retrieval.',
            authors: ['Ashish Vaswani'],
            year: '2023',
            venue: 'TACL',
            similarity_score: 0.99,
            matched_fields: ['title', 'authors', 'year'],
          },
        ],
        mismatched_fields: [],
        triggered_rules: ['R-WELL-LINKED'],
        reasoning: 'Verified in OpenAlex.',
      },
      {
        citation_id: 'cit_long_url',
        numeric_index: 4,
        citation_raw:
          '[4] https://repository.institutional-archive.example.org/bitstream/handle/123456789/987654321/2026-comprehensive-neuro-symbolic-manuscript-integrity-audit-report-v4.pdf',
        label: 'resource',
        confidence: 0.95,
        mapping_status: 'matched',
        url_status: 'alive',
        url_status_code: 200,
        matched_sources: [],
        mismatched_fields: [],
        triggered_rules: ['R-URL-RESOURCE'],
        reasoning: 'Active web resource.',
      },
    ];

    await page.route(/\/api\/essays\/36(\/report)?$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          essay_id: 36,
          filename: 'Network_Step_By_Step_Long_Refs.pdf',
          num_pages: 18,
          num_citations: verdicts.length,
          extracted_citations: verdicts.map((v, idx) => ({
            id: v.citation_id,
            raw_text: v.citation_raw,
            page_num: idx + 1,
            context: 'Cited in methodology section.',
          })),
          references: [],
          verdicts,
          cis: {
            score: 98.5,
            verified_count: 2,
            metadata_error_count: 0,
            suspected_hallucination_count: 0,
            unresolved_count: 0,
            resource_count: 1,
            total_count: 3,
          },
        }),
      })
    );

    for (const vp of [
      { name: 'Desktop (1440x900)', width: 1440, height: 900 },
      { name: 'Laptop (1024x768)', width: 1024, height: 768 },
    ]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/verification/report/36');
      await page.getByTestId('mode-graph-btn').click();
      await expect(page.getByTestId('interactive-decision-flow-board')).toBeVisible();

      for (let refIdx = 0; refIdx < verdicts.length; refIdx++) {
        await page.getByTestId(`graph-ref-card-${refIdx}`).click();
        await expect(page.getByTestId('interactive-decision-flow-board')).toHaveCount(1);
        await page.getByTestId('flow-replay-btn').click();
        await expect(page.getByTestId('interactive-decision-flow-board')).toHaveAttribute(
          'data-board-phase',
          'step-0'
        );

        const geometry = await page.evaluate(() => {
          const stage = document.querySelector('.citra-cq-flow-stage') as HTMLElement | null;
          const hub = document.querySelector('[data-testid="flow-central-hub"]') as HTMLElement | null;
          if (!stage || !hub) return null;

          // Locate the 3rd row (title pill) in step-0 inside flow-central-hub
          const step0TitlePill =
            (hub.querySelector('[data-testid="flow-step0-title-box"]') as HTMLElement | null) ??
            (hub.querySelector('.space-y-1\\.5 > div:last-child') as HTMLElement | null);
          if (!step0TitlePill) return null;

          const clampedEl =
            (step0TitlePill.querySelector('p') as HTMLElement | null) ?? step0TitlePill;
          const pillRect = step0TitlePill.getBoundingClientRect();
          const clampRect = clampedEl.getBoundingClientRect();
          const hubRect = hub.getBoundingClientRect();
          const stageRect = stage.getBoundingClientRect();

          // Measure every rendered text line rect inside clampedEl via Range.getClientRects()
          const range = document.createRange();
          range.selectNodeContents(clampedEl);
          const lineRects = Array.from(range.getClientRects()).filter((r) => r.width > 1 && r.height > 1);

          // A line is "sliced in half" if its top starts inside the visible clip box (above clipBottom - 1.5px)
          // AND its bottom extends past the visible clip box (below clipBottom + 1.5px)!
          const clipBottom = clampRect.bottom;
          const slicedLines = lineRects.filter(
            (r) => r.top < clipBottom - 1.5 && r.bottom > clipBottom + 1.5
          );

          return {
            slicedLineCount: slicedLines.length,
            bottomPaddingGap: pillRect.bottom - clampRect.bottom,
            textRightOverflow: clampRect.right - hubRect.right,
            hubTopWithinStage: hubRect.top - stageRect.top,
            stageBottomClearance: stageRect.bottom - hubRect.bottom,
          };
        });

        expect(geometry, `Missing geometry at ${vp.name} ref #${refIdx}`).not.toBeNull();
        expect(
          geometry!.slicedLineCount,
          `Expected zero sliced text lines in step-0 title box at ${vp.name} ref #${refIdx}`
        ).toBe(0);
        expect(
          geometry!.bottomPaddingGap,
          `Expected preserved bottom padding inside step-0 title pill at ${vp.name} ref #${refIdx}`
        ).toBeGreaterThanOrEqual(4);
        expect(
          geometry!.textRightOverflow,
          `Expected zero horizontal overflow from hub card at ${vp.name} ref #${refIdx}`
        ).toBeLessThanOrEqual(0);
        expect(geometry!.hubTopWithinStage).toBeGreaterThanOrEqual(70);
        expect(geometry!.stageBottomClearance).toBeGreaterThanOrEqual(40);
      }
    }
  });
});
