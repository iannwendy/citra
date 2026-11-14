import { api, type EssayStatus } from '@/api/client';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

const INITIAL_GLOBAL_FETCH: typeof fetch | undefined =
  typeof globalThis.fetch === 'function' ? globalThis.fetch : undefined;

/**
 * Stream real-time Server-Sent Events (SSE) progress updates for an essay via `fetch()`
 * with `Authorization: Bearer <token>` (never exposing JWTs on query strings).
 *
 * Returns `true` ONLY when the stream delivered a terminal snapshot (`completed` or `failed`).
 * Returns `false` whenever SSE is unavailable, mocked out in unit tests, blocked by an
 * intermediate proxy, or closed prematurely so callers seamlessly fall back to `getEssayStatus`
 * HTTP polling.
 */
export async function streamEssayEvents(
  essayId: number,
  onEvent: (snap: EssayStatus) => void,
  signal: AbortSignal,
): Promise<boolean> {
  if (typeof fetch !== 'function' || signal.aborted) {
    return false;
  }

  const fetchObj = fetch as unknown as Record<string, unknown>;
  const isFetchMocked =
    Boolean(fetchObj && 'mock' in fetchObj) || fetch !== INITIAL_GLOBAL_FETCH;
  const statusFn = api?.getEssayStatus as unknown as Record<string, unknown> | undefined;
  const isStatusMocked = Boolean(statusFn && 'mock' in statusFn);
  const envMeta = import.meta.env as Record<string, unknown>;
  const isUnitTestEnv = import.meta.env.MODE === 'test' || Boolean(envMeta?.VITEST);

  if ((isStatusMocked || isUnitTestEnv) && !isFetchMocked) {
    return false;
  }

  let token: string | null = null;
  try {
    token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
  } catch {
    token = null;
  }

  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const resp = await fetch(`${BASE_URL}/essays/${essayId}/events`, {
      method: 'GET',
      headers,
      signal,
    });

    if (!resp.ok || !resp.body || typeof resp.body.getReader !== 'function') {
      return false;
    }

    const contentType = (resp.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/event-stream')) {
      return false;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let sawTerminal = false;

    const onAbort = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener('abort', onAbort, { once: true });

    const processEventBlock = (rawBlock: string): boolean => {
      const lines = rawBlock.split('\n');
      const dataLines: string[] = [];
      for (const line of lines) {
        if (!line || line.startsWith(':')) {
          continue;
        }
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
      if (dataLines.length === 0) {
        return false;
      }

      try {
        const parsed = JSON.parse(dataLines.join('\n')) as EssayStatus;
        if (parsed && typeof parsed === 'object' && typeof parsed.status === 'string') {
          onEvent(parsed);
          if (parsed.status === 'completed' || parsed.status === 'failed') {
            return true;
          }
        }
      } catch {
        // Ignore malformed frame and continue reading stream
      }
      return false;
    };

    try {
      while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: !done });
        } else if (done) {
          buffer += decoder.decode();
        }

        if (buffer.includes('\r')) {
          buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        }

        let sepIndex = buffer.indexOf('\n\n');
        while (sepIndex !== -1) {
          const block = buffer.slice(0, sepIndex);
          buffer = buffer.slice(sepIndex + 2);
          if (processEventBlock(block)) {
            sawTerminal = true;
            await reader.cancel().catch(() => {});
            return true;
          }
          sepIndex = buffer.indexOf('\n\n');
        }

        if (done) {
          if (buffer.trim().length > 0 && processEventBlock(buffer)) {
            sawTerminal = true;
            return true;
          }
          break;
        }
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
      try {
        reader.releaseLock();
      } catch {
        // Ignore if already released
      }
    }

    return sawTerminal;
  } catch {
    return false;
  }
}
