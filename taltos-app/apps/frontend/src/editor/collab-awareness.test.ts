import { describe, expect, it } from 'vitest';
import {
  collabUrl,
  collabUser,
  pickCollabColor,
  sanitizeAwareness,
  sanitizeRemoteUser,
} from './collab-awareness';
import { deriveCollabStatus, isEditable } from './collab-status';

describe('pickCollabColor', () => {
  it('ugyanarra az azonosítóra mindig ugyanazt a tokenszínt adja', () => {
    expect(pickCollabColor('u-1')).toBe(pickCollabColor('u-1'));
    expect(pickCollabColor('u-1')).toMatch(/^var\(--[a-z]+\)$/);
  });

  it('különböző azonosítók több színt használnak', () => {
    const colors = new Set(Array.from({ length: 40 }, (_, i) => pickCollabColor(`user-${i}`)));
    expect(colors.size).toBeGreaterThan(3);
  });

  it('a kliens saját felhasználója név + szín', () => {
    expect(collabUser({ id: 'u-1', displayName: 'Kovács Anna' })).toEqual({
      name: 'Kovács Anna',
      color: pickCollabColor('u-1'),
    });
  });
});

describe('távoli awareness megtisztítása', () => {
  it('a tokenszínt megtartja, a halvány színt helyben számolja', () => {
    const out = sanitizeRemoteUser({ user: { name: 'Béla', color: 'var(--danger)' } });
    expect(out.user).toMatchObject({ name: 'Béla', color: 'var(--danger)' });
    expect((out.user as { colorLight: string }).colorLight).toContain('var(--danger)');
  });

  it('idegen színértéket (stílus-beszúrás) az alapszínre cserél', () => {
    for (const color of ['red; background-image: url(//evil.test/x)', 'var(--x); top:0', '#fff']) {
      const out = sanitizeRemoteUser({ user: { name: 'X', color } });
      expect((out.user as { color: string }).color).toBe('var(--secondary)');
    }
  });

  it('a hosszú nevet vágja, az üreset helyettesíti', () => {
    const long = sanitizeRemoteUser({ user: { name: 'a'.repeat(500), color: 'var(--info)' } });
    expect((long.user as { name: string }).name).toHaveLength(64);
    const empty = sanitizeRemoteUser({ user: { name: '  ', color: 'var(--info)' } });
    expect((empty.user as { name: string }).name).toBe('Névtelen');
  });

  it('a Proxy a getStates() eredményét szűri, a többi metódus a célon fut', () => {
    const states = new Map<number, Record<string, unknown>>([
      [1, { user: { name: 'A', color: 'url(x)' }, cursor: { anchor: 1 } }],
    ]);
    const target = {
      clientID: 7,
      getStates: () => states,
      ping() {
        return this.clientID;
      },
    };
    const wrapped = sanitizeAwareness(target);
    expect(wrapped.getStates().get(1)).toMatchObject({
      cursor: { anchor: 1 },
      user: { color: 'var(--secondary)' },
    });
    expect(wrapped.ping()).toBe(7);
  });
});

describe('collabUrl', () => {
  it('ugyanarra a hostra mutat, a séma a laptól függ', () => {
    expect(collabUrl({ protocol: 'http:', host: 'localhost:5173' }, '/collab')).toBe(
      'ws://localhost:5173/collab',
    );
    expect(collabUrl({ protocol: 'https:', host: 'taltos.example' }, '/collab')).toBe(
      'wss://taltos.example/collab',
    );
  });
});

describe('deriveCollabStatus', () => {
  it('a hitelesítés elutasítása mindent felülír', () => {
    expect(deriveCollabStatus({ socket: 'connected', scope: null, denied: true })).toBe('denied');
  });

  it('a kapcsolódás, az írható és az olvasható állapot elkülönül', () => {
    expect(deriveCollabStatus({ socket: 'connecting', scope: null, denied: false })).toBe(
      'connecting',
    );
    expect(deriveCollabStatus({ socket: 'connected', scope: null, denied: false })).toBe(
      'connecting',
    );
    expect(deriveCollabStatus({ socket: 'connected', scope: 'read-write', denied: false })).toBe(
      'connected',
    );
    expect(deriveCollabStatus({ socket: 'connected', scope: 'readonly', denied: false })).toBe(
      'readonly',
    );
    expect(deriveCollabStatus({ socket: 'disconnected', scope: 'read-write', denied: false })).toBe(
      'disconnected',
    );
  });

  it('csak az élő, írható kapcsolaton szerkeszthető a szöveg', () => {
    expect(isEditable('connected')).toBe(true);
    for (const s of ['connecting', 'readonly', 'denied', 'disconnected'] as const) {
      expect(isEditable(s)).toBe(false);
    }
  });
});
