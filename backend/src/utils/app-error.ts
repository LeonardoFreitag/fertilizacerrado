/** Erro de aplicação com status HTTP e código estável para o cliente. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly headers?: Record<string, string>,
    /** Erros por campo, no mesmo formato do VALIDATION_ERROR do Zod */
    public readonly details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
