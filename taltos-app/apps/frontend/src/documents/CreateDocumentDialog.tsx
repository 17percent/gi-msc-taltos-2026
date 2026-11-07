import type {
  CreateDocumentRequest,
  DocumentDetail,
  KindRef,
  TagListResponse,
  TagRef,
} from '@taltos/shared';
import { DOCUMENT_TITLE_MAX } from '@taltos/shared';
import { Copy, Lock, TriangleAlert } from 'lucide-react';
import { useId, useMemo, useRef, useState, type FocusEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { isApiError } from '../api/client';
import { type ErrorContext } from '../api/errors';
import { useAction } from '../api/use-action';
import { useApi } from '../api/use-api';
import { useResource } from '../api/use-resource';
import { useAuth } from '../auth/auth-context';
import { FormError } from '../components/FormError';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent } from '../components/ui/dialog';
import { Alert, Skeleton, SpaceDot } from '../components/ui/display';
import { FieldError, FieldHint, Input, Label } from '../components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { keepDialogOpenWhilePickerOpen } from '../spaces/picker-utils';
import { useSpaces, type SwitcherSpace } from '../spaces/space-context';
import { creatableSpaces } from './capabilities';
import { TagPicker, type TagCatalog } from './TagPicker';
import { COPY_SUFFIX, charCount, validateTitle } from './validation';

export type CreateMode = 'blank' | 'duplicate';

type Errors = Partial<Record<'space' | 'title' | 'kind', string>>;

function SpaceChoice({ space }: { space: SwitcherSpace }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <SpaceDot color={space.color} />
      <span className="min-w-0 truncate">{space.name}</span>
      {space.closed ? (
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
          <Lock aria-hidden="true" className="size-3" />
          Lezárt
        </span>
      ) : null}
    </span>
  );
}

/** Duplikálás kezdőértékei (D58): a legutóbbi Jóváhagyott revízió metaadata; ha nincs, az élő állapot. */
function initialValues(mode: CreateMode, source: DocumentDetail | undefined) {
  if (mode === 'blank' || !source) return { title: '', kind: '', tags: [] as TagRef[] };
  const meta = source.approvedMetadata;
  return {
    title: `${meta?.title ?? source.title}${COPY_SUFFIX}`,
    kind: meta?.kind ?? source.kind,
    tags: meta?.tags ?? source.tags,
  };
}

function SourceNotice({ source }: { source: DocumentDetail }) {
  const meta = source.approvedMetadata;
  return (
    <Alert tone="info" icon={Copy}>
      <p>
        {meta ? (
          <>
            A másolat a(z) „{source.title}” legutóbbi <strong>Jóváhagyott</strong> változatából (v
            {source.iteration}) készül; a cím, a fajta és a címkék is onnan származnak. A Jóváhagyás
            óta tett, még nem jóváhagyott módosítások nem kerülnek bele.
          </>
        ) : (
          <>
            A(z) „{source.title}” még nem volt Jóváhagyott, ezért a másolat az{' '}
            <strong>aktuális, Piszkozat</strong> állapotából készül.
          </>
        )}
      </p>
      <p className="mt-2 text-muted">
        A másolat új Piszkozat: te leszel a tulajdonosa, és a célszínterében két review-er hagyja
        jóvá.
      </p>
    </Alert>
  );
}

function CreateBody({
  mode,
  source,
  onClose,
  onBusyChange,
  onCloseAutoFocus,
}: {
  mode: CreateMode;
  source: DocumentDetail | undefined;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  onCloseAutoFocus: ((event: Event) => void) | undefined;
}) {
  const api = useApi();
  const navigate = useNavigate();
  const { state, refreshMe } = useAuth();
  const spaces = useSpaces();
  const ids = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const kindRef = useRef<HTMLButtonElement>(null);
  const closedAfterCreate = useRef(false);
  const spaceRef = useRef<HTMLButtonElement>(null);
  const initial = useMemo(() => initialValues(mode, source), [mode, source]);
  const isAdmin = state.kind === 'signed-in' && state.me.systemRole === 'system_admin';

  const kinds = useResource('kinds', (client, signal) =>
    client.get<KindRef[]>('/api/v1/kinds', signal),
  );
  const tagList = useResource('tags', (client, signal) =>
    client.get<TagListResponse>('/api/v1/tags', signal),
  );
  const { reload: reloadKinds } = kinds;
  const { reload: reloadTags } = tagList;
  const catalog: TagCatalog = {
    status: tagList.status,
    tags: tagList.data?.tags ?? [],
    reload: reloadTags,
  };

  const selectable = useMemo(() => creatableSpaces(spaces.memberSpaces), [spaces.memberSpaces]);
  const current = spaces.memberSpaces.find((space) => space.id === spaces.currentSpaceId) ?? null;
  const defaultSpace = current && !current.closed ? current.id : (selectable[0]?.id ?? '');
  const [spaceChoice, setSpaceChoice] = useState<string | null>(null);
  // Ha a választott tér közben lezárult vagy megszűnt (frissített lista), az első választható lép a helyére.
  const spaceId =
    spaceChoice !== null && selectable.some((space) => space.id === spaceChoice)
      ? spaceChoice
      : defaultSpace;
  const [title, setTitle] = useState(initial.title);
  const [titleTouched, setTitleTouched] = useState(false);
  const [kindChoice, setKindChoice] = useState<string | null>(null);
  const [tags, setTags] = useState<TagRef[]>(initial.tags);
  const [errors, setErrors] = useState<Errors>({});
  // A hibaüzenet a küldéskor választott térről szól: a frissített lista közben másik teret léptethet a helyére.
  const [failedSpaceName, setFailedSpaceName] = useState<string | undefined>(undefined);

  const kindList = kinds.data;
  const initialKindAvailable =
    initial.kind !== '' && (kindList?.some((kind) => kind.key === initial.kind) ?? false);
  const kind = kindChoice ?? (initialKindAvailable ? initial.kind : '');
  const kindGone =
    mode === 'duplicate' && kindChoice === null && kindList !== undefined && !initialKindAvailable;
  const kindsEmpty = kindList !== undefined && kindList.length === 0;
  const selectedSpace = selectable.find((space) => space.id === spaceId);
  const spacesReady = spaces.status === 'ready';

  const action: ErrorContext['action'] =
    mode === 'duplicate' ? 'duplicate-document' : 'create-document';
  const create = useAction(async () => {
    const found: Errors = {};
    if (!selectedSpace) found.space = 'Válassz színteret.';
    const titleError = validateTitle(title);
    if (titleError) found.title = titleError;
    if (kind === '') found.kind = 'Válassz fajtát.';
    setErrors(found);
    setTitleTouched(true);
    if (found.space) return void spaceRef.current?.focus();
    if (found.title) return void titleRef.current?.focus();
    if (found.kind) return void kindRef.current?.focus();
    const body: CreateDocumentRequest = {
      spaceId,
      title: title.trim(),
      kind,
      tagIds: tags.map((tag) => tag.id),
      ...(mode === 'duplicate' && source ? { sourceDocumentId: source.id } : {}),
    };
    const created = await api.post<DocumentDetail>('/api/v1/documents', body);
    toast.success(
      mode === 'duplicate'
        ? `A másolat létrejött Piszkozatként: „${created.title}”.`
        : `Piszkozat létrehozva: „${created.title}”.`,
    );
    return created;
  });

  async function submit() {
    onBusyChange(true);
    const outcome = await create.run();
    // `undefined`: a küldés már fut (a második hívást elutasítottuk); a zárat az első hívás oldja fel.
    if (outcome === undefined) return;
    try {
      if (outcome.ok && outcome.value) {
        closedAfterCreate.current = true;
        onClose();
        void navigate(`/documents/${outcome.value.id}`);
      } else if (!outcome.ok) {
        setFailedSpaceName(selectedSpace?.name);
        recover(outcome.error);
      }
    } finally {
      onBusyChange(false);
    }
  }

  /** A hibakódhoz tartozó felépülés (spec 6.): a lista frissül, a mezők megmaradnak. */
  function recover(error: unknown) {
    if (!isApiError(error)) return;
    if (error.code === 'validation_error') {
      reloadKinds();
      reloadTags();
      titleRef.current?.focus();
    } else if (
      error.code === 'not_space_member' ||
      error.code === 'space_closed' ||
      (error.code === 'not_found' && mode === 'blank')
    ) {
      void spaces.refreshMembership();
    } else if (error.code === 'forbidden') {
      void refreshMe();
    }
  }

  const titleId = `${ids}-title`;
  const kindId = `${ids}-kind`;
  const spaceLabelId = `${ids}-space`;
  const blocked = kindsEmpty || kinds.status === 'error' || !selectedSpace;
  const loading = kinds.status === 'loading' || !spacesReady;

  const context: ErrorContext = {
    action,
    ...(create.failed && failedSpaceName
      ? { spaceName: failedSpaceName }
      : selectedSpace
        ? { spaceName: selectedSpace.name }
        : {}),
  };

  const spaceField = !spacesReady ? (
    <Skeleton className="h-10 w-full rounded-md" />
  ) : selectable.length === 0 ? (
    <Alert tone="warning" icon={TriangleAlert}>
      <p>Jelenleg nincs olyan színtered, ahol dokumentumot hozhatsz létre.</p>
    </Alert>
  ) : selectable.length === 1 ? (
    <p className="mt-2 flex items-center gap-2 text-sm text-text">
      <SpaceDot color={selectable[0]?.color} />
      <span className="min-w-0 break-words">{selectable[0]?.name}</span>
    </p>
  ) : (
    <Select value={spaceId} onValueChange={setSpaceChoice}>
      <SelectTrigger ref={spaceRef} aria-labelledby={spaceLabelId} className="mt-2">
        <SelectValue placeholder="Válassz színteret" />
      </SelectTrigger>
      <SelectContent className="z-(--z-modal)">
        {spaces.memberSpaces.map((space) => (
          <SelectItem key={space.id} value={space.id} disabled={space.closed}>
            <SpaceChoice space={space} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <DialogContent
      title={mode === 'duplicate' ? 'Dokumentum duplikálása' : 'Új dokumentum'}
      onEscapeKeyDown={(event) => {
        if (create.pending) event.preventDefault();
        else keepDialogOpenWhilePickerOpen(event);
      }}
      // Véletlen érintés ne zárja be (mobil); a zárás az Esc, a „Mégse” és a „Bezárás” gomb.
      onInteractOutside={(event) => event.preventDefault()}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        titleRef.current?.focus();
        if (mode === 'duplicate') titleRef.current?.select();
      }}
      onCloseAutoFocus={(event) => {
        if (closedAfterCreate.current) event.preventDefault();
        else onCloseAutoFocus?.(event);
      }}
      footer={
        <>
          <Button variant="outline" disabled={create.pending} onClick={onClose}>
            Mégse
          </Button>
          <Button
            type="submit"
            form={`${ids}-form`}
            disabled={create.pending || loading || blocked}
            aria-busy={create.pending || undefined}
          >
            {create.pending
              ? 'Létrehozás…'
              : mode === 'duplicate'
                ? 'Másolat létrehozása'
                : 'Dokumentum létrehozása'}
          </Button>
        </>
      }
    >
      <form
        id={`${ids}-form`}
        noValidate
        className="space-y-5"
        aria-busy={loading || undefined}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {mode === 'duplicate' && source ? (
          <SourceNotice source={source} />
        ) : (
          <p className="text-sm text-muted">
            Üres Piszkozatként jön létre, te leszel a tulajdonosa.
          </p>
        )}

        <div>
          <Label id={spaceLabelId}>Színtér</Label>
          {spaceField}
          {current?.closed && spacesReady ? (
            <p className="mt-1 flex items-start gap-2 text-sm text-muted">
              <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>A(z) „{current.name}” lezárt, ezért itt nem hozható létre dokumentum.</span>
            </p>
          ) : null}
          {errors.space ? <FieldError id={`${ids}-space-error`}>{errors.space}</FieldError> : null}
        </div>

        <div>
          <Label htmlFor={titleId}>Cím</Label>
          <Input
            id={titleId}
            ref={titleRef}
            className="mt-2"
            autoComplete="off"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              if (titleTouched) {
                const next = validateTitle(event.target.value);
                setErrors((previous) => ({
                  ...previous,
                  ...(next ? { title: next } : { title: undefined }),
                }));
              }
            }}
            onBlur={(event: FocusEvent<HTMLInputElement>) => {
              setTitleTouched(true);
              if (event.target.value === '' && !errors.title) return;
              const next = validateTitle(event.target.value);
              setErrors((previous) => ({ ...previous, title: next }));
            }}
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={`${titleId}-count${errors.title ? ` ${titleId}-error` : ''}`}
          />
          <p id={`${titleId}-count`} className="mt-1 text-xs text-subtle">
            {charCount(title)} / {DOCUMENT_TITLE_MAX}
          </p>
          {errors.title ? <FieldError id={`${titleId}-error`}>{errors.title}</FieldError> : null}
        </div>

        <div aria-busy={kinds.status === 'loading' || undefined}>
          <Label id={`${kindId}-label`}>Fajta</Label>
          {kinds.status === 'loading' ? (
            <Skeleton className="mt-2 h-10 w-full rounded-md" />
          ) : kinds.status === 'error' ? (
            <Alert tone="danger" className="mt-2">
              <p>A fajták listája nem töltődött be.</p>
              <Button variant="ghost" size="sm" className="mt-2" onClick={reloadKinds}>
                Újrapróbálás
              </Button>
            </Alert>
          ) : kindsEmpty ? (
            <Alert tone="warning" icon={TriangleAlert} className="mt-2">
              <p>Még nincs felvéve egyetlen fajta sem, ezért nem hozható létre dokumentum.</p>
              <p className="mt-2">
                {isAdmin ? (
                  <Link
                    to="/admin/kinds"
                    className="font-semibold text-secondary underline"
                    onClick={onClose}
                  >
                    Fajta felvétele az Adminisztrációban
                  </Link>
                ) : (
                  'Kérd meg a Rendszeradminisztrátort, hogy vegyen fel fajtákat.'
                )}
              </p>
            </Alert>
          ) : (
            <Select value={kind} onValueChange={setKindChoice}>
              <SelectTrigger
                id={kindId}
                ref={kindRef}
                aria-labelledby={`${kindId}-label`}
                aria-invalid={errors.kind ? true : undefined}
                aria-describedby={`${kindId}-hint${errors.kind ? ` ${kindId}-error` : ''}`}
                className="mt-2"
              >
                <SelectValue placeholder="Válassz fajtát" />
              </SelectTrigger>
              <SelectContent className="z-(--z-modal)">
                {(kindList ?? []).map((item) => (
                  <SelectItem key={item.key} value={item.key}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {kindGone ? (
            <p className="mt-1 text-sm text-muted">
              A forrás fajtája már nem választható. Válassz másikat.
            </p>
          ) : null}
          <FieldHint id={`${kindId}-hint`}>
            A fajta azt mondja meg, mi ez a dokumentum; a címkék a témáját.
          </FieldHint>
          {errors.kind ? <FieldError id={`${kindId}-error`}>{errors.kind}</FieldError> : null}
        </div>

        <TagPicker value={tags} onChange={setTags} catalog={catalog} />

        {create.failed ? (
          <FormError error={create.error} context={context} onRetry={() => void submit()} />
        ) : null}
      </form>
    </DialogContent>
  );
}

/**
 * Új dokumentum / duplikálás (spec 2.): egy komponens, két mód. A tartalom csak nyitva él (a mezők
 * minden megnyitáskor újra kezdődnek). Kívülre kattintás nem zár; beküldés közben az Esc és a „Mégse” tiltott.
 */
export function CreateDocumentDialog({
  open,
  onOpenChange,
  mode,
  source,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: CreateMode;
  /** Duplikálásnál a másolandó dokumentum (a fejléc már betöltötte). */
  source?: DocumentDetail;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      {open ? (
        <CreateBody
          mode={mode}
          source={source}
          onClose={() => onOpenChange(false)}
          onBusyChange={setBusy}
          onCloseAutoFocus={onCloseAutoFocus}
        />
      ) : null}
    </Dialog>
  );
}
