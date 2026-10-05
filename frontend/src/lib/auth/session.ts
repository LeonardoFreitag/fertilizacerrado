/**
 * Sessão só em memória: access token e perfil. Nunca toca localStorage/sessionStorage.
 * Recarregar a página perde o token; `bootstrapSession` o restaura pelo cookie de refresh.
 */
import { useSyncExternalStore } from 'react';
import type { PublicUser } from '../api/types';

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

export interface SessionState {
  status: SessionStatus;
  user: PublicUser | null;
}

let accessToken: string | null = null;
let state: SessionState = { status: 'loading', user: null };

const listeners = new Set<() => void>();
const expiredListeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function setState(next: SessionState): void {
  state = next;
  emit();
}

export const session = {
  getToken: (): string | null => accessToken,
  getState: (): SessionState => state,

  /** Login ou restauração concluída. */
  setSession(token: string, user: PublicUser): void {
    accessToken = token;
    setState({ status: 'authenticated', user });
  },

  /** Refresh: só o token muda; o perfil permanece. */
  setToken(token: string): void {
    accessToken = token;
  },

  /** Logout, refresh falho ou bootstrap sem cookie. */
  clear(): void {
    accessToken = null;
    setState({ status: 'anonymous', user: null });
  },

  /** Sessão caiu no meio do uso: limpa e avisa (o roteador manda para /entrar?next=). */
  expire(): void {
    const wasAuthenticated = state.status === 'authenticated';
    this.clear();
    if (wasAuthenticated) for (const l of expiredListeners) l();
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  onExpired(listener: () => void): () => void {
    expiredListeners.add(listener);
    return () => expiredListeners.delete(listener);
  },

  /** Só para testes. */
  _reset(): void {
    accessToken = null;
    state = { status: 'loading', user: null };
    listeners.clear();
    expiredListeners.clear();
  },
};

export function useSession(): SessionState {
  return useSyncExternalStore(session.subscribe, session.getState, session.getState);
}
