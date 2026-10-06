import { z } from 'zod';
import { passwordSchema } from '../../auth/dtos/password.schema';

const uuid = z.string().uuid('identificador inválido');
export const userIdParamsSchema = z.object({ id: uuid });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v));

/** Campos que o ADMIN pode alterar; o próprio usuário só name/phone/crea (ver service). */
export const updateUserSchema = z
  .object({
    name: z.string().trim().min(2, 'deve ter no mínimo 2 caracteres').max(120).optional(),
    phone: optionalText(20),
    crea: optionalText(30),
    role: z.enum(['ADMIN', 'AGRONOMO', 'PRODUTOR']).optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'informe ao menos um campo');

export type UpdateUserDto = z.infer<typeof updateUserSchema>;
export const SELF_EDITABLE_FIELDS = ['name', 'phone', 'crea'] as const;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'informe a senha atual'),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, { path: ['newPassword'], message: 'a nova senha deve ser diferente da atual' });

export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;
