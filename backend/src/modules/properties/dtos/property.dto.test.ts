import { describe, expect, it } from 'vitest';
import { createPropertySchema } from './create-property.dto';
import { ADMIN_ONLY_PROPERTY_FIELDS, updatePropertySchema } from './update-property.dto';

const valid = { name: 'Fazenda Boa Vista', state: 'GO', city: 'Rio Verde' };

function errorFields(schema: typeof createPropertySchema | typeof updatePropertySchema, input: unknown) {
  const result = schema.safeParse(input);
  return result.success ? [] : Object.keys(result.error.flatten().fieldErrors);
}

describe('createPropertySchema', () => {
  it('aceita o cadastro mínimo', () => {
    expect(createPropertySchema.parse(valid)).toEqual(valid);
  });

  it('aceita todos os campos opcionais', () => {
    const full = {
      ...valid,
      car: 'GO-5218805-ABCD',
      nirf: '1.234.567-8',
      ownerId: '7b0c1f1e-6f0b-4c36-9f65-0d2f0c6f3a11',
      agronomistId: '9d5e2a44-2c1b-4e1a-8f6c-1a2b3c4d5e6f',
    };
    expect(createPropertySchema.parse(full)).toEqual(full);
  });

  it.each(['XX', 'go', 'GOI', ''])('rejeita a UF %j', (state) => {
    expect(errorFields(createPropertySchema, { ...valid, state })).toEqual(['state']);
  });

  it('exige nome e município', () => {
    expect(errorFields(createPropertySchema, { state: 'GO' }).sort()).toEqual(['city', 'name']);
  });

  it('rejeita ownerId que não é UUID', () => {
    expect(errorFields(createPropertySchema, { ...valid, ownerId: '123' })).toEqual(['ownerId']);
  });
});

describe('updatePropertySchema', () => {
  it('aceita atualização parcial', () => {
    expect(updatePropertySchema.parse({ name: 'Fazenda Nova' })).toEqual({ name: 'Fazenda Nova' });
  });

  it('permite anular car, nirf e agronomistId', () => {
    expect(updatePropertySchema.parse({ car: null, nirf: null, agronomistId: null })).toEqual({
      car: null,
      nirf: null,
      agronomistId: null,
    });
  });

  it('rejeita corpo vazio', () => {
    expect(updatePropertySchema.safeParse({}).success).toBe(false);
  });

  it('não permite anular o dono', () => {
    expect(errorFields(updatePropertySchema, { ownerId: null })).toEqual(['ownerId']);
  });

  it('lista os campos exclusivos de ADMIN', () => {
    expect(ADMIN_ONLY_PROPERTY_FIELDS).toEqual(['ownerId', 'agronomistId']);
  });
});
