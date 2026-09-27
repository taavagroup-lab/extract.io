import {
  BlockchainError,
  type BlockchainProvider,
  type BurnItemRequest,
  type ChainId,
  type ConnectWalletOptions,
  type MintItemRequest,
  type MintResult,
  type TransferItemRequest,
  type TxResult,
  type Wallet,
} from './types';

export interface SolanaProviderOptions {
  rpcUrl: string;
  cluster: 'devnet' | 'mainnet';
}

/**
 * FUTURE FEATURE: Solana implementation of the BlockchainProvider interface.
 *
 * Planned implementation (kept out of the MVP on purpose):
 *  - connectWallet: verify an ed25519 signature of a server nonce (Phantom / Solflare / embedded wallet)
 *  - mintItem: Metaplex Core / compressed NFT mint with item metadata
 *  - transferItem / burnItem: SPL token instructions signed by the custody or user wallet
 *
 * Only this file will import the Solana SDK. Selecting BLOCKCHAIN_PROVIDER=solana
 * today fails fast at startup instead of silently pretending to work.
 */
export class SolanaBlockchainProvider implements BlockchainProvider {
  readonly name = 'solana';
  readonly chain: ChainId;

  constructor(readonly options: SolanaProviderOptions) {
    this.chain = options.cluster === 'mainnet' ? 'solana-mainnet' : 'solana-devnet';
  }

  private notImplemented(): never {
    throw new BlockchainError('NOT_IMPLEMENTED', 'SolanaBlockchainProvider is a future feature; use BLOCKCHAIN_PROVIDER=mock');
  }

  connectWallet(_options?: ConnectWalletOptions): Promise<Wallet> {
    return this.notImplemented();
  }
  getBalance(_address: string): Promise<number> {
    return this.notImplemented();
  }
  mintItem(_request: MintItemRequest): Promise<MintResult> {
    return this.notImplemented();
  }
  transferItem(_request: TransferItemRequest): Promise<TxResult> {
    return this.notImplemented();
  }
  burnItem(_request: BurnItemRequest): Promise<TxResult> {
    return this.notImplemented();
  }
  getAssetOwner(_mintAddress: string): Promise<string | null> {
    return this.notImplemented();
  }
}
