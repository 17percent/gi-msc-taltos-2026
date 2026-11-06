import { randomUUID } from 'node:crypto';
import {
  displayTagName,
  normalizeTagName,
  type KindRef,
  type TagListResponse,
  type TagRef,
  type TagSearchResponse,
  type TagWithCount,
} from '@taltos/shared';
import { validateEvent } from '../events/record.js';
import type { AppEvent } from '../events/types.js';
import type { Actor } from '../policy/targets.js';
import { fail, ok, type StoreResult } from '../spaces/store.js';
import {
  TAG_LIST_LIMIT,
  TAG_SIMILARITY_THRESHOLD,
  TAG_SUGGESTION_LIMIT,
  type TagStore,
} from '../tags/store.js';
import type { MemoryAccessStore } from './memory-access-store.js';
import { similarity } from './trigram.js';

interface MemoryTag {
  id: string;
  name: string;
  normalized: string;
  createdBy: string;
}

/** A fejlesztői seed fajtái (a memóriabeli világ alapértéke, hogy a dokumentum-tesztek ne igényeljenek előkészítést). */
const DEFAULT_KINDS: readonly KindRef[] = [
  { key: 'prompt', label: 'Prompt' },
  { key: 'skill', label: 'Skill' },
  { key: 'agent', label: 'Agent' },
];

/**
 * Memóriabeli `TagStore` az adatbázis nélküli tesztekhez: ugyanazt a szerződést tükrözi, mint a PostgreSQL-megvalósítás
 * (látható dokumentumokra szűrt darabszám, normalizált egyezés + trigram-javaslat, csendes újrahasznosítás). A
 * `document_tags` megfelelője a `usage`; a láthatóság a megosztott világból (`MemoryAccessStore`) jön. A tényleges
 * SQL-t, az indexhasználatot és a versenyhelyzeteket az integrációs teszt bizonyítja.
 */
export class MemoryTagStore implements TagStore {
  readonly events: AppEvent[] = [];
  readonly tags = new Map<string, MemoryTag>();
  readonly kinds = new Map<string, { label: string; sortOrder: number; deleted: boolean }>(
    DEFAULT_KINDS.map((kind, index) => [
      kind.key,
      { label: kind.label, sortOrder: index, deleted: false },
    ]),
  );
  /** A `document_tags`: dokumentum → címke-azonosítók. */
  readonly usage = new Map<string, Set<string>>();

  constructor(private readonly world: MemoryAccessStore) {}

  private emit(...events: AppEvent[]): void {
    for (const event of events) {
      validateEvent(event);
      this.events.push(event);
    }
  }

  /** Tesztsegéd: közvetlen címke-létrehozás (esemény nélkül), a megadott névvel. */
  addTag(name: string, createdBy = 'seed'): TagRef {
    const tag: MemoryTag = {
      id: randomUUID(),
      name: displayTagName(name),
      normalized: normalizeTagName(name),
      createdBy,
    };
    this.tags.set(tag.id, tag);
    return { id: tag.id, name: tag.name };
  }

  /** Tesztsegéd: a `document_tags` sorai. */
  attach(documentId: string, tagIds: readonly string[]): void {
    const set = this.usage.get(documentId) ?? new Set<string>();
    for (const id of tagIds) set.add(id);
    this.usage.set(documentId, set);
  }

  hasTag(id: string): boolean {
    return this.tags.has(id);
  }

  hasKind(key: string): boolean {
    const kind = this.kinds.get(key);
    return kind !== undefined && !kind.deleted;
  }

  refs(ids: readonly string[]): TagRef[] {
    return ids.flatMap((id) => {
      const tag = this.tags.get(id);
      return tag === undefined ? [] : [{ id, name: tag.name }];
    });
  }

  /** A hívó számára látható, nem törölt dokumentumok száma, amelyeken a címke használatban van. */
  private visibleCount(viewerId: string, tagId: string): number {
    let count = 0;
    for (const [documentId, tagIds] of this.usage) {
      if (!tagIds.has(tagId)) continue;
      const doc = this.world.documents.get(documentId);
      const space = doc && this.world.spaces.get(doc.spaceId);
      if (!doc || !space || space.deleted || doc.deleted) continue;
      const member = this.world.members.get(`${doc.spaceId}:${viewerId}`);
      if (member !== undefined && !member.removed) count += 1;
    }
    return count;
  }

  private visible(viewerId: string): (MemoryTag & { count: number })[] {
    return [...this.tags.values()]
      .map((tag) => ({ ...tag, count: this.visibleCount(viewerId, tag.id) }))
      .filter((tag) => tag.count > 0);
  }

  private static view = (tag: MemoryTag & { count: number }): TagWithCount => ({
    id: tag.id,
    name: tag.name,
    count: tag.count,
  });

  listTags(viewerId: string): Promise<TagListResponse> {
    const tags = this.visible(viewerId)
      .sort(
        (a, b) =>
          b.count - a.count || a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id),
      )
      .slice(0, TAG_LIST_LIMIT)
      .map(MemoryTagStore.view);
    return Promise.resolve({ tags });
  }

  searchTags(viewerId: string, normalizedQuery: string): Promise<TagSearchResponse> {
    if (normalizedQuery === '') return Promise.resolve({ exact: null, similar: [] });
    const candidates = this.visible(viewerId)
      .map((tag) => ({ tag, sim: similarity(tag.normalized, normalizedQuery) }))
      .filter(({ sim }) => sim >= TAG_SIMILARITY_THRESHOLD);
    const exact = candidates.find(({ tag }) => tag.normalized === normalizedQuery);
    const similar = candidates
      .filter(({ tag }) => tag.normalized !== normalizedQuery)
      .sort((a, b) => b.sim - a.sim || (a.tag.normalized < b.tag.normalized ? -1 : 1))
      .slice(0, TAG_SUGGESTION_LIMIT)
      .map(({ tag }) => MemoryTagStore.view(tag));
    return Promise.resolve({
      exact: exact === undefined ? null : MemoryTagStore.view(exact.tag),
      similar,
    });
  }

  createTag(actor: Actor, name: string): Promise<TagRef> {
    const normalized = normalizeTagName(name);
    const existing = [...this.tags.values()].find((tag) => tag.normalized === normalized);
    if (existing !== undefined) return Promise.resolve({ id: existing.id, name: existing.name });
    const tag = this.addTag(name, actor.userId);
    this.emit({ type: 'tag_created', actorId: actor.userId, details: { tagId: tag.id } });
    return Promise.resolve(tag);
  }

  listKinds(): Promise<KindRef[]> {
    return Promise.resolve(
      [...this.kinds.entries()]
        .filter(([, kind]) => !kind.deleted)
        .sort(([ka, a], [kb, b]) => a.sortOrder - b.sortOrder || (ka < kb ? -1 : 1))
        .map(([key, kind]) => ({ key, label: kind.label })),
    );
  }

  createKind(actor: Actor, input: KindRef): Promise<StoreResult<KindRef>> {
    if (this.kinds.has(input.key)) {
      return Promise.resolve(fail('validation_error', 'Ilyen kulcsú fajta már létezik.'));
    }
    const sortOrder = Math.max(-1, ...[...this.kinds.values()].map((k) => k.sortOrder)) + 1;
    this.kinds.set(input.key, { label: input.label, sortOrder, deleted: false });
    this.emit({ type: 'kind_created', actorId: actor.userId, details: { key: input.key } });
    return Promise.resolve(ok({ key: input.key, label: input.label }));
  }

  /** Tesztsegéd: törölt fajta (a `deleted_at` beállítva). */
  deleteKind(key: string): void {
    const kind = this.kinds.get(key);
    if (kind) kind.deleted = true;
  }
}
