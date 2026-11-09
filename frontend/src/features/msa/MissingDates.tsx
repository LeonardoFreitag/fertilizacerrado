import { groupMissingDates } from '@/lib/msa/msa';

/** Datas faltantes de uma run NEEDS_DATA: por extenso até 14; acima, por mês com a lista completa num expansível. */
export function MissingDates({ dates, prefix = 'Faltam dados ERA5-Land para' }: { dates: ReadonlyArray<string>; prefix?: string }) {
  const view = groupMissingDates(dates);
  if (!view.grouped) {
    return (
      <span data-testid="missing-dates">
        {prefix} {view.total} dia(s): {view.dates.join(', ')}
      </span>
    );
  }
  return (
    <span data-testid="missing-dates" data-grouped="true">
      {prefix} {view.total} dias — {view.groups.map((g) => g.label).join('; ')}.{' '}
      <details className="mt-1 inline-block">
        <summary className="cursor-pointer text-xs underline">ver todas as datas</summary>
        <span className="mt-1 block max-h-40 overflow-auto text-xs text-slate-600">{view.dates.join(', ')}</span>
      </details>
    </span>
  );
}
