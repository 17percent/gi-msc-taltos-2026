import { CircleAlert, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '../components/ui/button';
import { Command, CommandInput, CommandItem, CommandList } from '../components/ui/command';
import { Avatar } from '../components/ui/display';
import { Label } from '../components/ui/form';
import { PICKER_OPEN_ATTR } from './picker-utils';

export type UserOption = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  /** Megkülönböztető kiegészítés (pl. e-mail az Adminisztráció admin-listájában). */
  hint?: string;
};

type Result =
  | { query: string; attempt: number; items: UserOption[]; error?: undefined }
  | { query: string; attempt: number; items?: undefined; error: unknown };

/**
 * Felhasználókereső (spec 3.5): shadcn Command (`cmdk`), `shouldFilter={false}`, mert a szűrést a
 * szerver végzi. A lista a mező alatt, a folyamban él. Kiválasztva „chip” jelenik meg törlés gombbal.
 */
export function UserPicker({
  label,
  search,
  value,
  onChange,
  disabledIds,
  autoFocus = false,
  invalid = false,
  describedBy,
  debounceMs = 250,
}: {
  label: string;
  search: (query: string, signal: AbortSignal) => Promise<UserOption[]>;
  value: UserOption | null;
  onChange: (user: UserOption | null) => void;
  /** A már tag (vagy más okból nem választható) felhasználók: „Már tag” felirattal tiltott sor. */
  disabledIds?: ReadonlySet<string>;
  autoFocus?: boolean;
  invalid?: boolean;
  describedBy?: string;
  debounceMs?: number;
}) {
  const inputId = useId();
  const hintId = useId();
  const [query, setQuery] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [refocus, setRefocus] = useState(false);
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  });

  const trimmed = query.trim();
  const searching = trimmed.length >= 2;

  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchRef
        .current(trimmed, controller.signal)
        .then((items) => {
          if (!controller.signal.aborted) setResult({ query: trimmed, attempt, items });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setResult({ query: trimmed, attempt, error });
        });
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searching, trimmed, attempt, debounceMs]);

  const current = result && result.query === trimmed && result.attempt === attempt ? result : null;
  const listOpen = searching && dismissedFor !== trimmed;

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && listOpen) {
      // Az első Esc a listát zárja; a második a dialógot (a dialóg a data-attribútumból tudja).
      event.stopPropagation();
      setDismissedFor(trimmed);
    }
  }

  if (value) {
    return (
      <div>
        <Label htmlFor={`${inputId}-chip`}>{label}</Label>
        <div
          id={`${inputId}-chip`}
          className="mt-2 inline-flex h-8 max-w-full items-center gap-2 rounded-full border border-border bg-surface-sunken pr-2 pl-3 text-sm text-text"
        >
          <Avatar
            name={value.displayName}
            url={value.avatarUrl}
            className="size-5 text-[0.625rem]"
          />
          <span className="min-w-0 truncate">{value.displayName}</span>
          <button
            type="button"
            aria-label={`${value.displayName} törlése`}
            onClick={() => {
              onChange(null);
              setQuery('');
              setRefocus(true);
            }}
            className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted hover:text-text"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      </div>
    );
  }

  const found = current?.items ?? [];
  return (
    <div {...{ [PICKER_OPEN_ATTR]: String(listOpen) }} onKeyDown={onKeyDown}>
      <Label htmlFor={inputId}>{label}</Label>
      <Command shouldFilter={false} label={label} className="mt-2">
        <CommandInput
          id={inputId}
          value={query}
          onValueChange={setQuery}
          autoFocus={autoFocus || refocus}
          autoComplete="off"
          aria-invalid={invalid || undefined}
          aria-describedby={[hintId, describedBy].filter(Boolean).join(' ')}
        />
        {!searching ? (
          <p id={hintId} className="text-xs text-subtle">
            Írd be a kolléga nevét (legalább 2 betű).
          </p>
        ) : (
          <span id={hintId} className="sr-only">
            Keresés a nevek között.
          </span>
        )}
        {listOpen ? (
          <div className="space-y-2">
            {current === null ? (
              <p role="status" aria-busy="true" className="text-sm text-muted">
                Keresés…
              </p>
            ) : current.error !== undefined ? (
              <div className="flex flex-wrap items-center gap-2 text-sm text-danger">
                <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
                <span>A keresés nem sikerült.</span>
                <Button variant="ghost" size="sm" onClick={() => setAttempt((n) => n + 1)}>
                  Újrapróbálás
                </Button>
              </div>
            ) : found.length === 0 ? (
              <p role="status" className="text-sm text-muted">
                Nincs találat erre: „{trimmed}”. Ellenőrizd a nevet; csak azok kereshetők, akik
                beléphetnek.
              </p>
            ) : (
              <>
                <p role="status" className="sr-only">
                  {found.length} találat
                </p>
                <CommandList>
                  {found.map((user) => {
                    const disabled = disabledIds?.has(user.id) ?? false;
                    return (
                      <CommandItem
                        key={user.id}
                        value={user.id}
                        disabled={disabled}
                        onSelect={() => onChange(user)}
                      >
                        <Avatar name={user.displayName} url={user.avatarUrl} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{user.displayName}</span>
                          {user.hint ? (
                            <span className="block truncate text-xs text-muted">{user.hint}</span>
                          ) : null}
                        </span>
                        {disabled ? <span className="text-xs text-muted">Már tag</span> : null}
                      </CommandItem>
                    );
                  })}
                </CommandList>
              </>
            )}
          </div>
        ) : null}
      </Command>
    </div>
  );
}
