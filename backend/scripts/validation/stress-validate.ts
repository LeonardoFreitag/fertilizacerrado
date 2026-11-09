// Eventos de estresse × veranicos observados — complemento do Caso 2 de docs/msa/validacao.md
// e insumo da questão aberta #14 (STRESS_KS_THRESHOLD / STRESS_MIN_DAYS).
//
// Uso: pnpm msa:validate-stress -- --harvest <uuid> [--station <código>] [--dry-mm 10]
//        [--ks-threshold 0.7] [--min-days 3] [--out <saida.csv>]
//
// Lê a última run SUCCEEDED da safra (série de cultura + cultivarSnapshot), recalcula os eventos
// de estresse com os parâmetros informados (padrão: STRESS_* do ambiente ou os gravados na run),
// lê as observações diárias da estação (padrão: a da calibração QM ativa da célula) e imprime os
// eventos, os veranicos (dias consecutivos com chuva < dry-mm) e a sobreposição. Descritivo.
import { writeFileSync } from 'node:fs';
import { detectStressEvents, type CultivarParams, type DailyBalanceRow, type Phase, type StressEvent } from '../../src/modules/msa/engine';
import { InputError } from './csv';
import { coverage, drySpells, nearestSpellOffset, type DrySpell, type StationDay } from './stress-methods';

interface Options {
  harvest?: string;
  station?: string;
  dryMm: number;
  ksThreshold?: number;
  minDays?: number;
  out?: string;
}

function parseArgs(argv: string[]): Options {
  const o: Options = { dryMm: 10 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') continue;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new InputError(`valor ausente para ${a}`);
      return v;
    };
    if (a === '--harvest') o.harvest = next();
    else if (a === '--station') o.station = next();
    else if (a === '--dry-mm') o.dryMm = Number(next());
    else if (a === '--ks-threshold') o.ksThreshold = Number(next());
    else if (a === '--min-days') o.minDays = Number(next());
    else if (a === '--out') o.out = next();
    else throw new InputError(`opção desconhecida: ${a}`);
  }
  if (!o.harvest) throw new InputError('--harvest <uuid> é obrigatório');
  if (!(o.dryMm > 0)) throw new InputError('--dry-mm deve ser > 0');
  return o;
}

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits).replace('.', ',');
}

async function main(): Promise<void> {
  const o = parseArgs(process.argv.slice(2));
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const harvest = await prisma.harvest.findUnique({ where: { id: o.harvest! }, select: { id: true, season: true, emergenceDate: true, latestRunId: true, field: { select: { name: true, era5Cell: { select: { cellLat: true, cellLon: true } } } } } });
    if (!harvest) throw new InputError(`safra ${o.harvest} não encontrada`);
    if (!harvest.latestRunId) throw new InputError('a safra não tem run SUCCEEDED');
    const run = await prisma.msaRun.findUniqueOrThrow({ where: { id: harvest.latestRunId }, include: { dailyResults: { where: { phase: { not: 'PRE' } }, orderBy: { date: 'asc' } } } });
    const cultivar = run.cultivarSnapshot as unknown as CultivarParams;
    const series: DailyBalanceRow[] = run.dailyResults.map((r) => ({
      date: r.date.toISOString().slice(0, 10), phase: r.phase as Phase, gda: r.gda, gdaAccum: r.gdaAccum, zr: r.zr, et0: r.et0, kc: r.kc, etc: r.etc,
      precipitation: r.precipitation, dr: r.dr, ks: r.ks, etcAdj: r.etcAdj, taw: r.taw, raw: r.raw,
    }));
    const ksThreshold = o.ksThreshold ?? (process.env['STRESS_KS_THRESHOLD'] ? Number(process.env['STRESS_KS_THRESHOLD']) : run.stressKsThreshold ?? 0.7);
    const minDays = o.minDays ?? (process.env['STRESS_MIN_DAYS'] ? Number(process.env['STRESS_MIN_DAYS']) : run.stressMinDays ?? 3);
    const events = detectStressEvents(series, cultivar, { ksThreshold, minDays });

    let station = o.station;
    if (!station) {
      const cell = harvest.field.era5Cell;
      const cal = cell ? await prisma.qmCalibration.findFirst({ where: { cellLat: cell.cellLat, cellLon: cell.cellLon, variable: 'tp', active: true }, select: { stationCode: true } }) : null;
      if (!cal) throw new InputError('a célula do talhão não tem calibração QM ativa: informe a estação com --station <código> (ver `docker compose run --rm etl stations list`)');
      station = cal.stationCode;
    }
    const from = series[0]?.date;
    const to = series[series.length - 1]?.date;
    if (!from || !to) throw new InputError('a run não tem dias de cultura');
    const obs = await prisma.stationDailyObs.findMany({ where: { stationCode: station, date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } }, orderBy: { date: 'asc' }, select: { date: true, precipMm: true } });
    if (obs.length === 0) throw new InputError(`a estação ${station} não tem observações entre ${from} e ${to} (importe o CSV da estação em /admin ou pelo ETL)`);
    const days: StationDay[] = obs.map((r) => ({ date: r.date.toISOString().slice(0, 10), precipMm: r.precipMm }));
    const spells = drySpells(days, o.dryMm, minDays);

    console.log(`Safra ${harvest.season} · talhão ${harvest.field.name} · emergência ${harvest.emergenceDate.toISOString().slice(0, 10)} · run ${run.id.slice(0, 8)} (motor ${run.engineVersion}) · cultura ${from} … ${to}`);
    console.log(`Eventos: Ks < ${fmt(ksThreshold, 2)} por ≥ ${minDays} dias · Veranicos: estação ${station}, chuva < ${fmt(o.dryMm)} mm por ≥ ${minDays} dias (${days.length} obs., ${days.filter((d) => d.precipMm == null).length} sem dado)`);
    console.log('');
    console.log('EVENTOS DE ESTRESSE (motor)');
    console.log('início     | fim        | dias | janela | déficit (mm) | Ks mín | cobertura por veranico | veranico mais próximo');
    console.log('-----------|------------|------|--------|--------------|--------|------------------------|----------------------');
    const rows: string[][] = [];
    for (const e of events) {
      const cov = coverage(e, spells) * 100;
      const off = nearestSpellOffset(e, spells);
      console.log(`${e.start} | ${e.end} | ${String(e.days).padStart(4)} | ${e.dominantPhase.padEnd(6)} | ${fmt(e.deficitMm).padStart(12)} | ${fmt(e.ksMin, 2).padStart(6)} | ${`${fmt(cov, 0)} %`.padStart(22)} | ${off === null ? '—' : `${off > 0 ? '+' : ''}${off} d`}`);
      rows.push(['evento', e.start, e.end, String(e.days), e.dominantPhase, fmt(e.deficitMm, 2), fmt(cov, 1)]);
    }
    if (events.length === 0) console.log('(nenhum evento)');
    console.log('');
    console.log('VERANICOS (estação)');
    console.log('início     | fim        | dias | chuva (mm) | coincide com evento');
    console.log('-----------|------------|------|------------|--------------------');
    for (const s of spells) {
      const hit = events.some((e) => e.start <= s.end && e.end >= s.start);
      console.log(`${s.start} | ${s.end} | ${String(s.days).padStart(4)} | ${fmt(s.rainMm).padStart(10)} | ${hit ? 'sim' : 'não'}`);
      rows.push(['veranico', s.start, s.end, String(s.days), '', '', hit ? '100,0' : '0,0']);
    }
    if (spells.length === 0) console.log('(nenhum veranico)');
    console.log('\nLeitura descritiva (Caso 2 de docs/msa/validacao.md): concordância de datas entre a falta de água calculada e os períodos secos observados; sem critério de aceitação. Varie --ks-threshold e --min-days para a sensibilidade da questão #14.');

    if (o.out) {
      const lines = ['tipo;inicio;fim;dias;janela;deficit_mm;cobertura_pct', ...rows.map((r) => r.join(';'))];
      writeFileSync(o.out, `${lines.join('\n')}\n`);
      console.log(`CSV gravado: ${o.out}`);
    }
    void (spells as DrySpell[]);
    void (events as StressEvent[]);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  if (err instanceof InputError) {
    console.error(`Erro: ${err.message}`);
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
