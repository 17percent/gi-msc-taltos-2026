import {
  normalizeTagName,
  type TagRef,
  type TagSearchResponse,
  type TagWithCount,
} from '@taltos/shared';
import { CircleAlert, Plus, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { apiPath } from '../api/paths';
import { isRetryable, messageFor } from '../api/errors';
import { useAction } from '../api/use-action';
import { useApi } from '../api/use-api';
import { Button } from '../components/ui/button';
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '../components/ui/command';
import { FieldError, Label } from '../components/ui/form';
import { PICKER_OPEN_ATTR } from '../spaces/picker-utils';
import { checkTagText } from './validation';

export const TAG_LIMIT = 50;
const EMPTY_LIST_ROWS = 8;
const LOCAL_ROWS = 5;
const NEW_VALUE = 'new';

/** A meglévő címkék listája (`GET /tags`); a darabszám csak rendezésre kell, nem jelenik meg (D58). */
export type TagCatalog = {
  status: 'loading' | 'error' | 'ready';
  tags: readonly TagWithCount[];
  reload: () => void;
};

type SearchResult =
  | { text: string; attempt: number; data: TagSearchResponse; error?: undefined }
  | { text: string; attempt: number; data?: undefined; error: unknown };

type Notice = { kind: 'replace' | 'duplicate' | 'choose'; text: string };

/**
 * Címkeválasztó (spec 3.): shadcn Command (`cmdk`, `shouldFilter={false}`), a lista a mező alatt, a folyamban.
 * A normalizált pontos egyezés automatikus csere (nem lesz új címke), legfeljebb 3 javaslat, új címke csak tudatos
 * választásra és a `?q=` keresés lezárulta után. A `POST /tags` a kiválasztáskor azonnal lefut (NK7); a chip a
 * szerver által visszaadott nevet mutatja, a felület nem állítja, hogy új címke született (D58).
 */
export function TagPicker({
  value,
  onChange,
  catalog,
  describedBy,
  debounceMs = 250,
}: {
  value: readonly TagRef[];
  onChange: (tags: TagRef[]) => void;
  catalog: TagCatalog;
  describedBy?: string;
  debounceMs?: number;
}) {
  const api = useApi();
  const inputId = useId();
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [announce, setAnnounce] = useState('');

  const check = checkTagText(query);
  const text = check.ok ? check.name : '';
  const normalized = text === '' ? '' : normalizeTagName(text);
  const searchable = normalized !== '';
  const invalidMessage = !check.ok
    ? check.empty
      ? null
      : check.message
    : searchable
      ? null
      : 'Adj meg legalább egy látható karaktert.';
  const atLimit = value.length >= TAG_LIMIT;

  // A cmdk 1.1.1 az `aria-activedescendant`-et csak az érték (kijelölés) váltásakor számolja, és a sorok
  // újrarajzolásakor elavult (vagy hiányzó) azonosítót hagyhat. A kijelölt sorra a DOM `aria-selected`
  // jelzése a megbízható forrás, ezért az attribútumot ahhoz igazítjuk (a cmdk a saját propját a
  // komponens-spread után írja, így prop-ként nem felülírható).
  useEffect(() => {
    const input = inputRef.current;
    const root = input?.closest('[cmdk-root]');
    if (!input || !root) return;
    const sync = () => {
      const selected = root.querySelector('[cmdk-item][aria-selected="true"]')?.id ?? '';
      if ((input.getAttribute('aria-activedescendant') ?? '') === selected) return;
      if (selected) input.setAttribute('aria-activedescendant', selected);
      else input.removeAttribute('aria-activedescendant');
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-selected', 'aria-activedescendant'],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!searchable) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .get<TagSearchResponse>(apiPath`/api/v1/tags?q=${text}`, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) setResult({ text, attempt, data });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setResult({ text, attempt, error });
        });
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [api, searchable, text, attempt, debounceMs]);

  const current =
    searchable && result && result.text === text && result.attempt === attempt ? result : null;
  const searchOk = current !== null && current.error === undefined;

  const selectedIds = useMemo(() => new Set(value.map((tag) => tag.id)), [value]);
  const ranked = useMemo(
    () => [...catalog.tags].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'hu')),
    [catalog.tags],
  );

  const exact: TagRef | null =
    current?.data?.exact ??
    (searchable ? (ranked.find((tag) => normalizeTagName(tag.name) === normalized) ?? null) : null);
  const exactSelected = exact !== null && selectedIds.has(exact.id);
  const similar = (current?.data?.similar ?? [])
    .filter((tag) => tag.id !== exact?.id && !selectedIds.has(tag.id))
    .slice(0, 3);

  const existing: TagRef[] = useMemo(() => {
    if (!searchable) {
      return ranked.filter((tag) => !selectedIds.has(tag.id)).slice(0, EMPTY_LIST_ROWS);
    }
    const similarIds = new Set((current?.data?.similar ?? []).map((tag) => tag.id));
    const local = ranked
      .filter((tag) => {
        if (selectedIds.has(tag.id) || tag.id === exact?.id || similarIds.has(tag.id)) return false;
        return normalizeTagName(tag.name).includes(normalized);
      })
      .sort(
        (a, b) =>
          Number(normalizeTagName(b.name).startsWith(normalized)) -
          Number(normalizeTagName(a.name).startsWith(normalized)),
      )
      .slice(0, LOCAL_ROWS);
    return exact && !exactSelected ? [exact, ...local] : local;
  }, [searchable, ranked, selectedIds, current, exact, exactSelected, normalized]);

  const newRowVisible = searchable && exact === null && invalidMessage === null;
  const newRowState: 'ready' | 'checking' | 'failed' = searchOk
    ? 'ready'
    : current === null
      ? 'checking'
      : 'failed';
  const hasMatches = existing.length + similar.length > 0;
  const createTag = useAction(async (name: string) => api.post<TagRef>('/api/v1/tags', { name }));

  // A cmdk az első érvényes sort jelöli ki magától. Az elrendezés ezt használja: a pontos egyezés és az
  // egyetlen „Új címke” sor elöl áll (előkiemelt); ha javaslatok vannak, egy rejtett, kiválasztható
  // „helyfoglaló” sor áll elöl, így látható sor nincs kiemelve, és az Enter csak a státuszsort írja ki.
  const exactDefault = exact !== null && !exactSelected;
  const needsPlaceholder = hasMatches && !exactDefault;
  const listOpen = open && !atLimit;

  function add(tag: TagRef, typed?: string) {
    if (selectedIds.has(tag.id)) {
      setNotice({ kind: 'duplicate', text: 'Ez a címke már hozzá van adva.' });
    } else {
      const next = [...value, tag];
      onChange(next);
      setAnnounce(`„${tag.name}” hozzáadva. ${next.length} címke kiválasztva.`);
      setNotice(
        typed !== undefined && typed !== tag.name
          ? {
              kind: 'replace',
              text: `„${typed}” helyett a meglévő „${tag.name}” címkét adtuk hozzá.`,
            }
          : null,
      );
    }
    setQuery('');
    setOpen(false);
  }

  async function addNew() {
    const typed = text;
    const outcome = await createTag.run(typed);
    if (outcome?.ok) add(outcome.value, typed);
  }

  function remove(tag: TagRef) {
    const next = value.filter((item) => item.id !== tag.id);
    onChange(next);
    setAnnounce(`„${tag.name}” törölve. ${next.length} címke kiválasztva.`);
    setNotice(null);
    inputRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && listOpen) {
      // Az első Esc a listát zárja; a második a dialógot (a dialóg a data-attribútumból tudja).
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === 'ArrowDown' && !listOpen && !atLimit) {
      {
        setAnnounce('');
        setOpen(true);
      }
    } else if (event.key === 'Enter') {
      // Űrlapon belül az Enter ne küldje be a dialógust (a cmdk a kijelölt sort választja).
      event.preventDefault();
    }
  }

  const countText =
    listOpen && searchOk ? `${existing.length + similar.length} találat és javaslat` : '';

  let hint: string;
  if (atLimit) hint = 'Elérted a legfeljebb 50 címkét. Törölj egyet, hogy másikat adhass hozzá.';
  else if (catalog.status === 'ready' && catalog.tags.length === 0) {
    hint = 'Még nincs címke a rendszerben. Írj be egyet, és ez lesz az első.';
  } else hint = 'Írj be egy témát, vagy válassz a meglévők közül.';

  return (
    <div
      {...{ [PICKER_OPEN_ATTR]: String(listOpen) }}
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <Label htmlFor={inputId}>
        Címkék <span className="font-normal text-subtle">(nem kötelező)</span>
      </Label>
      {value.length > 0 ? (
        <ul aria-label="Kiválasztott címkék" className="mt-2 flex flex-wrap gap-2">
          {value.map((tag) => (
            <li
              key={tag.id}
              className="inline-flex min-h-8 max-w-full items-center gap-2 rounded-full border border-border bg-surface-sunken py-1 pr-2 pl-3 text-sm text-text"
            >
              <span className="min-w-0 break-words">{tag.name}</span>
              <button
                type="button"
                aria-label={`„${tag.name}” címke törlése`}
                onClick={() => remove(tag)}
                className="relative flex size-6 shrink-0 items-center justify-center rounded-full text-muted hover:text-text after:absolute after:-inset-2 after:content-['']"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Command shouldFilter={false} label="Címkék" className="mt-2">
        <CommandInput
          id={inputId}
          ref={inputRef}
          value={query}
          disabled={atLimit}
          autoComplete="off"
          aria-describedby={[hintId, describedBy].filter(Boolean).join(' ')}
          onClick={() => {
            if (query === '' && !atLimit) {
              setAnnounce('');
              setOpen(true);
            }
          }}
          onValueChange={(next) => {
            setQuery(next);
            setOpen(next !== '');
            setAnnounce('');
            setNotice((previous) => (previous?.kind === 'choose' ? null : previous));
            createTag.reset();
          }}
        />
        <p id={hintId} className="text-xs text-subtle">
          {hint} Legfeljebb 50 címke. Enter: kiválasztás.
        </p>
        {catalog.status === 'loading' ? (
          <p role="status" aria-busy="true" className="text-sm text-muted">
            Címkék betöltése…
          </p>
        ) : null}
        {catalog.status === 'error' ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-danger">
            <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
            <span>A meglévő címkék listája nem töltődött be.</span>
            <Button variant="ghost" size="sm" onClick={catalog.reload}>
              Újrapróbálás
            </Button>
          </div>
        ) : null}
        {notice ? (
          <p role="status" className="text-sm text-muted">
            {notice.text}
          </p>
        ) : null}
        <p role="status" data-testid="tag-live" className="sr-only">
          {announce || countText}
        </p>
        {listOpen ? (
          <div
            className="space-y-2"
            // A lista kattintása ne vegye el a fókuszt a beviteli mezőről (különben a blur bezárná).
            onMouseDown={(event) => event.preventDefault()}
          >
            {invalidMessage ? (
              <FieldError id={`${hintId}-invalid`}>{invalidMessage}</FieldError>
            ) : (
              <>
                {searchable && current === null ? (
                  <p role="status" aria-busy="true" className="text-sm text-muted">
                    Ellenőrizzük, létezik-e hasonló címke…
                  </p>
                ) : null}
                {current?.error !== undefined ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm text-danger">
                    <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
                    <span>A javaslatok nem töltődtek be.</span>
                    <Button variant="ghost" size="sm" onClick={() => setAttempt((n) => n + 1)}>
                      Újrapróbálás
                    </Button>
                  </div>
                ) : null}
                {exactSelected ? (
                  <p role="status" className="text-sm text-muted">
                    Ez a címke már hozzá van adva.
                  </p>
                ) : null}
                {hasMatches || newRowVisible ? (
                  <CommandList>
                    {needsPlaceholder ? (
                      <CommandItem
                        value="__choose__"
                        // Látszólag nincs kijelölt sor, de a képernyőolvasó számára az `aria-activedescendant`
                        // célja címkézett elem (nem `aria-hidden`).
                        className="sr-only min-h-0 p-0"
                        onSelect={() =>
                          setNotice({
                            kind: 'choose',
                            text: searchable
                              ? 'Válassz a javaslatok közül, vagy a „Mégis új címke” lehetőséget.'
                              : 'Válassz a listából a nyilakkal, vagy írj be egy témát.',
                          })
                        }
                      >
                        Nincs kijelölt címke
                      </CommandItem>
                    ) : null}
                    {existing.length > 0 ? (
                      <CommandGroup heading="Meglévő címkék">
                        {existing.map((tag) => (
                          <CommandItem
                            key={tag.id}
                            value={`tag:${tag.id}`}
                            onSelect={() => add(tag, tag.id === exact?.id ? text : undefined)}
                          >
                            <span className="min-w-0 break-words">{tag.name}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    ) : null}
                    {similar.length > 0 ? (
                      <CommandGroup heading="Ezt kerested?">
                        {similar.map((tag) => (
                          <CommandItem
                            key={tag.id}
                            value={`tag:${tag.id}`}
                            onSelect={() => add(tag)}
                          >
                            <span className="min-w-0 break-words">{tag.name}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    ) : null}
                    {newRowVisible ? (
                      <>
                        {hasMatches ? <CommandSeparator /> : null}
                        <CommandItem
                          key={newRowState}
                          value={NEW_VALUE}
                          disabled={newRowState !== 'ready' || createTag.pending}
                          aria-busy={createTag.pending || undefined}
                          onSelect={() => void addNew()}
                          className="text-primary-soft-text"
                        >
                          <Plus aria-hidden="true" className="size-4 shrink-0" />
                          <span className="min-w-0 break-words">
                            {createTag.pending
                              ? 'Hozzáadás…'
                              : hasMatches
                                ? `Mégis új címke: „${text}”`
                                : `Új címke: „${text}”`}
                          </span>
                        </CommandItem>
                      </>
                    ) : null}
                  </CommandList>
                ) : null}
                {createTag.failed ? (
                  <div
                    role="alert"
                    className="flex flex-wrap items-center gap-2 text-sm text-danger"
                  >
                    <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
                    <span>{messageFor(createTag.error, { action: 'create-tag' })}</span>
                    {isRetryable(createTag.error) ? (
                      <Button variant="ghost" size="sm" onClick={() => void addNew()}>
                        Újrapróbálás
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </Command>
    </div>
  );
}
