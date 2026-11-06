import type { NotSpaceMemberDetails } from '@taltos/shared';
import { Lock } from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '../auth/auth-context';
import { Avatar, Card } from '../components/ui/display';
import { buttonVariants } from '../components/ui/button-variants';
import { PageHeading } from '../layout/page';

/**
 * `403 not_space_member` hozzáférés-állapot (spec 4.7, D44): csak a színtér neve és a gazdák látszanak.
 * Nincs dokumentumcím, darabszám, taglétszám és nincs „Felvétel kérése” gomb (NK8).
 */
export function NoAccessState({
  details,
  subject = 'space',
}: {
  details: NotSpaceMemberDetails | undefined;
  /** Mihez nincs hozzáférés: csak a `h1` és az első mondat különbözik; `document`: a cím nem látszik (D44). */
  subject?: 'space' | 'document';
}) {
  const { state } = useAuth();
  const isAdmin = state.kind === 'signed-in' && state.me.systemRole === 'system_admin';
  const spaceName = details?.space.name;
  const managers = details?.managers ?? [];
  return (
    <Card className="mx-auto max-w-(--read-width) text-center">
      <div className="flex flex-col items-center gap-4">
        <span className="flex size-16 items-center justify-center rounded-full bg-primary-soft text-primary-soft-text">
          <Lock aria-hidden="true" className="size-8" />
        </span>
        <PageHeading className="text-3xl">
          {subject === 'document'
            ? 'Nincs hozzáférésed ehhez a dokumentumhoz'
            : 'Nincs hozzáférésed ehhez a színtérhez'}
        </PageHeading>
        {subject === 'document' ? (
          <p className="text-muted">
            Ez a dokumentum egy olyan színtérben van, amelynek nem vagy tagja.{' '}
            {spaceName
              ? `A(z) „${spaceName}” tartalmát csak a tagjai látják.`
              : 'A színtér tartalmát csak a tagjai látják.'}
          </p>
        ) : spaceName ? (
          <p className="text-muted">
            A(z) „{spaceName}” tartalmát és beállításait csak a tagjai látják.
          </p>
        ) : (
          <p className="text-muted">
            Ennek a színtérnek a tartalmát és beállításait csak a tagjai látják.
          </p>
        )}
        {managers.length > 0 ? (
          <div className="w-full text-left">
            <p className="text-sm font-semibold text-text">
              Felvételért fordulj valamelyik Színtérgazdához:
            </p>
            <ul className="mt-2 space-y-2">
              {managers.map((manager) => (
                <li key={manager.id} className="flex items-center gap-3 text-sm text-text">
                  <Avatar name={manager.displayName} url={manager.avatarUrl} />
                  <span className="min-w-0 break-words">{manager.displayName}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted">
            Ennek a színtérnek jelenleg nincs elérhető Színtérgazdája. Fordulj a
            Rendszeradminisztrátorhoz.
          </p>
        )}
        {subject === 'document' && isAdmin && details ? (
          <p className="text-sm text-muted">
            Rendszeradminisztrátorként a színtér beállításaiban felveheted magad.{' '}
            <Link
              to={`/spaces/${details.space.id}/settings`}
              className="font-semibold text-secondary underline"
            >
              Színtér beállításai
            </Link>
          </p>
        ) : null}
        <Link to="/" className={buttonVariants({ variant: 'primary' })}>
          Vissza a Kezdőlapra
        </Link>
      </div>
    </Card>
  );
}
