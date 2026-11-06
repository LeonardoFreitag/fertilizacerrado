import { describe, expect, it } from 'vitest';
import { referenceCultivar } from '../../src/modules/cultivars/reference-cultivars';
import { syntheticSeason } from '../../src/modules/msa/synthetic-season';
import { accumulateByMethod, compareMethods, dayDifferences, residualGDA, windowsFromAccum } from './gda-methods';

const SOJA = referenceCultivar('SOJA');
const SERIES = syntheticSeason(150, 2026).map((d) => ({ date: d.date, tmax: d.tmax, tmin: d.tmin }));

describe('gda-methods (Caso 5)', () => {
  it('residual é o caso 1 de Ometto quando Tmin ≥ Tb e Tmax ≤ TB', () => {
    expect(residualGDA(28, 18, 10)).toBe(13);
    const mild = [{ date: '2025-11-01', tmax: 28, tmin: 18 }, { date: '2025-11-02', tmax: 30, tmin: 20 }];
    expect(accumulateByMethod(mild, 'residual', 10, 30)).toEqual(accumulateByMethod(mild, 'ometto-tb', 10, 30));
  });

  it('ometto-tb acumula menos que o residual em dias quentes', () => {
    const hot = [{ date: '2025-11-01', tmax: 34, tmin: 20 }];
    expect(accumulateByMethod(hot, 'residual', 10, 30)[0]).toBe(17);
    expect(accumulateByMethod(hot, 'ometto-tb', 10, 30)[0]).toBeCloseTo(16.43, 2);
    expect(accumulateByMethod(hot, 'ometto', 10, 30)[0]).toBe(17);
  });

  it('janelas por método: F1–F4 na ordem, dias somam até o fim do ciclo, TB nunca adianta uma janela', () => {
    const reports = compareMethods(SERIES, SOJA, 30);
    expect(reports.map((r) => r.method)).toEqual(['residual', 'ometto', 'ometto-tb']);
    for (const r of reports) {
      expect(r.windows.map((w) => w.phase)).toEqual(['F1', 'F2', 'F3', 'F4']);
      expect(r.cycleEnd).not.toBeNull();
      expect(r.gdaEnd).toBeGreaterThanOrEqual(SOJA.gdaTotal);
    }
    const [residual, , tb] = reports as [typeof reports[0], typeof reports[0], typeof reports[0]];
    for (let i = 0; i < 4; i++) {
      expect(tb.windows[i]!.start! >= residual.windows[i]!.start!).toBe(true);
    }
    expect(tb.cycleEnd! >= residual.cycleEnd!).toBe(true);
    expect(dayDifferences(tb, residual).F1).toBeGreaterThanOrEqual(0);
  });

  it('série curta: janelas não alcançadas ficam nulas e o ciclo não encerra', () => {
    const r = windowsFromAccum(SERIES.slice(0, 20), accumulateByMethod(SERIES.slice(0, 20), 'ometto', 10, 30), SOJA);
    expect(r.cycleEnd).toBeNull();
    expect(r.windows[3]).toEqual({ phase: 'F4', start: null, end: null, days: 0 });
    expect(r.windows[0]!.days).toBeGreaterThan(0);
  });

  it('tUpper ≤ tBase lança RangeError', () => {
    expect(() => compareMethods(SERIES, SOJA, 10)).toThrow(RangeError);
  });
});
