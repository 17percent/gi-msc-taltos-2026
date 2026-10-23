import type { ReactNode } from 'react';

export const buttonBase =
  'inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-semibold no-underline transition-colors duration-(--duration-fast) ease-(--ease-standard)';

export const buttonOutline =
  'border border-border-strong bg-transparent text-text hover:bg-surface-sunken';

/** Teljes oldalas navigáció a backend `/auth/login` végpontjára (nem fetch). */
export function LoginLink({
  variant = 'primary',
  children,
}: {
  variant?: 'primary' | 'outline';
  children: ReactNode;
}) {
  const look =
    variant === 'primary' ? 'bg-primary text-on-primary hover:bg-primary-hover' : buttonOutline;
  return (
    <a href="/auth/login" className={`${buttonBase} ${look}`}>
      {children}
    </a>
  );
}
