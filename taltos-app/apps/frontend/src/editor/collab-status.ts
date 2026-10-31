/** A felhasználónak mutatott kapcsolati állapot. */
export type CollabStatus = 'connecting' | 'connected' | 'readonly' | 'denied' | 'disconnected';

export type CollabConnection = {
  socket: 'connecting' | 'connected' | 'disconnected';
  /** A szerver által megadott jogosultság; amíg nincs hitelesítés, `null`. */
  scope: 'read-write' | 'readonly' | null;
  /** A hitelesítést a szerver elutasította (nem tag, nem létező dokumentum: ugyanaz). */
  denied: boolean;
};

export function deriveCollabStatus(c: CollabConnection): CollabStatus {
  if (c.denied) return 'denied';
  if (c.socket === 'disconnected') return 'disconnected';
  if (c.socket === 'connected' && c.scope === 'readonly') return 'readonly';
  if (c.socket === 'connected' && c.scope === 'read-write') return 'connected';
  return 'connecting';
}

/** Szerkeszthető-e a szöveg: csak élő, írási joggal hitelesített kapcsolaton. */
export function isEditable(status: CollabStatus): boolean {
  return status === 'connected';
}

/** A hitelesítési hiba semleges szövege: nem erősíti meg, hogy a dokumentum létezik. */
export const NO_ACCESS_MESSAGE = 'Nincs hozzáférésed ehhez a dokumentumhoz, vagy nem létezik.';
