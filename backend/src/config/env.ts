import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

// Fora do Docker o .env pode estar em backend/ ou na raiz do repositório.
// Variáveis já definidas no ambiente (ex.: injetadas pelo Compose) têm precedência.
dotenv.config({
  path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../.env')],
  quiet: true,
});

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    APP_URL: z.string().url().default('http://localhost:3000'),
    FRONTEND_URL: z.string().url().default('http://localhost:5173'),

    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    /** Volume compartilhado com o ETL para os CSVs de observações (upload) */
    STATION_IMPORTS_DIR: z.string().min(1).default('./station-imports'),

    JWT_SECRET: z.string().min(32, 'deve ter no mínimo 32 caracteres'),
    JWT_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_SECRET: z.string().min(32, 'deve ter no mínimo 32 caracteres'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_FROM: z.string().email().default('noreply@dominio.com.br'),

    // Usadas apenas por prisma/seed.ts; a aplicação não as lê.
    ADMIN_EMAIL: z.string().trim().toLowerCase().email().optional(),
    ADMIN_PASSWORD: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== 'production') return;

    for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'] as const) {
      if (!value[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: 'obrigatória em produção',
        });
      }
    }
  });

// O Compose repassa variáveis não preenchidas do .env como string vazia;
// tratá-las como ausentes permite que defaults e opcionais funcionem.
const rawEnv = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== ''),
);

const parsed = envSchema.safeParse(rawEnv);

if (!parsed.success) {
  console.error('Variáveis de ambiente inválidas:');
  for (const [key, messages] of Object.entries(parsed.error.flatten().fieldErrors)) {
    console.error(`  ${key}: ${(messages ?? []).join(', ')}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
