import type { SpaceRole } from '@taltos/shared';
import type { CollabContent, CollabStore, ReviewState } from '../realtime/collab-store.js';
import { WRITABLE_REVIEW_STATES } from '../realtime/collab-store.js';
import { MemoryAccessStore } from './memory-access-store.js';

interface MemoryDocument {
  spaceId: string;
  reviewState: ReviewState;
  content: string;
  state: Uint8Array | null;
  deleted: boolean;
}

interface MemorySpace {
  closed: boolean;
  deleted: boolean;
}

/**
 * Memóriabeli `CollabStore` az adatbázis nélküli tesztekhez: a tartalom, a mentés és a mentés tranzakción belüli
 * írhatósági újraellenőrzése. A hozzáférés-döntés adatai (tagság, állapot, lezárt és törölt színtér) az `access`
 * (`MemoryAccessStore`) varraton élnek: a mutátorok oda is továbbítanak, így egyetlen policy-pont marad.
 * A tényleges SQL-t az integrációs teszt bizonyítja.
 */
export class MemoryCollabStore implements CollabStore {
  readonly access = new MemoryAccessStore();
  private readonly spaces = new Map<string, MemorySpace>();
  private readonly documents = new Map<string, MemoryDocument>();
  /** A ténylegesen elvégzett mentések (a dokumentum, a szöveg és az állapot). */
  readonly saves: { documentId: string; text: string; state: Uint8Array }[] = [];

  addSpace(id: string, options: Partial<MemorySpace> = {}): void {
    this.spaces.set(id, { closed: false, deleted: false, ...options });
    // csak a projekt-tér zárható le (D44)
    this.access.addSpace(id, id, {
      type: options.closed ? 'project' : 'team',
      closed: options.closed ?? false,
      deleted: options.deleted ?? false,
    });
  }

  addMember(spaceId: string, userId: string, removed = false, role: SpaceRole = 'author'): void {
    this.access.addMember(spaceId, userId, role, removed);
  }

  addDocument(
    id: string,
    spaceId: string,
    options: Partial<Omit<MemoryDocument, 'spaceId'>> = {},
  ): void {
    this.documents.set(id, {
      spaceId,
      reviewState: 'draft',
      content: '',
      state: null,
      deleted: false,
      ...options,
    });
    this.access.addDocument(id, spaceId, 'owner', {
      reviewState: options.reviewState ?? 'draft',
      deleted: options.deleted ?? false,
    });
  }

  document(id: string): MemoryDocument | undefined {
    return this.documents.get(id);
  }

  setSpace(id: string, patch: Partial<MemorySpace>): void {
    const space = this.spaces.get(id);
    if (space) Object.assign(space, patch);
    this.access.updateSpace(id, patch);
  }

  setReviewState(id: string, reviewState: ReviewState): void {
    const doc = this.documents.get(id);
    if (doc) doc.reviewState = reviewState;
    this.access.setReviewState(id, reviewState);
  }

  loadContent(documentId: string): Promise<CollabContent | undefined> {
    const doc = this.documents.get(documentId);
    if (!doc || doc.deleted) return Promise.resolve(undefined);
    return Promise.resolve({ state: doc.state, seed: doc.state === null ? doc.content : null });
  }

  saveContent(documentId: string, state: Uint8Array, text: string): Promise<boolean> {
    const doc = this.documents.get(documentId);
    const space = doc && this.spaces.get(doc.spaceId);
    const writable =
      doc &&
      space &&
      !doc.deleted &&
      !space.closed &&
      !space.deleted &&
      (WRITABLE_REVIEW_STATES as readonly string[]).includes(doc.reviewState);
    if (!writable) return Promise.resolve(false);
    doc.content = text;
    doc.state = state;
    this.saves.push({ documentId, text, state });
    return Promise.resolve(true);
  }
}
