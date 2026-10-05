import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router';
import { ErrorState, FormError, LoadingState } from '@/components/states';
import { useToast } from '@/components/toast';
import { Button, FormField, Input, PageHeader, Select } from '@/components/ui';
import { applyFieldErrors, messageFor } from '@/lib/api/errors';
import type { PropertyPayload, PropertyResponse, UserSummary } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { UFS, propertySchema, type PropertyForm } from '@/lib/validation/schemas';
import { UserPicker } from './UserPicker';
import { useCreateProperty, useProperty, useUpdateProperty } from './api';

function toFormValues(p?: PropertyResponse): PropertyForm {
  return { name: p?.name ?? '', state: (p?.state as PropertyForm['state']) ?? 'GO', city: p?.city ?? '', car: p?.car ?? '', nirf: p?.nirf ?? '', ownerId: p?.ownerId ?? '' };
}

/** Na edição, só os campos alterados (PATCH parcial). */
export function diffPayload(data: PropertyPayload, original: PropertyResponse): Partial<PropertyPayload> {
  const out: Partial<PropertyPayload> = {};
  if (data.name !== original.name) out.name = data.name;
  if (data.state !== original.state) out.state = data.state;
  if (data.city !== original.city) out.city = data.city;
  if ((data.car ?? undefined) !== (original.car ?? undefined)) out.car = data.car;
  if ((data.nirf ?? undefined) !== (original.nirf ?? undefined)) out.nirf = data.nirf;
  if (data.ownerId && data.ownerId !== original.ownerId) out.ownerId = data.ownerId;
  return out;
}

export function PropertyFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useSession();
  const isAdmin = user?.role === 'ADMIN';
  const existing = useProperty(id);
  const create = useCreateProperty();
  const update = useUpdateProperty(id ?? '');
  const [owner, setOwner] = useState<UserSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { register, handleSubmit, reset, setValue, setError: setFieldError, clearErrors, formState } = useForm<PropertyForm>({
    resolver: zodResolver(propertySchema),
    defaultValues: toFormValues(),
  });
  const errors = formState.errors;

  useEffect(() => {
    if (existing.data) {
      reset(toFormValues(existing.data));
      setOwner(existing.data.owner);
    }
  }, [existing.data, reset]);

  // O picker mostra o dono; o formulário guarda só o id.
  const showOwnerPicker = isAdmin || !editing;
  useEffect(() => {
    setValue('ownerId', owner?.id ?? '');
    if (owner) clearErrors('ownerId');
  }, [owner, setValue, clearErrors]);

  const onSubmit = handleSubmit(async (data) => {
    setError(null);
    if (isAdmin && !owner) {
      setFieldError('ownerId', { type: 'required', message: 'Informe o produtor dono' });
      return;
    }
    const payload: PropertyPayload = { name: data.name, state: data.state, city: data.city, car: data.car, nirf: data.nirf, ownerId: owner?.id };
    try {
      const saved = editing && existing.data ? await update.mutateAsync(diffPayload(payload, existing.data)) : await create.mutateAsync(payload);
      toast.success(editing ? 'Propriedade atualizada.' : 'Propriedade cadastrada.');
      navigate(`/propriedades/${saved.id}`, { replace: true });
    } catch (e) {
      if (!applyFieldErrors(e, setFieldError)) setError(messageFor(e));
    }
  });

  if (editing && existing.isPending) return <LoadingState />;
  if (editing && existing.isError) return <ErrorState error={existing.error} title="Propriedade não encontrada" onRetry={() => existing.refetch()} />;

  return (
    <div className="max-w-2xl">
      <PageHeader
        title={editing ? `Editar — ${existing.data?.name ?? ''}` : 'Nova propriedade'}
        backTo={{ to: editing ? `/propriedades/${id}` : '/propriedades', label: editing ? 'Propriedade' : 'Propriedades' }}
      />
      <form onSubmit={onSubmit} noValidate className="card space-y-4">
        <FormField label="Nome" htmlFor="name" error={errors.name?.message} required>
          <Input id="name" invalid={!!errors.name} {...register('name')} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
          <FormField label="UF" htmlFor="state" error={errors.state?.message} required>
            <Select id="state" invalid={!!errors.state} {...register('state')}>
              {UFS.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Município" htmlFor="city" error={errors.city?.message} required>
            <Input id="city" invalid={!!errors.city} {...register('city')} />
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="CAR" htmlFor="car" error={errors.car?.message} help="Cadastro Ambiental Rural (opcional)">
            <Input id="car" invalid={!!errors.car} {...register('car')} />
          </FormField>
          <FormField label="NIRF" htmlFor="nirf" error={errors.nirf?.message} help="Número do imóvel na Receita Federal (opcional)">
            <Input id="nirf" invalid={!!errors.nirf} {...register('nirf')} />
          </FormField>
        </div>

        {showOwnerPicker && (
          <FormField
            label="Produtor dono"
            htmlFor="ownerId"
            required={isAdmin}
            error={errors.ownerId?.message}
            help={isAdmin ? 'Pesquise o produtor pelo nome ou e-mail.' : 'Opcional. Sem produtor, você fica como dono da propriedade.'}
          >
            <UserPicker id="ownerId" role="PRODUTOR" value={owner} onChange={setOwner} allowEmptySearch={isAdmin} invalid={!!errors.ownerId} />
          </FormField>
        )}

        <FormError message={error} />
        <div className="flex gap-2">
          <Button type="submit" loading={formState.isSubmitting}>
            {editing ? 'Salvar alterações' : 'Cadastrar propriedade'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  );
}
