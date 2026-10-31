import { apiPath } from '../api/paths';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { useAction } from '../api/use-action';
import { useApi } from '../api/use-api';
import { FormError } from '../components/FormError';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent } from '../components/ui/dialog';
import { FieldError, Input, Label } from '../components/ui/form';
import { useSpaces } from './space-context';
import { validateSpaceFields } from './validation';

export type RenameTarget = { id: string; name: string; returnFocusId?: string };

function RenameBody({ space, onClose }: { space: RenameTarget; onClose: () => void }) {
  const api = useApi();
  const spaces = useSpaces();
  const ids = useId();
  const [name, setName] = useState(space.name);
  const [error, setError] = useState<string | null>(null);

  const rename = useAction(async () => {
    const found = validateSpaceFields(
      { name, description: '' },
      spaces.summaries.filter((other) => other.id !== space.id).map((other) => other.name),
      { name: true },
    );
    setError(found.name ?? null);
    if (found.name) return;
    await api.patch(apiPath`/api/v1/spaces/${space.id}`, { name: name.trim() });
    toast.success(`Átnevezve: „${name.trim()}”.`);
    await spaces.refreshMembership();
    onClose();
  });

  return (
    <DialogContent
      title="Színtér átnevezése"
      onCloseAutoFocus={(event) => {
        if (space.returnFocusId) {
          event.preventDefault();
          document.getElementById(space.returnFocusId)?.focus();
        }
      }}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Mégse
          </Button>
          <Button
            type="submit"
            form={`${ids}-form`}
            disabled={rename.pending}
            aria-busy={rename.pending || undefined}
          >
            {rename.pending ? 'Átnevezés…' : 'Átnevezés'}
          </Button>
        </>
      }
    >
      <form
        id={`${ids}-form`}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void rename.run();
        }}
        className="space-y-4"
      >
        <div>
          <Label htmlFor={`${ids}-name`}>Név</Label>
          <Input
            id={`${ids}-name`}
            className="mt-2"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${ids}-error` : undefined}
          />
          {error ? <FieldError id={`${ids}-error`}>{error}</FieldError> : null}
        </div>
        {rename.failed ? (
          <FormError
            error={rename.error}
            context={{ action: 'rename-space' }}
            onRetry={() => void rename.run()}
          />
        ) : null}
      </form>
    </DialogContent>
  );
}

/** Átnevezés (spec 3.1.2): egyetlen mező; a típus nem szerkeszthető. */
export function RenameDialog({
  space,
  onClose,
}: {
  space: RenameTarget | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={space !== null} onOpenChange={(open) => !open && onClose()}>
      {space ? <RenameBody space={space} onClose={onClose} /> : null}
    </Dialog>
  );
}
