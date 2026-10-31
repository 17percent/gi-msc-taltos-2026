import type {
  CollabAccess,
  CollabContent,
  CollabStore,
  ReviewState,
} from '../realtime/collab-store.js';
import { WRITABLE_REVIEW_STATES } from '../realtime/collab-store.js';

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
 * Memóriabeli `CollabStore` az adatbázis nélküli tesztekhez: a hozzáférés-döntés bemenetei (tagság, állapot, lezárt
 * és törölt színtér) és a mentés írhatósági újraellenőrzése. A tényleges SQL-t az integrációs teszt bizonyítja.
 */
export class MemoryCollabStore implements CollabStore {
  private readonly spaces = new Map<string, MemorySpace>();
  private readonly documents = new Map<string, MemoryDocument>();
  /** `spaceId:userId` → a tagság megszűnt-e. */
  private readonly members = new Map<string, { removed: boolean }>();
  /** A ténylegesen elvégzett mentések (a dokumentum, a szöveg és az állapot). */
  readonly saves: { documentId: string; text: string; state: Uint8Array }[] = [];

  addSpace(id: string, options: Partial<MemorySpace> = {}): void {
    this.spaces.set(id, { closed: false, deleted: false, ...options });
  }

  addMember(spaceId: string, userId: string, removed = false): void {
    this.members.set(`${spaceId}:${userId}`, { removed });
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
  }

  document(id: string): MemoryDocument | undefined {
    return this.documents.get(id);
  }

  setSpace(id: string, patch: Partial<MemorySpace>): void {
    const space = this.spaces.get(id);
    if (space) Object.assign(space, patch);
  }

  setReviewState(id: string, reviewState: ReviewState): void {
    const doc = this.documents.get(id);
    if (doc) doc.reviewState = reviewState;
  }

  findAccess(userId: string, documentId: string): Promise<CollabAccess | undefined> {
    const doc = this.documents.get(documentId);
    const space = doc && this.spaces.get(doc.spaceId);
    const member = doc && this.members.get(`${doc.spaceId}:${userId}`);
    if (!doc || doc.deleted || !space || space.deleted || !member || member.removed) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve({ reviewState: doc.reviewState, spaceClosed: space.closed });
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
