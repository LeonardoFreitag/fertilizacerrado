/**
 * Leitura da série diária ERA5-Land de um talhão, no formato do motor.
 * A série é chaveada por célula (era5_daily_data); o talhão chega a ela via
 * era5_cells. A escrita é do ETL Python (backend/etl).
 */
import type { Era5DailyData } from '@prisma/client';
import { prisma } from '../../config/database';
import type { DailyWeather } from './engine/types';

export interface Coverage {
  expectedDays: number;
  presentDays: number;
  missingDates: string[];
}

type DailyRow = Pick<
  Era5DailyData,
  'time' | 't2mMax' | 't2mMin' | 't2mMean' | 'd2mMean' | 'u2' | 'rn' | 'tpCorrected'
>;

const DAY_MS = 86_400_000;

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDate(value: string): number {
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new RangeError(`data inválida: ${value}`);
  return ms;
}

/** Uma linha da hipertabela → um dia no formato que `runDailyBalance` consome. */
export function toDailyWeather(row: DailyRow): DailyWeather {
  return {
    date: toDateString(row.time),
    tmax: row.t2mMax,
    tmin: row.t2mMin,
    tmean: row.t2mMean,
    tdew: row.d2mMean,
    u2: row.u2,
    rn: row.rn,
    precipitation: row.tpCorrected,
  };
}

/** Datas de [from, to] ausentes em `present`, em ordem. */
export function findMissingDates(from: string, to: string, present: Iterable<string>): string[] {
  const start = parseDate(from);
  const end = parseDate(to);
  if (start > end) throw new RangeError(`intervalo invertido: ${from} > ${to}`);
  const have = new Set(present);
  const missing: string[] = [];
  for (let ms = start; ms <= end; ms += DAY_MS) {
    const day = new Date(ms).toISOString().slice(0, 10);
    if (!have.has(day)) missing.push(day);
  }
  return missing;
}

async function cellOfField(fieldId: string) {
  return prisma.era5Cell.findUnique({ where: { fieldId }, select: { cellLat: true, cellLon: true } });
}

export const era5Repository = {
  /** Série diária do talhão em [from, to] (YYYY-MM-DD); null se o talhão não tem célula. */
  async getDailySeriesForField(fieldId: string, from: string, to: string): Promise<DailyWeather[] | null> {
    const cell = await cellOfField(fieldId);
    if (!cell) return null;

    const rows = await prisma.era5DailyData.findMany({
      where: {
        cellLat: cell.cellLat,
        cellLon: cell.cellLon,
        time: { gte: new Date(parseDate(from)), lte: new Date(parseDate(to)) },
      },
      orderBy: { time: 'asc' },
      select: { time: true, t2mMax: true, t2mMin: true, t2mMean: true, d2mMean: true, u2: true, rn: true, tpCorrected: true },
    });
    return rows.map(toDailyWeather);
  },

  /** Dias esperados, presentes e ausentes do talhão em [from, to]; null sem célula. */
  /** Célula ERA5 do talhão (lat/lon da grade), ou null. */
  async getCell(fieldId: string): Promise<{ cellLat: number; cellLon: number } | null> {
    const cell = await cellOfField(fieldId);
    return cell ? { cellLat: Number(cell.cellLat), cellLon: Number(cell.cellLon) } : null;
  },

  async getCoverage(fieldId: string, from: string, to: string): Promise<Coverage | null> {
    const cell = await cellOfField(fieldId);
    if (!cell) return null;

    const rows = await prisma.era5DailyData.findMany({
      where: {
        cellLat: cell.cellLat,
        cellLon: cell.cellLon,
        time: { gte: new Date(parseDate(from)), lte: new Date(parseDate(to)) },
      },
      select: { time: true },
    });
    const present = rows.map((r) => toDateString(r.time));
    const missingDates = findMissingDates(from, to, present);
    const expectedDays = Math.round((parseDate(to) - parseDate(from)) / DAY_MS) + 1;
    return { expectedDays, presentDays: expectedDays - missingDates.length, missingDates };
  },
};
