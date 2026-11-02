import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router';
import { Modal } from '@/components/dialog';
import { ErrorState, FormError, LoadingState } from '@/components/states';
import { useToast } from '@/components/toast';
import { Button, FormField, Input, PageHeader, Textarea } from '@/components/ui';
import { applyFieldErrors, messageFor } from '@/lib/api/errors';
import { CULTIVAR_PARAM_KEYS, type CultivarParamKey, type CultivarPayload, type CultivarResponse, type SyncReferenceMode } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { divergenceLabel, divergentFields, fieldsToSync, toNumbers } from '@/lib/cultivars/reference';
import { formatNumber } from '@/lib/msa/msa';
import { CULTIVAR_GROUPS, REFERENCE_NOTE, cultivarSchema, type CultivarForm } from '@/lib/validation/cultivar';
import { useCreateCultivar, useCultivar, useReferenceCultivar, useSyncReference, useUpdateCultivar } from './api';

type FormValues = { name: string; cycleDescription: string } & Record<CultivarParamKey, string>;

/** Edição: valores da cultivar. Criação: nome vazio e parâmetros/descrição copiados da referência. */
function toValues(c?: CultivarResponse, reference?: CultivarResponse): FormValues {
  const source = c ?? reference;
  const v = { name: c?.name ?? '', cycleDescription: source?.cycleDescription ?? '' } as FormValues;
  for (const k of CULTIVAR_PARAM_KEYS) v[k] = source ? String(source[k]) : '';
  return v;
}

/** Só o que mudou em relação ao original (criação envia tudo, sem `crop`). */
export function cultivarDiff(data: CultivarForm, original: CultivarResponse | undefined): CultivarPayload {
  const out: CultivarPayload = {};
  if (!original || data.name !== original.name) out.name = data.name;
  if (!original || (data.cycleDescription ?? null) !== original.cycleDescription) out.cycleDescription = data.cycleDescription ?? (original ? null : undefined);
  for (const k of CULTIVAR_PARAM_KEYS) if (!original || data[k] !== original[k]) out[k] = data[k];
  return out;
}

const STEP_DIGITS: Record<string, number> = { '1': 0, '0.1': 1, '0.01': 2 };

export function CultivarFormPage({ readOnly = false }: { readOnly?: boolean }) {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useSession();
  const existing = useCultivar(id);
  const reference = useReferenceCultivar();
  const create = useCreateCultivar();
  const update = useUpdateCultivar(id ?? '');
  const sync = useSyncReference(id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncMode, setSyncMode] = useState<SyncReferenceMode>('unchanged');

  const { register, handleSubmit, reset, watch, setError: setFieldError, formState } = useForm<FormValues>({
    resolver: zodResolver(cultivarSchema) as unknown as Resolver<FormValues>,
    defaultValues: toValues(),
  });
  const errors = formState.errors;

  // Edição: carrega a cultivar. Criação: nasce como cópia da referência.
  useEffect(() => {
    if (editing && existing.data) reset(toValues(existing.data));
    else if (!editing && reference.data) reset(toValues(undefined, reference.data));
  }, [editing, existing.data, reference.data, reset]);

  const isReference = !!existing.data?.isDefault;
  const canManage = user?.role === 'AGRONOMO' || user?.role === 'ADMIN';
  const locked = readOnly || isReference || !canManage;

  // Divergência campo a campo contra a referência atual, em tempo real.
  const values = watch();
  const current = useMemo(() => toNumbers(values), [values]);
  const divergent = useMemo(() => (reference.data && !isReference ? new Set(divergentFields(current, reference.data)) : new Set<CultivarParamKey>()), [current, reference.data, isReference]);
  const toSync = useMemo(() => (reference.data && existing.data ? fieldsToSync(current, existing.data.referenceSnapshot, reference.data, syncMode) : []), [current, existing.data, reference.data, syncMode]);

  const onSubmit = handleSubmit(async (raw) => {
    setError(null);
    const data: CultivarForm = cultivarSchema.parse(raw);
    try {
      const payload = cultivarDiff(data, existing.data);
      const saved = editing ? await update.mutateAsync(payload) : await create.mutateAsync(payload);
      toast.success(editing ? 'Cultivar atualizada.' : 'Cultivar cadastrada.');
      navigate('/cultivares', { replace: true, state: { highlight: saved.id } });
    } catch (e) {
      if (!applyFieldErrors(e, setFieldError)) setError(messageFor(e));
    }
  });

  async function confirmSync() {
    try {
      const result = await sync.mutateAsync(syncMode);
      const { updatedFields, ...cultivar } = result;
      reset(toValues(cultivar));
      toast.success(updatedFields.length === 0 ? 'Nada a atualizar: a cultivar já segue a referência.' : `Atualizados a partir da referência: ${updatedFields.join(', ')}.`);
      setSyncOpen(false);
    } catch (e) {
      toast.error(messageFor(e));
    }
  }

  if (editing && existing.isPending) return <LoadingState />;
  if (editing && existing.isError) return <ErrorState error={existing.error} title="Cultivar não encontrada" onRetry={() => existing.refetch()} />;
  if (!editing && reference.isPending) return <LoadingState label="Carregando a cultivar de referência…" />;
  if (!editing && reference.isError) return <ErrorState error={reference.error} title="Referência indisponível" onRetry={() => reference.refetch()} />;

  const title = locked ? existing.data?.name ?? 'Cultivar' : editing ? `Editar — ${existing.data?.name ?? ''}` : 'Nova cultivar';
  const fmt = (k: CultivarParamKey, step?: string) => formatNumber(reference.data?.[k], STEP_DIGITS[step ?? '0.01'] ?? 2);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={title}
        subtitle={isReference ? REFERENCE_NOTE : reference.data && !editing ? 'Valores iniciais copiados da cultivar de referência; altere só o que conhece da sua cultivar.' : undefined}
        backTo={{ to: '/cultivares', label: 'Cultivares' }}
        actions={
          editing && !locked && (
            <Button type="button" variant="secondary" size="sm" onClick={() => setSyncOpen(true)} disabled={!reference.data}>
              Atualizar a partir da referência
            </Button>
          )
        }
      />

      {!isReference && reference.data && (
        <p className="mb-4 text-xs text-slate-600" data-testid="divergence-summary">
          <strong>{divergenceLabel(divergent.size)}</strong>
          {divergent.size > 0 && ` (${[...divergent].join(', ')})`}. Campos marcados mostram o valor de referência.
        </p>
      )}
      {editing && !locked && (
        <p className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700" data-testid="in-use-note">
          As execuções já calculadas guardam os parâmetros da época; as próximas usam os novos valores. O painel da safra avisa quando a cultivar mudou desde a última execução.
        </p>
      )}

      <form onSubmit={onSubmit} noValidate className="space-y-6">
        <fieldset className="card space-y-4" disabled={locked}>
          <legend className="sr-only">Identificação</legend>
          <FormField label="Nome" htmlFor="name" error={errors.name?.message} required>
            <Input id="name" invalid={!!errors.name} {...register('name')} />
          </FormField>
          <FormField label="Descrição do ciclo" htmlFor="cycleDescription" error={errors.cycleDescription?.message} help="Opcional: grupo de maturação, duração típica, fonte dos parâmetros.">
            <Textarea id="cycleDescription" invalid={!!errors.cycleDescription} {...register('cycleDescription')} />
          </FormField>
        </fieldset>

        {CULTIVAR_GROUPS.map((group) => (
          <fieldset key={group.title} className="card space-y-3" disabled={locked}>
            <legend className="px-1 text-sm font-semibold text-slate-800">{group.title}</legend>
            <p className="text-xs text-slate-500">{group.help}</p>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {group.fields.map((f) => {
                const diverges = divergent.has(f.key);
                return (
                  <div key={f.key} data-testid={`param-${f.key}`} data-divergent={diverges ? 'true' : undefined} className={diverges ? 'rounded-md ring-2 ring-amber-300 ring-offset-2' : undefined}>
                    <FormField
                      label={f.unit ? `${f.label} (${f.unit})` : f.label}
                      htmlFor={f.key}
                      error={errors[f.key]?.message}
                      required={!locked}
                      help={diverges ? `ref. ${fmt(f.key, f.step)}` : undefined}
                    >
                      <Input id={f.key} inputMode="decimal" step={f.step} invalid={!!errors[f.key]} {...register(f.key)} />
                    </FormField>
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}

        <FormError message={error} />
        {!locked && (
          <div className="flex gap-2">
            <Button type="submit" loading={formState.isSubmitting}>
              {editing ? 'Salvar alterações' : 'Cadastrar cultivar'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => navigate('/cultivares')}>
              Cancelar
            </Button>
          </div>
        )}
      </form>

      <Modal open={syncOpen} onClose={() => setSyncOpen(false)} title="Atualizar a partir da referência">
        <p className="text-sm text-slate-700">Substitui parâmetros desta cultivar pelos valores atuais da cultivar de referência. As execuções já calculadas não mudam.</p>
        <div className="mt-3 space-y-2 text-sm">
          <label className="flex items-start gap-2">
            <input type="radio" name="sync-mode" value="unchanged" checked={syncMode === 'unchanged'} onChange={() => setSyncMode('unchanged')} />
            <span>
              <strong>Só os campos que não alterei</strong> — mantém o que você mudou; atualiza o que ainda estava igual à referência da época.
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="sync-mode" value="all" checked={syncMode === 'all'} onChange={() => setSyncMode('all')} />
            <span>
              <strong>Todos os campos</strong> — a cultivar volta a ser uma cópia da referência (nome e descrição ficam).
            </span>
          </label>
        </div>
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs" data-testid="sync-preview">
          {toSync.length === 0 ? (
            <span className="text-slate-600">Nada a atualizar: os campos selecionados já seguem a referência.</span>
          ) : (
            <ul className="space-y-1">
              {toSync.map((k) => (
                <li key={k}>
                  <code>{k}</code>: {Number.isNaN(current[k]) ? '—' : formatNumber(current[k], 3)} → {formatNumber(reference.data?.[k], 3)}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setSyncOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={confirmSync} loading={sync.isPending}>
            Atualizar
          </Button>
        </div>
      </Modal>
    </div>
  );
}
