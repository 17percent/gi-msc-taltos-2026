import type { DocumentDetail } from '@taltos/shared';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { isApiError } from '../api/client';
import { isRetryable } from '../api/errors';
import { apiPath } from '../api/paths';
import { useApi } from '../api/use-api';
import { useAuth } from '../auth/auth-context';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FormError } from '../components/FormError';
import { useSpaces } from '../spaces/space-context';

/**
 * Piszkozat eldobása (spec 5.): megerősítés (a fókusz a „Mégse”-n), hibánál a dialógus nyitva marad és a
 * hibaüzenet a törzs fölött látszik. Siker: a Kezdőlapra navigál (replace), toast.
 */
export function DiscardDraftDialog({
  doc,
  open,
  onOpenChange,
  onChanged,
  onCloseAutoFocus,
}: {
  doc: DocumentDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Az oldal adatait újra kell tölteni (a dokumentum állapota közben megváltozott). */
  onChanged: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const api = useApi();
  const navigate = useNavigate();
  const { refreshMe } = useAuth();
  const spaces = useSpaces();
  const [error, setError] = useState<{ value: unknown } | null>(null);
  const discarded = useRef(false);

  async function discard(): Promise<boolean> {
    try {
      await api.del(apiPath`/api/v1/documents/${doc.id}/draft`);
    } catch (caught) {
      setError({ value: caught });
      if (isApiError(caught)) {
        if (caught.code === 'forbidden') void refreshMe();
        else if (caught.code === 'space_closed') void spaces.refreshMembership();
        // A dokumentum állapota megváltozott: az oldal frissül (a menüelem eltűnik, vagy a 404 állapot jön).
        if (
          [
            'request_pending',
            'has_approved_revision',
            'space_closed',
            'not_found',
            'not_space_member',
          ].includes(caught.code)
        ) {
          onChanged();
        }
      }
      return false;
    }
    discarded.current = true;
    toast.success(`A Piszkozat eldobva: „${doc.title}”.`);
    void navigate('/', { replace: true });
    return true;
  }

  const retryable = error !== null && isRetryable(error.value);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
      title={`„${doc.title}” eldobása`}
      body={
        <>
          {error ? <FormError error={error.value} context={{ action: 'discard-draft' }} /> : null}
          <p>
            Az eldobás végleges: a Piszkozat nem nyitható meg újra, és a felületen nem állítható
            vissza.
          </p>
          <p>Ha mások is szerkesztik, az ő szerkesztésük megszakad.</p>
          <p>A művelet naplózódik.</p>
        </>
      }
      confirmLabel={retryable ? 'Újrapróbálás' : 'Piszkozat eldobása'}
      pendingLabel="Eldobás…"
      {...(error && !retryable ? { cancelLabel: 'Bezár', confirmDisabled: true } : {})}
      onConfirm={async () => ((await discard()) ? undefined : false)}
      onCloseAutoFocus={(event) => {
        if (discarded.current) event.preventDefault();
        else onCloseAutoFocus?.(event);
      }}
    />
  );
}
