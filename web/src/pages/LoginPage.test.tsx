import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import i18n from '@/i18n';
import { APP_VERSION } from '@/version';
import { LoginPage } from './LoginPage';

function renderLoginPage(
  loginMock = vi.fn().mockResolvedValue(undefined),
  loginWithGoogleMock = vi.fn().mockResolvedValue(undefined),
) {
  return {
    loginMock,
    loginWithGoogleMock,
    ...render(
      <ThemeProvider defaultTheme="light">
        <MemoryRouter initialEntries={['/login']}>
          <AuthContext.Provider
            value={{
              user: null,
              token: null,
              isAdmin: false,
              isLoading: false,
              login: loginMock,
              loginWithGoogle: loginWithGoogleMock,
              logout: async () => {},
              refreshUser: async () => {},
            }}
          >
            <LoginPage />
          </AuthContext.Provider>
        </MemoryRouter>
      </ThemeProvider>
    ),
  };
}

describe('LoginPage', () => {
  beforeEach(() => {
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

  it('renders brand showcase and form inputs', () => {
    renderLoginPage();

    expect(
      screen.getByRole('heading', { name: /welcome back|chào mừng trở lại/i })
    ).toBeDefined();
    expect(screen.getByLabelText(/username|tên đăng nhập/i)).toBeDefined();
    expect(screen.getByLabelText(/password|mật khẩu/i)).toBeDefined();
    expect(
      screen.getByRole('button', { name: /sign in|đăng nhập/i })
    ).toBeDefined();
    expect(screen.getByText(/symbolic_verifier\.py/i)).toBeDefined();
  });

  it('toggles password visibility when clicking the eye button', () => {
    renderLoginPage();

    const passwordInput = screen.getByLabelText(
      /password|mật khẩu/i
    ) as HTMLInputElement;
    expect(passwordInput.type).toBe('password');

    const toggleBtn = screen.getByRole('button', { name: /show characters/i });
    fireEvent.click(toggleBtn);
    expect(passwordInput.type).toBe('text');

    const hideBtn = screen.getByRole('button', { name: /hide characters/i });
    fireEvent.click(hideBtn);
    expect(passwordInput.type).toBe('password');
  });

  it('submits credentials and calls login()', async () => {
    const loginMock = vi.fn().mockResolvedValue(undefined);
    renderLoginPage(loginMock);

    fireEvent.change(screen.getByLabelText(/username|tên đăng nhập/i), {
      target: { value: 'admin' },
    });
    fireEvent.change(screen.getByLabelText(/password|mật khẩu/i), {
      target: { value: 'admin123' },
    });

    fireEvent.click(screen.getByRole('button', { name: /sign in|đăng nhập/i }));

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith('admin', 'admin123');
    });
  });

  it('displays destructive alert when login fails', async () => {
    const loginMock = vi
      .fn()
      .mockRejectedValue(new Error('Invalid username or password'));
    renderLoginPage(loginMock);

    fireEvent.change(screen.getByLabelText(/username|tên đăng nhập/i), {
      target: { value: 'wrong' },
    });
    fireEvent.change(screen.getByLabelText(/password|mật khẩu/i), {
      target: { value: 'wrongpass' },
    });

    fireEvent.click(screen.getByRole('button', { name: /sign in|đăng nhập/i }));

    await waitFor(() => {
      expect(screen.getByText('Invalid username or password')).toBeDefined();
    });
  });

  it('renders Continue with Google button and shows message when GOOGLE_CLIENT_ID is not configured', async () => {
    renderLoginPage();

    const googleBtn = screen.getByTestId('google-auth-button');
    expect(googleBtn).toBeDefined();

    fireEvent.click(googleBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/GOOGLE_CLIENT_ID/i)
      ).toBeDefined();
    });
  });

  it('switches live debugger trace preview tabs and detects email vs username input format', () => {
    renderLoginPage();

    // Initially shows trace [1] Vaswani et al. (2017)
    expect(screen.getByText(/R01_DOI_MATCH/i)).toBeDefined();

    // Click second trace tab [4] Nguyen & Tran
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(3);
    fireEvent.click(tabs[1]);
    expect(screen.getByText(/R05_YEAR_DRIFT/i)).toBeDefined();

    // Click third trace tab [7] Robertson & Walker
    fireEvent.click(tabs[2]);
    expect(screen.getByText(/R12_GHOST_DOI/i)).toBeDefined();

    // Typing a username shows USERNAME pill, typing an email shows EMAIL pill
    const usernameInput = screen.getByLabelText(/username|tên đăng nhập/i);
    fireEvent.change(usernameInput, { target: { value: 'scholar_user' } });
    expect(screen.getByText('USERNAME')).toBeDefined();

    fireEvent.change(usernameInput, { target: { value: 'scholar@tdtu.edu.vn' } });
    expect(screen.getByText('EMAIL')).toBeDefined();
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('Task 2.2 — labels identifier as "Email or Username" (EN) / "Email hoặc Tên đăng nhập" (VI), validates empty form inline with noValidate, replaces raw SSO · RBAC in VI, and keeps #password Eye button as first SVG button', async () => {
    await i18n.changeLanguage('en');
    const loginMockEn = vi.fn().mockResolvedValue(undefined);
    const { container: enContainer, unmount: unmountEn } = renderLoginPage(loginMockEn);

    const enLabel = enContainer.querySelector('label[for="username"]');
    expect(enLabel?.textContent?.trim()).toBe('Email or Username');

    const enForm = enContainer.querySelector('form') as HTMLFormElement;
    expect(enForm).not.toBeNull();
    expect(enForm.noValidate).toBe(true);

    // DOM SVG button order invariant: first <button> containing an <svg> is the #password visibility toggle
    const enSvgButtons = enContainer.querySelectorAll('button svg');
    expect(enSvgButtons.length).toBeGreaterThan(0);
    const firstSvgButtonEn = enSvgButtons[0].closest('button');
    expect(firstSvgButtonEn?.getAttribute('aria-label')).toBe('Show characters');

    // Empty submission shows clear inline error without calling login()
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(loginMockEn).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/email or username|password/i);

    unmountEn();

    await i18n.changeLanguage('vi');
    const loginMockVi = vi.fn().mockResolvedValue(undefined);
    const { container: viContainer, unmount: unmountVi } = renderLoginPage(loginMockVi);

    const viLabel = viContainer.querySelector('label[for="username"]');
    expect(viLabel?.textContent?.trim()).toBe('Email hoặc Tên đăng nhập');

    // No raw "SSO · RBAC" or "TLS 1.3 · JWT RBAC" in Vietnamese
    expect(viContainer.textContent).not.toContain('SSO · RBAC');
    expect(viContainer.textContent).not.toContain('JWT RBAC');

    // DOM SVG button order preserved in VI too
    const firstSvgButtonVi = viContainer.querySelectorAll('button svg')[0]?.closest('button');
    expect(firstSvgButtonVi?.getAttribute('aria-label')).toBe('Show characters');

    // Empty submission in VI shows Vietnamese inline validation alert
    fireEvent.click(screen.getByRole('button', { name: /đăng nhập/i }));
    expect(loginMockVi).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/email|tên đăng nhập|mật khẩu/i);

    unmountVi();
  });

  it('Task 2.2 — AuthSplitShell left panel has zero .truncate or line-clamp-* classes, zero <button> elements, full "Semantic Scholar" chip, localized VI verdict labels, and whitespace-nowrap on 99,02% CHÍNH XÁC', async () => {
    await i18n.changeLanguage('en');
    const { container: enContainer, unmount: unmountEn } = renderLoginPage();
    const leftPanelEn = enContainer.firstElementChild?.firstElementChild as HTMLElement;
    expect(leftPanelEn).not.toBeNull();
    expect(leftPanelEn.querySelectorAll('button').length).toBe(0);
    expect(leftPanelEn.querySelectorAll('.truncate').length).toBe(0);
    expect(leftPanelEn.innerHTML).not.toMatch(/\bline-clamp-\d+\b/);
    expect(leftPanelEn.innerHTML).not.toMatch(/\bshadow-2?xs\b/);
    expect(leftPanelEn.innerHTML).not.toMatch(/bg-(emerald|amber|red)-500\/12\b/);
    expect(leftPanelEn.textContent).toContain('Semantic Scholar');
    expect(leftPanelEn.textContent).toContain('symbolic_verifier.py');
    expect(leftPanelEn.textContent).toContain('R01_DOI_MATCH');
    unmountEn();

    await i18n.changeLanguage('vi');
    const { container: viContainer, unmount: unmountVi } = renderLoginPage();
    const leftPanelVi = viContainer.firstElementChild?.firstElementChild as HTMLElement;
    expect(leftPanelVi.querySelectorAll('button').length).toBe(0);
    expect(leftPanelVi.querySelectorAll('.truncate').length).toBe(0);
    expect(leftPanelVi.innerHTML).not.toMatch(/\bline-clamp-\d+\b/);
    expect(leftPanelVi.textContent).toContain('Semantic Scholar');
    expect(leftPanelVi.textContent).toContain('Xác minh mọi trích dẫn. Truy vết mọi nguồn tài liệu.');
    expect(leftPanelVi.textContent).toContain(`SourceLogic v${APP_VERSION}`);

    // Accuracy badge prevents mid-phrase line breaks
    const accSpanVi = Array.from(leftPanelVi.querySelectorAll('span')).find((el) =>
      el.textContent?.includes('99,02% CHÍNH XÁC'),
    );
    expect(accSpanVi).toBeDefined();
    expect(
      accSpanVi?.className.includes('whitespace-nowrap') ||
        accSpanVi?.parentElement?.className.includes('whitespace-nowrap'),
    ).toBe(true);

    // Verdict labels in VI are localized instead of raw English VERIFIED / YEAR_MISMATCH / HALLUCINATED
    expect(leftPanelVi.textContent).not.toContain('YEAR_MISMATCH');
    expect(leftPanelVi.textContent).not.toContain('HALLUCINATED');
    expect(leftPanelVi.textContent).toMatch(/Nguồn hợp lệ|Đã xác minh|Nguồn trích dẫn hợp lệ/i);

    const tabsVi = screen.getAllByRole('tab');
    fireEvent.click(tabsVi[1]);
    expect(leftPanelVi.textContent).toMatch(/Sai lệch năm|Sai lệch thông tin/i);
    fireEvent.click(tabsVi[2]);
    expect(leftPanelVi.textContent).toMatch(/Không tìm thấy nguồn|Nguồn ảo/i);

    unmountVi();
  });
});
