import type { CollabAwarenessUser } from '@taltos/shared';

/**
 * A távoli kurzorok színe a DS szemantikus tokenjeiből jön (`var(--…)`), mert ezek mindkét témában
 * olvashatók a névcímke szövegével (`--text-inverse`) együtt. A `--accent` kimarad: világos témában
 * a fehér felirat kontrasztja kevés rajta.
 */
const COLOR_TOKENS = ['primary', 'secondary', 'success', 'warning', 'danger', 'info'] as const;

const SAFE_COLOR = /^var\(--(?:primary|secondary|success|warning|danger|info)\)$/;
const MAX_NAME_LENGTH = 64;

/** A szín a felhasználó azonosítójából determinisztikusan választott (FNV-1a). */
export function pickCollabColor(userId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const token = COLOR_TOKENS[(hash >>> 0) % COLOR_TOKENS.length] ?? COLOR_TOKENS[0];
  return `var(--${token})`;
}

/** Az Awareness `user` mezője, amit a saját kliens kitesz. */
export function collabUser(me: { id: string; displayName: string }): CollabAwarenessUser {
  return { name: me.displayName, color: pickCollabColor(me.id) };
}

type UserState = Record<string, unknown> & {
  user?: { name?: unknown; color?: unknown; colorLight?: unknown };
};

/**
 * A másik kliens awareness-állapota nem megbízható: a `y-codemirror.next` a színt stílus-attribútumba
 * írja. Ezért csak a fenti tokenszínek mennek át (különben az alapszín), a halvány kijelölő szín
 * pedig mindig helyben számolódik; a név legfeljebb `MAX_NAME_LENGTH` karakter, és a könyvtár
 * szövegcsomópontként jeleníti meg.
 */
export function sanitizeRemoteUser(state: UserState): UserState {
  const user = state.user;
  if (!user) return state;
  const color =
    typeof user.color === 'string' && SAFE_COLOR.test(user.color) ? user.color : 'var(--secondary)';
  const name =
    typeof user.name === 'string' && user.name.trim() !== ''
      ? user.name.slice(0, MAX_NAME_LENGTH)
      : 'Névtelen';
  return {
    ...state,
    user: { name, color, colorLight: `color-mix(in srgb, ${color} 20%, transparent)` },
  };
}

/** Az awareness-objektum köré húzott szűrő: a `getStates()` már megtisztított állapotokat ad. */
export function sanitizeAwareness<T extends { getStates(): Map<number, Record<string, unknown>> }>(
  awareness: T,
): T {
  return new Proxy(awareness, {
    get(target, prop) {
      if (prop === 'getStates') {
        return () =>
          new Map(
            [...target.getStates()].map(([id, state]) => [id, sanitizeRemoteUser(state)] as const),
          );
      }
      const value: unknown = Reflect.get(target, prop);
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
    },
  });
}

/** A `/collab` WebSocket-címe: ugyanaz a host, a lap sémájától függően ws vagy wss. */
export function collabUrl(location: Pick<Location, 'protocol' | 'host'>, path: string): string {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${path}`;
}
