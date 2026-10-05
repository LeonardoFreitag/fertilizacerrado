/** Componentes básicos: botão, campos de formulário, cabeçalho de página. */
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 focus-visible:ring-brand-300 disabled:bg-brand-300',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:ring-brand-200',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-300 disabled:bg-red-300',
  ghost: 'text-slate-700 hover:bg-slate-100 focus-visible:ring-brand-200',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  size?: 'sm' | 'md';
}

export function Button({ variant = 'primary', loading = false, size = 'md', className = '', children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium shadow-sm transition focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed ${size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2 text-sm'} ${VARIANTS[variant]} ${className}`}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function LinkButton({ to, variant = 'primary', className = '', children }: { to: string; variant?: Variant; className?: string; children: ReactNode }) {
  return (
    <Link to={to} className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium shadow-sm transition focus:outline-none focus-visible:ring-2 ${VARIANTS[variant]} ${className}`}>
      {children}
    </Link>
  );
}

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  help?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

/** Rótulo + controle + ajuda + erro, com `aria-describedby`. */
export function FormField({ label, htmlFor, error, help, required, children, className = '' }: FieldProps) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </label>
      {children}
      {help && !error && <p id={`${htmlFor}-help`} className="mt-1 text-xs text-slate-500">{help}</p>}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };
export const Input = forwardRef<HTMLInputElement, InputProps>(({ invalid, className = '', ...rest }, ref) => (
  <input ref={ref} aria-invalid={invalid || undefined} className={`input ${invalid ? 'input-error' : ''} ${className}`} {...rest} />
));
Input.displayName = 'Input';

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean };
export const Select = forwardRef<HTMLSelectElement, SelectProps>(({ invalid, className = '', children, ...rest }, ref) => (
  <select ref={ref} aria-invalid={invalid || undefined} className={`input ${invalid ? 'input-error' : ''} ${className}`} {...rest}>
    {children}
  </select>
));
Select.displayName = 'Select';

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ invalid, className = '', ...rest }, ref) => (
  <textarea ref={ref} aria-invalid={invalid || undefined} className={`input min-h-[5rem] ${invalid ? 'input-error' : ''} ${className}`} {...rest} />
));
Textarea.displayName = 'Textarea';

export function PageHeader({ title, subtitle, actions, backTo }: { title: string; subtitle?: ReactNode; actions?: ReactNode; backTo?: { to: string; label: string } }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        {backTo && (
          <Link to={backTo.to} className="text-sm text-brand-700 hover:underline">
            ← {backTo.label}
          </Link>
        )}
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-slate-600">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'amber' | 'red' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-brand-100 text-brand-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-800',
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}
