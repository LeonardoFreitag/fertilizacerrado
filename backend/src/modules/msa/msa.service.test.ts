import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../utils/app-error';
import { referenceCultivar } from '../cultivars/reference-cultivars';
import { syntheticSeason } from './synthetic-season';

vi.mock('./era5.repository', () => ({ era5Repository: { getDailySeriesForField: vi.fn(), getCell: vi.fn().mockResolvedValue(null) } }));
vi.mock('../admin-qm/qm.repository', () => ({ qmRepository: { activeForCell: vi.fn().mockResolvedValue(null), summaryById: vi.fn().mockResolvedValue(null) } }));
vi.mock('./msa.repository', () => ({
  msaRepository: {
    findHarvestForProcessing: vi.fn(),
    createSucceededRun: vi.fn(),
    createRun: vi.fn(),
    latestSucceededRun: vi.fn(),
    dailyResults: vi.fn(),
    findRun: vi.fn(),
    listRuns: vi.fn(),
  },
}));
vi.mock('../harvests/harvest.service', () => ({ harvestService: { getAccessible: vi.fn().mockResolvedValue({}) } }));

import { ENGINE_VERSION } from './engine';
import { era5Repository } from './era5.repository';
import { msaRepository } from './msa.repository';
import { cultivarChangedSinceRun, DEFAULT_SOIL, msaService, resolveInterval, snapshotCultivar, snapshotSoil, yieldFields } from './msa.service';

const USER = { id: 'u1', role: 'AGRONOMO' as const };
const SOJA = { ...referenceCultivar('SOJA'), id: 'c1', cycleDescription: null, isDefault: true, createdById: null, referenceSnapshot: null, createdAt: new Date(), updatedAt: new Date() };
const FIELD = { id: 'f1', name: 'T1', propertyId: 'p1', altitudeM: 741, thetaFC: 0.3, thetaWP: 0.14 };
const SERIES = syntheticSeason(150, 2026); // 2025-11-01 … 2026-03-30
const TODAY = new Date().toISOString().slice(0, 10);

function harvest(overrides: Partial<{ field: typeof FIELD; emergence: string; expectedYield: number | null; cultivar: typeof SOJA }> = {}) {
  return {
    id: 'h1', status: 'ACTIVE', latestRunId: null,
    emergenceDate: new Date(`${overrides.emergence ?? '2025-11-01'}T00:00:00Z`),
    expectedYield: overrides.expectedYield === undefined ? 65 : overrides.expectedYield,
    field: overrides.field ?? FIELD,
    cultivar: overrides.cultivar ?? SOJA,
  };
}

const repo = vi.mocked(msaRepository);
const era5 = vi.mocked(era5Repository);

beforeEach(() => {
  vi.clearAllMocks();
  repo.createRun.mockImplementation(async (run) => ({ id: 'run-x', ...run }) as never);
  repo.createSucceededRun.mockImplementation(async (run, _daily, summaries) =>
    ({ id: 'run-ok', ...run, phaseSummaries: summaries.map((s) => ({ ...s, runId: 'run-ok' })) }) as never,
  );
});

describe('resolveInterval', () => {
  const cultivar = referenceCultivar('SOJA');

  it('trunca no dia em que o GDA atinge gdaTotal e ignora lacunas posteriores', () => {
    const withGapAfter = SERIES.filter((d) => d.date !== '2026-03-10');
    const r = resolveInterval('2025-11-01', '2026-03-30', withGapAfter, cultivar);
    expect(r.to < '2026-03-10').toBe(true);
    expect(r.missingDates).toEqual([]);
    expect(r.days[r.days.length - 1]!.date).toBe(r.to);
  });

  it('lacuna dentro do intervalo vira missingDates; o fim do ciclo ainda é estimado pelos dias presentes', () => {
    const withGap = SERIES.filter((d) => d.date !== '2025-11-15' && d.date !== '2025-11-16');
    const r = resolveInterval('2025-11-01', '2026-09-29', withGap, cultivar);
    expect(r.missingDates).toEqual(['2025-11-15', '2025-11-16']);
    expect(r.to < '2026-02-01').toBe(true); // não vai até o limite
  });

  it('série vazia ⇒ todas as datas faltam até o limite', () => {
    const r = resolveInterval('2025-11-01', '2025-11-03', [], cultivar);
    expect(r.missingDates).toEqual(['2025-11-01', '2025-11-02', '2025-11-03']);
  });

  it('emergência depois do limite ⇒ NEEDS_DATA do próprio dia', () => {
    const r = resolveInterval('2026-10-01', '2026-09-29', [], cultivar);
    expect(r).toEqual({ from: '2026-10-01', to: '2026-10-01', days: [], missingDates: ['2026-10-01'] });
  });
});

describe('snapshots', () => {
  it('cultivar: 15 parâmetros + identificação, iguais ao registro', () => {
    const snap = snapshotCultivar(SOJA as never);
    expect(snap).toMatchObject({ id: 'c1', name: SOJA.name, crop: 'SOJA', gdaTotal: 1200, kcMid: 1.15, kyF3: 1 });
    expect(Object.keys(snap)).toHaveLength(18);
  });

  it('solo do talhão, sem defaults', () => {
    expect(snapshotSoil(FIELD)).toEqual({ thetaFC: 0.3, thetaWP: 0.14, altitudeM: 741, soilDefaults: false });
  });

  it('solo com defaults regionais quando o talhão não tem teores', () => {
    expect(snapshotSoil({ ...FIELD, thetaFC: null, thetaWP: null })).toEqual({ ...DEFAULT_SOIL, altitudeM: 741, soilDefaults: true });
  });

  it('altitude ausente ⇒ 422 MISSING_FIELD_ALTITUDE', () => {
    expect(() => snapshotSoil({ ...FIELD, altitudeM: null })).toThrow(AppError);
    try {
      snapshotSoil({ ...FIELD, altitudeM: null });
    } catch (e) {
      expect((e as AppError).status).toBe(422);
      expect((e as AppError).code).toBe('MISSING_FIELD_ALTITUDE');
    }
  });
});

describe('msaService.processHarvest', () => {
  it('altitude ausente: 422 sem criar run nem ler clima', async () => {
    repo.findHarvestForProcessing.mockResolvedValue(harvest({ field: { ...FIELD, altitudeM: null } }) as never);
    await expect(msaService.processHarvest(USER, 'h1')).rejects.toMatchObject({ status: 422, code: 'MISSING_FIELD_ALTITUDE' });
    expect(repo.createRun).not.toHaveBeenCalled();
    expect(era5.getDailySeriesForField).not.toHaveBeenCalled();
  });

  it('lacuna ⇒ run NEEDS_DATA com as datas, sem calcular', async () => {
    repo.findHarvestForProcessing.mockResolvedValue(harvest() as never);
    era5.getDailySeriesForField.mockResolvedValue(SERIES.filter((d) => d.date !== '2025-11-15' && d.date !== '2025-11-16'));
    const r = await msaService.processHarvest(USER, 'h1');
    expect(r.run.status).toBe('NEEDS_DATA');
    expect(r.run.missingDates).toEqual(['2025-11-15', '2025-11-16']);
    expect(r.phases).toBeNull();
    expect(repo.createSucceededRun).not.toHaveBeenCalled();
    expect(repo.createRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'NEEDS_DATA', engineVersion: ENGINE_VERSION }));
  });

  it('emergência dentro do lag ⇒ NEEDS_DATA sem consultar o clima', async () => {
    repo.findHarvestForProcessing.mockResolvedValue(harvest({ emergence: TODAY }) as never);
    const r = await msaService.processHarvest(USER, 'h1');
    expect(r.run.status).toBe('NEEDS_DATA');
    expect(era5.getDailySeriesForField).not.toHaveBeenCalled();
  });

  it('série completa ⇒ SUCCEEDED com snapshots fiéis, 4 resumos, índice e produtividade predita', async () => {
    repo.findHarvestForProcessing.mockResolvedValue(harvest() as never);
    era5.getDailySeriesForField.mockResolvedValue(SERIES);
    const r = await msaService.processHarvest(USER, 'h1');
    expect(r.run.status).toBe('SUCCEEDED');
    expect(r.run.engineVersion).toBe('2.0.0');
    expect(r.run.cultivarSnapshot).toMatchObject({ id: 'c1', gdaTotal: 1200 });
    expect(r.run.soilSnapshot).toEqual({ thetaFC: 0.3, thetaWP: 0.14, altitudeM: 741, soilDefaults: false });
    expect(r.phases).toHaveLength(4);
    expect(r.currentPhase).toBe('COMPLETED');
    expect(r.run.expectedYield).toBe(65);
    expect(r.run.phasesReached).toBe(4);
    expect(r.run.yieldIndex).toBeGreaterThan(0);
    expect(r.run.yieldIndex).toBeLessThanOrEqual(1);
    expect(r.run.predictedYield).toBeCloseTo(65 * r.run.yieldIndex!, 9);
    expect(r.phases![0]).not.toHaveProperty('percentiles');
    expect(r.phases![0]).not.toHaveProperty('validIterations');
    expect(r.run).not.toHaveProperty('seed');
    const [created, daily, summaries] = repo.createSucceededRun.mock.calls[0]!;
    expect(created).not.toHaveProperty('seed');
    expect(created).not.toHaveProperty('iterations');
    expect(daily.length).toBeGreaterThan(60);
    expect(summaries.map((s) => s.phase)).toEqual(['F1', 'F2', 'F3', 'F4']);
    expect(summaries[0]).not.toHaveProperty('ksMeanP50');
    expect(daily[0]!.date.toISOString().slice(0, 10)).toBe('2025-11-01');
  });

  it('safra sem Ym ⇒ índice e janelas gravados, predita e Ym nulas', async () => {
    repo.findHarvestForProcessing.mockResolvedValue(harvest({ expectedYield: null }) as never);
    era5.getDailySeriesForField.mockResolvedValue(SERIES);
    const r = await msaService.processHarvest(USER, 'h1');
    expect(r.run.status).toBe('SUCCEEDED');
    expect(r.run.expectedYield).toBeNull();
    expect(r.run.predictedYield).toBeNull();
    expect(r.run.yieldIndex).not.toBeNull();
    expect(r.run.phasesReached).toBe(4);
  });

  it('ciclo em curso ⇒ phasesReached < 4 e fator 1 nas janelas não alcançadas', async () => {
    // Emergência há 40 dias e série completa até hoje − 6: ~35 dias × ~15 °C·dia ⇒ F2/F3, sem F4.
    const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
    const emergence = addDays(TODAY, -40);
    const recent = SERIES.slice(0, 35).map((d, i) => ({ ...d, date: addDays(emergence, i) }));
    repo.findHarvestForProcessing.mockResolvedValue(harvest({ emergence }) as never);
    era5.getDailySeriesForField.mockResolvedValue(recent);
    const r = await msaService.processHarvest(USER, 'h1');
    expect(r.run.status).toBe('SUCCEEDED');
    expect(r.run.phasesReached!).toBeLessThan(4);
    expect(r.phases!.filter((p) => p.days === 0).length).toBe(4 - r.run.phasesReached!);
  });

  it('mesmos dados ⇒ resumos, série, índice e predita idênticos (determinístico, sem semente)', async () => {
    repo.findHarvestForProcessing.mockResolvedValue(harvest() as never);
    era5.getDailySeriesForField.mockResolvedValue(SERIES);
    const r1 = await msaService.processHarvest(USER, 'h1');
    const r2 = await msaService.processHarvest(USER, 'h1');
    const [, d1, s1] = repo.createSucceededRun.mock.calls[0]!;
    const [, d2, s2] = repo.createSucceededRun.mock.calls[1]!;
    expect(s1).toEqual(s2);
    expect(d1).toEqual(d2);
    expect(r1.run.yieldIndex).toBe(r2.run.yieldIndex);
    expect(r1.run.predictedYield).toBe(r2.run.predictedYield);
  });

  it('erro na gravação ⇒ run FAILED com a mensagem e 500', async () => {
    repo.findHarvestForProcessing.mockResolvedValue(harvest() as never);
    era5.getDailySeriesForField.mockResolvedValue(SERIES);
    repo.createSucceededRun.mockRejectedValueOnce(new Error('disco cheio'));
    await expect(msaService.processHarvest(USER, 'h1')).rejects.toMatchObject({ status: 500, code: 'MSA_PROCESSING_FAILED' });
    expect(repo.createRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED', error: 'Error: disco cheio' }));
  });
});

describe('yieldFields', () => {
  const cycle = { yieldIndex: 0.736, phasesReached: 4, factors: [1, 0.92, 0.8, 1] as [number, number, number, number] };

  it('com Ym: predita = Ym × índice', () => {
    expect(yieldFields(cycle, 65)).toEqual({ expectedYield: 65, yieldIndex: 0.736, phasesReached: 4, predictedYield: 65 * 0.736 });
  });

  it('sem Ym: predita nula', () => {
    expect(yieldFields(cycle, null)).toEqual({ expectedYield: null, yieldIndex: 0.736, phasesReached: 4, predictedYield: null });
  });
});

describe('cultivarChangedSinceRun', () => {
  const snapshot = snapshotCultivar(SOJA as never);

  it('mesmos valores ⇒ false; nome/id diferentes não contam', () => {
    expect(cultivarChangedSinceRun(snapshot, SOJA)).toBe(false);
    expect(cultivarChangedSinceRun(snapshot, { ...SOJA, name: 'Outro nome', id: 'c2' })).toBe(false);
  });

  it('parâmetro alterado depois da run ⇒ true', () => {
    expect(cultivarChangedSinceRun(snapshot, { ...SOJA, kcMid: 1.1 })).toBe(true);
  });

  it('chave nova (ex.: tUpper) entra na comparação pela união das chaves, sem lista fixa', () => {
    const withUpper = { ...snapshot, tUpper: 35 };
    expect(cultivarChangedSinceRun(withUpper, { ...SOJA, tUpper: 35 })).toBe(false);
    expect(cultivarChangedSinceRun(withUpper, { ...SOJA, tUpper: 38 })).toBe(true);
    expect(cultivarChangedSinceRun(withUpper, SOJA)).toBe(true); // só o snapshot tem o parâmetro
  });

  it('parâmetro presente só na cultivar atual (snapshot anterior a tUpper) ⇒ true', () => {
    expect(cultivarChangedSinceRun(snapshot, { ...SOJA, tUpper: 30 })).toBe(true);
    expect(cultivarChangedSinceRun(snapshot, { ...SOJA, tUpper: null })).toBe(false); // ausente = null dos dois lados
  });

  it('snapshot inválido ⇒ false', () => {
    expect(cultivarChangedSinceRun(null, SOJA)).toBe(false);
  });
});

describe('msaService.getLatest', () => {
  const run = {
    id: 'run-ok', status: 'SUCCEEDED', cultivarSnapshot: snapshotCultivar(SOJA as never), qmCalibrationId: null,
    expectedYield: 65, yieldIndex: 0.9, predictedYield: 58.5, phasesReached: 4,
    startedAt: new Date(), finishedAt: new Date(), dateFrom: new Date('2025-11-01T00:00:00Z'), dateTo: new Date('2026-03-30T00:00:00Z'),
    phaseSummaries: [{ phase: 'F1', days: 10, ksMean: 1, etcAdjAccum: 1, precipAccum: 1, yieldReductionPct: 0 }],
  };
  const daily = [{ runId: 'run-ok', date: new Date(Date.UTC(2026, 2, 30)), phase: 'COMPLETED', gda: 15, gdaAccum: 1200, zr: 0.95, et0: 4, kc: 0.5, etc: 2, precipitation: 0, dr: 10, ks: 1, etcAdj: 2, taw: 150, raw: 75 }];

  beforeEach(() => {
    repo.latestSucceededRun.mockResolvedValue(run as never);
    repo.dailyResults.mockResolvedValue(daily as never);
  });

  it('cultivar inalterada ⇒ cultivarChangedSinceRun false', async () => {
    repo.findHarvestForProcessing.mockResolvedValue(harvest() as never);
    const r = await msaService.getLatest(USER, 'h1');
    expect(r.cultivarChangedSinceRun).toBe(false);
    expect(r.run.predictedYield).toBe(58.5);
    expect(r.currentPhase).toBe('COMPLETED');
  });

  it('cultivar alterada depois da run ⇒ true', async () => {
    repo.findHarvestForProcessing.mockResolvedValue(harvest({ cultivar: { ...SOJA, kcMid: 1.1 } }) as never);
    const r = await msaService.getLatest(USER, 'h1');
    expect(r.cultivarChangedSinceRun).toBe(true);
  });

  it('sem run ⇒ 404 NO_MSA_RESULT', async () => {
    repo.findHarvestForProcessing.mockResolvedValue(harvest() as never);
    repo.latestSucceededRun.mockResolvedValue(null);
    await expect(msaService.getLatest(USER, 'h1')).rejects.toMatchObject({ status: 404, code: 'NO_MSA_RESULT' });
  });
});

describe('processQuerySchema', () => {
  it('rejeita seed apontando o campo', async () => {
    const { processQuerySchema } = await import('./dtos/msa.dto');
    const result = processQuerySchema.safeParse({ seed: '42' });
    expect(result.success).toBe(false);
    if (!result.success) expect(Object.keys(result.error.flatten().fieldErrors)).toEqual(['seed']);
    expect(processQuerySchema.parse({ sync: 'true' }).sync).toBe(true);
  });
});
