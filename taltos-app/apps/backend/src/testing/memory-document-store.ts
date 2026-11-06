import { randomUUID } from 'node:crypto';
import type {
  ApprovedMetadata,
  DocumentDetail,
  LinkType,
  RevisionMetadata,
  SpaceRole,
} from '@taltos/shared';
import { firstRevisionMetadata } from '../documents/metadata.js';
import { SLUG_ATTEMPTS, slugAttempt, slugify } from '../documents/slug.js';
import type { DocumentStore, NewDocument } from '../documents/store.js';
import { validateEvent } from '../events/record.js';
import type { AppEvent } from '../events/types.js';
import { can } from '../policy/policy.js';
import type { Actor, SpaceTarget } from '../policy/targets.js';
import { fail, ok, type StoreResult } from '../spaces/store.js';
import type { MemoryCollabStore } from './memory-collab-store.js';
import type { MemoryTagStore } from './memory-tag-store.js';

export interface MemoryRevision {
  id: string;
  documentId: string;
  title: string;
  content: string;
  metadata: RevisionMetadata;
  authorId: string;
}

export interface MemoryLink {
  id: string;
  fromId: string;
  toId: string;
  type: LinkType;
  createdBy: string;
}

/** A dokumentum a `documents` sor azon mezőivel, amelyek nincsenek a megosztott világban (tagság, állapot, törlés). */
interface DocumentRecord {
  slug: string;
  title: string;
  kind: string;
  /** A `documents.tag_text` megfelelője nincs: a címkék a `MemoryTagStore.usage`-ben élnek. */
  approved?: { revisionId: string; title: string; content: string; metadata: RevisionMetadata };
  /** Van `change_requests` sora (függő, visszavont vagy elutasított): az eldobást tiltja. */
  hasRequest: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Memóriabeli `DocumentStore` az adatbázis nélküli tesztekhez. A tagság, az állapot és a törlés a megosztott világban
 * (`MemoryCollabStore.access`), a tartalom a `MemoryCollabStore`-ban él, a címkék a `MemoryTagStore`-ban; így a `/collab`
 * és a többi tár ugyanazt a dokumentumot látja. A PostgreSQL-megvalósítással azonos szerződés szerint működik
 * (eredmény-unió, események, a döntés a `can()`-nel); a tranzakciót, a zárat és a slug-versenyt az integrációs teszt bizonyítja.
 */
export class MemoryDocumentStore implements DocumentStore {
  readonly events: AppEvent[] = [];
  readonly revisions: MemoryRevision[] = [];
  readonly links: MemoryLink[] = [];
  readonly records = new Map<string, DocumentRecord>();
  private readonly slugs = new Set<string>();

  constructor(
    private readonly collab: MemoryCollabStore,
    private readonly tags: MemoryTagStore,
  ) {}

  private get world() {
    return this.collab.access;
  }

  private emit(...events: AppEvent[]): void {
    for (const event of events) {
      validateEvent(event);
      this.events.push(event);
    }
  }

  private role(spaceId: string, userId: string): SpaceRole | null {
    const member = this.world.members.get(`${spaceId}:${userId}`);
    return member && !member.removed ? member.role : null;
  }

  private spaceTarget(spaceId: string, userId: string): SpaceTarget | undefined {
    const space = this.world.spaces.get(spaceId);
    if (!space || space.deleted) return undefined;
    return {
      spaceId,
      type: space.type,
      closed: space.closed,
      membership: this.role(spaceId, userId),
    };
  }

  /** Tesztsegéd: egy a világba már felvett dokumentum metaadata és (opcionális) Jóváhagyott revíziója. */
  seed(
    id: string,
    options: {
      title?: string;
      kind?: string;
      tagIds?: string[];
      approved?: { title?: string; content: string; tagIds?: string[]; kind?: string };
      hasRequest?: boolean;
    } = {},
  ): void {
    const world = this.world.documents.get(id);
    if (!world) throw new Error(`Ismeretlen dokumentum: ${id}`);
    let approved: DocumentRecord['approved'];
    if (options.approved) {
      const metadata = firstRevisionMetadata({
        kind: options.approved.kind ?? options.kind ?? 'prompt',
        tagIds: options.approved.tagIds ?? [],
      });
      approved = {
        revisionId: randomUUID(),
        title: options.approved.title ?? options.title ?? 'Cím',
        content: options.approved.content,
        metadata,
      };
      world.everApproved = true;
      world.reviewState = 'approved';
      this.collab.setReviewState(id, 'approved');
    }
    const slug = `d-${id}`;
    this.slugs.add(`${world.spaceId}:${slug}`);
    this.records.set(id, {
      slug,
      title: options.title ?? 'Cím',
      kind: options.kind ?? 'prompt',
      ...(approved === undefined ? {} : { approved }),
      hasRequest: options.hasRequest ?? false,
      createdAt: new Date('2026-11-06T08:00:00Z'),
      updatedAt: new Date('2026-11-06T08:00:00Z'),
    });
    if (options.tagIds) this.tags.attach(id, options.tagIds);
  }

  private detail(id: string): DocumentDetail | undefined {
    const doc = this.world.documents.get(id);
    const record = this.records.get(id);
    if (!doc || !record) return undefined;
    const owner = this.world.userRef(doc.ownerId) ?? {
      id: doc.ownerId,
      displayName: doc.ownerId,
      avatarUrl: null,
    };
    const tags = this.tags
      .refs([...(this.tags.usage.get(id) ?? [])])
      .sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id));
    let approvedMetadata: ApprovedMetadata | null = null;
    if (record.approved) {
      approvedMetadata = {
        revisionId: record.approved.revisionId,
        title: record.approved.title,
        kind: record.approved.metadata.kind,
        tags: this.tags.refs(record.approved.metadata.tagIds),
        links: record.approved.metadata.links,
      };
    }
    return {
      id,
      spaceId: doc.spaceId,
      slug: record.slug,
      title: record.title,
      kind: record.kind,
      owner,
      reviewState: doc.reviewState,
      approvedRevisionId: record.approved?.revisionId ?? null,
      iteration: record.approved ? 1 : 0,
      archived: doc.deleted,
      tags,
      approvedMetadata,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  createDocument(
    actor: Actor,
    input: NewDocument,
    now: Date,
  ): Promise<StoreResult<DocumentDetail>> {
    const space = this.spaceTarget(input.spaceId, actor.userId);
    if (space === undefined) return Promise.resolve(fail('not_found'));
    const decision = can(actor, 'document.create', space);
    if (!decision.ok) return Promise.resolve(fail(decision.code));
    if (!this.tags.hasKind(input.kind)) {
      return Promise.resolve(fail('validation_error', 'Ismeretlen vagy törölt fajta.'));
    }
    const tagIds = [...new Set(input.tagIds)];
    if (!tagIds.every((tagId) => this.tags.hasTag(tagId))) {
      return Promise.resolve(fail('validation_error', 'Ismeretlen címke-azonosító.'));
    }

    let content = '';
    let source: { spaceId: string; revisionId: string | null } | undefined;
    if (input.sourceDocumentId !== undefined) {
      const doc = this.world.documents.get(input.sourceDocumentId);
      const visible =
        doc !== undefined &&
        !(doc.deleted && !doc.everApproved) &&
        this.role(doc.spaceId, actor.userId) !== null &&
        this.world.spaces.get(doc.spaceId)?.deleted === false;
      if (!doc || !visible) return Promise.resolve(fail('not_found'));
      const record = this.records.get(input.sourceDocumentId);
      content =
        record?.approved?.content ?? this.collab.document(input.sourceDocumentId)?.content ?? '';
      source = { spaceId: doc.spaceId, revisionId: record?.approved?.revisionId ?? null };
    }

    const id = randomUUID();
    const base = slugify(input.title);
    let slug: string | undefined;
    for (let attempt = 0; attempt < SLUG_ATTEMPTS && slug === undefined; attempt += 1) {
      const candidate = slugAttempt(base, attempt);
      if (!this.slugs.has(`${input.spaceId}:${candidate}`)) slug = candidate;
    }
    if (slug === undefined) throw new Error('A slug-ütközés nem oldódott fel a kísérletek alatt.');
    this.slugs.add(`${input.spaceId}:${slug}`);

    this.collab.addDocument(id, input.spaceId, { content });
    const world = this.world.documents.get(id);
    if (world) world.ownerId = actor.userId;
    this.records.set(id, {
      slug,
      title: input.title,
      kind: input.kind,
      hasRequest: false,
      createdAt: now,
      updatedAt: now,
    });
    this.revisions.push({
      id: randomUUID(),
      documentId: id,
      title: input.title,
      content,
      metadata: firstRevisionMetadata({
        kind: input.kind,
        tagIds,
        sourceDocumentId: input.sourceDocumentId,
      }),
      authorId: actor.userId,
    });
    this.tags.attach(id, tagIds);
    this.emit({
      type: 'created',
      spaceId: input.spaceId,
      documentId: id,
      actorId: actor.userId,
      details: {},
    });
    if (source !== undefined && input.sourceDocumentId !== undefined) {
      this.links.push({
        id: randomUUID(),
        fromId: id,
        toId: input.sourceDocumentId,
        type: 'szarmazik',
        createdBy: actor.userId,
      });
      this.emit(
        {
          type: 'duplicated_from',
          spaceId: input.spaceId,
          documentId: id,
          actorId: actor.userId,
          details: {
            sourceDocumentId: input.sourceDocumentId,
            sourceSpaceId: source.spaceId,
            sourceRevisionId: source.revisionId,
          },
        },
        {
          type: 'duplicated_from',
          spaceId: source.spaceId,
          documentId: input.sourceDocumentId,
          actorId: actor.userId,
          details: { targetDocumentId: id, targetSpaceId: input.spaceId },
        },
      );
    }
    const detail = this.detail(id);
    if (detail === undefined) throw new Error('A létrehozott dokumentum nem tölthető be.');
    return Promise.resolve(ok(detail));
  }

  getDocument(viewerId: string, documentId: string): Promise<DocumentDetail | undefined> {
    const doc = this.world.documents.get(documentId);
    if (!doc || (doc.deleted && !doc.everApproved)) return Promise.resolve(undefined);
    if (this.role(doc.spaceId, viewerId) === null || this.world.spaces.get(doc.spaceId)?.deleted) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(this.detail(documentId));
  }

  discardDraft(actor: Actor, documentId: string, now: Date): Promise<StoreResult<null>> {
    const doc = this.world.documents.get(documentId);
    if (!doc || (doc.deleted && !doc.everApproved)) return Promise.resolve(fail('not_found'));
    const space = this.spaceTarget(doc.spaceId, actor.userId);
    if (space === undefined) return Promise.resolve(fail('not_found'));
    const decision = can(actor, 'document.draft.discard', {
      documentId,
      space,
      ownerId: doc.ownerId,
      archived: doc.deleted,
      reviewState: doc.reviewState,
    });
    if (!decision.ok) return Promise.resolve(fail(decision.code));
    const record = this.records.get(documentId);
    const hasRequest = (record?.hasRequest ?? false) || doc.pending !== undefined;
    if (doc.deleted || doc.everApproved || doc.reviewState !== 'draft' || hasRequest) {
      return Promise.resolve(
        fail(
          doc.reviewState === 'pending' || doc.pending !== undefined
            ? 'request_pending'
            : 'has_approved_revision',
        ),
      );
    }
    this.collab.markDeleted(documentId);
    if (record) record.updatedAt = now;
    this.emit({
      type: 'draft_discarded',
      spaceId: doc.spaceId,
      documentId,
      actorId: actor.userId,
      details: {},
    });
    return Promise.resolve(ok(null));
  }
}
