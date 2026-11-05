import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { api } from '@/api/client';
import '@/i18n';
import { RegisterPage } from './RegisterPage';
import { ActivateAccountPage } from './ActivateAccountPage';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { ResetPasswordPage } from './ResetPasswordPage';

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
});
