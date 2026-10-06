import { useMemo } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import { Button } from '@/components/ui';
import type { DailyRow } from '@/lib/api/types';
import { formatDate, formatDateShort, formatNumber, phaseRanges } from '@/lib/msa/msa';
import { PHASE_COLORS } from './PhaseTimeline';

function DayTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as DailyRow | undefined;
  if (!d) return null;
  const rows: [string, string][] = [
    ['Fase', d.phase],
    ['GDA acumulado', formatNumber(d.gdaAccum, 0)],
    ['ET₀', `${formatNumber(d.et0)} mm`],
    ['Kc', formatNumber(d.kc)],
    ['ETc', `${formatNumber(d.etc)} mm`],
    ['Chuva', `${formatNumber(d.precipitation)} mm`],
    ['Dr', `${formatNumber(d.dr)} mm`],
    ['Ks', formatNumber(d.ks)],
    ['ETc ajustada', `${formatNumber(d.etcAdj)} mm`],
    ['TAW', `${formatNumber(d.taw)} mm`],
    ['RAW', `${formatNumber(d.raw)} mm`],
    ['Zr', `${formatNumber(d.zr)} m`],
  ];
  return (
    <div className="rounded-md border border-slate-200 bg-white/95 p-2 text-xs shadow">
      <div className="mb-1 font-semibold text-slate-800">{formatDate(d.date)}</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-slate-500">{k}</dt>
            <dd className="text-right text-slate-800">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function usePhaseAreas(days: ReadonlyArray<DailyRow>) {
  return useMemo(() => phaseRanges(days).ranges, [days]);
}

const tick = (v: string) => formatDateShort(v);

export function MsaCharts({ days, banner }: { days: ReadonlyArray<DailyRow>; banner: { text: string; onReset: () => void } | null }) {
  const data = useMemo(() => days.map((d) => ({ ...d })), [days]);
  const areas = usePhaseAreas(days);
  const interval = Math.max(0, Math.floor(days.length / 12) - 1);

  return (
    <div className="space-y-4" data-testid="msa-charts">
      {banner && (
        <div role="status" className="flex items-center justify-between rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-800">
          <span>{banner.text}</span>
          <Button variant="ghost" size="sm" onClick={banner.onReset}>
            Voltar à run mais recente
          </Button>
        </div>
      )}

      <div className="card">
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Chuva, ETc e ETc ajustada (mm/dia)</h3>
        <div className="h-72">
          <ResponsiveContainer>
            <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              {areas.map((a) => (
                <ReferenceArea key={a.phase} x1={a.start} x2={a.end} fill={PHASE_COLORS[a.phase].fill} fillOpacity={0.08} label={{ value: a.phase, position: 'insideTop', fontSize: 11, fill: '#475569' }} />
              ))}
              <XAxis dataKey="date" tickFormatter={tick} interval={interval} fontSize={11} />
              <YAxis yAxisId="mm" fontSize={11} width={36} />
              <YAxis yAxisId="rain" orientation="right" fontSize={11} width={36} />
              <Tooltip content={<DayTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="rain" dataKey="precipitation" name="Chuva" fill="#60a5fa" opacity={0.7} />
              <Line yAxisId="mm" type="monotone" dataKey="etc" name="ETc" stroke="#40752a" dot={false} strokeWidth={1.5} />
              <Line yAxisId="mm" type="monotone" dataKey="etcAdj" name="ETc ajustada" stroke="#c2651b" dot={false} strokeWidth={1.5} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Depleção (Dr) × RAW × TAW (mm)</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tickFormatter={tick} interval={interval} fontSize={11} />
                <YAxis fontSize={11} width={36} />
                <Tooltip content={<DayTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="taw" name="TAW" stroke="#94a3b8" dot={false} strokeDasharray="4 4" />
                <Line type="monotone" dataKey="raw" name="RAW" stroke="#f59e0b" dot={false} strokeDasharray="4 4" />
                <Line type="monotone" dataKey="dr" name="Dr" stroke="#1d4ed8" dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Coeficiente de estresse (Ks)</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tickFormatter={tick} interval={interval} fontSize={11} />
                <YAxis domain={[0, 1]} fontSize={11} width={36} />
                <Tooltip content={<DayTooltip />} />
                <ReferenceLine y={0.85} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: '0,85', position: 'right', fontSize: 10 }} />
                <ReferenceLine y={0.7} stroke="#dc2626" strokeDasharray="4 4" label={{ value: '0,70', position: 'right', fontSize: 10 }} />
                <Line type="monotone" dataKey="ks" name="Ks" stroke="#40752a" dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
