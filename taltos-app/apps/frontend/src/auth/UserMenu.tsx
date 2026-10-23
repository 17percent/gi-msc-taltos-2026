import { useAuth } from './auth-context';
import { LoginLink, buttonBase, buttonOutline } from './buttons';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return '?';
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  return [first, last]
    .map((part) => (part ? (Array.from(part)[0]?.toUpperCase() ?? '') : ''))
    .join('');
}

/** A fejléc jobb oldala: bejelentkezve név + Kijelentkezés, kijelentkezve Bejelentkezés. */
export function UserMenu() {
  const { state, logout, logoutFailed } = useAuth();

  if (state.kind === 'loading') return null;
  if (state.kind !== 'signed-in') return <LoginLink variant="outline">Bejelentkezés</LoginLink>;

  const { displayName, avatarUrl } = state.me;
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-3">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="size-8 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-on-primary"
        >
          {initials(displayName)}
        </span>
      )}
      <span className="min-w-0 truncate text-sm font-medium">{displayName}</span>
      <button
        type="button"
        onClick={() => void logout()}
        className={`${buttonBase} ${buttonOutline} shrink-0`}
      >
        Kijelentkezés
      </button>
      {logoutFailed ? (
        <span role="alert" className="w-full text-right text-xs text-danger">
          ✕ A kijelentkezés nem sikerült. Próbáld újra.
        </span>
      ) : null}
    </div>
  );
}
