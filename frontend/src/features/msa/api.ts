import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { DailySeries, DecisionScenariosResponse, DecisionView, EnqueuedJob, JobView, MsaLatest, RecordDecisionPayload, RunView, YieldPhase } from '@/lib/api/types';

export const msaKeys = {
  all: (harvestId: string) => ['msa', harvestId] as const,
  latest: (harvestId: string) => ['msa', harvestId, 'latest'] as const,
  runs: (harvestId: string) => ['msa', harvestId, 'runs'] as const,
  daily: (harvestId: string, runId: string) => ['msa', harvestId, 'daily', runId] as const,
  decisions: (harvestId: string) => ['msa', harvestId, 'decisions'] as const,
  scenarios: (harvestId: string, p: DecisionParams) => ['msa', harvestId, 'scenarios', p.phase, p.doseBase, p.efficiencyBase, p.runId ?? 'latest'] as const,
};

export interface DecisionParams {
  phase: YieldPhase;
  doseBase: number;
  efficiencyBase: number;
  runId?: string;
}

/** Última run SUCCEEDED; 404 NO_MSA_RESULT é estado normal (sem retry). */
export function useMsaLatest(harvestId: string | undefined) {
  return useQuery({
    queryKey: msaKeys.latest(harvestId ?? ''),
    queryFn: () => api<MsaLatest>(`/harvests/${harvestId}/msa`),
    enabled: !!harvestId,
    retry: false,
  });
}

export function useMsaRuns(harvestId: string | undefined) {
  return useQuery({ queryKey: msaKeys.runs(harvestId ?? ''), queryFn: () => api<RunView[]>(`/harvests/${harvestId}/msa/runs`), enabled: !!harvestId });
}

export function useDailySeries(harvestId: string | undefined, runId: string | undefined) {
  return useQuery({
    queryKey: msaKeys.daily(harvestId ?? '', runId ?? ''),
    queryFn: () => api<DailySeries>(`/harvests/${harvestId}/msa/daily`, { query: { runId } }),
    enabled: !!harvestId && !!runId,
    staleTime: Infinity, // a série de uma run nunca muda
  });
}

export function useDecisionScenarios(harvestId: string | undefined, params: DecisionParams | null) {
  return useQuery({
    queryKey: msaKeys.scenarios(harvestId ?? '', params ?? { phase: 'F1', doseBase: 0, efficiencyBase: 0 }),
    queryFn: () =>
      api<DecisionScenariosResponse>(`/harvests/${harvestId}/msa/decision`, {
        query: { phase: params!.phase, doseBase: params!.doseBase, efficiencyBase: params!.efficiencyBase, runId: params!.runId },
      }),
    select: (d) => d.scenarios,
    enabled: !!harvestId && !!params,
    retry: false,
    placeholderData: (prev) => prev,
  });
}

export function useDecisions(harvestId: string | undefined) {
  return useQuery({ queryKey: msaKeys.decisions(harvestId ?? ''), queryFn: () => api<DecisionView[]>(`/harvests/${harvestId}/msa/decisions`), enabled: !!harvestId });
}

export function useRecordDecision(harvestId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: RecordDecisionPayload) => api<DecisionView>(`/harvests/${harvestId}/msa/decisions`, { method: 'POST', body: payload }),
    onSuccess: () => qc.invalidateQueries({ queryKey: msaKeys.decisions(harvestId) }),
  });
}

export function useProcessHarvest(harvestId: string) {
  return useMutation({
    mutationFn: (seed?: number) => api<EnqueuedJob>(`/harvests/${harvestId}/msa/process`, { method: 'POST', query: { seed } }),
  });
}

/** Estado de um job BullMQ (ADMIN). */
export function useJob(queue: string, jobId: string | undefined, options: { enabled?: boolean; refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: ['admin', 'job', queue, jobId ?? ''],
    queryFn: () => api<JobView>(`/admin/jobs/${queue}/${jobId}`),
    enabled: !!jobId && (options.enabled ?? true),
    refetchInterval: (q) => {
      const state = q.state.data?.state;
      if (state === 'completed' || state === 'failed') return false;
      return options.refetchInterval ?? 5000;
    },
    retry: false,
  });
}

export function useInvalidateMsa(harvestId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: msaKeys.all(harvestId) });
}
