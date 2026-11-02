import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { CultivarPayload, CultivarResponse, SyncReferenceMode, SyncReferenceResponse } from '@/lib/api/types';

export const cultivarKeys = {
  all: ['cultivars'] as const,
  reference: ['cultivars', 'reference'] as const,
  detail: (id: string) => ['cultivars', id] as const,
};

export function useCultivars() {
  return useQuery({ queryKey: cultivarKeys.all, queryFn: () => api<CultivarResponse[]>('/cultivars') });
}

/** Referência de soja (seed): base de toda cultivar nova e da marcação de divergência. */
export function useReferenceCultivar() {
  return useQuery({ queryKey: cultivarKeys.reference, queryFn: () => api<CultivarResponse>('/cultivars/reference'), staleTime: 5 * 60_000 });
}

export function useCultivar(id: string | undefined) {
  return useQuery({ queryKey: cultivarKeys.detail(id ?? ''), queryFn: () => api<CultivarResponse>(`/cultivars/${id}`), enabled: !!id });
}

export function useCreateCultivar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CultivarPayload) => api<CultivarResponse>('/cultivars', { method: 'POST', body: payload }),
    onSuccess: () => qc.invalidateQueries({ queryKey: cultivarKeys.all }),
  });
}

export function useUpdateCultivar(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CultivarPayload) => api<CultivarResponse>(`/cultivars/${id}`, { method: 'PATCH', body: payload }),
    onSuccess: (data) => {
      qc.setQueryData(cultivarKeys.detail(id), data);
      void qc.invalidateQueries({ queryKey: cultivarKeys.all });
    },
  });
}

export function useSyncReference(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mode: SyncReferenceMode) => api<SyncReferenceResponse>(`/cultivars/${id}/sync-reference`, { method: 'POST', body: { mode } }),
    onSuccess: ({ updatedFields: _u, ...cultivar }) => {
      qc.setQueryData(cultivarKeys.detail(id), cultivar);
      void qc.invalidateQueries({ queryKey: cultivarKeys.all });
    },
  });
}

export function useDeleteCultivar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/cultivars/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: cultivarKeys.all }),
  });
}
