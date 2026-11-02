import { defineConfig, devices } from '@playwright/test';

/**
 * Captura das telas do manual do usuário (`docs/manual/img/`). Roda no host contra a
 * stack de desenvolvimento, fora da suíte e2e e fora do CI: `pnpm manual:capture`.
 */
export default defineConfig({
  testDir: './e2e/manual',
  timeout: 12 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: './test-results/manual',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1.5, // nítido no PDF sem inflar o repositório
    locale: 'pt-BR',
    launchOptions: { args: ['--lang=pt-BR'] }, // campos de data no formato dd/mm/aaaa
    timezoneId: 'America/Sao_Paulo',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});
