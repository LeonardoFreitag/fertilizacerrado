/** Estados padronizados de carregando / vazio / erro. */
import type { ReactNode } from 'react';
import { messageFor } from '@/lib/api/errors';
import { Button, Spinner } from './ui';

export function LoadingState({ label = 'Carregando…', fullPage = false }: { label?: string; fullPage?: boolean }) {
  return (
    <div role="status" aria-live="polite" className={`flex items-center justify-center gap-3 text-slate-500 ${fullPage ? 'min-h-screen' : 'py-16'}`}>
      <Spinner />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center py-12 text-center">
      <h2 className="text-lg font-medium text-slate-800">{title}</h2>
      {description && <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'Algo deu errado' }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <div role="alert" className="card flex flex-col items-center border-red-200 bg-red-50 py-10 text-center">
      <h2 className="text-lg font-medium text-red-800">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-red-700">{messageFor(error)}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-4" onClick={onRetry}>
          Tentar novamente
        </Button>
      )}
    </div>
  );
}

/** Mensagem de erro de formulário fora dos campos (ex.: credenciais). */
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </div>
  );
}
