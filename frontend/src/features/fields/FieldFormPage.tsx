import { zodResolver } from '@hookform/resolvers/zod';
import type { Polygon } from 'geojson';
import { useEffect, useMemo, useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router';
import { ErrorState, FormError, LoadingState } from '@/components/states';
import { useToast } from '@/components/toast';
import { Button, FormField, Input, PageHeader, Textarea } from '@/components/ui';
import { ApiError } from '@/lib/api/client';
import { applyFieldErrors, messageFor } from '@/lib/api/errors';
import type { FieldPayload, FieldResponse } from '@/lib/api/types';
import { boundsCenter, boundsOfPolygons, polygonAreaHa, type BoundsTuple } from '@/lib/geo/geo';
import { SOIL_DEFAULTS, fieldSchema, type FieldForm } from '@/lib/validation/schemas';
import { useProperty } from '../properties/api';
import { useCreateField, useField, useFields, useUpdateField } from './api';
import { MapView } from './MapView';
import { PolygonEditor } from './PolygonEditor';

/** Valores do formulário são strings; o schema converte (vírgula decimal, vazio ⇒ undefined). */
interface FieldFormValues {
  name: string;
  soilType: string;
  notes: string;
  areaHa: string;
  altitudeM: string;
  thetaFC: string;
  thetaWP: string;
}

function toFormValues(field?: FieldResponse): FieldFormValues {
  return {
    name: field?.name ?? '',
    soilType: field?.soilType ?? '',
    notes: field?.notes ?? '',
    areaHa: field ? String(field.areaHa) : '',
    altitudeM: field?.altitudeM != null ? String(field.altitudeM) : '',
    thetaFC: field?.thetaFC != null ? String(field.thetaFC) : '',
    thetaWP: field?.thetaWP != null ? String(field.thetaWP) : '',
  };
}

/** Monta o corpo da requisição: só `areaHa` sobrescrita entra; na edição, só o que mudou. */
export function buildFieldPayload(data: FieldForm, geometry: Polygon | null, areaOverridden: boolean, original?: FieldResponse): FieldPayload {
  const full: FieldPayload = {
    name: data.name,
    soilType: data.soilType,
    notes: data.notes,
    altitudeM: data.altitudeM,
    thetaFC: data.thetaFC,
    thetaWP: data.thetaWP,
    ...(areaOverridden && data.areaHa != null ? { areaHa: data.areaHa } : {}),
    ...(geometry ? { geometry } : {}),
  };
  if (!original) return Object.fromEntries(Object.entries(full).filter(([, v]) => v !== undefined)) as unknown as FieldPayload;
  const changed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(full)) {
    if (v === undefined) continue;
    const before = (original as unknown as Record<string, unknown>)[k];
    if (k === 'geometry' ? JSON.stringify(v) !== JSON.stringify(before) : v !== (before ?? undefined)) changed[k] = v;
  }
  return changed as unknown as FieldPayload;
}

export function FieldFormPage() {
  const { id: propertyId = '', fieldId } = useParams();
  const editing = !!fieldId;
  const navigate = useNavigate();
  const toast = useToast();
  const property = useProperty(propertyId);
  const siblings = useFields(propertyId);
  const existing = useField(propertyId, fieldId);
  const create = useCreateField(propertyId);
  const update = useUpdateField(propertyId, fieldId ?? '');

  const [geometry, setGeometry] = useState<Polygon | null>(null);
  const [geometryError, setGeometryError] = useState<string | null>(null);
  const [areaOverridden, setAreaOverridden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // zodResolver v3 devolve os valores já transformados em runtime, mas tipa como a entrada: re-parse no submit.
  const form = useForm<FieldFormValues>({ resolver: zodResolver(fieldSchema) as unknown as Resolver<FieldFormValues>, defaultValues: toFormValues() });
  const { register, handleSubmit, setValue, reset, setError: setFieldError, formState } = form;
  const errors = formState.errors;

  useEffect(() => {
    if (existing.data) {
      reset(toFormValues(existing.data));
      setGeometry(existing.data.geometry);
      setAreaOverridden(false);
    }
  }, [existing.data, reset]);

  const computedArea = useMemo(() => (geometry ? polygonAreaHa(geometry) : null), [geometry]);
  useEffect(() => {
    if (!areaOverridden && computedArea != null) setValue('areaHa', computedArea.toFixed(2));
    if (!areaOverridden && computedArea == null && !editing) setValue('areaHa', '');
  }, [computedArea, areaOverridden, setValue, editing]);

  const initialBounds: BoundsTuple | null = useMemo(() => {
    if (existing.data) return boundsOfPolygons([existing.data.geometry]);
    return boundsOfPolygons((siblings.data ?? []).map((f) => f.geometry));
  }, [existing.data, siblings.data]);

  const onSubmit = handleSubmit(async (raw) => {
    setError(null);
    setGeometryError(null);
    if (!geometry) {
      setGeometryError('Desenhe o talhão no mapa.');
      return;
    }
    try {
      const data: FieldForm = fieldSchema.parse(raw);
      const payload = buildFieldPayload(data, geometry, areaOverridden, existing.data);
      const saved = editing ? await update.mutateAsync(payload) : await create.mutateAsync(payload);
      toast.success(editing ? 'Talhão atualizado.' : 'Talhão cadastrado.');
      navigate(`/propriedades/${propertyId}/talhoes/${saved.id}`, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'INVALID_GEOMETRY' || e.details?.geometry)) {
        setGeometryError(e.details?.geometry?.[0] ?? e.message);
        return;
      }
      if (!applyFieldErrors(e, setFieldError)) setError(messageFor(e));
    }
  });

  if (property.isPending || (editing && existing.isPending)) return <LoadingState />;
  if (property.isError) return <ErrorState error={property.error} onRetry={() => property.refetch()} />;
  if (editing && existing.isError) return <ErrorState error={existing.error} onRetry={() => existing.refetch()} />;

  const mapReady = editing ? !!existing.data : !siblings.isPending;

  return (
    <div>
      <PageHeader
        title={editing ? `Editar talhão${existing.data ? ` — ${existing.data.name}` : ''}` : 'Novo talhão'}
        subtitle={property.data?.name}
        backTo={{ to: editing ? `/propriedades/${propertyId}/talhoes/${fieldId}` : `/propriedades/${propertyId}`, label: editing ? 'Talhão' : property.data?.name ?? 'Propriedade' }}
      />
      <form onSubmit={onSubmit} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="space-y-2">
          <div className="relative">
            {mapReady && (
              <MapView className="h-[28rem]" center={initialBounds ? boundsCenter(initialBounds) : undefined} bounds={editing ? null : initialBounds}>
                <PolygonEditor value={existing.data?.geometry ?? null} onChange={setGeometry} />
              </MapView>
            )}
            {geometryError && (
              <div role="alert" className="absolute inset-x-3 bottom-3 z-[1000] rounded-md border border-red-300 bg-red-50/95 px-3 py-2 text-sm text-red-800 shadow">
                <strong>Geometria inválida:</strong> {geometryError}
              </div>
            )}
          </div>
          <p className="text-xs text-slate-500">
            Use as ferramentas à esquerda do mapa para desenhar o polígono ou um retângulo; edite os vértices, arraste ou remova. Troque para a imagem de satélite no canto superior direito.
          </p>
        </section>

        <section className="space-y-4">
          <FormField label="Nome" htmlFor="name" error={errors.name?.message} required>
            <Input id="name" invalid={!!errors.name} {...register('name')} />
          </FormField>

          <FormField
            label="Área (ha)"
            htmlFor="areaHa"
            error={errors.areaHa?.message}
            help={
              computedArea != null ? (
                <>
                  Calculada pelo polígono: <strong>{computedArea.toFixed(2)} ha</strong>
                  {areaOverridden && (
                    <>
                      {' · '}
                      <button type="button" className="text-brand-700 underline" onClick={() => setAreaOverridden(false)}>
                        usar a calculada
                      </button>
                    </>
                  )}
                </>
              ) : (
                'Preenchida automaticamente ao desenhar; pode ser ajustada.'
              )
            }
          >
            <Input id="areaHa" inputMode="decimal" invalid={!!errors.areaHa} {...register('areaHa', { onChange: () => setAreaOverridden(true) })} />
          </FormField>

          <FormField
            label="Altitude (m)"
            htmlFor="altitudeM"
            error={errors.altitudeM?.message}
            help={<span className="font-medium text-earth-600">Obrigatória para processar o MSA</span>}
          >
            <Input id="altitudeM" inputMode="decimal" invalid={!!errors.altitudeM} {...register('altitudeM')} />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="θFC (m³/m³)" htmlFor="thetaFC" error={errors.thetaFC?.message} help={`Capacidade de campo. Sugestão: ${SOIL_DEFAULTS.thetaFC}`}>
              <Input id="thetaFC" inputMode="decimal" placeholder={String(SOIL_DEFAULTS.thetaFC)} invalid={!!errors.thetaFC} {...register('thetaFC')} />
            </FormField>
            <FormField label="θWP (m³/m³)" htmlFor="thetaWP" error={errors.thetaWP?.message} help={`Ponto de murcha. Sugestão: ${SOIL_DEFAULTS.thetaWP}`}>
              <Input id="thetaWP" inputMode="decimal" placeholder={String(SOIL_DEFAULTS.thetaWP)} invalid={!!errors.thetaWP} {...register('thetaWP')} />
            </FormField>
          </div>
          <p className="-mt-2 text-xs text-slate-500">
            Umidade volumétrica do solo; θFC deve ser maior que θWP. Em branco, o MSA usa {SOIL_DEFAULTS.thetaFC}/{SOIL_DEFAULTS.thetaWP} (latossolo típico do Cerrado) e registra isso na run.
          </p>

          <FormField label="Tipo de solo" htmlFor="soilType" error={errors.soilType?.message}>
            <Input id="soilType" placeholder="ex.: Latossolo Vermelho" invalid={!!errors.soilType} {...register('soilType')} />
          </FormField>
          <FormField label="Observações" htmlFor="notes" error={errors.notes?.message}>
            <Textarea id="notes" invalid={!!errors.notes} {...register('notes')} />
          </FormField>

          <FormError message={error} />
          <div className="flex gap-2">
            <Button type="submit" loading={formState.isSubmitting}>
              {editing ? 'Salvar alterações' : 'Cadastrar talhão'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
              Cancelar
            </Button>
          </div>
        </section>
      </form>
    </div>
  );
}
