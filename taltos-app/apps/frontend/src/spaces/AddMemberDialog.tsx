import { apiPath } from '../api/paths';
import type { SpaceRole } from '@taltos/shared';
import { useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useAction } from '../api/use-action';
import { useApi } from '../api/use-api';
import { FormError } from '../components/FormError';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent } from '../components/ui/dialog';
import { RadioOption } from '../components/ui/form';
import { ROLE_AS } from './labels';
import { keepDialogOpenWhilePickerOpen } from './picker-utils';
import { UserPicker, type UserOption } from './UserPicker';
import { useUserSearch } from './use-user-search';

function AddMemberBody({
  spaceId,
  memberIds,
  onClose,
  onAdded,
}: {
  spaceId: string;
  memberIds: readonly string[];
  onClose: () => void;
  /** Sikeres felvétel után (a tagok újratöltéséhez); hibánál (pl. már tag) is hívódik `false`-szal. */
  onAdded: (outcome: 'added' | 'failed', user: UserOption | null) => void;
}) {
  const api = useApi();
  const search = useUserSearch();
  const formId = useId();
  const [user, setUser] = useState<UserOption | null>(null);
  const [role, setRole] = useState<SpaceRole>('author');
  const disabledIds = useMemo(() => new Set(memberIds), [memberIds]);

  const add = useAction(async () => {
    if (!user) return;
    await api.post(apiPath`/api/v1/spaces/${spaceId}/members`, { userId: user.id, role });
    toast.success(`${user.displayName} felvéve ${ROLE_AS[role].toLowerCase()}.`);
    onAdded('added', user);
    onClose();
  });

  async function submit() {
    const result = await add.run();
    // Hiba (pl. közben már tag lett): a tagok listája újratöltődik, a dialóg nyitva marad (spec 6.1).
    if (result && !result.ok) onAdded('failed', user);
  }

  return (
    <DialogContent
      title="Tag hozzáadása"
      onEscapeKeyDown={keepDialogOpenWhilePickerOpen}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Mégse
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={!user || add.pending}
            aria-busy={add.pending || undefined}
          >
            {add.pending ? 'Hozzáadás…' : 'Tag hozzáadása'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <UserPicker
          label="Kolléga"
          search={search}
          value={user}
          onChange={setUser}
          disabledIds={disabledIds}
          autoFocus
        />
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
        {add.failed ? (
          <FormError
            error={add.error}
            context={{ action: 'add-member' }}
            onRetry={() => void submit()}
          />
        ) : null}
      </form>
    </DialogContent>
  );
}

/** Tagfelvétel (spec 4.4): felhasználókereső + szerepkör; a „Már tag” sorok tiltottak (NK9 előellenőrzés). */
export function AddMemberDialog({
  open,
  onOpenChange,
  spaceId,
  memberIds,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId: string;
  memberIds: readonly string[];
  onAdded: (outcome: 'added' | 'failed', user: UserOption | null) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <AddMemberBody
          spaceId={spaceId}
          memberIds={memberIds}
          onClose={() => onOpenChange(false)}
          onAdded={onAdded}
        />
      ) : null}
    </Dialog>
  );
}
