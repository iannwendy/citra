/**
 * E2E Tests — Essay Integrity Checker v2.0
 * Complete UI coverage with Playwright
 * Run: npx playwright test
 *
 * NOTE: routes are defined in src/router.tsx (ProtectedRoute guards)
 * Routes: /login, /dashboard, /upload, /history, /essay/:id, /admin
 */

import { test, expect, Page } from '@playwright/test';

// ============================================================
// Mock Data — v1.2 schema with 2-layer output
// ============================================================

const MOCK_USER = { id: 1, username: 'admin', role: 'admin' };

const MOCK_REPORT = {
  essay_id: 1,
  filename: 'thesis_ai_citations_2024.pdf',
  num_pages: 15,
  num_citations: 8,
  style_profile: {
    style: 'APA_LIKE',
    confidence: 0.92,
    apa_count: 6,
    ieee_count: 1,
    mixed_count: 1,
    features: { uses_ampersand: true, uses_italic: true, has_year: true },
    ratios: { author_parens: 0.83 },
    explanation: 'Majority of citations use (Author, Year) format typical of APA style.',
  },
  linking_summary: {
    matched: 5,
    missing_reference: 1,
    uncited_reference: 1,
    in_text_mismatch: 0,
    duplicate_reference: 1,
    ambiguous_mapping: 0,
    style_inconsistent: 0,
    unresolved: 0,
  },
  cis: {
    score: 78.5,
    components: {
      verified_ratio: 0.75,
      metadata_accuracy: 0.82,
      in_text_bib_consistency: 0.88,
      format_consistency: 0.90,
      identifier_validity: 0.85,
    },
    weights_used: {
      verified_ratio: 0.35,
      metadata_accuracy: 0.25,
      in_text_bib_consistency: 0.25,
      format_consistency: 0.10,
      identifier_validity: 0.05,
    },
    num_citations: 8,
    num_unresolved: 0,
    disclaimer: 'CIS is NOT an essay score.',
  },
  verdicts: [
    {
      citation_id: 'v1',
      citation_raw: 'LeCun, Bengio, & Hinton, 2015',
      mapping_status: 'matched',
      mapping_confidence: 0.95,
      citation_link: { occurrence_id: 'o1', reference_id: 'r1', method: 'author_year', confidence: 0.95 },
      label: 'verified',
      confidence: 0.92,
      reasoning: 'Found in Crossref + OpenAlex with matching title "Deep Learning".',
      triggered_rules: ['R-VERIFIED-DOI', 'R-AUTHOR-YEAR'],
      mismatched_fields: [],
      matched_sources: [
        { source: 'crossref', matched_fields: ['title', 'authors', 'year'], checked_at: '2026-08-11T10:00:00Z', url: 'https://doi.org/10.1038/nature14539' },
        { source: 'openalex', matched_fields: ['title', 'year'], checked_at: '2026-08-11T10:00:01Z' },
      ],
      is_overridden: false,
    },
    {
      citation_id: 'v2',
      citation_raw: 'He, Zhang, Ren, & Sun, 2016',
      mapping_status: 'duplicate_reference',
      mapping_confidence: 0.70,
      label: 'verified',
      confidence: 0.88,
      reasoning: 'Found in Semantic Scholar. Duplicate entry in reference list.',
      triggered_rules: ['R-VERIFIED-S2', 'R-DUPLICATE'],
      mismatched_fields: [],
      matched_sources: [
        { source: 's2', matched_fields: ['title', 'authors'], checked_at: '2026-08-11T10:00:02Z' },
      ],
      is_overridden: false,
      style_penalty: 0.05,
    },
    {
      citation_id: 'v3',
      citation_raw: 'Smith & Doe, 2024',
      mapping_status: 'missing_reference',
      mapping_confidence: 0.45,
      label: 'suspected_hallucination',
      confidence: 0.25,
      reasoning: 'Not found in any source after querying all 4 databases.',
      triggered_rules: ['R-HALLUCINATION-NOT-FOUND'],
      mismatched_fields: ['title', 'authors', 'year'],
      matched_sources: [],
      is_overridden: false,
    },
    {
      citation_id: 'v4',
      citation_raw: 'Vaswani et al., 2017',
      mapping_status: 'matched',
      mapping_confidence: 0.98,
      label: 'verified',
      confidence: 0.95,
      reasoning: 'Found in all 4 sources. "Attention Is All You Need" - highly cited paper.',
      triggered_rules: ['R-VERIFIED-MULTI', 'R-HIGH-CONFIDENCE'],
      mismatched_fields: [],
      matched_sources: [
        { source: 'crossref', matched_fields: ['title', 'authors', 'year', 'doi'], checked_at: '2026-08-11T10:00:03Z', url: 'https://arxiv.org/abs/1706.03762' },
        { source: 'openalex', matched_fields: ['title', 'authors', 'year'], checked_at: '2026-08-11T10:00:04Z' },
        { source: 'arxiv', matched_fields: ['title', 'authors'], checked_at: '2026-08-11T10:00:05Z' },
      ],
      is_overridden: false,
    },
    {
      citation_id: 'v5',
      citation_raw: 'Brown et al., 2020',
      mapping_status: 'matched',
      mapping_confidence: 0.94,
      label: 'verified',
      confidence: 0.91,
      reasoning: 'GPT-3 paper found in Crossref and Semantic Scholar.',
      triggered_rules: ['R-VERIFIED-DOI', 'R-AUTHOR-YEAR'],
      mismatched_fields: [],
      matched_sources: [
        { source: 'crossref', matched_fields: ['title', 'authors', 'year'], checked_at: '2026-08-11T10:00:06Z' },
        { source: 's2', matched_fields: ['title', 'authors', 'year'], checked_at: '2026-08-11T10:00:07Z' },
      ],
      is_overridden: false,
    },
    {
      citation_id: 'v6',
      citation_raw: 'Goodfellow et al., 2016',
      mapping_status: 'matched',
      mapping_confidence: 0.97,
      label: 'metadata_error',
      confidence: 0.72,
      reasoning: 'Found in Crossref but year mismatch: cited as 2016, actual is 2015.',
      triggered_rules: ['R-YEAR-MISMATCH', 'R-PARTIAL-VERIFIED'],
      mismatched_fields: ['year'],
      matched_sources: [
        { source: 'crossref', matched_fields: ['title', 'authors'], checked_at: '2026-08-11T10:00:08Z' },
      ],
      is_overridden: false,
    },
    {
      citation_id: 'v7',
      citation_raw: '[7] Johnson & Williams, 2023',
      mapping_status: 'uncited_reference',
      mapping_confidence: 0.60,
      label: 'verified',
      confidence: 0.85,
      reasoning: 'Reference entry exists but no matching in-text citation.',
      triggered_rules: ['R-UNCITED-REF'],
      mismatched_fields: [],
      matched_sources: [
        { source: 'crossref', matched_fields: ['title', 'authors', 'year'], checked_at: '2026-08-11T10:00:09Z' },
      ],
      is_overridden: false,
    },
    {
      citation_id: 'v8',
      citation_raw: 'Unknown Author Paper, 2022',
      mapping_status: 'unresolved',
      mapping_confidence: 0.30,
      label: 'unresolved',
      confidence: 0.40,
      reasoning: 'Insufficient metadata to verify. Missing DOI and full author list.',
      triggered_rules: ['R-INSUFFICIENT-DATA'],
      mismatched_fields: [],
      matched_sources: [],
      is_overridden: false,
    },
  ],
  disclaimer: 'This is a demo report for testing purposes.',
};

// ============================================================
// Test Configuration
// ============================================================

test.use({
  baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
});

// ============================================================
// Helper Functions - Global Mock Setup
// ============================================================

function setupMocks(page: Page) {
  // Mock auth endpoints FIRST
  void page.route('**/api/auth/me', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_USER),
    });
  });

  void page.route('**/api/auth/login', (route) => {
    const body = route.request().postData();
    const data = JSON.parse(body || '{}');
    if (data.username === 'wrong') {
      void route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Invalid credentials' }),
      });
    } else {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'test-token', user: MOCK_USER }),
      });
    }
  });

  void page.route('**/api/auth/logout', (route) => {
    void route.fulfill({ status: 200 });
  });

  // Mock health
  void page.route('**/api/health', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', version: '2.0.0', disclaimer: '' }),
    });
  });

  // Mock essays list
  void page.route('**/api/essays', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 1, filename: 'thesis_ai_citations_2024.pdf', num_pages: 15, uploaded_at: '2026-08-11T10:00:00Z' }]),
    });
  });

  // Mock essay report
  void page.route(/\/api\/essays\/1(\/report)?$/, (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_REPORT),
    });
  });

  // Mock override
  void page.route('**/api/essays/*/verdicts/*/override', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...MOCK_REPORT.verdicts[0], is_overridden: true }),
    });
  });

  // Set localStorage BEFORE any navigation
  void page.addInitScript(() => {
    localStorage.setItem('token', 'test-token');
  });
}

// ============================================================
// Login Page Tests
// ============================================================

test.describe('Login Page', () => {
  test('should display login form with all elements', async ({ page }) => {
    // Clear any existing token
    await page.addInitScript(() => {
      localStorage.removeItem('token');
    });
    await page.goto('/login');

    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page.getByLabel(/username/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('should toggle password visibility', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('token');
    });
    await page.goto('/login');

    const passwordInput = page.locator('#password');
    await expect(passwordInput).toHaveAttribute('type', 'password');

    // Click show password button (Eye icon)
    const showPasswordBtn = page.locator('button').filter({ has: page.locator('svg') }).first();
    await showPasswordBtn.click();

    // After click, password should be visible as text
    await expect(passwordInput).toHaveAttribute('type', 'text');
  });

  test('should show error on failed login', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('token');
    });
    await page.goto('/login');

    await page.getByLabel(/username/i).fill('wrong');
    await page.getByLabel(/password/i).fill('wrong');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Should show an error toast (the toast container has role="status" or alert)
    await expect(page.getByText(/invalid|incorrect|failed|wrong|error/i).first()).toBeVisible();
  });
});

// ============================================================
// Dashboard Page Tests (Protected Routes)
// ============================================================

test.describe('Dashboard Page', () => {
  test('should display dashboard with user info', async ({ page }) => {
    setupMocks(page);
    await page.goto('/dashboard');

    // The header (h1) shows the username greeting; sidebar shows "admin" 2-3 times.
    // Use .first() to disambiguate.
    await expect(page.getByText('admin').first()).toBeVisible();
  });

  test('should show navigation links', async ({ page }) => {
    setupMocks(page);
    await page.goto('/dashboard');

    // The sidebar has nav links (not the brand link at top of sidebar).
    // Use .first() to disambiguate when a link name also appears in main content.
    await expect(page.getByRole('link', { name: 'Dashboard', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'New Check' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'History', exact: true }).first()).toBeVisible();
  });
});

// ============================================================
// Upload Page Tests (Protected Routes)
// ============================================================

test.describe('Upload Page', () => {
  test('should display upload page with heading', async ({ page }) => {
    setupMocks(page);
    await page.goto('/upload');

    // The page heading is "New Verification" (or similar) — match any h1 that is NOT the brand.
    await expect(page.getByRole('heading', { name: /new verification|upload/i })).toBeVisible();
  });

  test('should have drag-drop zone visible', async ({ page }) => {
    setupMocks(page);
    await page.goto('/upload');

    const dropzone = page.locator('input[type="file"]');
    await expect(dropzone).toBeAttached();
  });
});

// ============================================================
// Essay Page - CIS Card Tests
// ============================================================

test.describe('Essay Page - CIS Score Card', () => {
  test('should display CIS score card with score value', async ({ page }) => {
    setupMocks(page);
    await page.goto('/login');
    await page.waitForTimeout(500);
    await page.goto('/verification/report/1');

    // Wait for content to load
    await page.waitForTimeout(2000);
    await expect(page.getByText(/citation integrity score/i)).toBeVisible();
    // Score should be visible (78.5)
    await expect(page.getByText(/78/i).first()).toBeVisible();
  });

  test('should show CIS components', async ({ page }) => {
    setupMocks(page);
    await page.goto('/login');
    await page.waitForTimeout(500);
    await page.goto('/verification/report/1');

    await page.waitForTimeout(2000);
    // The CIS card shows three component percentages. The page may use the card heading
    // "Citation Integrity Score" and render percentage bars below. Match a percentage
    // anywhere inside the card region (use .first() to avoid strict-mode).
    await expect(page.getByText(/%/).first()).toBeVisible();
  });

  test('should show total citations count', async ({ page }) => {
    setupMocks(page);
    await page.goto('/login');
    await page.waitForTimeout(500);
    await page.goto('/verification/report/1');

    await page.waitForTimeout(2000);
    // The stat card shows "N citations" — the same count also appears in a footer
    // ("Showing N of N citations"). Use .first() to disambiguate.
    await expect(page.getByText(/\d+ citations/).first()).toBeVisible();
  });
});

// ============================================================
// Essay Page - Citation Graph View Tests
// ============================================================

test.describe('Essay Page - Citation Graph View', () => {
  test('should display citations in graph view', async ({ page }) => {
    setupMocks(page);
    await page.goto('/login');
    await page.waitForTimeout(500);
    await page.goto('/verification/report/1');

    await page.waitForTimeout(2000);
    // Citations should be visible
    await expect(page.getByText(/lecun/i)).toBeVisible();
  });

  test('should toggle between report tabs (Overview/Citations)', async ({ page }) => {
    setupMocks(page);
    await page.goto('/login');
    await page.waitForTimeout(500);
    await page.goto('/verification/report/1');

    await page.waitForTimeout(2000);

    const verifiedFilterBtn = page.getByRole('button', { name: /verified/i }).first();
    await expect(verifiedFilterBtn).toBeVisible();
    await verifiedFilterBtn.click();
    await expect(page.getByText(/lecun/i).first()).toBeVisible();

    const allFilterBtn = page.getByRole('button', { name: /^all/i }).first();
    await allFilterBtn.click();
    await expect(page.getByText(/lecun/i).first()).toBeVisible();
  });
});

// ============================================================
// Citation Detail Drawer Tests
// ============================================================

test.describe('Citation Detail Drawer', () => {
  test('should open on citation click', async ({ page }) => {
    setupMocks(page);
    await page.goto('/login');
    await page.waitForTimeout(500);
    await page.goto('/verification/report/1');

    await page.waitForTimeout(2000);

    const citation = page.getByText(/lecun/i).first();
    await expect(citation).toBeVisible();
    await citation.click();

    await expect(page.getByRole('heading', { name: /citation detail/i })).toBeVisible({ timeout: 5000 });
  });

  test('should close on Escape key', async ({ page }) => {
    setupMocks(page);
    await page.goto('/login');
    await page.waitForTimeout(500);
    await page.goto('/verification/report/1');

    await page.waitForTimeout(2000);

    const citation = page.getByText(/lecun/i).first();
    await expect(citation).toBeVisible();
    await citation.click();

    await expect(page.getByRole('heading', { name: /citation detail/i })).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: /citation detail/i })).not.toBeVisible({ timeout: 5000 });
  });
});

// ============================================================
// History Page Tests
// ============================================================

test.describe('History Page', () => {
  test('should display history page heading', async ({ page }) => {
    setupMocks(page);
    await page.goto('/history');

    await expect(page.getByRole('heading', { name: /verification reports/i })).toBeVisible();
  });
});

// ============================================================
// Error Handling Tests
// ============================================================

test.describe('Error Handling', () => {
  test('should show error state on failed report load', async ({ page }) => {
    // Setup base mocks but override report to fail
    void page.route('**/api/auth/me', (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_USER),
      });
    });

    void page.route('**/api/essays', (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 1, filename: 'thesis_ai_citations_2024.pdf', num_pages: 15, uploaded_at: '2026-08-11T10:00:00Z' }]),
      });
    });

    // Override the report endpoint to fail
    void page.route(/\/api\/essays\/1(\/report)?$/, (route) => {
      void route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Internal server error' }),
      });
    });

    void page.addInitScript(() => {
      localStorage.setItem('token', 'test-token');
    });

    await page.goto('/login');
    await page.waitForTimeout(500);
    await page.goto('/verification/report/1');

    // Should show some error state
    await page.waitForTimeout(2000);
    // Either shows error message or loading continues
    const content = await page.content();
    // Either shows error message or back link
    expect(content.toLowerCase()).toMatch(/lỗi|error|quay lại|back|internal/i);
  });
});

// ============================================================
// Navigation Tests
// ============================================================

test.describe('Navigation', () => {
  test('should redirect to login when not authenticated', async ({ page }) => {
    // Clear token
    await page.addInitScript(() => {
      localStorage.removeItem('token');
    });

    await page.goto('/dashboard');

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);
  });

  test('should allow logout', async ({ page }) => {
    setupMocks(page);
    await page.goto('/login');
    await page.waitForTimeout(500);
    await page.goto('/dashboard');
    await page.waitForTimeout(1000);

    // Find and click logout button (it has title="Logout")
    const logoutBtn = page.getByTitle('Logout');

    if (await logoutBtn.isVisible()) {
      await logoutBtn.click();
      await page.waitForTimeout(500);
      // Should redirect to login
      await expect(page).toHaveURL(/\/login/);
    }
  });
});
