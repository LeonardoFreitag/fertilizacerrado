import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { HarvestPayload, HarvestResponse, HarvestStatus } from '@/lib/api/types';

export interface HarvestFilters {
  status?: HarvestStatus;
  fieldId?: string;
}

export const harvestKeys = {
  list: (f: HarvestFilters) => ['harvests', 'list', f.status ?? 'all', f.fieldId ?? 'all'] as const,
  detail: (id: string) => ['harvests', id] as const,
};

export function useHarvests(filters: HarvestFilters) {
  return useQuery({
    queryKey: harvestKeys.list(filters),
    queryFn: () => api<HarvestResponse[]>('/harvests', { query: { status: filters.status, fieldId: filters.fieldId } }),
  });
}

export function useHarvest(id: string | undefined) {
  return useQuery({ queryKey: harvestKeys.detail(id ?? ''), queryFn: () => api<HarvestResponse>(`/harvests/${id}`), enabled: !!id });
}

export function useCreateHarvest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: HarvestPayload) => api<HarvestResponse>('/harvests', { method: 'POST', body: payload }),
    onSuccess: (data) => {
      qc.setQueryData(harvestKeys.detail(data.id), data);
      void qc.invalidateQueries({ queryKey: ['harvests', 'list'] });
    },
  });
}

export function useUpdateHarvest(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { status?: HarvestStatus; notes?: string | null; season?: string }) => api<HarvestResponse>(`/harvests/${id}`, { method: 'PATCH', body: payload }),
    onSuccess: (data) => {
      qc.setQueryData(harvestKeys.detail(id), data);
      void qc.invalidateQueries({ queryKey: ['harvests', 'list'] });
    },
  });
}
