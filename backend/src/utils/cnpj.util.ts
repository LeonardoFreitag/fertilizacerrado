// 12 posições alfanuméricas (raiz + ordem) seguidas de 2 dígitos verificadores numéricos.
const CNPJ_PATTERN = /^[0-9A-Z]{2}\.?[0-9A-Z]{3}\.?[0-9A-Z]{3}\/?[0-9A-Z]{4}-?\d{2}$/;

/** Remove a pontuação e converte para maiúsculas. */
export function normalizeCnpj(value: string): string {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/** Aplica a máscara 00.000.000/0000-00 a um CNPJ já normalizado. */
export function formatCnpj(value: string): string {
  return normalizeCnpj(value).replace(
    /^([0-9A-Z]{2})([0-9A-Z]{3})([0-9A-Z]{3})([0-9A-Z]{4})(\d{2})$/,
    '$1.$2.$3/$4-$5',
  );
}

/**
 * Valida um CNPJ pelo algoritmo oficial da Receita Federal, na versão que
 * cobre o CNPJ alfanumérico (retrocompatível com o numérico).
 * Aceita a entrada com ou sem pontuação, em maiúsculas ou minúsculas.
 */
export function isValidCnpj(value: string): boolean {
  const input = value.trim().toUpperCase();
  if (!CNPJ_PATTERN.test(input)) return false;

  const cnpj = normalizeCnpj(input);
  if (/^(.)\1{13}$/.test(cnpj)) return false;

  const firstDigit = calculateCheckDigit(cnpj.slice(0, 12));
  const secondDigit = calculateCheckDigit(cnpj.slice(0, 12) + firstDigit);

  return cnpj.endsWith(`${firstDigit}${secondDigit}`);
}

// Cada caractere vale seu código ASCII menos 48 ('0' = 0, 'A' = 17).
// Pesos de 2 a 9, da direita para a esquerda, reiniciando após o 9.
function calculateCheckDigit(base: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    sum += (base.charCodeAt(i) - 48) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}
