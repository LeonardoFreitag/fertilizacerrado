import { describe, expect, it } from 'vitest';
import { isValidCnpj, isValidCpf, maskCnpj, maskCpf, maskPhone } from './documents';
import { fieldSchema, passwordSchema, propertySchema, registerSchema } from './schemas';

describe('CPF', () => {
  it.each(['529.982.247-25', '52998224725', '000.000.001-91'])('válido: %s', (v) => expect(isValidCpf(v)).toBe(true));
  it.each(['111.111.111-11', '529.982.247-26', '1234', '', 'abc'])('inválido: %s', (v) => expect(isValidCpf(v)).toBe(false));
  it('máscara progressiva', () => {
    expect(maskCpf('5')).toBe('5');
    expect(maskCpf('5299')).toBe('529.9');
    expect(maskCpf('5299822')).toBe('529.982.2');
    expect(maskCpf('52998224725')).toBe('529.982.247-25');
    expect(maskCpf('529982247259')).toBe('529.982.247-25'); // excedente ignorado
  });
});

describe('CNPJ', () => {
  it.each(['11.222.333/0001-81', '11222333000181'])('válido: %s', (v) => expect(isValidCnpj(v)).toBe(true));
  it.each(['11.222.333/0001-82', '00.000.000/0000-00', '123'])('inválido: %s', (v) => expect(isValidCnpj(v)).toBe(false));
  it('máscara', () => {
    expect(maskCnpj('11222333000181')).toBe('11.222.333/0001-81');
    expect(maskCnpj('112223')).toBe('11.222.3');
  });
});

describe('telefone', () => {
  it('fixo e celular', () => {
    expect(maskPhone('6232345678')).toBe('(62) 3234-5678');
    expect(maskPhone('62981234567')).toBe('(62) 98123-4567');
    expect(maskPhone('6')).toBe('(6');
  });
});

describe('senha', () => {
  it('regras do backend', () => {
    expect(passwordSchema.safeParse('abcdefgh').success).toBe(false);
    expect(passwordSchema.safeParse('Abcdefg1').success).toBe(false);
    expect(passwordSchema.safeParse('MinhaS3nha!').success).toBe(true);
    expect(passwordSchema.safeParse('A1!' + 'é'.repeat(40)).success).toBe(false); // > 72 bytes
  });
});

describe('cadastro', () => {
  const base = { name: 'Ana', email: 'ANA@fc.local', password: 'MinhaS3nha!', role: 'AGRONOMO' as const };
  it('PF exige CPF válido e normaliza e-mail', () => {
    const ok = registerSchema.safeParse({ ...base, personType: 'PF', cpf: '529.982.247-25' });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.email).toBe('ana@fc.local');
    const bad = registerSchema.safeParse({ ...base, personType: 'PF', cpf: '111.111.111-11' });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.path).toEqual(['cpf']);
    const missing = registerSchema.safeParse({ ...base, personType: 'PF' });
    expect(missing.success).toBe(false);
  });
  it('PJ exige CNPJ', () => {
    expect(registerSchema.safeParse({ ...base, personType: 'PJ', cnpj: '11.222.333/0001-81' }).success).toBe(true);
    expect(registerSchema.safeParse({ ...base, personType: 'PJ', cpf: '529.982.247-25' }).success).toBe(false);
  });
});

describe('propriedade e talhão', () => {
  it('UF válida e campos opcionais vazios viram undefined', () => {
    const r = propertySchema.safeParse({ name: 'Fazenda', state: 'GO', city: 'Goiânia', car: '', nirf: ' ', ownerId: '' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.car).toBeUndefined();
    expect(propertySchema.safeParse({ name: 'Fazenda', state: 'XX', city: 'Goiânia' }).success).toBe(false);
  });
  it('thetaFC > thetaWP e números com vírgula', () => {
    const ok = fieldSchema.safeParse({ name: 'T1', thetaFC: '0,28', thetaWP: '0,12', altitudeM: '741', areaHa: '' });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data).toMatchObject({ thetaFC: 0.28, thetaWP: 0.12, altitudeM: 741, areaHa: undefined });
    const bad = fieldSchema.safeParse({ name: 'T1', thetaFC: '0.10', thetaWP: '0.12' });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.path).toEqual(['thetaFC']);
    expect(fieldSchema.safeParse({ name: 'T1', altitudeM: '9000' }).success).toBe(false);
  });
});
