import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { api, type User } from '@/api/client';
import i18n from '@/i18n';
import { AuthContext } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { renderWithProviders, makeUser, screen, waitFor } from '@/test-utils';
import { DashboardPage } from './DashboardPage';
import { UploadPage } from './UploadPage';
import { HistoryPage } from './HistoryPage';
import { AppLayout } from '@/components/AppLayout';

/** Batch Check entry points must follow the plan entitlement, like the sidebar. */

const PAGES = [
  ['DashboardPage', () => <DashboardPage />],
  ['UploadPage', () => <UploadPage />],
  ['HistoryPage', () => <HistoryPage />],
] as const;

describe('Batch Check entry points', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
    vi.spyOn(api, 'listEssays').mockResolvedValue([]);
    vi.spyOn(api, 'listEnrolledClasses').mockResolvedValue([]);
  });

  for (const [name, render] of PAGES) {
    it(`${name}: shown for a Pro student (quota.allow_batch_upload)`, async () => {
      renderWithProviders(render(), { user: makeUser('user', 'pro') });
      await waitFor(() =>
        expect(screen.getByTestId('batch-check-link').getAttribute('href')).toBe('/batch-upload'),
      );
    });

    it(`${name}: hidden for a Basic student`, async () => {
      renderWithProviders(render(), { user: makeUser('user', 'basic') });
      await waitFor(() => expect(document.body.textContent?.length).toBeGreaterThan(0));
      expect(screen.queryByTestId('batch-check-link')).toBeNull();
    });
  }

  it('teacher sees it even if the backend quota omits batch upload', async () => {
    const teacher = makeUser('teacher');
    teacher.quota = { ...teacher.quota!, allow_batch_upload: false };
    renderWithProviders(<DashboardPage />, { user: teacher });
    await waitFor(() => expect(screen.getByTestId('batch-check-link')).toBeDefined());
  });

  it('sidebar visibility matches the page buttons (Pro shows, Basic hides)', async () => {
    const { unmount } = renderWithProviders(
      <AppLayout>
        <div />
      </AppLayout>,
      { user: makeUser('user', 'pro') },
    );
    expect(screen.getAllByRole('link', { name: /batch check/i }).length).toBeGreaterThan(0);
    unmount();
    renderWithProviders(
      <AppLayout>
        <div />
      </AppLayout>,
      { user: makeUser('user', 'basic') },
    );
    expect(screen.queryByRole('link', { name: /batch check/i })).toBeNull();
  });
});

describe('useRole().canBatchUpload', () => {
  const wrap = (user: User) =>
    function W({ children }: { children: ReactNode }) {
      return (
        <AuthContext.Provider
          value={{
            user,
            token: 't',
            isAdmin: user.role === 'admin',
            isLoading: false,
            login: async () => {},
            logout: async () => {},
            refreshUser: async () => {},
          }}
        >
          {children}
        </AuthContext.Provider>
      );
    };

  it.each([
    ['basic student', makeUser('user', 'basic'), false],
    ['pro student', makeUser('user', 'pro'), true],
    ['ultra student', makeUser('user', 'ultra'), true],
    ['teacher', makeUser('teacher'), true],
    ['admin', makeUser('admin'), true],
  ])('%s → %s', (_label, user, expected) => {
    const { result } = renderHook(() => useRole(), { wrapper: wrap(user) });
    expect(result.current.canBatchUpload).toBe(expected);
  });
});
