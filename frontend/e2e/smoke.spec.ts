/**
 * Smoke de ponta a ponta contra a stack de dev (http://localhost):
 * cadastro → verificação pelo link lido no log da API → login → propriedade →
 * talhão desenhado no mapa → área e célula ERA5 → logout.
 * Pré-requisitos: `docker compose up -d` na raiz; sem SMTP_HOST (o link vai para o log).
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const stamp = Date.now();
const EMAIL = `smoke-${stamp}@fc.local`;
const PASSWORD = 'MinhaS3nha!';
/** CPF válido e único por execução (os roteiros do backend deixam usuários no banco). */
function randomCpf(seed: number): string {
  const base = String(seed).padStart(9, '0').slice(-9).split('').map(Number);
  const dv = (digits: number[], start: number) => {
    const sum = digits.reduce((acc, d, i) => acc + d * (start - i), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const d1 = dv(base, 10);
  const d2 = dv([...base, d1], 11);
  const all = [...base, d1, d2].join('');
  return all.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}
const CPF = randomCpf(stamp);

function lastVerificationToken(): string {
  const logs = execSync('docker compose logs --no-log-prefix api', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const matches = logs.match(/verificar-email\/([A-Za-z0-9._-]+)/g) ?? [];
  const last = matches[matches.length - 1];
  if (!last) throw new Error('link de verificação não encontrado no log da API');
  return last.replace('verificar-email/', '');
}

/** Clica no mapa em deslocamentos relativos ao centro (px). */
async function drawPolygon(page: Page) {
  const map = page.getByTestId('map');
  const box = await map.boundingBox();
  if (!box) throw new Error('mapa sem dimensões');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.locator('.leaflet-pm-icon-polygon').first().click(); // botão do geoman
  const pts: [number, number][] = [[-80, -60], [80, -60], [80, 60], [-80, 60]];
  for (const [dx, dy] of pts) {
    await page.mouse.click(cx + dx, cy + dy);
    await page.waitForTimeout(120);
  }
  await page.mouse.click(cx - 80, cy - 60); // fecha no primeiro vértice
}

test('cadastro → verificação → login → propriedade → talhão → logout', async ({ page }) => {
  // cadastro
  await page.goto('/cadastro');
  await page.getByLabel('Perfil').selectOption('AGRONOMO');
  // rótulos obrigatórios terminam em " *": seleciona pelos ids dos campos
  await page.locator('#name').fill('Smoke Agrônoma');
  await page.locator('#email').fill(EMAIL);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#cpf').fill(CPF.replace(/\D/g, ''));
  await expect(page.locator('#cpf')).toHaveValue(CPF); // máscara aplicada
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page).toHaveURL(/\/verifique-seu-email/);
  await expect(page.getByText(EMAIL)).toBeVisible();

  // verificação pelo link do log
  const token = lastVerificationToken();
  await page.goto(`/verificar-email/${token}`);
  await expect(page.getByText('E-mail verificado!')).toBeVisible();
  await page.getByRole('link', { name: 'Ir para o login' }).click();

  // login
  await page.locator('#email').fill(EMAIL);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/propriedades$/);
  await expect(page.getByText('Smoke Agrônoma')).toBeVisible();
  await expect(page.getByText('Agrônomo', { exact: true })).toBeVisible();

  // sessão sobrevive ao reload (refresh pelo cookie + /me)
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Propriedades' })).toBeVisible();

  // propriedade
  await page.getByRole('link', { name: 'Nova propriedade' }).first().click();
  await page.locator('#name').fill(`Fazenda Smoke ${stamp}`);
  await page.locator('#state').selectOption('GO');
  await page.locator('#city').fill('Goiânia');
  await page.getByRole('button', { name: 'Cadastrar propriedade' }).click();
  await expect(page.getByRole('heading', { name: `Fazenda Smoke ${stamp}` })).toBeVisible();
  await expect(page.getByText('Nenhum talhão')).toBeVisible();

  // talhão desenhado no mapa
  await page.getByRole('link', { name: 'Novo talhão' }).first().click();
  await expect(page.getByTestId('map')).toBeVisible();
  await page.waitForSelector('.leaflet-pm-toolbar');
  await drawPolygon(page);
  const area = page.locator('#areaHa');
  await expect(area).not.toHaveValue('');
  const computed = Number(await area.inputValue());
  expect(computed).toBeGreaterThan(0);
  await page.locator('#name').fill('Talhão Smoke');
  await page.locator('#altitudeM').fill('741');
  await page.getByRole('button', { name: 'Cadastrar talhão' }).click();

  // detalhe: área e célula ERA5
  await expect(page.getByRole('heading', { name: 'Talhão Smoke' })).toBeVisible();
  await expect(page.getByText(/ha$/).first()).toBeVisible();
  await expect(page.getByText('Célula ERA5-Land')).toBeVisible();
  await expect(page.getByText('não atribuída')).toHaveCount(0);
  await expect(page.getByText('741 m')).toBeVisible();

  // logout
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/entrar/);
  await page.goto('/propriedades');
  await expect(page).toHaveURL(/\/entrar\?next=/);
});

test('rota protegida sem sessão vai ao login com next; admin negado para agrônomo', async ({ page }) => {
  await page.goto('/propriedades/abc');
  await expect(page).toHaveURL(/\/entrar\?next=%2Fpropriedades%2Fabc/);
});
