/**
 * Gera as imagens do manual do usuário (docs/manual/img/*.png) e o captura.json com os
 * valores citados no capítulo 6. Monta dados de demonstração, percorre as telas e
 * remove tudo ao final. Uso: `pnpm manual:capture` na raiz (stack de dev no ar).
 *
 * Pré-requisitos: admin semeado (ADMIN_EMAIL/ADMIN_PASSWORD no .env), internet para os
 * tiles do mapa e cache do ETL com a célula de Goiânia desde 2025-02 (início do spin-up de
 * entressafra da safra de exemplo, motor 2.2.0). Não contacta o CDS,
 * não dispara ingestão nem calibração. MANUAL_KEEP_DATA=1 mantém os dados de demonstração.
 */
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  CAPTURE_JSON, CELL, CROSSED_OUTLINE, DEMO, EMERGENCE, FIELD_1, FIELD_1_OUTLINE, FIELD_2, FIELD_2_GEOMETRY, FIELD_3, FIELD_3_GEOMETRY, IMG_DIR, NEW_PASSWORD,
  OWN_CULTIVAR, PASSWORD, PROPERTY_NAME, SEASON, STAGING_DIR, adminCredentials, apiJson, assertCachePrerequisite, centerMapOn, cleanupDemo, clickMap,
  demoResidue, lastMailLink, login, logout, resetStaging, seedUser, shot, takenShots, trackToken, validCpf, waitForTiles,
} from './helpers';

interface RunRow { id: string; status: 'SUCCEEDED' | 'NEEDS_DATA' | 'FAILED'; reason: string; missingDates?: string[] | null; qmCalibration?: unknown }
interface PhaseRow { phase: string; days: number; ksMean: number | null; yieldReductionPct: number | null; etcAdjAccum: number | null; precipAccum: number | null }
interface YieldRun { expectedYield: number | null; yieldIndex: number | null; predictedYield: number | null; phasesReached: number | null }
interface PreSeasonRun { preSeasonFrom: string | null; preSeasonKc: number | null; preSeasonZr: number | null; emergenceDepletionMm: number | null; emergenceDepletionPct: number | null }
interface Latest { run: RunRow & YieldRun & PreSeasonRun & { dateFrom: string; dateTo: string }; currentPhase: string | null; phases: PhaseRow[] }

/** Estado compartilhado entre os capítulos (os testes rodam em série). */
const ctx = { propertyId: '', field1Id: '', field2Id: '', ownCultivarId: '', harvest1Id: '', harvest2Id: '', capture: {} as Record<string, unknown> };

/** Produtividade potencial (Ym) da safra de exemplo, em sc/ha. */
const EXPECTED_YIELD = 65;
/** Janela destacada nas imagens de cartão (floração/enchimento). */
const FOCUS_PHASE = 'F3';

async function pollRuns(token: string, harvestId: string, done: (runs: RunRow[]) => boolean, timeoutMs: number): Promise<RunRow[]> {
  const started = Date.now();
  for (;;) {
    const runs = await apiJson<RunRow[]>(`/harvests/${harvestId}/msa/runs`, { token });
    if (done(runs)) return runs;
    if (Date.now() - started > timeoutMs) throw new Error(`processamento da safra ${harvestId} não terminou em ${timeoutMs / 1000} s`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
const field = (page: Page, id: string) => page.locator(`#${id}`).locator('xpath=..');
const dialogButton = (page: Page, name: string) => page.locator('.fixed.inset-0').getByRole('button', { name, exact: true });

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const admin = adminCredentials();
  if (!admin.email || !admin.password) throw new Error('ADMIN_EMAIL/ADMIN_PASSWORD ausentes no .env da raiz: rode `pnpm seed` antes da captura.');
  assertCachePrerequisite();
  cleanupDemo(); // execução anterior interrompida não bloqueia esta
  resetStaging();
  await seedUser('joao');
  await seedUser('ana');
});

test.afterAll(() => {
  if (process.env.MANUAL_KEEP_DATA) return;
  cleanupDemo();
  expect(demoResidue(), 'dados de demonstração remanescentes').toBe(0);
});

test('capítulo 1 — primeiros passos', async ({ page }) => {
  const carla = DEMO.carla;
  await page.goto('/entrar');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await shot(page, '01-01-entrar', { highlight: page.getByRole('link', { name: 'Cadastre-se' }) });

  // cadastro
  await page.getByRole('link', { name: 'Cadastre-se' }).click();
  await expect(page.getByRole('heading', { name: 'Criar conta' })).toBeVisible();
  await page.locator('#role').selectOption('AGRONOMO');
  await page.locator('#name').fill(carla.name);
  await page.locator('#email').fill(carla.email);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#cpf').fill(validCpf(carla.cpfSeed));
  await page.locator('#crea').fill(carla.crea);
  await page.locator('#phone').fill(carla.phone);
  await page.locator('#name').focus();
  await shot(page, '01-02-criar-conta', { fullPage: true });
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page).toHaveURL(/\/verifique-seu-email/);
  await shot(page, '01-03-verifique-seu-email');

  // tentar entrar antes de confirmar o e-mail
  await page.goto('/entrar');
  await page.locator('#email').fill(carla.email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  const resend = page.getByRole('button', { name: 'Reenviar e-mail de verificação' });
  await expect(resend).toBeVisible();
  await shot(page, '01-04-email-nao-verificado', { highlight: resend });

  // link de confirmação
  await page.goto(await lastMailLink('verificar-email'));
  await expect(page.getByText('E-mail verificado!')).toBeVisible();
  await shot(page, '01-05-email-verificado', { highlight: page.getByRole('link', { name: 'Ir para o login' }) });

  // primeiro acesso
  await login(page, carla.email, PASSWORD);
  await shot(page, '01-06-tela-inicial', { highlight: page.getByRole('navigation', { name: 'Principal' }).first() });

  // perfil e troca de senha
  const profileLink = page.getByRole('link', { name: carla.name });
  await shot(page, '01-07-abrir-perfil', { highlight: profileLink });
  await profileLink.click();
  await expect(page.getByRole('heading', { name: 'Meu perfil' })).toBeVisible();
  await expect(page.locator('#p-name')).toHaveValue(carla.name);
  await shot(page, '01-08-meu-perfil', { highlight: page.getByRole('region', { name: 'Dados pessoais' }) });
  await page.locator('#pw-current').fill(PASSWORD);
  await page.locator('#pw-next').fill(NEW_PASSWORD);
  await page.locator('#pw-confirm').fill(NEW_PASSWORD);
  await shot(page, '01-09-trocar-senha', { highlight: page.getByRole('region', { name: 'Trocar senha' }) });
  await page.getByRole('button', { name: 'Alterar senha' }).click();
  await expect(page.getByText('Senha alterada com sucesso.')).toBeVisible();
  await logout(page);

  // recuperação de senha
  await shot(page, '01-10-esqueci-minha-senha', { highlight: page.getByRole('link', { name: 'Esqueci minha senha' }) });
  await page.getByRole('link', { name: 'Esqueci minha senha' }).click();
  await expect(page.getByRole('heading', { name: 'Recuperar senha' })).toBeVisible();
  await page.locator('#email').fill(carla.email);
  await shot(page, '01-11-recuperar-senha');
  await page.getByRole('button', { name: 'Enviar link' }).click();
  await expect(page.getByText('você receberá o link de redefinição')).toBeVisible();
  await shot(page, '01-12-link-enviado');
  await page.goto(await lastMailLink('redefinir-senha'));
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#confirm').fill(PASSWORD);
  await shot(page, '01-13-redefinir-senha');
  await page.getByRole('button', { name: 'Redefinir senha' }).click();
  await expect(page.getByText('Senha redefinida com sucesso.')).toBeVisible();
  await shot(page, '01-14-senha-redefinida');
});

test('capítulo 2 — propriedades', async ({ page }) => {
  await login(page, DEMO.ana.email, PASSWORD);
  await shot(page, '02-01-nova-propriedade', { highlight: page.getByRole('link', { name: 'Nova propriedade' }).first() });

  await page.getByRole('link', { name: 'Nova propriedade' }).first().click();
  await page.locator('#name').fill(PROPERTY_NAME);
  await page.locator('#state').selectOption('GO');
  await page.locator('#city').fill('Goiânia');
  await page.locator('#ownerId').click();
  await page.locator('#ownerId').fill('João');
  const option = page.getByRole('option').filter({ hasText: DEMO.joao.email });
  await expect(option).toBeVisible();
  await shot(page, '02-02-buscar-produtor', { highlight: page.locator('#ownerId-results') });
  await option.getByRole('button').click();
  await expect(page.getByText(DEMO.joao.email)).toBeVisible();
  await shot(page, '02-03-propriedade-preenchida', { highlight: page.getByRole('button', { name: 'Cadastrar propriedade' }) });
  await page.getByRole('button', { name: 'Cadastrar propriedade' }).click();
  await expect(page.getByRole('heading', { name: PROPERTY_NAME })).toBeVisible();
  ctx.propertyId = page.url().split('/propriedades/')[1]!.split(/[/?#]/)[0]!;
  await expect(page.getByText('Nenhum talhão')).toBeVisible();
  await shot(page, '02-04-propriedade-cadastrada', { keepToast: true });

  await shot(page, '02-05-botao-editar', { highlight: page.getByRole('link', { name: 'Editar' }) });
  await page.getByRole('link', { name: 'Editar' }).click();
  await expect(page.getByRole('heading', { name: `Editar — ${PROPERTY_NAME}` })).toBeVisible();
  await expect(page.locator('#name')).toHaveValue(PROPERTY_NAME);
  await shot(page, '02-06-editar-propriedade', { highlight: page.getByRole('button', { name: 'Salvar alterações' }) });
  await page.getByRole('button', { name: 'Cancelar' }).click();

  await page.goto('/propriedades');
  await page.locator('#search').fill('boa vista');
  await expect(page.getByRole('link', { name: new RegExp(PROPERTY_NAME) })).toBeVisible();
  await shot(page, '02-07-lista-de-propriedades', { highlight: page.locator('#search') });
});

test('capítulo 3 — talhões', async ({ page }) => {
  const session = trackToken(page);
  await login(page, DEMO.ana.email, PASSWORD);
  const base = `/properties/${ctx.propertyId}/fields`;
  // um talhão vizinho já cadastrado: o mapa do novo talhão abre nessa região (a célula ERA5 em cache)
  const f2 = await apiJson<{ id: string; era5Cell: { lat: number; lon: number } | null }>(base, {
    method: 'POST',
    token: session.get(),
    body: JSON.stringify({ name: FIELD_2, geometry: FIELD_2_GEOMETRY, altitudeM: 735, soilType: 'Latossolo Vermelho-Amarelo' }),
  });
  expect(f2.era5Cell).toEqual(CELL);
  ctx.field2Id = f2.id;

  await page.goto(`/propriedades/${ctx.propertyId}`);
  await expect(page.getByText(FIELD_2)).toBeVisible();
  await shot(page, '03-01-novo-talhao', { highlight: page.getByRole('link', { name: 'Novo talhão' }).first() });

  // mapa: ferramentas e camadas
  await page.getByRole('link', { name: 'Novo talhão' }).first().click();
  await page.waitForSelector('.leaflet-pm-toolbar');
  await waitForTiles(page);
  await centerMapOn(page, -16.70791, -49.3432); // o pasto ao lado do talhão vizinho
  await waitForTiles(page);
  await shot(page, '03-02-ferramentas-do-mapa', { highlight: page.locator('.leaflet-top.leaflet-left') });
  const layers = page.locator('.leaflet-control-layers');
  await layers.hover();
  await expect(page.getByText('Imagem de satélite (Esri)')).toBeVisible();
  await shot(page, '03-03-camadas-do-mapa', { highlight: layers });
  await page.getByText('Imagem de satélite (Esri)').click();
  await page.mouse.move(400, 860);
  await waitForTiles(page);
  await shot(page, '03-04-imagem-de-satelite', { clip: page.getByTestId('map'), pad: 24 });

  // desenho do polígono
  const outline = FIELD_1_OUTLINE;
  await page.locator('.leaflet-pm-icon-polygon').first().click();
  await clickMap(page, outline.slice(0, 4));
  await page.mouse.move(700, 600);
  await shot(page, '03-05-desenhando-o-poligono', { clip: page.getByTestId('map'), pad: 24 });
  await clickMap(page, outline.slice(4));
  await clickMap(page, [outline[0]!]); // fecha no primeiro vértice
  await expect(page.locator('#areaHa')).not.toHaveValue('');
  await page.mouse.move(400, 860);
  await shot(page, '03-06-poligono-fechado', { highlight: field(page, 'areaHa') });
  await page.locator('.leaflet-pm-icon-edit').first().click();
  await page.waitForTimeout(400);
  await shot(page, '03-07-editar-vertices', { clip: page.getByTestId('map'), pad: 24 });
  await page.locator('.leaflet-pm-icon-edit').first().click();

  // dados do talhão
  await page.locator('#name').fill(FIELD_1);
  await page.locator('#altitudeM').fill('741');
  await shot(page, '03-08-altitude', { clip: field(page, 'name').locator('xpath=..'), highlight: field(page, 'altitudeM') });
  await page.locator('#thetaFC').fill('0,28');
  await page.locator('#thetaWP').fill('0,12');
  await page.locator('#soilType').fill('Latossolo Vermelho');
  await page.locator('#name').focus();
  await shot(page, '03-09-umidade-do-solo', { clip: field(page, 'name').locator('xpath=..'), highlight: field(page, 'thetaFC').locator('xpath=..') });
  await page.getByRole('button', { name: 'Cadastrar talhão' }).click();
  await expect(page.getByRole('heading', { name: FIELD_1 })).toBeVisible();
  ctx.field1Id = page.url().split('/talhoes/')[1]!.split(/[/?#]/)[0]!;
  await expect(page.getByText('não atribuída')).toHaveCount(0);
  await waitForTiles(page);
  await shot(page, '03-10-talhao-cadastrado');
  // mapa afastado: o quadrado de clima (célula ERA5-Land) inteiro
  for (let i = 0; i < 4; i++) {
    await page.locator('.leaflet-control-zoom-out').click();
    await page.waitForTimeout(500);
  }
  await waitForTiles(page);
  await shot(page, '03-11-quadrado-de-clima', { clip: page.getByTestId('map'), pad: 24 });
  const created = await apiJson<{ era5Cell: { lat: number; lon: number } | null; areaHa: number }>(`${base}/${ctx.field1Id}`, { token: session.get() });
  expect(created.era5Cell).toEqual(CELL);
  ctx.capture.field1AreaHa = created.areaHa;

  // erro comum: lados que se cruzam
  await page.goto(`/propriedades/${ctx.propertyId}/talhoes/novo`);
  await page.waitForSelector('.leaflet-pm-toolbar');
  await waitForTiles(page);
  await centerMapOn(page, -16.70791, -49.3432);
  await waitForTiles(page);
  await page.locator('.leaflet-pm-icon-polygon').first().click();
  await clickMap(page, [...CROSSED_OUTLINE, CROSSED_OUTLINE[0]!]);
  await expect(page.locator('#areaHa')).not.toHaveValue('');
  await page.locator('#name').fill('Talhão de teste');
  await page.locator('#altitudeM').fill('740');
  await page.getByRole('button', { name: 'Cadastrar talhão' }).click();
  const invalid = page.getByRole('alert').filter({ hasText: 'Geometria inválida' });
  await expect(invalid).toBeVisible();
  await page.mouse.move(400, 860);
  await shot(page, '03-12-geometria-invalida', { highlight: invalid });

  // talhão sem altitude: avisos na lista e no detalhe
  const f3 = await apiJson<{ id: string }>(base, { method: 'POST', token: session.get(), body: JSON.stringify({ name: FIELD_3, geometry: FIELD_3_GEOMETRY }) });
  await page.goto('/talhoes');
  const warn = page.getByText('sem altitude — necessária para o MSA');
  await expect(warn).toBeVisible();
  await shot(page, '03-13-lista-de-talhoes', { highlight: warn });
  await page.goto(`/propriedades/${ctx.propertyId}/talhoes/${f3.id}`);
  const alert = page.getByRole('alert').filter({ hasText: 'Altitude não informada' });
  await expect(alert).toBeVisible();
  await waitForTiles(page);
  await shot(page, '03-14-altitude-nao-informada', { highlight: alert });
  await apiJson(`${base}/${f3.id}`, { method: 'DELETE', token: session.get() });
});

test('capítulo 4 — cultivares', async ({ page }) => {
  await login(page, DEMO.ana.email, PASSWORD);
  await page.getByRole('link', { name: 'Cultivares' }).click();
  await expect(page.getByRole('heading', { name: 'Referência' })).toBeVisible();
  const sojaCard = page.getByRole('listitem').filter({ hasText: 'Soja — referência' });
  await shot(page, '04-01-cultivares', { highlight: sojaCard.getByRole('link', { name: 'ver parâmetros' }) });
  await sojaCard.getByRole('link', { name: 'ver parâmetros' }).click();
  await expect(page.locator('#gdaTotal')).not.toHaveValue('');
  await shot(page, '04-02-cultivar-de-referencia', { fullPage: true });

  // nova cultivar: nasce como cópia da referência; só o Kc médio é alterado
  await page.goto('/cultivares');
  await page.getByRole('link', { name: 'Nova cultivar' }).first().click();
  await expect(page.locator('#kcMid')).toHaveValue(/1[.,]15/);
  await expect(page.getByTestId('divergence-summary')).toContainText('igual à referência');
  await page.locator('#name').fill(OWN_CULTIVAR);
  await page.locator('#cycleDescription').fill('Grupo de maturação 7.2, ciclo de cerca de 105 dias. Kc médio ajustado a partir das safras anteriores da fazenda.');
  await page.locator('#kcMid').fill('1,10');
  const kcMid = page.getByTestId('param-kcMid');
  await expect(kcMid).toHaveAttribute('data-divergent', 'true');
  await expect(page.getByTestId('divergence-summary')).toContainText('1 parâmetro difere da referência (kcMid)');
  await page.locator('#name').focus();
  await shot(page, '04-03-nova-cultivar', { fullPage: true, highlight: kcMid });
  await page.getByRole('button', { name: 'Cadastrar cultivar' }).click();
  await expect(page).toHaveURL(/\/cultivares$/);
  const ownCard = page.getByRole('listitem').filter({ hasText: OWN_CULTIVAR });
  await expect(ownCard).toBeVisible();
  await expect(ownCard.getByTestId('card-divergence')).toHaveText('1 parâmetro difere da referência');
  ctx.ownCultivarId = (await ownCard.getByRole('link', { name: OWN_CULTIVAR }).getAttribute('href'))!.split('/cultivares/')[1]!.split('/')[0]!;
  await shot(page, '04-04-minhas-cultivares', { highlight: ownCard });

  // edição: divergência marcada campo a campo e nota sobre as execuções
  await page.goto(`/cultivares/${ctx.ownCultivarId}/editar`);
  await expect(page.locator('#kcMid')).toHaveValue(/1[.,]10?/);
  await expect(kcMid).toHaveAttribute('data-divergent', 'true');
  await expect(page.getByTestId('in-use-note')).toBeVisible();
  await shot(page, '04-05-divergencia-da-referencia', { fullPage: true, highlight: [page.getByTestId('divergence-summary'), kcMid, page.getByTestId('in-use-note')] });

  // atualizar a partir da referência: só a prévia; cancela para a cultivar continuar divergente
  await page.getByRole('button', { name: 'Atualizar a partir da referência' }).click();
  await expect(page.getByRole('dialog', { name: 'Atualizar a partir da referência' })).toBeVisible();
  await page.getByRole('radio', { name: /Todos os campos/ }).check();
  const preview = page.getByTestId('sync-preview');
  await expect(preview).toContainText('kcMid');
  await shot(page, '04-06-atualizar-da-referencia', { highlight: preview });
  await dialogButton(page, 'Cancelar').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('capítulo 5 — safras', async ({ page }) => {
  test.setTimeout(14 * 60_000);
  const session = trackToken(page);
  await login(page, DEMO.ana.email, PASSWORD);
  await page.getByRole('link', { name: 'Safras' }).click();
  await expect(page.getByRole('heading', { name: 'Safras' })).toBeVisible();
  await shot(page, '05-01-safras', { highlight: page.getByRole('link', { name: 'Nova safra' }).first() });

  await page.getByRole('link', { name: 'Nova safra' }).first().click();
  const fieldSelect = page.locator('#fieldId');
  await expect(fieldSelect.locator('option', { hasText: FIELD_1 })).toHaveCount(1, { timeout: 15_000 });
  await fieldSelect.selectOption((await fieldSelect.locator('option', { hasText: FIELD_1 }).getAttribute('value'))!);
  await page.locator('#cultivarId').selectOption((await page.locator('#cultivarId option', { hasText: 'Soja — referência' }).getAttribute('value'))!);
  await page.locator('#emergenceDate').fill(EMERGENCE);
  await expect(page.locator('#season')).toHaveValue(SEASON);
  await page.locator('#expectedYield').fill(String(EXPECTED_YIELD));
  await page.locator('#notes').fill('Plantio direto sobre palhada de milho safrinha, logo após o vazio sanitário.');
  await page.locator('#season').focus();
  await shot(page, '05-02-nova-safra', { highlight: [field(page, 'emergenceDate'), field(page, 'expectedYield')] });
  await page.getByRole('button', { name: 'Cadastrar safra' }).click();
  await expect(page).toHaveURL(/\/safras\/[0-9a-f-]+$/);
  ctx.harvest1Id = page.url().split('/safras/')[1]!;
  const banner = page.getByRole('status').filter({ hasText: 'Processando o MSA…' });
  await expect(banner).toBeVisible();
  await shot(page, '05-03-processando', { highlight: banner, keepToast: true });
  await expect(page.getByRole('heading', { name: 'Módulo agrometeorológico (MSA)' })).toBeVisible({ timeout: 8 * 60_000 });
  await expect(page.getByTestId('msa-charts').locator('.recharts-wrapper')).toHaveCount(3, { timeout: 30_000 });
  await shot(page, '05-04-processamento-concluido', { settle: 1800 });

  // segunda execução (manual): histórico com duas linhas e botão "Ver série"
  await apiJson(`/harvests/${ctx.harvest1Id}/msa/process`, { method: 'POST', token: session.get() });
  await pollRuns(session.get(), ctx.harvest1Id, (runs) => runs.length >= 2 && runs[0]!.status === 'SUCCEEDED', 6 * 60_000);

  // safra recém-emergida no outro talhão, com a cultivar própria: ainda sem dados suficientes
  const h2 = await apiJson<{ id: string }>('/harvests', {
    method: 'POST',
    token: session.get(),
    body: JSON.stringify({ fieldId: ctx.field2Id, cultivarId: ctx.ownCultivarId, emergenceDate: isoDaysAgo(8), season: '2026/27' }),
  });
  ctx.harvest2Id = h2.id;
  const runs2 = await pollRuns(session.get(), h2.id, (runs) => runs.length >= 1, 6 * 60_000);
  ctx.capture.harvest2 = { status: runs2[0]!.status, missingDays: runs2[0]!.missingDates?.length ?? 0 };

  await page.goto('/safras');
  await expect(page.getByText('MSA…')).toHaveCount(0, { timeout: 30_000 });
  const card1 = page.getByRole('listitem').filter({ hasText: FIELD_1 });
  await expect(card1).toBeVisible();
  await expect(card1.getByTestId('harvest-predicted')).toContainText('predita');
  await shot(page, '05-05-lista-de-safras', { highlight: page.locator('#f-status').locator('xpath=../..') });

  await card1.getByRole('link').click();
  await expect(page.getByRole('heading', { name: 'Módulo agrometeorológico (MSA)' })).toBeVisible({ timeout: 30_000 });
  await shot(page, '05-06-acoes-da-safra', { highlight: [page.getByRole('button', { name: 'Concluir' }), page.getByRole('button', { name: 'Cancelar safra' })], settle: 1500 });
  await page.getByRole('button', { name: 'Concluir' }).click();
  await expect(page.getByText('Marca o ciclo como concluído')).toBeVisible();
  await shot(page, '05-07-concluir-safra');
  await dialogButton(page, 'Cancelar').click();
  await page.getByRole('button', { name: 'Cancelar safra' }).click();
  await expect(page.getByText('A safra deixa de ser processada pelo semanal')).toBeVisible();
  await shot(page, '05-08-cancelar-safra');
  await dialogButton(page, 'Cancelar').first().click();
  await page.getByRole('button', { name: 'Editar notas' }).click();
  await expect(page.getByRole('textbox', { name: 'Notas' })).toBeVisible();
  await shot(page, '05-09-notas-da-safra');
  await dialogButton(page, 'Cancelar').click();

  // produtividade potencial: diálogo de edição (cancelado, sem alterar a safra)
  await expect(page.getByTestId('harvest-ym')).toContainText('sc/ha');
  await page.getByRole('button', { name: 'Editar produtividade potencial' }).click();
  await expect(page.getByRole('dialog', { name: 'Produtividade potencial (sc/ha)' })).toBeVisible();
  await expect(page.locator('#ym')).toHaveValue(String(EXPECTED_YIELD));
  await shot(page, '05-10-produtividade-potencial', { highlight: field(page, 'ym') });
  await dialogButton(page, 'Cancelar').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('capítulo 6 — painel agrometeorológico', async ({ page }) => {
  const session = trackToken(page);
  await login(page, DEMO.ana.email, PASSWORD);
  await page.goto(`/safras/${ctx.harvest1Id}`);
  const title = page.getByRole('heading', { name: 'Módulo agrometeorológico (MSA)' });
  await expect(title).toBeVisible({ timeout: 30_000 });
  const charts = page.getByTestId('msa-charts');
  await expect(charts.locator('.recharts-wrapper')).toHaveCount(3, { timeout: 30_000 });
  const yieldBlock = page.getByTestId('yield-summary');
  await expect(page.getByTestId('yield-predicted')).toContainText('sc/ha', { timeout: 20_000 });
  await page.waitForTimeout(1800); // animação de entrada dos gráficos
  await shot(page, '06-01-painel-completo', { fullPage: true });

  const header = page.locator('.card').filter({ has: title });
  const rain = page.getByTestId('rain-badge');
  await shot(page, '06-02-cabecalho-do-painel', { clip: header });
  await shot(page, '06-03-selo-da-chuva', { clip: header, highlight: rain });
  ctx.capture.rainCorrected = !(await rain.innerText()).includes('sem correção');

  await shot(page, '06-04-linha-do-tempo', { clip: page.getByLabel('Linha do tempo fenológica') });
  const cards = page.getByRole('heading', { name: 'Janelas fenológicas' }).locator('xpath=../..');
  await shot(page, '06-05-cartoes-das-janelas', { clip: cards });
  await shot(page, '06-06-cartao-de-uma-janela', { clip: page.getByTestId(`phase-card-${FOCUS_PHASE}`), pad: 10 });

  const chart = (name: string) => charts.getByRole('heading', { name }).locator('xpath=..');
  const rainChart = chart('Chuva, ETc e ETc ajustada (mm/dia)');
  await shot(page, '06-07-grafico-chuva-e-etc', { clip: rainChart });
  await shot(page, '06-08-grafico-deplecao', { clip: chart('Depleção (Dr) × RAW × TAW (mm)') });
  await shot(page, '06-09-grafico-ks', { clip: chart('Coeficiente de estresse (Ks)') });
  await rainChart.scrollIntoViewIfNeeded();
  const plot = (await rainChart.locator('.recharts-wrapper').boundingBox())!;
  await page.mouse.move(plot.x + plot.width * 0.56, plot.y + plot.height * 0.45);
  await expect(rainChart.locator('.recharts-tooltip-wrapper')).toBeVisible();
  await shot(page, '06-10-detalhe-do-dia', { clip: rainChart, settle: 500 });
  await page.mouse.move(10, 10);

  // bloco Produtividade: Ym, redução por janela, índice do ciclo e produtividade predita
  await expect(yieldBlock.getByTestId('yield-ym')).toContainText('sc/ha');
  await shot(page, '06-11-produtividade', { clip: yieldBlock });

  // cartão "Água no solo na emergência" (entressafra, motor 2.2.0): espera a chuva dos 30 dias carregar
  const soilWater = page.getByTestId('soil-water-card');
  await expect(soilWater.getByTestId('soil-water-headline')).toContainText('% da água disponível', { timeout: 20_000 });
  await expect(soilWater.getByTestId('soil-water-rain')).toContainText('mm', { timeout: 20_000 });
  await shot(page, '06-12-agua-no-solo', { clip: soilWater, pad: 10 });
  const soilWaterOnScreen = {
    headline: (await soilWater.getByTestId('soil-water-headline').innerText()).trim(),
    depletionText: (await soilWater.getByTestId('soil-water-depletion').innerText()).trim(),
    rainText: (await soilWater.getByTestId('soil-water-rain').innerText()).trim(),
  };

  // alternador "Mostrar entressafra": faixa cinza "Entressafra" nos gráficos; depois volta ao padrão
  const togglePreSeason = page.getByTestId('toggle-preseason');
  await expect(togglePreSeason).toBeEnabled();
  await togglePreSeason.check();
  await expect(charts.getByText('Entressafra', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1800); // animação de entrada dos gráficos com a série maior
  await shot(page, '06-13-entressafra-nos-graficos', { clip: charts });
  await togglePreSeason.uncheck();
  await expect(charts.getByText('Entressafra', { exact: true })).toHaveCount(0, { timeout: 20_000 });

  await shot(page, '06-18-exportar', { clip: header, highlight: [page.getByRole('button', { name: 'Exportar série diária' }), page.getByRole('button', { name: 'Exportar resumos' })] });
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar série diária' }).click()]);
  ctx.capture.csvFile = download.suggestedFilename().replace(/-[0-9a-f]{8}\.csv$/, '-<run>.csv');

  const history = page.getByRole('region', { name: 'Histórico de runs' });
  await shot(page, '06-19-historico', { clip: history, highlight: history.getByRole('button', { name: 'Ver série' }).first() });
  await shot(page, '06-20-reprocessar', { clip: header, highlight: page.getByRole('button', { name: 'Reprocessar' }) });

  // valores citados no texto do capítulo 6 (como aparecem na tela e como a API devolve)
  const yieldOnScreen = {
    ymText: (await yieldBlock.getByTestId('yield-ym').innerText()).trim(),
    yieldIndexPct: (await yieldBlock.getByTestId('yield-index').innerText()).trim(),
    predicted: (await yieldBlock.getByTestId('yield-predicted').innerText()).trim(),
    partial: await yieldBlock.getByTestId('yield-partial').count() > 0,
  };

  // safra sem dados suficientes
  await page.goto(`/safras/${ctx.harvest2Id}`);
  const noData = page.getByRole('heading', { name: 'Sem processamento do MSA' }).locator('xpath=..');
  await expect(noData).toBeVisible({ timeout: 30_000 });
  await shot(page, '06-21-dados-insuficientes', { highlight: noData });

  const token = session.get();
  const latest = await apiJson<Latest>(`/harvests/${ctx.harvest1Id}/msa`, { token });
  expect(latest.run.expectedYield).toBe(EXPECTED_YIELD);
  expect(latest.run.predictedYield).not.toBeNull();
  Object.assign(ctx.capture, {
    emergence: EMERGENCE,
    season: SEASON,
    cell: CELL,
    run: { dateFrom: latest.run.dateFrom, dateTo: latest.run.dateTo },
    currentPhase: latest.currentPhase,
    phases: latest.phases.map((p) => ({ phase: p.phase, days: p.days, ksMean: p.ksMean, yieldReductionPct: p.yieldReductionPct, etcAdjAccum: p.etcAdjAccum, precipAccum: p.precipAccum })),
    yield: {
      ym: latest.run.expectedYield,
      yieldIndex: latest.run.yieldIndex,
      predictedYield: latest.run.predictedYield,
      phasesReached: latest.run.phasesReached,
      ...yieldOnScreen,
    },
    soilWater: {
      preSeasonFrom: latest.run.preSeasonFrom,
      preSeasonKc: latest.run.preSeasonKc,
      preSeasonZr: latest.run.preSeasonZr,
      depletionMm: latest.run.emergenceDepletionMm,
      depletionPct: latest.run.emergenceDepletionPct,
      ...soilWaterOnScreen,
    },
  });
});

test('capítulo 7 — administração', async ({ page }) => {
  const admin = adminCredentials();
  await login(page, admin.email, admin.password);
  await page.getByRole('link', { name: 'Usuários' }).click();
  await expect(page.getByRole('heading', { name: 'Usuários' })).toBeVisible();
  await page.locator('#u-q').fill('manual.fertilizacerrado'); // só as contas de demonstração aparecem na imagem
  const row = page.getByTestId(`user-row-${DEMO.carla.email}`);
  await expect(row).toBeVisible();
  await expect(page.getByTestId('users-table').locator('tbody tr')).toHaveCount(3);
  await shot(page, '07-01-usuarios', { highlight: page.locator('#u-q').locator('xpath=../..') });
  await row.getByRole('button', { name: 'Editar' }).click();
  await expect(page.locator('#e-name')).toHaveValue(DEMO.carla.name);
  await shot(page, '07-02-editar-usuario', { highlight: field(page, 'e-role') });
  await dialogButton(page, 'Cancelar').click();
  await shot(page, '07-03-botao-desativar', { highlight: row.getByRole('button', { name: 'Desativar' }) });
  await row.getByRole('button', { name: 'Desativar' }).click();
  await expect(page.getByText('não poderá mais entrar')).toBeVisible();
  await shot(page, '07-04-desativar-usuario');
  await dialogButton(page, 'Cancelar').click();

  await page.getByRole('link', { name: 'Admin', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Administração' })).toBeVisible();
  await expect(page.getByText('era5-ingest')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Estações', exact: true })).toBeVisible();
  await shot(page, '07-05-filas', { highlight: page.locator('table').first().locator('xpath=..') });
  const actions = page.getByRole('heading', { name: 'Ingestão ERA5-Land' }).locator('xpath=../..');
  await shot(page, '07-06-ingestao-e-processamento', { clip: actions });
  await shot(page, '07-07-backfill-regional', { clip: page.getByRole('heading', { name: 'Backfill regional (ERA5-Land)' }).locator('xpath=..') });
  await shot(page, '07-08-estacoes-e-calibracao', { clip: page.getByRole('region', { name: 'Estações e correção de viés' }) });
  await page.getByRole('button', { name: 'Processar todas as safras ativas' }).click();
  await expect(page.getByText('Enfileira o reprocessamento de todas as safras ativas')).toBeVisible();
  await shot(page, '07-09-confirmar-processamento');
  await dialogButton(page, 'Cancelar').click(); // nada é enfileirado
});

test('visão do produtor (somente leitura)', async ({ page }) => {
  await login(page, DEMO.joao.email, PASSWORD);
  await expect(page.getByRole('link', { name: new RegExp(PROPERTY_NAME) })).toBeVisible();
  await shot(page, '02-08-visao-do-produtor');
  await page.goto(`/safras/${ctx.harvest1Id}`);
  await expect(page.getByRole('heading', { name: 'Módulo agrometeorológico (MSA)' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('yield-predicted')).toContainText('sc/ha', { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Reprocessar' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Editar produtividade potencial' })).toHaveCount(0);
  await expect(page.getByTestId('yield-inform-link')).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, '06-22-painel-do-produtor', { settle: 1200 });
});

test('publica as imagens e o captura.json', () => {
  // só chega aqui se todos os capítulos passaram (modo serial): nada de imagens parciais
  mkdirSync(IMG_DIR, { recursive: true });
  for (const f of readdirSync(IMG_DIR)) if (f.endsWith('.png') || f === CAPTURE_JSON) rmSync(join(IMG_DIR, f));
  const shots = takenShots();
  for (const name of shots) copyFileSync(join(STAGING_DIR, `${name}.png`), join(IMG_DIR, `${name}.png`));
  writeFileSync(join(IMG_DIR, CAPTURE_JSON), `${JSON.stringify({ ...ctx.capture, images: shots }, null, 2)}\n`);
  expect(shots.length).toBeGreaterThan(50);
});
