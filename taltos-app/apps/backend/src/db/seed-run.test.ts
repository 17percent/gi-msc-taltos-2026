import type pg from 'pg';
import { loadModule, parse } from 'libpg-query';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildSeedPlan } from './seed-data.js';
import { runSeed } from './seed-run.js';

/**
 * A seed végrehajtója adatbázis NÉLKÜL: egy felvevő (nem valódi) kapcsolatkészlet rögzíti a kiadott SQL-t.
 * Ellenőrzi, hogy a futás hiba nélkül végigmegy, minden kiadott utasítás átmegy a Postgres parserén, a tranzakciók
 * kiegyensúlyozottak, és a seed soha nem törlöl és nem TRUNCATE-el (az app-szerepkör sem tehetné).
 * A tényleges viselkedést a TEST_DATABASE_URL-es integrációs teszt igazolja.
 */
interface Recorded {
  text: string;
}

function recordingPool(existingUsers: number): { pool: pg.Pool; log: Recorded[] } {
  const log: Recorded[] = [];
  let id = 0;
  const query = (config: unknown, values?: unknown[]): Promise<unknown> => {
    const c = (typeof config === 'string' ? { text: config, values } : config) as {
      text: string;
      rowMode?: string;
    };
    log.push({ text: c.text });
    const row = (value: Record<string, unknown>): unknown => ({
      rows: c.rowMode === 'array' ? [Object.values(value)] : [value],
      rowCount: 1,
      fields: [],
    });
    if (/select count\(\*\)/i.test(c.text)) return Promise.resolve(row({ n: existingUsers }));
    if (/returning "id"/i.test(c.text)) return Promise.resolve(row({ id: ++id }));
    return Promise.resolve({ rows: [], rowCount: 1, fields: [] });
  };
  const client = { query, release: () => undefined };
  const pool = { query, connect: () => Promise.resolve(client) };
  return { pool: pool as unknown as pg.Pool, log };
}

beforeAll(async () => {
  await loadModule();
});

describe('seed-végrehajtó (kapcsolat nélkül)', () => {
  it('nem üres adatbázison megtagadja a futást, és semmit nem ír', async () => {
    const { pool, log } = recordingPool(3);
    await expect(runSeed(pool)).rejects.toThrow('nem üres');
    expect(log.some((l) => /^(insert|update|delete)/i.test(l.text))).toBe(false);
  });

  it('végigfut; minden utasítás parse-olható; nincs DELETE/TRUNCATE; a tranzakciók kiegyensúlyozottak', async () => {
    const plan = buildSeedPlan();
    const { pool, log } = recordingPool(0);
    const result = await runSeed(pool, plan);
    expect(result.documents).toBe(plan.docs.length);

    const texts = log.map((l) => l.text);
    expect(texts.filter((t) => t === 'begin')).toHaveLength(
      texts.filter((t) => t === 'commit').length,
    );
    expect(texts.some((t) => /^\s*(delete|truncate)/i.test(t))).toBe(false);
    for (const text of new Set(texts)) {
      await expect(parse(text), text).resolves.toBeDefined();
    }

    const requests = texts.filter((t) => t.startsWith('insert into "change_requests"')).length;
    expect(requests).toBe(plan.docs.flatMap((d) => d.steps.filter((s) => s.t === 'submit')).length);
    // A beküldés sorrendje: kérés, majd review-erek, majd a dokumentum Review-ra vár állapota (B4 S7, S13).
    const firstCr = texts.findIndex((t) => t.startsWith('insert into "change_requests"'));
    expect(texts[firstCr + 1]).toMatch(/^insert into "change_request_reviewers"/);
  });
});
