import { Command as CommandPrimitive } from 'cmdk';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

/** shadcn Command (cmdk): a kereső-lista a folyamban él (DS 6.1 Combobox-lista), nem lebegő popover. */
export function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return <CommandPrimitive className={cn('flex flex-col gap-2', className)} {...props} />;
}

export function CommandInput({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <CommandPrimitive.Input
      className={cn(
        'h-10 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-text placeholder:text-subtle focus-visible:border-border-focus disabled:opacity-45',
        className,
      )}
      {...props}
    />
  );
}

export function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      className={cn(
        'max-h-[calc(var(--space-12)*5)] overflow-auto rounded-md border border-border bg-surface p-1',
        className,
      )}
      {...props}
    />
  );
}

export function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        'flex min-h-12 cursor-pointer items-center gap-3 rounded-sm px-3 text-sm text-text select-none data-[disabled=true]:cursor-default data-[disabled=true]:opacity-45 data-[selected=true]:bg-surface-sunken data-[selected=true]:outline-2 data-[selected=true]:-outline-offset-2 data-[selected=true]:outline-border-focus',
        className,
      )}
      {...props}
    />
  );
}
