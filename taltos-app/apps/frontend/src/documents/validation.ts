import {
  DOCUMENT_TITLE_MAX,
  KIND_KEY_PATTERN,
  KIND_LABEL_MAX,
  TAG_NAME_MAX,
  displayTagName,
} from '@taltos/shared';

/** Karakterszám a szerver módján (kódpontok, nem UTF-16 egységek). */
export function charCount(text: string): number {
  return Array.from(text).length;
}

const INVISIBLE_ONLY = /^[\s\p{Cf}]*$/u;

export const COPY_SUFFIX = ' (másolat)';

/** Cím (spec 2.2): 1–200 karakter, nem csak szóköz/láthatatlan karakter, NUL tilos. A szerver a levágott szöveget kapja. */
export function validateTitle(title: string): string | undefined {
  const trimmed = title.trim();
  if (INVISIBLE_ONLY.test(trimmed)) return 'Add meg a dokumentum címét.';
  if (trimmed.includes('\u0000')) return 'A cím nem tartalmazhat vezérlőkaraktert.';
  if (charCount(trimmed) > DOCUMENT_TITLE_MAX) return 'A cím legfeljebb 200 karakter lehet.';
  return undefined;
}

export type TagTextCheck =
  | { ok: true; name: string }
  | { ok: false; empty: true }
  | { ok: false; empty: false; message: string };

/** Címkeszöveg (spec 3.2/8): `displayTagName` után 1–64 karakter, legalább egy látható karakter, NUL tilos. */
export function checkTagText(text: string): TagTextCheck {
  if (text.includes('\u0000')) {
    return { ok: false, empty: false, message: 'A címke nem tartalmazhat vezérlőkaraktert.' };
  }
  const name = displayTagName(text);
  if (name === '') {
    return text.trim() === ''
      ? { ok: false, empty: true }
      : { ok: false, empty: false, message: 'Adj meg legalább egy látható karaktert.' };
  }
  if (charCount(name) > TAG_NAME_MAX) {
    return { ok: false, empty: false, message: 'A címke legfeljebb 64 karakter lehet.' };
  }
  return { ok: true, name };
}

/** A fajta kulcsa a névből: ékezetmentes, kisbetűs, `_` elválasztóval, betűvel kezdődik, legfeljebb 32 karakter. */
export function kindKeyFromLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .slice(0, 32)
    .replace(/_+$/, '');
}

export function validateKind(label: string, key: string): { label?: string; key?: string } {
  const errors: { label?: string; key?: string } = {};
  const trimmed = label.trim();
  if (INVISIBLE_ONLY.test(trimmed)) errors.label = 'Add meg a fajta nevét.';
  else if (trimmed.includes('\u0000')) errors.label = 'A név nem tartalmazhat vezérlőkaraktert.';
  else if (charCount(trimmed) > KIND_LABEL_MAX) {
    errors.label = 'A név legfeljebb 64 karakter lehet.';
  }
  if (!new RegExp(KIND_KEY_PATTERN).test(key)) {
    errors.key =
      'A kulcs kisbetűvel kezdődjön, és csak kisbetűt, számot és alávonást tartalmazzon (legfeljebb 32 karakter).';
  }
  return errors;
}
