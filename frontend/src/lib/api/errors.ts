/** Códigos da API → mensagens pt-BR; nunca mostrar o JSON bruto. */
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './client';

const GENERIC = 'Não foi possível concluir. Tente novamente.';

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'E-mail ou senha inválidos.',
  EMAIL_NOT_VERIFIED: 'Confirme seu e-mail antes de entrar. Procure o link na sua caixa de entrada.',
  TOO_MANY_LOGIN_ATTEMPTS: 'Muitas tentativas de login.',
  TOO_MANY_REQUESTS: 'Muitas requisições. Aguarde um instante.',
  EMAIL_ALREADY_REGISTERED: 'Este e-mail já está cadastrado.',
  CPF_ALREADY_REGISTERED: 'Este CPF já está cadastrado.',
  CNPJ_ALREADY_REGISTERED: 'Este CNPJ já está cadastrado.',
  INVALID_TOKEN: 'Link inválido ou expirado.',
  INVALID_REFRESH_TOKEN: 'Sua sessão expirou. Entre novamente.',
  UNAUTHORIZED: 'Sua sessão expirou. Entre novamente.',
  FORBIDDEN: 'Você não tem permissão para esta ação.',
  NOT_FOUND: 'Registro não encontrado.',
  VALIDATION_ERROR: 'Verifique os campos destacados.',
  INVALID_OWNER: 'Produtor inválido.',
  INVALID_AGRONOMIST: 'Agrônomo inválido.',
  AGRONOMIST_WITHOUT_ACCESS: 'O agrônomo informado não tem acesso a esta propriedade.',
  FORBIDDEN_FIELDS: 'Você não pode alterar estes campos.',
  INVALID_GEOMETRY: 'Polígono inválido.',
  FIELD_HAS_ACTIVE_HARVEST: 'Este talhão tem safras; encerre-as ou remova-as antes.',
  FIELD_HAS_HARVESTS: 'Este talhão tem safras; encerre-as ou remova-as antes.',
  CONFLICT: 'Já existe um registro com estes dados.',
};

/** Campo do formulário associado a um código de conflito. */
const FIELD_BY_CODE: Record<string, string> = {
  EMAIL_ALREADY_REGISTERED: 'email',
  CPF_ALREADY_REGISTERED: 'cpf',
  CNPJ_ALREADY_REGISTERED: 'cnpj',
  INVALID_OWNER: 'ownerId',
  INVALID_AGRONOMIST: 'agronomistId',
};

export function formatRetryAfter(seconds: number): string {
  if (seconds >= 60) {
    const minutes = Math.ceil(seconds / 60);
    return `${minutes} minuto${minutes === 1 ? '' : 's'}`;
  }
  return `${seconds} segundo${seconds === 1 ? '' : 's'}`;
}

export function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      const base = MESSAGES[error.code] ?? MESSAGES.TOO_MANY_REQUESTS!;
      return error.retryAfter ? `${base} Tente novamente em ${formatRetryAfter(error.retryAfter)}.` : base;
    }
    if (error.status >= 500) return 'O servidor não respondeu como esperado. Tente novamente em instantes.';
    return MESSAGES[error.code] ?? GENERIC;
  }
  if (error instanceof TypeError) return 'Sem conexão com o servidor. Verifique sua rede.';
  return GENERIC;
}

/** Erros exibidos fora dos campos (ex.: 404, rede). */
export function isFieldError(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'VALIDATION_ERROR' || error.code in FIELD_BY_CODE);
}

/**
 * Distribui o erro da API nos campos do formulário (VALIDATION_ERROR `details`
 * e conflitos por campo). Devolve true se algum campo recebeu erro.
 */
export function applyFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fieldMap: Record<string, Path<T>> = {},
): boolean {
  if (!(error instanceof ApiError)) return false;
  let applied = false;
  if (error.details) {
    for (const [field, messages] of Object.entries(error.details)) {
      const target = fieldMap[field] ?? (field as Path<T>);
      const message = messages[0] ?? MESSAGES.VALIDATION_ERROR!;
      setError(target, { type: 'server', message });
      applied = true;
    }
  }
  const byCode = FIELD_BY_CODE[error.code];
  if (byCode) {
    setError((fieldMap[byCode] ?? byCode) as Path<T>, { type: 'server', message: MESSAGES[error.code] ?? GENERIC });
    applied = true;
  }
  return applied;
}
