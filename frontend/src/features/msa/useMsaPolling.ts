import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api/client';
import type { RunView } from '@/lib/api/types';
import { msaKeys } from './api';

export type PollingState = 'idle' | 'waiting' | 'done' | 'timeout' | 'error';

export interface PollingResult {
  state: PollingState;
  /** Run que encerrou a espera (qualquer status) */
  run: RunView | null;
  elapsedMs: number;
  error: unknown;
  stop: () => void;
}

export const DEFAULT_INTERVAL_MS = 3000;
export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/** Run concluída depois de `since` (ISO). */
export function findRunSince(runs: ReadonlyArray<RunView>, since: string): RunView | null {
  const t = new Date(since).getTime();
  return runs.find((r) => r.finishedAt && new Date(r.startedAt).getTime() >= t) ?? null;
}

/**
 * Acompanha um processamento disparado: consulta `GET /msa/runs` a cada `intervalMs`
 * até aparecer uma run iniciada em/após `since` (SUCCEEDED, NEEDS_DATA ou FAILED),
 * ou até `timeoutMs`. Ao concluir, invalida as consultas do MSA da safra.
 */
export function useMsaPolling(
  harvestId: string | undefined,
  since: string | null,
  options: { enabled?: boolean; intervalMs?: number; timeoutMs?: number } = {},
): PollingResult {
  const { enabled = true, intervalMs = DEFAULT_INTERVAL_MS, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const qc = useQueryClient();
  const [state, setState] = useState<PollingState>('idle');
  const [run, setRun] = useState<RunView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [elapsedMs, setElapsed] = useState(0);
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    if (!harvestId || !since || !enabled) {
      setState('idle');
      return;
    }
    setState('waiting');
    setRun(null);
    setError(null);
    const startedAt = Date.now();
    let timer: number | undefined;

    const tick = async () => {
      if (stopped.current) return;
      try {
        const runs = await api<RunView[]>(`/harvests/${harvestId}/msa/runs`);
        if (stopped.current) return;
        const found = findRunSince(runs, since);
        setElapsed(Date.now() - startedAt);
        if (found) {
          setRun(found);
          setState('done');
          void qc.invalidateQueries({ queryKey: msaKeys.all(harvestId) });
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          setState('timeout');
          return;
        }
      } catch (e) {
        if (stopped.current) return;
        setError(e);
        setState('error');
        return;
      }
      timer = window.setTimeout(tick, intervalMs);
    };
    void tick();

    return () => {
      stopped.current = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [harvestId, since, enabled, intervalMs, timeoutMs, qc]);

  return {
    state,
    run,
    elapsedMs,
    error,
    stop: () => {
      stopped.current = true;
      setState('idle');
    },
  };
}
