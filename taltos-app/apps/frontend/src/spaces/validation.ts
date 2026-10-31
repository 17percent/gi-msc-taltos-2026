export const NAME_MAX = 80;
export const DESCRIPTION_MAX = 2000;

export type FieldErrors = Partial<Record<'name' | 'description', string>>;

/** Mezőszintű ellenőrzés (spec 6.1): név kötelező, ≤ 80, nem ütközik; leírás ≤ 2000. */
export function validateSpaceFields(
  values: { name: string; description: string },
  otherNames: readonly string[],
  check: { name: boolean },
): FieldErrors {
  const errors: FieldErrors = {};
  const name = values.name.trim();
  if (check.name) {
    if (name.length === 0) errors.name = 'Add meg a színtér nevét.';
    else if (name.length > NAME_MAX) errors.name = 'A név legfeljebb 80 karakter lehet.';
    else if (otherNames.some((other) => other.trim().toLowerCase() === name.toLowerCase())) {
      errors.name = 'Ilyen nevű színtér már van. Válassz másik nevet.';
    }
  }
  if (values.description.length > DESCRIPTION_MAX) {
    errors.description = 'A leírás legfeljebb 2000 karakter lehet.';
  }
  return errors;
}
