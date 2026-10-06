import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunView } from '@/lib/api/types';
import { session } from '@/lib/auth/session';
import { findRunSince, useMsaPolling } from './useMsaPolling';

const run = (startedAt: string, status: RunView['status'] = 'SUCCEEDED'): RunView =>
  ({ id: `r-${startedAt}`, harvestId: 'h', status, reason: 'BACKFILL', jobId: null, startedAt, finishedAt: startedAt, dateFrom: '2025-11-01', dateTo: '2026-03-01', seed: 1, iterations: 1000, sigmaPrecip: 0.3, sigmaTemp: 0.6, engineVersion: '1.0.0', cultivarSnapshot: {}, soilSnapshot: {}, missingDates: null, error: null, triggeredById: null }) as RunView;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

afterEach(() => vi.unstubAllGlobals());

describe('findRunSince', () => {
  it('ignora runs anteriores ao disparo', () => {
    const runs = [run('2026-10-05T10:00:00Z'), run('2026-10-05T09:00:00Z')];
    expect(findRunSince(runs, '2026-10-05T09:30:00Z')?.id).toBe('r-2026-10-05T10:00:00Z');
    expect(findRunSince(runs, '2026-10-05T11:00:00Z')).toBeNull();
  });
});

describe('useMsaPolling', () => {
  it('continua enquanto não há run nova e para ao encontrá-la (qualquer status)', async () => {
    session.setSession('t', { id: 'u', name: 'Ana', email: 'a@b', role: 'AGRONOMO' });
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        const body = calls < 3 ? [run('2026-10-01T00:00:00Z')] : [run('2026-10-05T12:00:05Z', 'NEEDS_DATA'), run('2026-10-01T00:00:00Z')];
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    const { result } = renderHook(() => useMsaPolling('h', '2026-10-05T12:00:00Z', { intervalMs: 10 }), { wrapper });
    expect(result.current.state).toBe('waiting');
    await waitFor(() => expect(result.current.state).toBe('done'));
    expect(calls).toBe(3);
    expect(result.current.run?.status).toBe('NEEDS_DATA');
  });

  it('expira pelo timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const { result } = renderHook(() => useMsaPolling('h', '2026-10-05T12:00:00Z', { intervalMs: 5, timeoutMs: 30 }), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('timeout'));
  });

  it('fica idle sem `since`', () => {
    vi.stubGlobal('fetch', vi.fn());
    const { result } = renderHook(() => useMsaPolling('h', null), { wrapper });
    expect(result.current.state).toBe('idle');
    expect(fetch).not.toHaveBeenCalled();
  });
});
