import { z } from 'zod';

export const USERS_DEFAULT_PAGE_SIZE = 20;
export const USERS_MAX_PAGE_SIZE = 50;

export const listUsersQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  role: z.enum(['ADMIN', 'AGRONOMO', 'PRODUTOR']).optional(),
  active: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(USERS_MAX_PAGE_SIZE).default(USERS_DEFAULT_PAGE_SIZE),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
