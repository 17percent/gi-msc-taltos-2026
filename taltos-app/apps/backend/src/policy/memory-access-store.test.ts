import { describe, expect, it } from 'vitest';
import { seedMemory } from '../testing/access-fixture.js';
import { describeAccessStoreContract } from './access-store-contract.js';

describeAccessStoreContract('memória', () => Promise.resolve(seedMemory()));

describe('MemoryAccessStore: a tagság nem gyorsítótárazott', () => {
  it('a tagság megszűnése a következő betöltésen látszik', async () => {
    const { store, ids } = seedMemory();
    expect((await store.spaceTarget(ids.author, ids.space))?.membership).toBe('author');
    store.addMember(ids.space, ids.author, 'author', true);
    expect((await store.spaceTarget(ids.author, ids.space))?.membership).toBeNull();
  });
});
