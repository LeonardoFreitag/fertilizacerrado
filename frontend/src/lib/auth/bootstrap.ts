import { api, refreshSession } from '../api/client';
import type { PublicUser } from '../api/types';
import { session } from './session';

/**
 * Restaura a sessão ao carregar a página: refresh pelo cookie → perfil.
 * Qualquer falha é silenciosa: o usuário simplesmente fica deslogado.
 */
export async function bootstrapSession(): Promise<void> {
  const refreshed = await refreshSession();
  if (!refreshed) {
    session.clear();
    return;
  }
  try {
    const user = await api<PublicUser>('/auth/me');
    const token = session.getToken();
    if (token) session.setSession(token, user);
    else session.clear();
  } catch {
    session.clear();
  }
}
