import { Page } from '@playwright/test';

// Mock data for authenticated user (matches User type from api/client.ts)
const MOCK_USER = {
  id: 1,
  username: 'admin',
  role: 'admin',
  email: 'admin@example.com',
  full_name: 'Administrator',
  is_active: true,
  avatar_url: null,
  last_login_at: '2024-01-01T00:00:00Z',
  created_at: '2024-01-01T00:00:00Z',
};

// Mock essays data (matching DashboardPage Essay interface)
const MOCK_ESSAYS = [
  {
    id: 1,
    filename: 'BERT_Pre-training.pdf',
    num_pages: 16,
    uploaded_at: '2024-01-15T10:30:00Z',
    user_id: 1,
  },
  {
    id: 2,
    filename: 'Attention_Mechanism.pdf',
    num_pages: 12,
    uploaded_at: '2024-01-14T09:15:00Z',
    user_id: 1,
  },
  {
    id: 3,
    filename: 'Neural_Machine_Translation.pdf',
    num_pages: 20,
    uploaded_at: '2024-01-13T14:45:00Z',
    user_id: 1,
  },
  {
    id: 4,
    filename: 'Local_Cache_Hit.pdf',
    num_pages: 9,
    uploaded_at: '2024-01-12T08:20:00Z',
    user_id: 1,
  },
];

// Mock report data for essays (matching AnalysisReport interface from api/client.ts)
const MOCK_REPORTS: Record<number, object> = {
  1: {
    essay_id: 1,
    filename: 'BERT_Pre-training.pdf',
    num_pages: 16,
    num_citations: 45,
    style_profile: {
      style: 'APA_LIKE',
      confidence: 0.95,
      apa_count: 40,
      ieee_count: 3,
      mixed_count: 2,
      features: {},
      ratios: {},
      explanation: 'Most citations follow APA format',
    },
    linking_summary: {
      matched: 42,
      missing_reference: 1,
      uncited_reference: 0,
      in_text_mismatch: 1,
      duplicate_reference: 0,
      ambiguous_mapping: 1,
      style_inconsistent: 0,
      unresolved: 0,
    },
    verdicts: [
      {
        citation_id: 'c1',
        citation_raw: 'Vaswani et al. (2017)',
        mapping_status: 'matched',
        mapping_confidence: 0.95,
        citation_link: {
          occurrence_id: 'o1',
          reference_id: 'r1',
          method: 'author_year',
          confidence: 0.95,
        },
        label: 'verified',
        confidence: 0.98,
        reasoning: 'Source found in Crossref',
        triggered_rules: [],
        mismatched_fields: [],
        matched_sources: [{ source: 'crossref', matched_fields: ['title', 'authors'], checked_at: '2024-01-15T10:30:00Z' }],
        is_overridden: false,
      },
    ],
    cis: {
      score: 97.43,
      components: {
        verified_ratio: 0.93,
        metadata_accuracy: 0.98,
        in_text_bib_consistency: 0.95,
        format_consistency: 0.92,
        identifier_validity: 0.94,
      },
      weights_used: {},
      num_citations: 45,
      num_unresolved: 3,
      disclaimer: 'This is a decision support tool.',
    },
    disclaimer: 'This is a decision support tool.',
  },
  2: {
    essay_id: 2,
    filename: 'Attention_Mechanism.pdf',
    num_pages: 12,
    num_citations: 32,
    style_profile: {
      style: 'IEEE_LIKE',
      confidence: 0.92,
      apa_count: 2,
      ieee_count: 28,
      mixed_count: 2,
      features: {},
      ratios: {},
      explanation: 'Most citations follow IEEE format',
    },
    linking_summary: {
      matched: 30,
      missing_reference: 1,
      uncited_reference: 0,
      in_text_mismatch: 0,
      duplicate_reference: 0,
      ambiguous_mapping: 1,
      style_inconsistent: 0,
      unresolved: 0,
    },
    verdicts: [
      {
        citation_id: 'c3',
        citation_raw: 'Vaswani et al. (2017)',
        mapping_status: 'matched',
        mapping_confidence: 0.97,
        citation_link: {
          occurrence_id: 'o3',
          reference_id: 'r1',
          method: 'author_year',
          confidence: 0.97,
        },
        label: 'verified',
        confidence: 0.99,
        reasoning: 'Source found in Crossref',
        triggered_rules: [],
        mismatched_fields: [],
        matched_sources: [{ source: 'crossref', matched_fields: ['title', 'authors'], checked_at: '2024-01-14T09:15:00Z' }],
        is_overridden: false,
      },
    ],
    cis: {
      score: 92.99,
      components: {
        verified_ratio: 0.99,
        metadata_accuracy: 0.95,
        in_text_bib_consistency: 0.88,
        format_consistency: 0.90,
        identifier_validity: 0.92,
      },
      weights_used: {},
      num_citations: 32,
      num_unresolved: 1,
      disclaimer: 'This is a decision support tool.',
    },
    disclaimer: 'This is a decision support tool.',
  },
  3: {
    essay_id: 3,
    filename: 'Neural_Machine_Translation.pdf',
    num_pages: 20,
    num_citations: 58,
    style_profile: {
      style: 'MIXED',
      confidence: 0.78,
      apa_count: 20,
      ieee_count: 20,
      mixed_count: 18,
      features: {},
      ratios: {},
      explanation: 'Mixed citation styles detected',
    },
    linking_summary: {
      matched: 48,
      missing_reference: 3,
      uncited_reference: 2,
      in_text_mismatch: 2,
      duplicate_reference: 1,
      ambiguous_mapping: 1,
      style_inconsistent: 1,
      unresolved: 0,
    },
    verdicts: [],
    cis: {
      score: 85.20,
      components: {
        verified_ratio: 0.85,
        metadata_accuracy: 0.88,
        in_text_bib_consistency: 0.82,
        format_consistency: 0.80,
        identifier_validity: 0.85,
      },
      weights_used: {},
      num_citations: 58,
      num_unresolved: 8,
      disclaimer: 'This is a decision support tool.',
    },
    disclaimer: 'This is a decision support tool.',
  },
  // Local DB cache hit: retrieval returns immediately, so NO external API
  // (Crossref/OpenAlex/S2/arXiv/CORE) is queried for this citation.
  4: {
    essay_id: 4,
    filename: 'Local_Cache_Hit.pdf',
    num_pages: 9,
    num_citations: 12,
    style_profile: {
      style: 'IEEE_LIKE',
      confidence: 0.92,
      apa_count: 2,
      ieee_count: 9,
      mixed_count: 1,
      features: {},
      ratios: {},
      explanation: 'Most citations follow IEEE format',
    },
    linking_summary: {
      matched: 12,
      missing_reference: 0,
      uncited_reference: 0,
      in_text_mismatch: 0,
      duplicate_reference: 0,
      ambiguous_mapping: 0,
      style_inconsistent: 0,
      unresolved: 0,
    },
    verdicts: [
      {
        citation_id: 'v4-local-1',
        citation_raw: 'Vaswani et al. (2017) Attention Is All You Need',
        mapping_status: 'matched',
        mapping_confidence: 0.97,
        citation_link: {
          occurrence_id: 'o4-1',
          reference_id: 'r4-1',
          method: 'author_year',
          confidence: 0.97,
        },
        label: 'verified',
        confidence: 0.95,
        reasoning: 'Source found in local database',
        triggered_rules: [],
        mismatched_fields: [],
        matched_sources: [
          { source: 'local_db', matched_fields: ['title', 'authors'], checked_at: '2024-01-15T10:30:00Z' },
        ],
        is_overridden: false,
      },
    ],
    cis: {
      score: 96.5,
      components: {
        verified_ratio: 1.0,
        metadata_accuracy: 1.0,
        in_text_bib_consistency: 0.95,
        format_consistency: 0.9,
        identifier_validity: 1.0,
      },
      weights_used: {},
      num_citations: 12,
      num_unresolved: 0,
      disclaimer: 'This is a decision support tool.',
    },
    disclaimer: 'This is a decision support tool.',
  },
};

/**
 * Set up authenticated page with proper mocking.
 * Call this BEFORE any page.goto() calls in the test.
 * Automatically registers auth mocks for all common endpoints.
 */
export function setupAuthenticatedPage(page: Page): void {
  // Use context-level init script so it survives page reloads
  page.context().addInitScript(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
  }, { token: 'mock-token-123', user: MOCK_USER });

  // Lowest-priority fallback ONLY for root /api/... endpoints (never Vite's /src/api/client.ts!)
  // so mock-token-123 never hits a live backend and triggers 401 -> /login
  page.route(/^https?:\/\/[^/]+\/api\//, (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() === 'GET') {
      const isArrayEndpoint =
        /\/api\/(essays|classes|users|users\/me\/api-keys|billing\/admin\/promos|audit\/logs?|teacher\/(classes|enrolled-classes))(\?|$)/.test(
          url,
        );
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: isArrayEndpoint ? '[]' : '{}',
      });
      return;
    }
    route.continue();
  });

  // Intercept /api/billing/subscription for SettingsPage
  page.route(/^https?:\/\/[^/]+\/api\/billing\/subscription(\?.*)?$/, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        subscription: null,
        transactions: [],
      }),
    });
  });

  // Intercept /api/essays/stats for Dashboard StatCards
  page.route(/^https?:\/\/[^/]+\/api\/essays\/stats(\?.*)?$/, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        total_essays: 4,
        total_citations: 147,
        average_cis: 92.8,
        verified_rate: 91.5,
      }),
    });
  });

  // Intercept auth/me — prevents race conditions
  page.route('**/api/auth/me', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_USER),
    });
  });

  // Intercept users/me for all tests
  page.route('**/api/users/me', (route) => {
    const req = route.request();
    if (req.method() === 'PATCH') {
      const body = JSON.parse(req.postData() || '{}');
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...MOCK_USER, ...body }),
      });
    } else {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_USER),
      });
    }
  });

  // Intercept essays list endpoint (with or without query string)
  page.route(/\/api\/essays(\?.*)?$/, (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_ESSAYS),
      });
    } else {
      route.continue();
    }
  });

  // Mock essay report endpoints (/api/essays/:id and /api/essays/:id/report)
  page.route(/\/api\/essays\/\d+(\/report)?$/, (route) => {
    const url = route.request().url();
    const match = url.match(/\/api\/essays\/(\d+)(?:\/report)?$/);
    if (match) {
      const essayId = parseInt(match[1], 10);
      const report = MOCK_REPORTS[essayId];
      if (report) {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(report),
        });
        return;
      }
    }
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Report not found' }),
    });
  });

  // Mock POST /api/users/me/password (profile password change)
  page.route('**/api/users/me/password', (route) => {
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Current password is incorrect' }),
    });
  });
}

/**
 * Wait for auth state to be ready.
 * Call this AFTER page.goto() in the test.
 * Mocks for auth/me and users/me are already registered by setupAuthenticatedPage().
 */
export async function waitForAuth(page: Page): Promise<void> {
  // Wait for React to render and auth to be processed
  await page.waitForLoadState('domcontentloaded');
  // Give React time to initialize and make auth requests
  await page.waitForTimeout(2000);
}

/**
 * Clear auth state before test
 * Prevents auth state leakage between tests
 */
export function clearAuthState(page: Page): void {
  page.context().addInitScript(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  });
}

/**
 * Get mock essays data for custom assertions
 */
export function getMockEssays() {
  return MOCK_ESSAYS;
}

/**
 * Get mock reports data for custom assertions
 */
export function getMockReports() {
  return MOCK_REPORTS;
}

/**
 * Login helper - sets up authenticated page
 */
export async function login(page: Page): Promise<void> {
  setupAuthenticatedPage(page);
  await page.goto('/dashboard');
  await waitForAuth(page);
}
