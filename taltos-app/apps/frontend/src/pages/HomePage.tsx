import { useEffect, useState } from 'react';
import { HEALTH_PATH, type HealthResponse } from '@taltos/shared';

type BackendState = { kind: 'checking' } | { kind: 'up'; version: string } | { kind: 'down' };

/**
 * WP0 kezdőoldal: igazolja, hogy a frontend fut, és eléri a backendet. Belépés után
 * a főoldal a személyes feladat-dashboard lesz (D46, WP23); ez a lap addig helyőrző.
 */
export function HomePage() {
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
    <section className="max-w-(--read-width)">
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">Fejlesztői váz</p>
      <h1 className="mt-2 font-display text-4xl leading-tight font-semibold tracking-tight">
        Az alkalmazás váza fut
      </h1>
      <p className="mt-4 text-muted">
        Erre épülnek a következő munkacsomagok: bejelentkezés, színterek, közös szerkesztés és a két
        review-eres jóváhagyás.
      </p>
      <div className="mt-8 rounded-lg border border-border bg-surface p-6 shadow-(--shadow-sm)">
        <h2 className="text-sm font-semibold">Backend-kapcsolat</h2>
        <BackendStatus state={backend} />
      </div>
    </section>
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
