import { Prisma } from '@prisma/client';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { env } from './config/env';
import { authRoutes } from './modules/auth/auth.routes';
import { cultivarRoutes } from './modules/cultivars/cultivar.routes';
import { harvestRoutes } from './modules/harvests/harvest.routes';
import { jobsRoutes } from './modules/jobs/jobs.routes';
import { propertyRoutes } from './modules/properties/property.routes';
import { userRoutes } from './modules/users/user.routes';
import { AppError } from './utils/app-error';

export const app = express();

// Necessário para req.ip refletir o cliente real atrás do Nginx.
app.set('trust proxy', 1);

app.use(helmet());
// credentials: o cookie do refresh token só trafega para a origem do frontend.
app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Liveness: não consulta banco nem Redis, para que uma indisponibilidade
// deles não faça o Docker reiniciar as réplicas da API.
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/properties', propertyRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/cultivars', cultivarRoutes);
app.use('/api/v1/harvests', harvestRoutes);
app.use('/api/v1/admin/jobs', jobsRoutes);

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not Found', code: 'NOT_FOUND', path: req.originalUrl });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    if (err.headers) res.set(err.headers);
    res.status(err.status).json({ error: err.message, code: err.code, ...(err.details ? { details: err.details } : {}) });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Dados inválidos.',
      code: 'VALIDATION_ERROR',
      details: err.flatten().fieldErrors,
    });
    return;
  }

  // Violação de unicidade: cobre a corrida entre a checagem e o INSERT.
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    res.status(409).json({ error: 'Registro já existente.', code: 'CONFLICT' });
    return;
  }

  // Erros 4xx do próprio Express (ex.: JSON malformado no body).
  const status = getErrorStatus(err);
  if (status < 500) {
    res.status(status).json({ error: 'Requisição inválida.', code: 'BAD_REQUEST' });
    return;
  }

  console.error(err);
  res.status(500).json({ error: 'Internal Server Error', code: 'INTERNAL_ERROR' });
});

function getErrorStatus(err: unknown): number {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const { status } = err as { status: unknown };
    if (typeof status === 'number' && status >= 400 && status < 600) return status;
  }
  return 500;
}
