import { Navigate, Outlet, useLocation } from 'react-router';
import { LoadingState } from '@/components/states';
import type { Role } from '../api/types';
import { useSession } from './session';

export function loginPathWithNext(pathname: string, search: string): string {
  const next = `${pathname}${search}`;
  return next && next !== '/' ? `/entrar?next=${encodeURIComponent(next)}` : '/entrar';
}

/** Rota protegida: espera a restauração, redireciona anônimos para o login com `next`. */
export function RequireAuth() {
  const { status } = useSession();
  const location = useLocation();
  if (status === 'loading') return <LoadingState label="Restaurando sessão…" fullPage />;
  if (status === 'anonymous') return <Navigate to={loginPathWithNext(location.pathname, location.search)} replace />;
  return <Outlet />;
}

/** Restrição por role: mostra "Sem permissão" em vez de redirecionar. */
export function RequireRole({ roles }: { roles: Role[] }) {
  const { user } = useSession();
  if (!user || !roles.includes(user.role)) return <ForbiddenPage />;
  return <Outlet />;
}

/** Páginas públicas de autenticação: quem já tem sessão vai para o app. */
export function PublicOnly() {
  const { status } = useSession();
  if (status === 'loading') return <LoadingState label="Carregando…" fullPage />;
  if (status === 'authenticated') return <Navigate to="/propriedades" replace />;
  return <Outlet />;
}

export function ForbiddenPage() {
  return (
    <div className="mx-auto max-w-lg py-16 text-center" role="alert">
      <h1 className="text-2xl font-semibold text-slate-800">Sem permissão</h1>
      <p className="mt-2 text-slate-600">Seu perfil não tem acesso a esta área.</p>
    </div>
  );
}
