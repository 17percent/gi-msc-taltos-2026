import { useState, type ReactNode } from 'react';
import { Button } from './ui/button';
import { AlertDialog, AlertDialogContent } from './ui/dialog';

/**
 * Megerősítő dialógus (Radix AlertDialog): az alapértelmezett fókusz a „Mégse” gombon van.
 * `onConfirm` nem dobhat: a hívó kezeli a hibát. A dialóg a művelet végén bezárul, kivéve ha az `onConfirm`
 * `false`-t ad: ekkor nyitva marad (a hívó a hibát a `body`-ban mutatja).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  pendingLabel,
  cancelLabel,
  confirmDisabled = false,
  tone = 'danger',
  onConfirm,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  tone?: 'danger' | 'primary';
  onConfirm: () => Promise<boolean | void>;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const [pending, setPending] = useState(false);

  async function confirm() {
    if (pending) return;
    setPending(true);
    let keepOpen = false;
    try {
      keepOpen = (await onConfirm()) === false;
    } finally {
      setPending(false);
      if (!keepOpen) onOpenChange(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <AlertDialogContent
        title={title}
        body={body}
        {...(cancelLabel ? { cancelLabel } : {})}
        {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
        action={
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            aria-busy={pending || undefined}
            disabled={pending || confirmDisabled}
            onClick={() => void confirm()}
          >
            {pending ? pendingLabel : confirmLabel}
          </Button>
        }
      />
    </AlertDialog>
  );
}
