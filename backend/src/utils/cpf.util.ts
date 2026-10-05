const CPF_PATTERN = /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/;

/** Remove a pontuação, mantendo apenas os dígitos. */
export function normalizeCpf(value: string): string {
  return value.replace(/\D/g, '');
}

/** Aplica a máscara 000.000.000-00 a um CPF já normalizado. */
export function formatCpf(value: string): string {
  return normalizeCpf(value).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

/**
 * Valida um CPF pelos dois dígitos verificadores (módulo 11).
 * Aceita a entrada com ou sem pontuação.
 */
export function isValidCpf(value: string): boolean {
  const input = value.trim();
  if (!CPF_PATTERN.test(input)) return false;

  const cpf = normalizeCpf(input);
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const firstDigit = calculateCheckDigit(cpf.slice(0, 9));
  const secondDigit = calculateCheckDigit(cpf.slice(0, 9) + firstDigit);

  return cpf.endsWith(`${firstDigit}${secondDigit}`);
}

// Pesos decrescentes a partir de (tamanho + 1) até 2.
function calculateCheckDigit(base: string): number {
  let sum = 0;
  for (let i = 0; i < base.length; i++) {
    sum += Number(base[i]) * (base.length + 1 - i);
  }
  const remainder = (sum * 10) % 11;
  return remainder === 10 ? 0 : remainder;
}
