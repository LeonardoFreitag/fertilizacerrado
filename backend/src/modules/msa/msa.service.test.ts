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
    createDecision: vi.fn(),
    listDecisions: vi.fn(),
  },
}));
vi.mock('../harvests/harvest.service', () => ({ harvestService: { getAccessible: vi.fn().mockResolvedValue({}) } }));

import { ENGINE_VERSION } from './engine';
import { era5Repository } from './era5.repository';
import { msaRepository } from './msa.repository';
import { DEFAULT_SOIL, msaService, resolveInterval, snapshotCultivar, snapshotSoil } from './msa.service';

const USER = { id: 'u1', role: 'AGRONOMO' as const };
const SOJA = { ...referenceCultivar('SOJA'), id: 'c1', cycleDescription: null, isDefault: true, createdById: null, createdAt: new Date(), updatedAt: new Date() };
const FIELD = { id: 'f1', name: 'T1', propertyId: 'p1', altitudeM: 741, thetaFC: 0.3, thetaWP: 0.14 };
const SERIES = syntheticSeason(150, 2026); // 2025-11-01 … 2026-03-30
const TODAY = new Date().toISOString().slice(0, 10);

function harvest(overrides: Partial<{ field: typeof FIELD; emergence: string }> = {}) {
  return {
    id: 'h1', status: 'ACTIVE', latestRunId: null,
    emergenceDate: new Date(`${overrides.emergence ?? '2025-11-01'}T00:00:00Z`),
    field: overrides.field ?? FIELD,
    cultivar: SOJA,
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

  it('série completa ⇒ SUCCEEDED com snapshots fiéis, 4 resumos e semente gravada', async () => {
    repo.findHarvestForProcessing.mockResolvedValue(harvest() as never);
    era5.getDailySeriesForField.mockResolvedValue(SERIES);
    const r = await msaService.processHarvest(USER, 'h1', { seed: 42 });
    expect(r.run.status).toBe('SUCCEEDED');
    expect(r.run.seed).toBe(42);
    expect(r.run.iterations).toBe(1000);
    expect(r.run.sigmaPrecip).toBe(0.3);
    expect(r.run.engineVersion).toBe(ENGINE_VERSION);
    expect(r.run.cultivarSnapshot).toMatchObject({ id: 'c1', gdaTotal: 1200 });
    expect(r.run.soilSnapshot).toEqual({ thetaFC: 0.3, thetaWP: 0.14, altitudeM: 741, soilDefaults: false });
    expect(r.phases).toHaveLength(4);
    expect(r.currentPhase).toBe('COMPLETED');
    const [, daily, summaries] = repo.createSucceededRun.mock.calls[0]!;
    expect(daily.length).toBeGreaterThan(60);
    expect(summaries.map((s) => s.phase)).toEqual(['F1', 'F2', 'F3', 'F4']);
    expect(daily[0]!.date.toISOString().slice(0, 10)).toBe('2025-11-01');
  });

  it('mesma semente e mesmos dados ⇒ resumos e série idênticos', async () => {
    repo.findHarvestForProcessing.mockResolvedValue(harvest() as never);
    era5.getDailySeriesForField.mockResolvedValue(SERIES);
    await msaService.processHarvest(USER, 'h1', { seed: 7 });
    await msaService.processHarvest(USER, 'h1', { seed: 7 });
    const [, d1, s1] = repo.createSucceededRun.mock.calls[0]!;
    const [, d2, s2] = repo.createSucceededRun.mock.calls[1]!;
    expect(s1).toEqual(s2);
    expect(d1).toEqual(d2);
  });

  it('sem semente informada, gera uma em [0, 2^31) e a grava', async () => {
    repo.findHarvestForProcessing.mockResolvedValue(harvest() as never);
    era5.getDailySeriesForField.mockResolvedValue(SERIES);
    const r = await msaService.processHarvest(USER, 'h1');
    expect(Number.isInteger(r.run.seed)).toBe(true);
    expect(r.run.seed!).toBeGreaterThanOrEqual(0);
    expect(r.run.seed!).toBeLessThan(2 ** 31);
  });

  it('erro na gravação ⇒ run FAILED com a mensagem e 500', async () => {
    repo.findHarvestForProcessing.mockResolvedValue(harvest() as never);
    era5.getDailySeriesForField.mockResolvedValue(SERIES);
    repo.createSucceededRun.mockRejectedValueOnce(new Error('disco cheio'));
    await expect(msaService.processHarvest(USER, 'h1', { seed: 1 })).rejects.toMatchObject({ status: 500, code: 'MSA_PROCESSING_FAILED' });
    expect(repo.createRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED', error: 'Error: disco cheio', seed: 1 }));
  });
});

describe('msaService.decisionScenarios / recordDecision', () => {
  const run = {
    id: 'run-ok', status: 'SUCCEEDED', cultivarSnapshot: snapshotCultivar(SOJA as never),
    phaseSummaries: [
      { phase: 'F3', ksMeanP50: 0.72 },
      { phase: 'F4', ksMeanP50: null },
    ],
  };
  const daily = Array.from({ length: 10 }, (_, i) => ({
    runId: 'run-ok', date: new Date(Date.UTC(2026, 0, 10 + i)), phase: 'F4', gda: 15, gdaAccum: 1000, zr: 0.95, et0: 4, kc: 1, etc: 4,
    precipitation: 0, dr: 10, ks: 1, etcAdj: 4, taw: 150, raw: 75,
  }));

  beforeEach(() => {
    repo.findHarvestForProcessing.mockResolvedValue(harvest() as never);
    repo.latestSucceededRun.mockResolvedValue(run as never);
    repo.dailyResults.mockResolvedValue(daily as never);
  });

  it('gera os cenários sobre a última run sem persistir', async () => {
    const r = await msaService.decisionScenarios(USER, 'h1', { phase: 'F3', doseBase: 100, efficiencyBase: 0.6 });
    expect(r.runId).toBe('run-ok');
    expect(r.scenarios.a.doseAdjusted).toBeCloseTo(72, 10);
    expect(r.scenarios.b?.nextPhase).toBe('F4');
    expect(repo.createDecision).not.toHaveBeenCalled();
  });

  it('janela não alcançada ⇒ 422 PHASE_NOT_REACHED', async () => {
    await expect(msaService.decisionScenarios(USER, 'h1', { phase: 'F4', doseBase: 100, efficiencyBase: 0.6 })).rejects.toMatchObject({ code: 'PHASE_NOT_REACHED' });
  });

  it('sem run ⇒ 404 NO_MSA_RESULT', async () => {
    repo.latestSucceededRun.mockResolvedValue(null);
    await expect(msaService.getLatest(USER, 'h1')).rejects.toMatchObject({ status: 404, code: 'NO_MSA_RESULT' });
  });

  it('registra o payload do cenário escolhido e rejeita B indisponível', async () => {
    repo.createDecision.mockImplementation(async (d) => d as never);
    const d = await msaService.recordDecision(USER, 'h1', { phase: 'F3', scenario: 'A', doseBase: 100, efficiencyBase: 0.6, justification: 'ok' });
    expect(d).toMatchObject({ scenario: 'A', runId: 'run-ok', decidedById: 'u1' });
    expect((d.scenarioPayload as { doseAdjusted: number }).doseAdjusted).toBeCloseTo(72, 10);

    repo.dailyResults.mockResolvedValue(daily.slice(0, 1) as never); // F4 com 1 dia ⇒ b nulo
    await expect(msaService.recordDecision(USER, 'h1', { phase: 'F3', scenario: 'B', doseBase: 100, efficiencyBase: 0.6, justification: 'x' })).rejects.toMatchObject({ code: 'SCENARIO_UNAVAILABLE' });
  });
});
