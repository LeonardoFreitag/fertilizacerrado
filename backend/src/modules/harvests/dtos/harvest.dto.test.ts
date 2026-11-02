import { describe, expect, it } from 'vitest';
import { calendarDateSchema, createHarvestSchema, EXPECTED_YIELD_MAX_SC_HA, seasonSchema } from './create-harvest.dto';
import { updateHarvestSchema } from './update-harvest.dto';

const UUID = '7b0c1f1e-6f0b-4c36-9f65-0d2f0c6f3a11';

describe('calendarDateSchema', () => {
  it('aceita datas-calendário válidas', () => {
    expect(calendarDateSchema.parse('2025-11-10')).toBe('2025-11-10');
    expect(calendarDateSchema.parse('2024-02-29')).toBe('2024-02-29');
  });

  it.each(['2025-11-10T00:00:00Z', '10/11/2025', '2025-13-01', '2025-02-30', '2023-02-29', ''])(
    'rejeita %j',
    (value) => {
      expect(calendarDateSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('seasonSchema', () => {
  it('aceita anos consecutivos, inclusive na virada de século', () => {
    expect(seasonSchema.parse('2025/26')).toBe('2025/26');
    expect(seasonSchema.parse('2099/00')).toBe('2099/00');
  });

  it.each(['2025', '25/26', '2025/27', '2025/25', '2025-26'])('rejeita %j', (value) => {
    expect(seasonSchema.safeParse(value).success).toBe(false);
  });
});

describe('createHarvestSchema', () => {
  const valid = { fieldId: UUID, cultivarId: UUID, emergenceDate: '2025-11-10', season: '2025/26' };

  it('aceita o corpo mínimo e notas opcionais', () => {
    expect(createHarvestSchema.parse(valid)).toEqual(valid);
    expect(createHarvestSchema.parse({ ...valid, notes: 'Plantio direto' }).notes).toBe('Plantio direto');
  });

  it('aceita expectedYield em (0, teto] e rejeita 0, negativo, acima do teto e texto', () => {
    expect(createHarvestSchema.parse({ ...valid, expectedYield: 65 }).expectedYield).toBe(65);
    expect(createHarvestSchema.parse({ ...valid, expectedYield: EXPECTED_YIELD_MAX_SC_HA }).expectedYield).toBe(250);
    expect(createHarvestSchema.parse(valid).expectedYield).toBeUndefined();
    for (const bad of [0, -10, 300, 'alta', null]) {
      const result = createHarvestSchema.safeParse({ ...valid, expectedYield: bad });
      expect(result.success).toBe(false);
      if (!result.success) expect(Object.keys(result.error.flatten().fieldErrors)).toEqual(['expectedYield']);
    }
  });

  it('exige fieldId e cultivarId como UUID', () => {
    const result = createHarvestSchema.safeParse({ ...valid, fieldId: '1', cultivarId: 'x' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(Object.keys(result.error.flatten().fieldErrors).sort()).toEqual(['cultivarId', 'fieldId']);
    }
  });
});

describe('updateHarvestSchema', () => {
  it('aceita status, notes (anulável) e season', () => {
    expect(updateHarvestSchema.parse({ status: 'COMPLETED' })).toEqual({ status: 'COMPLETED' });
    expect(updateHarvestSchema.parse({ notes: null, season: '2026/27' })).toEqual({ notes: null, season: '2026/27' });
  });

  it('aceita expectedYield e null para limpar; rejeita inválidos', () => {
    expect(updateHarvestSchema.parse({ expectedYield: 65 })).toEqual({ expectedYield: 65 });
    expect(updateHarvestSchema.parse({ expectedYield: null })).toEqual({ expectedYield: null });
    for (const bad of [0, -5, 300, 'alta']) {
      const result = updateHarvestSchema.safeParse({ expectedYield: bad });
      expect(result.success).toBe(false);
      if (!result.success) expect(Object.keys(result.error.flatten().fieldErrors)).toEqual(['expectedYield']);
    }
  });

  it('rejeita corpo vazio e status desconhecido', () => {
    expect(updateHarvestSchema.safeParse({}).success).toBe(false);
    expect(updateHarvestSchema.safeParse({ status: 'DONE' }).success).toBe(false);
  });

  it.each(['fieldId', 'cultivarId', 'emergenceDate'])('rejeita o campo imutável %s', (field) => {
    const result = updateHarvestSchema.safeParse({ status: 'ACTIVE', [field]: '2025-01-01' });
    expect(result.success).toBe(false);
    if (!result.success) expect(Object.keys(result.error.flatten().fieldErrors)).toEqual([field]);
  });
});
