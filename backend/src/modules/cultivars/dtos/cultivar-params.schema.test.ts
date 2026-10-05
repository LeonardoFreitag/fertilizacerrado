import { describe, expect, it } from 'vitest';
import { createCultivarSchema } from './create-cultivar.dto';
import { CULTIVAR_PARAM_KEYS, cultivarParamsSchema, type CultivarParams } from './cultivar-params.schema';
import { updateCultivarSchema } from './update-cultivar.dto';

const soja: CultivarParams = {
  tBase: 10, gdaTotal: 1200, gdaF1End: 120, gdaF2End: 450, gdaF3End: 900,
  kcIni: 0.2, kcMid: 1.15, kcEnd: 0.5, depletionFraction: 0.5, zrIni: 0.3, zrMax: 0.95,
  kyF1: 0.2, kyF2: 0.8, kyF3: 1.0, kyF4: 0.4,
};
const milho: CultivarParams = {
  tBase: 10, gdaTotal: 1500, gdaF1End: 150, gdaF2End: 600, gdaF3End: 1150,
  kcIni: 0.3, kcMid: 1.2, kcEnd: 0.6, depletionFraction: 0.55, zrIni: 0.3, zrMax: 1.0,
  kyF1: 0.4, kyF2: 0.4, kyF3: 1.5, kyF4: 0.5,
};

function errorFields(input: unknown): string[] {
  const result = cultivarParamsSchema.safeParse(input);
  return result.success ? [] : Object.keys(result.error.flatten().fieldErrors).sort();
}

describe('cultivarParamsSchema', () => {
  it('aceita as duas cultivares de referência', () => {
    expect(errorFields(soja)).toEqual([]);
    expect(errorFields(milho)).toEqual([]);
  });

  it.each([
    ['tBase abaixo de 0', { tBase: -1 }, 'tBase'],
    ['tBase acima de 20', { tBase: 21 }, 'tBase'],
    ['gdaTotal abaixo de 300', { gdaTotal: 200, gdaF1End: 10, gdaF2End: 20, gdaF3End: 30 }, 'gdaTotal'],
    ['gdaTotal acima de 4000', { gdaTotal: 4500 }, 'gdaTotal'],
    ['gdaF1End zero', { gdaF1End: 0 }, 'gdaF1End'],
    ['kcIni zero', { kcIni: 0 }, 'kcIni'],
    ['kcMid acima de 1.5', { kcMid: 1.6 }, 'kcMid'],
    ['kcEnd negativo', { kcEnd: -0.1 }, 'kcEnd'],
    ['p igual a 0', { depletionFraction: 0 }, 'depletionFraction'],
    ['p igual a 1', { depletionFraction: 1 }, 'depletionFraction'],
    ['zrIni zero', { zrIni: 0 }, 'zrIni'],
    ['zrMax acima de 3', { zrMax: 3.5 }, 'zrMax'],
    ['ky negativo', { kyF1: -0.1 }, 'kyF1'],
    ['ky acima de 1.5', { kyF2: 1.51 }, 'kyF2'],
  ])('rejeita %s', (_label, patch, field) => {
    expect(errorFields({ ...soja, ...patch })).toContain(field);
  });

  it('aceita os limites inclusivos', () => {
    expect(errorFields({ ...soja, tBase: 0, kcMid: 1.5, kyF3: 1.5, zrMax: 3, kyF1: 0 })).toEqual([]);
  });

  it('exige limiares de GDA estritamente crescentes', () => {
    expect(errorFields({ ...soja, gdaF2End: 120 })).toEqual(['gdaF2End']);
    expect(errorFields({ ...soja, gdaF3End: 450 })).toEqual(['gdaF3End']);
  });

  it('exige gdaF3End menor que gdaTotal', () => {
    expect(errorFields({ ...soja, gdaF3End: 1200 })).toEqual(['gdaF3End']);
    expect(errorFields({ ...soja, gdaF3End: 1199.9 })).toEqual([]);
  });

  it('exige zrIni ≤ zrMax e aponta zrMax', () => {
    expect(errorFields({ ...soja, zrIni: 1.0, zrMax: 0.95 })).toEqual(['zrMax']);
    expect(errorFields({ ...soja, zrIni: 0.95, zrMax: 0.95 })).toEqual([]);
  });

  it('exige todos os parâmetros', () => {
    const { kyF3: _k, ...incomplete } = soja;
    expect(errorFields(incomplete)).toEqual(['kyF3']);
    expect(CULTIVAR_PARAM_KEYS).toHaveLength(15);
  });
});

describe('createCultivarSchema', () => {
  const valid = { name: 'Minha soja', crop: 'SOJA', ...soja };

  it('aceita o cadastro completo', () => {
    expect(createCultivarSchema.safeParse(valid).success).toBe(true);
  });

  it('rejeita isDefault apontando o campo', () => {
    const result = createCultivarSchema.safeParse({ ...valid, isDefault: true });
    expect(result.success).toBe(false);
    if (!result.success) expect(Object.keys(result.error.flatten().fieldErrors)).toEqual(['isDefault']);
  });

  it('rejeita cultura desconhecida e aplica as relações cruzadas', () => {
    expect(createCultivarSchema.safeParse({ ...valid, crop: 'TRIGO' }).success).toBe(false);
    const result = createCultivarSchema.safeParse({ ...valid, gdaF2End: 100 });
    if (!result.success) expect(Object.keys(result.error.flatten().fieldErrors)).toEqual(['gdaF2End']);
    expect(result.success).toBe(false);
  });
});

describe('updateCultivarSchema', () => {
  it('aceita patch parcial e anular a descrição', () => {
    expect(updateCultivarSchema.parse({ kcMid: 1.1 })).toEqual({ kcMid: 1.1 });
    expect(updateCultivarSchema.parse({ cycleDescription: null })).toEqual({ cycleDescription: null });
  });

  it('rejeita corpo vazio e campos imutáveis', () => {
    expect(updateCultivarSchema.safeParse({}).success).toBe(false);
    for (const field of ['crop', 'isDefault', 'createdById']) {
      const result = updateCultivarSchema.safeParse({ name: 'Nome válido', [field]: 'MILHO' });
      expect(result.success).toBe(false);
      if (!result.success) expect(Object.keys(result.error.flatten().fieldErrors)).toEqual([field]);
    }
  });
});
