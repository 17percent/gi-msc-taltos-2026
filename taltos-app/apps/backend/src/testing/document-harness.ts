import { randomUUID } from 'node:crypto';
import type { SystemRole } from '@taltos/shared';
import type { DocumentHarness } from '../documents/document-store-contract.js';
import type { Actor } from '../policy/targets.js';
import { MemoryCollabStore } from './memory-collab-store.js';
import { MemoryDocumentStore } from './memory-document-store.js';
import { MemoryTagStore } from './memory-tag-store.js';

/** A szerződés fixture-je a memóriabeli adapterekre (a PostgreSQL-párja: `pg-document-harness.ts`). */
export function memoryDocumentHarness(): DocumentHarness {
  const collab = new MemoryCollabStore();
  const world = collab.access;
  const tags = new MemoryTagStore(world);
  const documents = new MemoryDocumentStore(collab, tags);
  const roles = new Map<string, SystemRole>();
  return {
    documents,
    tags,
    user(name, options = {}) {
      const id = `${name}-${randomUUID()}`;
      roles.set(id, options.admin ? 'system_admin' : 'user');
      return Promise.resolve(id);
    },
    actor: (userId): Actor => ({ userId, systemRole: roles.get(userId) ?? 'user' }),
    space(options = {}) {
      const id = randomUUID();
      world.addSpace(id, `tér-${id}`, {
        type: options.type ?? (options.closed ? 'project' : 'team'),
        closed: options.closed ?? false,
      });
      return Promise.resolve(id);
    },
    member(spaceId, userId) {
      world.addMember(spaceId, userId, 'author');
      return Promise.resolve();
    },
    manager(spaceId, userId) {
      world.addMember(spaceId, userId, 'space_manager');
      return Promise.resolve();
    },
    kind(key, options = {}) {
      tags.kinds.set(key, {
        label: key,
        sortOrder: tags.kinds.size,
        deleted: options.deleted ?? false,
      });
      return Promise.resolve();
    },
    tag: (name) => Promise.resolve(tags.addTag(name).id),
    document(spaceId, ownerId, options = {}) {
      const id = randomUUID();
      const deleted = (options.archived ?? false) || (options.discarded ?? false);
      collab.addDocument(id, spaceId, {
        content: options.content ?? '',
        deleted,
        reviewState: options.pending
          ? 'pending'
          : options.rejectedRequest
            ? 'changes_requested'
            : 'draft',
      });
      const doc = world.documents.get(id);
      if (doc) {
        doc.ownerId = ownerId;
        if (options.pending) doc.pending = { initiatorId: ownerId, reviewers: [] };
      }
      documents.seed(id, {
        ...(options.title === undefined ? {} : { title: options.title }),
        ...(options.kind === undefined ? {} : { kind: options.kind }),
        ...(options.tagIds === undefined ? {} : { tagIds: options.tagIds }),
        ...(options.approved === undefined && !options.archived
          ? {}
          : { approved: options.approved ?? { content: '' } }),
        hasRequest: (options.rejectedRequest ?? false) || (options.pending ?? false),
      });
      // a seed a Jóváhagyott állapotot beállítja; az archivált/függő/átdolgozandó állapotot visszaállítjuk
      if (options.pending) collab.setReviewState(id, 'pending');
      if (options.rejectedRequest) collab.setReviewState(id, 'changes_requested');
      return Promise.resolve(id);
    },
    inspect: {
      document(id) {
        const doc = world.documents.get(id);
        const record = documents.records.get(id);
        const live = collab.document(id);
        if (!doc || !record) return Promise.resolve(undefined);
        const names = tags
          .refs([...(tags.usage.get(id) ?? [])])
          .map((t) => t.name)
          .sort();
        return Promise.resolve({
          slug: record.slug,
          title: record.title,
          kind: record.kind,
          ownerId: doc.ownerId,
          spaceId: doc.spaceId,
          content: live?.content ?? '',
          tagText: names.join(' '),
          reviewState: doc.reviewState,
          deleted: doc.deleted,
          approvedRevisionId: record.approved?.revisionId ?? null,
          iteration: record.approved ? 1 : 0,
        });
      },
      revisions: (id) => Promise.resolve(documents.revisions.filter((r) => r.documentId === id)),
      tagIds: (id) => Promise.resolve([...(tags.usage.get(id) ?? [])]),
      links: (id) =>
        Promise.resolve(
          documents.links
            .filter((l) => l.fromId === id)
            .map((l) => ({ toId: l.toId, type: l.type })),
        ),
      events: () =>
        Promise.resolve(
          [...documents.events, ...tags.events].map((e) => ({
            type: e.type,
            spaceId: 'spaceId' in e ? e.spaceId : null,
            documentId: 'documentId' in e ? e.documentId : null,
            actorId: e.actorId,
            details: e.details as Record<string, unknown>,
          })),
        ),
      collabStates: (id) => Promise.resolve(collab.document(id)?.state ? 1 : 0),
      documentCount: () => Promise.resolve(documents.records.size),
    },
  };
}
