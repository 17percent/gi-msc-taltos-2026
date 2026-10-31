import { ACTIONS, type Action } from '@taltos/shared';
import { describe, expect, it } from 'vitest';
import {
  actorFor,
  documentFor,
  EXTRA_ROWS,
  MATRIX,
  ROLE_KEYS,
  spaceFor,
  type Outcome,
  type RoleKey,
} from './matrix.fixture.js';
import { can, scopeOf } from './policy.js';
import type { Actor, Decision, DocumentTarget, SpaceTarget } from './targets.js';

/** Egy cella kiértékelése: a művelet hatóköre dönti el, milyen célpontot kap a `can()`. */
function evaluate(
  action: Action,
  role: RoleKey,
  overrides: { space?: Partial<SpaceTarget>; document?: Partial<Omit<DocumentTarget, 'space'>> },
): Decision {
  const actor = actorFor(role);
  const scope = scopeOf(action);
  if (scope === 'system') return can(actor, action as never);
  if (scope === 'space') return can(actor, action as never, spaceFor(role, overrides.space));
  return can(actor, action as never, documentFor(role, overrides.document, overrides.space));
}

const asOutcome = (decision: Decision): Outcome => (decision.ok ? 'ok' : decision.code);

describe('jogosultsági mátrix: minden (szerep × művelet) cella', () => {
  it('a fixture minden műveletet lefed, és a cellák száma szerep × művelet', () => {
    expect(Object.keys(MATRIX).sort()).toEqual([...ACTIONS].sort());
    const cells = Object.values(MATRIX).reduce((sum, row) => sum + row.cells.length, 0);
    expect(cells).toBe(ACTIONS.length * ROLE_KEYS.length);
  });

  const rows = ACTIONS.flatMap((action) => {
    const row = MATRIX[action];
    return ROLE_KEYS.map((role, index) => ({
      action,
      role,
      line: row.line,
      expected: row.cells[index] as Outcome,
      space: 'space' in row ? row.space : undefined,
      document: 'document' in row ? row.document : undefined,
    }));
  });

  it.each(rows)('$action × $role → $expected  [$line]', (row) => {
    const actorId = actorFor(row.role).userId;
    const decision = evaluate(row.action, row.role, {
      space: row.space,
      document: row.document?.(actorId),
    });
    expect(asOutcome(decision)).toBe(row.expected);
  });
});

describe('jogosultsági mátrix: extra dimenziók (zárt tér, Általános, tulajdonos, review-er, állapot)', () => {
  it.each(EXTRA_ROWS)('$name  [$line]', (row) => {
    expect(asOutcome(evaluate(row.action, row.role, row))).toBe(row.expect);
  });
});

describe('kiértékelési sorrend', () => {
  const author: Actor = { userId: 'u-1', systemRole: 'user' };
  const closedProject = (membership: SpaceTarget['membership']): SpaceTarget => ({
    spaceId: 's',
    type: 'project',
    closed: true,
    membership,
  });

  it('nem tag előbb: a lezárt tér nem tagnak not_space_member, nem space_closed', () => {
    expect(can(author, 'space.members.add', closedProject(null))).toEqual({
      ok: false,
      code: 'not_space_member',
    });
  });

  it('a szerep a zártság előtt: lezárt térben a Szerző forbidden, nem space_closed', () => {
    expect(can(author, 'space.members.add', closedProject('author'))).toEqual({
      ok: false,
      code: 'forbidden',
    });
  });

  it('a zártság az állapot előtt: lezárt tér + Jóváhagyott szerkesztés → space_closed', () => {
    const target: DocumentTarget = {
      documentId: 'd',
      space: closedProject('author'),
      ownerId: 'x',
      archived: false,
      reviewState: 'approved',
    };
    expect(can(author, 'document.edit', target)).toEqual({ ok: false, code: 'space_closed' });
  });

  it('a Rendszeradmin-kivétel nem tartalomra szól: nem tag admin a dokumentumot sem olvassa', () => {
    const admin: Actor = { userId: 'a', systemRole: 'system_admin' };
    const space: SpaceTarget = { spaceId: 's', type: 'team', closed: false, membership: null };
    const doc: DocumentTarget = {
      documentId: 'd',
      space,
      ownerId: 'x',
      archived: false,
      reviewState: 'draft',
    };
    expect(can(admin, 'document.read', doc)).toEqual({ ok: false, code: 'not_space_member' });
    expect(can(admin, 'space.content.read', space)).toEqual({
      ok: false,
      code: 'not_space_member',
    });
  });

  it('zárt alapértelmezés: hiányzó vagy rossz típusú célpontra elutasít, nem dob', () => {
    expect(can(author, 'space.view' as never, undefined as never)).toEqual({
      ok: false,
      code: 'forbidden',
    });
    expect(can(author, 'document.read' as never, { spaceId: 's' } as never)).toEqual({
      ok: false,
      code: 'forbidden',
    });
  });

  it('tiszta: ugyanarra a bemenetre ugyanazt adja, a bemenetet nem módosítja', () => {
    const space: SpaceTarget = { spaceId: 's', type: 'team', closed: false, membership: 'author' };
    const before = JSON.stringify([author, space]);
    expect(can(author, 'space.view', space)).toEqual(can(author, 'space.view', space));
    expect(JSON.stringify([author, space])).toBe(before);
  });
});
