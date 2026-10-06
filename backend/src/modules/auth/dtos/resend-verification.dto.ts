import { z } from 'zod';

export const resendVerificationSchema = z.object({
  email: z.string().trim().toLowerCase().email('e-mail inválido'),
});

export type ResendVerificationDto = z.infer<typeof resendVerificationSchema>;
