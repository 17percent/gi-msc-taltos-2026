import { ApiError } from '../api/client';
import { apiPath, isUuid } from '../api/paths';
import type { NotSpaceMemberDetails, SpaceDetail, SpaceMember } from '@taltos/shared';
import { EyeOff, Lock } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { isApiError } from '../api/client';
import type { ErrorContext } from '../api/errors';
import { useResource } from '../api/use-resource';
import { useAuth } from '../auth/auth-context';
import { FormError } from '../components/FormError';
import { Button } from '../components/ui/button';
import { buttonVariants } from '../components/ui/button-variants';
import {
  Alert,
  Badge,
  EmptyState,
  LoadingRegion,
  Skeleton,
  SpaceDot,
} from '../components/ui/display';
import { Breadcrumb, PageHeading } from '../layout/page';
import { usePageTitle } from '../layout/use-page-title';
import { BasicsCard } from '../spaces/BasicsCard';
import { MembersCard } from '../spaces/MembersCard';
import { NoAccessState } from '../spaces/NoAccessState';
import { SelfAssignDialog } from '../spaces/SelfAssignDialog';
import { spaceCapabilities } from '../spaces/capabilities';
import { TYPE_LABEL } from '../spaces/labels';
import { useSpaces } from '../spaces/space-context';

type Loaded = { detail: SpaceDetail; members: SpaceMember[] };

function SettingsView({ data, reload }: { data: Loaded; reload: () => void }) {
  const { state } = useAuth();
  const spaces = useSpaces();
  const { detail, members } = data;
  const [pageError, setPageError] = useState<{ error: unknown; context: ErrorContext } | null>(
    null,
  );
  const [selfAssignOpen, setSelfAssignOpen] = useState(false);

  if (state.kind !== 'signed-in') return null;
  const { me } = state;
  const myRole = me.spaces.find((space) => space.id === detail.id)?.role ?? null;
  const isAdmin = me.systemRole === 'system_admin';
  const caps = spaceCapabilities({ systemRole: me.systemRole, myRole, space: detail });

  const clearError = () => setPageError(null);

  function handleError(error: unknown, context: ErrorContext) {
    setPageError({ error, context });
    if (isApiError(error)) {
      if (error.code === 'forbidden') void spaces.refreshMembership();
      if (error.code === 'space_closed' || error.code === 'not_found') reload();
    }
  }

  const managerNames = detail.managers.map((manager) => manager.displayName).join(', ');
  const selfAssignButton = caps.selfAssign ? (
    <Button size="sm" variant="outline" className="mt-3" onClick={() => setSelfAssignOpen(true)}>
      Felvétel magamat
    </Button>
  ) : null;

  // Egyszerre egy helyzetjelző sáv, fontossági sorrendben (spec 4.3).
  let banner = null;
  if (detail.closed) {
    banner = (
      <Alert tone="warning" icon={Lock}>
        <p>
          Ez a projekt-tér le van zárva: a tartalma és a beállításai csak olvashatók.{' '}
          {isAdmin
            ? 'Rendszeradminisztrátorként a tagságot továbbra is kezelheted.'
            : 'A tagságot csak a Rendszeradminisztrátor módosíthatja.'}
        </p>
        {selfAssignButton}
      </Alert>
    );
  } else if (isAdmin && myRole === null) {
    banner = (
      <Alert tone="info" icon={EyeOff}>
        <p>
          Nem vagy tagja ennek a színtérnek, ezért csak az adatait és a tagjait látod, a tartalmat
          nem.
        </p>
        {selfAssignButton}
      </Alert>
    );
  } else if (myRole === 'author' && !isAdmin) {
    banner = (
      <Alert tone="info">
        <p>A beállításokat a Színtérgazdák módosítják{managerNames ? `: ${managerNames}` : ''}.</p>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {isAdmin ? (
        <Breadcrumb
          items={[
            { label: 'Adminisztráció', to: '/admin' },
            { label: 'Színterek', to: '/admin/spaces' },
            { label: detail.name },
          ]}
        />
      ) : null}

      <header className="space-y-3">
        <PageHeading className="flex items-center gap-3">
          <SpaceDot color={detail.color} size="lg" />
          <span className="min-w-0 break-words">{detail.name}</span>
        </PageHeading>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            tone={
              detail.type === 'general' ? 'primary' : detail.type === 'team' ? 'neutral' : 'info'
            }
          >
            {TYPE_LABEL[detail.type]}
          </Badge>
          {detail.closed ? (
            <Badge tone="warning" icon={Lock}>
              Lezárt
            </Badge>
          ) : null}
          <Badge tone={myRole === 'space_manager' ? 'primary' : 'neutral'}>
            {myRole === 'space_manager'
              ? 'Színtérgazda'
              : myRole === 'author'
                ? 'Szerző'
                : 'Nem vagy tag'}
          </Badge>
        </div>
      </header>

      {pageError ? <FormError error={pageError.error} context={pageError.context} /> : null}
      {banner}

      <BasicsCard
        detail={detail}
        caps={caps}
        onSaved={() => {
          clearError();
          reload();
        }}
      />
      <MembersCard
        detail={detail}
        members={members}
        me={me}
        caps={caps}
        reload={reload}
        onError={handleError}
        clearError={clearError}
        refreshMembership={spaces.refreshMembership}
      />

      <SelfAssignDialog
        space={selfAssignOpen ? { id: detail.id, name: detail.name } : null}
        onClose={() => setSelfAssignOpen(false)}
        onDone={() => {
          clearError();
          reload();
        }}
      />
    </div>
  );
}

function LoadingState() {
  return (
    <LoadingRegion label="Színtér betöltése…" className="space-y-6">
      <PageHeading>
        <span className="sr-only">Színtér betöltése…</span>
        <Skeleton className="h-10 w-64" />
      </PageHeading>
      <Skeleton className="h-64 w-full rounded-lg" />
      <Skeleton className="h-48 w-full rounded-lg" />
    </LoadingRegion>
  );
}

/** Színtér beállításai (`/spaces/:spaceId/settings`, spec 4.). */
export function SpaceSettingsPage() {
  const { spaceId = '' } = useParams();
  const resource = useResource<Loaded>(`settings:${spaceId}`, async (api, signal) => {
    // A nem szabályos azonosító soha nem kerül API-útvonalba (nincs kérés, „nem található” állapot).
    if (!isUuid(spaceId)) throw new ApiError('not_found', 404);
    const [detail, members] = await Promise.all([
      api.get<SpaceDetail>(apiPath`/api/v1/spaces/${spaceId}`, signal),
      api.get<SpaceMember[]>(apiPath`/api/v1/spaces/${spaceId}/members`, signal),
    ]);
    return { detail, members };
  });
  usePageTitle('Színtér beállításai');

  if (resource.status === 'loading') return <LoadingState />;

  if (resource.status === 'error') {
    const error = resource.error;
    if (isApiError(error) && error.code === 'not_space_member') {
      return <NoAccessState details={error.details as NotSpaceMemberDetails | undefined} />;
    }
    if (isApiError(error) && error.code === 'not_found') {
      return (
        <EmptyState
          icon={Lock}
          titleAs="h1"
          title="A színtér nem található"
          action={
            <Link to="/" className={buttonVariants({ variant: 'primary' })}>
              Vissza a Kezdőlapra
            </Link>
          }
        >
          <p>Lehet, hogy törölték, vagy hibás a hivatkozás.</p>
        </EmptyState>
      );
    }
    return (
      <div className="space-y-4">
        <PageHeading>Színtér beállításai</PageHeading>
        <FormError error={error} context={{ action: 'load' }} onRetry={resource.reload} />
      </div>
    );
  }

  return <SettingsView data={resource.data} reload={resource.reload} />;
}
