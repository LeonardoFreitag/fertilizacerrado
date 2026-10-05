import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { PublicOnly, RequireAuth, RequireRole, loginPathWithNext } from './guards';
import { session } from './session';

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/entrar" element={<div>Login<LocationProbe /></div>} />
        <Route element={<PublicOnly />}>
          <Route path="/cadastro" element={<div>Cadastro</div>} />
        </Route>
        <Route element={<RequireAuth />}>
          <Route path="/propriedades" element={<div>Propriedades</div>} />
          <Route path="/propriedades/:id" element={<div>Detalhe</div>} />
          <Route element={<RequireRole roles={['ADMIN']} />}>
            <Route path="/admin" element={<div>Admin</div>} />
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const ana = { id: 'u1', name: 'Ana', email: 'ana@fc.local', role: 'AGRONOMO' as const };

beforeEach(() => session._reset());

describe('guards', () => {
  it('loginPathWithNext preserva a rota', () => {
    expect(loginPathWithNext('/propriedades/abc', '?x=1')).toBe('/entrar?next=%2Fpropriedades%2Fabc%3Fx%3D1');
    expect(loginPathWithNext('/', '')).toBe('/entrar');
  });

  it('anônimo é redirecionado para o login com next', () => {
    session.clear();
    renderAt('/propriedades/abc');
    expect(screen.getByText('Login')).toBeInTheDocument();
    expect(screen.getByTestId('loc')).toHaveTextContent('/entrar?next=%2Fpropriedades%2Fabc');
  });

  it('enquanto restaura, mostra carregando sem redirecionar', () => {
    renderAt('/propriedades'); // status inicial = loading
    expect(screen.getByRole('status')).toHaveTextContent('Restaurando sessão');
    expect(screen.queryByText('Login')).not.toBeInTheDocument();
  });

  it('autenticado vê a rota protegida', () => {
    session.setSession('t', ana);
    renderAt('/propriedades');
    expect(screen.getByText('Propriedades')).toBeInTheDocument();
  });

  it('role insuficiente vê "Sem permissão" sem redirecionar', () => {
    session.setSession('t', ana);
    renderAt('/admin');
    expect(screen.getByRole('alert')).toHaveTextContent('Sem permissão');
    expect(screen.queryByText('Login')).not.toBeInTheDocument();
  });

  it('ADMIN acessa /admin', () => {
    session.setSession('t', { ...ana, role: 'ADMIN' });
    renderAt('/admin');
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('página pública redireciona quem já tem sessão', () => {
    session.setSession('t', ana);
    render(
      <MemoryRouter initialEntries={['/cadastro']}>
        <Routes>
          <Route element={<PublicOnly />}>
            <Route path="/cadastro" element={<div>Cadastro</div>} />
          </Route>
          <Route path="/propriedades" element={<div>Home</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('Home')).toBeInTheDocument();
  });
});
