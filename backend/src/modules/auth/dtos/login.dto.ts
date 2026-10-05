import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('e-mail inválido'),
  password: z.string().min(1, 'senha obrigatória'),
});

export type LoginDto = z.infer<typeof loginSchema>;
