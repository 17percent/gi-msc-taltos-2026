import { memoryHarness } from '../testing/space-harness.js';
import { describeSpaceStoreContract } from './space-store-contract.js';

describeSpaceStoreContract('memória', () => Promise.resolve(memoryHarness()));
