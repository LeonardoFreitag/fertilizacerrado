import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { ConfirmDialog, Modal } from '@/components/dialog';
import { ErrorState, LoadingState } from '@/components/states';
import { useToast } from '@/components/toast';
import { Badge, Button, PageHeader, Textarea } from '@/components/ui';
import { messageFor } from '@/lib/api/errors';
import { HARVEST_STATUS_LABELS, type HarvestStatus } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { formatDate } from '@/lib/msa/msa';
import { useField } from '../fields/api';
import { MsaPanel } from '../msa/MsaPanel';
import { useProperty } from '../properties/api';
import { useHarvest, useUpdateHarvest } from './api';

const STATUS_TONE: Record<HarvestStatus, 'green' | 'slate' | 'red'> = { ACTIVE: 'green', COMPLETED: 'slate', CANCELLED: 'red' };

export function HarvestPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const toast = useToast();
  const { user } = useSession();
  const canManage = user?.role === 'AGRONOMO' || user?.role === 'ADMIN';
  const harvest = useHarvest(id);
  const field = useField(harvest.data?.field.propertyId, harvest.data?.fieldId);
  const property = useProperty(harvest.data?.field.propertyId);
  const update = useUpdateHarvest(id);
  const [confirm, setConfirm] = useState<HarvestStatus | null>(null);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState('');
  const navState = (location.state as { msaJobId?: string | null; createdAt?: string } | null) ?? null;

  if (harvest.isPending) return <LoadingState />;
  if (harvest.isError) return <ErrorState error={harvest.error} title="Safra não encontrada" onRetry={() => harvest.refetch()} />;
  const h = harvest.data;

  async function changeStatus(status: HarvestStatus) {
    try {
      await update.mutateAsync({ status });
      toast.success(`Safra ${HARVEST_STATUS_LABELS[status].toLowerCase()}.`);
    } catch (e) {
      toast.error(messageFor(e));
    } finally {
      setConfirm(null);
    }
  }

  async function saveNotes() {
    try {
      await update.mutateAsync({ notes: notes.trim() ? notes.trim() : null });
      toast.success('Notas atualizadas.');
      setEditingNotes(false);
    } catch (e) {
      toast.error(messageFor(e));
    }
  }

  const statusLabel: Record<HarvestStatus, string> = { ACTIVE: 'Reativar', COMPLETED: 'Concluir', CANCELLED: 'Cancelar' };

  return (
    <div>
      <PageHeader
        title={`${h.field.name} · ${h.cultivar.name}`}
        subtitle={
          <>
            Safra {h.season} · emergência {formatDate(h.emergenceDate)} ·{' '}
            <Link to={`/propriedades/${h.field.propertyId}/talhoes/${h.fieldId}`} className="text-brand-700 hover:underline">
              talhão
            </Link>
            {property.data && (
              <>
                {' em '}
                <Link to={`/propriedades/${property.data.id}`} className="text-brand-700 hover:underline">
                  {property.data.name}
                </Link>
              </>
            )}
          </>
        }
        backTo={{ to: '/safras', label: 'Safras' }}
        actions={
          <>
            <Badge tone={STATUS_TONE[h.status]}>{HARVEST_STATUS_LABELS[h.status]}</Badge>
            {canManage && h.status === 'ACTIVE' && (
              <>
                <Button variant="secondary" size="sm" onClick={() => setConfirm('COMPLETED')}>
                  Concluir
                </Button>
                <Button variant="danger" size="sm" onClick={() => setConfirm('CANCELLED')}>
                  Cancelar safra
                </Button>
              </>
            )}
            {canManage && h.status !== 'ACTIVE' && (
              <Button variant="secondary" size="sm" onClick={() => setConfirm('ACTIVE')}>
                Reativar
              </Button>
            )}
          </>
        }
      />

      <div className="card mb-6 flex flex-wrap items-start justify-between gap-3 text-sm">
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-wide text-slate-500">Notas</div>
          <p className="mt-0.5 whitespace-pre-wrap text-slate-800">{h.notes ?? <span className="text-slate-400">—</span>}</p>
        </div>
        {canManage && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setNotes(h.notes ?? '');
              setEditingNotes(true);
            }}
          >
            Editar notas
          </Button>
        )}
      </div>

      {field.data && field.data.altitudeM == null && (
        <div role="alert" className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Talhão sem altitude</strong> — o MSA não processa esta safra até a altitude ser informada.{' '}
          {canManage && (
            <Link to={`/propriedades/${h.field.propertyId}/talhoes/${h.fieldId}/editar`} className="font-medium underline">
              Editar talhão
            </Link>
          )}
        </div>
      )}

      <MsaPanel harvest={h} initialJobId={navState?.msaJobId ?? null} createdAt={navState?.createdAt ?? h.createdAt} canManage={canManage} />

      <ConfirmDialog
        open={!!confirm}
        title={confirm ? `${statusLabel[confirm]} safra` : ''}
        description={
          confirm === 'CANCELLED'
            ? 'A safra deixa de ser processada pelo semanal. O histórico de runs e decisões é mantido.'
            : confirm === 'COMPLETED'
              ? 'Marca o ciclo como concluído; o semanal não processa mais esta safra.'
              : 'Volta a safra ao status ativa (o talhão não pode ter outra safra ativa).'
        }
        confirmLabel={confirm ? statusLabel[confirm] : 'Confirmar'}
        danger={confirm === 'CANCELLED'}
        loading={update.isPending}
        onConfirm={() => confirm && changeStatus(confirm)}
        onCancel={() => setConfirm(null)}
      />

      <Modal open={editingNotes} onClose={() => setEditingNotes(false)} title="Notas da safra">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={5} aria-label="Notas" />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setEditingNotes(false)}>
            Cancelar
          </Button>
          <Button onClick={saveNotes} loading={update.isPending}>
            Salvar
          </Button>
        </div>
      </Modal>
    </div>
  );
}
