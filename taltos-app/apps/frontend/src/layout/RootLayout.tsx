import { Link, Outlet } from 'react-router';
import { AuthProvider } from '../auth/AuthProvider';
import { UserMenu } from '../auth/UserMenu';

export function RootLayout() {
  return (
    <AuthProvider>
      <div className="min-h-dvh bg-bg text-text">
        <header className="border-b border-border bg-surface">
          <div className="mx-auto flex max-w-(--content-max) items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <Link
              to="/"
              className="rounded-md font-display text-xl font-semibold tracking-tight text-text no-underline"
            >
              Táltos
            </Link>
            <UserMenu />
          </div>
        </header>
        <main className="mx-auto max-w-(--content-max) px-4 py-10 sm:px-6">
          <Outlet />
        </main>
      </div>
    </AuthProvider>
  );
}
