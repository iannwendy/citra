import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const CHUNK_RELOAD_STORAGE_KEY = 'citra_chunk_reload_state';
const CHUNK_RELOAD_COOLDOWN_MS = 15_000;

interface ChunkReloadState {
  path: string;
  timestamp: number;
}

const CHUNK_ERROR_PATTERNS: RegExp[] = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS/i,
  /Loading chunk [\w-]+ failed/i,
  /Loading CSS chunk [\w-]+ failed/i,
  /ChunkLoadError/i,
];

/**
 * Returns true if the error looks like a Vite/Rollup dynamic import or chunk fetch failure
 * (e.g. when a new deployment replaces hashed asset files while a user has an older tab open).
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === 'string'
        ? error
        : String(error);

  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Clears any recorded chunk reload state after a dynamic route loads cleanly.
 */
export function clearChunkReloadState(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(CHUNK_RELOAD_STORAGE_KEY);
  } catch {
    // Ignore storage access errors in restricted/incognito contexts
  }
}

/**
 * Attempts a single hard page reload for the current pathname so the browser
 * fetches the latest `index.html` and updated chunk hashes after a deployment.
 * Returns `true` if a reload was initiated, or `false` if a reload already
 * occurred within the cooldown window (preventing infinite reload loops).
 */
export function attemptChunkReload(now: number = Date.now()): boolean {
  if (typeof window === 'undefined') return false;

  const currentPath = window.location?.pathname || '/';
  try {
    const raw = window.sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ChunkReloadState>;
      if (
        parsed.path === currentPath &&
        typeof parsed.timestamp === 'number' &&
        now - parsed.timestamp < CHUNK_RELOAD_COOLDOWN_MS
      ) {
        return false;
      }
    }
    const nextState: ChunkReloadState = { path: currentPath, timestamp: now };
    window.sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, JSON.stringify(nextState));
  } catch {
    // If sessionStorage is unavailable, do not risk an unguarded reload loop
    return false;
  }

  window.location.reload();
  return true;
}

/**
 * Wraps `React.lazy` with:
 * 1. Automatic retry for transient network hiccups when fetching a route chunk.
 * 2. One-shot guarded page reload (`window.location.reload()`) if the chunk hash
 *    no longer exists on the server due to a fresh deployment, keeping `<Suspense>`
 *    on the skeleton fallback while the browser reloads so no error screen flashes.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
  retries = 1,
  retryDelayMs = 250,
): LazyExoticComponent<T> {
  return lazy(async () => {
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const mod = await importer();
        clearChunkReloadState();
        return mod;
      } catch (err) {
        lastError = err;
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
      }
    }

    if (isChunkLoadError(lastError) && attemptChunkReload()) {
      // Keep Suspense fallback mounted while the browser reloads the page
      return new Promise<never>(() => {});
    }

    throw lastError;
  });
}

let preloadHandlerInstalled = false;

/**
 * Installs Vite's global `vite:preloadError` listener to recover when
 * `<link rel="modulepreload">` sub-chunks or CSS files fail after a deploy.
 */
export function installChunkErrorHandlers(): void {
  if (typeof window === 'undefined' || preloadHandlerInstalled) return;
  preloadHandlerInstalled = true;

  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    attemptChunkReload();
  });
}
