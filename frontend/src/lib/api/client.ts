/**
 * Cliente HTTP da API. Regras:
 * - `Authorization: Bearer` quando há token em memória;
 * - `credentials: 'include'` só em /auth/* (o cookie de refresh é restrito a esse path);
 * - 401 fora de login/refresh/logout ⇒ um refresh compartilhado por todas as chamadas
 *   concorrentes, depois UMA repetição; falhou ⇒ sessão expirada.
 */
import { session } from '../auth/session';

const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
export const API_BASE = (configured && configured.length > 0 ? configured : '/api/v1').replace(/\/+$/, '');

/** Rotas em que um 401 é resposta final, nunca motivo para refresh. */
const NO_REFRESH_PATHS = ['/auth/login', '/auth/refresh', '/auth/logout'];

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, string[]>,
    /** Segundos até poder tentar de novo (header Retry-After do 429) */
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${API_BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') params.set(k, String(v));
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

function isAuthPath(path: string): boolean {
  return path.startsWith('/auth/');
}

async function send(path: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = session.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(buildUrl(path, opts.query), {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    credentials: isAuthPath(path) ? 'include' : 'same-origin',
    signal: opts.signal,
  });
}

async function toError(res: Response): Promise<ApiError> {
  let payload: { error?: string; code?: string; details?: Record<string, string[]> } = {};
  try {
    payload = (await res.json()) as typeof payload;
  } catch {
    // corpo vazio ou não-JSON (ex.: 502 do Nginx)
  }
  const retryHeader = res.headers.get('Retry-After');
  const retryAfter = retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) : undefined;
  return new ApiError(
    res.status,
    payload.code ?? (res.status === 429 ? 'TOO_MANY_REQUESTS' : 'HTTP_ERROR'),
    payload.error ?? `Erro ${res.status}`,
    payload.details,
    retryAfter,
  );
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

let refreshing: Promise<boolean> | null = null;

/** Um refresh por vez: chamadas concorrentes aguardam a mesma promessa. */
export function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = doRefresh().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

async function doRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } });
    if (!res.ok) return false;
    const data = (await res.json()) as { accessToken: string };
    session.setToken(data.accessToken);
    return true;
  } catch {
    return false;
  }
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await send(path, opts);
  if (res.status !== 401 || NO_REFRESH_PATHS.some((p) => path.startsWith(p))) return parse<T>(res);

  if (await refreshSession()) {
    const retry = await send(path, opts);
    if (retry.status !== 401) return parse<T>(retry);
    session.expire();
    throw await toError(retry);
  }
  session.expire();
  throw await toError(res);
}

/** Só para testes: zera a promessa de refresh em andamento. */
export function _resetClient(): void {
  refreshing = null;
}
