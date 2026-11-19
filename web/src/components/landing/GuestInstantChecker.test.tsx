import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { AuthContext } from '@/contexts/AuthContext';
import { CitraMotionProvider } from '@/components/ui/motion-primitives';
import { api, type SandboxInstantVerifyResponse } from '@/api/client';
import { getPlainVerdictLabel } from '@/lib/verdictExplanation';
import { makeUser } from '@/test-utils';
import i18n from '@/i18n';
import { LandingPage } from '@/pages/LandingPage';
import {
  GuestInstantChecker,
  estimateGuestReferenceCount,
} from './GuestInstantChecker';

function renderGuestChecker(lang: 'en' | 'vi' = 'en', isAuthenticated = false) {
  const mockUser = isAuthenticated ? makeUser('user') : null;

  return render(
    <CitraMotionProvider>
      <ThemeProvider defaultTheme="light">
        <MemoryRouter initialEntries={['/']}>
          <AuthContext.Provider
            value={{
              user: mockUser,
              token: isAuthenticated ? 'valid-jwt' : null,
              isAdmin: false,
              isLoading: false,
              login: async () => {},
              loginWithGoogle: async () => {},
              logout: async () => {},
              refreshUser: async () => {},
            }}
          >
            <GuestInstantChecker lang={lang} isAuthenticated={isAuthenticated} />
          </AuthContext.Provider>
        </MemoryRouter>
      </ThemeProvider>
    </CitraMotionProvider>,
  );
}

describe('Task 3.1 — GuestInstantChecker (EN & VI)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('1. renders #try-instant with 3 academic preset pills, live char & N / 3 reference counter, VI formatting, and zero raw uppercase enum strings in EN & VI', () => {
    const rawEnums = [
      'SUSPECTED_HALLUCINATION',
      'METADATA_ERROR',
      'MISSING_REFERENCE',
      'IN_TEXT_MISMATCH',
      'UNCITED_REFERENCE',
      'MATCHED',
    ];

    const { container: enContainer, unmount: unmountEn } = renderGuestChecker('en');
    const sectionEn = enContainer.querySelector('#try-instant') as HTMLElement;
    expect(sectionEn).not.toBeNull();
    expect(sectionEn.getAttribute('data-testid')).toBe('guest-instant-checker');

    expect(within(sectionEn).getByRole('button', { name: /Economics Thesis/i })).toBeDefined();
    expect(within(sectionEn).getByRole('button', { name: /Biomedical Paper/i })).toBeDefined();
    expect(within(sectionEn).getByRole('button', { name: /AI-Invented Citation/i })).toBeDefined();

    const countersEn = within(sectionEn).getByTestId('guest-checker-counters').textContent ?? '';
    expect(countersEn).toMatch(/\b[0-3]\s*\/\s*3\b/);
    expect(countersEn).toContain('1,500');
    const textEn = sectionEn.textContent ?? '';
    expect(textEn).toContain('98.5%');
    for (const raw of rawEnums) {
      expect(textEn).not.toContain(raw);
    }
    unmountEn();

    const { container: viContainer, unmount: unmountVi } = renderGuestChecker('vi');
    const sectionVi = viContainer.querySelector('#try-instant') as HTMLElement;
    expect(sectionVi).not.toBeNull();

    expect(within(sectionVi).getByRole('button', { name: /Luận văn Kinh tế/i })).toBeDefined();
    expect(within(sectionVi).getByRole('button', { name: /Bài báo Y sinh/i })).toBeDefined();
    expect(within(sectionVi).getByRole('button', { name: /Nguồn AI tự bịa/i })).toBeDefined();

    const countersVi = within(sectionVi).getByTestId('guest-checker-counters').textContent ?? '';
    expect(countersVi).toMatch(/\b[0-3]\s*\/\s*3\b/);
    expect(countersVi).toContain('1.500');
    const textVi = sectionVi.textContent ?? '';
    expect(textVi).toContain('98,5%');
    expect(textVi).not.toMatch(/\b\d{1,3},\d{3}\b/);
    for (const raw of rawEnums) {
      expect(textVi).not.toContain(raw);
    }
    unmountVi();
  });

  it('2. populates textarea on preset click, calls api.verifyPublicGuestCitations without Authorization header, and renders Split-View Manuscript Diff + copyable corrected APA', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    });

    const mockApiResponse: SandboxInstantVerifyResponse = {
      elapsed_seconds: 0.42,
      total: 1,
      summary: {
        verified: 0,
        metadata_error: 1,
        suspected_hallucination: 0,
        layer1_linking_issues: 0,
      },
      results: [
        {
          index: 1,
          citation_raw:
            'Kahneman, D., & Tversky, A. (1981). Prospect theory: An analysis of decision under risk. Journal of Political Economy, 47(2), 263-291. https://doi.org/10.2307/1914185',
          cited_title: 'Prospect theory: An analysis of decision under risk',
          cited_authors: ['Kahneman, D.', 'Tversky, A.'],
          cited_year: '1981',
          cited_venue: 'Journal of Political Economy',
          cited_doi: '10.2307/1914185',
          label: 'metadata_error',
          confidence: 0.985,
          mapping_status: 'matched',
          mapping_note: 'Direct bibliography verification.',
          reasoning: 'Publication year (1981 vs 1979) and venue differ from official Crossref record.',
          triggered_rules: ['R05_YEAR_DRIFT', 'R-VENUE-MISMATCH'],
          mismatched_fields: ['year', 'venue'],
          remediated_apa:
            'Kahneman, D., & Tversky, A. (1979). Prospect theory: An analysis of decision under risk. Econometrica, 47(2), 263–291. https://doi.org/10.2307/1914185',
          matched_source: {
            source: 'crossref',
            matched_fields: ['doi', 'title', 'authors'],
            checked_at: '2026-11-19T14:00:00Z',
            title: 'Prospect Theory: An Analysis of Decision under Risk',
            authors: ['Daniel Kahneman', 'Amos Tversky'],
            year: '1979',
            venue: 'Econometrica',
            doi: '10.2307/1914185',
            confidence: 0.985,
          },
          matched_sources: [
            {
              source: 'crossref',
              matched_fields: ['doi', 'title', 'authors'],
              checked_at: '2026-11-19T14:00:00Z',
              title: 'Prospect Theory: An Analysis of Decision under Risk',
              authors: ['Daniel Kahneman', 'Amos Tversky'],
              year: '1979',
              venue: 'Econometrica',
              doi: '10.2307/1914185',
              confidence: 0.985,
            },
          ],
        },
      ],
    };

    // Also verify client.ts verifyPublicGuestCitations omits Authorization even with a stale token
    localStorage.setItem('token', 'stale-expired-guest-jwt');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockApiResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { container } = renderGuestChecker('vi');
    const section = container.querySelector('#try-instant') as HTMLElement;

    fireEvent.click(within(section).getByRole('button', { name: /Luận văn Kinh tế/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
    expect(String(calledUrl)).toContain('/essays/sandbox/public-verify');
    const sentHeaders = (calledInit?.headers ?? {}) as Record<string, string>;
    expect(sentHeaders.Authorization).toBeUndefined();
    expect(sentHeaders.authorization).toBeUndefined();

    const plainExpected = getPlainVerdictLabel('metadata_error', 'vi');
    await waitFor(() => {
      expect(section.textContent).toContain(plainExpected.label);
      expect(section.textContent).toContain(plainExpected.actionHint);
      expect(section.textContent).toContain('Econometrica');
      expect(section.textContent).toContain('98,5%');
    });

    const copyBtn = within(section).getByTestId('guest-checker-copy-remediated-0');
    fireEvent.click(copyBtn);
    expect(writeTextMock).toHaveBeenCalledWith(
      expect.stringContaining('Econometrica, 47(2)'),
    );
  });

  it('3. guards empty, > 3 references, and > 1500 chars inline without calling API; shows friendly 429 rate-limit CTA; and falls back gracefully when offline', async () => {
    const verifySpy = vi.spyOn(api, 'verifyPublicGuestCitations');
    const { container } = renderGuestChecker('en');
    const section = container.querySelector('#try-instant') as HTMLElement;

    const textarea = within(section).getByRole('textbox') as HTMLTextAreaElement;
    const checkBtn = within(section).getByTestId('guest-checker-submit');

    // A. Empty input -> inline alert, zero API calls
    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.click(checkBtn);
    expect(verifySpy).not.toHaveBeenCalled();
    expect(within(section).getByRole('alert')).toBeDefined();

    // B. > 3 references -> inline guidance, zero API calls
    const fourRefs = [
      'Smith, J. (2020). Study one on macroeconomics. Journal of Finance, 10(1), 1-15.',
      'Doe, A. (2021). Study two on public policy. Economic Policy, 12(2), 20-35.',
      'Lee, K. (2022). Study three on trade dynamics. World Development, 15(3), 40-55.',
      'Nguyen, M. (2023). Study four on fiscal stability. ASEAN Economic Bulletin, 18(4), 60-75.',
    ].join('\n');
    fireEvent.change(textarea, { target: { value: fourRefs } });
    fireEvent.click(checkBtn);
    expect(verifySpy).not.toHaveBeenCalled();
    expect(within(section).getByRole('alert').textContent).toMatch(/3/);

    // C. > 1500 chars -> inline guidance, zero API calls
    fireEvent.change(textarea, { target: { value: 'A'.repeat(1505) } });
    fireEvent.click(checkBtn);
    expect(verifySpy).not.toHaveBeenCalled();
    expect(within(section).getByRole('alert').textContent).toMatch(/1,500/);

    // D. API 429 rate limit -> warm non-intimidating message + link to /register
    verifySpy.mockRejectedValueOnce(
      new Error('API 429: Guest preview limit reached (6 checks per minute).'),
    );
    fireEvent.change(textarea, {
      target: {
        value:
          'Vaswani, A., Shazeer, N., & Parmar, N. (2017). Attention is all you need. NeurIPS.',
      },
    });
    fireEvent.click(checkBtn);

    const rateBanner = await within(section).findByTestId('guest-checker-rate-limit-banner');
    expect(rateBanner.textContent).not.toMatch(/Traceback|Internal Server Error/i);
    const rateLimitRegisterLink = within(rateBanner).getByRole('link');
    expect(rateLimitRegisterLink.getAttribute('href')).toBe('/register');

    // E. Network unreachable / offline preview fallback -> still renders useful local preview result
    verifySpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fireEvent.click(within(section).getByRole('button', { name: /AI-Invented Citation/i }));

    await waitFor(() => {
      const fallbackBadge = getPlainVerdictLabel('suspected_hallucination', 'en');
      expect(section.textContent).toContain(fallbackBadge.label);
    });
  });

  it('4. wires aria-expanded + aria-controls on guest-checker-trace-toggle to reveal rule IDs & confidence scores, and routes bottom CTA to /register', async () => {
    const mockResponse: SandboxInstantVerifyResponse = {
      elapsed_seconds: 0.31,
      total: 1,
      summary: {
        verified: 0,
        metadata_error: 0,
        suspected_hallucination: 1,
        layer1_linking_issues: 0,
      },
      results: [
        {
          index: 1,
          citation_raw:
            'Nguyen, T. H., & Morrison, D. R. (2024). Macroeconomic resilience of digital supply chains. Quarterly Journal of Economics, 139(4), 2145-2180. https://doi.org/10.1093/qje/qjae994',
          label: 'suspected_hallucination',
          confidence: 0.96,
          mapping_status: 'matched',
          mapping_note: 'Direct check',
          reasoning: 'Non-existent DOI and zero matching scholarly titles.',
          triggered_rules: ['R12_GHOST_DOI', 'R-NONEXISTENT-DOI'],
          mismatched_fields: ['doi', 'title'],
          matched_source: null,
          matched_sources: [],
        },
      ],
    };
    vi.spyOn(api, 'verifyPublicGuestCitations').mockResolvedValue(mockResponse);

    const { container } = renderGuestChecker('en', false);
    const section = container.querySelector('#try-instant') as HTMLElement;

    fireEvent.click(within(section).getByRole('button', { name: /AI-Invented Citation/i }));
    await waitFor(() => {
      expect(api.verifyPublicGuestCitations).toHaveBeenCalled();
    });

    const traceToggle = within(section).getByTestId('guest-checker-trace-toggle');
    expect(traceToggle.className).toContain('min-h-[44px]');
    expect(traceToggle.getAttribute('aria-expanded')).toBe('false');
    const controlsId = traceToggle.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();
    expect(section.querySelector(`#${controlsId}`)).not.toBeNull();
    expect(section.textContent).not.toContain('R12_GHOST_DOI');

    fireEvent.click(traceToggle);
    expect(traceToggle.getAttribute('aria-expanded')).toBe('true');
    const tracePanel = section.querySelector(`#${controlsId}`) as HTMLElement;
    expect(tracePanel.textContent).toContain('R12_GHOST_DOI');
    expect(tracePanel.textContent).toContain('96%');

    const bottomCta = within(section).getByTestId('guest-checker-full-upload-cta');
    expect(bottomCta.getAttribute('href')).toBe('/register');
  });

  it('5. mounts GuestInstantChecker (#try-instant) directly below #hero on LandingPage and wires Hero #try-instant secondary jump CTA in EN & VI', async () => {
    for (const lang of ['en', 'vi'] as const) {
      await i18n.changeLanguage(lang);
      const { container, unmount } = render(
        <CitraMotionProvider>
          <ThemeProvider defaultTheme="light">
            <MemoryRouter initialEntries={['/']}>
              <LandingPage />
            </MemoryRouter>
          </ThemeProvider>
        </CitraMotionProvider>,
      );

      const hero = container.querySelector('#hero') as HTMLElement;
      const tryInstant = container.querySelector('#try-instant') as HTMLElement;
      expect(hero).not.toBeNull();
      expect(tryInstant).not.toBeNull();
      expect(hero.nextElementSibling).toBe(tryInstant);
      expect(tryInstant.className).toContain('scroll-mt-[88px]');

      const heroJumpLink = hero.querySelector('a[href="#try-instant"]');
      expect(heroJumpLink).not.toBeNull();
      expect(heroJumpLink?.textContent).toContain(
        lang === 'vi' ? 'Thử dán 3 trích dẫn ngay' : 'Try 3 Citations Now',
      );
      expect(heroJumpLink?.textContent).not.toContain('↓');
      expect(heroJumpLink?.querySelector('svg')).not.toBeNull();

      unmount();
    }
    await i18n.changeLanguage('en');
  });

  it('6. accurately counts entry boundaries for inline APA, mixed APA + bare URLs, wrapped multi-line PDF refs with bare years, and 4-line wrapped (n.d.) refs', () => {
    // (a) 4 inline APA references pasted on 1 single line -> 4 (> 3 rejected!)
    const caseA =
      'Acemoglu, D., Johnson, S., & Robinson, J. A. (2001). Colonial origins. AER, 91(5), 1369-1401. ' +
      'Kahneman, D., & Tversky, A. (1979). Prospect theory. Econometrica, 47(2), 263-291. ' +
      'Vaswani, A., Shazeer, N., & Parmar, N. (2017). Attention is all you need. NeurIPS, 30. ' +
      'Devlin, J., Chang, M. W., Lee, K., & Toutanova, K. (2019). BERT. NAACL-HLT.';
    expect(estimateGuestReferenceCount(caseA)).toBe(4);

    // (b) 1 APA reference + 3 bare https://arxiv.org/abs/... URL lines -> 4 (> 3 rejected!)
    const caseB = [
      'Acemoglu, D., Johnson, S., & Robinson, J. A. (2001). Colonial origins. American Economic Review, 91(5), 1369-1401.',
      'https://arxiv.org/abs/1706.03762',
      'https://arxiv.org/abs/1810.04805',
      'https://arxiv.org/abs/2005.14165',
    ].join('\n');
    expect(estimateGuestReferenceCount(caseB)).toBe(4);

    // (c) 2 legitimate multi-line PDF-wrapped references with bare years in titles -> 2 (<= 3 allowed!)
    const caseC = [
      'Acemoglu, D., Johnson, S., & Robinson, J. A. (2001).',
      'The colonial origins of comparative development: Evidence from 2019 and 2020 surveys.',
      'American Economic Review, 91(5), 1369-1401.',
      'https://doi.org/10.1257/aer.91.5.1369',
      'Kahneman, D., & Tversky, A. (1979).',
      'Prospect theory: Study of 2019–2020 markets under risk.',
      'Econometrica, 47(2), 263-291.',
      'https://doi.org/10.2307/1914185',
    ].join('\n');
    expect(estimateGuestReferenceCount(caseC)).toBe(2);

    // (d) 1 legitimate 4-line wrapped (n.d.) reference across 4 lines without blank lines -> 1 (<= 3 allowed!)
    const caseD = [
      'World Health Organization.',
      '(n.d.). Global guidelines on digital health interventions.',
      'World Health Organization Press.',
      'https://www.who.int/publications/i/item/9789241550505',
    ].join('\n');
    expect(estimateGuestReferenceCount(caseD)).toBe(1);
  });

  it('7. renders cited_doi with red/amber highlight, explains R01_EXACT_DOI / R05_YEAR_DRIFT / R12_GHOST_DOI without generic fallback, hides stale results under new unverified 429/error inputs, and displays dynamic Retry-After seconds', async () => {
    const verifySpy = vi.spyOn(api, 'verifyPublicGuestCitations');

    // Initial render in VI & EN: trace panel has zero generic fallback rule descriptions
    const { container, unmount } = renderGuestChecker('vi', false);
    const section = container.querySelector('#try-instant') as HTMLElement;
    const resultsWrapper = section.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(resultsWrapper).not.toBeNull();

    fireEvent.click(within(section).getByTestId('guest-checker-trace-toggle'));
    const tracePanel = within(section).getByTestId('guest-checker-trace-panel');
    expect(tracePanel.textContent).not.toContain('Đã áp dụng quy tắc kiểm tra bổ sung');
    expect(tracePanel.textContent).not.toContain('An additional verification check was applied');

    // AI-Invented Citation offline fallback spotlights fake DOI 10.1093/qje/qjae994 in red in left column
    verifySpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fireEvent.click(within(section).getByRole('button', { name: /Nguồn AI tự bịa/i }));

    await waitFor(() => {
      const doiChip = within(section).getByTestId('guest-checker-cited-doi-0');
      expect(doiChip.textContent).toContain('10.1093/qje/qjae994');
      expect(doiChip.className).toContain('text-red-700');
    });
    expect(tracePanel.textContent).toContain('R12_GHOST_DOI');
    expect(tracePanel.textContent).not.toContain('Đã áp dụng quy tắc kiểm tra bổ sung');

    // Paste a brand-new citation and hit 429 with retryAfterSeconds=42 -> hides stale preset card & shows ~42s
    const rateErr = Object.assign(
      new Error('API 429: Guest preview limit reached.'),
      { status: 429, retryAfterSeconds: 42 },
    );
    verifySpy.mockRejectedValueOnce(rateErr);
    const textarea = within(section).getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: {
        value:
          'Vaswani, A., Shazeer, N., & Parmar, N. (2017). Attention is all you need. NeurIPS, 30.',
      },
    });
    fireEvent.click(within(section).getByTestId('guest-checker-submit'));

    const rateBanner = await within(section).findByTestId('guest-checker-rate-limit-banner');
    expect(rateBanner.textContent).toContain('42');
    // Stale preset result card must NOT be rendered beneath the new unverified input's 429 banner
    expect(section.querySelector('[data-testid="guest-checker-result-0"]')).toBeNull();

    unmount();
  });
});
