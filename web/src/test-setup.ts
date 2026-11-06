// Vitest setup — runs before each test file.
// Auto-cleanup @testing-library/react side effects.
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom has no matchMedia; ThemeProvider and responsive hooks query it.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

afterEach(() => {
  cleanup();
  try {
    sessionStorage.clear();
  } catch {
    // Ignore if unavailable
  }
});
