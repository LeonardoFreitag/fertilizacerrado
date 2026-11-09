// Sensibilidade da entressafra (spin-up) — complemento do Caso 2 de docs/msa/validacao.md
// e insumo da questão aberta #11 (Kc e Zr da entressafra).
//
// Uso: pnpm msa:validate-preseason -- (--cell <lat>,<lon> | <clima.csv>) --emergence <AAAA-MM-DD>
//        [--soil <fc>,<wp>] [--altitude <m>] [--kc 0.4,0.7,1.0] [--zr-mode zrMax|zrIni] [--cultivar soja] [--out <saida.csv>]
//
// Roda o balanço de preSeasonStart(emergência) até a véspera da emergência para cada Kc e
// imprime a depleção ao fim da entressafra (mm e % de TAW do perfil) e convertida para a zona
// radicular inicial (mm e % de TAW(zrIni)), com chuva e ET₀ acumuladas. Descritivo, sem critério.
// CSV: date, tmax, tmin, tdew, u2, rn, precipitation. --cell lê era5_daily_data (DATABASE_URL).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { referenceCultivar } from '../../src/modules/cultivars/reference-cultivars';
import {
  convertDepletion,
  preSeasonStart,
  runDailyBalance,
  totalAvailableWater,
  type CultivarParams,
  type DailyWeather,
  type SoilParams,
} from '../../src/modules/msa/engine';
import { InputError, parseCsv, requiredNumber } from './csv';

interface Options {
  csv?: string;
  cell?: { lat: number; lon: number };
  emergence?: string;
  soil: SoilParams;
  altitude: number;
  kcs: number[];
  zrMode: 'zrMax' | 'zrIni';
  cultivar: string;
  out?: string;
}

function parseArgs(argv: string[]): Options {
  const o: Options = { soil: { thetaFC: 0.28, thetaWP: 0.12 }, altitude: 741, kcs: [0.4, 0.7, 1.0], zrMode: 'zrMax', cultivar: 'soja' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') continue;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new InputError(`valor ausente para ${a}`);
      return v;
    };
    if (a === '--cell') {
      const [lat, lon] = next().split(',').map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new InputError('--cell exige lat,lon (ex.: -16.7,-49.3)');
      o.cell = { lat: lat!, lon: lon! };
    } else if (a === '--emergence') o.emergence = next();
    else if (a === '--soil') {
      const [fc, wp] = next().split(',').map(Number);
      if (!Number.isFinite(fc) || !Number.isFinite(wp) || fc! <= wp!) throw new InputError('--soil exige fc,wp com fc > wp');
      o.soil = { thetaFC: fc!, thetaWP: wp! };
    } else if (a === '--altitude') o.altitude = Number(next());
    else if (a === '--kc') {
      o.kcs = next().split(',').map(Number);
      if (o.kcs.some((k) => !Number.isFinite(k) || k <= 0)) throw new InputError('--kc exige números > 0 separados por vírgula');
    } else if (a === '--zr-mode') {
      const v = next();
      if (v !== 'zrMax' && v !== 'zrIni') throw new InputError('--zr-mode: zrMax ou zrIni');
      o.zrMode = v;
    } else if (a === '--cultivar') o.cultivar = next();
    else if (a === '--out') o.out = next();
    else if (a.startsWith('--')) throw new InputError(`opção desconhecida: ${a}`);
    else o.csv = a;
  }
  if (!o.emergence || !/^\d{4}-\d{2}-\d{2}$/.test(o.emergence)) throw new InputError('--emergence AAAA-MM-DD é obrigatório');
  if (!o.csv && !o.cell) throw new InputError('informe <clima.csv> ou --cell lat,lon');
  return o;
}

function fromCsv(file: string): DailyWeather[] {
  if (!existsSync(file)) throw new InputError(`arquivo não encontrado: ${file}`);
  const { header, rows } = parseCsv(readFileSync(file, 'utf8'));
  for (const col of ['date', 'tmax', 'tmin', 'tdew', 'u2', 'rn', 'precipitation']) {
    if (!header.includes(col)) throw new InputError(`coluna obrigatória ausente: ${col}`);
  }
  return rows.map((row, i) => ({
    date: row['date']!,
    tmax: requiredNumber(row, 'tmax', i + 2),
    tmin: requiredNumber(row, 'tmin', i + 2),
    tdew: requiredNumber(row, 'tdew', i + 2),
    u2: requiredNumber(row, 'u2', i + 2),
    rn: requiredNumber(row, 'rn', i + 2),
    precipitation: requiredNumber(row, 'precipitation', i + 2),
  }));
}

async function fromCell(cell: { lat: number; lon: number }, from: string, to: string): Promise<DailyWeather[]> {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.era5DailyData.findMany({
      where: { cellLat: cell.lat, cellLon: cell.lon, time: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
      orderBy: { time: 'asc' },
      select: { time: true, t2mMax: true, t2mMin: true, t2mMean: true, d2mMean: true, u2: true, rn: true, tpCorrected: true },
    });
    return rows.map((r) => ({
      date: r.time.toISOString().slice(0, 10), tmax: r.t2mMax, tmin: r.t2mMin, tmean: r.t2mMean ?? undefined, tdew: r.d2mMean, u2: r.u2, rn: r.rn, precipitation: r.tpCorrected,
    }));
  } finally {
    await prisma.$disconnect();
  }
}

function addDays(iso: string, n: number): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits).replace('.', ',');
}

export interface PreSeasonRow {
  kc: number;
  zr: number;
  days: number;
  rainMm: number;
  et0Mm: number;
  drPreMm: number;
  drPrePct: number;
  drIniMm: number;
  drIniPct: number;
}

/** Spin-up por Kc: só os dias de entressafra (até a véspera da emergência). */
export function preSeasonSensitivity(days: DailyWeather[], cultivar: CultivarParams, soil: SoilParams, altitude: number, kcs: number[], zrMode: 'zrMax' | 'zrIni', emergence: string): PreSeasonRow[] {
  const zr = zrMode === 'zrMax' ? cultivar.zrMax : cultivar.zrIni;
  const tawPre = totalAvailableWater(soil.thetaFC, soil.thetaWP, zr);
  const tawIni = totalAvailableWater(soil.thetaFC, soil.thetaWP, cultivar.zrIni);
  const pre = days.filter((d) => d.date < emergence);
  return kcs.map((kc) => {
    const rows = runDailyBalance(pre, cultivar, soil, { altitude, initialDepletion: 0, preSeason: { until: emergence, kc, zr } });
    const last = rows[rows.length - 1];
    const drPre = last?.dr ?? 0;
    const drIni = drPre > 0 ? convertDepletion(drPre, tawPre, tawIni) : 0;
    return {
      kc, zr, days: rows.length,
      rainMm: rows.reduce((a, r) => a + r.precipitation, 0),
      et0Mm: rows.reduce((a, r) => a + r.et0, 0),
      drPreMm: drPre, drPrePct: (drPre / tawPre) * 100, drIniMm: drIni, drIniPct: (drIni / tawIni) * 100,
    };
  });
}

async function main(): Promise<void> {
  const o = parseArgs(process.argv.slice(2));
  if (o.cultivar !== 'soja') throw new InputError(`cultivar desconhecida: ${o.cultivar} (opções: soja)`);
  const cultivar: CultivarParams = referenceCultivar('SOJA');
  const from = preSeasonStart(o.emergence!);
  const until = addDays(o.emergence!, -1);
  const days = (o.cell ? await fromCell(o.cell, from, until) : fromCsv(o.csv!)).filter((d) => d.date >= from && d.date < o.emergence!);

  const present = new Set(days.map((d) => d.date));
  const missing: string[] = [];
  for (let d = from; d < o.emergence!; d = addDays(d, 1)) if (!present.has(d)) missing.push(d);
  if (missing.length > 0) throw new InputError(`série incompleta entre ${from} e ${until}: faltam ${missing.length} dia(s) (${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''})`);

  const rows = preSeasonSensitivity(days, cultivar, o.soil, o.altitude, o.kcs, o.zrMode, o.emergence!);
  console.log(`Entressafra ${from} … ${until} (${days.length} dias); emergência ${o.emergence}; solo θFC ${o.soil.thetaFC} θWP ${o.soil.thetaWP}; Zr ${o.zrMode} = ${fmt(rows[0]!.zr, 2)} m; zrIni ${cultivar.zrIni} m`);
  console.log('');
  console.log('Kc   | Zr (m) | dias | chuva (mm) | ET₀ (mm) | Dr fim (mm) | % TAW perfil | Dr emergência (mm) | % TAW(zrIni)');
  console.log('-----|--------|------|------------|----------|-------------|--------------|--------------------|-------------');
  for (const r of rows) {
    console.log(`${fmt(r.kc, 2).padEnd(4)} | ${fmt(r.zr, 2).padEnd(6)} | ${String(r.days).padStart(4)} | ${fmt(r.rainMm).padStart(10)} | ${fmt(r.et0Mm).padStart(8)} | ${fmt(r.drPreMm).padStart(11)} | ${fmt(r.drPrePct).padStart(12)} | ${fmt(r.drIniMm).padStart(18)} | ${fmt(r.drIniPct).padStart(11)}`);
  }
  console.log('\nA depleção na emergência é a condição inicial do balanço da cultura; compare com o balanço de Thornthwaite-Mather em planilha (CAD = TAW do perfil) — Caso 2 de docs/msa/validacao.md.');

  if (o.out) {
    const lines = ['kc;zr_m;dias;chuva_mm;et0_mm;dr_pre_mm;dr_pre_pct;dr_ini_mm;dr_ini_pct'];
    for (const r of rows) lines.push([fmt(r.kc, 2), fmt(r.zr, 2), r.days, fmt(r.rainMm, 2), fmt(r.et0Mm, 2), fmt(r.drPreMm, 2), fmt(r.drPrePct, 2), fmt(r.drIniMm, 2), fmt(r.drIniPct, 2)].join(';'));
    writeFileSync(o.out, `${lines.join('\n')}\n`);
    console.log(`CSV gravado: ${o.out}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    if (error instanceof InputError || error instanceof RangeError) {
      console.error(`Erro: ${error.message}`);
      process.exit(1);
    }
    throw error;
  });
}
