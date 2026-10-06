import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { Button } from '@/components/ui';
import { ROLE_LABELS } from '@/lib/api/types';
import { logout } from '@/lib/auth/actions';
import { useSession } from '@/lib/auth/session';

interface NavItem {
  to: string;
  label: string;
  disabled?: boolean;
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { to: '/propriedades', label: 'Propriedades' },
  { to: '/talhoes', label: 'Talhões' },
  { to: '/safras', label: 'Safras' },
  { to: '/cultivares', label: 'Cultivares' },
  { to: '/admin', label: 'Admin', adminOnly: true },
];

export function Shell() {
  const { user } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  async function handleLogout() {
    setLeaving(true);
    await logout();
    navigate('/entrar', { replace: true });
  }

  const items = NAV.filter((i) => !i.adminOnly || user?.role === 'ADMIN');

  const nav = (
    <nav aria-label="Principal" className="flex flex-col gap-1 p-3">
      {items.map((item) =>
        item.disabled ? (
          <span key={item.to} aria-disabled="true" className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-slate-400" title="Em breve">
            {item.label}
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] uppercase tracking-wide">em breve</span>
          </span>
        ) : (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              `rounded-md px-3 py-2 text-sm font-medium ${isActive ? 'bg-brand-100 text-brand-900' : 'text-slate-700 hover:bg-slate-100'}`
            }
          >
            {item.label}
          </NavLink>
        ),
      )}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white md:block">
        <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-4">
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          <span className="font-semibold text-brand-800">FertilizaCerrado</span>
        </div>
        {nav}
      </aside>

      {open && (
        <div className="fixed inset-0 z-30 md:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-slate-900/40" />
          <aside className="absolute left-0 top-0 h-full w-64 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-4 font-semibold text-brand-800">FertilizaCerrado</div>
            {nav}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4">
          <button type="button" className="rounded-md p-2 text-slate-600 hover:bg-slate-100 md:hidden" aria-label="Abrir menu" onClick={() => setOpen(true)}>
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <div className="ml-auto flex items-center gap-4">
            {user && (
              <div className="text-right leading-tight">
                <div className="text-sm font-medium text-slate-800">{user.name}</div>
                <div className="text-xs text-slate-500">{ROLE_LABELS[user.role]}</div>
              </div>
            )}
            <Button variant="secondary" size="sm" onClick={handleLogout} loading={leaving}>
              Sair
            </Button>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
