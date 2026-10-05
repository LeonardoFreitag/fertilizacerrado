// Validação de ET₀ contra uma referência externa (CROPWAT / CLIMWAT / estação)
// — Caso 1 de docs/msa/validacao.md.
//
// Uso: pnpm msa:validate-et0 -- <entrada.csv> [--out <saida.csv>]
//
// CSV com cabeçalho, separado por vírgula, ponto decimal, sem aspas. Colunas:
//   id | date (YYYY-MM-DD)      identificação da linha (date também fornece doy)
//   lat                         latitude em graus (N positivo) — para rs/n
//   altitude                    metros (obrigatória)
//   doy                         dia do ano — para rs/n, se não houver date
//   tmax, tmin, tmean?          °C
//   umidade (uma via):          tdew | ea | rhmean | rhmax + rhmin
//   vento (uma via):            u2 | u10            (m/s)
//   radiação (uma via):         rn | rs | n         (MJ/m²/dia; n = horas de sol)
//   et0_reference               ET₀ de referência (mm/dia)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  actualVapourPressureFromMeanRH,
  actualVapourPressureFromRH,
  daylightHours,
  dewpointFromVapourPressure,
  extraterrestrialRadiation,
  netRadiationFromSolar,
  referenceET0Detailed,
  solarRadiationFromSunshine,
  windSpeedAt2m,
} from '../../src/modules/msa/engine';
import { InputError, optionalNumber as num, parseCsv, requiredNumber, type CsvRow as Row } from './csv';
import { ET0_CRITERIA, computeMetrics, meetsCriteria } from './metrics';

function dayOfYear(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new InputError(`data inválida: ${date} (use YYYY-MM-DD)`);
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000) + 1;
}

interface Resolved {
  id: string;
  tmax: number;
  tmin: number;
  tmean?: number;
  ea: number;
  tdew: number;
  u2: number;
  rn: number;
  altitude: number;
  et0Reference: number;
}

function resolveRow(row: Row, line: number): Resolved {
  const id = row['id'] || row['date'] || `linha-${line}`;
  const tmax = requiredNumber(row, 'tmax', line);
  const tmin = requiredNumber(row, 'tmin', line);
  const tmean = num(row, 'tmean');
  const altitude = requiredNumber(row, 'altitude', line);
  const et0Reference = requiredNumber(row, 'et0_reference', line);

  // umidade
  let ea: number;
  const tdewIn = num(row, 'tdew');
  const eaIn = num(row, 'ea');
  const rhMean = num(row, 'rhmean');
  const rhMax = num(row, 'rhmax');
  const rhMin = num(row, 'rhmin');
  if (eaIn !== undefined) ea = eaIn;
  else if (tdewIn !== undefined) ea = Math.exp((17.27 * tdewIn) / (tdewIn + 237.3)) * 0.6108;
  else if (rhMax !== undefined && rhMin !== undefined) ea = actualVapourPressureFromRH(tmax, tmin, rhMax, rhMin);
  else if (rhMean !== undefined) ea = actualVapourPressureFromMeanRH(tmax, tmin, rhMean);
  else throw new InputError(`linha ${line}: informe a umidade por tdew, ea, rhmean ou rhmax+rhmin`);
  const tdew = tdewIn ?? dewpointFromVapourPressure(ea);

  // vento
  const u2In = num(row, 'u2');
  const u10 = num(row, 'u10');
  const u2 = u2In ?? (u10 !== undefined ? windSpeedAt2m(u10, 10) : undefined);
  if (u2 === undefined) throw new InputError(`linha ${line}: informe o vento por u2 ou u10`);

  // radiação
  const rnIn = num(row, 'rn');
  let rn: number;
  if (rnIn !== undefined) {
    rn = rnIn;
  } else {
    const lat = requiredNumber(row, 'lat', line);
    const doy = num(row, 'doy') ?? (row['date'] ? dayOfYear(row['date']) : undefined);
    if (doy === undefined) throw new InputError(`linha ${line}: rs/n exigem doy ou date`);
    let rs = num(row, 'rs');
    if (rs === undefined) {
      const n = num(row, 'n');
      if (n === undefined) throw new InputError(`linha ${line}: informe a radiação por rn, rs ou n`);
      rs = solarRadiationFromSunshine(n, daylightHours(lat, doy), extraterrestrialRadiation(lat, doy));
    }
    rn = netRadiationFromSolar(rs, tmax, tmin, ea, lat, doy, altitude);
  }

  return { id, tmax, tmin, tmean, ea, tdew, u2, rn, altitude, et0Reference };
}

function fmt(value: number, digits = 3): string {
  return Number.isNaN(value) ? 'n/d' : value.toFixed(digits);
}

function main(argv: string[]): number {
  const args = argv.filter((a) => a !== '--');
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 ? args[outIdx + 1] : undefined;
  const outValueIdx = outIdx >= 0 ? outIdx + 1 : -1;
  const input = args.find((a, i) => !a.startsWith('--') && i !== outValueIdx);

  if (!input) {
    console.error('Uso: pnpm msa:validate-et0 -- <entrada.csv> [--out <saida.csv>]');
    return 1;
  }
  if (!existsSync(input)) {
    console.error(`Arquivo não encontrado: ${input}`);
    return 1;
  }

  const { header, rows } = parseCsv(readFileSync(input, 'utf8'));
  if (!header.includes('et0_reference')) {
    throw new InputError('coluna "et0_reference" ausente no CSV');
  }

  const resolved = rows.map((row, i) => resolveRow(row, i + 2));
  const results = resolved.map((r) => {
    const detail = referenceET0Detailed({
      tmax: r.tmax,
      tmin: r.tmin,
      tmean: r.tmean,
      tdew: r.tdew,
      u2: r.u2,
      rn: r.rn,
      altitude: r.altitude,
    });
    return { ...r, ...detail, error: detail.et0 - r.et0Reference };
  });

  const metrics = computeMetrics(
    results.map((r) => r.et0),
    results.map((r) => r.et0Reference),
  );
  const ok = meetsCriteria(metrics);
  const mark = (pass: boolean) => (pass ? 'OK ' : 'FALHA');

  console.log(`\nET₀ FAO-56 — ${results.length} observação(ões) de ${path.basename(input)}\n`);
  for (const r of results) {
    console.log(`  ${r.id.padEnd(32)} ET0 ${fmt(r.et0, 2)}  ref ${fmt(r.et0Reference, 2)}  erro ${r.error >= 0 ? '+' : ''}${fmt(r.error, 2)} mm/dia`);
  }
  console.log('\nMétricas (docs/msa/validacao.md):');
  console.log(`  RMSE  ${fmt(metrics.rmse)} mm/dia   (≤ ${ET0_CRITERIA.rmse})   ${mark(ok.rmse)}`);
  console.log(`  R²    ${fmt(metrics.r2)}          (≥ ${ET0_CRITERIA.r2})   ${mark(ok.r2)}`);
  console.log(`  NSE   ${fmt(metrics.nse)}          (≥ ${ET0_CRITERIA.nse})   ${mark(ok.nse)}`);
  console.log(`  PBIAS ${fmt(metrics.pbias, 2)} %        (|x| ≤ ${ET0_CRITERIA.pbiasAbs})  ${mark(ok.pbias)}`);
  if (metrics.n < 3) {
    console.log('\n  Aviso: com menos de 3 observações, R² e NSE não são informativos.');
  }

  const out = outPath ?? input.replace(/\.csv$/i, '') + '.comparison.csv';
  const cols = ['id', 'tmax', 'tmin', 'tmean', 'ea', 'tdew', 'u2', 'rn', 'altitude', 'pressure', 'gamma', 'delta', 'es', 'et0', 'et0_reference', 'error'] as const;
  const lines = [cols.join(',')];
  for (const r of results) {
    lines.push(
      [r.id, r.tmax, r.tmin, r.tmean, r.ea, r.tdew, r.u2, r.rn, r.altitude, r.pressure, r.gamma, r.delta, r.es, r.et0, r.et0Reference, r.error]
        .map((v) => (typeof v === 'number' ? v.toFixed(4) : String(v)))
        .join(','),
    );
  }
  writeFileSync(out, lines.join('\n') + '\n');
  console.log(`\nComparação gravada em ${out}\n`);
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`Erro: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
