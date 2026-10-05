import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { BrowserRouter, useLocation, useNavigate } from 'react-router';
import { ToastProvider, useToast } from '@/components/toast';
import { bootstrapSession } from '@/lib/auth/bootstrap';
import { loginPathWithNext } from '@/lib/auth/guards';
import { session } from '@/lib/auth/session';
import { AppRoutes } from './routes';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false },
  },
});

/** Sessão expirada no meio do uso ⇒ limpa o cache e vai para o login com `next`. */
function SessionWatcher() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  useEffect(() => {
    return session.onExpired(() => {
      queryClient.clear();
      toast.info('Sua sessão expirou. Entre novamente.');
      navigate(loginPathWithNext(location.pathname, location.search), { replace: true });
    });
  }, [navigate, location.pathname, location.search, toast]);
  return null;
}

export function App() {
  useEffect(() => {
    void bootstrapSession();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <SessionWatcher />
          <AppRoutes />
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
