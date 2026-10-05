import { useEffect, useState } from 'react';
import { Input } from '@/components/ui';
import { messageFor } from '@/lib/api/errors';
import type { Role, UserSummary } from '@/lib/api/types';
import { useUserSearch } from './api';

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/**
 * Busca um usuário em GET /users e devolve o escolhido. Para AGRONOMO a API
 * exige ≥ 3 caracteres; ADMIN pode listar sem termo.
 */
export function UserPicker({
  id,
  role,
  value,
  onChange,
  allowEmptySearch = false,
  invalid,
}: {
  id: string;
  role: Role;
  value: UserSummary | null;
  onChange: (user: UserSummary | null) => void;
  allowEmptySearch?: boolean;
  invalid?: boolean;
}) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(term, 300);
  const enabled = open && (debounced.trim().length >= 3 || (allowEmptySearch && debounced.trim().length === 0));
  const results = useUserSearch(debounced, role, enabled);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
        <div className="min-w-0">
          <div className="truncate font-medium text-slate-800">{value.name}</div>
          <div className="truncate text-xs text-slate-500">{value.email}</div>
        </div>
        <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => onChange(null)}>
          trocar
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        id={id}
        type="search"
        autoComplete="off"
        placeholder="Digite nome ou e-mail (mín. 3 letras)"
        value={term}
        invalid={invalid}
        onChange={(e) => setTerm(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        aria-expanded={open}
        aria-controls={`${id}-results`}
      />
      {open && (
        <ul id={`${id}-results`} role="listbox" className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg">
          {!enabled && <li className="px-3 py-2 text-slate-500">Digite ao menos 3 caracteres.</li>}
          {enabled && results.isPending && <li className="px-3 py-2 text-slate-500">Buscando…</li>}
          {enabled && results.isError && <li className="px-3 py-2 text-red-700">{messageFor(results.error)}</li>}
          {enabled && results.data?.length === 0 && <li className="px-3 py-2 text-slate-500">Nenhum usuário encontrado.</li>}
          {enabled &&
            results.data?.map((u) => (
              <li key={u.id} role="option" aria-selected="false">
                <button
                  type="button"
                  className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-brand-50"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange({ id: u.id, name: u.name, email: u.email });
                    setTerm('');
                    setOpen(false);
                  }}
                >
                  <span className="font-medium text-slate-800">{u.name}</span>
                  <span className="text-xs text-slate-500">{u.email}</span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
