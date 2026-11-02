import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { ToastProvider, useToast, NotificationCenterButton } from './ToastContext';

function ToastTestHarness() {
  const toast = useToast();

  return (
    <div>
      <NotificationCenterButton compact={false} />
      <button
        data-testid="trigger-success"
        onClick={() =>
          toast.success(
            'Subscription Reactivated',
            'Auto-renewal has been restored for your Pro plan.',
            {
              category: 'STRIPE · BILLING',
            }
          )
        }
      >
        Trigger Success
      </button>
      <button
        data-testid="trigger-error"
        onClick={() => toast.error('Verification Halt', 'Unable to reach CrossRef DOI resolver.')}
      >
        Trigger Error
      </button>
      <button
        data-testid="trigger-warning"
        onClick={() =>
          toast.warning('Orphan Citation Detected', '2 bibliography entries lack in-text anchors.')
        }
      >
        Trigger Warning
      </button>
      <button
        data-testid="trigger-info"
        onClick={() => toast.info('Engine Ready', 'Symbolic rule engine v3.9 loaded.')}
      >
        Trigger Info
      </button>
      <button
        data-testid="trigger-morph"
        onClick={() => {
          const id = toast.loading('Verifying CrossRef DOIs…', 'Querying 28 symbolic rules.');
          setTimeout(() => {
            toast.updateToast(id, {
              type: 'success',
              title: '28/28 Symbolic Rules Passed',
              message: 'Zero hallucinated references detected.',
              category: 'PIPELINE · COMPLETE',
              duration: 4000,
            });
          }, 300);
        }}
      >
        Trigger Morph
      </button>
      <button
        data-testid="trigger-promise-ok"
        onClick={() => {
          void toast.promise(
            new Promise<string>((resolve) => setTimeout(() => resolve('14 DOIs'), 200)),
            {
              loading: { title: 'Syncing bibliography…', message: 'Contacting OpenAlex' },
              success: (res) => ({ title: `Synced ${res}`, message: 'All metadata verified.' }),
              error: 'Sync failed',
            }
          );
        }}
      >
        Trigger Promise OK
      </button>
    </div>
  );
}

describe('120fps Solva Editorial Notification Engine (ToastContext)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
    cleanup();
  });

  it('renders semantic toasts with custom category tags and immediate ARIA dismissal', () => {
    render(
      <ToastProvider>
        <ToastTestHarness />
      </ToastProvider>
    );

    fireEvent.click(screen.getByTestId('trigger-success'));

    const alert = screen.getByRole('alert');
    expect(alert).toBeTruthy();
    expect(alert.getAttribute('data-toast-type')).toBe('success');
    expect(screen.getByText('Subscription Reactivated')).toBeTruthy();
    expect(screen.getByText('Auto-renewal has been restored for your Pro plan.')).toBeTruthy();
    expect(screen.getByText('STRIPE · BILLING')).toBeTruthy();

    // Clicking dismiss transitions role="alert" -> role="presentation" immediately for zero-latency accessibility
    const dismissBtn = screen.getByLabelText('Dismiss notification');
    fireEvent.click(dismissBtn);
    expect(screen.queryByRole('alert')).toBeNull();

    // After exit animation (210ms), node is removed from DOM
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.queryByText('Subscription Reactivated')).toBeNull();
  });

  it('supports live morphing from loading spinner to verified success state in-place', () => {
    render(
      <ToastProvider>
        <ToastTestHarness />
      </ToastProvider>
    );

    fireEvent.click(screen.getByTestId('trigger-morph'));

    const loadingToast = screen.getByRole('alert');
    expect(loadingToast.getAttribute('data-toast-type')).toBe('loading');
    expect(screen.getByText('Verifying CrossRef DOIs…')).toBeTruthy();
    expect(screen.getByText('PIPELINE · SYNC')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(350);
    });

    const morphedToast = screen.getByRole('alert');
    expect(morphedToast.getAttribute('data-toast-type')).toBe('success');
    expect(screen.getByText('28/28 Symbolic Rules Passed')).toBeTruthy();
    expect(screen.getByText('Zero hallucinated references detected.')).toBeTruthy();
    expect(screen.getByText('PIPELINE · COMPLETE')).toBeTruthy();
  });

  it('supports toast.promise lifecycle from loading to resolved success', async () => {
    render(
      <ToastProvider>
        <ToastTestHarness />
      </ToastProvider>
    );

    fireEvent.click(screen.getByTestId('trigger-promise-ok'));
    expect(screen.getByText('Syncing bibliography…')).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.getByText('Synced 14 DOIs')).toBeTruthy();
    expect(screen.getByText('All metadata verified.')).toBeTruthy();
  });

  it('stacks multiple toasts and clears all when Clear All is clicked', () => {
    render(
      <ToastProvider>
        <ToastTestHarness />
      </ToastProvider>
    );

    fireEvent.click(screen.getByTestId('trigger-success'));
    fireEvent.click(screen.getByTestId('trigger-warning'));
    fireEvent.click(screen.getByTestId('trigger-error'));

    expect(screen.getAllByRole('alert')).toHaveLength(3);
    expect(screen.getByTestId('toast-stack-toolbar')).toBeTruthy();
    expect(screen.getByText(/3 NOTIFICATIONS/i)).toBeTruthy();

    fireEvent.click(screen.getByTestId('dismiss-all-toasts-btn'));
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('records notifications in NotificationCenterButton history drawer and supports mute + clear', () => {
    render(
      <ToastProvider>
        <ToastTestHarness />
      </ToastProvider>
    );

    // Fire two notifications
    fireEvent.click(screen.getByTestId('trigger-success'));
    fireEvent.click(screen.getByTestId('trigger-warning'));

    // Dismiss active toasts so we only inspect Notification Center history
    fireEvent.click(screen.getByTestId('dismiss-all-toasts-btn'));
    act(() => {
      vi.advanceTimersByTime(250);
    });

    // Open Notification Center
    const ncTrigger = screen.getByTestId('notification-center-trigger-desktop');
    expect(ncTrigger.className).toContain('h-8 w-8');
    expect(ncTrigger.querySelectorAll('span')).toHaveLength(1);
    fireEvent.click(ncTrigger);

    const panel = screen.getByTestId('notification-center-panel');
    expect(panel).toBeTruthy();
    expect(screen.getByText('Notification Center')).toBeTruthy();
    expect(screen.getByText('Subscription Reactivated')).toBeTruthy();
    expect(screen.getByText('Orphan Citation Detected')).toBeTruthy();

    // Unread notifications remain unread when opening panel until marked as read
    expect(screen.getAllByTestId('notification-unread-dot')).toHaveLength(2);
    const markAllReadBtn = screen.getByTestId('notification-mark-all-read-btn');
    expect(markAllReadBtn.textContent).toMatch(/Mark all read \(2\)/i);

    // Clicking Mark all read marks all notifications as read and updates button state
    fireEvent.click(markAllReadBtn);
    expect(screen.queryAllByTestId('notification-unread-dot')).toHaveLength(0);
    expect(markAllReadBtn.textContent).toMatch(/All read/i);

    // Toggle LIVE -> MUTED
    const muteBtn = screen.getByTestId('notification-mute-toggle-btn');
    expect(muteBtn.textContent).toMatch(/LIVE/i);
    fireEvent.click(muteBtn);
    expect(muteBtn.textContent).toMatch(/MUTED/i);

    // When muted, firing a toast logs to history without popping a floating alert
    fireEvent.click(screen.getByTestId('trigger-info'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Engine Ready')).toBeTruthy();
    expect(screen.getAllByTestId('notification-unread-dot')).toHaveLength(1);

    // Clear history
    fireEvent.click(screen.getByTestId('notification-clear-history-btn'));
    expect(screen.getByText('All caught up')).toBeTruthy();
  });
});
