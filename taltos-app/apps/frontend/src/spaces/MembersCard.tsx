import type { SpaceDetail, SpaceMember, SpaceRole } from '@taltos/shared';
import { Crown, Pencil, Trash2, UserPlus } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ErrorContext } from '../api/errors';
import { useApi } from '../api/use-api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { RowMenu } from '../components/RowMenu';
import { Button } from '../components/ui/button';
import { Alert, Avatar, Badge, Card } from '../components/ui/display';
import { DropdownMenuItem, DropdownMenuSeparator } from '../components/ui/dropdown-menu';
import { Table, Td, Th } from '../components/ui/table';
import { useIsMdUp } from '../layout/use-media-query';
import { AddMemberDialog } from './AddMemberDialog';
import type { SpaceCapabilities } from './capabilities';
import { ROLE_LABEL, collator } from './labels';

function RoleBadge({ role }: { role: SpaceRole }) {
  return role === 'space_manager' ? (
    <Badge tone="primary" icon={Crown}>
      {ROLE_LABEL[role]}
    </Badge>
  ) : (
    <Badge tone="neutral" icon={Pencil}>
      {ROLE_LABEL[role]}
    </Badge>
  );
}

function sortMembers(members: readonly SpaceMember[]): SpaceMember[] {
  return [...members].sort(
    (a, b) =>
      Number(b.role === 'space_manager') - Number(a.role === 'space_manager') ||
      collator.compare(a.user.displayName, b.user.displayName),
  );
}

/** „Tagok” kártya (spec 4.2, 4.4–4.6): lista szerepekkel, felvétel, szerepváltás, eltávolítás. */
export function MembersCard({
  detail,
  members,
  me,
  caps,
  reload,
  onError,
  refreshMembership,
}: {
  detail: SpaceDetail;
  members: SpaceMember[];
  me: { id: string; systemRole: 'user' | 'system_admin' };
  caps: SpaceCapabilities;
  reload: () => void;
  onError: (error: unknown, context: ErrorContext) => void;
  refreshMembership: () => Promise<void>;
}) {
  const api = useApi();
  const mdUp = useIsMdUp();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [addOpen, setAddOpen] = useState(false);
  const returnFocusId = useRef<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<SpaceMember | null>(null);
  const [demoteSelf, setDemoteSelf] = useState<SpaceMember | null>(null);
  const isAdmin = me.systemRole === 'system_admin';
  const general = detail.type === 'general';
  const sorted = sortMembers(members);

  const menuId = (member: SpaceMember) => `member-menu-${member.user.id}`;

  async function changeRole(member: SpaceMember, role: SpaceRole) {
    const name = member.user.displayName;
    try {
      await api.patch(`/api/v1/spaces/${detail.id}/members/${member.user.id}`, { role });
      toast.success(`${name} mostantól ${ROLE_LABEL[role]}.`);
      reload();
      if (member.user.id === me.id) await refreshMembership();
    } catch (error) {
      onError(error, { action: 'change-role', name });
    }
  }

  async function remove(member: SpaceMember) {
    const name = member.user.displayName;
    try {
      await api.del(`/api/v1/spaces/${detail.id}/members/${member.user.id}`);
      toast.success(`${name} eltávolítva.`);
      reload();
      if (member.user.id === me.id) await refreshMembership();
    } catch (error) {
      onError(error, { action: 'remove-member', name, general });
    }
  }

  function requestRole(member: SpaceMember, role: SpaceRole) {
    // Saját visszaminősítés (és nem Rendszeradmin): megerősítés, mert utána nem szerkeszthet (spec 4.5).
    if (member.user.id === me.id && role === 'author' && !isAdmin) setDemoteSelf(member);
    else void changeRole(member, role);
  }

  function rowActions(member: SpaceMember) {
    const promote = caps.changeRoles && member.role === 'author';
    const demote = caps.changeRoles && member.role === 'space_manager';
    const removable = caps.removeMembers;
    return (
      <RowMenu
        label={member.user.displayName}
        id={menuId(member)}
        hasItems={promote || demote || removable}
      >
        {promote ? (
          <DropdownMenuItem onSelect={() => requestRole(member, 'space_manager')}>
            <Crown aria-hidden="true" className="size-4" />
            Legyen Színtérgazda
          </DropdownMenuItem>
        ) : null}
        {demote ? (
          <DropdownMenuItem onSelect={() => requestRole(member, 'author')}>
            <Pencil aria-hidden="true" className="size-4" />
            Legyen Szerző
          </DropdownMenuItem>
        ) : null}
        {removable ? (
          <>
            {promote || demote ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              danger
              onSelect={() => {
                returnFocusId.current = menuId(member);
                setRemoveTarget(member);
              }}
            >
              <Trash2 aria-hidden="true" className="size-4" />
              Eltávolítás
            </DropdownMenuItem>
          </>
        ) : null}
      </RowMenu>
    );
  }

  function memberName(member: SpaceMember) {
    return (
      <span className="flex min-w-0 items-center gap-3">
        <Avatar name={member.user.displayName} url={member.user.avatarUrl} />
        <span className="min-w-0 break-words text-text">{member.user.displayName}</span>
        {member.user.id === me.id ? <Badge tone="info">Te</Badge> : null}
      </span>
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-text">
          Tagok ({members.length})
        </h2>
        {caps.addMembers ? (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <UserPlus aria-hidden="true" className="size-4" />
            Tag hozzáadása
          </Button>
        ) : null}
      </div>

      {general ? (
        <p className="mt-2 text-sm text-muted">
          Az Általános színtér tagsága automatikus: aki be tud lépni, az tag. Tagot nem lehet
          eltávolítani, csak a szerepét lehet módosítani.
        </p>
      ) : null}

      {members.length < 3 ? (
        <Alert tone="info" className="mt-4">
          <p>
            Ebben a színtérben kevesebb mint három tag van, ezért nem lehet változást review-ra
            küldeni (két review-er kell az indítványozón kívül).{' '}
            {caps.addMembers
              ? 'Vegyél fel további tagokat.'
              : 'Kérd a Színtérgazdát, hogy vegyen fel további tagokat.'}
          </p>
        </Alert>
      ) : null}

      <div className="mt-4">
        {mdUp ? (
          <Table caption={`A(z) ${detail.name} színtér tagjai`}>
            <thead>
              <tr>
                <Th>Név</Th>
                <Th>Szerepkör</Th>
                <Th className="w-0">
                  <span className="sr-only">Műveletek</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((member) => (
                <tr key={member.user.id}>
                  <Td>{memberName(member)}</Td>
                  <Td>
                    <RoleBadge role={member.role} />
                  </Td>
                  <Td className="text-right">{rowActions(member)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <ul className="space-y-3">
            {sorted.map((member) => (
              <li
                key={member.user.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border p-4"
              >
                <div className="min-w-0 space-y-2">
                  {memberName(member)}
                  <RoleBadge role={member.role} />
                </div>
                {rowActions(member)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <AddMemberDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        spaceId={detail.id}
        memberIds={members.map((member) => member.user.id)}
        onAdded={(outcome, user) => {
          reload();
          if (outcome === 'added' && user?.id === me.id) void refreshMembership();
        }}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={
          removeTarget
            ? `${removeTarget.user.displayName} eltávolítása a(z) „${detail.name}” színtérből`
            : ''
        }
        body={
          removeTarget ? (
            <>
              <p>{removeTarget.user.displayName} többé nem látja a színtér tartalmát.</p>
              <p>
                Ha van függő review-kérése, az visszavonódik. Ha review-erként meg volt jelölve, a
                helye megszűnik, és az indítványozónak új review-ert kell jelölnie.
              </p>
              {removeTarget.user.id === me.id ? (
                <p>Magadat távolítod el: utána nem fogod látni a színteret.</p>
              ) : null}
            </>
          ) : null
        }
        confirmLabel="Eltávolítás"
        pendingLabel="Eltávolítás…"
        onConfirm={async () => {
          if (removeTarget) await remove(removeTarget);
        }}
        onCloseAutoFocus={(event) => {
          // A sor megszűnhet: ilyenkor a „Tagok” címsorra kerül a fókusz (spec 4.6).
          event.preventDefault();
          const target = returnFocusId.current
            ? document.getElementById(returnFocusId.current)
            : null;
          (target ?? headingRef.current)?.focus();
        }}
      />

      <ConfirmDialog
        open={demoteSelf !== null}
        onOpenChange={(open) => !open && setDemoteSelf(null)}
        title="Visszaminősíted magad Szerzővé?"
        body={<p>Utána nem módosíthatod a színtér beállításait és tagjait.</p>}
        confirmLabel="Visszaminősítés"
        pendingLabel="Visszaminősítés…"
        onConfirm={async () => {
          if (demoteSelf) await changeRole(demoteSelf, 'author');
        }}
      />
    </Card>
  );
}
