import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/dialog';
import { ErrorState, LoadingState } from '@/components/states';
import { useToast } from '@/components/toast';
import { Button, FormField, Input, Select, Textarea } from '@/components/ui';
import { ApiError } from '@/lib/api/client';
import { messageFor } from '@/lib/api/errors';
import type { DecisionScenarios, HarvestResponse, MsaLatest, ScenarioCode, YieldPhase } from '@/lib/api/types';
import { PHASE_LABELS, YIELD_PHASES } from '@/lib/api/types';
import { formatDateTime, formatNumber, formatPct } from '@/lib/msa/msa';
import { useDecisionScenarios, useDecisions, useRecordDecision } from './api';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

function defaultPhase(latest: MsaLatest): YieldPhase {
  if (latest.currentPhase && latest.currentPhase !== 'COMPLETED') return latest.currentPhase;
  const reached = (latest.phases ?? []).filter((p) => p.ksMean != null);
  return reached.at(-1)?.phase ?? 'F1';
}

function ScenarioCard({ code, title, children, available = true, reason, canManage, onRecord }: { code: ScenarioCode; title: string; children: React.ReactNode; available?: boolean; reason?: string | null; canManage: boolean; onRecord: (c: ScenarioCode) => void }) {
  return (
    <div data-testid={`scenario-${code}`} className={`flex flex-col rounded-lg border p-4 ${available ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="rounded-md bg-slate-800 px-2 py-0.5 text-xs font-bold text-white">{code}</span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="flex-1 text-sm">{available ? children : <p>{reason ?? 'Indisponível para esta janela.'}</p>}</div>
      {canManage && available && (
        <Button className="mt-3" size="sm" variant="secondary" onClick={() => onRecord(code)}>
          Registrar decisão {code}
        </Button>
      )}
    </div>
  );
}

export function DecisionPanel({ harvest, latest, runId, canManage }: { harvest: HarvestResponse; latest: MsaLatest; runId: string | undefined; canManage: boolean }) {
  const toast = useToast();
  const [phase, setPhase] = useState<YieldPhase>(() => defaultPhase(latest));
  const [doseBase, setDoseBase] = useState('100');
  const [efficiencyBase, setEfficiencyBase] = useState('0,6');
  const dose = Number(doseBase.replace(',', '.'));
  const eff = Number(efficiencyBase.replace(',', '.'));
  const valid = Number.isFinite(dose) && dose >= 0 && Number.isFinite(eff) && eff >= 0 && eff <= 1;
  const params = useDebounced(valid ? { phase, doseBase: dose, efficiencyBase: eff, runId: runId === latest.run.id ? undefined : runId } : null, 400);
  const scenarios = useDecisionScenarios(harvest.id, params);
  const decisions = useDecisions(harvest.id);
  const record = useRecordDecision(harvest.id);
  const [recording, setRecording] = useState<ScenarioCode | null>(null);
  const [justification, setJustification] = useState('');
  const [justError, setJustError] = useState<string | null>(null);

  const s: DecisionScenarios | undefined = scenarios.data;
  const unreachable = scenarios.isError && scenarios.error instanceof ApiError && scenarios.error.code === 'PHASE_NOT_REACHED';
  const reachedPhases = useMemo(() => new Set((latest.phases ?? []).filter((p) => p.ksMean != null).map((p) => p.phase)), [latest.phases]);

  async function submitDecision() {
    if (!recording || !s) return;
    const text = justification.trim();
    if (text.length < 3) {
      setJustError('deve ter no mínimo 3 caracteres');
      return;
    }
    try {
      await record.mutateAsync({ phase: s.phase, scenario: recording, doseBase: dose, efficiencyBase: eff, justification: text, runId: params?.runId ?? latest.run.id });
      toast.success(`Decisão ${recording} registrada.`);
      setRecording(null);
      setJustification('');
      setJustError(null);
    } catch (e) {
      toast.error(messageFor(e));
    }
  }

  return (
    <section className="card" aria-label="Cenários de decisão">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-800">Cenários de decisão</h2>
        <p className="text-xs text-slate-500">Calculados sobre o P50 do Ks da janela (docs/msa/algoritmos.md §8). O sistema registra a escolha do técnico; não recomenda.</p>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <FormField label="Janela" htmlFor="dec-phase">
          <Select id="dec-phase" value={phase} onChange={(e) => setPhase(e.target.value as YieldPhase)}>
            {YIELD_PHASES.map((p) => (
              <option key={p} value={p}>
                {PHASE_LABELS[p]}
                {!reachedPhases.has(p) ? ' (não alcançada)' : ''}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Dose base (kg/ha)" htmlFor="dec-dose" error={!Number.isFinite(dose) || dose < 0 ? 'informe um número ≥ 0' : undefined}>
          <Input id="dec-dose" inputMode="decimal" value={doseBase} onChange={(e) => setDoseBase(e.target.value)} />
        </FormField>
        <FormField label="Eficiência base (0–1)" htmlFor="dec-eff" error={!Number.isFinite(eff) || eff < 0 || eff > 1 ? 'informe uma fração entre 0 e 1' : undefined}>
          <Input id="dec-eff" inputMode="decimal" value={efficiencyBase} onChange={(e) => setEfficiencyBase(e.target.value)} />
        </FormField>
      </div>

      {scenarios.isPending && params && <LoadingState label="Calculando cenários…" />}
      {unreachable && <p role="alert" className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">Janela {phase} ainda não alcançada nesta run.</p>}
      {scenarios.isError && !unreachable && <ErrorState error={scenarios.error} onRetry={() => scenarios.refetch()} />}

      {s && !unreachable && (
        <>
          <p className="mb-3 text-sm text-slate-700">
            Janela <strong>{s.phase}</strong> · Ks P50 = <strong>{formatNumber(s.ksP50)}</strong>
          </p>
          <div className="grid gap-3 lg:grid-cols-3">
            <ScenarioCard code="A" title="Redução de dose" canManage={canManage} onRecord={setRecording}>
              <div className="text-2xl font-semibold text-slate-900">{formatNumber(s.a.doseAdjusted, 1)} kg/ha</div>
              <div className="text-xs text-slate-600">
                de {formatNumber(s.a.doseBase, 1)} kg/ha · redução {formatPct(s.a.reductionPct)}
              </div>
              <p className="mt-2 text-xs text-slate-600">{s.a.rationale}</p>
            </ScenarioCard>
            <ScenarioCard code="B" title="Parcelamento" available={!!s.b} reason={s.bUnavailableReason} canManage={canManage} onRecord={setRecording}>
              {s.b && (
                <>
                  <div className="text-xs text-slate-500">Janela seguinte {s.b.nextPhase}, dividida pela ETc projetada</div>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    <div className="rounded bg-slate-50 p-2">
                      <div className="text-xs text-slate-500">1ª parcela · {s.b.days1} dias</div>
                      <div className="text-lg font-semibold">{formatNumber(s.b.dose1, 1)} kg/ha</div>
                      <div className="text-xs text-slate-500">{formatPct(s.b.fraction1 * 100, 0)} da dose</div>
                    </div>
                    <div className="rounded bg-slate-50 p-2">
                      <div className="text-xs text-slate-500">2ª parcela · {s.b.days2} dias</div>
                      <div className="text-lg font-semibold">{formatNumber(s.b.dose2, 1)} kg/ha</div>
                      <div className="text-xs text-slate-500">{formatPct(s.b.fraction2 * 100, 0)} da dose</div>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-slate-600">{s.b.rationale}</p>
                </>
              )}
            </ScenarioCard>
            <ScenarioCard code="C" title="Fator de eficiência" canManage={canManage} onRecord={setRecording}>
              <div className="text-2xl font-semibold text-slate-900">{formatNumber(s.c.efficiencyAdjusted)}</div>
              <div className="text-xs text-slate-600">de {formatNumber(s.c.efficiencyBase)} · eficiência ajustada pelo Ks P50</div>
              <p className="mt-2 text-xs text-slate-600">{s.c.rationale}</p>
            </ScenarioCard>
          </div>
        </>
      )}

      <div className="mt-6">
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Decisões registradas</h3>
        {decisions.isPending && <LoadingState label="Carregando decisões…" />}
        {decisions.data && decisions.data.length === 0 && <p className="text-sm text-slate-500">Nenhuma decisão registrada para esta safra.</p>}
        {decisions.data && decisions.data.length > 0 && (
          <ul className="divide-y divide-slate-100 text-sm" data-testid="decisions-list">
            {decisions.data.map((d) => (
              <li key={d.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <div>
                  <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-xs font-bold text-white">{d.scenario}</span> <strong>{d.phase}</strong> · dose {formatNumber(d.doseBase, 1)} kg/ha · eficiência {formatNumber(d.efficiencyBase)}
                  <p className="mt-0.5 text-slate-700">“{d.justification}”</p>
                </div>
                <div className="text-right text-xs text-slate-500">
                  {d.decidedBy.name}
                  <br />
                  {formatDateTime(d.createdAt)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal open={!!recording} onClose={() => setRecording(null)} title={`Registrar decisão — cenário ${recording ?? ''}`}>
        <p className="text-sm text-slate-600">
          Janela {s?.phase} · dose base {formatNumber(dose, 1)} kg/ha · eficiência base {formatNumber(eff)}. O cenário é gravado tal como calculado nesta run.
        </p>
        <FormField label="Justificativa" htmlFor="dec-just" required error={justError ?? undefined} className="mt-3">
          <Textarea id="dec-just" value={justification} onChange={(e) => setJustification(e.target.value)} maxLength={2000} rows={4} invalid={!!justError} />
        </FormField>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setRecording(null)}>
            Cancelar
          </Button>
          <Button onClick={submitDecision} loading={record.isPending}>
            Registrar
          </Button>
        </div>
      </Modal>
    </section>
  );
}
