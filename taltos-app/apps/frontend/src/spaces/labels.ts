import { SPACE_COLOR_PALETTE, type SpaceRole, type SpaceType } from '@taltos/shared';

export const ROLE_LABEL: Record<SpaceRole, string> = {
  author: 'Szerző',
  space_manager: 'Színtérgazda',
};

/** „… felvéve {szerepkör}ként” alakhoz. */
export const ROLE_AS: Record<SpaceRole, string> = {
  author: 'Szerzőként',
  space_manager: 'Színtérgazdaként',
};

export const TYPE_LABEL: Record<SpaceType, string> = {
  general: 'Általános',
  team: 'Csapat',
  project: 'Projekt',
};

/** A paletta színeinek neve a paletta sorrendjében (a nevek javaslatok, a paletta csak hexet ad; NK2). */
export const COLOR_NAMES = [
  'Kék',
  'Zöld',
  'Barna',
  'Lila',
  'Bordó',
  'Kékeszöld',
  'Okker',
  'Indigó',
] as const;

export function colorName(hex: string): string {
  const index = SPACE_COLOR_PALETTE.findIndex((color) => color.toLowerCase() === hex.toLowerCase());
  return COLOR_NAMES[index] ?? 'Egyedi szín';
}

export const collator = new Intl.Collator('hu');

/** Az Általános az élen, utána a csapat-munkaterek, majd a projekt-terek, mindegyik név szerint. */
export function compareSpaces(
  a: { type: SpaceType; name: string },
  b: { type: SpaceType; name: string },
): number {
  const rank = (type: SpaceType) => (type === 'general' ? 0 : type === 'team' ? 1 : 2);
  return rank(a.type) - rank(b.type) || collator.compare(a.name, b.name);
}
