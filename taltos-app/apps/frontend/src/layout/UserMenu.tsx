import { LogOut } from 'lucide-react';
import { useAuth } from '../auth/auth-context';
import { LoginLink } from '../auth/buttons';
import { Avatar } from '../components/ui/display';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';

/** A fejléc jobb oldala: bejelentkezve fiókmenü (név, szerep, Kijelentkezés), kijelentkezve Bejelentkezés. */
export function UserMenu() {
  const { state, logout } = useAuth();

  if (state.kind === 'loading') return null;
  if (state.kind !== 'signed-in') return <LoginLink variant="outline">Bejelentkezés</LoginLink>;

  const { displayName, avatarUrl, systemRole } = state.me;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Fiókmenü: ${displayName}`}
        className="flex h-12 min-w-0 items-center gap-3 rounded-md px-2 hover:bg-surface-sunken lg:h-10"
      >
        <Avatar name={displayName} url={avatarUrl} />
        <span className="hidden min-w-0 truncate text-sm font-medium text-text sm:inline">
          {displayName}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <span className="block text-sm font-semibold text-text">{displayName}</span>
          {systemRole === 'system_admin' ? (
            <span className="block text-xs font-normal text-muted">Rendszeradminisztrátor</span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void logout()}>
          <LogOut aria-hidden="true" className="size-4" />
          Kijelentkezés
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
