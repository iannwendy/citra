/**
 * Phase 4 — Teacher flow E2E test (Task 23).
 *
 * Verifies the full teacher journey as a single client-side journey:
 *   1. Land on /teacher/classes with role=teacher mock user
 *   2. See "Tạo lớp" button (capability-gated)
 *   3. Open dialog, see name + description fields
 *   4. Close dialog (cancels)
 *   5. Navigate to /teacher/reviews
 *   6. See class filter chips if any
 *   7. Navigate to admin pages — verify 200/redirect (not 500)
 *
 * Uses route mocks (no real backend) — checks UI presence, not server logic.
 */
import { test, expect, type Page } from '@playwright/test';
import { waitForAuth } from './helpers';

const TEACHER_USER = {
  id: 42,
  username: 'teacher1',
  role: 'teacher',
  email: 'teacher1@example.com',
  full_name: 'Test Teacher',
  is_active: true,
  avatar_url: null,
  last_login_at: '2024-01-01T00:00:00Z',
  created_at: '2024-01-01T00:00:00Z',
};

const MOCK_CLASSES = [
  {
    id: 1,
    name: 'Intro to AI',
    description: 'Spring 2024',
    teacher_id: 42,
    teacher_username: 'teacher1',
    created_at: '2024-01-15T10:00:00Z',
    student_count: 25,
    essay_count: 12,
  },
];

const MOCK_DASHBOARD = {
  total_classes: 1,
  total_students: 25,
  total_essays: 12,
  pending_reviews: 3,
  classes: MOCK_CLASSES,
};

const MOCK_PENDING = [
  {
    verdict_id: 100,
    essay_id: 1,
    filename: 'student_essay.pdf',
    student_username: 'studentA',
    label: 'suspected_hallucination',
    confidence: 0.85,
    reasoning: 'Source not found in any database',
    validated_at: '2024-01-20T10:00:00Z',
  },
];

function setupTeacherMocks(page: Page): void {
  // Override API base URL FIRST before any page load
  page.context().addInitScript(() => {
    (window as unknown as { __API_BASE_URL__?: string }).__API_BASE_URL__ = 'http://localhost:8000';
  });

  // Clear and set teacher user in localStorage
  page.context().addInitScript((user) => {
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('token', 'mock-teacher-token');
  }, TEACHER_USER);

  // Auth routes — mock teacher user (override any existing mocks)
  page.route('**/api/auth/me', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(TEACHER_USER),
    });
  });
  page.route('**/api/users/me', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(TEACHER_USER),
    });
  });
  // Teacher dashboard
  page.route('**/api/teacher/dashboard', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_DASHBOARD),
    });
  });
  page.route('**/api/teacher/classes', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_CLASSES),
    });
  });
  // Pending reviews
  page.route('**/api/teacher/classes/1/pending-reviews', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_PENDING),
    });
  });
  // Students and essays
  page.route('**/api/teacher/students', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 101,
          username: 'studentA',
          email: 'studentA@example.com',
          full_name: 'Student A',
          is_active: true,
        },
      ]),
    }),
  );
  page.route('**/api/teacher/classes/1/students', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }),
  );
  page.route('**/api/teacher/classes/1/essays', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }),
  );
  // System health
  page.route('**/api/system/health', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        totals: { users: 50, admins: 1, teachers: 5, students: 44, essays: 100, verdicts: 200 },
        verdict_label_counts: { verified: 150 },
        cache_stats: {},
      }),
    }),
  );
}

test.describe('Phase 4 — Teacher flow', () => {
  test('MyClassesPage renders, can open Create dialog, navigate to reviews', async ({ page }) => {
    // Set teacher auth before page load
    await page.addInitScript((user) => {
      localStorage.setItem('token', 'mock-teacher-token');
      localStorage.setItem('user', JSON.stringify(user));
    }, TEACHER_USER);
    setupTeacherMocks(page);

    await page.goto('/teacher/classes');
    await waitForAuth(page);

    // Header
    await expect(page.getByRole('heading', { name: /My Classes|Lớp học của tôi/i })).toBeVisible({ timeout: 10000 });
    // Create button (capability-gated)
    const createBtn = page.getByRole('button', { name: /Create Class|Tạo lớp/i });
    await expect(createBtn).toBeVisible();

    // Open dialog
    await createBtn.click();
    await expect(page.getByRole('dialog', { name: /Create New Class|Create Class|Tạo lớp mới/i })).toBeVisible();
    // Close
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /Create New Class|Create Class|Tạo lớp mới/i })).not.toBeVisible();

    // Click into a class
    await page.getByText('Intro to AI').first().click();
    await page.waitForURL(/\/teacher\/classes\/\d+/);
    // Header of detail page
    await expect(page.getByRole('heading', { name: 'Intro to AI' })).toBeVisible();
    // Back to classes
    await page.goBack();
  });

  test('PendingReviewsPage shows class filter + verdict rows', async ({ page }) => {
    // Set teacher auth before page load
    await page.addInitScript((user) => {
      localStorage.setItem('token', 'mock-teacher-token');
      localStorage.setItem('user', JSON.stringify(user));
    }, TEACHER_USER);
    setupTeacherMocks(page);

    await page.goto('/teacher/reviews');
    await waitForAuth(page);

    await expect(page.getByRole('heading', { name: /Pending Reviews/i })).toBeVisible();
    // Class chip
    await expect(page.getByRole('button', { name: 'Intro to AI' })).toBeVisible();
    // Verdict row
    await expect(page.getByText('student_essay.pdf').first()).toBeVisible();
  });

  test('teacher cannot see /admin/audit (no view_audit_log capability)', async ({ page }) => {
    // Set teacher auth before page load
    await page.addInitScript((user) => {
      localStorage.setItem('token', 'mock-teacher-token');
      localStorage.setItem('user', JSON.stringify(user));
    }, TEACHER_USER);
    setupTeacherMocks(page);
    await page.goto('/admin/audit');
    await waitForAuth(page);
    // Should redirect to /dashboard because capability missing
    await page.waitForURL(/\/dashboard$/, { timeout: 5000 });
    // Heading on dashboard
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
