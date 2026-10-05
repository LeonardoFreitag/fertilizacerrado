/** Espelho dos DTOs do backend (validação imediata; a API continua a fonte de verdade). */
import { z } from 'zod';
import { isValidCnpj, isValidCpf, onlyDigits } from './documents';

export const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

export const PASSWORD_RULES = [
  { id: 'min', label: 'Pelo menos 8 caracteres', test: (v: string) => v.length >= 8 },
  { id: 'upper', label: 'Uma letra maiúscula', test: (v: string) => /[A-Z]/.test(v) },
  { id: 'digit', label: 'Um número', test: (v: string) => /[0-9]/.test(v) },
  { id: 'special', label: 'Um caractere especial', test: (v: string) => /[^A-Za-z0-9]/.test(v) },
] as const;

export const passwordSchema = z
  .string()
  .min(8, 'deve ter no mínimo 8 caracteres')
  .regex(/[A-Z]/, 'deve conter ao menos uma letra maiúscula')
  .regex(/[0-9]/, 'deve conter ao menos um número')
  .regex(/[^A-Za-z0-9]/, 'deve conter ao menos um caractere especial')
  .refine((v) => new TextEncoder().encode(v).length <= 72, 'deve ter no máximo 72 caracteres');

export const emailSchema = z.string().trim().toLowerCase().email('e-mail inválido');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'informe a senha'),
});
export type LoginForm = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'deve ter no mínimo 2 caracteres').max(120, 'deve ter no máximo 120 caracteres'),
    email: emailSchema,
    password: passwordSchema,
    role: z.enum(['AGRONOMO', 'PRODUTOR'], { errorMap: () => ({ message: 'escolha o perfil' }) }),
    personType: z.enum(['PF', 'PJ']),
    cpf: z.string().optional(),
    cnpj: z.string().optional(),
    crea: z.string().trim().max(30, 'deve ter no máximo 30 caracteres').optional(),
    phone: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.personType === 'PF') {
      if (!v.cpf || onlyDigits(v.cpf).length === 0) ctx.addIssue({ code: 'custom', path: ['cpf'], message: 'CPF é obrigatório para pessoa física' });
      else if (!isValidCpf(v.cpf)) ctx.addIssue({ code: 'custom', path: ['cpf'], message: 'CPF inválido' });
    } else {
      if (!v.cnpj || onlyDigits(v.cnpj).length === 0) ctx.addIssue({ code: 'custom', path: ['cnpj'], message: 'CNPJ é obrigatório para pessoa jurídica' });
      else if (!isValidCnpj(v.cnpj)) ctx.addIssue({ code: 'custom', path: ['cnpj'], message: 'CNPJ inválido' });
    }
    if (v.phone && onlyDigits(v.phone).length > 0 && onlyDigits(v.phone).length < 10) {
      ctx.addIssue({ code: 'custom', path: ['phone'], message: 'telefone incompleto' });
    }
  });
export type RegisterForm = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordForm = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'as senhas não coincidem' });
export type ResetPasswordForm = z.infer<typeof resetPasswordSchema>;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `deve ter no máximo ${max} caracteres`)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined));

export const propertySchema = z.object({
  name: z.string().trim().min(2, 'deve ter no mínimo 2 caracteres').max(120, 'deve ter no máximo 120 caracteres'),
  state: z.enum(UFS, { errorMap: () => ({ message: 'UF inválida' }) }),
  city: z.string().trim().min(2, 'deve ter no mínimo 2 caracteres').max(120, 'deve ter no máximo 120 caracteres'),
  car: optionalText(60),
  nirf: optionalText(60),
  ownerId: z.string().uuid().optional().or(z.literal('')),
});
export type PropertyForm = z.infer<typeof propertySchema>;

/** Campo numérico de formulário: string vazia ⇒ undefined. */
const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess((v) => {
    if (v === '' || v === null || v === undefined) return undefined;
    if (typeof v === 'string') return Number(v.replace(',', '.'));
    return v;
  }, schema.optional());

export const MIN_AREA_HA = 0.01;
export const MAX_AREA_HA = 1_000_000;
export const SOIL_DEFAULTS = { thetaFC: 0.28, thetaWP: 0.12 } as const;

export const fieldSchema = z
  .object({
    name: z.string().trim().min(1, 'obrigatório').max(120, 'deve ter no máximo 120 caracteres'),
    soilType: optionalText(60),
    notes: optionalText(2000),
    areaHa: optionalNumber(z.number().min(MIN_AREA_HA, `deve ser no mínimo ${MIN_AREA_HA} ha`).max(MAX_AREA_HA, 'deve ser no máximo 1.000.000 ha')),
    altitudeM: optionalNumber(z.number().min(-100, 'deve ser no mínimo -100 m').max(5000, 'deve ser no máximo 5000 m')),
    thetaFC: optionalNumber(z.number().gt(0, 'deve ser maior que 0').lt(1, 'deve ser menor que 1')),
    thetaWP: optionalNumber(z.number().gt(0, 'deve ser maior que 0').lt(1, 'deve ser menor que 1')),
  })
  .superRefine((v, ctx) => {
    if (v.thetaFC != null && v.thetaWP != null && v.thetaFC <= v.thetaWP) {
      ctx.addIssue({ code: 'custom', path: ['thetaFC'], message: 'deve ser maior que θWP' });
    }
  });
export type FieldForm = z.infer<typeof fieldSchema>;
export type FieldFormInput = z.input<typeof fieldSchema>;
