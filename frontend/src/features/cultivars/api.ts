import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { CultivarPayload, CultivarResponse } from '@/lib/api/types';

export const cultivarKeys = { all: ['cultivars'] as const, detail: (id: string) => ['cultivars', id] as const };

export function useCultivars() {
  return useQuery({ queryKey: cultivarKeys.all, queryFn: () => api<CultivarResponse[]>('/cultivars') });
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

export function useDeleteCultivar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/cultivars/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: cultivarKeys.all }),
  });
}
