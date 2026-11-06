import { memoryDocumentHarness } from '../testing/document-harness.js';
import { describeTagStoreContract } from '../tags/tag-store-contract.js';
import { describeDocumentStoreContract } from './document-store-contract.js';

describeDocumentStoreContract('memória', () => Promise.resolve(memoryDocumentHarness()));
describeTagStoreContract('memória', () => Promise.resolve(memoryDocumentHarness()));
