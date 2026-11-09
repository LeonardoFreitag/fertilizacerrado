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
vi.mock('../../config/pre-season', () => ({ preSeasonConfig: () => ({ kc: 1, zrMode: 'zrMax' }) }));
vi.mock('../../config/stress', () => ({ stressParams: () => ({ ksThreshold: 0.7, minDays: 3 }) }));

import { ENGINE_VERSION } from './engine';
import { era5Repository } from './era5.repository';
import { msaRepository } from './msa.repository';
import { cultivarChangedSinceRun, DEFAULT_SOIL, emergenceDepletion, msaService, resolveInterval, snapshotCultivar, snapshotSoil, yieldFields } from './msa.service';

const USER = { id: 'u1', role: 'AGRONOMO' as const };
const SOJA = { ...referenceCultivar('SOJA'), id: 'c1', cycleDescription: null, isDefault: true, createdById: null, referenceSnapshot: null, createdAt: new Date(), updatedAt: new Date() };
const FIELD = { id: 'f1', name: 'T1', propertyId: 'p1', altitudeM: 741, thetaFC: 0.3, thetaWP: 0.14 };
const SERIES = syntheticSeason(150, 2026); // 2025-11-01 … 2026-03-30
/** Série desde o início do spin-up (1º de fevereiro de 2025) até 2026-03-30: 423 dias, com estação seca maio–setembro. */
const FULL = syntheticSeason(423, 2026, '2025-02-01');
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

  it('limite superior (Ometto) atinge gdaTotal em data igual ou posterior à do residual sem TB', () => {
    const hot = SERIES.map((d) => ({ ...d, tmax: d.tmax + 4 })); // mais dias com Tmax > 30
    const withTb = resolveInterval('2025-11-01', '2026-03-30', hot, SOJA);
    const noTb = resolveInterval('2025-11-01', '2026-03-30', hot, { ...SOJA, tUpper: null });
    expect(withTb.to >= noTb.to).toBe(true);
    expect(withTb.to > noTb.to).toBe(true);
  });

  it('com emergência: GDA só conta a partir dela; lacunas da entressafra entram em missingDates', () => {
    const r = resolveInterval('2025-02-01', '2026-03-30', FULL, SOJA, '2025-11-01');
    const noPre = resolveInterval('2025-11-01', '2026-03-30', FULL.filter((d) => d.date >= '2025-11-01'), SOJA);
    expect(r.to).toBe(noPre.to); // o spin-up não adianta o fim do ciclo
    expect(r.days[0]!.date).toBe('2025-02-01');
    expect(r.missingDates).toEqual([]);
    const gap = resolveInterval('2025-02-01', '2026-03-30', FULL.filter((d) => d.date !== '2025-07-01'), SOJA, '2025-11-01');
    expect(gap.missingDates).toEqual(['2025-07-01']);
    const lag = resolveInterval('2025-02-01', '2025-10-20', FULL, SOJA, '2025-11-01');
    expect(lag).toMatchObject({ from: '2025-02-01', to: '2025-11-01', days: [], missingDates: ['2025-11-01'] });
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
  it('cultivar: 16 parâmetros (com tUpper) + identificação, iguais ao registro', () => {
    const snap = snapshotCultivar(SOJA as never);
    expect(snap).toMatchObject({ id: 'c1', name: SOJA.name, crop: 'SOJA', gdaTotal: 1200, kcMid: 1.15, kyF3: 1, tUpper: 30 });
    expect(Object.keys(snap)).toHaveLength(19);
    expect(snapshotCultivar({ ...SOJA, tUpper: null } as never).tUpper).toBeNull();
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
    era5.getDailySeriesForField.mockResolvedValue(FULL.filter((d) => d.date !== '2025-11-15' && d.date !== '2025-11-16'));
    const r = await msaService.processHarvest(USER, 'h1');
    expect(r.run.status).toBe('NEEDS_DATA');
    expect(r.run.missingDates).toEqual(['2025-11-15', '2025-11-16']);
    expect(r.phases).toBeNull();
    expect(repo.createSucceededRun).not.toHaveBeenCalled();
    expect(repo.createRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'NEEDS_DATA', engineVersion: ENGINE_VERSION }));
  });

  it('lacuna na entressafra ⇒ NEEDS_DATA com as datas de junho', async () => {
    repo.findHarvestForProcessing.mockResolvedValue(harvest() as never);
    era5.getDailySeriesForField.mockResolvedValue(FULL.filter((d) => d.date !== '2025-06-10' && d.date !== '2025-06-11'));
    const r = await msaService.processHarvest(USER, 'h1');
    expect(r.run.status).toBe('NEEDS_DATA');
    expect(r.run.missingDates).toEqual(['2025-06-10', '2025-06-11']);
    expect(era5.getDailySeriesForField).toHaveBeenCalledWith('f1', '2025-02-01', expect.any(String));
  });

  it('safra criada 3 dias após a emergência ⇒ NEEDS_DATA com a emergência, sem consultar a série', async () => {
    const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
    const emergence = addDays(TODAY, -3);
    repo.findHarvestForProcessing.mockResolvedValue(harvest({ emergence }) as never);
    const r = await msaService.processHarvest(USER, 'h1');
    expect(r.run.status).toBe('NEEDS_DATA');
    expect(r.run.missingDates).toEqual([emergence]);
    expect(r.currentPhase).toBeNull();
    expect(era5.getDailySeriesForField).not.toHaveBeenCalled();
    expect(repo.createSucceededRun).not.toHaveBeenCalled();
  });

  it('emergência dentro do lag ⇒ NEEDS_DATA sem consultar o clima', async () => {
    repo.findHarvestForProcessing.mockResolvedValue(harvest({ emergence: TODAY }) as never);
    const r = await msaService.processHarvest(USER, 'h1');
    expect(r.run.status).toBe('NEEDS_DATA');
    expect(r.run.missingDates).toEqual([TODAY]);
    expect(era5.getDailySeriesForField).not.toHaveBeenCalled();
  });

  it('série completa desde fevereiro ⇒ SUCCEEDED com snapshots fiéis, 4 resumos, índice, predita e entressafra', async () => {
    repo.findHarvestForProcessing.mockResolvedValue(harvest() as never);
    era5.getDailySeriesForField.mockResolvedValue(FULL);
    const r = await msaService.processHarvest(USER, 'h1');
    expect(r.run.status).toBe('SUCCEEDED');
    expect(r.run.engineVersion).toBe('2.3.0');
    expect(r.run.dateFrom).toBe('2025-02-01');
    expect(r.run.preSeasonFrom).toBe('2025-02-01');
    expect(r.run.preSeasonKc).toBe(1);
    expect(r.run.preSeasonZr).toBe(0.95);
    expect(r.run.emergenceDepletionPct).toBeGreaterThan(0); // estação seca antes da emergência
    expect(r.run.emergenceDepletionPct).toBeLessThanOrEqual(100);
    expect(r.run.emergenceDepletionMm).toBeCloseTo((r.run.emergenceDepletionPct! / 100) * 1000 * (0.3 - 0.14) * 0.3, 6);
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
    expect(daily.length).toBeGreaterThan(300);
    expect(summaries.map((s) => s.phase)).toEqual(['F1', 'F2', 'F3', 'F4']);
    expect(summaries[0]).not.toHaveProperty('ksMeanP50');
    expect(daily[0]!.date.toISOString().slice(0, 10)).toBe('2025-02-01');
    expect(daily[0]!.phase).toBe('PRE');
    expect(daily[0]!.gda).toBe(0);
    expect(daily.find((d) => d.date.toISOString().slice(0, 10) === '2025-11-01')!.phase).toBe('F1');
    expect(r.currentPhase).not.toBe('PRE');
    // motor 2.3.0: eventos e perda gravados com os parâmetros usados
    expect(Array.isArray(r.run.stressEvents)).toBe(true);
    expect(r.run.stressKsThreshold).toBe(0.7);
    expect(r.run.stressMinDays).toBe(3);
    expect(r.run.stressComputedOnRead).toBe(false);
    expect(r.run.yieldLoss!.totalLossScHa).toBeCloseTo(65 - r.run.predictedYield!, 9);
    expect(r.run.yieldLoss!.phases.reduce((acc, p) => acc + p.lossScHa!, 0)).toBeCloseTo(65 - r.run.predictedYield!, 9);
    for (const e of r.run.stressEvents!) {
      expect(e.days).toBeGreaterThanOrEqual(3);
      expect(e.start >= '2025-11-01').toBe(true); // nunca na entressafra
    }
  });

  it('dez dias de F3 abaixo de 0,70 ⇒ evento F3 gravado e maior perda em F3', async () => {
    repo.findHarvestForProcessing.mockResolvedValue(harvest() as never);
    // Veranico de dezembro (F3 vai de 29/11 a 27/12 nesta série): a floração seca e o Ks cai por semanas; a chuva volta em F4.
    const dry = FULL.map((d) => (d.date >= '2025-12-01' && d.date <= '2025-12-27' ? { ...d, precipitation: 0 } : d));
    era5.getDailySeriesForField.mockResolvedValue(dry);
    const r = await msaService.processHarvest(USER, 'h1');
    expect(r.run.status).toBe('SUCCEEDED');
    // o evento pode avançar por F4 enquanto o solo recarrega; o que importa é a floração ter ≥ 10 dias de estresse
    const f3Days = r.run.stressEvents!.flatMap((e) => e.phases).filter((p) => p.phase === 'F3').reduce((acc, p) => acc + p.days, 0);
    expect(f3Days).toBeGreaterThanOrEqual(10);
    expect(r.run.stressEvents!.some((e) => e.phases.some((p) => p.phase === 'F3' && p.days >= 10))).toBe(true);
    const losses = r.run.yieldLoss!.phases.map((p) => p.lossScHa!);
    expect(losses[2]).toBe(Math.max(...losses));
    const [created] = repo.createSucceededRun.mock.calls[0]!;
    expect(created).toMatchObject({ stressKsThreshold: 0.7, stressMinDays: 3 });
    expect(created.stressEvents).toEqual(r.run.stressEvents);
  });

  it('safra sem Ym ⇒ perda só em percentual', async () => {
    repo.findHarvestForProcessing.mockResolvedValue(harvest({ expectedYield: null }) as never);
    era5.getDailySeriesForField.mockResolvedValue(FULL);
    const r = await msaService.processHarvest(USER, 'h1');
    expect(r.run.yieldLoss!.ym).toBeNull();
    expect(r.run.yieldLoss!.totalLossScHa).toBeNull();
    expect(r.run.yieldLoss!.phases.every((p) => p.lossScHa === null)).toBe(true);
    expect(r.run.yieldLoss!.totalLossPct).toBeCloseTo((1 - r.run.yieldIndex!) * 100, 9);
  });

  it('safra sem Ym ⇒ índice e janelas gravados, predita e Ym nulas', async () => {
    repo.findHarvestForProcessing.mockResolvedValue(harvest({ expectedYield: null }) as never);
    era5.getDailySeriesForField.mockResolvedValue(FULL);
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
    // Série sintética do início do spin-up (1º de fevereiro anterior) até emergência + 34 dias.
    const { preSeasonStart } = await import('./engine');
    const start = preSeasonStart(emergence);
    const total = Math.round((new Date(`${addDays(emergence, 34)}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86_400_000) + 1;
    const recent = syntheticSeason(total, 2026, start);
    repo.findHarvestForProcessing.mockResolvedValue(harvest({ emergence }) as never);
    era5.getDailySeriesForField.mockResolvedValue(recent);
    const r = await msaService.processHarvest(USER, 'h1');
    expect(r.run.status).toBe('SUCCEEDED');
    expect(r.run.phasesReached!).toBeLessThan(4);
    expect(r.phases!.filter((p) => p.days === 0).length).toBe(4 - r.run.phasesReached!);
  });

  it('mesmos dados ⇒ resumos, série, índice e predita idênticos (determinístico, sem semente)', async () => {
    repo.findHarvestForProcessing.mockResolvedValue(harvest() as never);
    era5.getDailySeriesForField.mockResolvedValue(FULL);
    const r1 = await msaService.processHarvest(USER, 'h1');
    const r2 = await msaService.processHarvest(USER, 'h1');
    const [, d1, s1] = repo.createSucceededRun.mock.calls[0]!;
    const [, d2, s2] = repo.createSucceededRun.mock.calls[1]!;
    expect(s1).toEqual(s2);
    expect(d1).toEqual(d2);
    expect(r1.run.yieldIndex).toBe(r2.run.yieldIndex);
    expect(r1.run.predictedYield).toBe(r2.run.predictedYield);
    expect(r1.run.emergenceDepletionMm).toBe(r2.run.emergenceDepletionMm);
  });

  it('entressafra seca ⇒ depleção na emergência > 0 e Ks inicial ≤ run com depleção 0', async () => {
    repo.findHarvestForProcessing.mockResolvedValue(harvest() as never);
    era5.getDailySeriesForField.mockResolvedValue(FULL);
    const r = await msaService.processHarvest(USER, 'h1');
    const [, daily] = repo.createSucceededRun.mock.calls[0]!;
    const firstCrop = daily.find((d) => d.phase === 'F1')!;
    const { runDailyBalance: rdb } = await import('./engine');
    const noPre = rdb(SERIES, SOJA as never, { thetaFC: 0.3, thetaWP: 0.14 }, { altitude: 741 });
    expect(r.run.emergenceDepletionPct!).toBeGreaterThan(0);
    expect(firstCrop.ks).toBeLessThanOrEqual(noPre[0]!.ks);
  });

  it('emergência em 1º de fevereiro ⇒ sem PRE, depleção 0', async () => {
    repo.findHarvestForProcessing.mockResolvedValue(harvest({ emergence: '2025-02-01' }) as never);
    era5.getDailySeriesForField.mockResolvedValue(FULL);
    const r = await msaService.processHarvest(USER, 'h1');
    expect(r.run.status).toBe('SUCCEEDED');
    expect(r.run.preSeasonFrom).toBe('2025-02-01');
    expect(r.run.emergenceDepletionMm).toBe(0);
    expect(r.run.emergenceDepletionPct).toBe(0);
    const [, daily] = repo.createSucceededRun.mock.calls[0]!;
    expect(daily.some((d) => d.phase === 'PRE')).toBe(false);
  });

  it('erro na gravação ⇒ run FAILED com a mensagem e 500', async () => {
    repo.findHarvestForProcessing.mockResolvedValue(harvest() as never);
    era5.getDailySeriesForField.mockResolvedValue(FULL);
    repo.createSucceededRun.mockRejectedValueOnce(new Error('disco cheio'));
    await expect(msaService.processHarvest(USER, 'h1')).rejects.toMatchObject({ status: 500, code: 'MSA_PROCESSING_FAILED' });
    expect(repo.createRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED', error: 'Error: disco cheio' }));
  });
});

describe('emergenceDepletion', () => {
  const soil = { thetaFC: 0.28, thetaWP: 0.12, altitudeM: 741, soilDefaults: false };
  it('120 mm sobre zrMax 0,95 → 37,9 mm sobre zrIni 0,30 (79 %)', () => {
    const r = emergenceDepletion(120, soil, 0.95, 0.3);
    expect(r.emergenceDepletionMm).toBeCloseTo(37.9, 1);
    expect(r.emergenceDepletionPct).toBeCloseTo(78.9, 0);
  });
  it('sem spin-up ⇒ 0', () => {
    expect(emergenceDepletion(0, soil, 0.95, 0.3)).toEqual({ emergenceDepletionMm: 0, emergenceDepletionPct: 0 });
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
    const { tUpper: _t, ...legacy } = snapshot;
    expect(cultivarChangedSinceRun(legacy, { ...SOJA, tUpper: 30 })).toBe(true);
    expect(cultivarChangedSinceRun(legacy, { ...SOJA, tUpper: null })).toBe(false); // ausente = null dos dois lados
  });

  it('run do motor 2.0.0 (snapshot sem tUpper) com cultivar atual tUpper 30 ⇒ true', () => {
    const { tUpper: _t, ...legacy } = snapshot;
    expect(cultivarChangedSinceRun(legacy, SOJA)).toBe(true);
    expect(cultivarChangedSinceRun(legacy, { ...SOJA, tUpper: null })).toBe(false);
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

  it('run 2.2.0 sem campos gravados ⇒ eventos e perda calculados na leitura, sem gravar', async () => {
    repo.findHarvestForProcessing.mockResolvedValue(harvest() as never);
    const summaries = [
      { phase: 'F1', days: 10, ksMean: 1, etcAdjAccum: 1, precipAccum: 1, yieldReductionPct: 0 },
      { phase: 'F2', days: 10, ksMean: 0.9, etcAdjAccum: 1, precipAccum: 1, yieldReductionPct: 8 },
      { phase: 'F3', days: 10, ksMean: 0.8, etcAdjAccum: 1, precipAccum: 1, yieldReductionPct: 20 },
      { phase: 'F4', days: 10, ksMean: 1, etcAdjAccum: 1, precipAccum: 1, yieldReductionPct: 0 },
    ];
    repo.latestSucceededRun.mockResolvedValue({ ...run, engineVersion: '2.2.0', stressEvents: null, yieldLoss: null, stressKsThreshold: null, stressMinDays: null, yieldIndex: 0.736, predictedYield: 47.84, phaseSummaries: summaries } as never);
    const rows = Array.from({ length: 12 }, (_, i) => ({
      runId: 'run-ok', date: new Date(Date.UTC(2026, 0, 1 + i)), phase: i < 2 ? 'F2' : 'F3', gda: 10, gdaAccum: 500, zr: 0.9, et0: 5, kc: 1, etc: 5,
      precipitation: 0, dr: 60, ks: i >= 3 && i <= 8 ? 0.4 : 1, etcAdj: i >= 3 && i <= 8 ? 2 : 5, taw: 150, raw: 75,
    }));
    repo.dailyResults.mockResolvedValue(rows as never);
    const r = await msaService.getLatest(USER, 'h1');
    expect(r.run.stressComputedOnRead).toBe(true);
    expect(r.run.stressKsThreshold).toBe(0.7);
    expect(r.run.stressMinDays).toBe(3);
    expect(r.run.stressEvents).toHaveLength(1);
    expect(r.run.stressEvents![0]).toMatchObject({ start: '2026-01-04', end: '2026-01-09', days: 6, dominantPhase: 'F3' });
    expect(r.run.stressEvents![0]!.deficitMm).toBeCloseTo(18, 9);
    expect(r.run.yieldLoss!.phases.map((p) => p.lossScHa!)).toEqual([0, expect.closeTo(5.2, 9), expect.closeTo(11.96, 9), 0]);
    expect(r.run.engineVersion).toBe('2.2.0');
    expect(repo.createRun).not.toHaveBeenCalled();
    expect(repo.createSucceededRun).not.toHaveBeenCalled();
  });

  it('run 2.3.0 ⇒ devolve os campos gravados com stressComputedOnRead false', async () => {
    repo.findHarvestForProcessing.mockResolvedValue(harvest() as never);
    const stored = [{ start: '2026-01-04', end: '2026-01-09', days: 6, ksMin: 0.4, ksMean: 0.4, deficitMm: 18, phases: [{ phase: 'F3', days: 6 }], dominantPhase: 'F3', kyDominant: 1 }];
    repo.latestSucceededRun.mockResolvedValue({ ...run, engineVersion: '2.3.0', stressEvents: stored, yieldLoss: { ym: 65, yieldIndex: 0.9, predictedYield: 58.5, totalLossScHa: 6.5, totalLossPct: 10, phases: [] }, stressKsThreshold: 0.6, stressMinDays: 4 } as never);
    const r = await msaService.getLatest(USER, 'h1');
    expect(r.run.stressComputedOnRead).toBe(false);
    expect(r.run.stressEvents).toEqual(stored);
    expect(r.run.stressKsThreshold).toBe(0.6);
    expect(r.run.stressMinDays).toBe(4);
  });
});

describe('msaService.listRuns', () => {
  it('devolve só o gravado: nulos nas runs antigas, sem cálculo na leitura', async () => {
    repo.findHarvestForProcessing.mockResolvedValue(harvest() as never);
    repo.listRuns.mockResolvedValue([
      { id: 'r-new', status: 'SUCCEEDED', engineVersion: '2.3.0', stressEvents: [], yieldLoss: { ym: null }, stressKsThreshold: 0.7, stressMinDays: 3, startedAt: new Date(), finishedAt: new Date(), dateFrom: new Date(), dateTo: new Date(), qmCalibrationId: null },
      { id: 'r-old', status: 'SUCCEEDED', engineVersion: '2.2.0', stressEvents: null, yieldLoss: null, stressKsThreshold: null, stressMinDays: null, startedAt: new Date(), finishedAt: new Date(), dateFrom: new Date(), dateTo: new Date(), qmCalibrationId: null },
    ] as never);
    const runs = await msaService.listRuns(USER, 'h1');
    expect(runs[0]!.stressEvents).toEqual([]);
    expect(runs[1]!.stressEvents).toBeNull();
    expect(runs[1]!.yieldLoss).toBeNull();
    expect(repo.dailyResults).not.toHaveBeenCalled();
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
