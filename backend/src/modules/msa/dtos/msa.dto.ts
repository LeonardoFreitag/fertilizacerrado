import { z } from 'zod';

const uuid = z.string().uuid('identificador inválido');

export const msaParamsSchema = z.object({ id: uuid });

export const processQuerySchema = z
  .object({
    /** true ⇒ processa inline (só ADMIN); padrão enfileira */
    sync: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
    // Motor determinístico: não há semente desde o 2.0.0.
    seed: z.undefined({ invalid_type_error: 'não existe mais; o processamento é determinístico' }),
  });

export const dailyQuerySchema = z.object({ runId: uuid.optional() });
