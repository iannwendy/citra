import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import tailwindConfig from '../../../tailwind.config';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './dropdown-menu';
import { useExitPresence } from './transitions';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { CitraMotionProvider } from './motion-primitives';
import { LandingPage } from '@/pages/LandingPage';
import { PricingPage } from '@/pages/PricingPage';

describe('Task 4: Asymmetric Overlays & SolvaHeader Exit Animations', () => {
  beforeEach(() => {
    (globalThis as { __CITRA_ENABLE_TEST_MOTION__?: boolean }).__CITRA_ENABLE_TEST_MOTION__ = true;
  });

  afterEach(() => {
    delete (globalThis as { __CITRA_ENABLE_TEST_MOTION__?: boolean }).__CITRA_ENABLE_TEST_MOTION__;
    vi.useRealTimers();
  });

  it('defines dialogContentIn and dialogContentOut keyframes in tailwind.config.ts preserving -50% centering', () => {
    const keyframes = (tailwindConfig.theme?.extend?.keyframes ?? {}) as Record<
      string,
      Record<string, { transform?: string; opacity?: string }>
    >;
    expect(keyframes.dialogContentIn).toBeDefined();
    expect(keyframes.dialogContentOut).toBeDefined();
    expect(keyframes.dropdownIn).toBeDefined();
    expect(keyframes.dropdownOut).toBeDefined();

    // Every keyframe of dialogContentIn & dialogContentOut MUST preserve -50% X/Y centering
    expect(keyframes.dialogContentIn.from.transform).toContain('-50%');
    expect(keyframes.dialogContentIn.to.transform).toContain('-50%');
    expect(keyframes.dialogContentOut.from.transform).toContain('-50%');
    expect(keyframes.dialogContentOut.to.transform).toContain('-50%');
  });

  it('applies asymmetric data-[state=open] and data-[state=closed] animations to DialogContent and DialogOverlay', () => {
    render(
      <Dialog open>
        <DialogContent data-testid="test-dialog-content">
          <DialogTitle>Audit Confirmation</DialogTitle>
          <DialogDescription>Verify asymmetric open and close classes.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    const content = screen.getByTestId('test-dialog-content');
    expect(content.className).toContain('data-[state=open]:animate-dialog-content-in');
    expect(content.className).toContain('data-[state=closed]:animate-dialog-content-out');
  });

  it('applies asymmetric data-[state=open] and data-[state=closed] animations to DropdownMenuContent', () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger asChild>
          <button type="button">Actions</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent data-testid="test-dropdown-content">
          <DropdownMenuItem>Export BibTeX</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    const menu = screen.getByTestId('test-dropdown-content');
    expect(menu.className).toContain('data-[state=open]:animate-dropdown-in');
    expect(menu.className).toContain('data-[state=closed]:animate-dropdown-out');
  });

  it('useExitPresence retains mounted=true with phase="closing" for 150ms before unmounting', () => {
    vi.useFakeTimers();

    function ExitHarness() {
      const [open, setOpen] = useState(true);
      const { mounted, phase } = useExitPresence(open, 150);
      return (
        <div>
          <button type="button" onClick={() => setOpen(false)}>
            close-menu
          </button>
          {mounted && (
            <div data-testid="exit-menu" data-phase={phase}>
              Menu Body
            </div>
          )}
        </div>
      );
    }

    render(<ExitHarness />);
    expect(screen.getByTestId('exit-menu').getAttribute('data-phase')).toBe('open');

    fireEvent.click(screen.getByText('close-menu'));
    // Still mounted during 150ms exit transition!
    expect(screen.getByTestId('exit-menu').getAttribute('data-phase')).toBe('closing');

    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(screen.queryByTestId('exit-menu')).toBeNull();
  });

  it('animates SolvaHeader Platform dropdown through .is-open -> .is-closing -> unmounted', () => {
    vi.useFakeTimers();

    const { container } = render(
      <MemoryRouter>
        <ThemeProvider>
          <CitraMotionProvider>
            <AuthProvider>
              <LandingPage />
            </AuthProvider>
          </CitraMotionProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    const trigger = screen.getAllByRole('button', { name: /Platform|Nền tảng/i })[0];
    fireEvent.click(trigger);

    const openDropdown = container.querySelector('.t-dropdown.is-open');
    expect(openDropdown).not.toBeNull();

    // Toggle closed -> enters .is-closing for 150ms instead of abrupt 0ms unmount
    fireEvent.click(trigger);
    expect(container.querySelector('.t-dropdown.is-closing')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(container.querySelector('.t-dropdown')).toBeNull();
  });

  it('closes SolvaHeader and PricingSolvaHeader Platform dropdown smoothly on Escape keydown', () => {
    vi.useFakeTimers();

    const { container, unmount } = render(
      <MemoryRouter>
        <ThemeProvider>
          <CitraMotionProvider>
            <AuthProvider>
              <LandingPage />
            </AuthProvider>
          </CitraMotionProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    const landingTrigger = screen.getAllByRole('button', { name: /Platform|Nền tảng/i })[0];
    fireEvent.click(landingTrigger);
    expect(container.querySelector('.t-dropdown.is-open')).not.toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(container.querySelector('.t-dropdown.is-closing')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(container.querySelector('.t-dropdown')).toBeNull();
    unmount();

    const pricingRender = render(
      <MemoryRouter initialEntries={['/pricing']}>
        <ThemeProvider>
          <CitraMotionProvider>
            <AuthProvider>
              <PricingPage />
            </AuthProvider>
          </CitraMotionProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    const pricingTrigger = screen.getAllByRole('button', { name: /Platform|Nền tảng/i })[0];
    fireEvent.click(pricingTrigger);
    expect(pricingRender.container.querySelector('.t-dropdown.is-open')).not.toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(pricingRender.container.querySelector('.t-dropdown.is-closing')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(pricingRender.container.querySelector('.t-dropdown')).toBeNull();
  });
});
