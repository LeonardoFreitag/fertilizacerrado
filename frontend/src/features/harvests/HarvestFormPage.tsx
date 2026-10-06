import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { FormError, LoadingState } from '@/components/states';
import { useToast } from '@/components/toast';
import { Button, FormField, Input, PageHeader, Select, Textarea } from '@/components/ui';
import { applyFieldErrors, messageFor } from '@/lib/api/errors';
import { CROP_LABELS } from '@/lib/api/types';
import { suggestSeason, todayIso } from '@/lib/msa/msa';
import { harvestSchema, type HarvestForm } from '@/lib/validation/harvest';
import { useCultivars } from '../cultivars/api';
import { useFieldsOfProperties } from '../fields/api';
import { useProperties } from '../properties/api';
import { useCreateHarvest } from './api';

export function HarvestFormPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const properties = useProperties();
  const fieldQueries = useFieldsOfProperties(properties.data);
  const cultivars = useCultivars();
  const create = useCreateHarvest();
  const [error, setError] = useState<string | null>(null);
  const [seasonTouched, setSeasonTouched] = useState(false);

  const { register, handleSubmit, watch, setValue, setError: setFieldError, formState } = useForm<HarvestForm>({
    resolver: zodResolver(harvestSchema),
    defaultValues: { fieldId: params.get('fieldId') ?? '', cultivarId: '', emergenceDate: '', season: '', notes: '' },
  });
  const errors = formState.errors;
  const emergenceDate = watch('emergenceDate');
  const fieldId = watch('fieldId');

  useEffect(() => {
    if (!seasonTouched && emergenceDate) setValue('season', suggestSeason(emergenceDate), { shouldValidate: formState.isSubmitted });
  }, [emergenceDate, seasonTouched, setValue, formState.isSubmitted]);

  const groups = useMemo(() => (properties.data ?? []).map((p, i) => ({ property: p, fields: fieldQueries[i]?.data ?? [] })), [properties.data, fieldQueries]);
  const selectedField = useMemo(() => groups.flatMap((g) => g.fields).find((f) => f.id === fieldId), [groups, fieldId]);
  const loading = properties.isPending || cultivars.isPending || fieldQueries.some((q) => q.isPending);

  const onSubmit = handleSubmit(async (data) => {
    setError(null);
    try {
      const saved = await create.mutateAsync({ fieldId: data.fieldId, cultivarId: data.cultivarId, emergenceDate: data.emergenceDate, season: data.season, notes: data.notes });
      toast.success('Safra cadastrada. O MSA foi enfileirado.');
      navigate(`/safras/${saved.id}`, { replace: true, state: { msaJobId: saved.msaJobId ?? null, createdAt: saved.createdAt } });
    } catch (e) {
      if (!applyFieldErrors(e, setFieldError)) setError(messageFor(e));
    }
  });

  if (loading) return <LoadingState />;

  const reference = (cultivars.data ?? []).filter((c) => c.isDefault);
  const mine = (cultivars.data ?? []).filter((c) => !c.isDefault);

  return (
    <div className="max-w-2xl">
      <PageHeader title="Nova safra" backTo={{ to: '/safras', label: 'Safras' }} />
      <form onSubmit={onSubmit} noValidate className="card space-y-4">
        <FormField label="Talhão" htmlFor="fieldId" error={errors.fieldId?.message} required>
          <Select id="fieldId" invalid={!!errors.fieldId} {...register('fieldId')}>
            <option value="">Escolha o talhão…</option>
            {groups.map((g) => (
              <optgroup key={g.property.id} label={g.property.name}>
                {g.fields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.areaHa.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ha){f.altitudeM == null ? ' — sem altitude' : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </FormField>
        {selectedField && selectedField.altitudeM == null && (
          <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Este talhão não tem altitude: o MSA não vai processar a safra até você informá-la.{' '}
            <Link to={`/propriedades/${selectedField.propertyId}/talhoes/${selectedField.id}/editar`} className="font-medium underline">
              Editar talhão
            </Link>
          </div>
        )}

        <FormField label="Cultivar" htmlFor="cultivarId" error={errors.cultivarId?.message} required>
          <Select id="cultivarId" invalid={!!errors.cultivarId} {...register('cultivarId')}>
            <option value="">Escolha a cultivar…</option>
            <optgroup label="Referência">
              {reference.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {CROP_LABELS[c.crop]}
                </option>
              ))}
            </optgroup>
            {mine.length > 0 && (
              <optgroup label="Próprias">
                {mine.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {CROP_LABELS[c.crop]}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Data de emergência" htmlFor="emergenceDate" error={errors.emergenceDate?.message} required help="Não pode ser futura.">
            <Input id="emergenceDate" type="date" max={todayIso()} invalid={!!errors.emergenceDate} {...register('emergenceDate')} />
          </FormField>
          <FormField label="Safra" htmlFor="season" error={errors.season?.message} required help="Sugerida pela emergência (AAAA/AA); pode ser ajustada.">
            <Input id="season" placeholder="2025/26" invalid={!!errors.season} {...register('season', { onChange: () => setSeasonTouched(true) })} />
          </FormField>
        </div>

        <FormField label="Notas" htmlFor="notes" error={errors.notes?.message}>
          <Textarea id="notes" invalid={!!errors.notes} {...register('notes')} />
        </FormField>

        <FormError message={error} />
        <div className="flex gap-2">
          <Button type="submit" loading={formState.isSubmitting}>
            Cadastrar safra
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate('/safras')}>
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  );
}
