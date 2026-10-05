import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from '../auth/session';
import { ApiError, _resetClient, api } from './client';

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

/** Responde na ordem da fila; cada entrada pode ser uma função para respostas condicionais. */
function mockFetch(handler: (call: Call, index: number) => Response | Promise<Response>) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call = { url, init };
      calls.push(call);
      return handler(call, calls.length - 1);
    }),
  );
}

const authHeader = (c: Call) => (c.init.headers as Record<string, string>).Authorization;

beforeEach(() => {
  session._reset();
  _resetClient();
});
afterEach(() => vi.unstubAllGlobals());

describe('cliente HTTP', () => {
  it('envia Bearer e não usa credentials fora de /auth', async () => {
    session.setSession('tok1', { id: 'u', name: 'Ana', email: 'a@b', role: 'AGRONOMO' });
    mockFetch(() => json(200, [{ id: 'p1' }]));
    const data = await api<{ id: string }[]>('/properties');
    expect(data[0]?.id).toBe('p1');
    expect(calls[0]?.url).toBe('/api/v1/properties');
    expect(authHeader(calls[0]!)).toBe('Bearer tok1');
    expect(calls[0]?.init.credentials).toBe('same-origin');
  });

  it('usa credentials: include em /auth/*', async () => {
    mockFetch(() => json(200, { accessToken: 't', user: {} }));
    await api('/auth/login', { method: 'POST', body: { email: 'a', password: 'b' } });
    expect(calls[0]?.init.credentials).toBe('include');
  });

  it('401 → refresh → repete com o novo token', async () => {
    session.setSession('velho', { id: 'u', name: 'Ana', email: 'a@b', role: 'AGRONOMO' });
    mockFetch((c, i) => {
      if (i === 0) return json(401, { code: 'UNAUTHORIZED', error: 'expirado' });
      if (c.url.endsWith('/auth/refresh')) return json(200, { accessToken: 'novo' });
      return json(200, { ok: true });
    });
    const data = await api<{ ok: boolean }>('/properties');
    expect(data.ok).toBe(true);
    expect(calls.map((c) => c.url)).toEqual(['/api/v1/properties', '/api/v1/auth/refresh', '/api/v1/properties']);
    expect(authHeader(calls[2]!)).toBe('Bearer novo');
    expect(session.getState().status).toBe('authenticated');
  });

  it('refresh falho → sessão expirada e evento emitido', async () => {
    session.setSession('velho', { id: 'u', name: 'Ana', email: 'a@b', role: 'AGRONOMO' });
    const expired = vi.fn();
    session.onExpired(expired);
    mockFetch((c) => (c.url.endsWith('/auth/refresh') ? json(401, { code: 'INVALID_REFRESH_TOKEN' }) : json(401, { code: 'UNAUTHORIZED' })));
    await expect(api('/properties')).rejects.toBeInstanceOf(ApiError);
    expect(session.getState().status).toBe('anonymous');
    expect(session.getToken()).toBeNull();
    expect(expired).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2); // sem segunda repetição
  });

  it('segundo 401 após refresh válido → expira sem laço', async () => {
    session.setSession('velho', { id: 'u', name: 'Ana', email: 'a@b', role: 'AGRONOMO' });
    mockFetch((c) => (c.url.endsWith('/auth/refresh') ? json(200, { accessToken: 'novo' }) : json(401, { code: 'UNAUTHORIZED' })));
    await expect(api('/properties')).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(3);
    expect(session.getState().status).toBe('anonymous');
  });

  it('três chamadas concorrentes com 401 fazem um único refresh', async () => {
    session.setSession('velho', { id: 'u', name: 'Ana', email: 'a@b', role: 'AGRONOMO' });
    mockFetch((c) => {
      if (c.url.endsWith('/auth/refresh')) return json(200, { accessToken: 'novo' });
      return authHeader(c) === 'Bearer novo' ? json(200, { ok: true }) : json(401, { code: 'UNAUTHORIZED' });
    });
    const results = await Promise.all([api('/properties'), api('/properties/1'), api('/cultivars')]);
    expect(results).toHaveLength(3);
    expect(calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(1);
    expect(calls.filter((c) => authHeader(c) === 'Bearer novo')).toHaveLength(3);
  });

  it('401 no login não dispara refresh', async () => {
    mockFetch(() => json(401, { code: 'INVALID_CREDENTIALS', error: 'E-mail ou senha inválidos.' }));
    await expect(api('/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(calls).toHaveLength(1);
  });

  it('429 expõe Retry-After e 204 devolve undefined', async () => {
    mockFetch((c) => (c.url.endsWith('/auth/login') ? json(429, { code: 'TOO_MANY_LOGIN_ATTEMPTS' }, { 'Retry-After': '900' }) : new Response(null, { status: 204 })));
    await expect(api('/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 429, retryAfter: 900 });
    expect(await api('/auth/logout', { method: 'POST' })).toBeUndefined();
  });

  it('query string omite vazios', async () => {
    mockFetch(() => json(200, []));
    await api('/users', { query: { q: 'ped', role: undefined, limit: 20 } });
    expect(calls[0]?.url).toBe('/api/v1/users?q=ped&limit=20');
  });
});
