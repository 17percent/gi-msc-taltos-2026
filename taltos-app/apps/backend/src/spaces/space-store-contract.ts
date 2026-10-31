import { describe, expect, it } from 'vitest';
import type { SpaceRole, SpaceType } from '@taltos/shared';
import type { Actor } from '../policy/targets.js';
import type { SpaceStore } from './store.js';

/**
 * Az adapter-specifikus fixture és megfigyelés: a szerződés teszt ezen át tölti fel és olvassa a világot, így ugyanaz a
 * forgatókönyv fut a memóriabeli és a PostgreSQL-adapteren. A `StoreHarness` minden hívása friss, egyedi azonosítókat ad.
 */
export interface StoreHarness {
  store: SpaceStore;
  user(name: string, options?: { admin?: boolean; allowlisted?: boolean }): Promise<string>;
  space(options?: { type?: SpaceType; closed?: boolean }): Promise<string>;
  member(spaceId: string, userId: string, role?: SpaceRole): Promise<void>;
  document(
    spaceId: string,
    ownerId: string,
    options?: {
      archived?: boolean;
      /** Eldobott piszkozat (`deleted_at` be van állítva, jóváhagyott változat nélkül): nem létezik, D54. */
      discarded?: boolean;
      pending?: { initiatorId: string; reviewers: string[]; decided?: string[] };
    },
  ): Promise<string>;
  /** A térhez írt események sorrendben: típus, aktor, dokumentum, ok. */
  events(
    spaceId: string,
  ): Promise<{ type: string; actorId: string | null; documentId?: string; reason?: string }[]>;
  /** Egy típusú események (térhez nem kötöttek is) sorrendben: aktor és részletek. */
  eventsOfType(
    type: string,
  ): Promise<{ actorId: string | null; details: Record<string, unknown> }[]>;
  owner(documentId: string): Promise<string>;
  reviewState(documentId: string): Promise<string>;
  /** Az aktív (nem megszűnt) review-er helyek. */
  activeReviewers(documentId: string): Promise<string[]>;
  /** Tag-e (aktív tagság). */
  isMember(spaceId: string, userId: string): Promise<boolean>;
}

const NOW = new Date('2026-10-31T08:00:00Z');
const user = (userId: string): Actor => ({ userId, systemRole: 'user' });
const admin = (userId: string): Actor => ({ userId, systemRole: 'system_admin' });

/**
 * A `SpaceStore` közös szerződése (üzleti védelmek, D55/D56 szabályok, események). A HTTP-réteg és a `can()` döntés
 * nincs benne: azt a `spaces.http.test.ts` és a `policy.test.ts` fedi.
 */
export function describeSpaceStoreContract(name: string, setup: () => Promise<StoreHarness>): void {
  describe(`${name}: SpaceStore-szerződés`, () => {
    it('removeMember: az utolsó aktív Színtérgazda védett, másik gazdával eltávolítható', async () => {
      const h = await setup();
      const [m1, m2, a] = [await h.user('m1'), await h.user('m2'), await h.user('a')];
      const space = await h.space();
      await h.member(space, m1, 'space_manager');
      await h.member(space, a);
      expect(await h.store.removeMember(user(m1), space, m1, NOW)).toMatchObject({
        ok: false,
        code: 'last_space_manager',
      });
      await h.member(space, m2, 'space_manager');
      expect((await h.store.removeMember(user(m1), space, m1, NOW)).ok).toBe(true);
      expect(await h.isMember(space, m1)).toBe(false);
    });

    it('removeMember: a kizárt allowlist-címűt nem számoljuk pótló gazdának', async () => {
      const h = await setup();
      const m1 = await h.user('m1');
      const ghost = await h.user('ghost', { allowlisted: false });
      const space = await h.space();
      await h.member(space, m1, 'space_manager');
      await h.member(space, ghost, 'space_manager');
      expect(await h.store.removeMember(user(m1), space, m1, NOW)).toMatchObject({
        ok: false,
        code: 'last_space_manager',
      });
    });

    it('removeMember: az archiválatlan dokumentum tulajdonosa 409, az csak archiváltaké eltávolítható', async () => {
      const h = await setup();
      const [m, a, b] = [await h.user('m'), await h.user('a'), await h.user('b')];
      const space = await h.space();
      await h.member(space, m, 'space_manager');
      await h.member(space, a);
      await h.member(space, b);
      await h.document(space, a);
      await h.document(space, b, { archived: true });
      expect(await h.store.removeMember(user(m), space, a, NOW)).toMatchObject({
        ok: false,
        code: 'owner_handover_required',
      });
      expect((await h.store.removeMember(user(m), space, b, NOW)).ok).toBe(true);
    });

    it('removeMember: az Általánosból nem lehet, a nem tag 404, a lezárt térben csak a Rendszeradmin', async () => {
      const h = await setup();
      const [m, a, root] = [
        await h.user('m'),
        await h.user('a'),
        await h.user('root', { admin: true }),
      ];
      const general = await h.space({ type: 'general' });
      await h.member(general, m, 'space_manager');
      await h.member(general, a);
      expect(await h.store.removeMember(admin(root), general, a, NOW)).toMatchObject({
        ok: false,
        code: 'forbidden',
      });
      const closed = await h.space({ closed: true });
      await h.member(closed, m, 'space_manager');
      await h.member(closed, a);
      expect(await h.store.removeMember(user(m), closed, a, NOW)).toMatchObject({
        ok: false,
        code: 'space_closed',
      });
      expect((await h.store.removeMember(admin(root), closed, a, NOW)).ok).toBe(true);
      expect(await h.store.removeMember(admin(root), closed, a, NOW)).toMatchObject({
        ok: false,
        code: 'not_found',
      });
    });

    it('removeMember: az indítványozó kérése visszavonódik (member_removed, aktor az eltávolító), a review-er helye megszűnik (a döntötté is)', async () => {
      const h = await setup();
      const [m, init, r1, r2] = [
        await h.user('m'),
        await h.user('init'),
        await h.user('r1'),
        await h.user('r2'),
      ];
      const space = await h.space();
      for (const u of [init, r1, r2]) await h.member(space, u);
      await h.member(space, m, 'space_manager');
      // 1. dokumentum: init az indítványozó → a kérés visszavonódik
      const d1 = await h.document(space, m, {
        pending: { initiatorId: init, reviewers: [r1, r2] },
      });
      // 2. dokumentum: r1 megjelölt (nem döntött), r2 már döntött
      const d2 = await h.document(space, m, {
        pending: { initiatorId: m, reviewers: [r1, r2], decided: [r2] },
      });
      expect((await h.store.removeMember(user(m), space, init, NOW)).ok).toBe(true);
      expect(await h.reviewState(d1)).toBe('draft');
      expect((await h.store.removeMember(user(m), space, r1, NOW)).ok).toBe(true);
      expect(await h.activeReviewers(d2)).toEqual([r2]);
      expect(await h.reviewState(d2)).toBe('pending');

      const log = await h.events(space);
      expect(log).toContainEqual(
        expect.objectContaining({
          type: 'review_withdrawn',
          actorId: m,
          documentId: d1,
          reason: 'member_removed',
        }),
      );
      expect(log).toContainEqual(
        expect.objectContaining({
          type: 'reviewer_removed',
          actorId: m,
          documentId: d2,
          reason: 'member_removed',
        }),
      );
      // a döntött review-er (r2) helye is megszűnik, a döntése elvész; az esemény is megíródik
      expect((await h.store.removeMember(user(m), space, r2, NOW)).ok).toBe(true);
      expect(await h.activeReviewers(d2)).toEqual([]);
      expect((await h.events(space)).filter((e) => e.type === 'reviewer_removed')).toHaveLength(2);
      // r1 a d1-en is megjelölt volt, de a kérés már vissza volt vonva: ott nem keletkezik új esemény
      expect(log.filter((e) => e.type === 'reviewer_removed')).toHaveLength(1);
    });

    it('changeRole: az utolsó gazda nem minősíthető vissza, előléptetés után igen; role_changed esemény', async () => {
      const h = await setup();
      const [m, a] = [await h.user('m'), await h.user('a')];
      const space = await h.space();
      await h.member(space, m, 'space_manager');
      await h.member(space, a);
      expect(await h.store.changeRole(user(m), space, m, 'author', NOW)).toMatchObject({
        ok: false,
        code: 'last_space_manager',
      });
      expect((await h.store.changeRole(user(m), space, a, 'space_manager', NOW)).ok).toBe(true);
      expect((await h.store.changeRole(user(m), space, m, 'author', NOW)).ok).toBe(true);
      expect((await h.events(space)).filter((e) => e.type === 'role_changed')).toHaveLength(2);
    });

    it('addMember: önfelvétel lezárt térben a Rendszeradminnak, újrapróbálás nem ír, nem allowlistes 400', async () => {
      const h = await setup();
      const [m, root, ghost] = [
        await h.user('m'),
        await h.user('root', { admin: true }),
        await h.user('ghost', { allowlisted: false }),
      ];
      const space = await h.space({ closed: true });
      await h.member(space, m, 'space_manager');
      expect(
        (await h.store.addMember(admin(root), space, { userId: root, role: 'space_manager' }, NOW))
          .ok,
      ).toBe(true);
      expect(
        (await h.store.addMember(admin(root), space, { userId: root, role: 'space_manager' }, NOW))
          .ok,
      ).toBe(true);
      expect((await h.events(space)).filter((e) => e.type === 'member_added')).toHaveLength(1);
      expect(
        await h.store.addMember(user(m), space, { userId: ghost, role: 'author' }, NOW),
      ).toMatchObject({
        ok: false,
        code: 'space_closed',
      });
      const open = await h.space();
      expect(
        await h.store.addMember(admin(root), open, { userId: ghost, role: 'author' }, NOW),
      ).toMatchObject({
        ok: false,
        code: 'validation_error',
      });
    });

    it('closeSpace: csak projekt-tér, a függő kérések aktor nélkül visszavonódnak, az ismétlés idempotens', async () => {
      const h = await setup();
      const [m, init, r1, r2, root] = [
        await h.user('m'),
        await h.user('init'),
        await h.user('r1'),
        await h.user('r2'),
        await h.user('root', { admin: true }),
      ];
      const team = await h.space();
      expect(await h.store.closeSpace(admin(root), team, NOW)).toMatchObject({
        ok: false,
        code: 'forbidden',
      });
      const project = await h.space({ type: 'project' });
      for (const u of [init, r1, r2]) await h.member(project, u);
      await h.member(project, m, 'space_manager');
      const doc = await h.document(project, m, {
        pending: { initiatorId: init, reviewers: [r1, r2] },
      });
      const closed = await h.store.closeSpace(admin(root), project, NOW);
      expect(closed).toEqual({ ok: true, value: { alreadyClosed: false, withdrawnRequests: 1 } });
      expect(await h.reviewState(doc)).toBe('draft');
      expect(await h.activeReviewers(doc)).toEqual([]);
      expect((await h.events(project)).filter((e) => e.type === 'review_withdrawn')).toEqual([
        expect.objectContaining({ actorId: null, documentId: doc, reason: 'space_closed' }),
      ]);
      expect(await h.store.closeSpace(admin(root), project, NOW)).toEqual({
        ok: true,
        value: { alreadyClosed: true, withdrawnRequests: 0 },
      });
      expect((await h.events(project)).filter((e) => e.type === 'space_closed')).toHaveLength(1);
      expect(
        await h.store.closeSpace(admin(root), await h.space({ type: 'general' }), NOW),
      ).toMatchObject({
        code: 'forbidden',
      });
    });

    it('adminHandover: a tér összes (archivált is) dokumentuma az új tagra, dokumentumonként egy esemény; 422 nem tagra és azonosra', async () => {
      const h = await setup();
      const [a, b, outsider, root] = [
        await h.user('a'),
        await h.user('b'),
        await h.user('o'),
        await h.user('root', { admin: true }),
      ];
      const space = await h.space({ closed: true });
      const other = await h.space();
      await h.member(space, a);
      await h.member(space, b);
      const d1 = await h.document(space, a);
      const d2 = await h.document(space, a, { archived: true });
      const d3 = await h.document(other, a);
      const d4 = await h.document(space, a, { discarded: true });
      expect(
        await h.store.adminHandover(
          admin(root),
          { userId: a, spaceId: space, newOwnerId: outsider },
          NOW,
        ),
      ).toMatchObject({ ok: false, code: 'invalid_new_owner' });
      expect(
        await h.store.adminHandover(admin(root), { userId: a, spaceId: space, newOwnerId: a }, NOW),
      ).toMatchObject({ ok: false, code: 'invalid_new_owner' });
      expect(
        await h.store.adminHandover(admin(root), { userId: a, spaceId: space, newOwnerId: b }, NOW),
      ).toEqual({ ok: true, value: { movedDocuments: 2 } });
      expect(await h.owner(d1)).toBe(b);
      expect(await h.owner(d2)).toBe(b);
      expect(await h.owner(d3)).toBe(a);
      expect(await h.owner(d4)).toBe(a); // az eldobott piszkozat nem létezik (D54): nem mozog, nem számít
      const changed = (await h.events(space)).filter((e) => e.type === 'owner_changed');
      expect(changed.map((e) => e.documentId).sort()).toEqual([d1, d2].sort());
      for (const e of changed) expect(e).toMatchObject({ actorId: root, reason: 'admin_handover' });
    });

    it('transferOwnership: tulajdonos vagy gazda, 422 nem tagra és azonosra, lezárt térben space_closed, archiváltra is', async () => {
      const h = await setup();
      const [m, a, b, c] = [
        await h.user('m'),
        await h.user('a'),
        await h.user('b'),
        await h.user('c'),
      ];
      const space = await h.space();
      await h.member(space, m, 'space_manager');
      await h.member(space, a);
      await h.member(space, b);
      const doc = await h.document(space, a);
      const archived = await h.document(space, a, { archived: true });
      const input = (documentId: string, newOwnerId: string) => ({ documentId, newOwnerId });
      expect(await h.store.transferOwnership(user(b), input(doc, b), NOW)).toMatchObject({
        code: 'forbidden',
      });
      expect(await h.store.transferOwnership(user(a), input(doc, c), NOW)).toMatchObject({
        code: 'invalid_new_owner',
      });
      expect(await h.store.transferOwnership(user(a), input(doc, a), NOW)).toMatchObject({
        code: 'invalid_new_owner',
      });
      expect((await h.store.transferOwnership(user(a), input(doc, b), NOW)).ok).toBe(true);
      expect(await h.owner(doc)).toBe(b);
      expect((await h.store.transferOwnership(user(m), input(archived, b), NOW)).ok).toBe(true);
      const closed = await h.space({ closed: true });
      await h.member(closed, a);
      await h.member(closed, b);
      const closedDoc = await h.document(closed, a);
      expect(await h.store.transferOwnership(user(a), input(closedDoc, b), NOW)).toMatchObject({
        code: 'space_closed',
      });
      // elavult jogosultság: aki közben kikerült a térből (volt gazda / volt tulajdonos), már nem adhat át
      const gone = await h.user('gone');
      const orphan = await h.document(space, gone, { archived: true });
      expect(await h.store.transferOwnership(user(gone), input(orphan, b), NOW)).toMatchObject({
        code: 'forbidden',
      });
      expect(await h.store.transferOwnership(user(c), input(doc, c), NOW)).toMatchObject({
        code: 'forbidden',
      });
      expect(
        await h.store.transferOwnership(
          user(a),
          input('00000000-0000-4000-8000-000000000000', b),
          NOW,
        ),
      ).toMatchObject({ code: 'not_found' });
    });

    it('createMembershipRequest: egy függő kérés térenként és felhasználónként; tag, admin, lezárt tér elutasítva', async () => {
      const h = await setup();
      const [m, a, o, root] = [
        await h.user('m'),
        await h.user('a'),
        await h.user('o'),
        await h.user('root', { admin: true }),
      ];
      const space = await h.space();
      await h.member(space, m, 'space_manager');
      await h.member(space, a);
      const via = '11111111-1111-4111-8111-111111111111';
      const first = await h.store.createMembershipRequest(
        user(o),
        space,
        { viaDocumentId: via },
        NOW,
      );
      expect(first).toMatchObject({ ok: true, value: { state: 'pending' } });
      expect(await h.store.createMembershipRequest(user(o), space, {}, NOW)).toMatchObject({
        ok: false,
        code: 'request_pending',
      });
      expect(await h.store.createMembershipRequest(user(a), space, {}, NOW)).toMatchObject({
        code: 'forbidden',
      });
      expect(await h.store.createMembershipRequest(admin(root), space, {}, NOW)).toMatchObject({
        code: 'forbidden',
      });
      const closed = await h.space({ closed: true });
      expect(await h.store.createMembershipRequest(user(o), closed, {}, NOW)).toMatchObject({
        code: 'space_closed',
      });
      const logged = await h.eventsOfType('membership_requested');
      expect(logged).toHaveLength(1);
      expect(logged[0]?.details).toEqual({
        requestId: first.ok ? first.value.id : '',
        viaDocumentId: via,
      });
    });

    it('decideMembershipRequest: jóváhagyás tagot és eseményt ad, az újabb döntés request_closed, az elutasított újra kérhet', async () => {
      const h = await setup();
      const [m, o1, o2] = [await h.user('m'), await h.user('o1'), await h.user('o2')];
      const space = await h.space();
      await h.member(space, m, 'space_manager');
      const r1 = await h.store.createMembershipRequest(user(o1), space, {}, NOW);
      const r2 = await h.store.createMembershipRequest(user(o2), space, {}, NOW);
      if (!r1.ok || !r2.ok) throw new Error('a kérés nem jött létre');
      expect(await h.store.getMembershipRequest(r1.value.id)).toEqual({
        spaceId: space,
        state: 'pending',
      });
      expect(
        await h.store.decideMembershipRequest(user(m), r1.value.id, { approve: true }, NOW),
      ).toEqual({
        ok: true,
        value: { id: r1.value.id, state: 'approved', spaceId: space, role: 'author' },
      });
      expect(await h.isMember(space, o1)).toBe(true);
      expect(
        await h.store.decideMembershipRequest(user(m), r1.value.id, { approve: false }, NOW),
      ).toMatchObject({ ok: false, code: 'request_closed' });
      expect(
        await h.store.decideMembershipRequest(
          user(m),
          r2.value.id,
          { approve: true, role: 'space_manager' },
          NOW,
        ),
      ).toMatchObject({ ok: true, value: { role: 'space_manager' } });
      expect(
        await h.store.decideMembershipRequest(
          user(m),
          '00000000-0000-4000-8000-000000000000',
          { approve: true },
          NOW,
        ),
      ).toMatchObject({ code: 'not_found' });
      const events = await h.events(space);
      expect(events.map((e) => e.type)).toEqual([
        'membership_requested',
        'membership_requested',
        'member_added',
        'membership_request_decided',
        'member_added',
        'membership_request_decided',
      ]);
      // elutasítás: nincs tagság, utána új kérés adható
      const o3 = await h.user('o3');
      const r3 = await h.store.createMembershipRequest(user(o3), space, {}, NOW);
      if (!r3.ok) throw new Error('a kérés nem jött létre');
      expect(
        await h.store.decideMembershipRequest(user(m), r3.value.id, { approve: false }, NOW),
      ).toMatchObject({ ok: true, value: { state: 'rejected' } });
      expect(await h.isMember(space, o3)).toBe(false);
      expect((await h.store.createMembershipRequest(user(o3), space, {}, NOW)).ok).toBe(true);
    });

    it('decideMembershipRequest: lezárt térben csak a Rendszeradmin dönthet, a gazda space_closed', async () => {
      const h = await setup();
      const [m, o, root] = [
        await h.user('m'),
        await h.user('o'),
        await h.user('root', { admin: true }),
      ];
      const space = await h.space({ type: 'project' });
      await h.member(space, m, 'space_manager');
      const request = await h.store.createMembershipRequest(user(o), space, {}, NOW);
      if (!request.ok) throw new Error('a kérés nem jött létre');
      // a kérés függő, a tér utólag záródik le
      const closing = await h.store.closeSpace(admin(root), space, NOW);
      expect(closing.ok).toBe(true);
      expect(
        await h.store.decideMembershipRequest(user(m), request.value.id, { approve: true }, NOW),
      ).toMatchObject({ ok: false, code: 'space_closed' });
      expect(await h.isMember(space, o)).toBe(false);
      expect(
        (
          await h.store.decideMembershipRequest(
            admin(root),
            request.value.id,
            { approve: true },
            NOW,
          )
        ).ok,
      ).toBe(true);
      expect(await h.isMember(space, o)).toBe(true);
    });

    it('decideMembershipRequest: a kizárt allowlist-címűt nem vesszük fel (validation_error), a kérés függő marad', async () => {
      const h = await setup();
      const [m, ghost] = [await h.user('m'), await h.user('ghost', { allowlisted: false })];
      const space = await h.space();
      await h.member(space, m, 'space_manager');
      const request = await h.store.createMembershipRequest(user(ghost), space, {}, NOW);
      if (!request.ok) throw new Error('a kérés nem jött létre');
      expect(
        await h.store.decideMembershipRequest(user(m), request.value.id, { approve: true }, NOW),
      ).toMatchObject({ ok: false, code: 'validation_error' });
      expect(await h.store.getMembershipRequest(request.value.id)).toMatchObject({
        state: 'pending',
      });
      expect(await h.isMember(space, ghost)).toBe(false);
    });

    it('createSpaceRequest + decideSpaceRequest: a jóváhagyás project teret, kezdeti gazdát és eseményeket ad egy lépésben', async () => {
      const h = await setup();
      const [req, mgr, root] = [
        await h.user('req'),
        await h.user('mgr'),
        await h.user('root', { admin: true }),
      ];
      const created = await h.store.createSpaceRequest(
        user(req),
        { name: 'Projekt Hold', purpose: 'Cél', proposedManagerId: mgr },
        NOW,
      );
      if (!created.ok) throw new Error('a kérés nem jött létre');
      expect(created.value.state).toBe('pending');
      const decided = await h.store.decideSpaceRequest(
        admin(root),
        created.value.id,
        { approve: true, color: '#2E8B6F' },
        NOW,
      );
      if (!decided.ok || decided.value.spaceId === undefined) throw new Error('a döntés elbukott');
      const spaceId = decided.value.spaceId;
      const space = await h.store.getSpace(spaceId);
      expect(space).toMatchObject({
        name: 'Projekt Hold',
        type: 'project',
        description: 'Cél',
        color: '#2E8B6F',
        closed: false,
        memberCount: 1,
      });
      expect(space?.managers.map((u) => u.id)).toEqual([mgr]);
      expect(await h.isMember(spaceId, mgr)).toBe(true);
      expect((await h.events(spaceId)).map((e) => e.type)).toEqual([
        'space_created',
        'space_manager_assigned',
      ]);
      const decisions = await h.eventsOfType('space_request_decided');
      expect(decisions).toEqual([
        {
          actorId: root,
          details: { requestId: created.value.id, approved: true, spaceId },
        },
      ]);
      expect((await h.eventsOfType('space_requested'))[0]?.actorId).toBe(req);
      expect(
        await h.store.decideSpaceRequest(admin(root), created.value.id, { approve: false }, NOW),
      ).toMatchObject({ ok: false, code: 'request_closed' });
    });

    it('decideSpaceRequest: hiba esetén (foglalt név) semmi nem íródik és a kérés függő marad; az elutasítás nem hoz létre teret', async () => {
      const h = await setup();
      const [req, mgr, root] = [
        await h.user('req'),
        await h.user('mgr'),
        await h.user('root', { admin: true }),
      ];
      expect(
        await h.store.createSpaceRequest(
          user(req),
          { name: 'X', purpose: '', proposedManagerId: '00000000-0000-4000-8000-000000000000' },
          NOW,
        ),
      ).toMatchObject({ ok: false, code: 'validation_error' });
      const taken = await h.store.createSpace(
        admin(root),
        { name: 'Foglalt', type: 'team', description: '', color: '#3B6FB6', initialManagerId: mgr },
        NOW,
      );
      expect(taken.ok).toBe(true);
      const dup = await h.store.createSpaceRequest(
        user(req),
        { name: 'foglalt', purpose: 'Cél', proposedManagerId: mgr },
        NOW,
      );
      if (!dup.ok) throw new Error('a kérés nem jött létre');
      expect(
        await h.store.decideSpaceRequest(
          admin(root),
          dup.value.id,
          { approve: true, color: '#2E8B6F' },
          NOW,
        ),
      ).toMatchObject({ ok: false, code: 'validation_error' });
      expect(await h.eventsOfType('space_created')).toHaveLength(1);
      expect(await h.eventsOfType('space_request_decided')).toEqual([]);
      // a függő kérés a hiba után is eldönthető; az elutasítás nem hoz létre teret
      expect(
        await h.store.decideSpaceRequest(admin(root), dup.value.id, { approve: false }, NOW),
      ).toEqual({ ok: true, value: { id: dup.value.id, state: 'rejected' } });
      expect(await h.eventsOfType('space_created')).toHaveLength(1);
      expect(
        (await h.eventsOfType('space_request_decided')).map((e) => e.details.approved),
      ).toEqual([false]);
    });

    it('changeSystemRole: az utolsó (aktív allowlistes) admin védett; a kizárt címűt nem számoljuk pótlónak', async () => {
      const h = await setup();
      const root = await h.user('root', { admin: true });
      const second = await h.user('second', { admin: true, allowlisted: false });
      expect(await h.store.changeSystemRole(admin(root), root, 'user', NOW)).toMatchObject({
        ok: false,
        code: 'last_admin',
      });
      const third = await h.user('third', { admin: true });
      expect((await h.store.changeSystemRole(admin(root), second, 'user', NOW)).ok).toBe(true);
      expect((await h.store.changeSystemRole(admin(root), root, 'user', NOW)).ok).toBe(true);
      expect(await h.store.changeSystemRole(admin(third), third, 'user', NOW)).toMatchObject({
        code: 'last_admin',
      });
    });

    it('searchUsers: csak az aktív allowlistesek, szó szerinti keresés (%, _), legfeljebb a korlát, csak id/név/avatar', async () => {
      const h = await setup();
      for (let i = 0; i < 12; i += 1) await h.user(`kereső${String(i).padStart(2, '0')}`);
      await h.user('kereső-kizárt', { allowlisted: false });
      await h.user('szazalek%jel');
      const found = await h.store.searchUsers('kereső', 10);
      expect(found).toHaveLength(10);
      expect(found.map((u) => u.displayName)).not.toContain('kereső-kizárt');
      expect(Object.keys(found[0] ?? {}).sort()).toEqual(['avatarUrl', 'displayName', 'id']);
      expect(await h.store.searchUsers('%%', 10)).toEqual([]);
      expect(await h.store.searchUsers('__', 10)).toEqual([]);
      expect((await h.store.searchUsers('zalek%j', 10)).map((u) => u.displayName)).toEqual([
        'szazalek%jel',
      ]);
    });
  });
}
