import type { ReactNode } from 'react';

/** Cartão centralizado das páginas públicas de autenticação. */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-brand-50 to-slate-100 px-4 py-10">
      <div className="mb-6 flex items-center gap-2">
        <img src="/favicon.svg" alt="" className="h-9 w-9" />
        <span className="text-xl font-semibold text-brand-800">FertilizaCerrado</span>
      </div>
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
      {footer && <div className="mt-4 text-sm text-slate-600">{footer}</div>}
    </div>
  );
}
