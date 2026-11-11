import { test, expect } from '@playwright/test';

/**
 * E2E Tests for Authentication Flow
 * Uses REAL backend - no mocking
 */
test.describe('Authentication', () => {

  test.beforeEach(async ({ page }) => {
    // Clear auth state before each test
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('token'));
  });

  test.afterEach(async ({ page }) => {
    // Logout after each test
    await page.evaluate(() => localStorage.removeItem('token'));
  });

  test('should show login page for unauthenticated users', async ({ page }) => {
    await page.goto('/');

    // Click sign in button on landing page if visible
    const signInLink = page.getByRole('link', { name: /sign in/i }).first();
    if (await signInLink.isVisible()) {
      await signInLink.click();
    }

    // Should be on login page
    await expect(page).toHaveURL(/\/login/);

    // Should show login form
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
    await expect(page.getByLabel(/username/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
  });

  test('should login with valid credentials and redirect to dashboard', async ({ page }) => {
    await page.goto('/login');

    // Wait for login form to be visible
    await page.waitForLoadState('networkidle');

    // Fill login form with demo credentials
    await page.getByLabel(/username/i).fill('admin');
    await page.getByLabel(/password/i).fill('admin123');

    // Submit form
    await page.getByRole('button', { name: /sign in/i }).click();

    // Should redirect to dashboard
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

    // Should show dashboard content
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // Fill with invalid credentials
    await page.getByLabel(/username/i).fill('invalid_user');
    await page.getByLabel(/password/i).fill('wrongpassword');

    // Submit form
    await page.getByRole('button', { name: /sign in/i }).click();

    // Should show error message
    await expect(page.getByText(/invalid|error|failed/i)).toBeVisible({ timeout: 5000 });

    // Should stay on login page
    await expect(page).toHaveURL(/\/login/);
  });

  test('should block access to protected routes for unauthenticated users', async ({ page }) => {
    // Try to access dashboard directly
    await page.goto('/dashboard');

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);

    // Try to access upload page
    await page.goto('/upload');
    await expect(page).toHaveURL(/\/login/);

    // Try to access history page
    await page.goto('/history');
    await expect(page).toHaveURL(/\/login/);
  });

  test('should logout and redirect to login', async ({ page }) => {
    // First login
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.getByLabel(/username/i).fill('admin');
    await page.getByLabel(/password/i).fill('admin123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

    // Click logout button in sidebar
    await page.getByRole('button', { name: /sign out/i }).click();

    // Wait for logout to complete
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });

    // Should be on login page
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
  });

  test('should show user info in sidebar after login', async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.getByLabel(/username/i).fill('admin');
    await page.getByLabel(/password/i).fill('admin123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

    // Should show username in sidebar
    await expect(page.getByText('admin').first()).toBeVisible({ timeout: 5000 });
  });

  test('should complete full register, activate account, forgot password, and reset password flow', async ({ page, request }) => {
    const uniqueSuffix = Date.now().toString().slice(-6);
    const username = `scholar_${uniqueSuffix}`;
    const email = `scholar.${uniqueSuffix}@university.edu.vn`;
    const initialPass = 'InitialScholar2026!';
    const resetPass = 'UpdatedScholar2026!';

    // 1. Go to /login and click Create account
    await page.goto('/login');
    await page.getByRole('link', { name: /create account/i }).click();
    await expect(page).toHaveURL(/\/register/);

    // 2. Fill registration form and submit
    await page.getByLabel(/full name/i).fill('Scholar Test User');
    await page.getByLabel(/username/i).fill(username);
    await page.getByLabel(/email address/i).fill(email);
    await page.getByLabel(/^password$/i).fill(initialPass);
    await page.getByLabel(/confirm password/i).fill(initialPass);
    await page.getByTestId('register-privacy-consent-checkbox').dispatchEvent('click');
    await page.getByRole('button', { name: /create account/i }).click();

    // 3. Should display "Check your email inbox" view
    await expect(page.getByRole('heading', { name: /check your email inbox/i })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(email)).toBeVisible();

    // 4. Attempting to login before activation should show Account Not Activated banner + Resend button
    await page.goto('/login');
    await page.getByLabel(/username/i).fill(username);
    await page.getByLabel(/password/i).fill(initialPass);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText(/account not activated/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /resend activation email/i })).toBeVisible();

    // 5. Retrieve activation token from backend outbox and activate account
    const actMailRes = await request.get(`/api/auth/dev/latest-email?email=${encodeURIComponent(email)}`);
    expect(actMailRes.ok()).toBeTruthy();
    const actMail = await actMailRes.json();
    expect(actMail.template_type).toBe('activation');
    expect(actMail.token).toBeTruthy();

    await page.goto(`/activate-account?token=${actMail.token}`);
    await expect(page.getByRole('heading', { name: /account activated/i })).toBeVisible({ timeout: 10000 });

    // 6. Forgot password flow
    await page.goto('/forgot-password');
    await page.getByLabel(/registered email address/i).fill(email);
    await page.getByRole('button', { name: /send reset link/i }).click();
    await expect(page.getByRole('heading', { name: /password reset link sent/i })).toBeVisible({ timeout: 15000 });

    // 7. Retrieve reset token and reset password
    const resetMailRes = await request.get(`/api/auth/dev/latest-email?email=${encodeURIComponent(email)}`);
    expect(resetMailRes.ok()).toBeTruthy();
    const resetMail = await resetMailRes.json();
    expect(resetMail.template_type).toBe('password_reset');
    expect(resetMail.token).toBeTruthy();

    await page.goto(`/reset-password?token=${resetMail.token}`);
    await expect(page.getByText(`@${username}`)).toBeVisible({ timeout: 10000 });
    await page.getByLabel(/^new password$/i).fill(resetPass);
    await page.getByLabel(/confirm new password/i).fill(resetPass);
    await page.getByRole('button', { name: /update password/i }).click();
    await expect(page.getByRole('heading', { name: /password updated/i })).toBeVisible({ timeout: 15000 });

    // 8. Sign in with new password (or email) and verify dashboard redirect
    await page.goto('/login?reset=1');
    await expect(page.getByText(/password updated! please sign in/i)).toBeVisible();
    await page.getByLabel(/username/i).fill(email);
    await page.getByLabel(/password/i).fill(resetPass);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
  });

  test('should display Google Sign-In button on login and register pages and complete Google OAuth flow', async ({ page, request }) => {
    const configRes = await request.get('/api/auth/google/config');
    expect(configRes.ok()).toBeTruthy();
    const configData = await configRes.json();
    expect(configData).toHaveProperty('enabled');
    expect(configData).toHaveProperty('client_id');

    // Verify Google button on /login
    await page.goto('/login');
    const loginGoogleBtn = page.getByTestId('google-auth-button');
    await expect(loginGoogleBtn).toBeVisible();
    await expect(loginGoogleBtn).toContainText(/continue with google|tiếp tục với google/i);

    // Verify Google button on /register
    await page.goto('/register');
    const registerGoogleBtn = page.getByTestId('google-auth-button');
    await expect(registerGoogleBtn).toBeVisible();
  });
});
