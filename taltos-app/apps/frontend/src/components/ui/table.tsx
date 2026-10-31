import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

/** DS Táblázat: rejtett `<caption>`, `scope="col"` fejlécek. */
export function Table({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <table className="w-full border-collapse text-left text-sm">
      <caption className="sr-only">{caption}</caption>
      {children}
    </table>
  );
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-border px-3 py-2 text-xs font-semibold tracking-wide text-subtle uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('border-b border-border px-3 py-3 align-middle', className)} {...props} />
  );
}
