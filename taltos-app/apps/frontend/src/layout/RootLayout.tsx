import { Link, Outlet } from 'react-router';

export function RootLayout() {
  return (
    <div className="min-h-dvh bg-bg text-text">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-(--content-max) items-center px-4 py-3 sm:px-6">
          <Link
            to="/"
            className="rounded-md font-display text-xl font-semibold tracking-tight text-text no-underline"
          >
            Táltos
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-(--content-max) px-4 py-10 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
