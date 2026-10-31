import type { ContractIds } from '../policy/access-store-contract.js';
import { MemoryAccessStore } from './memory-access-store.js';

/** A szerződés adathalmaza a memóriabeli adapterre; a PostgreSQL-párját az `access.int.test.ts` tölti fel ugyanígy. */
export function seedMemory(): { store: MemoryAccessStore; ids: ContractIds } {
  const store = new MemoryAccessStore();
  const ids: ContractIds = {
    manager: 'u-manager',
    author: 'u-author',
    outsider: 'u-outsider',
    admin: 'u-admin',
    removed: 'u-removed',
    reviewer: 'u-reviewer',
    requester: 'u-requester',
    space: 's-team',
    closedSpace: 's-closed',
    deletedSpace: 's-deleted',
    missing: 'x-missing',
    doc: 'd-plain',
    archivedDoc: 'd-archived',
    droppedDraft: 'd-dropped',
    pendingDoc: 'd-pending',
    docInDeletedSpace: 'd-in-deleted',
  };
  store.addUser(ids.manager, 'Kiss Anna');
  store.addUser(ids.author, 'Nagy Béla');
  store.addSpace(ids.space, 'Adatplatform');
  store.addSpace(ids.closedSpace, 'Régi projekt', { type: 'project', closed: true });
  store.addSpace(ids.deletedSpace, 'Törölt tér', { deleted: true });
  store.addMember(ids.space, ids.manager, 'space_manager');
  store.addMember(ids.space, ids.author, 'author');
  store.addMember(ids.space, ids.reviewer, 'author');
  store.addMember(ids.space, ids.removed, 'author', true);
  store.addMember(ids.closedSpace, ids.manager, 'space_manager');
  store.addDocument(ids.doc, ids.space, ids.author);
  store.addDocument(ids.archivedDoc, ids.space, ids.author, { deleted: true, everApproved: true });
  store.addDocument(ids.droppedDraft, ids.space, ids.author, { deleted: true });
  store.addDocument(ids.pendingDoc, ids.space, ids.author, {
    reviewState: 'pending',
    pending: { initiatorId: ids.author, reviewers: [ids.reviewer] },
  });
  store.addDocument(ids.docInDeletedSpace, ids.deletedSpace, ids.author);
  store.addPendingMembershipRequest(ids.space, ids.requester);
  return { store, ids };
}
