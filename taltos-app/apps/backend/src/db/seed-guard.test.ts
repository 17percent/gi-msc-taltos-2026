import { describe, expect, it } from 'vitest';
import { assertSeedAllowed } from './seed-guard.js';

describe('seed-védelem (fail-closed)', () => {
  it('csak NODE_ENV=development és TALTOS_ALLOW_SEED=1 együtt engedi a futást', () => {
    expect(() =>
      assertSeedAllowed({ NODE_ENV: 'development', TALTOS_ALLOW_SEED: '1' }),
    ).not.toThrow();
  });

  it.each([
    ['production', 'production'],
    ['hiányzó NODE_ENV', undefined],
    ['elírt NODE_ENV', 'developement'],
    ['test', 'test'],
  ])('NODE_ENV (%s) mellett megtagadja, még engedéllyel is', (_name, nodeEnv) => {
    expect(() => assertSeedAllowed({ NODE_ENV: nodeEnv, TALTOS_ALLOW_SEED: '1' })).toThrow(
      'NODE_ENV=development',
    );
  });

  it.each([undefined, '', '0', 'true', 'yes'])(
    'development mellett is kifejezett engedély nélkül (TALTOS_ALLOW_SEED=%s) megtagadja',
    (flag) => {
      expect(() => assertSeedAllowed({ NODE_ENV: 'development', TALTOS_ALLOW_SEED: flag })).toThrow(
        'TALTOS_ALLOW_SEED=1',
      );
    },
  );
});
