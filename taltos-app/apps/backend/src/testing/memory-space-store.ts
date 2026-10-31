import { randomUUID } from 'node:crypto';
import type {
  AdminUser,
  CreateMembershipRequest,
  CreateSpaceRequestRequest,
  MembershipDecisionResult,
  MembershipRequestDecision,
  RequestCreated,
  RequestState,
  SpaceRequestDecision,
  SpaceRequestDecisionResult,
  SpaceColor,
  SpaceDetail,
  SpaceMember,
  SpaceRole,
  SpaceSummary,
  SystemRole,
  UserRef,
} from '@taltos/shared';
import { validateEvent } from '../events/record.js';
import type { AppEvent } from '../events/types.js';
import { isSystemAdmin } from '../policy/policy.js';
import type { Actor } from '../policy/targets.js';
import { fail, ok, type SpaceStore, type StoreResult } from '../spaces/store.js';
import type { MemoryAccessStore } from './memory-access-store.js';
import type { MemoryAuthStore } from './memory-store.js';

/** A memóriabeli tár `ReviewService`-szerű hatásainak nyoma (a teszteknek: mi történt a kéréssel és a hellyel). */
export interface MemoryRequestOutcome {
  documentId: string;
  state: 'withdrawn';
  reason: 'space_closed' | 'member_removed';
}

/**
 * Memóriabeli `SpaceStore` az adatbázis nélküli tesztekhez. Egy világon (`MemoryAccessStore`) és az auth-tár
 * felhasználóin dolgozik, a PostgreSQL-megvalósítással azonos szerződés szerint (eredmény-unió, események,
 * a zár alatti újraellenőrzések sorrendje). A tényleges SQL-t, a zárakat és a tranzakciós atomicitást a
 * PostgreSQL elleni integrációs teszt bizonyítja.
 */
export class MemorySpaceStore implements SpaceStore {
  /** A rögzített események (a PostgreSQL-ben az `events` tábla sorai). */
  readonly events: AppEvent[] = [];
  readonly outcomes: MemoryRequestOutcome[] = [];
  /** A felvételi és a projekt-tér kérései (a PostgreSQL-ben a `membership_requests` és a `space_requests` sorai). */
  readonly membershipRequests = new Map<
    string,
    { spaceId: string; userId: string; state: RequestState }
  >();
  readonly spaceRequests = new Map<
    string,
    { name: string; purpose: string; proposedManagerId: string; state: RequestState }
  >();

  constructor(
    private readonly world: MemoryAccessStore,
    private readonly auth: MemoryAuthStore,
  ) {
    world.userResolver = (id) => this.userRef(id);
  }

  private emit(...events: AppEvent[]): void {
    for (const event of events) {
      validateEvent(event);
      this.events.push(event);
    }
  }

  private userRef(id: string): UserRef | undefined {
    const user = this.auth.users.get(id);
    return user && { id, displayName: user.displayName, avatarUrl: user.avatarUrl };
  }

  /** Aktív allowlist-bejegyzéssel rendelkező (belépni képes) felhasználó. */
  private isActiveUser(id: string): boolean {
    const user = this.auth.users.get(id);
    return user !== undefined && this.auth.allowlist.has(user.email.toLowerCase());
  }

  private role(spaceId: string, userId: string): SpaceRole | undefined {
    const m = this.world.members.get(`${spaceId}:${userId}`);
    return m && !m.removed ? m.role : undefined;
  }

  /** Az `otherActiveManagerExists` párja. */
  private otherActiveManager(spaceId: string, excludeUserId: string): boolean {
    return [...this.world.members.entries()].some(([key, m]) => {
      const [sid, uid] = key.split(':') as [string, string];
      return (
        sid === spaceId &&
        uid !== excludeUserId &&
        m.role === 'space_manager' &&
        !m.removed &&
        this.isActiveUser(uid)
      );
    });
  }

  private summary(id: string): SpaceSummary | undefined {
    const space = this.world.spaces.get(id);
    if (!space || space.deleted) return undefined;
    return {
      id,
      name: space.name,
      type: space.type,
      description: space.description ?? '',
      color: (space.color ?? '#3B6FB6') as SpaceColor,
      closed: space.closed,
    };
  }

  private activeMembers(spaceId: string): { userId: string; role: SpaceRole }[] {
    return [...this.world.members.entries()]
      .filter(([key, m]) => key.startsWith(`${spaceId}:`) && !m.removed)
      .map(([key, m]) => ({ userId: key.slice(spaceId.length + 1), role: m.role }));
  }

  private member(spaceId: string, userId: string): SpaceMember {
    const user = this.userRef(userId) ?? { id: userId, displayName: userId, avatarUrl: null };
    return { user, role: this.role(spaceId, userId) as SpaceRole };
  }

  private detail(id: string): SpaceDetail | undefined {
    const summary = this.summary(id);
    if (!summary) return undefined;
    const members = this.activeMembers(id);
    return {
      ...summary,
      managers: members
        .filter((m) => m.role === 'space_manager')
        .map((m) => this.userRef(m.userId))
        .filter((u): u is UserRef => u !== undefined)
        .sort(byName),
      memberCount: members.length,
    };
  }

  private nameTaken(name: string, exceptId?: string): boolean {
    return [...this.world.spaces.entries()].some(
      ([id, s]) => id !== exceptId && s.name.toLowerCase() === name.toLowerCase(),
    );
  }

  listSpaces(actor: Actor): Promise<SpaceSummary[]> {
    const rows = [...this.world.spaces.keys()]
      .filter((id) => isSystemAdmin(actor) || this.role(id, actor.userId) !== undefined)
      .map((id) => this.summary(id))
      .filter((s): s is SpaceSummary => s !== undefined)
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return Promise.resolve(rows);
  }

  getSpace(spaceId: string): Promise<SpaceDetail | undefined> {
    return Promise.resolve(this.detail(spaceId));
  }

  listMembers(spaceId: string): Promise<SpaceMember[]> {
    return Promise.resolve(
      this.activeMembers(spaceId)
        .map((m) => this.member(spaceId, m.userId))
        .sort((a, b) => byName(a.user, b.user)),
    );
  }

  createSpace(
    actor: Actor,
    input: Parameters<SpaceStore['createSpace']>[1],
  ): Promise<StoreResult<SpaceDetail>> {
    if (!this.isActiveUser(input.initialManagerId)) {
      return Promise.resolve(fail('validation_error', 'A kezdeti Színtérgazda nem található.'));
    }
    if (this.nameTaken(input.name)) {
      return Promise.resolve(fail('validation_error', 'Ilyen nevű színtér már van.'));
    }
    const spaceId = randomUUID();
    this.world.addSpace(spaceId, input.name, {
      type: input.type,
      description: input.description,
      color: input.color,
    });
    this.world.addMember(spaceId, input.initialManagerId, 'space_manager');
    this.emit(
      {
        type: 'space_created',
        spaceId,
        actorId: actor.userId,
        details: { type: input.type, initialManagerId: input.initialManagerId },
      },
      {
        type: 'space_manager_assigned',
        spaceId,
        actorId: actor.userId,
        details: { userId: input.initialManagerId },
      },
    );
    return Promise.resolve(ok(this.detail(spaceId) as SpaceDetail));
  }

  updateSpace(
    actor: Actor,
    spaceId: string,
    patch: Parameters<SpaceStore['updateSpace']>[2],
  ): Promise<StoreResult<SpaceDetail>> {
    const space = this.world.spaces.get(spaceId);
    if (!space || space.deleted) return Promise.resolve(fail('not_found'));
    if (space.closed) return Promise.resolve(fail('space_closed'));
    if (patch.name !== undefined && this.nameTaken(patch.name, spaceId)) {
      return Promise.resolve(fail('validation_error', 'Ilyen nevű színtér már van.'));
    }
    if (patch.name !== undefined) space.name = patch.name;
    if (patch.description !== undefined) space.description = patch.description;
    if (patch.color !== undefined) space.color = patch.color;
    const fields = (['name', 'description', 'color'] as const).filter(
      (k) => patch[k] !== undefined,
    );
    this.emit({ type: 'space_updated', spaceId, actorId: actor.userId, details: { fields } });
    return Promise.resolve(ok(this.detail(spaceId) as SpaceDetail));
  }

  closeSpace(
    actor: Actor,
    spaceId: string,
  ): Promise<StoreResult<{ alreadyClosed: boolean; withdrawnRequests: number }>> {
    const space = this.world.spaces.get(spaceId);
    if (!space || space.deleted) return Promise.resolve(fail('not_found'));
    if (space.type !== 'project') return Promise.resolve(fail('forbidden'));
    if (space.closed) return Promise.resolve(ok({ alreadyClosed: true, withdrawnRequests: 0 }));
    space.closed = true;
    const withdrawn = this.withdraw(spaceId, () => true, 'space_closed', null);
    this.emit({
      type: 'space_closed',
      spaceId,
      actorId: actor.userId,
      details: { withdrawnRequests: withdrawn },
    });
    return Promise.resolve(ok({ alreadyClosed: false, withdrawnRequests: withdrawn }));
  }

  /** A `withdrawAllInSpace` / `withdrawForInitiator` párja: pending → withdrawn, a dokumentum draft, esemény kérésenként. */
  private withdraw(
    spaceId: string,
    match: (initiatorId: string) => boolean,
    reason: 'space_closed' | 'member_removed',
    actorId: string | null,
  ): number {
    let count = 0;
    for (const [documentId, doc] of this.world.documents) {
      if (doc.spaceId !== spaceId || !doc.pending || !match(doc.pending.initiatorId)) continue;
      const changeRequestId = doc.pending.id ?? randomUUID();
      delete doc.pending;
      if (doc.reviewState === 'pending') doc.reviewState = 'draft';
      this.outcomes.push({ documentId, state: 'withdrawn', reason });
      this.emit(
        reason === 'space_closed'
          ? {
              type: 'review_withdrawn',
              spaceId,
              documentId,
              changeRequestId,
              actorId: null,
              details: { reason },
            }
          : {
              type: 'review_withdrawn',
              spaceId,
              documentId,
              changeRequestId,
              actorId: actorId as string,
              details: { reason },
            },
      );
      count += 1;
    }
    return count;
  }

  /** A `vacateReviewer` párja: az aktív hely döntéstől függetlenül megszűnik. */
  private vacate(spaceId: string, userId: string, actorId: string): void {
    for (const [documentId, doc] of this.world.documents) {
      const pending = doc.pending;
      if (doc.spaceId !== spaceId || !pending) continue;
      if (!pending.reviewers.includes(userId)) continue;
      // a hely a döntéstől függetlenül megszűnik, a döntés elvész (D51b); a másik review-eré marad
      pending.reviewers = pending.reviewers.filter((r) => r !== userId);
      pending.decided = pending.decided?.filter((r) => r !== userId);
      this.emit({
        type: 'reviewer_removed',
        spaceId,
        documentId,
        changeRequestId: pending.id ?? randomUUID(),
        actorId,
        details: { reviewerId: userId, reason: 'member_removed' },
      });
    }
  }

  addMember(
    actor: Actor,
    spaceId: string,
    input: { userId: string; role: SpaceRole },
  ): Promise<StoreResult<SpaceMember>> {
    const space = this.world.spaces.get(spaceId);
    if (!space || space.deleted) return Promise.resolve(fail('not_found'));
    if (space.closed && !isSystemAdmin(actor)) return Promise.resolve(fail('space_closed'));
    if (!this.isActiveUser(input.userId)) {
      return Promise.resolve(fail('validation_error', 'A felhasználó nem található.'));
    }
    const current = this.role(spaceId, input.userId);
    if (current !== undefined) {
      return Promise.resolve(
        current === input.role
          ? ok(this.member(spaceId, input.userId))
          : fail(
              'validation_error',
              'A felhasználó már tag; a szerepet a szerepváltással kell módosítani.',
            ),
      );
    }
    this.world.addMember(spaceId, input.userId, input.role);
    this.emit({
      type: 'member_added',
      spaceId,
      actorId: actor.userId,
      details: {
        userId: input.userId,
        role: input.role,
        ...(isSystemAdmin(actor) && input.userId === actor.userId
          ? { self_assigned: true as const }
          : {}),
      },
    });
    return Promise.resolve(ok(this.member(spaceId, input.userId)));
  }

  changeRole(
    actor: Actor,
    spaceId: string,
    userId: string,
    role: SpaceRole,
  ): Promise<StoreResult<SpaceMember>> {
    const space = this.world.spaces.get(spaceId);
    if (!space || space.deleted) return Promise.resolve(fail('not_found'));
    if (space.closed && !isSystemAdmin(actor)) return Promise.resolve(fail('space_closed'));
    const current = this.role(spaceId, userId);
    if (current === undefined) return Promise.resolve(fail('not_found'));
    if (current === role) return Promise.resolve(ok(this.member(spaceId, userId)));
    if (current === 'space_manager' && !this.otherActiveManager(spaceId, userId)) {
      return Promise.resolve(fail('last_space_manager'));
    }
    this.world.addMember(spaceId, userId, role);
    this.emit({
      type: 'role_changed',
      spaceId,
      actorId: actor.userId,
      details: { userId, from: current, to: role },
    });
    return Promise.resolve(ok(this.member(spaceId, userId)));
  }

  removeMember(actor: Actor, spaceId: string, userId: string): Promise<StoreResult<null>> {
    const space = this.world.spaces.get(spaceId);
    if (!space || space.deleted) return Promise.resolve(fail('not_found'));
    if (space.type === 'general') return Promise.resolve(fail('forbidden'));
    if (space.closed && !isSystemAdmin(actor)) return Promise.resolve(fail('space_closed'));
    const current = this.role(spaceId, userId);
    if (current === undefined) return Promise.resolve(fail('not_found'));
    if (current === 'space_manager' && !this.otherActiveManager(spaceId, userId)) {
      return Promise.resolve(fail('last_space_manager'));
    }
    const ownsLive = [...this.world.documents.values()].some(
      (d) => d.spaceId === spaceId && d.ownerId === userId && !d.deleted,
    );
    if (ownsLive) return Promise.resolve(fail('owner_handover_required'));
    this.withdraw(spaceId, (initiator) => initiator === userId, 'member_removed', actor.userId);
    this.vacate(spaceId, userId, actor.userId);
    this.world.addMember(spaceId, userId, current, true);
    this.emit({ type: 'member_removed', spaceId, actorId: actor.userId, details: { userId } });
    return Promise.resolve(ok(null));
  }

  transferOwnership(
    actor: Actor,
    input: { documentId: string; newOwnerId: string },
  ): Promise<StoreResult<null>> {
    const doc = this.world.documents.get(input.documentId);
    // az eldobott piszkozat nem létezik, az archivált átadható
    if (!doc || (doc.deleted && !doc.everApproved)) return Promise.resolve(fail('not_found'));
    const space = this.world.spaces.get(doc.spaceId);
    if (!space || space.deleted) return Promise.resolve(fail('not_found'));
    if (space.closed) return Promise.resolve(fail('space_closed'));
    // a jogosultság a (zár alatti) aktuális tagságból: a tulajdonos csak aktív tagként, különben aktív gazda
    const actorRole = this.role(doc.spaceId, actor.userId);
    const allowed =
      actorRole === 'space_manager' || (doc.ownerId === actor.userId && actorRole !== undefined);
    if (!allowed) return Promise.resolve(fail('forbidden'));
    if (input.newOwnerId === doc.ownerId) {
      return Promise.resolve(
        fail('invalid_new_owner', 'Az új tulajdonos már most is a tulajdonos.'),
      );
    }
    if (this.role(doc.spaceId, input.newOwnerId) === undefined) {
      return Promise.resolve(
        fail('invalid_new_owner', 'Az új tulajdonos nem a színtér aktív tagja.'),
      );
    }
    const from = doc.ownerId;
    doc.ownerId = input.newOwnerId;
    this.emit({
      type: 'owner_changed',
      spaceId: doc.spaceId,
      documentId: input.documentId,
      actorId: actor.userId,
      details: { from, to: input.newOwnerId, reason: 'handover' },
    });
    return Promise.resolve(ok(null));
  }

  adminHandover(
    actor: Actor,
    input: { userId: string; spaceId: string; newOwnerId: string },
  ): Promise<StoreResult<{ movedDocuments: number }>> {
    const space = this.world.spaces.get(input.spaceId);
    if (!space || space.deleted) return Promise.resolve(fail('not_found'));
    if (!this.auth.users.has(input.userId)) return Promise.resolve(fail('not_found'));
    if (input.newOwnerId === input.userId) {
      return Promise.resolve(fail('invalid_new_owner', 'Az új tulajdonos azonos a mostanival.'));
    }
    if (this.role(input.spaceId, input.newOwnerId) === undefined) {
      return Promise.resolve(
        fail('invalid_new_owner', 'Az új tulajdonos nem a színtér aktív tagja.'),
      );
    }
    let moved = 0;
    for (const [documentId, doc] of this.world.documents) {
      if (doc.spaceId !== input.spaceId || doc.ownerId !== input.userId) continue;
      // az eldobott piszkozat nem létezik (D54)
      if (doc.deleted && !doc.everApproved) continue;
      doc.ownerId = input.newOwnerId;
      moved += 1;
      this.emit({
        type: 'owner_changed',
        spaceId: input.spaceId,
        documentId,
        actorId: actor.userId,
        details: { from: input.userId, to: input.newOwnerId, reason: 'admin_handover' },
      });
    }
    return Promise.resolve(ok({ movedDocuments: moved }));
  }

  createMembershipRequest(
    actor: Actor,
    spaceId: string,
    input: CreateMembershipRequest,
  ): Promise<StoreResult<RequestCreated>> {
    const space = this.world.spaces.get(spaceId);
    if (!space || space.deleted) return Promise.resolve(fail('not_found'));
    if (isSystemAdmin(actor) || this.role(spaceId, actor.userId) !== undefined) {
      return Promise.resolve(fail('forbidden'));
    }
    if (space.closed) return Promise.resolve(fail('space_closed'));
    if (this.world.pendingRequests.has(`${spaceId}:${actor.userId}`)) {
      return Promise.resolve(
        fail('request_pending', 'Már van függő felvételi kérésed ebbe a színtérbe.'),
      );
    }
    const id = randomUUID();
    this.membershipRequests.set(id, { spaceId, userId: actor.userId, state: 'pending' });
    this.world.addPendingMembershipRequest(spaceId, actor.userId);
    this.emit({
      type: 'membership_requested',
      spaceId,
      actorId: actor.userId,
      details: {
        requestId: id,
        ...(input.viaDocumentId === undefined ? {} : { viaDocumentId: input.viaDocumentId }),
      },
    });
    return Promise.resolve(ok({ id, state: 'pending' as const }));
  }

  getMembershipRequest(requestId: string) {
    const request = this.membershipRequests.get(requestId);
    return Promise.resolve(request && { spaceId: request.spaceId, state: request.state });
  }

  decideMembershipRequest(
    actor: Actor,
    requestId: string,
    decision: MembershipRequestDecision,
  ): Promise<StoreResult<MembershipDecisionResult>> {
    const request = this.membershipRequests.get(requestId);
    const space = request && this.world.spaces.get(request.spaceId);
    if (!request || !space || space.deleted) return Promise.resolve(fail('not_found'));
    if (request.state !== 'pending') return Promise.resolve(fail('request_closed'));
    if (space.closed && !isSystemAdmin(actor)) return Promise.resolve(fail('space_closed'));
    let role: SpaceRole | undefined;
    if (decision.approve) {
      if (!this.isActiveUser(request.userId)) {
        return Promise.resolve(fail('validation_error', 'A felhasználó nem található.'));
      }
      const current = this.role(request.spaceId, request.userId);
      role = current ?? decision.role ?? 'author';
      if (current === undefined) {
        this.world.addMember(request.spaceId, request.userId, role);
        this.emit({
          type: 'member_added',
          spaceId: request.spaceId,
          actorId: actor.userId,
          details: { userId: request.userId, role },
        });
      }
    }
    request.state = decision.approve ? 'approved' : 'rejected';
    this.world.pendingRequests.delete(`${request.spaceId}:${request.userId}`);
    this.emit({
      type: 'membership_request_decided',
      spaceId: request.spaceId,
      actorId: actor.userId,
      details: {
        requestId,
        approved: decision.approve,
        ...(role === undefined ? {} : { role }),
      },
    });
    return Promise.resolve(
      ok({
        id: requestId,
        state: request.state,
        spaceId: request.spaceId,
        ...(role === undefined ? {} : { role }),
      }),
    );
  }

  createSpaceRequest(
    actor: Actor,
    input: CreateSpaceRequestRequest,
  ): Promise<StoreResult<RequestCreated>> {
    if (!this.isActiveUser(input.proposedManagerId)) {
      return Promise.resolve(fail('validation_error', 'A javasolt Színtérgazda nem található.'));
    }
    const id = randomUUID();
    this.spaceRequests.set(id, {
      name: input.name,
      purpose: input.purpose,
      proposedManagerId: input.proposedManagerId,
      state: 'pending',
    });
    this.emit({ type: 'space_requested', actorId: actor.userId, details: { requestId: id } });
    return Promise.resolve(ok({ id, state: 'pending' as const }));
  }

  async decideSpaceRequest(
    actor: Actor,
    requestId: string,
    decision: SpaceRequestDecision,
  ): Promise<StoreResult<SpaceRequestDecisionResult>> {
    const request = this.spaceRequests.get(requestId);
    if (!request) return fail('not_found');
    if (request.state !== 'pending') return fail('request_closed');
    let spaceId: string | undefined;
    if (decision.approve) {
      // a `createSpace` mutáció előtt ellenőriz, így hiba esetén a kérés függő marad és semmi nem íródik
      const created = await this.createSpace(actor, {
        name: request.name,
        type: 'project',
        description: request.purpose,
        color: decision.color,
        initialManagerId: request.proposedManagerId,
      });
      if (!created.ok) return created;
      spaceId = created.value.id;
    }
    request.state = decision.approve ? 'approved' : 'rejected';
    this.emit({
      type: 'space_request_decided',
      actorId: actor.userId,
      details: {
        requestId,
        approved: decision.approve,
        ...(spaceId === undefined ? {} : { spaceId }),
      },
    });
    return ok({
      id: requestId,
      state: request.state,
      ...(spaceId === undefined ? {} : { spaceId }),
    });
  }

  searchUsers(query: string, limit: number): Promise<UserRef[]> {
    const needle = query.toLowerCase();
    return Promise.resolve(
      [...this.auth.users.keys()]
        .filter((id) => this.isActiveUser(id))
        .map((id) => this.userRef(id) as UserRef)
        .filter((u) => u.displayName.toLowerCase().includes(needle))
        .sort(byName)
        .slice(0, limit),
    );
  }

  listAdminUsers(): Promise<AdminUser[]> {
    return Promise.resolve(
      [...this.auth.users.values()].map((u) => this.adminUser(u.id)).sort(byName),
    );
  }

  private adminUser(id: string): AdminUser {
    const user = this.auth.users.get(id) as NonNullable<
      ReturnType<MemoryAuthStore['users']['get']>
    >;
    return {
      id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      email: user.email,
      systemRole: user.systemRole,
      lastLoginAt: null,
    };
  }

  changeSystemRole(
    actor: Actor,
    userId: string,
    systemRole: SystemRole,
  ): Promise<StoreResult<AdminUser>> {
    const user = this.auth.users.get(userId);
    if (!user) return Promise.resolve(fail('not_found'));
    if (user.systemRole === systemRole) return Promise.resolve(ok(this.adminUser(userId)));
    if (systemRole === 'user') {
      const other = [...this.auth.users.values()].some(
        (u) => u.id !== userId && u.systemRole === 'system_admin' && this.isActiveUser(u.id),
      );
      if (!other) return Promise.resolve(fail('last_admin'));
    }
    user.systemRole = systemRole;
    this.emit({
      type: systemRole === 'system_admin' ? 'system_admin_granted' : 'system_admin_revoked',
      actorId: actor.userId,
      details: { userId },
    });
    return Promise.resolve(ok(this.adminUser(userId)));
  }
}

const byName = (a: UserRef, b: UserRef): number =>
  a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id);
