import { api } from '../api/client';
import type { LoginResponse, PublicUser, RegisterPayload } from '../api/types';
import { session } from './session';

export async function login(email: string, password: string): Promise<PublicUser> {
  const data = await api<LoginResponse>('/auth/login', { method: 'POST', body: { email, password } });
  session.setSession(data.accessToken, data.user);
  return data.user;
}

export async function logout(): Promise<void> {
  try {
    await api<void>('/auth/logout', { method: 'POST' });
  } catch {
    // o servidor pode já ter invalidado o refresh; a sessão local é limpa de qualquer forma
  } finally {
    session.clear();
  }
}

export function register(payload: RegisterPayload): Promise<{ user: PublicUser; message: string }> {
  return api('/auth/register', { method: 'POST', body: payload });
}

export function verifyEmail(token: string): Promise<{ message: string }> {
  return api(`/auth/verify-email/${encodeURIComponent(token)}`);
}

export function resendVerification(email: string): Promise<{ message: string }> {
  return api('/auth/resend-verification', { method: 'POST', body: { email } });
}

export function forgotPassword(email: string): Promise<{ message: string }> {
  return api('/auth/forgot-password', { method: 'POST', body: { email } });
}

export function resetPassword(token: string, password: string): Promise<{ message: string }> {
  return api('/auth/reset-password', { method: 'POST', body: { token, password } });
}
