import { describe, expect, it } from 'vitest';
import { ERROR_CODES, isErrorCode, statusOf } from './problem.js';

describe('hibakód-katalógus', () => {
  it('felismeri a katalógus kódjait, és elutasítja az ismeretleneket', () => {
    expect(isErrorCode('not_space_member')).toBe(true);
    expect(isErrorCode('document_locked')).toBe(false);
    expect(isErrorCode('toString')).toBe(false);
    expect(isErrorCode(403)).toBe(false);
  });

  it('a kódhoz a B5 szerinti HTTP-státuszt adja', () => {
    expect(statusOf('stale_base_revision')).toBe(412);
    expect(statusOf('internal_error')).toBe(500);
  });

  it('minden státusz érvényes 4xx vagy 5xx', () => {
    for (const status of Object.values(ERROR_CODES)) {
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });
});
