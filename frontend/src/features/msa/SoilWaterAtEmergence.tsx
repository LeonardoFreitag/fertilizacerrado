import { Button } from '@/components/ui';
import type { HarvestResponse, RunView } from '@/lib/api/types';
import { formatMm, rainBeforeEmergence, soilWaterTexts } from '@/lib/msa/msa';
import { useDailySeries } from './api';

/** TAW da zona radicular inicial (mm) a partir dos snapshots da run: 1000 (θFC − θWP) zrIni. */
function tawIni(run: RunView): number | null {
  const soil = run.soilSnapshot as { thetaFC?: number; thetaWP?: number } | null;
  const cultivar = run.cultivarSnapshot as { zrIni?: number } | null;
  if (!soil?.thetaFC || !soil.thetaWP || !cultivar?.zrIni) return null;
  return 1000 * (soil.thetaFC - soil.thetaWP) * cultivar.zrIni;
}

/**
 * Cartão "Água no solo na emergência": depleção calculada pelo spin-up de
 * entressafra (desde 1º de fevereiro), chuva dos 30 dias anteriores e período.
 */
export function SoilWaterAtEmergence({ run, harvest, canManage, onReprocess }: { run: RunView; harvest: HarvestResponse; canManage: boolean; onReprocess: () => void }) {
  const full = useDailySeries(harvest.id, run.id, true, run.preSeasonFrom != null);
  const texts = soilWaterTexts(run, harvest.emergenceDate, tawIni(run));

  return (
    <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm" data-testid="soil-water-card">
      <h3 className="text-sm font-semibold text-slate-800">Água no solo na emergência</h3>
      {texts ? (
        <>
          <p className="mt-1 text-base font-medium text-slate-900" data-testid="soil-water-headline">
            {texts.headline}
          </p>
          <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-slate-600">Depleção na emergência</dt>
              <dd data-testid="soil-water-depletion">{texts.depletion}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-600">Chuva nos 30 dias anteriores</dt>
              <dd data-testid="soil-water-rain">{full.data ? formatMm(rainBeforeEmergence(full.data.days, harvest.emergenceDate)) : full.isPending ? '…' : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-600">Período do balanço</dt>
              <dd className="text-xs">{texts.period}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-slate-600">O balanço começa no último 1º de fevereiro antes da emergência, com o solo na capacidade de campo, e chega à emergência com a água calculada.</p>
        </>
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-3" data-testid="soil-water-legacy">
          <span className="text-slate-700">Esta execução não tem entressafra (motor anterior); reprocesse para calcular a água na emergência.</span>
          {canManage && (
            <Button size="sm" variant="secondary" onClick={onReprocess}>
              Reprocessar
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
