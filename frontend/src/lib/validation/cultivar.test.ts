import { describe, expect, it } from 'vitest';
import { cultivarSchema } from './cultivar';
import { harvestSchema, seasonSchema } from './harvest';

const soja = {
  name: 'Soja teste', crop: 'SOJA', cycleDescription: '',
  tBase: '10', gdaTotal: '1200', gdaF1End: '120', gdaF2End: '450', gdaF3End: '900',
  kcIni: '0,20', kcMid: '1,15', kcEnd: '0,50', depletionFraction: '0,5', zrIni: '0,3', zrMax: '0,95',
  kyF1: '0,2', kyF2: '0,8', kyF3: '1', kyF4: '0,4',
};

function firstIssue(data: Record<string, unknown>) {
  const r = cultivarSchema.safeParse(data);
  return r.success ? null : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

describe('cultivarSchema', () => {
  it('aceita os valores de referência da soja (com vírgula decimal)', () => {
    const r = cultivarSchema.safeParse(soja);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.kcMid).toBe(1.15);
      expect(r.data.cycleDescription).toBeUndefined();
    }
  });

  it('regras cruzadas apontam o campo à direita', () => {
    expect(firstIssue({ ...soja, gdaF2End: '100' })).toEqual(['gdaF2End: deve ser maior que gdaF1End']);
    expect(firstIssue({ ...soja, gdaF3End: '400' })).toEqual(['gdaF3End: deve ser maior que gdaF2End']);
    expect(firstIssue({ ...soja, gdaF3End: '1300' })).toEqual(['gdaF3End: deve ser menor que gdaTotal']);
    expect(firstIssue({ ...soja, zrIni: '1', zrMax: '0,5' })).toEqual(['zrMax: deve ser maior ou igual a zrIni']);
  });

  it('faixas', () => {
    expect(firstIssue({ ...soja, kcMid: '1,6' })).toEqual(['kcMid: deve ser no máximo 1,5']);
    expect(firstIssue({ ...soja, depletionFraction: '1' })).toEqual(['depletionFraction: deve ser menor que 1']);
    expect(firstIssue({ ...soja, tBase: '' })).toEqual(['tBase: obrigatório']);
  });
});

describe('harvestSchema', () => {
  const base = { fieldId: '0c1d2a2e-6b2b-4f2a-9c3a-1234567890ab', cultivarId: '0c1d2a2e-6b2b-4f2a-9c3a-1234567890ac', emergenceDate: '2025-11-01', season: '2025/26', notes: '' };
  it('aceita e normaliza notas vazias', () => {
    const r = harvestSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.notes).toBeUndefined();
  });
  it('rejeita emergência futura e safra inválida', () => {
    expect(harvestSchema.safeParse({ ...base, emergenceDate: '2999-01-01' }).success).toBe(false);
    expect(seasonSchema.safeParse('2025/27').success).toBe(false);
    expect(seasonSchema.safeParse('25/26').success).toBe(false);
    expect(seasonSchema.safeParse('2025/26').success).toBe(true);
  });
});
