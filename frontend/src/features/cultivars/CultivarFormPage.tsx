import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router';
import { ErrorState, FormError, LoadingState } from '@/components/states';
import { useToast } from '@/components/toast';
import { Button, FormField, Input, PageHeader, Select, Textarea } from '@/components/ui';
import { ApiError } from '@/lib/api/client';
import { applyFieldErrors, messageFor } from '@/lib/api/errors';
import { CULTIVAR_PARAM_KEYS, type CultivarParamKey, type CultivarPayload, type CultivarResponse } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { CULTIVAR_GROUPS, REFERENCE_NOTE, cultivarSchema, type CultivarForm } from '@/lib/validation/cultivar';
import { useCreateCultivar, useCultivar, useUpdateCultivar } from './api';

type FormValues = { name: string; crop: 'SOJA' | 'MILHO'; cycleDescription: string } & Record<CultivarParamKey, string>;

function toValues(c?: CultivarResponse): FormValues {
  const v = { name: c?.name ?? '', crop: c?.crop ?? 'SOJA', cycleDescription: c?.cycleDescription ?? '' } as FormValues;
  for (const k of CULTIVAR_PARAM_KEYS) v[k] = c ? String(c[k]) : '';
  return v;
}

/** Só o que mudou; parâmetros fora quando congelados. */
export function cultivarDiff(data: CultivarForm, original: CultivarResponse | undefined, frozen: boolean): CultivarPayload {
  const out: CultivarPayload = {};
  if (!original || data.name !== original.name) out.name = data.name;
  if (!original) out.crop = data.crop;
  if (!original || (data.cycleDescription ?? null) !== original.cycleDescription) out.cycleDescription = data.cycleDescription ?? (original ? null : undefined);
  if (!frozen) for (const k of CULTIVAR_PARAM_KEYS) if (!original || data[k] !== original[k]) out[k] = data[k];
  return out;
}

export function CultivarFormPage({ readOnly = false }: { readOnly?: boolean }) {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useSession();
  const existing = useCultivar(id);
  const create = useCreateCultivar();
  const update = useUpdateCultivar(id ?? '');
  const [frozen, setFrozen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { register, handleSubmit, reset, setError: setFieldError, formState } = useForm<FormValues>({
    resolver: zodResolver(cultivarSchema) as unknown as Resolver<FormValues>,
    defaultValues: toValues(),
  });
  const errors = formState.errors;

  useEffect(() => {
    if (existing.data) reset(toValues(existing.data));
  }, [existing.data, reset]);

  const isReference = !!existing.data?.isDefault;
  const locked = readOnly || isReference || !(user?.role === 'AGRONOMO' || user?.role === 'ADMIN');

  const onSubmit = handleSubmit(async (raw) => {
    setError(null);
    const data: CultivarForm = cultivarSchema.parse(raw);
    try {
      const payload = cultivarDiff(data, existing.data, frozen);
      const saved = editing ? await update.mutateAsync(payload) : await create.mutateAsync(payload);
      toast.success(editing ? 'Cultivar atualizada.' : 'Cultivar cadastrada.');
      navigate('/cultivares', { replace: true, state: { highlight: saved.id } });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CULTIVAR_IN_USE') {
        setFrozen(true);
        setError(null);
        return;
      }
      if (!applyFieldErrors(e, setFieldError)) setError(messageFor(e));
    }
  });

  if (editing && existing.isPending) return <LoadingState />;
  if (editing && existing.isError) return <ErrorState error={existing.error} title="Cultivar não encontrada" onRetry={() => existing.refetch()} />;

  const title = locked ? existing.data?.name ?? 'Cultivar' : editing ? `Editar — ${existing.data?.name ?? ''}` : 'Nova cultivar';

  return (
    <div className="max-w-3xl">
      <PageHeader title={title} subtitle={isReference ? REFERENCE_NOTE : undefined} backTo={{ to: '/cultivares', label: 'Cultivares' }} />
      <form onSubmit={onSubmit} noValidate className="space-y-6">
        <fieldset className="card space-y-4" disabled={locked}>
          <legend className="sr-only">Identificação</legend>
          <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
            <FormField label="Nome" htmlFor="name" error={errors.name?.message} required>
              <Input id="name" invalid={!!errors.name} {...register('name')} />
            </FormField>
            <FormField label="Cultura" htmlFor="crop" error={errors.crop?.message} required>
              <Select id="crop" invalid={!!errors.crop} disabled={locked || editing} {...register('crop')}>
                <option value="SOJA">Soja</option>
                <option value="MILHO">Milho</option>
              </Select>
            </FormField>
          </div>
          <FormField label="Descrição do ciclo" htmlFor="cycleDescription" error={errors.cycleDescription?.message} help="Opcional: grupo de maturação, duração típica, fonte dos parâmetros.">
            <Textarea id="cycleDescription" invalid={!!errors.cycleDescription} {...register('cycleDescription')} />
          </FormField>
        </fieldset>

        {frozen && (
          <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <strong>Parâmetros congelados</strong> porque há safras vinculadas a esta cultivar; apenas nome e descrição podem ser alterados. Clique em "Salvar nome e descrição" para enviar só esses campos.
          </div>
        )}

        {CULTIVAR_GROUPS.map((group) => (
          <fieldset key={group.title} className="card space-y-3" disabled={locked || frozen}>
            <legend className="px-1 text-sm font-semibold text-slate-800">{group.title}</legend>
            <p className="text-xs text-slate-500">{group.help}</p>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {group.fields.map((f) => (
                <FormField key={f.key} label={f.unit ? `${f.label} (${f.unit})` : f.label} htmlFor={f.key} error={errors[f.key]?.message} required={!locked}>
                  <Input id={f.key} inputMode="decimal" step={f.step} invalid={!!errors[f.key]} {...register(f.key)} />
                </FormField>
              ))}
            </div>
          </fieldset>
        ))}

        <FormError message={error} />
        {!locked && (
          <div className="flex gap-2">
            <Button type="submit" loading={formState.isSubmitting}>
              {frozen ? 'Salvar nome e descrição' : editing ? 'Salvar alterações' : 'Cadastrar cultivar'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => navigate('/cultivares')}>
              Cancelar
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
