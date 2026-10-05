// Convergência do Monte Carlo (Caso 3 de docs/msa/validacao.md): P50 do Ks
// médio por janela com 100, 500 e 1.000 iterações e a mesma semente.
//
// Uso:
//   pnpm msa:validate-mc -- <clima.csv> --cultivar soja|milho [opções]
//   pnpm msa:validate-mc -- --synthetic [dias] --cultivar soja [opções]
// Opções: --altitude <m> (741)  --soil <fc,wp> (0.28,0.12)  --seed <n> (2026)
//         --out <saida.csv>  --write-weather <clima.csv> (grava a série usada)
//
// CSV de clima: date, tmax, tmin, [tmean], tdew, u2, rn, precipitation.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Crop } from '@prisma/client';
import { REFERENCE_CULTIVARS, referenceCultivar } from '../../src/modules/cultivars/reference-cultivars';
import { runMonteCarlo, type DailyWeather, type MonteCarloResult, type SoilParams } from '../../src/modules/msa/engine';
import { syntheticSeason } from '../../src/modules/msa/synthetic-season';
import { InputError, optionalNumber, parseCsv, requiredNumber, toCsv } from './csv';

const COUNTS = [100, 500, 1000] as const;
const CONVERGENCE_LIMIT = 0.005;

interface Args {
  input?: string;
  synthetic?: number;
  cultivar?: string;
  altitude: number;
  soil: SoilParams;
  seed: number;
  out?: string;
  writeWeather?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { altitude: 741, soil: { thetaFC: 0.28, thetaWP: 0.12 }, seed: 2026 };
  const list = argv.filter((a) => a !== '--');
  for (let i = 0; i < list.length; i++) {
    const a = list[i]!;
    const next = () => {
      const v = list[++i];
      if (v === undefined) throw new InputError(`opção ${a} exige um valor`);
      return v;
    };
    switch (a) {
      case '--synthetic': {
        const v = list[i + 1];
        args.synthetic = v !== undefined && !v.startsWith('--') ? Number(list[++i]) : 150;
        break;
      }
      case '--cultivar':
        args.cultivar = next().toUpperCase();
        break;
      case '--altitude':
        args.altitude = Number(next());
        break;
      case '--soil': {
        const [fc, wp] = next().split(',').map(Number);
        args.soil = { thetaFC: fc!, thetaWP: wp! };
        break;
      }
      case '--seed':
        args.seed = Number(next());
        break;
      case '--out':
        args.out = next();
        break;
      case '--write-weather':
        args.writeWeather = next();
        break;
      default:
        if (a.startsWith('--')) throw new InputError(`opção desconhecida: ${a}`);
        args.input = a;
    }
  }
  return args;
}

function readWeather(path: string): DailyWeather[] {
  if (!existsSync(path)) throw new InputError(`arquivo não encontrado: ${path}`);
  const { rows } = parseCsv(readFileSync(path, 'utf8'));
  return rows.map((row, i) => {
    const line = i + 2;
    const date = row['date'];
    if (!date) throw new InputError(`linha ${line}: coluna "date" ausente`);
    return {
      date,
      tmax: requiredNumber(row, 'tmax', line),
      tmin: requiredNumber(row, 'tmin', line),
      tmean: optionalNumber(row, 'tmean'),
      tdew: requiredNumber(row, 'tdew', line),
      u2: requiredNumber(row, 'u2', line),
      rn: requiredNumber(row, 'rn', line),
      precipitation: requiredNumber(row, 'precipitation', line),
    };
  });
}

function weatherCsv(days: DailyWeather[]): string {
  return toCsv(
    ['date', 'tmax', 'tmin', 'tdew', 'u2', 'rn', 'precipitation'],
    days.map((d) => [d.date, d.tmax, d.tmin, d.tdew, d.u2, d.rn, d.precipitation]),
  );
}

const f = (v: number | null | undefined, d = 4) => (v === null || v === undefined ? 'n/d' : v.toFixed(d));

function main(argv: string[]): number {
  const args = parseArgs(argv);

  const crops = REFERENCE_CULTIVARS.map((c) => c.crop.toLowerCase());
  if (!args.cultivar || !crops.includes(args.cultivar.toLowerCase())) {
    throw new InputError(`informe --cultivar com uma das opções: ${crops.join(', ')}`);
  }
  const cultivar = referenceCultivar(args.cultivar as Crop);

  let days: DailyWeather[];
  let source: string;
  if (args.synthetic !== undefined) {
    days = syntheticSeason(args.synthetic, args.seed);
    source = `série sintética (${args.synthetic} dias, semente ${args.seed})`;
  } else if (args.input) {
    days = readWeather(args.input);
    source = args.input;
  } else {
    throw new InputError('informe um CSV de clima ou --synthetic [dias]');
  }
  if (args.writeWeather) writeFileSync(args.writeWeather, weatherCsv(days));

  const results = new Map<number, MonteCarloResult>();
  for (const n of COUNTS) {
    results.set(n, runMonteCarlo(days, cultivar, args.soil, { iterations: n, seed: args.seed, altitude: args.altitude }));
  }
  const r1000 = results.get(1000)!;

  console.log(`\nMonte Carlo — ${cultivar.name}`);
  console.log(`Clima: ${source} · ${days.length} dias · altitude ${args.altitude} m · solo θFC ${args.soil.thetaFC} θWP ${args.soil.thetaWP} · semente ${args.seed}`);
  console.log(`σP ${r1000.sigmaPrecip} · σT ${r1000.sigmaTemp} °C · perturbação sistemática por iteração\n`);
  console.log('Janela  dias  P50(100)  P50(500)  P50(1000)  var 500→1000   P10(1000)  P90(1000)  baseline  válidas');

  const outRows: Array<Array<string | number | null>> = [];
  let allOk = true;
  for (let p = 0; p < 4; p++) {
    const ph = r1000.phases[p]!;
    const base = r1000.baseline[p]!;
    const p50 = COUNTS.map((n) => results.get(n)!.phases[p]!.ksMean?.p50 ?? null);
    const [p50_100, p50_500, p50_1000] = p50;
    const variation = p50_500 !== null && p50_1000 !== null && p50_1000 !== 0 ? Math.abs(p50_500 - p50_1000) / p50_1000 : null;
    const ok = variation === null ? null : variation < CONVERGENCE_LIMIT;
    if (ok === false) allOk = false;

    console.log(
      `${ph.phase.padEnd(7)} ${String(base.days).padStart(4)}  ${f(p50_100).padStart(8)}  ${f(p50_500).padStart(8)}  ${f(p50_1000).padStart(9)}  ${
        variation === null ? '      n/d    ' : `${(variation * 100).toFixed(3).padStart(7)} % ${ok ? 'OK  ' : 'FALHA'}`
      }  ${f(ph.ksMean?.p10).padStart(9)}  ${f(ph.ksMean?.p90).padStart(9)}  ${f(base.ksMean).padStart(8)}  ${String(ph.validIterations).padStart(7)}`,
    );
    outRows.push([ph.phase, base.days, p50_100, p50_500, p50_1000, variation === null ? null : variation * 100, ph.ksMean?.p10 ?? null, ph.ksMean?.p90 ?? null, base.ksMean, ph.validIterations]);
  }

  console.log(`\nCritério (Caso 3): |P50₅₀₀ − P50₁₀₀₀| / P50₁₀₀₀ < ${CONVERGENCE_LIMIT * 100} % em toda janela com dias → ${allOk ? 'OK' : 'FALHA'}`);
  console.log('Redução de produtividade P50 (1000 it.): ' + r1000.phases.map((p) => `${p.phase} ${f(p.yieldReductionPct?.p50, 2)} %`).join(' · '));

  if (args.out) {
    writeFileSync(
      args.out,
      toCsv(['phase', 'days', 'p50_100', 'p50_500', 'p50_1000', 'variation_pct', 'p10_1000', 'p90_1000', 'baseline', 'valid_iterations'], outRows),
    );
    console.log(`Resultados gravados em ${args.out}`);
  }
  console.log();
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`Erro: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
