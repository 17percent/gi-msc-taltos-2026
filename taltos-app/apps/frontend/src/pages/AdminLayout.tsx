import { ShieldAlert } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth/auth-context';
import { EmptyState } from '../components/ui/display';
import { PageHeading } from '../layout/page';
import { usePageTitle } from '../layout/use-page-title';
import { cn } from '../lib/cn';

function Tab({ to, children }: { to: string; children: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex h-12 items-center border-b-2 border-transparent px-4 text-sm font-medium text-muted no-underline hover:text-text lg:h-10',
          isActive && 'border-primary font-semibold text-text',
        )
      }
    >
      {children}
    </NavLink>
  );
}

/** Az Adminisztráció kerete: csak Rendszeradminisztrátornak; fülei útvonalak (D49). */
export function AdminLayout() {
  const { state } = useAuth();
  usePageTitle('Adminisztráció');

  if (state.kind === 'loading') return null;
  if (state.kind !== 'signed-in') {
    return (
      <EmptyState icon={ShieldAlert} titleAs="h1" title="Jelentkezz be">
        <p>Az Adminisztráció megnyitásához be kell jelentkezned.</p>
      </EmptyState>
    );
  }
  if (state.me.systemRole !== 'system_admin') {
    return (
      <EmptyState icon={ShieldAlert} titleAs="h1" title="Nincs jogosultságod">
        <p>Az Adminisztrációt csak a Rendszeradminisztrátorok érik el.</p>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <PageHeading>Adminisztráció</PageHeading>
        <p className="text-muted">
          Színterek, Rendszeradminisztrátorok és dokumentumfajták kezelése.
        </p>
      </header>
      <nav aria-label="Adminisztráció" className="flex gap-1 border-b border-border">
        <Tab to="/admin/spaces">Színterek</Tab>
        <Tab to="/admin/admins">Rendszeradminisztrátorok</Tab>
        <Tab to="/admin/kinds">Fajták</Tab>
      </nav>
      <Outlet />
    </div>
  );
}
