import { Link, Navigate, useParams } from 'react-router';
import { COLLAB_DOCUMENT_NAME_PATTERN } from '@taltos/shared';
import { useAuth } from '../auth/auth-context';
import { LoginLink } from '../auth/buttons';
import { CollabEditor } from '../editor/CollabEditor';
import { NO_ACCESS_MESSAGE } from '../editor/collab-status';

/** Dokumentum-szerkesztő oldal (WP3 spike): bejelentkezett felhasználóknak, `/documents/:documentId`. */
export function DocumentPage() {
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

  return (
    <section>
      <title>Dokumentum – Táltos</title>
      <h1 className="font-display text-3xl leading-tight font-semibold tracking-tight">
        Dokumentum
      </h1>
      <div className="mt-4">
        <CollabEditor documentId={documentId} user={state.me} />
      </div>
    </section>
  );
}
