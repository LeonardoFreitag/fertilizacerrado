import { z } from 'zod';

export const USERS_DEFAULT_LIMIT = 20;
export const USERS_MAX_LIMIT = 50;

export const listUsersQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  role: z.enum(['ADMIN', 'AGRONOMO', 'PRODUTOR']).optional(),
  limit: z.coerce.number().int().min(1).max(USERS_MAX_LIMIT).default(USERS_DEFAULT_LIMIT),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
