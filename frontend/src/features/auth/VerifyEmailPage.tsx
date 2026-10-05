import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router';
import { LoadingState } from '@/components/states';
import { LinkButton } from '@/components/ui';
import { messageFor } from '@/lib/api/errors';
import { verifyEmail } from '@/lib/auth/actions';
import { AuthLayout } from './AuthLayout';

/** Depois do cadastro: orienta a abrir o link recebido. */
export function VerifyEmailSentPage() {
  const email = (useLocation().state as { email?: string } | null)?.email;
  return (
    <AuthLayout title="Verifique seu e-mail" subtitle="Falta só confirmar o endereço.">
      <p className="text-sm text-slate-700">
        Enviamos um link de confirmação{email ? <> para <strong>{email}</strong></> : ''}. Abra-o para ativar sua conta — o link vale por 24 horas.
      </p>
      <p className="mt-3 text-sm text-slate-500">Não recebeu? Confira a pasta de spam. Se precisar, a opção "Esqueci minha senha" também confirma o e-mail ao concluir.</p>
      <div className="mt-6">
        <LinkButton to="/entrar" variant="secondary" className="w-full">
          Ir para o login
        </LinkButton>
      </div>
    </AuthLayout>
  );
}

/** Página aberta pelo link do e-mail: chama a API e mostra o resultado. */
export function VerifyEmailPage() {
  const { token = '' } = useParams();
  const query = useQuery({ queryKey: ['verify-email', token], queryFn: () => verifyEmail(token), retry: false });

  return (
    <AuthLayout title="Confirmação de e-mail">
      {query.isPending && <LoadingState label="Confirmando…" />}
      {query.isSuccess && (
        <div role="status">
          <p className="text-sm text-brand-800">E-mail verificado! Sua conta está ativa.</p>
          <div className="mt-6">
            <LinkButton to="/entrar" className="w-full">
              Ir para o login
            </LinkButton>
          </div>
        </div>
      )}
      {query.isError && (
        <div role="alert">
          <p className="text-sm text-red-700">{messageFor(query.error)}</p>
          <p className="mt-3 text-sm text-slate-600">
            Peça um novo link concluindo a <Link to="/esqueci-senha" className="text-brand-700 hover:underline">recuperação de senha</Link>, que também confirma o e-mail.
          </p>
        </div>
      )}
    </AuthLayout>
  );
}
