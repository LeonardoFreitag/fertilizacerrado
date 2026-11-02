/// <reference lib="dom" />
/**
 * Apoio à captura das telas do manual (`capture.spec.ts`): caminhos, dados de
 * demonstração, limpeza, chamadas à API e o `shot()` que grava cada imagem.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page } from '@playwright/test';

export const ROOT = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '');
export const MANUAL_DIR = join(ROOT, 'docs', 'manual');
export const IMG_DIR = join(MANUAL_DIR, 'img');
/** As imagens são gravadas aqui e só publicadas em docs/manual/img se a captura inteira passar. */
export const STAGING_DIR = join(ROOT, 'frontend', 'test-results', 'manual', 'img');
export const CAPTURE_JSON = 'captura.json';
export const API = (process.env.E2E_BASE_URL ?? 'http://localhost') + '/api/v1';

/** Domínio reservado: tudo o que pertence a estes usuários é apagado por cleanup-demo.sql. */
export const DEMO_DOMAIN = 'manual.fertilizacerrado.local';
export const PASSWORD = 'Cerrado@2026';
export const NEW_PASSWORD = 'Safra#2026';
export const DEMO = {
  ana: { name: 'Ana Ribeiro', email: `ana.ribeiro@${DEMO_DOMAIN}`, role: 'AGRONOMO', cpfSeed: 318_204_957, crea: 'GO-12345/D', phone: '62991234567' },
  joao: { name: 'João Batista', email: `joao.batista@${DEMO_DOMAIN}`, role: 'PRODUTOR', cpfSeed: 427_915_306, crea: undefined, phone: '62998765432' },
  carla: { name: 'Carla Mendes', email: `carla.mendes@${DEMO_DOMAIN}`, role: 'AGRONOMO', cpfSeed: 536_128_470, crea: 'GO-23456/D', phone: '62993456789' },
} as const;
export const PROPERTY_NAME = 'Fazenda Boa Vista';
export const FIELD_1 = 'Talhão 1 — Sede';
export const FIELD_2 = 'Talhão 2 — Baixada';
export const FIELD_3 = 'Talhão 3 — Divisa';
export const OWN_CULTIVAR = 'Soja precoce — Boa Vista';
export const EMERGENCE = '2025-10-01';
export const SEASON = '2025/26';
/** Célula ERA5-Land em cache (Goiânia): centro −16,7; −49,3. */
export const CELL = { lat: -16.7, lon: -49.3 };
const ring = (points: ReadonlyArray<readonly [number, number]>) => ({ type: 'Polygon' as const, coordinates: [[...points, points[0]!].map(([lon, lat]) => [lon, lat])] });
/**
 * Os talhões ficam na borda oeste da célula, no único trecho de pasto aberto dela
 * (o restante é área urbana de Goiânia): assim a imagem de satélite mostra campo.
 */
export const FIELD_2_GEOMETRY = ring([[-49.34698, -16.7015], [-49.34442, -16.70232], [-49.3426, -16.70365], [-49.34666, -16.7058], [-49.34688, -16.70396]]);
export const FIELD_3_GEOMETRY = ring([[-49.3486, -16.7126], [-49.3462, -16.7126], [-49.3462, -16.7152], [-49.3486, -16.7152]]);
/** Contorno do Talhão 1 (lat, lon), desenhado com cliques no mapa. */
export const FIELD_1_OUTLINE: ReadonlyArray<readonly [number, number]> = [
  [-16.70724, -49.34474], [-16.70642, -49.3411], [-16.70847, -49.33918], [-16.7104, -49.33939], [-16.7105, -49.34324], [-16.70929, -49.34495],
];
/** Lados que se cruzam (erro comum de desenho), na mesma área. */
export const CROSSED_OUTLINE: ReadonlyArray<readonly [number, number]> = [[-16.7068, -49.3445], [-16.7096, -49.3398], [-16.7068, -49.3398], [-16.7103, -49.3445]];

export function validCpf(seed: number): string {
  const base = String(seed).padStart(9, '0').slice(-9).split('').map(Number);
  const dv = (digits: number[], start: number) => {
    const rest = (digits.reduce((acc, d, i) => acc + d * (start - i), 0) * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const d1 = dv(base, 10);
  return [...base, d1, dv([...base, d1], 11)].join('');
}

export function compose(cmd: string, input?: string): string {
  return execSync(`docker compose ${cmd}`, { cwd: ROOT, encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
}

function psql(sql: string): string {
  return compose(`exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -q -At -U "$POSTGRES_USER" -d "$POSTGRES_DB"'`, sql).trim();
}

/** Apaga só os dados de demonstração (ver backend/scripts/manual/cleanup-demo.sql). */
export function cleanupDemo(): void {
  psql(readFileSync(join(ROOT, 'backend', 'scripts', 'manual', 'cleanup-demo.sql'), 'utf8'));
}

export function demoResidue(): number {
  return Number(psql(`select count(*) from users where email like '%@${DEMO_DOMAIN}'`));
}

/**
 * Pré-requisitos: o cache do ETL precisa ter os meses da célula de Goiânia desde a
 * emergência. Sem ERA5_E2E_CDS=1, o mês aberto passa a contar como "baixado hoje",
 * para a captura nunca ir ao CDS.
 */
export function assertCachePrerequisite(): void {
  const files = compose(`exec -T etl sh -c "find /data/cache -name '*.nc' | sed 's|.*/||' | sort -u"`).split('\n').filter(Boolean);
  const needed: string[] = [];
  // Lag do ERA5-Land (~6 dias, como DATA_LAG_DAYS do backend): nos primeiros dias
  // do mês o mês anterior basta — o MSA só processa até hoje − 6.
  const end = new Date(Date.now() - 6 * 86_400_000);
  for (let d = new Date(`${EMERGENCE.slice(0, 7)}-01T12:00:00Z`); d <= end; d.setUTCMonth(d.getUTCMonth() + 1)) needed.push(d.toISOString().slice(0, 7));
  const missing = needed.filter((m) => !files.includes(`${m}.nc`));
  if (missing.length > 0) {
    throw new Error(
      `Cache do ETL sem os meses ${missing.join(', ')} da célula de Goiânia (${CELL.lat}; ${CELL.lon}). ` +
        'Rode um backfill da célula antes (docs/msa/era5-etl.md) — a captura do manual não contacta o CDS.',
    );
  }
  if (!process.env.ERA5_E2E_CDS) compose(`exec -T etl sh -c "find /data/cache -name '*.nc' -exec touch {} +"`);
}

/** Último link enviado "por e-mail" (em dev, o mailer só registra no log da API). */
export async function lastMailLink(kind: 'verificar-email' | 'redefinir-senha'): Promise<string> {
  const pattern = kind === 'verificar-email' ? /verificar-email\/([A-Za-z0-9._-]+)/g : /redefinir-senha\?token=([A-Za-z0-9._-]+)/g;
  for (let attempt = 0; attempt < 10; attempt++) {
    const matches = compose('logs --no-log-prefix --since 10m api').match(pattern) ?? [];
    const last = matches[matches.length - 1];
    if (last) return `/${last}`;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`link de ${kind} não encontrado no log da API`);
}

export async function apiJson<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Cadastra e verifica um usuário de demonstração pela API. */
export async function seedUser(who: keyof typeof DEMO): Promise<void> {
  const u = DEMO[who];
  await apiJson('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: u.name, email: u.email, password: PASSWORD, role: u.role, personType: 'PF', cpf: validCpf(u.cpfSeed), crea: u.crea, phone: u.phone }),
  });
  await new Promise((r) => setTimeout(r, 600));
  await apiJson((await lastMailLink('verificar-email')).replace('/verificar-email/', '/auth/verify-email/'));
}

/** Guarda o access token da sessão da própria página (login/refresh), para chamadas de apoio à API sem derrubar a sessão. */
export function trackToken(page: Page): { get: () => string } {
  let token = '';
  page.on('response', (res) => {
    if (res.ok() && /\/auth\/(login|refresh)$/.test(new URL(res.url()).pathname)) {
      void res.json().then((body: { accessToken?: string }) => {
        if (body.accessToken) token = body.accessToken;
      }).catch(() => undefined);
    }
  });
  return {
    get: () => {
      if (!token) throw new Error('sessão sem access token capturado');
      return token;
    },
  };
}

export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/entrar');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/propriedades$/);
  await expect(page.getByRole('heading', { name: 'Propriedades' })).toBeVisible();
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/entrar/);
}

export function adminCredentials(): { email: string; password: string } {
  const env = readFileSync(join(ROOT, '.env'), 'utf8');
  const get = (k: string) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '';
  return { email: get('ADMIN_EMAIL'), password: get('ADMIN_PASSWORD') };
}

// --- mapa -------------------------------------------------------------------

/** Espera os tiles visíveis carregarem; falha com mensagem clara em vez de fotografar um mapa cinza. */
export async function waitForTiles(page: Page, timeout = 45_000): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        const tiles = Array.from(document.querySelectorAll('.leaflet-tile-pane img.leaflet-tile'));
        return tiles.length > 0 && tiles.every((t) => t.classList.contains('leaflet-tile-loaded'));
      },
      null,
      { timeout },
    );
  } catch {
    throw new Error(`Os tiles do mapa não carregaram em ${timeout / 1000} s (sem internet ou servidor de tiles fora do ar). A imagem não foi gravada.`);
  }
  await page.waitForTimeout(700); // fade-in dos tiles
}

/**
 * Converte lat/lon em coordenadas da janela a partir de um tile já carregado (o endereço
 * do tile dá z/x/y; sua posição na tela dá a origem), sem depender do centro ou do zoom.
 */
async function mapProjector(page: Page): Promise<(lat: number, lon: number) => { x: number; y: number }> {
  const ref = await page.evaluate(() => {
    for (const img of Array.from(document.querySelectorAll<HTMLImageElement>('.leaflet-tile-pane img.leaflet-tile-loaded'))) {
      const esri = img.src.match(/\/tile\/(\d+)\/(\d+)\/(\d+)/);
      const osm = img.src.match(/\/(\d+)\/(\d+)\/(\d+)\.png/);
      const r = img.getBoundingClientRect();
      if (esri) return { z: Number(esri[1]), y: Number(esri[2]), x: Number(esri[3]), left: r.left, top: r.top, size: r.width };
      if (osm) return { z: Number(osm[1]), x: Number(osm[2]), y: Number(osm[3]), left: r.left, top: r.top, size: r.width };
    }
    return null;
  });
  if (!ref) throw new Error('nenhum tile carregado para localizar pontos no mapa');
  const n = 2 ** ref.z;
  return (lat, lon) => {
    const wx = ((lon + 180) / 360) * n;
    const wy = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
    return { x: ref.left + (wx - ref.x) * ref.size, y: ref.top + (wy - ref.y) * ref.size };
  };
}

/** Arrasta o mapa até o ponto (lat, lon) ficar no centro. */
export async function centerMapOn(page: Page, lat: number, lon: number): Promise<void> {
  const map = page.getByTestId('map');
  await map.scrollIntoViewIfNeeded();
  const box = await map.boundingBox();
  if (!box) throw new Error('mapa sem dimensões');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const target = (await mapProjector(page))(lat, lon);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - (target.x - cx), cy - (target.y - cy), { steps: 15 });
  await page.waitForTimeout(400); // parado antes de soltar: sem inércia
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/** Clica no mapa nos pontos (lat, lon) dados. */
export async function clickMap(page: Page, points: ReadonlyArray<readonly [number, number]>): Promise<void> {
  const map = page.getByTestId('map');
  await map.scrollIntoViewIfNeeded();
  const box = await map.boundingBox();
  if (!box) throw new Error('mapa sem dimensões');
  const project = await mapProjector(page);
  for (const [lat, lon] of points) {
    const p = project(lat, lon);
    if (p.x < box.x + 60 || p.x > box.x + box.width - 60 || p.y < box.y + 10 || p.y > box.y + box.height - 30) throw new Error(`ponto ${lat}; ${lon} fora da área útil do mapa`);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(180);
  }
}

// --- captura ----------------------------------------------------------------

const taken = new Set<string>();
export const takenShots = (): string[] => [...taken].sort();

export function resetStaging(): void {
  rmSync(STAGING_DIR, { recursive: true, force: true });
  mkdirSync(STAGING_DIR, { recursive: true });
  taken.clear();
}

const HIGHLIGHT = 'outline: 3px solid #e11d48 !important; outline-offset: 4px !important; border-radius: 6px;';

export interface ShotOptions {
  /** Elemento(s) descritos no passo: recebem uma borda (outline não desloca o layout) */
  highlight?: Locator | Locator[];
  /** Recorta a imagem neste elemento (com margem), em vez da tela inteira */
  clip?: Locator;
  /** Página inteira, não só a área visível */
  fullPage?: boolean;
  /** Mantém os avisos temporários (toasts) na imagem */
  keepToast?: boolean;
  /** Espera extra antes de fotografar (animações em JS, como as dos gráficos) */
  settle?: number;
  /** Margem do recorte, em px */
  pad?: number;
}

/** Grava `<nome>.png`. Nomes estáveis: `<capítulo>-<sequência>-<slug>`. */
export async function shot(page: Page, name: string, opts: ShotOptions = {}): Promise<void> {
  if (!/^\d{2}-\d{2}-[a-z0-9-]+$/.test(name)) throw new Error(`nome de imagem fora do padrão: ${name}`);
  if (taken.has(name)) throw new Error(`imagem duplicada: ${name}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => undefined); // telas com polling nunca ficam ociosas
  if (!opts.keepToast) await expect(page.locator('[aria-live="polite"] [role="status"]')).toHaveCount(0, { timeout: 9000 });
  const marks = opts.highlight ? (Array.isArray(opts.highlight) ? opts.highlight : [opts.highlight]) : [];
  for (const m of marks) {
    await m.first().scrollIntoViewIfNeeded();
    await m.first().evaluate((el, css) => {
      const h = el as HTMLElement;
      h.dataset.manualPrev = h.getAttribute('style') ?? '';
      h.setAttribute('style', `${h.dataset.manualPrev};${css}`);
    }, HIGHLIGHT);
  }
  if (opts.clip) await opts.clip.scrollIntoViewIfNeeded();
  await page.waitForTimeout(opts.settle ?? 350);
  const path = join(STAGING_DIR, `${name}.png`);
  const common = { path, animations: 'disabled', caret: 'hide' } as const;
  if (opts.clip) {
    const box = await opts.clip.boundingBox();
    if (!box) throw new Error(`recorte sem dimensões: ${name}`);
    const pad = opts.pad ?? 14;
    const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY, w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
    const x = Math.max(0, box.x + scroll.x - pad);
    const y = Math.max(0, box.y + scroll.y - pad);
    await page.screenshot({ ...common, fullPage: true, clip: { x, y, width: Math.min(box.width + 2 * pad, scroll.w - x), height: Math.min(box.height + 2 * pad, scroll.h - y) } });
  } else {
    await page.screenshot({ ...common, fullPage: opts.fullPage ?? false });
  }
  for (const m of marks) {
    await m.first().evaluate((el) => {
      const h = el as HTMLElement;
      if (h.dataset.manualPrev) h.setAttribute('style', h.dataset.manualPrev);
      else h.removeAttribute('style');
      delete h.dataset.manualPrev;
    }).catch(() => undefined);
  }
  taken.add(name);
}
