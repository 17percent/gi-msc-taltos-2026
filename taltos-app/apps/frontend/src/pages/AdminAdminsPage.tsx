import type { AdminUser } from '@taltos/shared';
import { ShieldMinus, ShieldPlus } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { isApiError } from '../api/client';
import type { ErrorContext } from '../api/errors';
import { useApi } from '../api/use-api';
import { useResource } from '../api/use-resource';
import { useAuth } from '../auth/auth-context';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FormError } from '../components/FormError';
import { Button } from '../components/ui/button';
import { Alert, Avatar, Badge, Card, LoadingRegion, Skeleton } from '../components/ui/display';
import { Table, Td, Th } from '../components/ui/table';
import { useIsMdUp } from '../layout/use-media-query';
import { UserPicker, type UserOption } from '../spaces/UserPicker';
import { useSpaces } from '../spaces/space-context';

const dateTime = new Intl.DateTimeFormat('hu-HU', { dateStyle: 'medium', timeStyle: 'short' });

/** Adminisztráció › Rendszeradminisztrátorok (`/admin/admins`, spec 3.2). */
export function AdminAdminsPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { state, refreshMe } = useAuth();
  const spaces = useSpaces();
  const mdUp = useIsMdUp();
  const users = useResource('admin-users', (client, signal) =>
    client.get<AdminUser[]>('/api/v1/admin/users', signal),
  );
  const grantRef = useRef<HTMLDivElement>(null);
  const focusGrantOnClose = useRef(false);
  const [candidate, setCandidate] = useState<UserOption | null>(null);
  const [grantTarget, setGrantTarget] = useState<AdminUser | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<AdminUser | null>(null);
  const [pageError, setPageError] = useState<{ error: unknown; context: ErrorContext } | null>(
    null,
  );

  const all = users.data;
  const search = useCallback(
    (query: string): Promise<UserOption[]> => {
      const needle = query.toLowerCase();
      const found = (all ?? [])
        .filter(
          (user) =>
            user.systemRole !== 'system_admin' &&
            (user.displayName.toLowerCase().includes(needle) ||
              user.email.toLowerCase().includes(needle)),
        )
        .slice(0, 10)
        .map((user) => ({
          id: user.id,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          hint: user.email,
        }));
      return Promise.resolve(found);
    },
    [all],
  );

  if (state.kind !== 'signed-in') return null;
  const myId = state.me.id;

  async function change(user: AdminUser, systemRole: 'user' | 'system_admin') {
    const action = systemRole === 'system_admin' ? 'grant-admin' : 'revoke-admin';
    try {
      await api.put(`/api/v1/admin/users/${user.id}/system-role`, { systemRole });
      setPageError(null);
      if (systemRole === 'system_admin') {
        toast.success(`${user.displayName} mostantól Rendszeradminisztrátor.`);
        setCandidate(null);
      } else if (user.id === myId) {
        await refreshMe();
        await spaces.refreshMembership();
        toast.success('Visszavontad a saját Rendszeradminisztrátori jogodat.');
        void navigate('/');
        return;
      } else {
        toast.success(`${user.displayName} Rendszeradminisztrátori joga visszavonva.`);
      }
      users.reload();
    } catch (error) {
      setPageError({ error, context: { action, name: user.displayName } });
      if (isApiError(error) && error.code === 'last_admin') {
        // A fókusz a dialógus bezárása után kerül a keresőre (onCloseAutoFocus).
        focusGrantOnClose.current = true;
      }
      if (isApiError(error) && error.code === 'not_found') users.reload();
    }
  }

  if (users.status === 'loading') {
    return (
      <LoadingRegion label="Rendszeradminisztrátorok betöltése…" className="space-y-3">
        {[0, 1, 2].map((n) => (
          <Skeleton key={n} className="h-12 w-full" />
        ))}
      </LoadingRegion>
    );
  }
  if (users.status === 'error') {
    return (
      <Alert tone="danger">
        <p>A felhasználók listája nem töltődött be. Próbáld újra.</p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={users.reload}>
          Újrapróbálás
        </Button>
      </Alert>
    );
  }

  const admins = users.data.filter((user) => user.systemRole === 'system_admin');
  const lastLogin = (user: AdminUser) =>
    user.lastLoginAt ? dateTime.format(new Date(user.lastLoginAt)) : 'Még nem lépett be';
  const who = (user: AdminUser) => (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar name={user.displayName} url={user.avatarUrl} />
      <span className="min-w-0 break-words font-semibold text-text">{user.displayName}</span>
      {user.id === myId ? <Badge tone="info">Te</Badge> : null}
    </span>
  );
  const revokeButton = (user: AdminUser) => (
    <Button
      variant="danger-ghost"
      size="sm"
      aria-label={`Jog visszavonása: ${user.displayName}`}
      onClick={() => setRevokeTarget(user)}
    >
      <ShieldMinus aria-hidden="true" className="size-4" />
      Jog visszavonása
    </Button>
  );

  return (
    <div className="space-y-6">
      {pageError ? <FormError error={pageError.error} context={pageError.context} /> : null}

      <Card>
        <h2 className="mb-4 text-xl font-semibold text-text">Aktuális Rendszeradminisztrátorok</h2>
        {mdUp ? (
          <Table caption="Rendszeradminisztrátorok">
            <thead>
              <tr>
                <Th>Név</Th>
                <Th>E-mail</Th>
                <Th>Utolsó belépés</Th>
                <Th className="w-0">
                  <span className="sr-only">Műveletek</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {admins.map((user) => (
                <tr key={user.id}>
                  <Td>{who(user)}</Td>
                  <Td className="text-sm">{user.email}</Td>
                  <Td>{lastLogin(user)}</Td>
                  <Td className="text-right">{revokeButton(user)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <ul className="space-y-3">
            {admins.map((user) => (
              <li key={user.id} className="space-y-2 rounded-lg border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  {who(user)}
                  {revokeButton(user)}
                </div>
                <p className="text-sm break-words text-muted">E-mail: {user.email}</p>
                <p className="text-sm text-muted">Utolsó belépés: {lastLogin(user)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <div ref={grantRef} className="space-y-4">
          <h2 className="text-xl font-semibold text-text">Új Rendszeradminisztrátor kijelölése</h2>
          <UserPicker
            label="Felhasználó neve vagy e-mail-címe"
            search={search}
            value={candidate}
            onChange={setCandidate}
            debounceMs={0}
          />
          <Button
            disabled={!candidate}
            onClick={() => {
              const user = users.data.find((entry) => entry.id === candidate?.id);
              if (user) setGrantTarget(user);
            }}
          >
            <ShieldPlus aria-hidden="true" className="size-4" />
            Jog megadása
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={grantTarget !== null}
        onOpenChange={(open) => !open && setGrantTarget(null)}
        title={grantTarget ? `${grantTarget.displayName} legyen Rendszeradminisztrátor?` : ''}
        body={
          <p>
            Kezelheti a színtereket és a Rendszeradminisztrátorokat, és bármely színtérbe felveheti
            magát. A színterek tartalmát csak tagként látja.
          </p>
        }
        confirmLabel="Jog megadása"
        pendingLabel="Jog megadása…"
        tone="primary"
        onConfirm={async () => {
          if (grantTarget) await change(grantTarget, 'system_admin');
        }}
      />
      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title={
          revokeTarget
            ? `${revokeTarget.displayName} Rendszeradminisztrátori jogának visszavonása`
            : ''
        }
        body={
          <>
            <p>
              Utána nem látja az Adminisztráció oldalt, és nem hozhat létre vagy zárhat le
              színteret. A színtér-tagságai nem változnak.
            </p>
            {revokeTarget?.id === myId ? (
              <p>A saját jogodat vonod vissza: utána te sem fogod látni az Adminisztrációt.</p>
            ) : null}
          </>
        }
        confirmLabel="Jog visszavonása"
        pendingLabel="Visszavonás…"
        onCloseAutoFocus={(event) => {
          if (!focusGrantOnClose.current) return;
          focusGrantOnClose.current = false;
          event.preventDefault();
          grantRef.current?.querySelector('input')?.focus();
        }}
        onConfirm={async () => {
          if (revokeTarget) await change(revokeTarget, 'user');
        }}
      />
    </div>
  );
}
