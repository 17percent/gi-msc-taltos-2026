import { describe, expect, it } from 'vitest';
import { apiPath, isUuid } from './paths';

describe('apiPath', () => {
  it('a path-paramétereket kódolja', () => {
    expect(apiPath`/api/v1/spaces/${'a/b?c'}/members/${'../x'}`).toBe(
      '/api/v1/spaces/a%2Fb%3Fc/members/..%2Fx',
    );
  });

  it('isUuid csak szabályos azonosítót enged', () => {
    expect(isUuid('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(isUuid('../admin')).toBe(false);
    expect(isUuid('')).toBe(false);
  });
});
