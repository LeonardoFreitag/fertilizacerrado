/**
 * Painel MSA de ponta a ponta contra a stack de dev (http://localhost).
 * Pré-requisitos: stack completa (api, worker, etl) e o cache do ETL com os meses da
 * célula de Goiânia (−16,7; −49,3) desde 2025-10 — como o e2e-orchestration.sh.
 * Sem ERA5_E2E_CDS=1, o cache é tratado como "baixado hoje" (touch) para não ir ao CDS.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const API = (process.env.E2E_BASE_URL ?? 'http://localhost') + '/api/v1';
const stamp = Date.now();
const EMAIL = `msa-${stamp}@fc.local`;
const PASSWORD = 'MinhaS3nha!';
// quadrado dos roteiros bash: célula ERA5 −16,7/−49,3 (a única em cache)
const SQUARE = { type: 'Polygon', coordinates: [[[-49.3, -16.7], [-49.2906, -16.7], [-49.2906, -16.691], [-49.3, -16.691], [-49.3, -16.7]]] };

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

function compose(cmd: string): string {
  return execSync(`docker compose ${cmd}`, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function lastVerificationToken(): string {
  const matches = compose('logs --no-log-prefix api').match(/verificar-email\/([A-Za-z0-9._-]+)/g) ?? [];
  const last = matches[matches.length - 1];
  if (!last) throw new Error('link de verificação não encontrado no log da API');
  return last.replace('verificar-email/', '');
}

async function apiJson<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Agrônomo novo, verificado, com propriedade e talhão na célula em cache (via API). */
async function seedAgronomist(): Promise<{ token: string; fieldName: string }> {
  await apiJson('/auth/register', { method: 'POST', body: JSON.stringify({ name: 'MSA Agrônoma', email: EMAIL, password: PASSWORD, role: 'AGRONOMO', personType: 'PF', cpf: randomCpf(stamp) }) });
  await new Promise((r) => setTimeout(r, 500));
  await apiJson(`/auth/verify-email/${lastVerificationToken()}`);
  const login = await apiJson<{ accessToken: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  const token = login.accessToken;
  const property = await apiJson<{ id: string }>('/properties', { method: 'POST', token, body: JSON.stringify({ name: `Fazenda MSA ${stamp}`, state: 'GO', city: 'Goiânia' }) });
  const fieldName = `Talhão MSA ${stamp}`;
  const field = await apiJson<{ era5Cell: { lat: number; lon: number } | null }>(`/properties/${property.id}/fields`, {
    method: 'POST',
    token,
    body: JSON.stringify({ name: fieldName, geometry: SQUARE, altitudeM: 741, thetaFC: 0.28, thetaWP: 0.12 }),
  });
  expect(field.era5Cell).toEqual({ lat: -16.7, lon: -49.3 });
  return { token, fieldName };
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/entrar');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/propriedades$/);
}

test.describe.configure({ mode: 'serial' });

test('safra → processamento → painel → cenários → decisão → CSV', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  // 401 do refresh sem cookie e 404 NO_MSA_RESULT são estados normais; só erros de renderização importam
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && pageErrors.push(m.text()));
  if (!process.env.ERA5_E2E_CDS) {
    // mês aberto do cache passa a contar como baixado hoje (regra diária do download.py)
    compose('exec -T etl sh -c "find /data/cache -name \'*.nc\' -exec touch {} +"');
  }
  const { fieldName } = await seedAgronomist();
  await login(page, EMAIL, PASSWORD);

  // nova safra pela UI
  await page.getByRole('link', { name: 'Safras' }).click();
  await expect(page.getByRole('heading', { name: 'Safras' })).toBeVisible();
  await page.getByRole('link', { name: 'Nova safra' }).first().click();
  // o rótulo inclui a área calculada pelo PostGIS: escolhe pelo prefixo do nome
  const fieldSelect = page.locator('#fieldId');
  await expect(fieldSelect.locator('option', { hasText: fieldName })).toHaveCount(1, { timeout: 15_000 });
  const fieldValue = await fieldSelect.locator('option', { hasText: fieldName }).getAttribute('value');
  await fieldSelect.selectOption(fieldValue!);
  const sojaValue = await page.locator('#cultivarId option', { hasText: /soja/i }).first().getAttribute('value');
  await page.locator('#cultivarId').selectOption(sojaValue!);
  await page.locator('#emergenceDate').fill('2025-11-01');
  await expect(page.locator('#season')).toHaveValue('2025/26'); // sugerida pela emergência
  await page.getByRole('button', { name: 'Cadastrar safra' }).click();

  // acompanhamento do backfill (cache do ETL → ~30 s) e painel
  await expect(page).toHaveURL(/\/safras\/[0-9a-f-]+$/);
  await expect(page.getByText('Processando o MSA…')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Módulo agrometeorológico (MSA)' })).toBeVisible({ timeout: 5 * 60_000 });
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  await expect(page.getByText('SUCCEEDED').first()).toBeVisible();
  await expect(page.getByTestId('rain-badge')).toContainText('sem correção'); // célula sem calibração QM
  for (const phase of ['F1', 'F2', 'F3', 'F4']) {
    const card = page.getByTestId(`phase-card-${phase}`);
    await expect(card).toBeVisible();
    await expect(card).not.toHaveAttribute('data-severity', 'pending');
  }
  await expect(page.getByLabel('Linha do tempo fenológica')).toContainText('ciclo encerrado');
  await expect(page.getByTestId('msa-charts').locator('.recharts-wrapper')).toHaveCount(3, { timeout: 20_000 }); // 3 gráficos (os ícones da legenda também são svg)

  // cenários F3 e registro da decisão A
  await page.locator('#dec-phase').selectOption('F3');
  await page.locator('#dec-dose').fill('100');
  await page.locator('#dec-eff').fill('0,6');
  await expect(page.getByTestId('scenario-A')).toContainText('kg/ha', { timeout: 15_000 });
  await expect(page.getByTestId('scenario-C')).toContainText('eficiência ajustada');
  await page.getByRole('button', { name: 'Registrar decisão A' }).click();
  await page.locator('#dec-just').fill('Estiagem em F3 observada no balanço hídrico');
  await page.getByRole('button', { name: 'Registrar', exact: true }).click();
  await expect(page.getByTestId('decisions-list')).toContainText('Estiagem em F3');
  await expect(page.getByTestId('decisions-list')).toContainText('MSA Agrônoma');

  // exportação CSV
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar série diária' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^serie-diaria-.*\.csv$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  const csv = Buffer.concat(chunks).toString('utf8');
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv.split('\r\n')[0]).toContain('Data;Fase;GDA do dia');
  expect(csv).toMatch(/;0,\d+;/); // vírgula decimal

  // histórico de runs lista a run BACKFILL
  await expect(page.getByLabel('Histórico de runs')).toContainText('Criação da safra');
});

test('admin: process-all mostra jobId e estado', async ({ page }) => {
  const env = readFileSync(`${ROOT}/.env`, 'utf8');
  const get = (k: string) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim();
  const adminEmail = get('ADMIN_EMAIL');
  const adminPassword = get('ADMIN_PASSWORD');
  test.skip(!adminEmail || !adminPassword, 'ADMIN_EMAIL/ADMIN_PASSWORD ausentes no .env');

  await login(page, adminEmail!, adminPassword!);
  await page.getByRole('link', { name: 'Admin' }).click();
  await expect(page.getByRole('heading', { name: 'Administração' })).toBeVisible();
  await expect(page.getByText('era5-ingest')).toBeVisible();
  await page.getByRole('button', { name: 'Processar todas as safras ativas' }).click();
  await page.getByRole('button', { name: 'Enfileirar', exact: true }).click();
  await expect(page.getByText(/job\(s\) enfileirado\(s\)|enfileirado em/)).toBeVisible();
  await expect(page.getByTestId('session-job').first()).toBeVisible();
  await expect(page.getByTestId('session-job').first()).toContainText(/completed|active|waiting/, { timeout: 60_000 });
});
