import { Home, Plus, Settings, ShieldCheck, type LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router';
import { useAuth } from '../auth/auth-context';
import { Button } from '../components/ui/button';
import { creatableSpaces } from '../documents/capabilities';
import { cn } from '../lib/cn';
import { useSpaces } from '../spaces/space-context';
import { SpaceSwitcher } from './SpaceSwitcher';

/** DS 6.1 NavItem: az aktív állapot nem csak színnel jelzett (súly + `aria-current`). */
function NavItem({
  to,
  icon: Icon,
  end,
  onNavigate,
  children,
}: {
  to: string;
  icon: LucideIcon;
  end?: boolean;
  onNavigate?: () => void;
  children: string;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex h-12 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted no-underline transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-sunken hover:text-text lg:h-10',
          isActive &&
            'bg-primary-soft font-semibold text-primary-soft-text hover:bg-primary-soft hover:text-primary-soft-text',
        )
      }
    >
      <Icon aria-hidden="true" className="size-5 shrink-0" />
      {children}
    </NavLink>
  );
}

/** Az oldalsáv tartalma: színtérváltó + navigáció a szerep szerint (spec 2.2–2.3). Asztalon fix, mobilon a Sheetben. */
export function SidebarContent({
  onNavigate,
  onNewDocument,
}: {
  onNavigate?: () => void;
  onNewDocument: () => void;
}) {
  const { state } = useAuth();
  const spaces = useSpaces();
  const isAdmin = state.kind === 'signed-in' && state.me.systemRole === 'system_admin';
  const settingsVisible =
    spaces.currentSpaceId !== null &&
    spaces.memberSpaces.some((space) => space.id === spaces.currentSpaceId);

  // „Új dokumentum”: ha van legalább egy nem lezárt tagsági tér (spec 1.); a Rendszeradmin nem tagként nem hozhat létre.
  const canCreate = spaces.status === 'ready' && creatableSpaces(spaces.memberSpaces).length > 0;

  return (
    <>
      <SpaceSwitcher {...(onNavigate ? { onNavigate } : {})} />
      {canCreate ? (
        <Button
          className="w-full"
          onClick={() => {
            onNavigate?.();
            onNewDocument();
          }}
        >
          <Plus aria-hidden="true" className="size-4" />
          Új dokumentum
        </Button>
      ) : null}
      <nav aria-label="Fő navigáció" className="flex flex-col gap-1">
        <NavItem to="/" end icon={Home} {...(onNavigate ? { onNavigate } : {})}>
          Kezdőlap
        </NavItem>
        {settingsVisible ? (
          <NavItem
            to={`/spaces/${spaces.currentSpaceId}/settings`}
            icon={Settings}
            {...(onNavigate ? { onNavigate } : {})}
          >
            Színtér beállításai
          </NavItem>
        ) : null}
        {isAdmin ? (
          <NavItem to="/admin" icon={ShieldCheck} {...(onNavigate ? { onNavigate } : {})}>
            Adminisztráció
          </NavItem>
        ) : null}
      </nav>
    </>
  );
}
