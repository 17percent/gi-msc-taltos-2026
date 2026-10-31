import { cva, type VariantProps } from 'class-variance-authority';
import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

/* ---- Badge ---- */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
  {
    variants: {
      tone: {
        primary: 'bg-primary-soft text-primary-soft-text',
        neutral: 'bg-surface-sunken text-muted',
        info: 'bg-info-bg text-info',
        success: 'bg-success-bg text-success',
        warning: 'bg-warning-bg text-warning',
        danger: 'bg-danger-bg text-danger',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Badge({
  tone,
  icon: Icon,
  children,
  className,
}: VariantProps<typeof badgeVariants> & {
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn(badgeVariants({ tone }), className)}>
      {Icon ? <Icon aria-hidden="true" className="size-3.5" /> : null}
      {children}
    </span>
  );
}

/* ---- Alert ---- */
const alertVariants = cva('flex gap-3 rounded-md border p-4', {
  variants: {
    tone: {
      danger: 'border-danger/30 bg-danger-bg',
      warning: 'border-warning/30 bg-warning-bg',
      info: 'border-info/30 bg-info-bg',
      success: 'border-success/30 bg-success-bg',
    },
  },
  defaultVariants: { tone: 'info' },
});

const alertIcons = {
  danger: CircleAlert,
  warning: TriangleAlert,
  info: Info,
  success: CircleCheck,
} as const;

const alertIconColor = {
  danger: 'text-danger',
  warning: 'text-warning',
  info: 'text-info',
  success: 'text-success',
} as const;

export function Alert({
  tone = 'info',
  icon,
  title,
  children,
  role,
  className,
  ...rest
}: Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  tone?: keyof typeof alertIcons;
  icon?: LucideIcon;
  title?: string;
}) {
  const Icon = icon ?? alertIcons[tone];
  return (
    <div
      role={role ?? (tone === 'danger' ? 'alert' : undefined)}
      className={cn(alertVariants({ tone }), className)}
      {...rest}
    >
      <Icon aria-hidden="true" className={cn('mt-0.5 size-5 shrink-0', alertIconColor[tone])} />
      <div className="min-w-0 text-sm text-text">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children}
      </div>
    </div>
  );
}

/* ---- Card ---- */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-surface p-4 shadow-(--shadow-sm) sm:p-6',
        className,
      )}
      {...props}
    />
  );
}

/* ---- Skeleton (DS 6.1) ---- */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('anim-pulse rounded-sm bg-surface-sunken', className)} />
  );
}

/** Betöltés-konténer: `aria-busy` + rejtett állapotszöveg. */
export function LoadingRegion({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div aria-busy="true" className={className}>
      <p role="status" className="sr-only">
        {label}
      </p>
      {children}
    </div>
  );
}

/* ---- Üres állapot (DS 6.1) ---- */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-(--read-width) flex-col items-center gap-4 px-4 py-10 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-primary-soft text-3xl text-primary-soft-text">
        <Icon aria-hidden="true" className="size-[1em]" />
      </span>
      <h2 className="text-lg font-semibold text-text">{title}</h2>
      {children ? <div className="text-muted">{children}</div> : null}
      {action}
    </div>
  );
}

/* ---- Színpont (DS 6.1): a szín adat, inline style ---- */
export function SpaceDot({
  color,
  size = 'sm',
  className,
}: {
  color: string | null | undefined;
  size?: 'sm' | 'lg';
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-testid="space-dot"
      style={color ? { backgroundColor: color } : undefined}
      className={cn(
        'inline-block shrink-0 rounded-full border border-border-strong',
        !color && 'bg-surface-sunken',
        size === 'lg' ? 'size-8' : 'size-3',
        className,
      )}
    />
  );
}

/* ---- Avatar ---- */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return '?';
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  return [first, last]
    .map((part) => (part ? (Array.from(part)[0]?.toUpperCase() ?? '') : ''))
    .join('');
}

export function Avatar({
  name,
  url,
  className,
}: {
  name: string;
  url: string | null;
  className?: string;
}) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        referrerPolicy="no-referrer"
        className={cn('size-8 shrink-0 rounded-full object-cover', className)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-on-primary',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
