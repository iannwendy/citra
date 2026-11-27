import { test, expect, type Page } from '@playwright/test';
import { clearAuthState, setupAuthenticatedPage } from './helpers';

const PUBLIC_ROUTES = [
  '/',
  '/login',
  '/register',
  '/pricing',
  '/privacy',
  '/terms',
  '/verify/share/invalid-token',
  '/404',
] as const;

const AUTH_ROUTES = [
  '/dashboard',
  '/upload',
  '/sandbox',
  '/settings',
  '/verification/report/1',
  '/teacher/classes',
  '/teacher/reviews',
  '/admin/users',
  '/admin/system',
  '/admin/audit',
] as const;

function registerAuditAdminAndTeacherMocks(page: Page): void {
  page.route('**/api/teacher/dashboard', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        total_classes: 1,
        total_students: 24,
        total_essays: 12,
        pending_reviews: 1,
        classes: [
          {
            id: 11,
            name: 'KLTN AI 2026',
            description: 'Capstone citation seminar',
            join_code: 'CITRA26',
            teacher_id: 1,
            teacher_username: 'admin',
            created_at: '2026-11-01T00:00:00Z',
            student_count: 24,
            essay_count: 12,
          },
        ],
      }),
    });
  });

  page.route('**/api/teacher/classes', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 11,
          name: 'KLTN AI 2026',
          description: 'Capstone citation seminar',
          join_code: 'CITRA26',
          teacher_id: 1,
          teacher_username: 'admin',
          created_at: '2026-11-01T00:00:00Z',
          student_count: 24,
          essay_count: 12,
        },
      ]),
    });
  });

  page.route('**/api/teacher/classes/*/pending-reviews', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          verdict_id: 501,
          essay_id: 1,
          class_id: 11,
          class_name: 'KLTN AI 2026',
          filename: 'BERT_Pre-training.pdf',
          student_username: 'sv_linh',
          citation_raw: 'Phantom Author (2025). Unindexed Technical Note.',
          label: 'suspected_hallucination',
          confidence: 0.22,
          reasoning: 'No scholarly record matched above threshold.',
          triggered_rules: ['R-HALLUCINATED-SOURCE'],
          validated_at: '2026-11-26T08:00:00Z',
        },
      ]),
    });
  });

  page.route(/^https?:\/\/[^/]+\/api\/users(\?.*)?$/, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 1,
          username: 'admin',
          role: 'admin',
          email: 'admin@citra.edu.vn',
          full_name: 'Administrator',
          is_active: true,
          avatar_url: null,
          last_login_at: '2026-11-26T08:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          plan_tier: 'ultra',
          quota: {
            plan_tier: 'ultra',
            monthly_limit: null,
            used_this_month: 4,
            remaining: null,
          },
        },
        {
          id: 2,
          username: 'sv_minh_nguyen',
          role: 'user',
          email: 'minh.nguyen.2026@student.tdtu.edu.vn',
          full_name: 'Nguyễn Bảo Minh',
          is_active: true,
          avatar_url: null,
          last_login_at: '2026-11-25T10:30:00Z',
          created_at: '2026-09-01T00:00:00Z',
          plan_tier: 'pro',
          quota: {
            plan_tier: 'pro',
            monthly_limit: 50,
            used_this_month: 12,
            remaining: 38,
          },
        },
      ]),
    });
  });

  page.route('**/api/system/health', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        upstream_status: 'degraded',
        degraded_sources: ['semantic_scholar'],
        checked_at: '2026-11-27T06:00:00Z',
        parser_mode: 'grobid',
        grobid_available: true,
        totals: {
          users: 42,
          admins: 2,
          teachers: 8,
          students: 32,
          essays: 120,
          verdicts: 1540,
        },
        verdict_label_counts: {
          verified: 1200,
          metadata_error: 180,
          suspected_hallucination: 90,
          unresolved: 40,
          resource: 30,
        },
        cache_stats: {
          total: 520,
          total_hits: 3100,
          avg_hit_count: 5.96,
          by_source: { crossref: 300, openalex: 220 },
        },
        upstream_sources: {
          semantic_scholar: {
            state: 'open',
            failure_count: 4,
            success_count: 102,
            rate_limit_count: 2,
            avg_latency_ms: 480,
            cooldown_remaining_sec: 45,
            last_error: 'RetryError[<Future at 0x7f1a state=finished raised TimeoutError>]',
          },
        },
      }),
    });
  });

  page.route('**/api/audit/log*', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 901,
          verdict_id: 501,
          essay_id: 1,
          essay_filename: 'BERT_Pre-training.pdf',
          student_username: 'sv_linh',
          original_label: 'suspected_hallucination',
          new_label: 'verified',
          user: 'admin',
          note: 'Verified print copy in university library.',
          logged_at: '2026-11-26T09:15:00Z',
        },
      ]),
    });
  });

  page.route('**/api/audit/stats*', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        total_events: 1,
        unique_actors: 1,
      }),
    });
  });

  page.route('**/api/sandbox/acl-sample*', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        count: 1,
        style: 'apa',
        database_total_papers: 128626,
        items: [],
      }),
    });
  });
}

test.describe('Production Audit E2E Regression Suite', () => {
  test.describe('Public routes hygiene, i18n <html lang> sync, auth icons & mobile 375px layout', () => {
    test('syncs <html lang> on reload (VI & EN) and keeps public routes free of legacy developer leaks', async ({
      page,
    }) => {
      clearAuthState(page);
      page.route('**/api/essays/shared/**', (route) => {
        route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Invalid share token format' }),
        });
      });

      await page.setViewportSize({ width: 1440, height: 900 });

      for (const lang of ['vi', 'en'] as const) {
        await page.goto('/');
        await page.evaluate((lng) => {
          localStorage.setItem('i18nextLng', lng);
          localStorage.setItem('language', lng);
        }, lang);
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('lang', lang);

        for (const routePath of PUBLIC_ROUTES) {
          await page.goto(routePath);
          await page.waitForLoadState('domcontentloaded');
          await expect(page.locator('html')).toHaveAttribute('lang', lang);

          const bodyText = (await page.locator('body').textContent()) ?? '';
          expect(bodyText, `${routePath} (${lang}) leaked SourceLogic`).not.toContain('SourceLogic');
          expect(bodyText, `${routePath} (${lang}) leaked symbolic_verifier.py`).not.toContain(
            'symbolic_verifier.py',
          );
          expect(bodyText, `${routePath} (${lang}) leaked 0% np.clip`).not.toContain('0% np.clip');
          expect(bodyText, `${routePath} (${lang}) leaked accusatory copy`).not.toContain(
            'ngay trước mặt thầy cô',
          );
        }
      }
    });

    test('renders visible z-10 left icons on /login and /register', async ({ page }) => {
      clearAuthState(page);
      await page.setViewportSize({ width: 1440, height: 900 });

      for (const authRoute of ['/login', '/register']) {
        await page.goto(authRoute);
        const leftIcons = page.locator('form div.pointer-events-none.z-10 svg');
        const count = await leftIcons.count();
        expect(count, `${authRoute} should have z-10 left input icons`).toBeGreaterThanOrEqual(2);
        for (let i = 0; i < count; i++) {
          await expect(leftIcons.nth(i)).toBeVisible();
        }
      }
    });

    test('Landing "See how it works" scrolls to #how-it-works and Demo [4] omits Close Match', async ({
      page,
    }) => {
      clearAuthState(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/');
      await page.evaluate(() => {
        localStorage.setItem('i18nextLng', 'en');
        localStorage.setItem('language', 'en');
      });
      await page.reload();

      const howItWorksTarget = page.locator('#how-it-works');
      await expect(howItWorksTarget).toBeAttached();

      const cta = page.locator('a[href="#how-it-works"]').first();
      await expect(cta).toBeVisible();
      await cta.click();

      await expect(howItWorksTarget).toBeInViewport({ ratio: 0.1 });

      // Select Demo [4] ("Smith et al. (2021)") and verify no misleading "Close Match" badge
      const demo4Trigger = page.getByRole('button', { name: /\[4\]|Smith et al\. \(2021\)/i }).first();
      if ((await demo4Trigger.count()) > 0) {
        await demo4Trigger.click();
        const demoSectionText = (await page.locator('#interactive-demo').textContent()) ?? '';
        expect(demoSectionText).not.toContain('Close Match');
        expect(demoSectionText).not.toContain('Gần khớp');
      }
    });

    test('maintains zero horizontal overflow or footer/badge clipping on 375px mobile viewport', async ({
      page,
    }) => {
      clearAuthState(page);
      await page.setViewportSize({ width: 375, height: 812 });

      for (const routePath of ['/', '/pricing', '/login']) {
        await page.goto(routePath);
        await page.waitForLoadState('domcontentloaded');

        const overflowPx = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflowPx, `${routePath} at 375px should not horizontally overflow`).toBeLessThanOrEqual(
          2,
        );

        const footer = page.locator('footer').first();
        if ((await footer.count()) > 0) {
          const box = await footer.boundingBox();
          if (box) {
            expect(box.x).toBeGreaterThanOrEqual(-1);
            expect(box.x + box.width).toBeLessThanOrEqual(377);
          }
        }
      }
    });
  });

  test.describe('Authenticated workspace routes: taxonomy, banners, modals & responsive tables', () => {
    test('keeps all authenticated routes free of accusatory copy / raw HALLUCINATION and shows DecisionSupportBanner', async ({
      page,
    }) => {
      setupAuthenticatedPage(page);
      registerAuditAdminAndTeacherMocks(page);

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/dashboard');
      await page.evaluate(() => {
        localStorage.setItem('i18nextLng', 'vi');
        localStorage.setItem('language', 'vi');
      });

      for (const routePath of AUTH_ROUTES) {
        await page.goto(routePath);
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('main')).toBeVisible();

        const bodyText = (await page.locator('body').textContent()) ?? '';
        expect(bodyText, `${routePath} leaked "Bịa đặt"`).not.toContain('Bịa đặt');
        expect(bodyText, `${routePath} leaked raw HALLUCINATION`).not.toContain('HALLUCINATION');
        expect(bodyText, `${routePath} leaked "ngay trước mặt thầy cô"`).not.toContain(
          'ngay trước mặt thầy cô',
        );
      }

      // DecisionSupportBanner must be visible on report & faculty review routes
      await page.goto('/verification/report/1');
      await expect(page.getByTestId('decision-support-banner').first()).toBeVisible();

      await page.goto('/teacher/reviews');
      await expect(page.getByTestId('decision-support-banner').first()).toBeVisible();
    });

    test('renders modals flush with viewport top (no top white strip) and Settings 1024px language buttons unclipped', async ({
      page,
    }) => {
      setupAuthenticatedPage(page);
      registerAuditAdminAndTeacherMocks(page);

      await page.setViewportSize({ width: 1024, height: 800 });
      await page.goto('/settings');
      await page.waitForLoadState('domcontentloaded');

      // Language buttons at 1024px must remain fully unclipped inside their container
      const viBtn = page.getByRole('button', { name: /Tiếng Việt/i }).first();
      const enBtn = page.getByRole('button', { name: /English/i }).first();
      await expect(viBtn).toBeVisible();
      await expect(enBtn).toBeVisible();

      for (const btn of [viBtn, enBtn]) {
        const metrics = await btn.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return {
            right: rect.right,
            viewportWidth: window.innerWidth,
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
          };
        });
        expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth + 1);
        expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 2);
      }

      // Open Delete Account modal and confirm backdrop covers y=0 (no top white strip from space-y-*)
      await page.getByTestId('settings-delete-account-btn').click();
      const modalOverlay = page.getByTestId('delete-account-modal');
      await expect(modalOverlay).toBeVisible();
      const overlayBox = await modalOverlay.boundingBox();
      expect(overlayBox).not.toBeNull();
      expect(overlayBox!.y).toBeLessThanOrEqual(1);
    });

    test('Admin 1440px /admin/users has no ACTI column clipping and /admin/system sanitizes RetryError', async ({
      page,
    }) => {
      setupAuthenticatedPage(page);
      registerAuditAdminAndTeacherMocks(page);

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/admin/users');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByText('sv_minh_nguyen')).toBeVisible();

      // Actions header cell must fit cleanly inside the table scroll container (no "ACTI" cut-off)
      const tableCheck = await page.evaluate(() => {
        const table = document.querySelector('table');
        if (!table) return { ok: false, overflow: 999 };
        const wrapper = table.parentElement;
        const ths = Array.from(table.querySelectorAll('thead th'));
        const lastTh = ths[ths.length - 1];
        if (!wrapper || !lastTh) return { ok: false, overflow: 999 };
        const wrapRect = wrapper.getBoundingClientRect();
        const thRect = lastTh.getBoundingClientRect();
        return {
          ok: thRect.right <= wrapRect.right + 2,
          overflow: Math.max(0, thRect.right - wrapRect.right),
        };
      });
      expect(tableCheck.ok, `Admin users table clipped by ${tableCheck.overflow}px`).toBe(true);

      // /admin/system must sanitize raw Python RetryError strings from upstream telemetry
      await page.goto('/admin/system');
      await expect(page.getByTestId('health-status-pill')).toBeVisible();
      await expect(page.getByTestId('upstream-sources-panel')).toBeVisible();
      const sysText = (await page.locator('body').textContent()) ?? '';
      expect(sysText).not.toContain('RetryError');
      expect(sysText).not.toContain('Future at 0x');
    });
  });
});
