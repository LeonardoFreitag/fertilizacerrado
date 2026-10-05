import { z } from 'zod';

// O bcrypt ignora tudo além de 72 bytes, por isso o teto é medido em bytes.
const BCRYPT_MAX_BYTES = 72;

export const passwordSchema = z
  .string()
  .min(8, 'deve ter no mínimo 8 caracteres')
  .regex(/[A-Z]/, 'deve conter ao menos uma letra maiúscula')
  .regex(/[0-9]/, 'deve conter ao menos um número')
  .regex(/[^A-Za-z0-9]/, 'deve conter ao menos um caractere especial')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= BCRYPT_MAX_BYTES, {
    message: 'deve ter no máximo 72 caracteres',
  });
