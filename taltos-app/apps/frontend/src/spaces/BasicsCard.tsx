import type { SpaceColor, SpaceDetail, UpdateSpaceRequest } from '@taltos/shared';
import { useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAction } from '../api/use-action';
import { useApi } from '../api/use-api';
import { FormError } from '../components/FormError';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/display';
import { FieldError, FieldHint, Input, Label, Textarea } from '../components/ui/form';
import { TYPE_LABEL } from './labels';
import { DESCRIPTION_MAX, validateSpaceFields, type FieldErrors } from './validation';
import { SpaceColorPicker } from './SpaceColorPicker';
import type { SpaceCapabilities } from './capabilities';
import { useSpaces } from './space-context';

type Values = { name: string; description: string; color: string };

/** „Alapadatok” kártya (spec 4.2): egy űrlap, a PATCH csak a módosult mezőket küldi. */
export function BasicsCard({
  detail,
  caps,
  onSaved,
}: {
  detail: SpaceDetail;
  caps: SpaceCapabilities;
  onSaved: () => void;
}) {
  const api = useApi();
  const spaces = useSpaces();
  const ids = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  const serverValues: Values = {
    name: detail.name,
    description: detail.description,
    color: detail.color,
  };
  const signature = JSON.stringify(serverValues);
  const [values, setValues] = useState<Values>(serverValues);
  const [syncedSignature, setSyncedSignature] = useState(signature);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saved, setSaved] = useState(false);

  // Ha a szerver adata változik (mentés vagy újratöltés után), az űrlap az új értékhez igazodik.
  if (syncedSignature !== signature) {
    setSyncedSignature(signature);
    setValues(serverValues);
    setErrors({});
  }

  const editable = caps.editName || caps.editDescriptionAndColor;
  const nameChanged = caps.editName && values.name.trim() !== detail.name;
  const descriptionChanged =
    caps.editDescriptionAndColor && values.description !== detail.description;
  const colorChanged = caps.editDescriptionAndColor && values.color !== detail.color;
  const dirty = nameChanged || descriptionChanged || colorChanged;

  const save = useAction(async () => {
    const found = validateSpaceFields(
      values,
      spaces.summaries.filter((space) => space.id !== detail.id).map((space) => space.name),
      { name: nameChanged },
    );
    setErrors(found);
    if (found.name) {
      nameRef.current?.focus();
      return false;
    }
    if (found.description) {
      descriptionRef.current?.focus();
      return false;
    }
    // Csak a módosult mezők mennek (a Színtérgazda kérésébe nem kerülhet `name`, az `forbidden` lenne).
    const patch: UpdateSpaceRequest = {
      ...(nameChanged ? { name: values.name.trim() } : {}),
      ...(descriptionChanged ? { description: values.description } : {}),
      ...(colorChanged ? { color: values.color as SpaceColor } : {}),
    };
    await api.patch(`/api/v1/spaces/${detail.id}`, patch);
    setSaved(true);
    toast.success('A beállítások mentve.');
    spaces.reload();
    if (nameChanged) await spaces.refreshMembership();
    onSaved();
    return true;
  });

  function change(next: Partial<Values>) {
    setValues((current) => ({ ...current, ...next }));
    setSaved(false);
    save.reset();
  }

  async function submit() {
    const result = await save.run();
    if (result && !result.ok) {
      const code = (result.error as { code?: string }).code;
      // Közben lezárult vagy megváltozott a jogosultság: az adatok újratöltődnek, a nézet frissül.
      if (code === 'space_closed' || code === 'forbidden') onSaved();
      if (code === 'forbidden') void spaces.refreshMembership();
    }
  }

  const nameId = `${ids}-name`;
  const descriptionId = `${ids}-description`;
  return (
    <Card className="lg:max-w-(--read-width)">
      <form
        aria-labelledby={`${ids}-title`}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="space-y-5"
        noValidate
      >
        <h2 id={`${ids}-title`} className="text-xl font-semibold text-text">
          Alapadatok
        </h2>

        <div>
          {caps.editName ? (
            <>
              <Label htmlFor={nameId}>Név</Label>
              <Input
                id={nameId}
                ref={nameRef}
                className="mt-2"
                value={values.name}
                onChange={(event) => change({ name: event.target.value })}
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={errors.name ? `${nameId}-error` : undefined}
              />
              {errors.name ? <FieldError id={`${nameId}-error`}>{errors.name}</FieldError> : null}
            </>
          ) : (
            <>
              <span className="block text-sm font-semibold text-text">Név</span>
              <p className="mt-2 break-words text-text">{detail.name}</p>
            </>
          )}
        </div>

        <div>
          <span className="block text-sm font-semibold text-text">Típus</span>
          <p className="mt-2 text-text">{TYPE_LABEL[detail.type]}</p>
          <FieldHint>A típus létrehozás után nem módosítható.</FieldHint>
        </div>

        <div>
          {caps.editDescriptionAndColor ? (
            <>
              <Label htmlFor={descriptionId}>Leírás</Label>
              <Textarea
                id={descriptionId}
                ref={descriptionRef}
                className="mt-2"
                value={values.description}
                onChange={(event) => change({ description: event.target.value })}
                aria-invalid={errors.description ? true : undefined}
                aria-describedby={`${descriptionId}-count${errors.description ? ` ${descriptionId}-error` : ''}`}
              />
              <p id={`${descriptionId}-count`} className="mt-1 text-xs text-subtle">
                {values.description.length} / {DESCRIPTION_MAX}
              </p>
              {errors.description ? (
                <FieldError id={`${descriptionId}-error`}>{errors.description}</FieldError>
              ) : null}
            </>
          ) : (
            <>
              <span className="block text-sm font-semibold text-text">Leírás</span>
              {detail.description.trim() ? (
                // Szövegként jelenik meg (nem HTML): a felhasználó által megadott tartalom.
                <p className="mt-2 break-words whitespace-pre-line text-text">
                  {detail.description}
                </p>
              ) : (
                <p className="mt-2 text-subtle">Nincs leírás.</p>
              )}
            </>
          )}
        </div>

        <SpaceColorPicker
          value={values.color}
          onChange={(color) => change({ color })}
          readOnly={!caps.editDescriptionAndColor}
        />

        {save.failed ? (
          <FormError
            error={save.error}
            context={{ action: 'update-space' }}
            onRetry={() => void submit()}
          />
        ) : null}

        {editable ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={!dirty || save.pending}
              aria-busy={save.pending || undefined}
            >
              {save.pending ? 'Mentés…' : 'Mentés'}
            </Button>
            <Button
              variant="ghost"
              disabled={!dirty || save.pending}
              onClick={() => {
                setValues(serverValues);
                setErrors({});
                save.reset();
              }}
            >
              Változtatások elvetése
            </Button>
            {dirty ? <span className="text-sm text-muted">Nem mentett módosítások.</span> : null}
            {saved && !dirty ? (
              <span role="status" className="text-sm text-success">
                ✓ Mentve.
              </span>
            ) : null}
          </div>
        ) : null}
      </form>
    </Card>
  );
}
