import { apiPath } from '../api/paths';
import type { SpaceRole } from '@taltos/shared';
import { useId, useState } from 'react';
import { useAction } from '../api/use-action';
import { useApi } from '../api/use-api';
import { useAuth } from '../auth/auth-context';
import { FormError } from '../components/FormError';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent } from '../components/ui/dialog';
import { RadioOption } from '../components/ui/form';
import { toast } from 'sonner';
import { ROLE_AS } from './labels';
import { useSpaces } from './space-context';

export type SelfAssignTarget = { id: string; name: string; returnFocusId?: string };

function SelfAssignBody({
  space,
  onClose,
  onDone,
}: {
  space: SelfAssignTarget;
  onClose: () => void;
  onDone?: () => void;
}) {
  const api = useApi();
  const { state } = useAuth();
  const spaces = useSpaces();
  const formId = useId();
  const [role, setRole] = useState<SpaceRole>('author');

  const assign = useAction(async () => {
    if (state.kind !== 'signed-in') return;
    await api.post(apiPath`/api/v1/spaces/${space.id}/members`, { userId: state.me.id, role });
    await spaces.refreshMembership();
    toast.success(
      `Felvetted magad a(z) „${space.name}” színtérbe ${ROLE_AS[role].toLowerCase()}. Mostantól látod a tartalmát.`,
    );
    onClose();
    onDone?.();
  });

  return (
    <DialogContent
      title={`Felvétel a(z) „${space.name}” színtérbe`}
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
            form={formId}
            disabled={assign.pending}
            aria-busy={assign.pending || undefined}
          >
            {assign.pending ? 'Felvétel…' : 'Felvétel'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void assign.run();
        }}
      >
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-text">Szerepkör</legend>
          <RadioOption
            name={`${formId}-role`}
            value="author"
            label="Szerző"
            checked={role === 'author'}
            onChange={() => setRole('author')}
          />
          <RadioOption
            name={`${formId}-role`}
            value="space_manager"
            label="Színtérgazda"
            checked={role === 'space_manager'}
            onChange={() => setRole('space_manager')}
          />
        </fieldset>
        <p className="text-sm text-muted">
          A felvétel naplózódik, a színtér tagjai nem kapnak róla értesítést.
        </p>
        {assign.failed ? (
          <FormError
            error={assign.error}
            context={{ action: 'self-assign' }}
            onRetry={() => void assign.run()}
          />
        ) : null}
      </form>
    </DialogContent>
  );
}

/** Önfelvétel (D56, spec 3.1.4): a Rendszeradmin a választott szerepben veszi fel magát. */
export function SelfAssignDialog({
  space,
  onClose,
  onDone,
}: {
  space: SelfAssignTarget | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  return (
    <Dialog open={space !== null} onOpenChange={(open) => !open && onClose()}>
      {space ? (
        <SelfAssignBody space={space} onClose={onClose} {...(onDone ? { onDone } : {})} />
      ) : null}
    </Dialog>
  );
}
