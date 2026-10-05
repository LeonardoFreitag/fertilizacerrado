import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router';
import { FormError } from '@/components/states';
import { Button, FormField, Input, LinkButton } from '@/components/ui';
import { messageFor } from '@/lib/api/errors';
import { resetPassword } from '@/lib/auth/actions';
import { resetPasswordSchema, type ResetPasswordForm } from '@/lib/validation/schemas';
import { AuthLayout } from './AuthLayout';
import { PasswordRules } from './RegisterPage';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, watch, formState } = useForm<ResetPasswordForm>({ resolver: zodResolver(resetPasswordSchema), defaultValues: { password: '', confirm: '' } });

  const onSubmit = handleSubmit(async (data) => {
    setError(null);
    try {
      await resetPassword(token, data.password);
      setDone(true);
    } catch (e) {
      setError(messageFor(e));
    }
  });

  if (!token) {
    return (
      <AuthLayout title="Redefinir senha">
        <p role="alert" className="text-sm text-red-700">Link inválido: falta o token de redefinição.</p>
        <p className="mt-3 text-sm">
          <Link to="/esqueci-senha" className="text-brand-700 hover:underline">Solicitar um novo link</Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Redefinir senha" subtitle="Escolha uma nova senha para a sua conta.">
      {done ? (
        <div role="status">
          <p className="text-sm text-brand-800">Senha redefinida com sucesso. Sua sessão anterior foi encerrada.</p>
          <div className="mt-6">
            <LinkButton to="/entrar" className="w-full">
              Entrar
            </LinkButton>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <FormField label="Nova senha" htmlFor="password" error={formState.errors.password?.message} required>
            <Input id="password" type="password" autoComplete="new-password" autoFocus invalid={!!formState.errors.password} {...register('password')} />
            <PasswordRules value={watch('password') ?? ''} />
          </FormField>
          <FormField label="Confirmar senha" htmlFor="confirm" error={formState.errors.confirm?.message} required>
            <Input id="confirm" type="password" autoComplete="new-password" invalid={!!formState.errors.confirm} {...register('confirm')} />
          </FormField>
          <FormError message={error} />
          <Button type="submit" className="w-full" loading={formState.isSubmitting}>
            Redefinir senha
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
