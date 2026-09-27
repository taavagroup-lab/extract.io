import { MockBlockchainProvider } from './mock';
import { SolanaBlockchainProvider } from './solana';
import type { BlockchainProvider } from './types';

export * from './types';
export { MockBlockchainProvider, base58, isValidMockAddress } from './mock';
export { SolanaBlockchainProvider } from './solana';

export type BlockchainProviderKind = 'mock' | 'solana';

export function createBlockchainProvider(kind: string = 'mock'): BlockchainProvider {
  switch (kind) {
    case 'mock':
      return new MockBlockchainProvider();
    case 'solana':
      throw new Error(
        'BLOCKCHAIN_PROVIDER=solana is not available yet (future feature). ' +
          `See ${SolanaBlockchainProvider.name} for the planned integration. Use "mock".`,
      );
    default:
      throw new Error(`Unknown BLOCKCHAIN_PROVIDER "${kind}"`);
  }
}
