import { z } from 'zod';
import { isValidCnpj, normalizeCnpj } from '../../../utils/cnpj.util';
import { isValidCpf, normalizeCpf } from '../../../utils/cpf.util';
import { passwordSchema } from './password.schema';

export const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'deve ter no mínimo 2 caracteres').max(120),
    email: z.string().trim().toLowerCase().email('e-mail inválido'),
    password: passwordSchema,
    // ADMIN não pode ser criado pelo cadastro público.
    role: z.enum(['AGRONOMO', 'PRODUTOR']),
    // Usado apenas na validação; não é persistido.
    personType: z.enum(['PF', 'PJ']).optional(),
    cpf: z.string().refine(isValidCpf, 'CPF inválido').transform(normalizeCpf).optional(),
    cnpj: z.string().refine(isValidCnpj, 'CNPJ inválido').transform(normalizeCnpj).optional(),
    crea: z.string().trim().min(1).max(30).optional(),
    phone: z.string().trim().min(8).max(20).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.personType === 'PJ' && !value.cnpj) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cnpj'],
        message: 'CNPJ é obrigatório para pessoa jurídica',
      });
      return;
    }

    if (value.personType === 'PF' && !value.cpf) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cpf'],
        message: 'CPF é obrigatório para pessoa física',
      });
      return;
    }

    if (!value.cpf && !value.cnpj) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cpf'],
        message: 'informe CPF ou CNPJ',
      });
    }
  });

export type RegisterDto = z.infer<typeof registerSchema>;
