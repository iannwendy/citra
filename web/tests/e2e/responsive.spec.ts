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

  // Mock Teacher endpoints
  page.route('**/api/classes/dashboard/summary', (route) =>
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
            created_at: '2026-09-01T00:00:00Z',
            student_count: 18,
            essay_count: 42,
          },
          {
            id: 11,
            name: 'AI402 Deep Learning Seminar',
            description: 'Graduate seminar on neural citation verification',
            teacher_id: 1,
            created_at: '2026-09-05T00:00:00Z',
            student_count: 10,
            essay_count: 22,
          },
        ],
      }),
    })
  );

  page.route('**/api/classes', (route) => {
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

  page.route('**/api/classes/10/students', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 2, username: 'john_doe', full_name: 'John Doe', email: 'john@example.com' },
      ]),
    })
  );

  page.route('**/api/classes/10/essays', (route) =>
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

  page.route('**/api/classes/10/pending-reviews', (route) =>
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

  page.route('**/api/admin/audit-log*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 1,
          verdict_id: 101,
          user: 'admin',
          original_label: 'suspected_hallucination',
          new_label: 'metadata_error',
          note: 'Verified conference preprint year discrepancy',
          logged_at: '2026-01-15T12:00:00Z',
        },
      ]),
    })
  );

  page.route('**/api/admin/system-health', (route) =>
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
    const stage3Btn = page.getByRole('button', { name: /neuro-symbolic rules|3\. luật neuro-symbolic/i });
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

      // Navigate via drawer link and verify auto-close
      await sidebar.getByRole('link', { name: /settings|cài đặt/i }).first().click();
      await expect(page).toHaveURL(/\/settings/);
      await expect(sidebar).toHaveClass(/-translate-x-full/);
    }
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
        const contextBox = listbox?.nextElementSibling;
        if (!listbox || !contextBox) return null;
        const listRect = listbox.getBoundingClientRect();
        const ctxRect = contextBox.getBoundingClientRect();
        return {
          gap: ctxRect.top - listRect.bottom,
          listboxHeight: listRect.height,
        };
      });

      expect(metrics).not.toBeNull();
      expect(
        metrics!.gap,
        `Expected tight spacing between citation list and manuscript context at ${vp.name}`
      ).toBeGreaterThanOrEqual(12);
      expect(
        metrics!.gap,
        `Expected no large whitespace gap between citation list and manuscript context at ${vp.name}`
      ).toBeLessThanOrEqual(24);
    }
  });
});
