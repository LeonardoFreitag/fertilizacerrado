import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ConfirmDialog, Modal } from '@/components/dialog';
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/states';
import { useToast } from '@/components/toast';
import { Badge, Button, FormField, Input, PageHeader, Select } from '@/components/ui';
import { api } from '@/lib/api/client';
import { messageFor } from '@/lib/api/errors';
import { ROLE_LABELS, type Role, type UserAdminView, type UsersPage as Page } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { formatDateTime } from '@/lib/msa/msa';
import { maskPhone } from '@/lib/validation/documents';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

const PAGE_SIZE = 20;

export function UsersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { user: me } = useSession();
  const [q, setQ] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [active, setActive] = useState<'' | 'true' | 'false'>('');
  const [page, setPage] = useState(1);
  const term = useDebounced(q.trim(), 300);
  const query = useQuery({
    queryKey: ['admin', 'users', term, role, active, page],
    queryFn: () => api<Page<UserAdminView>>('/users', { query: { q: term || undefined, role: role || undefined, active: active || undefined, page, pageSize: PAGE_SIZE } }),
    placeholderData: (prev) => prev,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'users'] });

  const [editing, setEditing] = useState<UserAdminView | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', crea: '', role: 'AGRONOMO' as Role });
  const [formError, setFormError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ user: UserAdminView; action: 'deactivate' | 'reactivate' } | null>(null);

  const update = useMutation({ mutationFn: ({ id, body }: { id: string; body: unknown }) => api<UserAdminView>(`/users/${id}`, { method: 'PATCH', body }) });
  const toggle = useMutation({ mutationFn: ({ id, action }: { id: string; action: 'deactivate' | 'reactivate' }) => api<UserAdminView>(`/users/${id}/${action}`, { method: 'POST' }) });
  const resend = useMutation({ mutationFn: (id: string) => api<void>(`/users/${id}/resend-verification`, { method: 'POST' }) });

  function openEdit(u: UserAdminView) {
    setForm({ name: u.name, phone: u.phone ? maskPhone(u.phone) : '', crea: u.crea ?? '', role: u.role });
    setFormError(null);
    setEditing(u);
  }

  async function saveEdit() {
    if (!editing) return;
    setFormError(null);
    const body: Record<string, unknown> = {};
    if (form.name.trim() !== editing.name) body.name = form.name.trim();
    const phone = form.phone.replace(/\D/g, '');
    if (phone !== (editing.phone ?? '')) body.phone = phone || null;
    if (form.crea.trim() !== (editing.crea ?? '')) body.crea = form.crea.trim() || null;
    if (form.role !== editing.role) body.role = form.role;
    if (Object.keys(body).length === 0) return setEditing(null);
    try {
      await update.mutateAsync({ id: editing.id, body });
      toast.success('Usuário atualizado.');
      setEditing(null);
      void invalidate();
    } catch (e) {
      setFormError(messageFor(e));
    }
  }

  async function runToggle() {
    if (!confirm) return;
    const { user, action } = confirm;
    setConfirm(null);
    try {
      await toggle.mutateAsync({ id: user.id, action });
      toast.success(action === 'deactivate' ? `${user.name} desativado(a).` : `${user.name} reativado(a).`);
      void invalidate();
    } catch (e) {
      toast.error(messageFor(e));
    }
  }

  async function runResend(u: UserAdminView) {
    try {
      await resend.mutateAsync(u.id);
      toast.success(`E-mail de verificação reenviado para ${u.email}.`);
    } catch (e) {
      toast.error(messageFor(e));
    }
  }

  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <PageHeader title="Usuários" subtitle="Contas, roles e verificação de e-mail." />
      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_12rem_10rem]">
        <div>
          <label htmlFor="u-q" className="sr-only">Buscar</label>
          <Input id="u-q" type="search" placeholder="Buscar por nome ou e-mail…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <Select aria-label="Role" value={role} onChange={(e) => { setRole(e.target.value as Role | ''); setPage(1); }}>
          <option value="">Todas as roles</option>
          {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </Select>
        <Select aria-label="Status" value={active} onChange={(e) => { setActive(e.target.value as '' | 'true' | 'false'); setPage(1); }}>
          <option value="">Ativos e inativos</option>
          <option value="true">Só ativos</option>
          <option value="false">Só inativos</option>
        </Select>
      </div>

      {query.isPending && <LoadingState />}
      {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
      {data && data.items.length === 0 && <EmptyState title="Nenhum usuário" description="Nenhuma conta corresponde aos filtros." />}
      {data && data.items.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm" data-testid="users-table">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Nome</th>
                <th className="px-4 py-2">E-mail</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Cadastro</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((u) => (
                <tr key={u.id} data-testid={`user-row-${u.email}`} className={`border-t border-slate-100 ${u.active ? '' : 'text-slate-400'}`}>
                  <td className="px-4 py-2 font-medium">
                    {u.name}
                    {u.id === me?.id && <span className="ml-1 text-xs text-slate-400">(você)</span>}
                    {u.document && <div className="text-xs font-normal text-slate-400">{u.document}</div>}
                  </td>
                  <td className="px-4 py-2">{u.email}</td>
                  <td className="px-4 py-2">{ROLE_LABELS[u.role]}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={u.active ? 'green' : 'red'}>{u.active ? 'ativo' : 'inativo'}</Badge>
                      <Badge tone={u.emailVerified ? 'slate' : 'amber'}>{u.emailVerified ? 'verificado' : 'não verificado'}</Badge>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">{formatDateTime(u.createdAt)}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(u)}>Editar</Button>
                      {!u.emailVerified && (
                        <Button variant="ghost" size="sm" onClick={() => runResend(u)} loading={resend.isPending && resend.variables === u.id}>
                          Reenviar verificação
                        </Button>
                      )}
                      {u.active ? (
                        <Button variant="ghost" size="sm" className="text-red-700" onClick={() => setConfirm({ user: u, action: 'deactivate' })} disabled={u.id === me?.id}>
                          Desativar
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" className="text-brand-700" onClick={() => setConfirm({ user: u, action: 'reactivate' })}>
                          Reativar
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-sm text-slate-600">
            <span>{data.total} usuário(s) · página {data.page} de {pages}</span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
              <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
            </div>
          </div>
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Editar — ${editing?.name ?? ''}`}>
        <div className="space-y-3">
          <FormField label="Nome" htmlFor="e-name" required>
            <Input id="e-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Telefone" htmlFor="e-phone">
              <Input id="e-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: maskPhone(e.target.value) })} />
            </FormField>
            <FormField label="CREA" htmlFor="e-crea">
              <Input id="e-crea" value={form.crea} onChange={(e) => setForm({ ...form, crea: e.target.value })} />
            </FormField>
          </div>
          <FormField label="Role" htmlFor="e-role" help={editing?.id === me?.id ? 'Você não pode rebaixar a si mesmo.' : undefined}>
            <Select id="e-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })} disabled={editing?.id === me?.id}>
              {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </Select>
          </FormField>
          <FormError message={formError} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={saveEdit} loading={update.isPending}>Salvar</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.action === 'deactivate' ? 'Desativar usuário' : 'Reativar usuário'}
        description={
          confirm?.action === 'deactivate'
            ? <>{confirm.user.name} não poderá mais entrar e suas sessões serão encerradas. Propriedades, safras e decisões são preservadas.</>
            : <>{confirm?.user.name} voltará a poder entrar com a senha atual.</>
        }
        confirmLabel={confirm?.action === 'deactivate' ? 'Desativar' : 'Reativar'}
        danger={confirm?.action === 'deactivate'}
        loading={toggle.isPending}
        onConfirm={runToggle}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
