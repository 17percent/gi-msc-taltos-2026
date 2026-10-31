import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Button } from './button';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const AlertDialog = AlertDialogPrimitive.Root;

const overlayClass = 'anim-fade fixed inset-0 z-(--z-overlay) bg-scrim';

/** DS Modal recept: `--radius-xl`, `--shadow-xl`, a lábléc `--surface-sunken`. */
const panelClass =
  'anim-pop motion-shift fixed inset-0 z-(--z-modal) m-auto flex h-fit max-h-[calc(100dvh-var(--space-8))] w-[calc(100%-var(--space-8))] max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-surface-raised shadow-(--shadow-xl)';

type DialogContentProps = ComponentProps<typeof DialogPrimitive.Content> & {
  title: string;
  description?: ReactNode;
  footer?: ReactNode;
};

export function DialogContent({
  title,
  description,
  footer,
  children,
  className,
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayClass} />
      <DialogPrimitive.Content
        className={cn(panelClass, className)}
        {...(description ? {} : { 'aria-describedby': undefined })}
        {...props}
      >
        <div className="border-b border-border p-4 pr-16 sm:p-6 sm:pr-16">
          <DialogPrimitive.Title className="font-display text-2xl leading-snug font-semibold text-text">
            {title}
          </DialogPrimitive.Title>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {description ? (
            <DialogPrimitive.Description className="mb-4 text-sm text-muted">
              {description}
            </DialogPrimitive.Description>
          ) : null}
          {children}
        </div>
        {footer ? <DialogFooter>{footer}</DialogFooter> : null}
        {/* A bezáró gomb a DOM végén van, hogy a megnyitáskor a fókusz az első mezőre kerüljön. */}
        <DialogPrimitive.Close asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Bezárás"
            className="absolute top-2 right-2"
          >
            <X aria-hidden="true" className="size-5" />
          </Button>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** Lábléc: mobilon a gombok egymás alatt, teljes szélességben. */
export function DialogFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-3 border-t border-border bg-surface-sunken p-4 sm:flex-row sm:justify-end sm:p-6 [&>*]:w-full sm:[&>*]:w-auto">
      {children}
    </div>
  );
}

type AlertDialogContentProps = ComponentProps<typeof AlertDialogPrimitive.Content> & {
  title: string;
  /** A törzs; az `aria-describedby` célja. */
  body: ReactNode;
  cancelLabel?: string;
  /** A megerősítő gomb (veszély vagy elsődleges), a hívó adja. */
  action: ReactNode;
};

/** Megerősítő dialógus: az alapértelmezett fókusz a „Mégse” gombon van (Radix AlertDialog). */
export function AlertDialogContent({
  title,
  body,
  cancelLabel = 'Mégse',
  action,
  className,
  ...props
}: AlertDialogContentProps) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className={overlayClass} />
      <AlertDialogPrimitive.Content className={cn(panelClass, className)} {...props}>
        <div className="border-b border-border p-4 sm:p-6">
          <AlertDialogPrimitive.Title className="font-display text-2xl leading-snug font-semibold text-text">
            {title}
          </AlertDialogPrimitive.Title>
        </div>
        <AlertDialogPrimitive.Description asChild>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-sm text-text sm:p-6">
            {body}
          </div>
        </AlertDialogPrimitive.Description>
        <DialogFooter>
          <AlertDialogPrimitive.Cancel asChild>
            <Button variant="outline">{cancelLabel}</Button>
          </AlertDialogPrimitive.Cancel>
          {action}
        </DialogFooter>
      </AlertDialogPrimitive.Content>
    </AlertDialogPrimitive.Portal>
  );
}

/** Mobil oldalsáv: a Modal receptje balról (DS 6.1 Sheet). */
export function SheetContent({
  title,
  children,
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { title: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayClass} />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        className={cn(
          'anim-sheet motion-sheet fixed inset-y-0 left-0 z-(--z-modal) flex w-[min(var(--sidebar-w),85%)] flex-col gap-4 overflow-y-auto border-r border-border bg-surface p-4 shadow-(--shadow-xl)',
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export const AlertDialogAction = AlertDialogPrimitive.Action;
