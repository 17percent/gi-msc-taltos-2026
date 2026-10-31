const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Az útvonal-paraméterként érkező azonosító (pl. `:spaceId`) szabályos UUID-e. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * Címke-sablon API-útvonalhoz: a beillesztett értékeket `encodeURIComponent`-tel kódolja,
 * így egy `../` vagy `?` tartalmú paraméter nem tud más végpontra mutatni.
 *
 * @example apiPath`/api/v1/spaces/${id}/members/${userId}`
 */
export function apiPath(strings: TemplateStringsArray, ...values: string[]): string {
  return strings.reduce(
    (path, part, index) =>
      path + part + (index < values.length ? encodeURIComponent(values[index] ?? '') : ''),
    '',
  );
}
