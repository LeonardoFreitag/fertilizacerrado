import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { PropertyPayload, PropertyResponse, Role, UserDirectoryEntry } from '@/lib/api/types';

export const propertyKeys = {
  all: ['properties'] as const,
  detail: (id: string) => ['properties', id] as const,
};

export function useProperties() {
  return useQuery({ queryKey: propertyKeys.all, queryFn: () => api<PropertyResponse[]>('/properties') });
}

export function useProperty(id: string | undefined) {
  return useQuery({
    queryKey: propertyKeys.detail(id ?? ''),
    queryFn: () => api<PropertyResponse>(`/properties/${id}`),
    enabled: !!id,
  });
}

export function useCreateProperty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: PropertyPayload) => api<PropertyResponse>('/properties', { method: 'POST', body: payload }),
    onSuccess: () => qc.invalidateQueries({ queryKey: propertyKeys.all }),
  });
}

export function useUpdateProperty(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<PropertyPayload>) => api<PropertyResponse>(`/properties/${id}`, { method: 'PATCH', body: payload }),
    onSuccess: (data) => {
      qc.setQueryData(propertyKeys.detail(id), data);
      void qc.invalidateQueries({ queryKey: propertyKeys.all });
    },
  });
}

export function useDeleteProperty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/properties/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: propertyKeys.all }),
  });
}

/** Diretório de usuários (produtor dono). Só consulta com termo ≥ 3 caracteres, exceto ADMIN. */
export function useUserSearch(q: string, role: Role | undefined, enabled: boolean) {
  const term = q.trim();
  return useQuery({
    queryKey: ['users', role ?? 'any', term],
    queryFn: () => api<UserDirectoryEntry[]>('/users', { query: { q: term || undefined, role, limit: 20 } }),
    enabled: enabled && (term.length >= 3 || term.length === 0),
    staleTime: 60_000,
  });
}
