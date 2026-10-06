import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';

/** Resumo da calibração para a run e para o painel. */
export interface QmCalibrationSummary {
  id: string;
  stationCode: string;
  stationName: string;
  years: number;
  distanceKm: number;
  periodFrom: string;
  periodTo: string;
  method: string;
}

export interface QmCalibrationView extends QmCalibrationSummary {
  cellLat: number;
  cellLon: number;
  variable: string;
  active: boolean;
  createdAt: Date;
}

const toDate = (d: Date) => d.toISOString().slice(0, 10);
const years = (from: Date, to: Date) => Math.round(((to.getTime() - from.getTime()) / 86_400_000 / 365.25) * 10) / 10;

function toView(row: Prisma.QmCalibrationGetPayload<{ include: { station: { select: { name: true } } } }>): QmCalibrationView {
  return {
    id: row.id,
    stationCode: row.stationCode,
    stationName: row.station.name,
    years: years(row.periodFrom, row.periodTo),
    distanceKm: Math.round(row.distanceKm * 10) / 10,
    periodFrom: toDate(row.periodFrom),
    periodTo: toDate(row.periodTo),
    method: row.method,
    cellLat: Number(row.cellLat),
    cellLon: Number(row.cellLon),
    variable: row.variable,
    active: row.active,
    createdAt: row.createdAt,
  };
}

export const qmRepository = {
  async list(): Promise<QmCalibrationView[]> {
    const rows = await prisma.qmCalibration.findMany({
      include: { station: { select: { name: true } } },
      orderBy: [{ cellLat: 'asc' }, { cellLon: 'asc' }, { active: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(toView);
  },

  /** Calibração ativa da célula (variável tp), ou null. */
  async activeForCell(cellLat: Prisma.Decimal | number, cellLon: Prisma.Decimal | number): Promise<QmCalibrationView | null> {
    const row = await prisma.qmCalibration.findFirst({
      where: { cellLat: new Prisma.Decimal(cellLat.toString()), cellLon: new Prisma.Decimal(cellLon.toString()), variable: 'tp', active: true },
      include: { station: { select: { name: true } } },
    });
    return row ? toView(row) : null;
  },

  async summaryById(id: string | null): Promise<QmCalibrationSummary | null> {
    if (!id) return null;
    const row = await prisma.qmCalibration.findUnique({ where: { id }, include: { station: { select: { name: true } } } });
    if (!row) return null;
    const v = toView(row);
    return { id: v.id, stationCode: v.stationCode, stationName: v.stationName, years: v.years, distanceKm: v.distanceKm, periodFrom: v.periodFrom, periodTo: v.periodTo, method: v.method };
  },
};
