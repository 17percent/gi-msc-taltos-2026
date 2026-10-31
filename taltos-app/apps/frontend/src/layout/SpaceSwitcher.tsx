import { Lock } from 'lucide-react';
import { useId } from 'react';
import { Link, useMatch, useNavigate } from 'react-router';
import { Alert, SpaceDot, Skeleton } from '../components/ui/display';
import { Button } from '../components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { useAuth } from '../auth/auth-context';
import { useSpaces, type SwitcherSpace } from '../spaces/space-context';

function SpaceOption({ space }: { space: SwitcherSpace }) {
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

/** Színtérváltó (spec 2.2): Select, tagság a `/me`-ből, szín és lezárt-állapot a `GET /spaces`-ből. */
export function SpaceSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const { state } = useAuth();
  const spaces = useSpaces();
  const navigate = useNavigate();
  const onSettings = useMatch('/spaces/:spaceId/settings');
  const labelId = useId();

  const isAdmin = state.kind === 'signed-in' && state.me.systemRole === 'system_admin';
  const { memberSpaces } = spaces;
  const general = memberSpaces.filter((space) => space.type === 'general');
  const teams = memberSpaces.filter((space) => space.type === 'team');
  const projects = memberSpaces.filter((space) => space.type === 'project');

  function change(spaceId: string) {
    void spaces.selectSpace(spaceId);
    // A beállítások oldalon a váltás az új színtér beállításaira visz; máshol marad az oldalon.
    if (onSettings) void navigate(`/spaces/${spaceId}/settings`);
    onNavigate?.();
  }

  let control;
  if (spaces.status === 'loading') {
    control = (
      <div aria-busy="true">
        <p role="status" className="sr-only">
          Színterek betöltése…
        </p>
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
    );
  } else if (spaces.status === 'error') {
    control = (
      <Alert tone="danger">
        <p>A színterek listája nem töltődött be.</p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={spaces.reload}>
          Újrapróbálás
        </Button>
      </Alert>
    );
  } else if (memberSpaces.length === 0) {
    control = (
      <div>
        <div className="flex h-10 items-center rounded-md border border-border-strong bg-surface-sunken px-3 text-sm text-muted">
          Nincs színtered
        </div>
        <p className="mt-2 text-sm text-muted">
          {isAdmin ? (
            <>
              Vedd fel magad az{' '}
              <Link
                to="/admin/spaces"
                onClick={onNavigate}
                className="font-semibold text-secondary underline"
              >
                Adminisztrációban
              </Link>
              .
            </>
          ) : (
            'Kérd meg valamelyik Színtérgazdát, hogy vegyen fel.'
          )}
        </p>
      </div>
    );
  } else {
    control = (
      <Select value={spaces.currentSpaceId ?? ''} onValueChange={change}>
        <SelectTrigger aria-labelledby={labelId}>
          <SelectValue placeholder="Válassz színteret" />
        </SelectTrigger>
        <SelectContent>
          {general.map((space) => (
            <SelectItem key={space.id} value={space.id}>
              <SpaceOption space={space} />
            </SelectItem>
          ))}
          {general.length > 0 && (teams.length > 0 || projects.length > 0) ? (
            <SelectSeparator />
          ) : null}
          {teams.length > 0 ? (
            <SelectGroup>
              <SelectLabel>Csapatok</SelectLabel>
              {teams.map((space) => (
                <SelectItem key={space.id} value={space.id}>
                  <SpaceOption space={space} />
                </SelectItem>
              ))}
            </SelectGroup>
          ) : null}
          {projects.length > 0 ? (
            <SelectGroup>
              <SelectLabel>Projektek</SelectLabel>
              {projects.map((space) => (
                <SelectItem key={space.id} value={space.id}>
                  <SpaceOption space={space} />
                </SelectItem>
              ))}
            </SelectGroup>
          ) : null}
        </SelectContent>
      </Select>
    );
  }

  return (
    <div className="space-y-2">
      <span
        id={labelId}
        className="block px-3 text-xs font-semibold tracking-wide text-subtle uppercase"
      >
        Színtér
      </span>
      {control}
      {spaces.switchError ? <Alert tone="danger">{spaces.switchError}</Alert> : null}
    </div>
  );
}
