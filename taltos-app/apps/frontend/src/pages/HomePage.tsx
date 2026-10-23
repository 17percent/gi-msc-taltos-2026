import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { HEALTH_PATH, type HealthResponse, type LoginError } from '@taltos/shared';
import { useAuth } from '../auth/auth-context';
import { LoginLink, buttonBase, buttonOutline } from '../auth/buttons';

type BackendState = { kind: 'checking' } | { kind: 'up'; version: string } | { kind: 'down' };

/**
 * Kezdőoldal. Belépés után a főoldal a személyes feladat-dashboard lesz (D46, WP23);
 * addig a bejelentkezett felhasználó a backend-kapcsolat kártyát látja.
 */
export function HomePage() {
  const { state } = useAuth();
  const [params] = useSearchParams();
  const loginError = state.kind === 'signed-in' ? null : (params.get('error') as LoginError | null);
  const notAllowlisted = state.kind === 'not-allowlisted' || loginError === 'not_on_allowlist';
  const hasAlert =
    notAllowlisted ||
    loginError === 'setup_pending' ||
    loginError === 'login_failed' ||
    state.kind === 'error';

  if (state.kind === 'loading') {
    return (
      <p className="text-sm text-muted" role="status">
        Betöltés…
      </p>
    );
  }

  if (state.kind === 'signed-in') {
    return (
      <section className="max-w-(--read-width)">
        <h1 className="font-display text-4xl leading-tight font-semibold tracking-tight">
          Az alkalmazás váza fut
        </h1>
        <p className="mt-4 text-muted">Szia, {state.me.displayName}! Be vagy jelentkezve.</p>
        <BackendCard />
      </section>
    );
  }

  return (
    <section className="max-w-(--read-width)">
      {hasAlert ? (
        <div className="mb-6 space-y-3">
          {notAllowlisted ? <NotAllowlistedAlert /> : null}
          {loginError === 'setup_pending' ? <SetupPendingAlert /> : null}
          {loginError === 'login_failed' ? <LoginFailedAlert /> : null}
          {state.kind === 'error' ? <ErrorAlert /> : null}
        </div>
      ) : null}
      <h1 className="font-display text-4xl leading-tight font-semibold tracking-tight">
        Jelentkezz be a Táltosba
      </h1>
      <p className="mt-4 text-muted">
        A szervezeti tudást itt találod meg és itt írhatod tovább. Lépj be a munkahelyi fiókoddal.
      </p>
      <div className="mt-6">
        <LoginLink>Bejelentkezés</LoginLink>
      </div>
    </section>
  );
}

function Alert({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex gap-3 rounded-md border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-danger-bg p-4"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-0.5 size-5 shrink-0 text-danger"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
      <div className="min-w-0">
        <p className="font-semibold text-text">{title}</p>
        <div className="mt-1 text-sm text-text">{children}</div>
      </div>
    </div>
  );
}

function NotAllowlistedAlert() {
  return (
    <Alert title="Ezzel a címmel még nem léphetsz be">
      <p>
        A megadott e-mail-cím nincs a jogosultak listáján. Kérd meg a Rendszeradminisztrátort, hogy
        vegye fel a címedet. Ha másik fiókkal is dolgozol, próbálkozhatsz azzal.
      </p>
      <p className="mt-3">
        <a href="/auth/login" className="font-semibold text-secondary underline">
          Bejelentkezés másik fiókkal
        </a>
      </p>
    </Alert>
  );
}

function SetupPendingAlert() {
  return (
    <Alert title="A Táltos még nincs beállítva">
      <p>
        A rendszert a Rendszeradminisztrátor első belépése indítja el. Ha ez megtörtént, próbáld
        újra a bejelentkezést.
      </p>
    </Alert>
  );
}

function LoginFailedAlert() {
  return (
    <Alert title="A bejelentkezés nem sikerült">
      <p>
        A belépést nem tudtuk befejezni. Próbáld meg újra; ha a hiba megmarad, szólj a
        Rendszeradminisztrátornak.
      </p>
      <p className="mt-3">
        <a href="/auth/login" className="font-semibold text-secondary underline">
          Bejelentkezés újra
        </a>
      </p>
    </Alert>
  );
}

function ErrorAlert() {
  return (
    <Alert title="Nem sikerült ellenőrizni a bejelentkezésedet">
      <p>A szerver most nem válaszol. Töltsd újra az oldalt, vagy próbáld meg később.</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className={`${buttonBase} ${buttonOutline} mt-3`}
      >
        Oldal újratöltése
      </button>
    </Alert>
  );
}

function BackendCard() {
  const [backend, setBackend] = useState<BackendState>({ kind: 'checking' });

  useEffect(() => {
    const controller = new AbortController();
    fetch(HEALTH_PATH, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as HealthResponse;
        setBackend({ kind: 'up', version: body.version });
      })
      .catch(() => {
        if (!controller.signal.aborted) setBackend({ kind: 'down' });
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="mt-8 rounded-lg border border-border bg-surface p-6 shadow-(--shadow-sm)">
      <h2 className="text-sm font-semibold">Backend-kapcsolat</h2>
      <BackendStatus state={backend} />
    </div>
  );
}

function BackendStatus({ state }: { state: BackendState }) {
  if (state.kind === 'checking') {
    return (
      <p className="mt-2 text-sm text-muted" role="status">
        Kapcsolat ellenőrzése…
      </p>
    );
  }
  if (state.kind === 'up') {
    return (
      <p className="mt-2 flex items-center gap-2 text-sm" role="status">
        <span className="rounded-full bg-success-bg px-2 text-xs font-semibold text-success">
          ✓ Elérhető
        </span>
        <span className="font-mono text-xs text-muted">verzió: {state.version}</span>
      </p>
    );
  }
  return (
    <p className="mt-2 flex items-center gap-2 text-sm" role="status">
      <span className="rounded-full bg-danger-bg px-2 text-xs font-semibold text-danger">
        ✕ Nem érhető el
      </span>
      <span className="text-muted">Indítsd el a backendet, majd töltsd újra az oldalt.</span>
    </p>
  );
}
