import type { SpaceSummary } from '@taltos/shared';
import { Check, Lock, Pencil, Plus, Settings, UserPlus } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { type ErrorContext } from '../api/errors';
import { useApi } from '../api/use-api';
import { useAuth } from '../auth/auth-context';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FormError } from '../components/FormError';
import { RowMenu } from '../components/RowMenu';
import { Button } from '../components/ui/button';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  LoadingRegion,
  Skeleton,
  SpaceDot,
} from '../components/ui/display';
import { DropdownMenuItem } from '../components/ui/dropdown-menu';
import { Table, Td, Th } from '../components/ui/table';
import { useIsMdUp } from '../layout/use-media-query';
import { NewSpaceDialog } from '../spaces/NewSpaceDialog';
import { RenameDialog, type RenameTarget } from '../spaces/RenameDialog';
import { SelfAssignDialog, type SelfAssignTarget } from '../spaces/SelfAssignDialog';
import { ROLE_LABEL, TYPE_LABEL, compareSpaces } from '../spaces/labels';
import { useSpaces } from '../spaces/space-context';

function firstLine(text: string): string {
  return text.split('\n')[0] ?? '';
}

/** Adminisztráció › Színterek (`/admin/spaces`, spec 3.1). */
export function AdminSpacesPage() {
  const api = useApi();
  const { state } = useAuth();
  const spaces = useSpaces();
  const mdUp = useIsMdUp();
  const [newOpen, setNewOpen] = useState(false);
  const [rename, setRename] = useState<RenameTarget | null>(null);
  const [selfAssign, setSelfAssign] = useState<SelfAssignTarget | null>(null);
  const [closeTarget, setCloseTarget] = useState<SpaceSummary | null>(null);
  const closeFocusId = useRef<string | null>(null);
  const [highlight, setHighlight] = useState<string | undefined>();
  const [pageError, setPageError] = useState<{ error: unknown; context: ErrorContext } | null>(
    null,
  );

  if (state.kind !== 'signed-in') return null;
  const roleOf = (id: string) => state.me.spaces.find((space) => space.id === id)?.role ?? null;
  const rowMenuId = (id: string) => `space-menu-${id}`;

  const sorted = [...spaces.summaries].sort(compareSpaces);
  const active = sorted.filter((space) => !space.closed);
  const closed = sorted.filter((space) => space.closed);

  async function closeSpace(space: SpaceSummary) {
    try {
      await api.post(`/api/v1/spaces/${space.id}/close`);
      setPageError(null);
      toast.success(`A(z) „${space.name}” projekt-tér lezárva.`);
      spaces.reload();
      await spaces.refreshMembership();
    } catch (error) {
      setPageError({ error, context: { action: 'close-space' } });
    }
  }

  function menu(space: SpaceSummary) {
    const role = roleOf(space.id);
    return (
      <RowMenu label={space.name} id={rowMenuId(space.id)}>
        <DropdownMenuItem asChild>
          <Link to={`/spaces/${space.id}/settings`}>
            <Settings aria-hidden="true" className="size-4" />
            Beállítások megnyitása
          </Link>
        </DropdownMenuItem>
        {!space.closed ? (
          <DropdownMenuItem
            onSelect={() =>
              setRename({ id: space.id, name: space.name, returnFocusId: rowMenuId(space.id) })
            }
          >
            <Pencil aria-hidden="true" className="size-4" />
            Átnevezés
          </DropdownMenuItem>
        ) : null}
        {role === null ? (
          <DropdownMenuItem
            onSelect={() =>
              setSelfAssign({ id: space.id, name: space.name, returnFocusId: rowMenuId(space.id) })
            }
          >
            <UserPlus aria-hidden="true" className="size-4" />
            Felvétel magamat
          </DropdownMenuItem>
        ) : null}
        {space.type === 'project' && !space.closed ? (
          <DropdownMenuItem
            danger
            onSelect={() => {
              closeFocusId.current = rowMenuId(space.id);
              setCloseTarget(space);
            }}
          >
            <Lock aria-hidden="true" className="size-4" />
            Lezárás
          </DropdownMenuItem>
        ) : null}
      </RowMenu>
    );
  }

  const typeBadge = (space: SpaceSummary) => (
    <Badge tone={space.type === 'general' ? 'primary' : space.type === 'team' ? 'neutral' : 'info'}>
      {TYPE_LABEL[space.type]}
    </Badge>
  );
  const stateBadge = (space: SpaceSummary) =>
    space.closed ? (
      <Badge tone="warning" icon={Lock}>
        Lezárt
      </Badge>
    ) : (
      <Badge tone="success" icon={Check}>
        Aktív
      </Badge>
    );
  const membership = (space: SpaceSummary) => {
    const role = roleOf(space.id);
    return role ? (
      <Badge tone={role === 'space_manager' ? 'primary' : 'neutral'}>{ROLE_LABEL[role]}</Badge>
    ) : (
      <span className="text-muted">Nem vagy tag</span>
    );
  };
  const nameCell = (space: SpaceSummary) => (
    <div className="min-w-0">
      <span className="flex items-center gap-2 font-semibold text-text">
        <SpaceDot color={space.color} />
        <span className="break-words">{space.name}</span>
      </span>
      {space.description ? (
        <span className="mt-1 block truncate text-sm text-muted">
          {firstLine(space.description)}
        </span>
      ) : null}
    </div>
  );
  const rowClass = (space: SpaceSummary) =>
    space.id === highlight ? 'bg-primary-soft' : undefined;

  function renderGroup(list: SpaceSummary[], caption: string) {
    if (list.length === 0) return null;
    if (!mdUp) {
      return (
        <ul className="space-y-3" aria-label={caption}>
          {list.map((space) => (
            <li
              key={space.id}
              className={`rounded-lg border border-border p-4 ${rowClass(space) ?? ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                {nameCell(space)}
                {menu(space)}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {typeBadge(space)}
                {stateBadge(space)}
              </div>
              <p className="mt-2 text-sm text-muted">Tagságom: {membership(space)}</p>
            </li>
          ))}
        </ul>
      );
    }
    return (
      <Table caption={caption}>
        <thead>
          <tr>
            <Th>Színtér</Th>
            <Th>Típus</Th>
            <Th>Állapot</Th>
            <Th>Tagságom</Th>
            <Th className="w-0">
              <span className="sr-only">Műveletek</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {list.map((space) => (
            <tr key={space.id} className={rowClass(space)}>
              <Td>{nameCell(space)}</Td>
              <Td>{typeBadge(space)}</Td>
              <Td>{stateBadge(space)}</Td>
              <Td>{membership(space)}</Td>
              <Td className="text-right">{menu(space)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    );
  }

  let content;
  if (spaces.status === 'loading') {
    content = (
      <LoadingRegion label="Színterek betöltése…" className="space-y-3">
        {[0, 1, 2, 3, 4].map((n) => (
          <Skeleton key={n} className="h-12 w-full" />
        ))}
      </LoadingRegion>
    );
  } else if (spaces.status === 'error') {
    content = (
      <Alert tone="danger">
        <p>A színterek listája nem töltődött be. Próbáld újra.</p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={spaces.reload}>
          Újrapróbálás
        </Button>
      </Alert>
    );
  } else if (sorted.length === 0) {
    content = (
      <EmptyState
        icon={Plus}
        title="Még nincs színtér."
        action={<Button onClick={() => setNewOpen(true)}>Új színtér</Button>}
      />
    );
  } else {
    content = (
      <div className="space-y-6">
        {renderGroup(active, 'Színterek')}
        {closed.length > 0 ? (
          <section aria-labelledby="closed-spaces">
            <h2 id="closed-spaces" className="mb-2 text-sm font-semibold text-subtle uppercase">
              Lezárt színterek
            </h2>
            {renderGroup(closed, 'Lezárt színterek')}
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setNewOpen(true)}>
          <Plus aria-hidden="true" className="size-4" />
          Új színtér
        </Button>
      </div>
      {pageError ? <FormError error={pageError.error} context={pageError.context} /> : null}
      <Card>{content}</Card>

      <NewSpaceDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={(id) => {
          setHighlight(id);
          spaces.reload();
          void spaces.refreshMembership();
        }}
      />
      <RenameDialog space={rename} onClose={() => setRename(null)} />
      <SelfAssignDialog space={selfAssign} onClose={() => setSelfAssign(null)} />

      <ConfirmDialog
        open={closeTarget !== null}
        onOpenChange={(open) => !open && setCloseTarget(null)}
        title={closeTarget ? `„${closeTarget.name}” lezárása` : ''}
        body={
          <ul className="list-disc space-y-2 pl-5">
            <li>A lezárás után a színtér tartalma és tagsága csak olvasható.</li>
            <li>
              A függőben lévő review-kérések automatikusan visszavonódnak. Az érintett dokumentumok
              Piszkozat állapotba kerülnek, de nem szerkeszthetők; a beküldött változatok a
              revíziótörténetben megmaradnak.
            </li>
            <li>
              A tagságot ezután is csak te, Rendszeradminisztrátorként tudod módosítani (például ha
              egy kolléga távozik).
            </li>
            <li>Ebben a verzióban a lezárást nem lehet visszavonni.</li>
          </ul>
        }
        confirmLabel="Színtér lezárása"
        pendingLabel="Lezárás…"
        onConfirm={async () => {
          if (closeTarget) await closeSpace(closeTarget);
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (closeFocusId.current) document.getElementById(closeFocusId.current)?.focus();
        }}
      />
    </div>
  );
}
