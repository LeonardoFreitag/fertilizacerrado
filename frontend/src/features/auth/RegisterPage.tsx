import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { FormError } from '@/components/states';
import { Button, FormField, Input, Select } from '@/components/ui';
import { applyFieldErrors, messageFor } from '@/lib/api/errors';
import type { RegisterPayload } from '@/lib/api/types';
import { register as registerUser } from '@/lib/auth/actions';
import { maskCnpj, maskCpf, maskPhone, onlyDigits } from '@/lib/validation/documents';
import { PASSWORD_RULES, registerSchema, type RegisterForm } from '@/lib/validation/schemas';
import { AuthLayout } from './AuthLayout';

export function PasswordRules({ value }: { value: string }) {
  return (
    <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs" aria-label="Regras da senha">
      {PASSWORD_RULES.map((rule) => {
        const ok = rule.test(value);
        return (
          <li key={rule.id} className={ok ? 'text-brand-700' : 'text-slate-500'}>
            <span aria-hidden="true">{ok ? '✓' : '○'}</span> {rule.label}
          </li>
        );
      })}
    </ul>
  );
}

export function toRegisterPayload(data: RegisterForm): RegisterPayload {
  return {
    name: data.name,
    email: data.email,
    password: data.password,
    role: data.role,
    personType: data.personType,
    cpf: data.personType === 'PF' && data.cpf ? onlyDigits(data.cpf) : undefined,
    cnpj: data.personType === 'PJ' && data.cnpj ? onlyDigits(data.cnpj) : undefined,
    crea: data.crea && data.crea.length > 0 ? data.crea : undefined,
    phone: data.phone && onlyDigits(data.phone).length > 0 ? onlyDigits(data.phone) : undefined,
  };
}

export function RegisterPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const { register, control, handleSubmit, watch, setError: setFieldError, formState } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { role: 'AGRONOMO', personType: 'PF', name: '', email: '', password: '', cpf: '', cnpj: '', crea: '', phone: '' },
  });
  const personType = watch('personType');
  const role = watch('role');
  const password = watch('password') ?? '';
  const errors = formState.errors;

  const onSubmit = handleSubmit(async (data) => {
    setError(null);
    try {
      await registerUser(toRegisterPayload(data));
      navigate('/verifique-seu-email', { replace: true, state: { email: data.email } });
    } catch (e) {
      if (!applyFieldErrors(e, setFieldError)) setError(messageFor(e));
    }
  });

  return (
    <AuthLayout
      title="Criar conta"
      subtitle="Agrônomos cadastram clientes e talhões; produtores acompanham suas propriedades."
      footer={
        <>
          Já tem conta?{' '}
          <Link to="/entrar" className="font-medium text-brand-700 hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormField label="Perfil" htmlFor="role" error={errors.role?.message} required>
          <Select id="role" invalid={!!errors.role} {...register('role')}>
            <option value="AGRONOMO">Agrônomo(a)</option>
            <option value="PRODUTOR">Produtor(a)</option>
          </Select>
        </FormField>
        <FormField label="Nome" htmlFor="name" error={errors.name?.message} required>
          <Input id="name" autoComplete="name" invalid={!!errors.name} {...register('name')} />
        </FormField>
        <FormField label="E-mail" htmlFor="email" error={errors.email?.message} required>
          <Input id="email" type="email" autoComplete="email" invalid={!!errors.email} {...register('email')} />
        </FormField>
        <FormField label="Senha" htmlFor="password" error={errors.password?.message} required>
          <Input id="password" type="password" autoComplete="new-password" invalid={!!errors.password} {...register('password')} />
          <PasswordRules value={password} />
        </FormField>

        <fieldset>
          <legend className="mb-1 block text-sm font-medium text-slate-700">Tipo de pessoa</legend>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" value="PF" {...register('personType')} /> Pessoa física (CPF)
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" value="PJ" {...register('personType')} /> Pessoa jurídica (CNPJ)
            </label>
          </div>
        </fieldset>

        {personType === 'PF' ? (
          <FormField label="CPF" htmlFor="cpf" error={errors.cpf?.message} required>
            <Controller
              control={control}
              name="cpf"
              render={({ field }) => (
                <Input id="cpf" inputMode="numeric" placeholder="000.000.000-00" invalid={!!errors.cpf} value={field.value ?? ''} onChange={(e) => field.onChange(maskCpf(e.target.value))} onBlur={field.onBlur} />
              )}
            />
          </FormField>
        ) : (
          <FormField label="CNPJ" htmlFor="cnpj" error={errors.cnpj?.message} required>
            <Controller
              control={control}
              name="cnpj"
              render={({ field }) => (
                <Input id="cnpj" inputMode="numeric" placeholder="00.000.000/0000-00" invalid={!!errors.cnpj} value={field.value ?? ''} onChange={(e) => field.onChange(maskCnpj(e.target.value))} onBlur={field.onBlur} />
              )}
            />
          </FormField>
        )}

        {role === 'AGRONOMO' && (
          <FormField label="CREA" htmlFor="crea" error={errors.crea?.message} help="Opcional. Registro profissional.">
            <Input id="crea" invalid={!!errors.crea} {...register('crea')} />
          </FormField>
        )}
        <FormField label="Telefone" htmlFor="phone" error={errors.phone?.message} help="Opcional.">
          <Controller
            control={control}
            name="phone"
            render={({ field }) => (
              <Input id="phone" inputMode="tel" placeholder="(62) 99999-9999" invalid={!!errors.phone} value={field.value ?? ''} onChange={(e) => field.onChange(maskPhone(e.target.value))} onBlur={field.onBlur} />
            )}
          />
        </FormField>

        <FormError message={error} />
        <Button type="submit" className="w-full" loading={formState.isSubmitting}>
          Criar conta
        </Button>
      </form>
    </AuthLayout>
  );
}
