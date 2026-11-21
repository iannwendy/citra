import fs from 'node:fs';
import path from 'node:path';
import { useContext } from 'react';
import { MotionConfigContext } from 'motion/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CitraMotionProvider } from '@/components/ui/motion-primitives';
import {
  render,
  renderHook,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import * as utilsMod from '@/lib/utils';
import * as routerMod from '@/router';
import { copyTextToClipboard } from '@/lib/clipboard';
import { isDocxFilename, EXPORT_FORMATS } from '@/lib/fileKind';
import { api, type AnalysisReport, type EssayStatus } from '@/api/client';
import { queryClient as appQueryClient } from '@/lib/queryClient';
import i18n from '@/i18n';
import enLocale from '@/i18n/locales/en.json';
import viLocale from '@/i18n/locales/vi.json';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { ToastProvider, useToast } from '@/contexts/ToastContext';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import {
  createTestQueryClient,
  makeUser,
  renderWithProviders,
} from '@/test-utils';
import { makeReport, makeVerdict } from '@/test-fixtures';
import { useEssayReport } from '@/hooks/useEssayReport';
import { useOrphanReport } from '@/hooks/useOrphanReport';
import { useDeleteEssay } from '@/hooks/useEssays';
import { streamEssayEvents } from '@/hooks/useEssayStream';
import { ErrorBoundary, withErrorBoundary } from '@/components/ErrorBoundary';
import { ConfirmationModal } from '@/components/ConfirmationModal';
import { GoogleAuthButton } from '@/components/GoogleAuthButton';
import { CreateClassDialog } from '@/components/CreateClassDialog';
import { AddStudentDialog } from '@/components/AddStudentDialog';
import { OverrideControls } from '@/components/OverrideControls';
import { HelpModal } from '@/components/HelpModal';
import { UserFormDialog } from '@/components/UserFormDialog';
import { GoogleOnboardingModal } from '@/components/GoogleOnboardingModal';
import { EvidenceGraphNode } from '@/components/CitationGraph/EvidenceGraphNode';
import { InteractiveDecisionFlowBoard } from '@/components/CitationGraph/InteractiveDecisionFlowBoard';
import { UpgradeModal } from '@/components/UpgradeModal';
import { PricingPage } from '@/pages/PricingPage';
import { EssayHeader } from '@/pages/essay/EssayHeader';
import { AppLayout } from '@/components/AppLayout';
import { SharedReportPage } from '@/pages/SharedReportPage';
import { PendingReviewsPage } from '@/pages/PendingReviewsPage';
import { EssayPage } from '@/pages/EssayPage';
import {
  StripeDemoCheckoutPage,
  isValidExpiry,
} from '@/pages/StripeDemoCheckoutPage';
import { ClassDetailPage } from '@/pages/ClassDetailPage';
import { MyClassesPage } from '@/pages/MyClassesPage';
import { DocumentInspectorWorkspace } from '@/pages/DocumentInspectorPage';
import { HistoryPage } from '@/pages/HistoryPage';
import { AccountManagementPage } from '@/pages/AccountManagementPage';
import { AuditLogPage } from '@/pages/AuditLogPage';
import { PromoManagementPage } from '@/pages/PromoManagementPage';
import { BatchUploadPage } from '@/pages/BatchUploadPage';
import { ProcessingPage } from '@/pages/ProcessingPage';
import { IssuesPage } from '@/pages/IssuesPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { RegisterPage } from '@/pages/RegisterPage';

const WEB_ROOT = path.resolve(__dirname, '../..');
const SRC_ROOT = path.resolve(__dirname, '..');

type SafeHrefFn = (raw?: string | null) => string | null;
type ValidatePasswordFn = (
  password: string,
  lang?: 'en' | 'vi',
) => { valid: boolean; error?: string };

describe('Track 4 Holistic SE Remediation Suite (FE-01..FE-15, QA-10, QA-11)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =========================================================================
  // FE-01: URL & DOI Scheme Sanitization (XSS Prevention)
  // =========================================================================
  describe('FE-01: Safe External URL & DOI Href Sanitization', () => {
    it('toSafeExternalHref and toSafeDoiHref strictly allow http/https and block javascript:, data:, vbscript:, file:', () => {
      const toSafeExternalHref = (
        utilsMod as unknown as { toSafeExternalHref?: SafeHrefFn }
      ).toSafeExternalHref;
      const toSafeDoiHref = (
        utilsMod as unknown as { toSafeDoiHref?: SafeHrefFn }
      ).toSafeDoiHref;

      expect(typeof toSafeExternalHref).toBe('function');
      expect(typeof toSafeDoiHref).toBe('function');

      expect(toSafeExternalHref!('https://doi.org/10.1038/nature14539')).toBe(
        'https://doi.org/10.1038/nature14539',
      );
      expect(toSafeExternalHref!('http://arxiv.org/abs/1706.03762')).toBe(
        'http://arxiv.org/abs/1706.03762',
      );
      expect(toSafeExternalHref!('javascript:alert(1)')).toBeNull();
      expect(toSafeExternalHref!('  JaVaScRiPt:alert(document.cookie) ')).toBeNull();
      expect(toSafeExternalHref!('data:text/html,<script>alert(1)</script>')).toBeNull();
      expect(toSafeExternalHref!('vbscript:msgbox(1)')).toBeNull();
      expect(toSafeExternalHref!('file:///etc/passwd')).toBeNull();
      expect(toSafeExternalHref!('http:evil.com/phish')).toBeNull();
      expect(toSafeExternalHref!('http:///evil')).toBeNull();
      expect(toSafeExternalHref!('https://\\\\evil.com')).toBeNull();
      expect(toSafeExternalHref!('https:\\\\evil.com')).toBeNull();
      expect(toSafeExternalHref!('')).toBeNull();
      expect(toSafeExternalHref!(null)).toBeNull();

      expect(toSafeDoiHref!('10.18653/v1/N19-1423')).toBe(
        'https://doi.org/10.18653/v1/N19-1423',
      );
      expect(toSafeDoiHref!('doi: 10.1000/abc#frag?x=1')).toBe(
        'https://doi.org/10.1000/abc%23frag%3Fx=1',
      );
      expect(toSafeDoiHref!('https://doi.org/10.1038/nature14539')).toBe(
        'https://doi.org/10.1038/nature14539',
      );
      expect(
        toSafeDoiHref!('https://dx.doi.org/10.1016/S0140-6736(20)30183-5'),
      ).toBe('https://dx.doi.org/10.1016/S0140-6736(20)30183-5');
      expect(toSafeDoiHref!('https://evil-phishing.example/login')).toBeNull();
      expect(toSafeDoiHref!('https://doi.org/not-a-doi')).toBeNull();
      expect(toSafeDoiHref!('javascript:alert(1)')).toBeNull();
      expect(toSafeDoiHref!('http:javascript:alert(1)')).toBeNull();
      expect(toSafeDoiHref!('data:text/html,xss')).toBeNull();
    });

    it('blocks javascript: and data: hrefs in SharedReportPage, PendingReviewsPage, and EssayPage', async () => {
      vi.spyOn(api, 'getSharedEssayReport').mockResolvedValue({
        share_token: 'tok-xss',
        verified_at: '2026-11-21T00:00:00Z',
        expires_at: '2026-12-21T00:00:00Z',
        sha256_fingerprint: 'a'.repeat(64),
        essay_id: 99,
        filename: 'xss_test.pdf',
        num_pages: 5,
        num_citations: 2,
        cis_score: 80,
        style_profile: {
          style: 'APA_LIKE',
          confidence: 0.9,
          apa_count: 2,
          ieee_count: 0,
          mixed_count: 0,
          features: {},
          ratios: {},
          explanation: 'APA',
        },
        verdict_counts: {
          verified: 1,
          metadata_error: 0,
          suspected_hallucination: 0,
          unresolved: 0,
          resource: 1,
        },
        verdicts: [
          {
            citation_id: 'v-xss-1',
            citation_raw: 'Smith (2024)',
            label: 'verified',
            confidence: 0.95,
            mapping_status: 'matched',
            reasoning: 'Matched.',
            triggered_rules: ['R01'],
            mismatched_fields: [],
            matched_sources: [
              {
                source: 'crossref',
                matched_fields: ['title'],
                checked_at: '2026-11-21T00:00:00Z',
                url: 'javascript:alert(1)',
                doi: 'javascript:alert(2)',
                title: 'Malicious Paper',
              },
            ],
            is_overridden: false,
          } as never,
          {
            citation_id: 'v-xss-2',
            citation_raw: 'Evil Web Source (2024)',
            label: 'resource',
            confidence: 0.9,
            mapping_status: 'matched',
            reasoning: 'Web resource.',
            triggered_rules: ['R-URL-RESOURCE'],
            mismatched_fields: [],
            matched_sources: [],
            cited_url: 'javascript:alert(3)',
            html_meta: {
              page_title: 'Evil Canonical Page',
              canonical_url: 'data:text/html,<script>alert(4)</script>',
            },
            is_overridden: false,
          } as never,
        ],
      } as never);

      const { container: sharedContainer, unmount: unmountShared } =
        renderWithProviders(
          <Routes>
            <Route path="/verify/share/:token" element={<SharedReportPage />} />
          </Routes>,
          { user: null, initialRoute: '/verify/share/tok-xss' },
        );

      await waitFor(() =>
        expect(screen.getByText(/xss_test\.pdf/)).toBeDefined(),
      );
      // Expand verdict rows if collapsed
      const expandBtns = sharedContainer.querySelectorAll('button');
      expandBtns.forEach((btn) => {
        if (btn.textContent?.includes('Smith (2024)') || btn.textContent?.includes('Evil Web Source')) {
          fireEvent.click(btn);
        }
      });
      const sharedAnchors = Array.from(sharedContainer.querySelectorAll('a'));
      for (const a of sharedAnchors) {
        const href = a.getAttribute('href') || '';
        expect(href.toLowerCase()).not.toMatch(/^(javascript|data|vbscript):/);
      }
      unmountShared();

      // PendingReviewsPage archive_url XSS check
      vi.spyOn(api, 'listMyClasses').mockResolvedValue([
        {
          id: 7,
          name: 'CS501',
          description: null,
          teacher_id: 2,
          teacher_username: 'lecturer1',
          created_at: '2026-11-01T00:00:00Z',
          student_count: 5,
          essay_count: 1,
        },
      ]);
      vi.spyOn(api, 'listPendingReviews').mockResolvedValue([
        {
          verdict_id: 501,
          essay_id: 12,
          filename: 'student_paper.pdf',
          student_username: 'student1',
          citation_raw: 'Archived Link (2023)',
          label: 'resource',
          confidence: 0.7,
          reasoning: 'Archived URL.',
          validated_at: '2026-11-21T00:00:00Z',
          url_status: 'archived_alive',
          archive_url: 'javascript:alert(99)',
        },
      ]);

      const { container: reviewsContainer, unmount: unmountReviews } =
        renderWithProviders(<PendingReviewsPage />, {
          user: makeUser('teacher', 'pro'),
          initialRoute: '/teacher/reviews',
        });

      await waitFor(() =>
        expect(screen.getByTestId('pending-url-status-501')).toBeDefined(),
      );
      const reviewAnchors = Array.from(reviewsContainer.querySelectorAll('a'));
      for (const a of reviewAnchors) {
        expect((a.getAttribute('href') || '').toLowerCase()).not.toMatch(
          /^(javascript|data|vbscript):/,
        );
      }
      unmountReviews();

      // EssayPage http:javascript:... DOI XSS check
      const xssReport = makeReport({
        verdicts: [
          makeVerdict({
            citation_id: 'v-doi-xss',
            citation_raw: '[1] Bad DOI Scheme (2024)',
            label: 'verified',
            matched_sources: [
              {
                source: 'crossref',
                matched_fields: ['title', 'doi'],
                checked_at: '2026-11-21T00:00:00Z',
                title: 'Bad DOI Scheme',
                doi: 'http:javascript:alert(1)',
                url: 'javascript:alert(2)',
              },
            ],
          }),
        ],
      });
      vi.spyOn(api, 'getEssay').mockResolvedValue(xssReport);

      const { container: essayContainer, unmount: unmountEssay } =
        renderWithProviders(
          <Routes>
            <Route path="/verification/report/:id" element={<EssayPage />} />
          </Routes>,
          {
            user: makeUser('teacher', 'pro'),
            initialRoute: '/verification/report/1',
          },
        );

      await waitFor(() =>
        expect(screen.getAllByText(/Bad DOI Scheme/).length).toBeGreaterThan(0),
      );
      const essayAnchors = Array.from(essayContainer.querySelectorAll('a'));
      for (const a of essayAnchors) {
        const href = a.getAttribute('href') || '';
        expect(href.toLowerCase()).not.toMatch(/^(javascript|data|vbscript):/);
        expect(href.toLowerCase()).not.toContain('http:javascript:');
      }
      unmountEssay();
    });

    it('CONV-04: InteractiveDecisionFlowBoard, UpgradeModal, and PricingPage reject http:javascript:, backslash phishing URLs, //evil.com, and non-DOI rawDoi strings', async () => {
      // 1. InteractiveDecisionFlowBoard: unsafe bestRec.url + non-DOI phishing rawDoi -> zero <a> tags
      const phishDoiVerdict = makeVerdict({
        citation_id: 'conv04-phish-doi',
        citation_raw: 'Smith (2024)',
        label: 'verified',
        matched_sources: [
          {
            source: 'crossref',
            matched_fields: ['title', 'doi'],
            checked_at: '2026-11-21T00:00:00Z',
            title: 'Backslash & Phishing DOI',
            url: 'https://\\\\evil.com/phish',
            doi: 'https://evil-phishing.example/login',
          },
        ],
      });
      const { container: c1, unmount: u1 } = renderWithProviders(
        <InteractiveDecisionFlowBoard verdict={phishDoiVerdict} />,
      );
      expect(screen.getByTestId('flow-story-card').textContent).toBeTruthy();
      expect(c1.querySelectorAll('a').length).toBe(0);
      u1();

      // 2. InteractiveDecisionFlowBoard: http:javascript:alert(1) + http:///evil + archive_url backslash phish -> zero <a> tags
      const badWebVerdict = makeVerdict({
        citation_id: 'conv04-bad-web',
        citation_raw: 'Web Source https://\\\\evil.com/phish and http:///evil',
        label: 'resource',
        triggered_rules: ['R-URL-RESOURCE'],
        url_status: 'archived_alive',
        archive_url: 'https://\\\\evil.com/phish',
        matched_sources: [
          {
            source: 'crossref',
            matched_fields: ['title'],
            checked_at: '2026-11-21T00:00:00Z',
            title: 'Bad Scheme Paper',
            url: 'http:javascript:alert(1)',
            doi: 'http:javascript:alert(1)',
          },
        ],
      });
      const { container: c2, unmount: u2 } = renderWithProviders(
        <InteractiveDecisionFlowBoard verdict={badWebVerdict} />,
      );
      expect(c2.querySelectorAll('a').length).toBe(0);
      u2();

      // 3. InteractiveDecisionFlowBoard: unsafe bestRec.url falls back cleanly to valid bare DOI via toSafeDoiHref
      const fallbackDoiVerdict = makeVerdict({
        citation_id: 'conv04-safe-doi',
        citation_raw: 'LeCun et al. (2015)',
        label: 'verified',
        matched_sources: [
          {
            source: 'crossref',
            matched_fields: ['title', 'doi'],
            checked_at: '2026-11-21T00:00:00Z',
            title: 'Deep Learning',
            url: 'https://\\\\evil.com/phish',
            doi: '10.1038/nature14539',
          },
        ],
      });
      const { container: c3, unmount: u3 } = renderWithProviders(
        <InteractiveDecisionFlowBoard verdict={fallbackDoiVerdict} />,
      );
      const safeAnchors = Array.from(c3.querySelectorAll('a'));
      expect(safeAnchors.length).toBe(1);
      expect(safeAnchors[0].getAttribute('href')).toBe(
        'https://doi.org/10.1038/nature14539',
      );
      u3();

      // 4. UpgradeModal & PricingPage: reject http:javascript:alert(1), https://\\evil.com/phish, and //evil.com
      const origLocation = window.location;
      const mockLocation = {
        ...origLocation,
        href: 'http://localhost:3000/pricing',
      };
      Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: mockLocation,
      });

      try {
        const maliciousUrls = [
          'http:javascript:alert(1)',
          'https://\\\\evil.com/phish',
          '//evil.com',
        ];

        for (const badCheckoutUrl of maliciousUrls) {
          vi.spyOn(api, 'createCheckoutSession').mockResolvedValueOnce({
            session_id: 'cs_bad',
            checkout_url: badCheckoutUrl,
            mode: 'stripe_demo',
            plan_tier: 'pro',
            plan_name: 'Pro',
            billing_cycle: 'annual',
            amount_usd: 192,
            transaction_id: 99,
          });

          const onOpenChange = vi.fn();
          const { unmount: uModal } = renderWithProviders(
            <Routes>
              <Route
                path="/"
                element={<UpgradeModal open={true} onOpenChange={onOpenChange} />}
              />
              <Route
                path="*"
                element={<div data-testid="unexpected-modal-nav">Bad Nav</div>}
              />
            </Routes>,
            { user: makeUser('user', 'basic'), initialRoute: '/' },
          );

          fireEvent.click(screen.getByTestId('modal-upgrade-pro-btn'));
          await waitFor(() =>
            expect(
              screen.getByText(/Invalid checkout redirect URL/i),
            ).toBeDefined(),
          );
          expect(mockLocation.href).toBe('http://localhost:3000/pricing');
          expect(screen.queryByTestId('unexpected-modal-nav')).toBeNull();
          expect(onOpenChange).not.toHaveBeenCalledWith(false);
          uModal();
        }

        for (const badCheckoutUrl of maliciousUrls) {
          vi.spyOn(api, 'createCheckoutSession').mockResolvedValueOnce({
            session_id: 'cs_bad_pricing',
            checkout_url: badCheckoutUrl,
            mode: 'stripe_demo',
            plan_tier: 'pro',
            plan_name: 'Pro',
            billing_cycle: 'annual',
            amount_usd: 192,
            transaction_id: 100,
          });

          const { unmount: uPricing } = renderWithProviders(
            <Routes>
              <Route path="/pricing" element={<PricingPage />} />
              <Route
                path="*"
                element={<div data-testid="unexpected-pricing-nav">Bad Nav</div>}
              />
            </Routes>,
            { user: makeUser('user', 'basic'), initialRoute: '/pricing' },
          );

          fireEvent.click(screen.getByTestId('select-pro-btn'));
          await waitFor(() =>
            expect(
              screen.getByText(/Invalid checkout redirect URL/i),
            ).toBeDefined(),
          );
          expect(mockLocation.href).toBe('http://localhost:3000/pricing');
          expect(screen.queryByTestId('unexpected-pricing-nav')).toBeNull();
          uPricing();
        }
      } finally {
        Object.defineProperty(window, 'location', {
          configurable: true,
          writable: true,
          value: origLocation,
        });
      }
    });
  });

  // =========================================================================
  // FE-02 & FE-05: Session/Toast Isolation, 403 Deactivated & Class CSV Export
  // =========================================================================
  describe('FE-02 & FE-05: Cross-Account Toast Isolation, 403 Deactivated & Class CSV Export', () => {
    it('clears floating toasts and sessionStorage notification history on logout(), account switch, and citra:unauthorized', async () => {
      function SessionToastHarness() {
        const { user, login, logout } = useAuth();
        const toast = useToast();
        return (
          <div>
            <span data-testid="active-username">{user?.username ?? 'guest'}</span>
            <span data-testid="history-count">{toast.history.length}</span>
            <span data-testid="toast-count">{toast.toasts.length}</span>
            <button
              data-testid="add-confidential-toast"
              onClick={() =>
                toast.success('Thesis_Confidential_UserA.pdf', 'CIS 96.4% ready')
              }
            >
              Add Toast
            </button>
            <button data-testid="do-logout" onClick={() => void logout()}>
              Logout
            </button>
            <button
              data-testid="do-switch-user"
              onClick={() => void login('user_b', 'secret123')}
            >
              Login B
            </button>
          </div>
        );
      }

      localStorage.setItem('token', 'token-user-a');
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith('/auth/me')) {
          return new Response(
            JSON.stringify(makeUser('user', 'pro', { id: 101, username: 'user_a' })),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url.endsWith('/auth/logout')) {
          return new Response(JSON.stringify({ message: 'ok' }), { status: 200 });
        }
        if (url.endsWith('/auth/login')) {
          return new Response(
            JSON.stringify({
              token: 'token-user-b',
              user: makeUser('user', 'basic', { id: 202, username: 'user_b' }),
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('{}', { status: 200 });
      });

      render(
        <QueryClientProvider client={appQueryClient}>
          <ToastProvider>
            <AuthProvider>
              <SessionToastHarness />
            </AuthProvider>
          </ToastProvider>
        </QueryClientProvider>,
      );

      await waitFor(() =>
        expect(screen.getByTestId('active-username').textContent).toBe('user_a'),
      );

      fireEvent.click(screen.getByTestId('add-confidential-toast'));
      expect(screen.getByTestId('toast-count').textContent).toBe('1');
      expect(screen.getByTestId('history-count').textContent).toBe('1');
      expect(sessionStorage.getItem('citra_notification_history_v1')).toContain(
        'Thesis_Confidential_UserA.pdf',
      );

      // Account switch directly from user_a (id=101) to user_b (id=202) wipes prior user's toasts & history
      fireEvent.click(screen.getByTestId('do-switch-user'));
      await waitFor(() =>
        expect(screen.getByTestId('active-username').textContent).toBe('user_b'),
      );
      expect(screen.getByTestId('toast-count').textContent).toBe('0');
      expect(screen.getByTestId('history-count').textContent).toBe('0');
      expect(sessionStorage.getItem('citra_notification_history_v1')).toBeNull();

      // Add another toast as user_b, then logout -> wipes toasts & sessionStorage key
      fireEvent.click(screen.getByTestId('add-confidential-toast'));
      expect(screen.getByTestId('history-count').textContent).toBe('1');

      fireEvent.click(screen.getByTestId('do-logout'));
      await waitFor(() =>
        expect(screen.getByTestId('active-username').textContent).toBe('guest'),
      );
      expect(screen.getByTestId('toast-count').textContent).toBe('0');
      expect(screen.getByTestId('history-count').textContent).toBe('0');
      expect(sessionStorage.getItem('citra_notification_history_v1')).toBeNull();

      fetchSpy.mockRestore();
    });

    it('treats 403 "Account is deactivated" as session termination, dispatches citra:unauthorized on SSE 401, and exports Class CSV via api.downloadClassCsvFile', async () => {
      expect(typeof (api as Record<string, unknown>).downloadClassCsvFile).toBe(
        'function',
      );

      const unauthorizedSpy = vi.fn();
      window.addEventListener('citra:unauthorized', unauthorizedSpy);

      try {
        localStorage.setItem('token', 'deactivated-jwt');
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
          new Response(JSON.stringify({ detail: 'Account is deactivated' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          }),
        );

        await expect(api.listEssays()).rejects.toThrow(/Account is deactivated/i);
        expect(unauthorizedSpy).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem('token')).toBeNull();

        // Normal RBAC 403 must NOT sign the user out
        localStorage.setItem('token', 'valid-student-jwt');
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
          new Response(JSON.stringify({ detail: 'Admin access required' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
        await expect(api.listUsers()).rejects.toThrow(/Admin access required/i);
        expect(unauthorizedSpy).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem('token')).toBe('valid-student-jwt');

        // SSE 401 dispatches citra:unauthorized
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
          new Response('Unauthorized', { status: 401 }),
        );
        const controller = new AbortController();
        const settled = await streamEssayEvents(42, () => {}, controller.signal);
        expect(settled).toBe(false);
        expect(unauthorizedSpy).toHaveBeenCalledTimes(2);
      } finally {
        window.removeEventListener('citra:unauthorized', unauthorizedSpy);
      }
    });
  });

  // =========================================================================
  // FE-03: Technical SEO (syncRobotsMeta + sitemap.xml Parity)
  // =========================================================================
  describe('FE-03: Technical SEO Robots Meta & Sitemap Parity', () => {
    it('marks /, /pricing, /privacy, /terms as index, follow and matches sitemap.xml without auth form URLs', () => {
      const syncRobotsMeta = (
        routerMod as unknown as { syncRobotsMeta?: (pathname: string) => void }
      ).syncRobotsMeta;
      const publicPaths = (
        routerMod as unknown as { PUBLIC_INDEXABLE_PATHS?: ReadonlySet<string> }
      ).PUBLIC_INDEXABLE_PATHS;

      expect(typeof syncRobotsMeta).toBe('function');
      expect(publicPaths).toBeDefined();
      expect(Array.from(publicPaths!).sort()).toEqual([
        '/',
        '/pricing',
        '/privacy',
        '/terms',
      ]);

      for (const indexablePath of ['/', '/pricing', '/privacy', '/terms', '/pricing/']) {
        syncRobotsMeta!(indexablePath);
        const meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
        expect(meta?.content).toBe('index, follow');
      }

      for (const privatePath of [
        '/login',
        '/register',
        '/forgot-password',
        '/dashboard',
        '/verify/share/abc',
      ]) {
        syncRobotsMeta!(privatePath);
        const meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
        expect(meta?.content).toBe('noindex, nofollow');
      }

      const sitemapXml = fs.readFileSync(
        path.join(WEB_ROOT, 'public', 'sitemap.xml'),
        'utf-8',
      );
      const locs = Array.from(sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)).map(
        (m) => m[1],
      );
      expect(locs).toEqual([
        'https://citra.io.vn/',
        'https://citra.io.vn/pricing',
        'https://citra.io.vn/privacy',
        'https://citra.io.vn/terms',
      ]);
    });
  });

  // =========================================================================
  // FE-04: Poisoned terminalErrorRef & Stale Deleted Essay Cache Purge
  // =========================================================================
  describe('FE-04: Retry After Terminal Failure & Deleted Essay Cache Purge', () => {
    it('allows explicit refetch() on useEssayReport and useOrphanReport to hit api.getEssay after an SSE failure', async () => {
      const encoder = new TextEncoder();
      const failedSse = () =>
        new ReadableStream<Uint8Array>({
          start(ctrl) {
            const snap: Partial<EssayStatus> = {
              status: 'failed',
              step: 'retrieving',
              step_index: 4,
              total_steps: 8,
              error: 'Temporary upstream outage',
            };
            ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(snap)}\n\n`));
            ctrl.close();
          },
        });

      vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
        new Response(failedSse(), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      );

      const recoveredReport: AnalysisReport = makeReport({
        essay_id: 77,
        filename: 'recovered.pdf',
      });
      let isRecovered = false;
      const getEssaySpy = vi
        .spyOn(api, 'getEssay')
        .mockImplementation(async () => (isRecovered ? recoveredReport : null));

      const qc = createTestQueryClient();
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      );

      const { result } = renderHook(() => useEssayReport(77), { wrapper });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error?.message).toContain('Temporary upstream outage');

      // Now user triggers reanalyze + explicit refetch(): must reach api.getEssay(77) and succeed!
      isRecovered = true;
      const refetched = await result.current.refetch();
      expect(getEssaySpy).toHaveBeenCalledWith(77, expect.anything());
      expect(refetched.data?.filename).toBe('recovered.pdf');

      // Same check for useOrphanReport
      isRecovered = false;
      const qc2 = createTestQueryClient();
      const wrapper2 = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={qc2}>{children}</QueryClientProvider>
      );
      const { result: orphanRes } = renderHook(() => useOrphanReport(88), {
        wrapper: wrapper2,
      });
      await waitFor(() => expect(orphanRes.current.isError).toBe(true));

      isRecovered = true;
      const orphanRefetched = await orphanRes.current.refetch();
      expect(orphanRefetched.data?.filename).toBe('recovered.pdf');
    });

    it('useDeleteEssay purges essay-report and orphan-report caches for the deleted ID and invalidates dashboard-stats', async () => {
      vi.spyOn(api, 'deleteEssay').mockResolvedValue({ message: 'deleted' });
      const qc = new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: 60_000 },
          mutations: { retry: false, gcTime: 60_000 },
        },
      });
      qc.setQueryData(['essay-report', 42], makeReport({ essay_id: 42 }));
      qc.setQueryData(['orphan-report', 42], makeReport({ essay_id: 42 }));
      qc.setQueryData(['essay-report', 99], makeReport({ essay_id: 99 }));
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      );
      const { result } = renderHook(() => useDeleteEssay(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync(42);
      });

      expect(qc.getQueryData(['essay-report', 42])).toBeUndefined();
      expect(qc.getQueryData(['orphan-report', 42])).toBeUndefined();
      expect(qc.getQueryData(['essay-report', 99])).toBeDefined();
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['dashboard-stats'],
      });
    });
  });

  // =========================================================================
  // FE-06 & FE-07 & FE-08: WCAG 2.2 AA Modals, Interactive Semantics & Labels
  // =========================================================================
  describe('FE-06, FE-07 & FE-08: WCAG 2.2 AA Accessibility & Interactive Semantics', () => {
    it('wires useModalA11y (dialog role, aria-labelledby, Escape close, Tab trap) across custom modals', async () => {
      // 1. CreateClassDialog
      const onCloseCreate = vi.fn();
      const { unmount: u1 } = renderWithProviders(
        <CreateClassDialog open={true} onClose={onCloseCreate} onCreated={() => {}} />,
      );
      const createDialog = screen.getByRole('dialog');
      expect(createDialog.getAttribute('aria-modal')).toBe('true');
      expect(createDialog.getAttribute('aria-labelledby')).toBeTruthy();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onCloseCreate).toHaveBeenCalledTimes(1);
      u1();

      // 2. AddStudentDialog
      vi.spyOn(api, 'listStudents').mockResolvedValue([]);
      const onCloseAdd = vi.fn();
      const { unmount: u2 } = renderWithProviders(
        <AddStudentDialog
          open={true}
          classId={1}
          existingStudentIds={[]}
          onClose={onCloseAdd}
          onAdded={() => {}}
        />,
      );
      await waitFor(() => expect(api.listStudents).toHaveBeenCalled());
      expect(screen.getByRole('dialog').getAttribute('aria-labelledby')).toBeTruthy();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onCloseAdd).toHaveBeenCalledTimes(1);
      u2();

      // 3. HelpModal
      const onCloseHelp = vi.fn();
      const { unmount: u3 } = renderWithProviders(
        <HelpModal isOpen={true} onClose={onCloseHelp} />,
      );
      expect(screen.getByRole('dialog').getAttribute('aria-labelledby')).toBeTruthy();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onCloseHelp).toHaveBeenCalledTimes(1);
      u3();

      // 4. OverrideControls modal
      const { unmount: u4 } = renderWithProviders(
        <OverrideControls
          verdict={makeVerdict({ citation_id: 'v1' })}
          onOverride={async () => {}}
        />,
        { user: makeUser('teacher', 'pro') },
      );
      fireEvent.click(screen.getByTestId('override-badge'));
      expect(screen.getByRole('dialog').getAttribute('aria-labelledby')).toBeTruthy();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
      u4();

      // 5. DocumentInspectorWorkspace CitationPopup
      const inspectorReport = makeReport({
        verdicts: [
          makeVerdict({
            citation_id: 'cit-popup-1',
            citation_raw: '[1] Vaswani et al. (2017)',
            context: 'Transformers [1] are widely used.',
          }),
        ],
      });
      const parentEscapeSpy = vi.fn();
      window.addEventListener('keydown', parentEscapeSpy);
      try {
        const { unmount: u5 } = renderWithProviders(
          <DocumentInspectorWorkspace
            essayId="1"
            report={inspectorReport}
            embedded={true}
          />,
          { user: makeUser('teacher', 'pro') },
        );
        const firstCitationBtn = screen
          .getAllByRole('button')
          .find((b) => b.textContent?.includes('Vaswani et al. (2017)'));
        expect(firstCitationBtn).toBeDefined();
        fireEvent.click(firstCitationBtn!);
        const popupDialog = screen.getByRole('dialog');
        expect(popupDialog.getAttribute('aria-modal')).toBe('true');
        expect(popupDialog.getAttribute('aria-labelledby')).toBeTruthy();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(parentEscapeSpy).not.toHaveBeenCalled();
        u5();
      } finally {
        window.removeEventListener('keydown', parentEscapeSpy);
      }

      // 6. MyClassesPage Leave Class modal
      vi.spyOn(api, 'getTeacherDashboard').mockResolvedValue({
        total_classes: 0,
        total_students: 0,
        total_essays: 0,
        pending_reviews: 0,
        classes: [],
      });
      vi.spyOn(api, 'listEnrolledClasses').mockResolvedValue([
        {
          id: 55,
          name: 'Thesis Cohort A',
          description: null,
          teacher_id: 2,
          teacher_username: 'lecturer1',
          created_at: '2026-11-01T00:00:00Z',
          student_count: 10,
          essay_count: 2,
        },
      ]);
      const { unmount: u6 } = renderWithProviders(<MyClassesPage />, {
        user: makeUser('teacher', 'pro'),
      });
      const leaveBtn = await screen.findByTestId('leave-class-btn-55');
      fireEvent.click(leaveBtn);
      const leaveDialog = screen.getByRole('dialog');
      expect(leaveDialog.getAttribute('aria-labelledby')).toBeTruthy();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
      u6();

      // 7. ClassDetailPage Edit Class modal
      vi.spyOn(api, 'listMyClasses').mockResolvedValue([
        {
          id: 10,
          name: 'NLP Seminar',
          description: 'Desc',
          join_code: 'NLP101',
          teacher_id: 2,
          teacher_username: 'lecturer1',
          created_at: '2026-11-01T00:00:00Z',
          student_count: 5,
          essay_count: 1,
        },
      ]);
      vi.spyOn(api, 'listClassStudents').mockResolvedValue([]);
      vi.spyOn(api, 'listClassEssays').mockResolvedValue([]);
      vi.spyOn(api, 'getClassAnalytics').mockResolvedValue({
        class_id: 10,
        class_name: 'NLP Seminar',
        total_students: 5,
        total_essays: 1,
        avg_cis: 90,
        recency_5yr_ratio: 0.8,
        cis_distribution: {},
        verdict_breakdown: {},
        top_triggered_rules: [],
        shared_hallucinations: [],
      });

      const { unmount: u7 } = renderWithProviders(
        <Routes>
          <Route path="/teacher/classes/:classId" element={<ClassDetailPage />} />
        </Routes>,
        {
          user: makeUser('teacher', 'pro'),
          initialRoute: '/teacher/classes/10',
        },
      );
      const editBtn = await screen.findByRole('button', { name: /edit/i });
      fireEvent.click(editBtn);
      expect(screen.getByRole('dialog').getAttribute('aria-labelledby')).toBeTruthy();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
      u7();
    });

    it('removes nested <button> inside <Link> on HistoryPage, adds keyboard support on EvidenceGraphNode, and fixes menu/dialog ARIA roles', async () => {
      vi.spyOn(api, 'listEssays').mockResolvedValue([
        {
          id: 42,
          filename: 'manuscript_v1.pdf',
          num_pages: 12,
          uploaded_at: '2026-11-20T00:00:00Z',
          user_id: 10,
          cis_score: 91,
        },
      ]);

      const { unmount: uHist } = renderWithProviders(<HistoryPage />, {
        user: makeUser('user', 'pro'),
      });
      const essayItem = await screen.findByTestId('essay-item');
      const anchor =
        essayItem.tagName === 'A' ? essayItem : essayItem.querySelector('a');
      expect(anchor).not.toBeNull();
      expect(anchor!.querySelector('button')).toBeNull();
      // Student role hides internal ID #42 & GROBID TEI parser pill (FE-11)
      expect(essayItem.textContent).not.toContain('ID #42');
      expect(essayItem.textContent).not.toContain('GROBID TEI');
      uHist();

      // EvidenceGraphNode keyboard Enter / Space + aria-expanded
      const onExpand = vi.fn();
      const { unmount: uGraph } = renderWithProviders(
        <EvidenceGraphNode
          node={{
            id: 'root-ref',
            label: 'Vaswani et al. (2017)',
            type: 'reference',
            status: 'success',
            children: [
              {
                id: 'child-src',
                label: 'Crossref',
                type: 'source',
                status: 'success',
              },
            ],
          }}
          expandedNodes={new Set()}
          onExpand={onExpand}
        />,
      );
      const graphBtn = screen.getByRole('button', { name: /Vaswani et al/i });
      expect(graphBtn.getAttribute('tabindex')).toBe('0');
      expect(graphBtn.getAttribute('aria-expanded')).toBe('false');
      fireEvent.keyDown(graphBtn, { key: 'Enter' });
      fireEvent.keyDown(graphBtn, { key: ' ' });
      expect(onExpand).toHaveBeenCalledTimes(2);
      uGraph();

      // EssayHeader export menu items have role="menuitem"
      const { unmount: uHeader } = renderWithProviders(
        <EssayHeader
          essayId={1}
          filename="thesis.docx"
          numPages={10}
          numCitations={5}
        />,
        { user: makeUser('user', 'pro') },
      );
      const exportMenu = screen.getByTestId('export-dropdown-menu');
      expect(exportMenu.querySelectorAll('[role="menuitem"]').length).toBeGreaterThanOrEqual(5);
      uHeader();

      // AppLayout account popover uses dialog role instead of menu without menuitems
      const { unmount: uLayout } = renderWithProviders(
        <AppLayout>
          <div>Workspace</div>
        </AppLayout>,
        { user: makeUser('admin') },
      );
      expect(
        screen.getByTestId('sidebar-account-trigger').getAttribute('aria-haspopup'),
      ).toBe('dialog');
      expect(
        screen.getByTestId('sidebar-account-popover').getAttribute('role'),
      ).toBe('dialog');
      uLayout();
    });

    it('provides aria-label on icon-only buttons and htmlFor/id + aria-labelledby form wiring', async () => {
      // UserFormDialog labels & switches
      const { unmount: uForm } = renderWithProviders(
        <UserFormDialog
          open={true}
          onOpenChange={() => {}}
          onSuccess={() => {}}
        />,
      );
      const switches = screen.getAllByRole('switch');
      expect(switches.length).toBeGreaterThanOrEqual(1);
      for (const sw of switches) {
        expect(
          sw.getAttribute('aria-labelledby') || sw.getAttribute('aria-label'),
        ).toBeTruthy();
      }
      expect(screen.getByLabelText(/username/i)).toBeDefined();
      expect(screen.getByLabelText(/email/i)).toBeDefined();
      uForm();

      // ProfilePage labels wired to inputs
      const { unmount: uProfile } = renderWithProviders(<ProfilePage />, {
        user: makeUser('user', 'pro', { has_password: true }),
      });
      expect(screen.getByLabelText(/full name/i)).toBeDefined();
      expect(screen.getByLabelText(/^email$/i)).toBeDefined();
      expect(screen.getByLabelText(/current password/i)).toBeDefined();
      expect(screen.getByLabelText(/^new password$/i)).toBeDefined();
      uProfile();

      // GoogleOnboardingModal labels wired to inputs
      const { unmount: uOnboard } = renderWithProviders(
        <GoogleOnboardingModal />,
        {
          user: makeUser('user', 'basic', {
            needs_onboarding: true,
            privacy_consented_at: '2026-11-20T00:00:00Z',
          }),
          initialRoute: '/dashboard',
        },
      );
      const onboardDialog = await screen.findByRole('dialog');
      const onboardInputs = onboardDialog.querySelectorAll(
        'input[type="text"], input[type="password"]',
      );
      for (const inp of Array.from(onboardInputs)) {
        expect(
          inp.getAttribute('id') || inp.getAttribute('aria-label'),
        ).toBeTruthy();
      }
      uOnboard();

      // AuditLogPage & AccountManagementPage clear-search icon buttons have aria-label
      vi.spyOn(api, 'listAuditLog').mockResolvedValue([]);
      vi.spyOn(api, 'getAuditStats').mockResolvedValue({
        total_events: 0,
        unique_actors: 0,
      });
      const { container: auditC, unmount: uAudit } = renderWithProviders(
        <AuditLogPage />,
        { user: makeUser('admin') },
      );
      const auditInput = screen.getByPlaceholderText(/username/i);
      fireEvent.change(auditInput, { target: { value: 'alice' } });
      for (const btn of Array.from(auditC.querySelectorAll('button'))) {
        const text = (btn.textContent || '').trim();
        if (!text) {
          expect(btn.getAttribute('aria-label')).toBeTruthy();
        }
      }
      uAudit();

      vi.spyOn(api, 'listUsers').mockResolvedValue([makeUser('user')]);
      const { container: acctC, unmount: uAcct } = renderWithProviders(
        <AccountManagementPage />,
        { user: makeUser('admin') },
      );
      await waitFor(() => expect(api.listUsers).toHaveBeenCalled());
      fireEvent.change(screen.getByPlaceholderText(/search/i), {
        target: { value: 'student' },
      });
      for (const btn of Array.from(acctC.querySelectorAll('button'))) {
        const text = (btn.textContent || '').trim();
        if (!text) {
          expect(btn.getAttribute('aria-label')).toBeTruthy();
        }
      }
      uAcct();
    });
  });

  // =========================================================================
  // FE-09..FE-14 & QA-11: Validation, i18n, Mobile Promo, Theme & Unit Coverage
  // =========================================================================
  describe('FE-09..FE-14 & QA-11: Validation, VI Localization, Mobile Promo, Theme & Component Tests', () => {
    it('enforces validatePasswordClient (6..128 chars, non-whitespace, <= 72 UTF-8 bytes), dynamic isValidExpiry, and zero as-any casts in Inspector/Orphan pages', async () => {
      const validatePasswordClient = (
        utilsMod as unknown as { validatePasswordClient?: ValidatePasswordFn }
      ).validatePasswordClient;
      expect(typeof validatePasswordClient).toBe('function');

      expect(validatePasswordClient!('12345').valid).toBe(false);
      expect(validatePasswordClient!('        ').valid).toBe(false);
      expect(validatePasswordClient!('a'.repeat(129)).valid).toBe(false);
      // 30 multi-byte Vietnamese characters = 90 UTF-8 bytes (> 72 bytes, <= 128 chars)
      const multibyteOver72 = 'ễ'.repeat(30);
      expect(new TextEncoder().encode(multibyteOver72).length).toBeGreaterThan(72);
      expect(validatePasswordClient!(multibyteOver72).valid).toBe(false);
      // 70 ASCII chars (> 64, <= 72 bytes) must be valid!
      expect(validatePasswordClient!('A1!' + 'b'.repeat(67)).valid).toBe(true);

      // ResetPasswordPage blocks >72 UTF-8 bytes before calling api.resetPassword
      vi.spyOn(api, 'verifyResetToken').mockResolvedValue({
        valid: true,
        username: 'student1',
        email: 'student1@tdtu.edu.vn',
        message: 'ok',
      });
      const resetSpy = vi.spyOn(api, 'resetPassword');
      const { unmount: uReset } = renderWithProviders(<ResetPasswordPage />, {
        user: null,
        initialRoute: '/reset-password?token=valid-tok',
      });
      const newPwInput = await screen.findByLabelText(/^new password$/i);
      const confirmPwInput = screen.getByLabelText(/confirm new password/i);
      expect(newPwInput.getAttribute('maxLength')).toBe('128');
      fireEvent.change(newPwInput, { target: { value: multibyteOver72 } });
      fireEvent.change(confirmPwInput, { target: { value: multibyteOver72 } });
      fireEvent.click(screen.getByRole('button', { name: /update password/i }));
      expect(resetSpy).not.toHaveBeenCalled();
      expect(screen.getByText(/72/i)).toBeDefined();
      uReset();

      // RegisterPage allows 70-char ASCII password (maxLength=128, not capped at 64)
      const { container: regC, unmount: uReg } = renderWithProviders(
        <RegisterPage />,
        { user: null, initialRoute: '/register' },
      );
      const regPw = regC.querySelector('#password') as HTMLInputElement;
      expect(regPw.maxLength === 128 || regPw.getAttribute('maxlength') === '128').toBe(
        true,
      );
      uReg();

      // Dynamic month-aware isValidExpiry against current date
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-21T12:00:00Z'));
      expect(isValidExpiry('01/26')).toBe(false);
      expect(isValidExpiry('10/26')).toBe(false);
      expect(isValidExpiry('11/26')).toBe(true);
      expect(isValidExpiry('12/26')).toBe(true);
      expect(isValidExpiry('01/27')).toBe(true);
      vi.useRealTimers();

      // Zero `as any` casts in DocumentInspectorPage.tsx and OrphanDetectionPage.tsx
      const docInspSrc = fs.readFileSync(
        path.join(SRC_ROOT, 'pages', 'DocumentInspectorPage.tsx'),
        'utf-8',
      );
      const orphanSrc = fs.readFileSync(
        path.join(SRC_ROOT, 'pages', 'OrphanDetectionPage.tsx'),
        'utf-8',
      );
      expect(docInspSrc).not.toContain('as any');
      expect(orphanSrc).not.toContain('as any');
    });

    it('localizes IssuesPage, ErrorBoundary (throwing child + reset + HOC), ConfirmationModal, and getDocumentTitle in Vietnamese', async () => {
      await i18n.changeLanguage('vi');

      // getDocumentTitle localized in VI while preserving English default
      const getTitle = routerMod.getDocumentTitle as (
        pathname: string,
        lang?: string,
      ) => string;
      expect(getTitle('/terms')).toBe('CITRA - Terms of Service');
      expect(getTitle('/terms', 'vi')).not.toBe('CITRA - Terms of Service');
      expect(getTitle('/dashboard', 'vi')).toContain('CITRA -');
      expect(getTitle('/dashboard', 'vi')).not.toBe('CITRA - Dashboard');
      expect(getTitle('/nonexistent-xyz', 'vi')).not.toBe(
        'CITRA - Page Not Found',
      );

      // IssuesPage in VI
      vi.spyOn(api, 'getEssay').mockResolvedValue(
        makeReport({
          verdicts: [
            makeVerdict({
              citation_id: 'iss-1',
              citation_raw: 'Fake (2025)',
              label: 'suspected_hallucination',
            }),
          ],
        }),
      );
      const { container: issuesC, unmount: uIssues } = renderWithProviders(
        <Routes>
          <Route
            path="/verification/report/:id/issues"
            element={<IssuesPage />}
          />
        </Routes>,
        {
          user: makeUser('user', 'pro'),
          initialRoute: '/verification/report/1/issues',
        },
      );
      await waitFor(() =>
        expect(issuesC.textContent).toContain('Tổng vấn đề phát hiện'),
      );
      expect(issuesC.textContent).not.toContain('(1 issue)');
      expect(issuesC.textContent).not.toContain('1 citations');
      uIssues();

      // ErrorBoundary throwing child render & reset (QA-11 + FE-10)
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      let shouldThrow = true;
      function BuggyWidget() {
        if (shouldThrow) {
          throw new Error('Synthetic render explosion');
        }
        return <div data-testid="recovered-widget">Recovered OK</div>;
      }
      const onReset = vi.fn(() => {
        shouldThrow = false;
      });

      const { unmount: uErr } = render(
        <ErrorBoundary onReset={onReset}>
          <BuggyWidget />
        </ErrorBoundary>,
      );
      expect(screen.getByText('Synthetic render explosion')).toBeDefined();
      expect(document.body.textContent).not.toContain('Something went wrong');
      const retryBtn = screen.getByRole('button', { name: /thử lại/i });
      fireEvent.click(retryBtn);
      expect(onReset).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('recovered-widget').textContent).toBe(
        'Recovered OK',
      );
      uErr();

      // withErrorBoundary HOC
      shouldThrow = true;
      const SafeWidget = withErrorBoundary(BuggyWidget, undefined, {
        pageLevel: true,
      });
      const { unmount: uHoc } = render(<SafeWidget />);
      expect(screen.getByText('Synthetic render explosion')).toBeDefined();
      uHoc();
      consoleErrorSpy.mockRestore();

      // ConfirmationModal in VI while submitting async confirm
      let resolveConfirm!: () => void;
      const onConfirm = vi.fn(
        () =>
          new Promise<void>((r) => {
            resolveConfirm = r;
          }),
      );
      const onCancel = vi.fn();
      const { unmount: uConfirm } = render(
        <ConfirmationModal
          isOpen={true}
          title="Xóa báo cáo"
          message="Hành động này không thể hoàn tác."
          confirmLabel="Xóa"
          cancelLabel="Hủy"
          variant="danger"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />,
      );
      fireEvent.click(screen.getByTestId('confirmation-confirm-btn'));
      expect(
        screen.getByTestId('confirmation-confirm-btn').textContent,
      ).not.toBe('Working...');
      await act(async () => {
        resolveConfirm();
      });
      uConfirm();
    });

    it('renders mobile stacked cards on PromoManagementPage, removes .py chrome labels, updates Solva theme-color, and covers clipboard/fileKind/GoogleAuthButton', async () => {
      // PromoManagementPage mobile card list + responsive code row (FE-12)
      vi.spyOn(api, 'listAdminPromoCodes').mockResolvedValue({
        stats: {
          total_codes: 1,
          active_codes: 1,
          total_redemptions: 3,
          total_discount_usd: 15,
        },
        promos: [
          {
            id: 1,
            code: 'SOLVA6',
            description: 'Editorial Campaign',
            discount_type: 'percent',
            discount_value: 25,
            max_discount_usd: 20,
            min_amount_usd: 0,
            applicable_tiers: 'all',
            applicable_cycles: 'all',
            max_uses: 100,
            max_uses_per_user: 1,
            used_count: 3,
            is_active: true,
            is_expired: false,
            is_exhausted: false,
            effective_status: 'active',
            expires_at: '2026-12-31T00:00:00Z',
            created_by: 1,
            created_at: '2026-11-01T00:00:00Z',
            updated_at: null,
          },
        ],
      });

      const { container: promoC, unmount: uPromo } = renderWithProviders(
        <PromoManagementPage />,
        { user: makeUser('admin') },
      );
      await waitFor(() =>
        expect(screen.getAllByText('SOLVA6').length).toBeGreaterThanOrEqual(2),
      );
      expect(
        promoC.querySelector('[data-testid="promo-mobile-cards"]'),
      ).not.toBeNull();
      // Open Create modal and verify label/input association & responsive flex-col sm:flex-row
      fireEvent.click(
        screen.getByRole('button', { name: /create promo|tạo mã/i }),
      );
      const codeInput = screen.getByTestId('promo-code-input');
      expect(codeInput.parentElement?.className).toContain('flex-col');
      expect(codeInput.parentElement?.className).toContain('sm:flex-row');
      for (const btn of Array.from(document.body.querySelectorAll('button'))) {
        if (!(btn.textContent || '').trim()) {
          expect(btn.getAttribute('aria-label')).toBeTruthy();
        }
      }
      uPromo();

      // BatchUploadPage & ProcessingPage no longer leak raw .py script names (FE-11)
      vi.spyOn(api, 'listMyClasses').mockResolvedValue([]);
      const { container: batchC, unmount: uBatch } = renderWithProviders(
        <BatchUploadPage />,
        { user: makeUser('user', 'pro') },
      );
      expect(batchC.textContent).not.toContain('batch_ingest_queue.py');
      uBatch();

      vi.spyOn(api, 'getEssayStatus').mockResolvedValue({
        status: 'processing',
        step: 'parsing',
        step_index: 0,
        total_steps: 8,
        message: 'Parsing...',
        citations_found: 0,
        references_found: 0,
        linked: 0,
        sources_queried: {},
        elapsed_seconds: 0.5,
        finished_at: null,
        error: null,
      });
      const { container: procC, unmount: uProc } = renderWithProviders(
        <Routes>
          <Route
            path="/verification/processing/:id"
            element={<ProcessingPage />}
          />
        </Routes>,
        {
          user: makeUser('user', 'pro'),
          initialRoute: '/verification/processing/55',
        },
      );
      await waitFor(() => expect(api.getEssayStatus).toHaveBeenCalled());
      expect(procC.textContent).not.toContain('integrity_pipeline.py');
      uProc();

      // Solva theme-color in index.html, manifest.webmanifest, and ThemeProvider (FE-13)
      const indexHtml = fs.readFileSync(
        path.join(WEB_ROOT, 'index.html'),
        'utf-8',
      );
      expect(indexHtml).not.toContain('#4f46e5');
      expect(indexHtml).toContain('#FBFAF6');
      expect(indexHtml).toContain('#141310');

      const manifest = JSON.parse(
        fs.readFileSync(
          path.join(WEB_ROOT, 'public', 'manifest.webmanifest'),
          'utf-8',
        ),
      ) as { background_color: string; theme_color: string };
      expect(manifest.background_color).toBe('#FBFAF6');
      expect(manifest.theme_color).toBe('#1C1A15');

      function ThemeProbe() {
        const { setTheme } = useTheme();
        return (
          <button data-testid="set-dark" onClick={() => setTheme('dark')}>
            Dark
          </button>
        );
      }
      const { unmount: uTheme } = render(
        <ThemeProvider defaultTheme="light">
          <ThemeProbe />
        </ThemeProvider>,
      );
      fireEvent.click(screen.getByTestId('set-dark'));
      const activeThemeMeta = document.querySelector<HTMLMetaElement>(
        'meta[name="theme-color"]:not([media])',
      ) ?? document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      expect(activeThemeMeta?.content).toBe('#141310');
      uTheme();

      //Locale 100% key parity check
      const flattenKeys = (obj: Record<string, unknown>, prefix = ''): string[] =>
        Object.entries(obj).flatMap(([k, v]) =>
          v && typeof v === 'object' && !Array.isArray(v)
            ? flattenKeys(v as Record<string, unknown>, `${prefix}${k}.`)
            : [`${prefix}${k}`],
        );
      expect(flattenKeys(enLocale).sort()).toEqual(flattenKeys(viLocale).sort());

      // QA-11: clipboard.ts, fileKind.ts, GoogleAuthButton.tsx, and makeWrapper default quota
      expect(await copyTextToClipboard('')).toBe(false);
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: writeTextMock },
      });
      expect(await copyTextToClipboard('10.1038/nature14539')).toBe(true);
      expect(writeTextMock).toHaveBeenCalledWith('10.1038/nature14539');

      writeTextMock.mockRejectedValueOnce(new Error('NotAllowedError'));
      document.execCommand = vi.fn().mockReturnValue(true);
      expect(await copyTextToClipboard('fallback-copy')).toBe(true);
      expect(document.execCommand).toHaveBeenCalledWith('copy');

      expect(isDocxFilename('paper.docx')).toBe(true);
      expect(isDocxFilename('PAPER.DOCX ')).toBe(true);
      expect(isDocxFilename('paper.pdf')).toBe(false);
      expect(isDocxFilename(null)).toBe(false);
      expect(EXPORT_FORMATS).toEqual(['json', 'csv', 'pdf', 'docx']);

      vi.spyOn(api, 'getGoogleConfig').mockResolvedValue({
        enabled: false,
        client_id: null,
      });
      const onGoogleErr = vi.fn();
      const { unmount: uGoogle } = render(
        <MemoryRouter
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <GoogleAuthButton onError={onGoogleErr} />
        </MemoryRouter>,
      );
      fireEvent.click(screen.getByTestId('google-auth-button'));
      await waitFor(() => expect(onGoogleErr).toHaveBeenCalledWith(expect.stringMatching(/Google/i)));
      uGoogle();

      // Verify renderWithProviders default user includes plan_tier & quota from makeUser('admin')
      function DefaultUserProbe() {
        const { user } = useAuth();
        return (
          <span data-testid="default-user-tier">
            {user?.plan_tier}:{user?.quota?.max_batch_files}
          </span>
        );
      }
      const { unmount: uDef } = renderWithProviders(<DefaultUserProbe />);
      expect(screen.getByTestId('default-user-tier').textContent).toBe(
        'ultra:50',
      );
      uDef();

      // Verify StripeDemoCheckoutPage exists & renders without crashing when session is loading
      vi.spyOn(api, 'getCheckoutSessionDetails').mockImplementation(
        () => new Promise(() => {}),
      );
      const { unmount: uStripe } = renderWithProviders(
        <StripeDemoCheckoutPage />,
        { initialRoute: '/billing/checkout?session_id=cs_test_1' },
      );
      uStripe();
    });

    it('enforces QA-10 E2E TypeScript/Playwright hygiene and FE-11 BatchUploadPage unsupported-file toast', async () => {
      const e2eTsconfig = JSON.parse(
        fs.readFileSync(path.join(WEB_ROOT, 'tsconfig.e2e.json'), 'utf-8'),
      ) as { include: string[] };
      expect(e2eTsconfig.include).toContain('playwright.config.ts');
      expect(e2eTsconfig.include).toContain('tests/e2e/**/*.ts');

      const pwConfig = fs.readFileSync(
        path.join(WEB_ROOT, 'playwright.config.ts'),
        'utf-8',
      );
      expect(pwConfig).toContain('prod-live-verification.spec.ts');
      expect(pwConfig).toContain('prod-smoke');

      const e2eDir = path.join(WEB_ROOT, 'tests', 'e2e');
      const specFiles = fs
        .readdirSync(e2eDir)
        .filter((f) => f.endsWith('.spec.ts'));
      expect(specFiles.length).toBeGreaterThan(0);
      for (const spec of specFiles) {
        const content = fs.readFileSync(path.join(e2eDir, spec), 'utf-8');
        expect(content, `${spec} must not use flaky waitForTimeout`).not.toContain(
          'waitForTimeout(',
        );
        expect(content, `${spec} must not swallow wait errors with .catch(() => {})`).not.toContain(
          '.catch(() => {})',
        );
      }

      // BatchUploadPage surfaces updated .PDF, .DOCX, .BIB, .RIS toast on unsupported file selection
      vi.spyOn(api, 'listMyClasses').mockResolvedValue([]);
      const { container, unmount } = renderWithProviders(<BatchUploadPage />, {
        user: makeUser('user', 'pro'),
      });
      const input = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      const badFile = new File(['bad'], 'malware.exe', {
        type: 'application/octet-stream',
      });
      fireEvent.change(input, { target: { files: [badFile] } });
      await waitFor(() =>
        expect(document.body.textContent).toMatch(/\.PDF, \.DOCX, \.BIB, \.RIS/i),
      );
      unmount();
    });

    it('Round-1 Critic Regressions: Escape inside <AppLayout><EssayPage /></AppLayout>, unnested EvidenceGraphNode link, hover-then-logout toast timer reset, WAF 403 survival, VI HistoryPage aria-label, and CitraMotionProvider reducedMotion="user"', async () => {
      // 1. CRITIC-FE-06 / FE-14: CitraMotionProvider sets MotionConfig reducedMotion="user"
      function MotionConfigProbe() {
        const cfg = useContext(MotionConfigContext);
        return <span data-testid="motion-reduced-mode">{String(cfg.reducedMotion)}</span>;
      }
      const { unmount: uMotion } = render(
        <CitraMotionProvider>
          <MotionConfigProbe />
        </CitraMotionProvider>,
      );
      expect(screen.getByTestId('motion-reduced-mode').textContent).toBe('user');
      uMotion();

      // 2. CRITIC-FE-02: EvidenceGraphNode with BOTH children and matchedSource.url has ZERO nested interactive controls
      const { container: graphC, unmount: uGraph } = renderWithProviders(
        <EvidenceGraphNode
          node={{
            id: 'root-with-link',
            label: 'Vaswani et al. (2017)',
            type: 'reference',
            status: 'success',
            matchedSource: {
              source: 'crossref',
              matched_fields: ['title'],
              checked_at: '2026-11-21T00:00:00Z',
              url: 'https://doi.org/10.48550/arXiv.1706.03762',
            },
            children: [
              {
                id: 'child-1',
                label: 'Crossref Exact Hit',
                type: 'source',
                status: 'success',
              },
            ],
          }}
          expandedNodes={new Set()}
          onExpand={() => {}}
        />,
      );
      expect(
        graphC.querySelectorAll('button a, a button, [role="button"] a, [role="button"] button')
          .length,
      ).toBe(0);
      expect(
        graphC.querySelector('a[href="https://doi.org/10.48550/arXiv.1706.03762"]'),
      ).not.toBeNull();
      uGraph();

      // 3. CRITIC-FE-06: HistoryPage delete button aria-label localized in Vietnamese
      await i18n.changeLanguage('vi');
      vi.spyOn(api, 'listEssays').mockResolvedValue([
        {
          id: 71,
          filename: 'luan_van_2026.pdf',
          num_pages: 10,
          uploaded_at: '2026-11-20T00:00:00Z',
          user_id: 10,
          cis_score: 90,
        },
      ]);
      const { unmount: uHistVi } = renderWithProviders(<HistoryPage />, {
        user: makeUser('user', 'pro'),
      });
      expect(await screen.findByLabelText('Xóa luan_van_2026.pdf')).toBeDefined();
      uHistVi();
      await i18n.changeLanguage('en');

      // 4. CRITIC-FE-01: <AppLayout><EssayPage /></AppLayout> Escape deselects citation when account popover is closed, and restores focus to trigger when open
      const appReport = makeReport({
        essay_id: 1,
        verdicts: [
          makeVerdict({
            citation_id: 'cit-default-1',
            citation_raw: '[1] Default Flagged Issue (2024)',
            label: 'metadata_error',
          }),
          makeVerdict({
            citation_id: 'cit-esc-2',
            citation_raw: '[2] LeCun, Bengio, & Hinton (2015)',
            label: 'verified',
          }),
        ],
      });
      vi.spyOn(api, 'getEssay').mockResolvedValue(appReport);
      const { unmount: uAppEssay } = renderWithProviders(
        <AppLayout>
          <Routes>
            <Route path="/verification/report/:id" element={<EssayPage />} />
          </Routes>
        </AppLayout>,
        {
          user: makeUser('teacher', 'pro'),
          initialRoute: '/verification/report/1?citation=cit-esc-2',
        },
      );
      await waitFor(() =>
        expect(
          document
            .querySelector('[data-citation-id="cit-esc-2"]')
            ?.getAttribute('aria-selected'),
        ).toBe('true'),
      );

      // Open account popover, focus a link inside it, press Escape -> closes popover & restores focus to trigger WITHOUT deselecting cit-esc-2
      const accountTrigger = screen.getByTestId('sidebar-account-trigger');
      fireEvent.click(accountTrigger);
      const popover = screen.getByTestId('sidebar-account-popover');
      expect(popover.getAttribute('aria-hidden')).toBe('false');
      const popoverLink = popover.querySelector('a') as HTMLAnchorElement;
      popoverLink.focus();
      expect(document.activeElement).toBe(popoverLink);

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(popover.getAttribute('aria-hidden')).toBe('true');
      expect(document.activeElement).toBe(accountTrigger);
      expect(
        document
          .querySelector('[data-citation-id="cit-esc-2"]')
          ?.getAttribute('aria-selected'),
      ).toBe('true');

      // Now with account popover closed (aria-hidden="true"), pressing Escape MUST deselect cit-esc-2!
      fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(() =>
        expect(
          document
            .querySelector('[data-citation-id="cit-esc-2"]')
            ?.getAttribute('aria-selected'),
        ).toBe('false'),
      );
      uAppEssay();

      // 5. CRITIC-FE-04: Empty-body / WAF 403 on validateToken and refreshUser must NOT wipe active session
      localStorage.setItem('token', 'surviving-jwt');
      const wafFetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith('/auth/me')) {
          return new Response('', { status: 403 });
        }
        if (url.endsWith('/users/me')) {
          return new Response('<html>403 Forbidden (Cloudflare WAF)</html>', {
            status: 403,
          });
        }
        return new Response('{}', { status: 200 });
      });

      function RefreshProbe() {
        const { refreshUser } = useAuth();
        return (
          <button data-testid="trigger-refresh" onClick={() => void refreshUser()}>
            Refresh
          </button>
        );
      }
      const { unmount: uWaf } = render(
        <QueryClientProvider client={createTestQueryClient()}>
          <AuthProvider>
            <RefreshProbe />
          </AuthProvider>
        </QueryClientProvider>,
      );
      await waitFor(() => expect(wafFetchSpy).toHaveBeenCalled());
      expect(localStorage.getItem('token')).toBe('surviving-jwt');
      fireEvent.click(screen.getByTestId('trigger-refresh'));
      await waitFor(() => expect(wafFetchSpy).toHaveBeenCalledTimes(2));
      expect(localStorage.getItem('token')).toBe('surviving-jwt');
      uWaf();
      wafFetchSpy.mockRestore();

      // 6. CRITIC-FE-03: Hovering a toast then firing citra:session-cleared resets isPaused so User B's toast auto-dismisses
      vi.useFakeTimers();
      function HoverPauseProbe() {
        const toast = useToast();
        return (
          <div>
            <span data-testid="probe-toast-count">{toast.toasts.length}</span>
            <button
              data-testid="spawn-short-toast"
              onClick={() => toast.info('Short Notice', 'Auto dismisses', { duration: 400 })}
            >
              Spawn
            </button>
          </div>
        );
      }
      const { unmount: uHover } = render(
        <ToastProvider>
          <HoverPauseProbe />
        </ToastProvider>,
      );
      fireEvent.click(screen.getByTestId('spawn-short-toast'));
      expect(screen.getByTestId('probe-toast-count').textContent).toBe('1');
      // Hover toast container to set isPaused = true
      const liveRegion = document.querySelector('[aria-live]') as HTMLElement;
      expect(liveRegion).not.toBeNull();
      fireEvent.mouseEnter(liveRegion);
      // Session cleared while hovered (unmounts container without mouseLeave)
      act(() => {
        window.dispatchEvent(new CustomEvent('citra:session-cleared'));
      });
      expect(screen.getByTestId('probe-toast-count').textContent).toBe('0');
      // User B spawns a new short toast -> must auto-dismiss after duration + exit animation!
      fireEvent.click(screen.getByTestId('spawn-short-toast'));
      expect(screen.getByTestId('probe-toast-count').textContent).toBe('1');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(screen.getByTestId('probe-toast-count').textContent).toBe('0');
      uHover();
      vi.useRealTimers();
    });
  });
});
