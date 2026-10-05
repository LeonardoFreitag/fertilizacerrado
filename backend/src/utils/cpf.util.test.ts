import { describe, expect, it } from 'vitest';
import { formatCpf, isValidCpf, normalizeCpf } from './cpf.util';

describe('isValidCpf', () => {
  it('aceita CPF válido com e sem pontuação', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('52998224725')).toBe(true);
    expect(isValidCpf(' 123.456.789-09 ')).toBe(true);
  });

  it('aceita CPF cujo dígito verificador é zero', () => {
    // resto 10 no cálculo → dígito 0
    expect(isValidCpf('000.000.001-91')).toBe(true);
  });

  it('rejeita dígito verificador incorreto', () => {
    expect(isValidCpf('529.982.247-26')).toBe(false);
    expect(isValidCpf('529.982.247-35')).toBe(false);
  });

  it('rejeita dígitos repetidos', () => {
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('00000000000')).toBe(false);
  });

  it('rejeita tamanho incorreto', () => {
    expect(isValidCpf('5299822472')).toBe(false);
    expect(isValidCpf('529982247255')).toBe(false);
    expect(isValidCpf('')).toBe(false);
  });

  it('rejeita caracteres estranhos em vez de ignorá-los', () => {
    expect(isValidCpf('529a982b247c25')).toBe(false);
    expect(isValidCpf('529/982/247/25')).toBe(false);
  });
});

describe('normalizeCpf / formatCpf', () => {
  it('remove a pontuação', () => {
    expect(normalizeCpf('529.982.247-25')).toBe('52998224725');
  });

  it('aplica a máscara', () => {
    expect(formatCpf('52998224725')).toBe('529.982.247-25');
  });
});
