import type { RevisionMetadata } from '@taltos/shared';

/**
 * Az első revízió metaadat-pillanatképe (D59 d): fajta, címkék (rendezve, ismétlődés nélkül) és kapcsolatok.
 * Duplikáláskor a `származik` kapcsolat (másolat → forrás) a pillanatképbe is bekerül (D59 c).
 */
export function firstRevisionMetadata(input: {
  kind: string;
  tagIds: readonly string[];
  sourceDocumentId?: string | undefined;
}): RevisionMetadata {
  return {
    kind: input.kind,
    tagIds: [...new Set(input.tagIds)].sort(),
    links:
      input.sourceDocumentId === undefined
        ? []
        : [{ toId: input.sourceDocumentId, type: 'szarmazik', anchor: null }],
  };
}

/** A JSONB-ből olvasott pillanatkép védekező értelmezése (a séma `jsonb`, a WP6/WP8 is ír ilyet). */
export function readRevisionMetadata(raw: unknown): RevisionMetadata {
  const value = (raw ?? {}) as Partial<RevisionMetadata>;
  return {
    kind: typeof value.kind === 'string' ? value.kind : '',
    tagIds: Array.isArray(value.tagIds) ? value.tagIds : [],
    links: Array.isArray(value.links) ? value.links : [],
  };
}
