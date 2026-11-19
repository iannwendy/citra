import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { AuthContext } from '@/contexts/AuthContext';
import { CitraMotionProvider } from '@/components/ui/motion-primitives';
import { api } from '@/api/client';
import i18n from '@/i18n';
import * as RegisterModule from './RegisterPage';
import { RegisterPage } from './RegisterPage';
import { ActivateAccountPage } from './ActivateAccountPage';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { ResetPasswordPage } from './ResetPasswordPage';
import { LandingPage } from './LandingPage';

describe('Auth Pages (Register, Activate, Forgot & Reset Password)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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

  it('RegisterPage submits registration and displays email verification instructions', async () => {
    const registerSpy = vi.spyOn(api, 'register').mockResolvedValue({
      message: 'Created',
      username: 'minh_tdtu',
      email: 'minh@tdtu.edu.vn',
      requires_activation: true,
      email_sent: true,
    });

    render(
      <ThemeProvider defaultTheme="light">
        <MemoryRouter initialEntries={['/register']}>
          <RegisterPage />
        </MemoryRouter>
      </ThemeProvider>,
    );

    fireEvent.change(screen.getByLabelText(/full name|họ và tên/i), {
      target: { value: 'Nguyen Bao Minh' },
    });
    fireEvent.change(screen.getByLabelText(/username|tên đăng nhập/i), {
      target: { value: 'minh_tdtu' },
    });
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'minh@tdtu.edu.vn' },
    });
    fireEvent.change(
      screen.getByLabelText(/^(password|mật khẩu)$/i),
      { target: { value: 'Pass12345' } },
    );
    fireEvent.change(
      screen.getByLabelText(/confirm password|xác nhận mật khẩu/i),
      { target: { value: 'Pass12345' } },
    );

    fireEvent.click(screen.getByTestId('register-privacy-consent-checkbox'));

    fireEvent.click(
      screen.getByRole('button', { name: /create account|đăng ký tài khoản/i }),
    );

    await waitFor(() => {
      expect(registerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'minh_tdtu',
          email: 'minh@tdtu.edu.vn',
          full_name: 'Nguyen Bao Minh',
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText('minh@tdtu.edu.vn')).toBeDefined();
    });
  });

  it('ActivateAccountPage verifies token on mount and shows activated state', async () => {
    const activateSpy = vi.spyOn(api, 'activateAccount').mockResolvedValue({
      message: 'Activated',
      username: 'minh_tdtu',
      email: 'minh@tdtu.edu.vn',
      activated: true,
      already_active: false,
    });

    render(
      <ThemeProvider defaultTheme="light">
        <MemoryRouter initialEntries={['/activate-account?token=tok_abc_123']}>
          <Routes>
            <Route path="/activate-account" element={<ActivateAccountPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(activateSpy).toHaveBeenCalledWith('tok_abc_123');
    });

    await waitFor(() => {
      expect(screen.getByText('@minh_tdtu')).toBeDefined();
      expect(screen.getByText('minh@tdtu.edu.vn')).toBeDefined();
    });
  });

  it('ForgotPasswordPage sends reset email and shows confirmation', async () => {
    const forgotSpy = vi.spyOn(api, 'forgotPassword').mockResolvedValue({
      message: 'Reset link sent',
    });

    render(
      <ThemeProvider defaultTheme="light">
        <MemoryRouter initialEntries={['/forgot-password']}>
          <ForgotPasswordPage />
        </MemoryRouter>
      </ThemeProvider>,
    );

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'minh@tdtu.edu.vn' },
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: /send reset link|gửi liên kết khôi phục/i,
      }),
    );

    await waitFor(() => {
      expect(forgotSpy).toHaveBeenCalledWith(
        'minh@tdtu.edu.vn',
        expect.any(String),
      );
    });

    await waitFor(() => {
      expect(screen.getByText('minh@tdtu.edu.vn')).toBeDefined();
    });
  });

  it('ResetPasswordPage verifies token and updates password', async () => {
    vi.spyOn(api, 'verifyResetToken').mockResolvedValue({
      valid: true,
      username: 'minh_tdtu',
      email: 'minh@tdtu.edu.vn',
      message: 'Valid',
    });
    const resetSpy = vi.spyOn(api, 'resetPassword').mockResolvedValue({
      message: 'Updated',
    });

    render(
      <ThemeProvider defaultTheme="light">
        <MemoryRouter initialEntries={['/reset-password?token=reset_tok_999']}>
          <Routes>
            <Route path="/reset-password" element={<ResetPasswordPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('@minh_tdtu')).toBeDefined();
    });

    fireEvent.change(
      screen.getByLabelText(/^(new password|mật khẩu mới)$/i),
      { target: { value: 'NewSecret123' } },
    );
    fireEvent.change(
      screen.getByLabelText(/confirm new password|xác nhận mật khẩu mới/i),
      { target: { value: 'NewSecret123' } },
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: /update password|cập nhật mật khẩu/i,
      }),
    );

    await waitFor(() => {
      expect(resetSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'reset_tok_999',
          new_password: 'NewSecret123',
        }),
      );
    });
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('Task 2.2 — exports deriveUsernameFromEmailOrName and auto-populates #username from #email until #username is manually edited', async () => {
    const deriveFn = (
      RegisterModule as unknown as {
        deriveUsernameFromEmailOrName?: (input: string) => string;
      }
    ).deriveUsernameFromEmailOrName;
    expect(typeof deriveFn).toBe('function');

    expect(deriveFn!('minh.nguyen+kltn@tdtu.edu.vn')).toBe('minh.nguyen_kltn');
    expect(deriveFn!('a@b.vn')).toMatch(/^[a-zA-Z0-9._-]{3,50}$/);
    expect(deriveFn!('..Nguyễn Bảo Minh..')).toMatch(/^[a-zA-Z0-9._-]{3,50}$/);
    expect(deriveFn!('..Nguyễn Bảo Minh..').startsWith('.')).toBe(false);
    expect(deriveFn!('..Nguyễn Bảo Minh..').endsWith('.')).toBe(false);
    expect(deriveFn!('..Nguyễn Bảo Minh..').includes('..')).toBe(false);

    await i18n.changeLanguage('en');
    const { container, unmount } = render(
      <ThemeProvider defaultTheme="light">
        <MemoryRouter initialEntries={['/register']}>
          <RegisterPage />
        </MemoryRouter>
      </ThemeProvider>,
    );

    const emailInput = screen.getByLabelText(/email/i) as HTMLInputElement;
    const usernameLabel = container.querySelector('label[for="username"]');
    expect(usernameLabel?.textContent?.trim()).toBe('Username');
    expect(usernameLabel?.textContent).not.toMatch(/email/i);

    const usernameInput = screen.getByLabelText(/^username$/i) as HTMLInputElement;

    // Typing an email auto-populates #username cleanly
    fireEvent.change(emailInput, {
      target: { value: 'minh.nguyen+kltn@tdtu.edu.vn' },
    });
    expect(usernameInput.value).toBe('minh.nguyen_kltn');

    // Updating email before manual username edit continues syncing
    fireEvent.change(emailInput, {
      target: { value: 'lan.tran+thesis@hcmus.edu.vn' },
    });
    expect(usernameInput.value).toBe('lan.tran_thesis');

    // Once user manually edits #username, further #email changes do NOT overwrite #username
    fireEvent.change(usernameInput, { target: { value: 'custom_scholar' } });
    fireEvent.change(emailInput, { target: { value: 'other.email@uet.vnu.edu.vn' } });
    expect(usernameInput.value).toBe('custom_scholar');

    unmount();
  });

  it('Task 2.2 — RegisterPage uses noValidate with inline validation, concise placeholders (<= 26 chars), sm:grid-cols-2 rows, and concise Law 91/2025/QH15 consent in EN & VI', async () => {
    const registerSpy = vi.spyOn(api, 'register').mockResolvedValue({
      message: 'Created',
      username: 'minh_tdtu',
      email: 'minh@tdtu.edu.vn',
      requires_activation: true,
      email_sent: true,
    });

    for (const lang of ['en', 'vi'] as const) {
      await i18n.changeLanguage(lang);
      const { container, unmount } = render(
        <ThemeProvider defaultTheme="light">
          <MemoryRouter initialEntries={['/register']}>
            <RegisterPage />
          </MemoryRouter>
        </ThemeProvider>,
      );

      const form = container.querySelector('form') as HTMLFormElement;
      expect(form.noValidate).toBe(true);
      expect(container.querySelectorAll('.sm\\:grid-cols-2').length).toBeGreaterThanOrEqual(2);

      // Every input placeholder is concise (<= 26 chars) so it never clips on 390px or 2-col desktop
      const inputs = Array.from(container.querySelectorAll('input[placeholder]')) as HTMLInputElement[];
      expect(inputs.length).toBeGreaterThanOrEqual(6);
      inputs.forEach((inp) => {
        expect(inp.placeholder.length).toBeLessThanOrEqual(26);
      });

      // Username label never contains "Email" so getByLabelText(/email/i) uniquely selects #email
      const usernameLabel = container.querySelector('label[for="username"]');
      expect(usernameLabel?.textContent).not.toMatch(/email/i);

      // Submit empty form -> shows inline alert without calling api.register
      fireEvent.click(
        screen.getByRole('button', { name: /create account|đăng ký tài khoản/i }),
      );
      expect(registerSpy).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toBeDefined();

      // Concise statutory consent preserves 91/2025/QH15, /privacy, and /terms
      expect(screen.getByTestId('register-privacy-consent-checkbox')).toBeDefined();
      expect(container.textContent).toContain('91/2025/QH15');
      expect(container.querySelector('a[href="/privacy"]')).not.toBeNull();
      expect(container.querySelector('a[href="/terms"]')).not.toBeNull();

      unmount();
    }
  });

  it('Task 2.2 — ForgotPasswordPage uses noValidate and displays inline validation error on empty or malformed email before calling api.forgotPassword', async () => {
    const forgotSpy = vi.spyOn(api, 'forgotPassword').mockResolvedValue({
      message: 'Reset link sent',
    });

    for (const lang of ['en', 'vi'] as const) {
      await i18n.changeLanguage(lang);
      const { container, unmount } = render(
        <ThemeProvider defaultTheme="light">
          <MemoryRouter initialEntries={['/forgot-password']}>
            <ForgotPasswordPage />
          </MemoryRouter>
        </ThemeProvider>,
      );

      const form = container.querySelector('form') as HTMLFormElement;
      expect(form.noValidate).toBe(true);

      // Empty submit
      fireEvent.click(
        screen.getByRole('button', {
          name: /send reset link|gửi liên kết khôi phục/i,
        }),
      );
      expect(forgotSpy).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toBeDefined();

      // Invalid email submit
      fireEvent.change(screen.getByLabelText(/email/i), {
        target: { value: 'not-an-email' },
      });
      fireEvent.click(
        screen.getByRole('button', {
          name: /send reset link|gửi liên kết khôi phục/i,
        }),
      );
      expect(forgotSpy).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toBeDefined();

      unmount();
    }
  });

  it('Task 2.2 — LandingPage routes unauthenticated "Try CITRA Free" / "Get started free" CTAs to /register while keeping explicit "Sign in" links pointed to /login', async () => {
    for (const lang of ['en', 'vi'] as const) {
      await i18n.changeLanguage(lang);
      const { container, unmount } = render(
        <CitraMotionProvider>
          <ThemeProvider defaultTheme="light">
            <MemoryRouter initialEntries={['/']}>
              <AuthContext.Provider
                value={{
                  user: null,
                  token: null,
                  isAdmin: false,
                  isLoading: false,
                  login: async () => {},
                  loginWithGoogle: async () => {},
                  logout: async () => {},
                  refreshUser: async () => {},
                }}
              >
                <LandingPage />
              </AuthContext.Provider>
            </MemoryRouter>
          </ThemeProvider>
        </CitraMotionProvider>,
      );

      const allLinks = Array.from(container.querySelectorAll('a')) as HTMLAnchorElement[];
      const signupCtas = allLinks.filter((a) =>
        /try citra free|trải nghiệm( citra)? miễn phí|trải nghiệm quy trình|get started free|bắt đầu miễn phí|kiểm tra miễn phí|rà soát bài viết|check manuscript|^get started$/i.test(
          a.textContent?.trim() ?? '',
        ),
      );
      expect(signupCtas.length).toBeGreaterThanOrEqual(4);
      signupCtas.forEach((cta) => {
        expect(cta.getAttribute('href')).toBe('/register');
      });

      const signInLinks = allLinks.filter((a) =>
        /^(sign in|đăng nhập)$/i.test(a.textContent?.trim() ?? ''),
      );
      expect(signInLinks.length).toBeGreaterThanOrEqual(2);
      signInLinks.forEach((lnk) => {
        expect(lnk.getAttribute('href')).toBe('/login');
      });

      unmount();
    }
  });
});
