import { drizzle } from 'drizzle-orm/node-postgres';
import { describe, expect, it } from 'vitest';
import { recordEvent } from './record.js';
import type { AppEvent } from './types.js';

function capture() {
  const queries: { text: string; values: unknown[] }[] = [];
  const client = {
    query(config: { text: string }, values?: unknown[]) {
      queries.push({ text: config.text, values: values ?? [] });
      return Promise.resolve({ rows: [], rowCount: 1, fields: [] });
    },
  };
  return { db: drizzle({ client: client as never }), queries };
}

describe('recordEvent', () => {
  it('egyetlen INSERT az events táblába, a mezők a helyükön, a részletek JSON-ban', async () => {
    const { db, queries } = capture();
    await recordEvent(db, {
      type: 'owner_changed',
      actorId: 'a-1',
      spaceId: 's-1',
      documentId: 'd-1',
      details: { from: 'u-1', to: 'u-2', reason: 'admin_handover' },
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]?.text).toMatch(/^insert into "events"/i);
    expect(queries[0]?.values).toEqual(
      expect.arrayContaining([
        'owner_changed',
        's-1',
        'd-1',
        'a-1',
        JSON.stringify({ from: 'u-1', to: 'u-2', reason: 'admin_handover' }),
      ]),
    );
  });

  it('a rendszerszintű esemény színtér és dokumentum nélkül megy (NULL)', async () => {
    const { db, queries } = capture();
    await recordEvent(db, {
      type: 'system_admin_granted',
      actorId: 'a-1',
      details: { userId: 'u-1' },
    });
    expect(queries[0]?.values).toContain(null);
  });

  it('aktor nélkül csak a review_withdrawn/space_closed és a reviewer_removed/allowlist_removed írható', async () => {
    const { db, queries } = capture();
    const base = { spaceId: 's', documentId: 'd', changeRequestId: 'c' } as const;
    await recordEvent(db, {
      ...base,
      type: 'review_withdrawn',
      actorId: null,
      details: { reason: 'space_closed' },
    });
    await recordEvent(db, {
      ...base,
      type: 'reviewer_removed',
      actorId: null,
      details: { reviewerId: 'u', reason: 'allowlist_removed' },
    });
    expect(queries).toHaveLength(2);

    // JS-hívó (típusellenőrzés nélkül) sem csúszhat át
    for (const bad of [
      { ...base, type: 'review_withdrawn', actorId: null, details: { reason: 'member_removed' } },
      {
        ...base,
        type: 'reviewer_removed',
        actorId: null,
        details: { reviewerId: 'u', reason: 'member_removed' },
      },
      { type: 'member_removed', spaceId: 's', actorId: null, details: { userId: 'u' } },
    ]) {
      await expect(recordEvent(db, bad as unknown as AppEvent)).rejects.toThrow(/Aktor nélküli/);
    }
    expect(queries).toHaveLength(2);
  });

  it('a részletekben nincs név, e-mail, cím vagy szöveg (D48)', async () => {
    const { db, queries } = capture();
    const poisoned = {
      type: 'member_removed',
      spaceId: 's',
      actorId: 'a',
      details: { userId: 'u', displayName: 'Kiss Anna' },
    } as unknown as AppEvent;
    await expect(recordEvent(db, poisoned)).rejects.toThrow(/személyes adat/);
    expect(queries).toHaveLength(0);
  });

  it('típusszinten: az aktor nélküli ág csak a felsorolt okot fogadja', () => {
    const ok: AppEvent = {
      type: 'review_withdrawn',
      spaceId: 's',
      documentId: 'd',
      changeRequestId: 'c',
      actorId: null,
      details: { reason: 'space_closed' },
    };
    // @ts-expect-error aktor nélkül a member_removed ok nem megengedett
    const bad: AppEvent = {
      type: 'review_withdrawn',
      spaceId: 's',
      documentId: 'd',
      changeRequestId: 'c',
      actorId: null,
      details: { reason: 'member_removed' },
    };
    const badReason: AppEvent = {
      type: 'owner_changed',
      actorId: 'a',
      spaceId: 's',
      documentId: 'd',
      // @ts-expect-error az owner_changed oka csak handover | admin_handover
      details: { from: 'u', to: 'v', reason: 'other' },
    };
    expect([ok, bad, badReason]).toHaveLength(3);
  });
});
