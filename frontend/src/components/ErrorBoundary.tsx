import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  title?: string;
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Evita a tela branca: um erro de renderização em uma seção mostra a mensagem no lugar dela. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ui] erro de renderização:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <strong>{this.props.title ?? 'Não foi possível exibir esta seção.'}</strong>
          <div className="mt-1 font-mono text-xs">{this.state.error.message}</div>
          <button type="button" className="mt-2 text-xs underline" onClick={() => this.setState({ error: null })}>
            Tentar de novo
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
