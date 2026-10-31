import { SPACE_COLOR_PALETTE, type SpaceColor, type SpaceDetail } from '@taltos/shared';
import { useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAction } from '../api/use-action';
import { useApi } from '../api/use-api';
import { FormError } from '../components/FormError';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent } from '../components/ui/dialog';
import { FieldError, FieldHint, Input, Label, RadioOption, Textarea } from '../components/ui/form';
import { keepDialogOpenWhilePickerOpen } from './picker-utils';
import { SpaceColorPicker } from './SpaceColorPicker';
import { useSpaces } from './space-context';
import { UserPicker, type UserOption } from './UserPicker';
import { useUserSearch } from './use-user-search';
import { DESCRIPTION_MAX, validateSpaceFields } from './validation';

type Errors = Partial<Record<'name' | 'description' | 'type' | 'manager', string>>;

function NewSpaceBody({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string | undefined) => void;
}) {
  const api = useApi();
  const spaces = useSpaces();
  const search = useUserSearch();
  const ids = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const typeRef = useRef<HTMLFieldSetElement>(null);
  const managerRef = useRef<HTMLDivElement>(null);

  const firstFree = useMemo(
    () =>
      SPACE_COLOR_PALETTE.find(
        (color) =>
          !spaces.summaries.some((space) => space.color.toLowerCase() === color.toLowerCase()),
      ) ?? SPACE_COLOR_PALETTE[0],
    [spaces.summaries],
  );
  const [name, setName] = useState('');
  const [type, setType] = useState<'team' | 'project' | ''>('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState<SpaceColor>(firstFree);
  const [manager, setManager] = useState<UserOption | null>(null);
  const [errors, setErrors] = useState<Errors>({});

  const create = useAction(async () => {
    const found: Errors = validateSpaceFields(
      { name, description },
      spaces.summaries.map((space) => space.name),
      { name: true },
    );
    if (type === '') found.type = 'Válaszd ki a színtér típusát.';
    if (!manager) found.manager = 'Válaszd ki a kezdeti Színtérgazdát.';
    setErrors(found);
    if (found.name) return nameRef.current?.focus();
    if (found.type) return typeRef.current?.querySelector('input')?.focus();
    if (found.description) return descriptionRef.current?.focus();
    if (found.manager || !manager || type === '') {
      return managerRef.current?.querySelector('input')?.focus();
    }
    const created = await api.post<SpaceDetail | undefined>('/api/v1/spaces', {
      name: name.trim(),
      type,
      description,
      color,
      initialManagerId: manager.id,
    });
    toast.success(
      `A(z) „${name.trim()}” színtér létrejött. Kezdeti Színtérgazda: ${manager.displayName}.`,
    );
    onCreated(created?.id);
    onClose();
  });

  const nameId = `${ids}-name`;
  const descriptionId = `${ids}-description`;
  return (
    <DialogContent
      title="Új színtér"
      onEscapeKeyDown={keepDialogOpenWhilePickerOpen}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Mégse
          </Button>
          <Button
            type="submit"
            form={`${ids}-form`}
            disabled={create.pending}
            aria-busy={create.pending || undefined}
          >
            {create.pending ? 'Létrehozás…' : 'Színtér létrehozása'}
          </Button>
        </>
      }
    >
      <form
        id={`${ids}-form`}
        noValidate
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void create.run();
        }}
      >
        <div>
          <Label htmlFor={nameId}>Név</Label>
          <Input
            id={nameId}
            ref={nameRef}
            className="mt-2"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? `${nameId}-error` : undefined}
          />
          {errors.name ? <FieldError id={`${nameId}-error`}>{errors.name}</FieldError> : null}
        </div>

        <fieldset ref={typeRef} className="space-y-2">
          <legend className="text-sm font-semibold text-text">Típus</legend>
          <RadioOption
            name={`${ids}-type`}
            value="team"
            label="Csapat-munkatér"
            hint="Tartós, a csapat közös tere."
            checked={type === 'team'}
            onChange={() => setType('team')}
          />
          <RadioOption
            name={`${ids}-type`}
            value="project"
            label="Projekt-tér"
            hint="Időben korlátos, később lezárható."
            checked={type === 'project'}
            onChange={() => setType('project')}
          />
          <FieldHint>A típus később nem módosítható.</FieldHint>
          {errors.type ? <FieldError id={`${ids}-type-error`}>{errors.type}</FieldError> : null}
        </fieldset>

        <div>
          <Label htmlFor={descriptionId}>Leírás</Label>
          <Textarea
            id={descriptionId}
            ref={descriptionRef}
            className="mt-2"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            aria-invalid={errors.description ? true : undefined}
            aria-describedby={`${descriptionId}-count`}
          />
          <p id={`${descriptionId}-count`} className="mt-1 text-xs text-subtle">
            {description.length} / {DESCRIPTION_MAX}
          </p>
          {errors.description ? (
            <FieldError id={`${descriptionId}-error`}>{errors.description}</FieldError>
          ) : null}
        </div>

        <SpaceColorPicker value={color} onChange={setColor} />

        <div ref={managerRef}>
          <UserPicker
            label="Kezdeti Színtérgazda"
            search={search}
            value={manager}
            onChange={setManager}
            invalid={Boolean(errors.manager)}
            {...(errors.manager ? { describedBy: `${ids}-manager-error` } : {})}
          />
          <FieldHint>Ő veheti fel a többi tagot. Később más is Színtérgazda lehet.</FieldHint>
          {errors.manager ? (
            <FieldError id={`${ids}-manager-error`}>{errors.manager}</FieldError>
          ) : null}
        </div>

        {create.failed ? (
          <FormError
            error={create.error}
            context={{ action: 'create-space' }}
            onRetry={() => void create.run()}
          />
        ) : null}
      </form>
    </DialogContent>
  );
}

/** Új színtér (spec 3.1.1). A dialógus bezáráskor kiürül (a tartalom csak nyitva él). */
export function NewSpaceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string | undefined, initialManagerId: string | null) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <NewSpaceBody onClose={() => onOpenChange(false)} onCreated={(id) => onCreated(id, null)} />
      ) : null}
    </Dialog>
  );
}
