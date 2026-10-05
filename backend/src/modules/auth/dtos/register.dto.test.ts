import { describe, expect, it } from 'vitest';
import { registerSchema } from './register.dto';

const valid = {
  name: 'Maria Silva',
  email: 'Maria@Fazenda.com',
  password: 'MinhaS3nha!',
  role: 'AGRONOMO',
  cpf: '529.982.247-25',
};

function errorFields(input: unknown): string[] {
  const result = registerSchema.safeParse(input);
  return result.success ? [] : Object.keys(result.error.flatten().fieldErrors);
}

describe('registerSchema', () => {
  it('aceita um cadastro válido e normaliza e-mail e CPF', () => {
    const dto = registerSchema.parse(valid);
    expect(dto.email).toBe('maria@fazenda.com');
    expect(dto.cpf).toBe('52998224725');
  });

  it('normaliza o CNPJ', () => {
    const dto = registerSchema.parse({ ...valid, cpf: undefined, cnpj: '12.abc.345/01de-35' });
    expect(dto.cnpj).toBe('12ABC34501DE35');
  });

  it('rejeita role ADMIN', () => {
    expect(errorFields({ ...valid, role: 'ADMIN' })).toEqual(['role']);
  });

  it.each([
    ['curta', 'Ab1!'],
    ['sem maiúscula', 'minhas3nha!'],
    ['sem número', 'MinhaSenha!'],
    ['sem caractere especial', 'MinhaS3nha'],
    ['acima de 72 bytes', `Aa1!${'x'.repeat(70)}`],
  ])('rejeita senha %s', (_label, password) => {
    expect(errorFields({ ...valid, password })).toEqual(['password']);
  });

  it('exige ao menos um documento', () => {
    expect(errorFields({ ...valid, cpf: undefined })).toEqual(['cpf']);
  });

  it('exige CNPJ para pessoa jurídica, mesmo com CPF informado', () => {
    expect(errorFields({ ...valid, personType: 'PJ' })).toEqual(['cnpj']);
  });

  it('exige CPF para pessoa física, mesmo com CNPJ informado', () => {
    expect(
      errorFields({ ...valid, cpf: undefined, cnpj: '11.222.333/0001-81', personType: 'PF' }),
    ).toEqual(['cpf']);
  });

  it('aceita pessoa jurídica com CNPJ', () => {
    expect(
      errorFields({ ...valid, cpf: undefined, cnpj: '11.222.333/0001-81', personType: 'PJ' }),
    ).toEqual([]);
  });

  it('rejeita documentos com dígito verificador inválido', () => {
    expect(errorFields({ ...valid, cpf: '529.982.247-26' })).toEqual(['cpf']);
    expect(errorFields({ ...valid, cnpj: '11.222.333/0001-82' })).toEqual(['cnpj']);
  });

  it('rejeita e-mail inválido', () => {
    expect(errorFields({ ...valid, email: 'nao-e-email' })).toEqual(['email']);
  });
});
