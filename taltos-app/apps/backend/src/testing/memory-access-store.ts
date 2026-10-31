import type { SpaceRole, SpaceType, UserRef } from '@taltos/shared';
import { canRequestMembership, type AccessStore } from '../policy/access-store.js';
import type { ReviewState } from '../realtime/collab-store.js';

export interface MemorySpace {
  name: string;
  type: SpaceType;
  description?: string;
  color?: string;
  closed: boolean;
  deleted: boolean;
}

export interface MemoryDocument {
  spaceId: string;
  ownerId: string;
  reviewState: ReviewState;
  /** Törölt: archivált (volt jóváhagyott változata) vagy eldobott piszkozat. */
  deleted: boolean;
  everApproved: boolean;
  pending?: {
    id?: string;
    initiatorId: string;
    /** Az aktív review-er helyek. */
    reviewers: string[];
    /** Közülük akik már döntöttek (a döntésük kiesés után is megmarad). */
    decided?: string[];
  };
}

/**
 * Memóriabeli `AccessStore` az adatbázis nélküli tesztekhez; ugyanazt a szerződést tükrözi, mint a PostgreSQL-
 * megvalósítás (aktív tagság, törölt színtér, archivált és eldobott dokumentum, a `denialDetails` alakja).
 * A tényleges SQL-t az integrációs teszt bizonyítja.
 */
export class MemoryAccessStore implements AccessStore {
  readonly users = new Map<string, UserRef>();
  readonly spaces = new Map<string, MemorySpace>();
  /** `spaceId:userId` → szerep és megszűnt-e. */
  readonly members = new Map<string, { role: SpaceRole; removed: boolean }>();
  readonly documents = new Map<string, MemoryDocument>();
  readonly pendingRequests = new Set<string>();
  /** Az `AccessStore` hívásai (a „csak elutasításkor kérdezünk” szabály ellenőrzéséhez). */
  readonly calls = { spaceTarget: 0, documentTarget: 0, denialDetails: 0 };

  /** A felhasználó-feloldás felülírható (a `MemorySpaceStore` az auth-tár felhasználóit adja). */
  userResolver?: (id: string) => UserRef | undefined;

  userRef(id: string): UserRef | undefined {
    return this.userResolver?.(id) ?? this.users.get(id);
  }

  addUser(id: string, displayName = id): void {
    this.users.set(id, { id, displayName, avatarUrl: null });
  }

  addSpace(id: string, name: string, options: Partial<Omit<MemorySpace, 'name'>> = {}): void {
    this.spaces.set(id, { name, type: 'team', closed: false, deleted: false, ...options });
  }

  addMember(spaceId: string, userId: string, role: SpaceRole, removed = false): void {
    this.members.set(`${spaceId}:${userId}`, { role, removed });
  }

  addDocument(
    id: string,
    spaceId: string,
    ownerId: string,
    options: Partial<Omit<MemoryDocument, 'spaceId' | 'ownerId'>> = {},
  ): void {
    this.documents.set(id, {
      spaceId,
      ownerId,
      reviewState: 'draft',
      deleted: false,
      everApproved: false,
      ...options,
    });
  }

  updateSpace(id: string, patch: Partial<Omit<MemorySpace, 'name'>>): void {
    const space = this.spaces.get(id);
    if (space) Object.assign(space, patch);
  }

  setReviewState(id: string, reviewState: ReviewState): void {
    const doc = this.documents.get(id);
    if (doc) doc.reviewState = reviewState;
  }

  addPendingMembershipRequest(spaceId: string, userId: string): void {
    this.pendingRequests.add(`${spaceId}:${userId}`);
  }

  private role(spaceId: string, userId: string): SpaceRole | null {
    const member = this.members.get(`${spaceId}:${userId}`);
    return member && !member.removed ? member.role : null;
  }

  spaceTarget(userId: string, spaceId: string) {
    this.calls.spaceTarget += 1;
    const space = this.spaces.get(spaceId);
    if (!space || space.deleted) return Promise.resolve(undefined);
    return Promise.resolve({
      spaceId,
      type: space.type,
      closed: space.closed,
      membership: this.role(spaceId, userId),
    });
  }

  documentTarget(userId: string, documentId: string) {
    this.calls.documentTarget += 1;
    const doc = this.documents.get(documentId);
    const space = doc && this.spaces.get(doc.spaceId);
    if (!doc || !space || space.deleted) return Promise.resolve(undefined);
    // az eldobott piszkozat (törölt, jóváhagyott változat nélkül) nem betölthető
    if (doc.deleted && !doc.everApproved) return Promise.resolve(undefined);
    return Promise.resolve({
      documentId,
      space: {
        spaceId: doc.spaceId,
        type: space.type,
        closed: space.closed,
        membership: this.role(doc.spaceId, userId),
      },
      ownerId: doc.ownerId,
      archived: doc.deleted,
      reviewState: doc.reviewState,
      ...(doc.pending === undefined
        ? {}
        : {
            initiatorId: doc.pending.initiatorId,
            isDesignatedReviewer: doc.pending.reviewers.includes(userId),
          }),
    });
  }

  denialDetails(actor: { userId: string; systemRole: 'user' | 'system_admin' }, spaceId: string) {
    this.calls.denialDetails += 1;
    const space = this.spaces.get(spaceId);
    if (!space || space.deleted) return Promise.resolve(undefined);
    const managers = [...this.members.entries()]
      .filter(
        ([key, m]) => key.startsWith(`${spaceId}:`) && m.role === 'space_manager' && !m.removed,
      )
      .map(([key]) => this.userRef(key.slice(spaceId.length + 1)))
      .filter((user): user is UserRef => user !== undefined)
      .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id));
    return Promise.resolve({
      space: { id: spaceId, name: space.name },
      managers,
      canRequestMembership: canRequestMembership({
        systemRole: actor.systemRole,
        closed: space.closed,
        hasPendingRequest: this.pendingRequests.has(`${spaceId}:${actor.userId}`),
      }),
    });
  }
}
