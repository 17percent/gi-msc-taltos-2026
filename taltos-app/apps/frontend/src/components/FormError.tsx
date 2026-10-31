import { isRetryable, messageFor, type ErrorContext } from '../api/errors';
import { Button } from './ui/button';
import { Alert } from './ui/display';

/**
 * Műveleti hiba (spec 2.5): a dialógban / az oldal tetején marad, `role="alert"`; a beírt adat megmarad.
 * Újrapróbálható hibánál (szerver, hálózat, csrf) „Újrapróbálás” gomb.
 */
export function FormError({
  error,
  context,
  onRetry,
}: {
  error: unknown;
  context: ErrorContext;
  onRetry?: () => void;
}) {
  return (
    <Alert tone="danger">
      <p>{messageFor(error, context)}</p>
      {onRetry && isRetryable(error) ? (
        <Button variant="ghost" size="sm" className="mt-2" onClick={onRetry}>
          Újrapróbálás
        </Button>
      ) : null}
    </Alert>
  );
}
