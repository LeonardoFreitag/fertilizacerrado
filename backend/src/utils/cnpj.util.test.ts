import { describe, expect, it } from 'vitest';
import { formatCnpj, isValidCnpj, normalizeCnpj } from './cnpj.util';

describe('isValidCnpj', () => {
  it('aceita CNPJ numérico válido com e sem pontuação', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11222333000181')).toBe(true);
  });

  it('aceita CNPJ alfanumérico válido', () => {
    // Exemplo publicado pela Receita Federal para o novo formato.
    expect(isValidCnpj('12.ABC.345/01DE-35')).toBe(true);
    expect(isValidCnpj('12ABC34501DE35')).toBe(true);
  });

  it('não distingue maiúsculas de minúsculas', () => {
    expect(isValidCnpj('12.abc.345/01de-35')).toBe(true);
  });

  it('rejeita dígito verificador incorreto', () => {
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false);
    expect(isValidCnpj('12.ABC.345/01DE-36')).toBe(false);
  });

  it('rejeita letra nos dígitos verificadores', () => {
    expect(isValidCnpj('12.ABC.345/01DE-3A')).toBe(false);
  });

  it('rejeita caracteres repetidos', () => {
    expect(isValidCnpj('00.000.000/0000-00')).toBe(false);
    expect(isValidCnpj('11111111111111')).toBe(false);
  });

  it('rejeita tamanho incorreto e caracteres estranhos', () => {
    expect(isValidCnpj('1122233300018')).toBe(false);
    expect(isValidCnpj('112223330001811')).toBe(false);
    expect(isValidCnpj('11.222.333/0001_81')).toBe(false);
    expect(isValidCnpj('')).toBe(false);
  });
});

describe('normalizeCnpj / formatCnpj', () => {
  it('remove a pontuação e converte para maiúsculas', () => {
    expect(normalizeCnpj('12.abc.345/01de-35')).toBe('12ABC34501DE35');
  });

  it('aplica a máscara', () => {
    expect(formatCnpj('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatCnpj('12ABC34501DE35')).toBe('12.ABC.345/01DE-35');
  });
});
