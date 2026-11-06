/**
 * Comparação de métodos de graus-dia (Caso 5 de docs/msa/validacao.md):
 * residual (motor ≤ 2.0.0), Ometto sem TB e Ometto com TB. Funções puras,
 * sem banco; o CLI está em gda-validate.ts.
 */
import { accumulateGDA, phaseFromGDA, type CultivarParams, type YieldPhase } from '../../src/modules/msa/engine';
import { YIELD_PHASES } from '../../src/modules/msa/engine';

export type GdaMethod = 'residual' | 'ometto' | 'ometto-tb';
export const GDA_METHODS: readonly GdaMethod[] = ['residual', 'ometto', 'ometto-tb'];

export interface TempDay {
  date: string;
  tmax: number;
  tmin: number;
}

export interface WindowReport {
  phase: YieldPhase;
  /** Primeiro e último dia da janela na série, ou null se não alcançada */
  start: string | null;
  end: string | null;
  days: number;
}

export interface MethodReport {
  method: GdaMethod;
  windows: WindowReport[];
  /** Dia em que o GDA acumulado atinge gdaTotal, ou null */
  cycleEnd: string | null;
  /** GDA acumulado ao fim da série (ou do ciclo, se encerrado antes) */
  gdaEnd: number;
}

/** Método residual do motor ≤ 2.0.0 — reimplementado aqui para a comparação não depender do motor atual. */
export function residualGDA(tmax: number, tmin: number, tBase: number): number {
  return Math.max((tmax + tmin) / 2 - tBase, 0);
}

export function accumulateByMethod(series: ReadonlyArray<TempDay>, method: GdaMethod, tBase: number, tUpper: number): number[] {
  if (method === 'residual') {
    const out = new Array<number>(series.length);
    let acc = 0;
    for (let i = 0; i < series.length; i++) {
      acc += residualGDA(series[i]!.tmax, series[i]!.tmin, tBase);
      out[i] = acc;
    }
    return out;
  }
  return accumulateGDA(series, tBase, method === 'ometto-tb' ? tUpper : null);
}

/** Janelas F1–F4 a partir do acumulado; dias após gdaTotal (COMPLETED) não contam. */
export function windowsFromAccum(series: ReadonlyArray<TempDay>, accum: ReadonlyArray<number>, cultivar: CultivarParams): Omit<MethodReport, 'method'> {
  const byPhase = new Map<YieldPhase, { start: string; end: string; days: number }>();
  let cycleEnd: string | null = null;
  let gdaEnd = 0;
  for (let i = 0; i < series.length; i++) {
    const date = series[i]!.date;
    const gda = accum[i]!;
    const phase = phaseFromGDA(gda, cultivar);
    gdaEnd = gda;
    if (phase === 'COMPLETED') {
      cycleEnd = date;
      break;
    }
    const cur = byPhase.get(phase);
    if (!cur) byPhase.set(phase, { start: date, end: date, days: 1 });
    else {
      cur.end = date;
      cur.days += 1;
    }
  }
  return {
    windows: YIELD_PHASES.map((phase) => {
      const w = byPhase.get(phase);
      return { phase, start: w?.start ?? null, end: w?.end ?? null, days: w?.days ?? 0 };
    }),
    cycleEnd,
    gdaEnd,
  };
}

export function compareMethods(series: ReadonlyArray<TempDay>, cultivar: CultivarParams, tUpper: number): MethodReport[] {
  if (!(tUpper > cultivar.tBase)) throw new RangeError(`tUpper (${tUpper}) deve ser maior que tBase (${cultivar.tBase})`);
  return GDA_METHODS.map((method) => ({ method, ...windowsFromAccum(series, accumulateByMethod(series, method, cultivar.tBase, tUpper), cultivar) }));
}

/** Diferença de dias por janela entre dois métodos (a − b). */
export function dayDifferences(a: MethodReport, b: MethodReport): Record<YieldPhase, number> {
  const out = {} as Record<YieldPhase, number>;
  for (const phase of YIELD_PHASES) {
    out[phase] = (a.windows.find((w) => w.phase === phase)?.days ?? 0) - (b.windows.find((w) => w.phase === phase)?.days ?? 0);
  }
  return out;
}
