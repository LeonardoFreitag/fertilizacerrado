import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { FieldPayload, FieldResponse, PropertyResponse } from '@/lib/api/types';
import { propertyKeys } from '../properties/api';

export const fieldKeys = {
  byProperty: (propertyId: string) => ['fields', propertyId] as const,
  detail: (propertyId: string, id: string) => ['fields', propertyId, id] as const,
};

export function useFields(propertyId: string | undefined) {
  return useQuery({
    queryKey: fieldKeys.byProperty(propertyId ?? ''),
    queryFn: () => api<FieldResponse[]>(`/properties/${propertyId}/fields`),
    enabled: !!propertyId,
  });
}

/** Talhões de várias propriedades (página /talhoes): uma consulta por propriedade. */
export function useFieldsOfProperties(properties: PropertyResponse[] | undefined) {
  return useQueries({
    queries: (properties ?? []).map((p) => ({
      queryKey: fieldKeys.byProperty(p.id),
      queryFn: () => api<FieldResponse[]>(`/properties/${p.id}/fields`),
    })),
  });
}

export function useField(propertyId: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: fieldKeys.detail(propertyId ?? '', id ?? ''),
    queryFn: () => api<FieldResponse>(`/properties/${propertyId}/fields/${id}`),
    enabled: !!propertyId && !!id,
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>, propertyId: string) {
  void qc.invalidateQueries({ queryKey: fieldKeys.byProperty(propertyId) });
  void qc.invalidateQueries({ queryKey: propertyKeys.detail(propertyId) }); // fieldsCount
}

export function useCreateField(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: FieldPayload) => api<FieldResponse>(`/properties/${propertyId}/fields`, { method: 'POST', body: payload }),
    onSuccess: () => invalidate(qc, propertyId),
  });
}

export function useUpdateField(propertyId: string, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<FieldPayload>) => api<FieldResponse>(`/properties/${propertyId}/fields/${id}`, { method: 'PATCH', body: payload }),
    onSuccess: (data) => {
      qc.setQueryData(fieldKeys.detail(propertyId, id), data);
      invalidate(qc, propertyId);
    },
  });
}

export function useDeleteField(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/properties/${propertyId}/fields/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(qc, propertyId),
  });
}
