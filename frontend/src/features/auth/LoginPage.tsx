import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { FormError } from '@/components/states';
import { Button, FormField, Input } from '@/components/ui';
import { ApiError } from '@/lib/api/client';
import { formatRetryAfter, messageFor } from '@/lib/api/errors';
import { login, resendVerification } from '@/lib/auth/actions';
import { loginSchema, type LoginForm } from '@/lib/validation/schemas';
import { AuthLayout } from './AuthLayout';

/** Destino após o login: só caminhos internos (evita open redirect). */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/propriedades';
}

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [blockedUntil, setBlockedUntil] = useState<number | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resendState, setResendState] = useState<{ status: 'idle' | 'sending' | 'sent' | 'error'; message?: string }>({ status: 'idle' });
  const [now, setNow] = useState(Date.now());
  const { register, handleSubmit, formState } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  const remaining = blockedUntil ? Math.max(0, Math.ceil((blockedUntil - now) / 1000)) : 0;
  useEffect(() => {
    if (!blockedUntil) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [blockedUntil]);
  useEffect(() => {
    if (blockedUntil && remaining === 0) {
      setBlockedUntil(null);
      setError(null);
    }
  }, [blockedUntil, remaining]);

  async function handleResend() {
    if (!unverifiedEmail) return;
    setResendState({ status: 'sending' });
    try {
      await resendVerification(unverifiedEmail);
      setResendState({ status: 'sent', message: 'E-mail reenviado. Verifique sua caixa de entrada (e o spam).' });
    } catch (e) {
      setResendState({ status: 'error', message: messageFor(e) });
    }
  }

  const onSubmit = handleSubmit(async (data) => {
    setError(null);
    setUnverifiedEmail(null);
    setResendState({ status: 'idle' });
    try {
      await login(data.email, data.password);
      navigate(safeNext(params.get('next')), { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 429 && e.retryAfter) {
        setBlockedUntil(Date.now() + e.retryAfter * 1000);
      }
      if (e instanceof ApiError && e.code === 'EMAIL_NOT_VERIFIED') setUnverifiedEmail(data.email);
      setError(messageFor(e));
    }
  });

  return (
    <AuthLayout
      title="Entrar"
      subtitle="Acesse com seu e-mail e senha."
      footer={
        <>
          Não tem conta?{' '}
          <Link to="/cadastro" className="font-medium text-brand-700 hover:underline">
            Cadastre-se
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormField label="E-mail" htmlFor="email" error={formState.errors.email?.message} required>
          <Input id="email" type="email" autoComplete="email" autoFocus invalid={!!formState.errors.email} {...register('email')} />
        </FormField>
        <FormField label="Senha" htmlFor="password" error={formState.errors.password?.message} required>
          <Input id="password" type="password" autoComplete="current-password" invalid={!!formState.errors.password} {...register('password')} />
        </FormField>
        <FormError message={remaining > 0 && error ? `${error.split(' Tente')[0]} Tente novamente em ${formatRetryAfter(remaining)}.` : error} />
        {unverifiedEmail && (
          <div className="text-sm">
            {resendState.status === 'sent' ? (
              <p role="status" className="text-brand-800">{resendState.message}</p>
            ) : (
              <>
                <Button type="button" variant="secondary" size="sm" onClick={handleResend} loading={resendState.status === 'sending'}>
                  Reenviar e-mail de verificação
                </Button>
                {resendState.status === 'error' && <p role="alert" className="mt-1 text-xs text-red-700">{resendState.message}</p>}
              </>
            )}
          </div>
        )}
        <Button type="submit" className="w-full" loading={formState.isSubmitting} disabled={remaining > 0}>
          Entrar
        </Button>
        <div className="text-center text-sm">
          <Link to="/esqueci-senha" className="text-brand-700 hover:underline">
            Esqueci minha senha
          </Link>
        </div>
      </form>
    </AuthLayout>
  );
}
