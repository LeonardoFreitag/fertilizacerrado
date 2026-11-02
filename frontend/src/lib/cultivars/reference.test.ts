import { describe, expect, it } from 'vitest';
import type { CultivarParams } from '../api/types';
import { divergenceLabel, divergentFields, fieldsToSync, toNumbers } from './reference';

const REF: CultivarParams = {
  tBase: 10, gdaTotal: 1200, gdaF1End: 120, gdaF2End: 450, gdaF3End: 900,
  kcIni: 0.2, kcMid: 1.15, kcEnd: 0.5, depletionFraction: 0.5, zrIni: 0.3, zrMax: 0.95,
  kyF1: 0.2, kyF2: 0.8, kyF3: 1, kyF4: 0.4,
};

describe('toNumbers', () => {
  it('aceita vírgula decimal e marca vazio como NaN', () => {
    const n = toNumbers({ ...REF, kcMid: '1,10', tBase: '' });
    expect(n.kcMid).toBe(1.1);
    expect(Number.isNaN(n.tBase)).toBe(true);
    expect(n.gdaTotal).toBe(1200);
  });
});

describe('divergentFields', () => {
  it('lista só o que difere; vazio conta como divergente', () => {
    expect(divergentFields(toNumbers(REF), REF)).toEqual([]);
    expect(divergentFields(toNumbers({ ...REF, kcMid: 1.1 }), REF)).toEqual(['kcMid']);
    expect(divergentFields(toNumbers({ ...REF, tBase: '' }), REF)).toEqual(['tBase']);
  });
});

describe('fieldsToSync', () => {
  const current = toNumbers({ ...REF, kcMid: 1.1 }); // técnico alterou kcMid
  const newRef: CultivarParams = { ...REF, tBase: 12, kcMid: 1.2 }; // referência mudou tBase e kcMid

  it('unchanged: só os campos que o técnico não alterou (iguais ao snapshot)', () => {
    expect(fieldsToSync(current, REF, newRef, 'unchanged')).toEqual(['tBase']);
  });

  it('all: todos os que diferem da referência atual', () => {
    expect(fieldsToSync(current, REF, newRef, 'all')).toEqual(['tBase', 'kcMid']);
  });

  it('sem snapshot, unchanged não altera nada', () => {
    expect(fieldsToSync(current, null, newRef, 'unchanged')).toEqual([]);
  });

  it('já igual à referência ⇒ nada', () => {
    expect(fieldsToSync(toNumbers(REF), REF, REF, 'all')).toEqual([]);
  });
});

describe('divergenceLabel', () => {
  it('singular, plural e igual', () => {
    expect(divergenceLabel(0)).toBe('igual à referência');
    expect(divergenceLabel(1)).toBe('1 parâmetro difere da referência');
    expect(divergenceLabel(3)).toBe('3 parâmetros diferem da referência');
  });
});
