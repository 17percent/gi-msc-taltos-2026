import { randomUUID } from 'node:crypto';
import type { StoreHarness } from '../spaces/space-store-contract.js';
import { MemoryAccessStore } from './memory-access-store.js';
import { MemorySpaceStore } from './memory-space-store.js';
import { MemoryAuthStore } from './memory-store.js';

/** A szerződés fixture-je a memóriabeli adapterekre (a PostgreSQL-párja a `space-store.int.test.ts`-ben él). */
export function memoryHarness(): StoreHarness {
  const auth = new MemoryAuthStore();
  const world = new MemoryAccessStore();
  const store = new MemorySpaceStore(world, auth);
  return {
    store,
    user(name, options = {}) {
      const created = auth.addUser(`${name}@example.test`, options.admin ? 'system_admin' : 'user');
      if (options.allowlisted ?? true) auth.allow(created.email);
      return Promise.resolve(created.id);
    },
    space(options = {}) {
      const id = randomUUID();
      world.addSpace(id, `tér-${id}`, {
        type: options.type ?? (options.closed ? 'project' : 'team'),
        closed: options.closed ?? false,
      });
      return Promise.resolve(id);
    },
    member(spaceId, userId, role = 'author') {
      world.addMember(spaceId, userId, role);
      return Promise.resolve();
    },
    document(spaceId, ownerId, options = {}) {
      const id = randomUUID();
      world.addDocument(id, spaceId, ownerId, {
        deleted: (options.archived ?? false) || (options.discarded ?? false),
        everApproved: options.archived ?? false,
        reviewState: options.pending ? 'pending' : 'draft',
        ...(options.pending ? { pending: { id: randomUUID(), ...options.pending } } : {}),
      });
      return Promise.resolve(id);
    },
    events(spaceId) {
      return Promise.resolve(
        store.events
          .filter((e) => 'spaceId' in e && e.spaceId === spaceId)
          .map((e) => ({
            type: e.type,
            actorId: e.actorId,
            ...('documentId' in e ? { documentId: e.documentId } : {}),
            reason: (e.details as { reason?: string }).reason,
          })),
      );
    },
    eventsOfType: (type) =>
      Promise.resolve(
        store.events
          .filter((e) => e.type === type)
          .map((e) => ({ actorId: e.actorId, details: e.details })),
      ),
    owner: (id) => Promise.resolve(world.documents.get(id)?.ownerId as string),
    reviewState: (id) => Promise.resolve(world.documents.get(id)?.reviewState as string),
    activeReviewers: (id) => Promise.resolve(world.documents.get(id)?.pending?.reviewers ?? []),
    isMember: (spaceId, userId) => {
      const m = world.members.get(`${spaceId}:${userId}`);
      return Promise.resolve(m !== undefined && !m.removed);
    },
  };
}
