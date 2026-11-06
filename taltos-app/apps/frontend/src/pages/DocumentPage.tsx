import { usePageTitle } from '../layout/use-page-title';
import { Link, Navigate, useParams } from 'react-router';
import {
  COLLAB_DOCUMENT_NAME_PATTERN,
  type DocumentDetail,
  type NotSpaceMemberDetails,
} from '@taltos/shared';
import { FileQuestion } from 'lucide-react';
import { isApiError } from '../api/client';
import { apiPath } from '../api/paths';
import { useResource } from '../api/use-resource';
import { Button } from '../components/ui/button';
import { Alert, EmptyState, LoadingRegion, Skeleton } from '../components/ui/display';
import { buttonVariants } from '../components/ui/button-variants';
import { DocumentHeader } from '../documents/DocumentHeader';
import { NoAccessState } from '../spaces/NoAccessState';
import { useAuth } from '../auth/auth-context';
import { LoginLink } from '../auth/buttons';
import { CollabEditor } from '../editor/CollabEditor';
import { NO_ACCESS_MESSAGE } from '../editor/collab-status';

/** Dokumentum-szerkesztő oldal (WP3 spike): bejelentkezett felhasználóknak, `/documents/:documentId`. */
export function DocumentPage() {
  usePageTitle('Dokumentum');
  const { state } = useAuth();
  const { documentId = '' } = useParams();

  if (state.kind === 'loading') {
    return (
      <p className="text-sm text-muted" role="status">
        Betöltés…
      </p>
    );
  }

  if (state.kind === 'signed-out') {
    return (
      <section className="max-w-(--read-width)">
        <h1 className="font-display text-4xl leading-tight font-semibold tracking-tight">
          Jelentkezz be a Táltosba
        </h1>
        <p className="mt-4 text-muted">
          A dokumentum megnyitásához lépj be a munkahelyi fiókoddal.
        </p>
        <div className="mt-6">
          <LoginLink>Bejelentkezés</LoginLink>
        </div>
      </section>
    );
  }

  // A nem jogosult cím és a hiba részletes üzenetét a kezdőoldal már megmutatja.
  if (state.kind !== 'signed-in') return <Navigate to="/" replace />;

  // A formátum előzetes ellenőrzése: érvénytelen azonosítóval nem nyitunk kapcsolatot.
  // Ugyanazt a semleges üzenetet adjuk, mint a szerver elutasítása.
  if (!COLLAB_DOCUMENT_NAME_PATTERN.test(documentId)) {
    return (
      <section className="max-w-(--read-width)">
        <h1 className="font-display text-4xl leading-tight font-semibold tracking-tight">
          Dokumentum
        </h1>
        <p role="alert" className="mt-4 text-text">
          {NO_ACCESS_MESSAGE}
        </p>
        <Link to="/" className="mt-4 inline-block font-semibold text-secondary underline">
          Vissza a kezdőoldalra
        </Link>
      </section>
    );
  }

  return <DocumentView documentId={documentId} user={state.me} />;
}

/** A dokumentum adatai (`GET /documents/:id`) és a szerkesztő; a szerkesztő csak sikeres lekérés után töltődik be. */
function DocumentView({
  documentId,
  user,
}: {
  documentId: string;
  user: Parameters<typeof CollabEditor>[0]['user'];
}) {
  const doc = useResource(`document:${documentId}`, (client, signal) =>
    client.get<DocumentDetail>(apiPath`/api/v1/documents/${documentId}`, signal),
  );

  if (doc.status === 'loading') {
    return (
      <LoadingRegion label="A dokumentum betöltése…" className="space-y-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-6 w-2/3" />
      </LoadingRegion>
    );
  }

  if (doc.status === 'error') {
    const error = doc.error;
    if (isApiError(error) && error.code === 'not_space_member') {
      return (
        <NoAccessState
          subject="document"
          details={error.details as NotSpaceMemberDetails | undefined}
        />
      );
    }
    if (isApiError(error) && error.code === 'not_found') {
      return (
        <EmptyState
          icon={FileQuestion}
          titleAs="h1"
          title="A dokumentum nem található"
          action={
            <Link to="/" className={buttonVariants({ variant: 'primary' })}>
              Vissza a Kezdőlapra
            </Link>
          }
        >
          <p>Lehet, hogy eldobták, vagy hibás a hivatkozás.</p>
        </EmptyState>
      );
    }
    return (
      <Alert tone="danger">
        <p>A dokumentum adatai nem töltődtek be.</p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={doc.reload}>
          Újrapróbálás
        </Button>
      </Alert>
    );
  }

  return (
    <section className="space-y-4">
      <DocumentHeader doc={doc.data} onChanged={doc.reload} />
      <CollabEditor documentId={documentId} user={user} />
    </section>
  );
}
