import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ErrorState, FormError, LoadingState } from '@/components/states';
import { useToast } from '@/components/toast';
import { Badge, Button, FormField, Input, PageHeader } from '@/components/ui';
import { api } from '@/lib/api/client';
import { messageFor } from '@/lib/api/errors';
import { ROLE_LABELS, type UserAdminView } from '@/lib/api/types';
import { session, useSession } from '@/lib/auth/session';
import { PasswordRules } from '@/features/auth/RegisterPage';
import { maskPhone } from '@/lib/validation/documents';
import { PASSWORD_RULES } from '@/lib/validation/schemas';

export function ProfilePage() {
  const { user } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const me = useQuery({ queryKey: ['users', 'me', user?.id], queryFn: () => api<UserAdminView>(`/users/${user!.id}`), enabled: !!user });
  const [form, setForm] = useState({ name: '', phone: '', crea: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwDone, setPwDone] = useState(false);

  useEffect(() => {
    if (me.data) setForm({ name: me.data.name, phone: me.data.phone ? maskPhone(me.data.phone) : '', crea: me.data.crea ?? '' });
  }, [me.data]);

  const save = useMutation({ mutationFn: (body: unknown) => api<UserAdminView>(`/users/${user!.id}`, { method: 'PATCH', body }) });
  const changePw = useMutation({ mutationFn: (body: { currentPassword: string; newPassword: string }) => api<void>('/users/me/password', { method: 'PATCH', body }) });

  async function saveProfile() {
    if (!me.data) return;
    setFormError(null);
    const body: Record<string, unknown> = {};
    if (form.name.trim() !== me.data.name) body.name = form.name.trim();
    const phone = form.phone.replace(/\D/g, '');
    if (phone !== (me.data.phone ?? '')) body.phone = phone || null;
    if (form.crea.trim() !== (me.data.crea ?? '')) body.crea = form.crea.trim() || null;
    if (Object.keys(body).length === 0) return toast.info('Nada a salvar.');
    try {
      const updated = await save.mutateAsync(body);
      qc.setQueryData(['users', 'me', user!.id], updated);
      const token = session.getToken();
      if (token && user) session.setSession(token, { ...user, name: updated.name });
      toast.success('Perfil atualizado.');
    } catch (e) {
      setFormError(messageFor(e));
    }
  }

  async function submitPassword() {
    setPwError(null);
    setPwDone(false);
    if (pw.next !== pw.confirm) return setPwError('A confirmação não coincide com a nova senha.');
    if (!PASSWORD_RULES.every((r) => r.test(pw.next))) return setPwError('A nova senha não atende às regras.');
    try {
      await changePw.mutateAsync({ currentPassword: pw.current, newPassword: pw.next });
      setPw({ current: '', next: '', confirm: '' });
      setPwDone(true);
      toast.success('Senha alterada. Outros dispositivos foram desconectados.');
    } catch (e) {
      setPwError(messageFor(e));
    }
  }

  if (me.isPending) return <LoadingState />;
  if (me.isError) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  const u = me.data;

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Meu perfil"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {u.email} <Badge tone="green">{ROLE_LABELS[u.role]}</Badge>
            <Badge tone={u.emailVerified ? 'slate' : 'amber'}>{u.emailVerified ? 'e-mail verificado' : 'e-mail não verificado'}</Badge>
            {!u.active && <Badge tone="red">conta desativada</Badge>}
          </span>
        }
      />

      <section className="card space-y-3" aria-label="Dados pessoais">
        <h2 className="text-sm font-semibold text-slate-800">Dados pessoais</h2>
        <FormField label="Nome" htmlFor="p-name" required>
          <Input id="p-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Telefone" htmlFor="p-phone">
            <Input id="p-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: maskPhone(e.target.value) })} />
          </FormField>
          <FormField label="CREA" htmlFor="p-crea" help={u.role === 'AGRONOMO' ? 'Registro profissional (opcional).' : undefined}>
            <Input id="p-crea" value={form.crea} onChange={(e) => setForm({ ...form, crea: e.target.value })} />
          </FormField>
        </div>
        {u.document && <p className="text-xs text-slate-500">Documento: {u.document} (não editável).</p>}
        <FormError message={formError} />
        <Button onClick={saveProfile} loading={save.isPending}>Salvar</Button>
      </section>

      <section className="card space-y-3" aria-label="Trocar senha">
        <h2 className="text-sm font-semibold text-slate-800">Trocar senha</h2>
        <FormField label="Senha atual" htmlFor="pw-current" required>
          <Input id="pw-current" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        </FormField>
        <FormField label="Nova senha" htmlFor="pw-next" required>
          <Input id="pw-next" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          <PasswordRules value={pw.next} />
        </FormField>
        <FormField label="Confirmar nova senha" htmlFor="pw-confirm" required>
          <Input id="pw-confirm" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
        </FormField>
        <FormError message={pwError} />
        {pwDone && <p role="status" className="text-sm text-brand-800">Senha alterada com sucesso.</p>}
        <Button variant="secondary" onClick={submitPassword} loading={changePw.isPending}>Alterar senha</Button>
      </section>
    </div>
  );
}
