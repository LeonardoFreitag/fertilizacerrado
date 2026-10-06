/**
 * Módulo de usuários: admin desativa um agrônomo → login dele falha com a mensagem →
 * reativa → login ok; troca de senha no /perfil → login com a nova.
 * Pré-requisitos: stack de dev no ar; ADMIN_EMAIL/ADMIN_PASSWORD no .env da raiz.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const API = (process.env.E2E_BASE_URL ?? 'http://localhost') + '/api/v1';
const stamp = Date.now();
const EMAIL = `users-${stamp}@fc.local`;
const PASSWORD = 'MinhaS3nha!';
const NEW_PASSWORD = 'OutraS3nha!';

function randomCpf(seed: number): string {
  const base = String(seed).padStart(9, '0').slice(-9).split('').map(Number);
  const dv = (digits: number[], start: number) => {
    const sum = digits.reduce((acc, d, i) => acc + d * (start - i), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const d1 = dv(base, 10);
  const d2 = dv([...base, d1], 11);
  return [...base, d1, d2].join('');
}

function lastVerificationToken(): string {
  const logs = execSync('docker compose logs --no-log-prefix api', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const matches = logs.match(/verificar-email\/([A-Za-z0-9._-]+)/g) ?? [];
  const last = matches[matches.length - 1];
  if (!last) throw new Error('link de verificação não encontrado no log da API');
  return last.replace('verificar-email/', '');
}

async function seedAgronomist(): Promise<void> {
  const res = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Agrônomo Teste Usuários', email: EMAIL, password: PASSWORD, role: 'AGRONOMO', personType: 'PF', cpf: randomCpf(stamp) }),
  });
  if (!res.ok) throw new Error(`register → ${res.status}`);
  await new Promise((r) => setTimeout(r, 500));
  const verify = await fetch(`${API}/auth/verify-email/${lastVerificationToken()}`);
  if (!verify.ok) throw new Error(`verify → ${verify.status}`);
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/entrar');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

async function logout(page: Page) {
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/entrar/);
}

function adminCredentials(): { email: string; password: string } {
  const env = readFileSync(`${ROOT}/.env`, 'utf8');
  const get = (k: string) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim() ?? '';
  return { email: get('ADMIN_EMAIL'), password: get('ADMIN_PASSWORD') };
}

test.describe.configure({ mode: 'serial' });

test('admin desativa, agrônomo não entra, admin reativa, agrônomo entra', async ({ page }) => {
  const admin = adminCredentials();
  test.skip(!admin.email || !admin.password, 'ADMIN_EMAIL/ADMIN_PASSWORD ausentes no .env');
  await seedAgronomist();

  await login(page, admin.email, admin.password);
  await expect(page).toHaveURL(/\/propriedades$/);
  await page.getByRole('link', { name: 'Usuários' }).click();
  await expect(page.getByRole('heading', { name: 'Usuários' })).toBeVisible();
  await page.locator('#u-q').fill(EMAIL);
  const row = page.getByTestId(`user-row-${EMAIL}`);
  await expect(row).toBeVisible();
  await expect(row.getByText('ativo', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Desativar' }).click();
  await page.getByRole('button', { name: 'Desativar', exact: true }).last().click();
  await expect(row.getByText('inativo', { exact: true })).toBeVisible();
  await logout(page);

  await login(page, EMAIL, PASSWORD);
  await expect(page.getByRole('alert')).toContainText('Sua conta está desativada');

  await login(page, admin.email, admin.password);
  await page.getByRole('link', { name: 'Usuários' }).click();
  await page.locator('#u-q').fill(EMAIL);
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Reativar' }).click();
  await page.getByRole('button', { name: 'Reativar', exact: true }).last().click();
  await expect(row.getByText('ativo', { exact: true })).toBeVisible();
  await logout(page);

  await login(page, EMAIL, PASSWORD);
  await expect(page).toHaveURL(/\/propriedades$/);
  await logout(page);
});

test('troca de senha no perfil', async ({ page }) => {
  await login(page, EMAIL, PASSWORD);
  await expect(page).toHaveURL(/\/propriedades$/);
  await page.getByRole('link', { name: 'Agrônomo Teste Usuários' }).click();
  await expect(page.getByRole('heading', { name: 'Meu perfil' })).toBeVisible();
  await expect(page.getByText('e-mail verificado')).toBeVisible();
  await page.locator('#pw-current').fill(PASSWORD);
  await page.locator('#pw-next').fill(NEW_PASSWORD);
  await page.locator('#pw-confirm').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Alterar senha' }).click();
  await expect(page.getByText('Senha alterada com sucesso.')).toBeVisible();
  await logout(page);

  await login(page, EMAIL, PASSWORD);
  await expect(page.getByRole('alert')).toContainText('E-mail ou senha inválidos');
  await login(page, EMAIL, NEW_PASSWORD);
  await expect(page).toHaveURL(/\/propriedades$/);
});
