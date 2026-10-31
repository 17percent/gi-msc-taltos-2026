import { useState, type ReactNode } from 'react';
import { Button } from './ui/button';
import { AlertDialog, AlertDialogContent } from './ui/dialog';

/**
 * Megerősítő dialógus (Radix AlertDialog): az alapértelmezett fókusz a „Mégse” gombon van.
 * `onConfirm` nem dobhat: a hívó kezeli a hibát (az oldal tetején), a dialóg a művelet végén bezárul.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  pendingLabel,
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
  tone?: 'danger' | 'primary';
  onConfirm: () => Promise<void>;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const [pending, setPending] = useState(false);

  async function confirm() {
    if (pending) return;
    setPending(true);
    try {
      await onConfirm();
    } finally {
      setPending(false);
      onOpenChange(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <AlertDialogContent
        title={title}
        body={body}
        {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
        action={
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            aria-busy={pending || undefined}
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending ? pendingLabel : confirmLabel}
          </Button>
        }
      />
    </AlertDialog>
  );
}
