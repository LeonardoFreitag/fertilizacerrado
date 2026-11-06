// Comparação de métodos de graus-dia — Caso 5 de docs/msa/validacao.md.
//
// Uso: pnpm msa:validate-gda -- (<clima.csv> | --synthetic [dias] | --cell <lat>,<lon> --from <AAAA-MM-DD> [--to <AAAA-MM-DD>])
//                               [--tbase 10] [--tupper 30] [--cultivar soja] [--out <saida.csv>]
//
// CSV com cabeçalho, separado por vírgula, ponto decimal: date, tmax, tmin (demais colunas ignoradas).
// --cell lê era5_daily_data pela conexão do backend (DATABASE_URL).
// Descritivo: imprime, por método (residual, ometto, ometto-tb) e janela F1–F4, início, fim e dias;
// o dia em que gdaTotal é atingido; o GDA ao fim; e a diferença de dias ometto-tb − residual.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { referenceCultivar } from '../../src/modules/cultivars/reference-cultivars';
import type { CultivarParams } from '../../src/modules/msa/engine';
import { syntheticSeason } from '../../src/modules/msa/synthetic-season';
import { InputError, parseCsv, requiredNumber } from './csv';
import { compareMethods, dayDifferences, type MethodReport, type TempDay } from './gda-methods';

interface Options {
  csv?: string;
  synthetic?: number;
  cell?: { lat: number; lon: number };
  from?: string;
  to?: string;
  tbase?: number;
  tupper: number;
  cultivar: string;
  out?: string;
}

function parseArgs(argv: string[]): Options {
  const o: Options = { tupper: 30, cultivar: 'soja' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') continue; // o pnpm repassa o separador
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new InputError(`valor ausente para ${a}`);
      return v;
    };
    if (a === '--synthetic') {
      const n = argv[i + 1];
      o.synthetic = n && !n.startsWith('--') ? Number(argv[++i]) : 150;
      if (!Number.isInteger(o.synthetic) || o.synthetic < 1) throw new InputError('--synthetic exige um inteiro ≥ 1');
    } else if (a === '--cell') {
      const [lat, lon] = next().split(',').map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new InputError('--cell exige lat,lon (ex.: -16.7,-49.3)');
      o.cell = { lat: lat!, lon: lon! };
    } else if (a === '--from') o.from = next();
    else if (a === '--to') o.to = next();
    else if (a === '--tbase') o.tbase = Number(next());
    else if (a === '--tupper') o.tupper = Number(next());
    else if (a === '--cultivar') o.cultivar = next();
    else if (a === '--out') o.out = next();
    else if (a.startsWith('--')) throw new InputError(`opção desconhecida: ${a}`);
    else o.csv = a;
  }
  if (!o.csv && o.synthetic === undefined && !o.cell) throw new InputError('informe <clima.csv>, --synthetic ou --cell');
  if (o.cell && !o.from) throw new InputError('--cell exige --from AAAA-MM-DD');
  for (const d of [o.from, o.to]) if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new InputError(`data inválida: ${d}`);
  return o;
}

function fromCsv(file: string): TempDay[] {
  if (!existsSync(file)) throw new InputError(`arquivo não encontrado: ${file}`);
  const { header, rows } = parseCsv(readFileSync(file, 'utf8'));
  for (const col of ['date', 'tmax', 'tmin']) if (!header.includes(col)) throw new InputError(`coluna obrigatória ausente: ${col}`);
  return rows.map((row, i) => ({ date: row['date']!, tmax: requiredNumber(row, 'tmax', i + 2), tmin: requiredNumber(row, 'tmin', i + 2) }));
}

async function fromCell(cell: { lat: number; lon: number }, from: string, to: string | undefined): Promise<TempDay[]> {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.era5DailyData.findMany({
      where: { cellLat: cell.lat, cellLon: cell.lon, time: { gte: new Date(`${from}T00:00:00Z`), ...(to ? { lte: new Date(`${to}T00:00:00Z`) } : {}) } },
      orderBy: { time: 'asc' },
      select: { time: true, t2mMax: true, t2mMin: true },
    });
    if (rows.length === 0) throw new InputError(`sem dados em era5_daily_data para a célula ${cell.lat},${cell.lon} a partir de ${from}`);
    return rows.map((r) => ({ date: r.time.toISOString().slice(0, 10), tmax: r.t2mMax, tmin: r.t2mMin }));
  } finally {
    await prisma.$disconnect();
  }
}

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits).replace('.', ',');
}

function printReport(reports: MethodReport[], series: TempDay[], cultivar: CultivarParams, tupper: number): void {
  console.log(`Série: ${series.length} dias (${series[0]!.date} … ${series[series.length - 1]!.date}); Tb ${fmt(cultivar.tBase)} °C; TB ${fmt(tupper)} °C; gdaTotal ${cultivar.gdaTotal}`);
  console.log('');
  console.log('método     | janela | início     | fim        | dias');
  console.log('-----------|--------|------------|------------|-----');
  for (const r of reports) {
    for (const w of r.windows) {
      console.log(`${r.method.padEnd(10)} | ${w.phase.padEnd(6)} | ${(w.start ?? '—').padEnd(10)} | ${(w.end ?? '—').padEnd(10)} | ${String(w.days).padStart(4)}`);
    }
    console.log(`${r.method.padEnd(10)} | ciclo  | gdaTotal em ${r.cycleEnd ?? 'não atingido'}; GDA ao fim ${fmt(r.gdaEnd)} °C·dia`);
  }
  const tb = reports.find((r) => r.method === 'ometto-tb')!;
  const residual = reports.find((r) => r.method === 'residual')!;
  const diff = dayDifferences(tb, residual);
  console.log('');
  console.log(`Diferença de dias por janela (ometto-tb − residual): F1 ${diff.F1 >= 0 ? '+' : ''}${diff.F1}, F2 ${diff.F2 >= 0 ? '+' : ''}${diff.F2}, F3 ${diff.F3 >= 0 ? '+' : ''}${diff.F3}, F4 ${diff.F4 >= 0 ? '+' : ''}${diff.F4}`);
  console.log(`Fim do ciclo: residual ${residual.cycleEnd ?? '—'} · ometto ${reports[1]!.cycleEnd ?? '—'} · ometto-tb ${tb.cycleEnd ?? '—'}`);
}

async function main(): Promise<void> {
  const o = parseArgs(process.argv.slice(2));
  if (o.cultivar !== 'soja') throw new InputError(`cultivar desconhecida: ${o.cultivar} (opções: soja)`);
  const base = referenceCultivar('SOJA');
  const cultivar: CultivarParams = { ...base, tBase: o.tbase ?? base.tBase };
  if (!(o.tupper > cultivar.tBase)) throw new InputError(`--tupper (${o.tupper}) deve ser maior que --tbase (${cultivar.tBase})`);

  const series: TempDay[] = o.cell
    ? await fromCell(o.cell, o.from!, o.to)
    : o.csv
      ? fromCsv(o.csv)
      : syntheticSeason(o.synthetic!, 2026).map((d) => ({ date: d.date, tmax: d.tmax, tmin: d.tmin }));

  const reports = compareMethods(series, cultivar, o.tupper);
  printReport(reports, series, cultivar, o.tupper);

  if (o.out) {
    // Separador `;` e vírgula decimal (pt-BR), como os CSVs do painel.
    const lines = ['metodo;janela;inicio;fim;dias;gda_fim'];
    for (const r of reports) for (const w of r.windows) lines.push([r.method, w.phase, w.start ?? '', w.end ?? '', w.days, fmt(r.gdaEnd, 2)].join(';'));
    writeFileSync(o.out, `${lines.join('\n')}\n`);
    console.log(`\nCSV gravado: ${o.out}`);
  }
}

main().catch((error) => {
  if (error instanceof InputError || error instanceof RangeError) {
    console.error(`Erro: ${error.message}`);
    process.exit(1);
  }
  throw error;
});
