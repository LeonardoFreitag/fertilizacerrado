import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { FormError } from '@/components/states';
import { Button, FormField, Input } from '@/components/ui';
import { messageFor } from '@/lib/api/errors';
import { forgotPassword } from '@/lib/auth/actions';
import { forgotPasswordSchema, type ForgotPasswordForm } from '@/lib/validation/schemas';
import { AuthLayout } from './AuthLayout';

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<ForgotPasswordForm>({ resolver: zodResolver(forgotPasswordSchema) });

  const onSubmit = handleSubmit(async (data) => {
    setError(null);
    try {
      await forgotPassword(data.email);
      setSent(true);
    } catch (e) {
      setError(messageFor(e));
    }
  });

  return (
    <AuthLayout
      title="Recuperar senha"
      subtitle="Informe o e-mail da conta; se ele existir, enviaremos um link válido por 1 hora."
      footer={
        <Link to="/entrar" className="font-medium text-brand-700 hover:underline">
          Voltar ao login
        </Link>
      }
    >
      {sent ? (
        <p role="status" className="text-sm text-slate-700">
          Se houver uma conta com este e-mail, você receberá o link de redefinição em instantes.
        </p>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <FormField label="E-mail" htmlFor="email" error={formState.errors.email?.message} required>
            <Input id="email" type="email" autoComplete="email" autoFocus invalid={!!formState.errors.email} {...register('email')} />
          </FormField>
          <FormError message={error} />
          <Button type="submit" className="w-full" loading={formState.isSubmitting}>
            Enviar link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
