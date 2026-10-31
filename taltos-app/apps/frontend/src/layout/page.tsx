import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '../lib/cn';

/**
 * Az oldal `h1`-e (display, csak címben). `tabIndex=-1`: útvonalváltáskor a keret ide teszi a fókuszt.
 */
export function PageHeading({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h1
      tabIndex={-1}
      className={cn(
        'font-display text-3xl leading-tight font-semibold tracking-tight text-text sm:text-4xl',
        className,
      )}
    >
      {children}
    </h1>
  );
}

export type Crumb = { label: string; to?: string };

/** DS 6.1 Breadcrumb: az utolsó elem `aria-current="page"`. */
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Morzsa">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={item.label} className="flex items-center gap-1">
              {index > 0 ? <ChevronRight aria-hidden="true" className="size-4" /> : null}
              {last || !item.to ? (
                <span
                  {...(last ? { 'aria-current': 'page' as const } : {})}
                  className={last ? 'text-text' : undefined}
                >
                  {item.label}
                </span>
              ) : (
                <Link to={item.to} className="rounded-sm text-secondary hover:underline">
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
