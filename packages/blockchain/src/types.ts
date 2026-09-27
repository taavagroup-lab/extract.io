/**
 * Chain-agnostic blockchain boundary. Game logic and the API only ever talk
 * to this interface; chain SDKs (e.g. @solana/web3.js) stay inside provider
 * implementations.
 */

export type ChainId = 'mock' | 'solana-devnet' | 'solana-mainnet';

export interface Wallet {
  address: string;
  chain: ChainId;
  provider: string;
}

export interface ConnectWalletOptions {
  /** Address claimed by the client wallet (Phantom, Solflare, embedded...). */
  address?: string;
  /** Signed nonce proving control of `address` (verified by real providers). */
  signature?: string;
  message?: string;
}

export interface AssetMetadata {
  name: string;
  rarity: string;
  itemId: string;
  serialNumber: number | null;
  maxSupply: number | null;
  seasonId: string | null;
}

export interface MintItemRequest {
  inventoryItemId: string;
  ownerAddress: string;
  metadata: AssetMetadata;
}

export interface MintResult {
  chain: ChainId;
  mintAddress: string;
  tokenId: string;
  blockchainAssetId: string;
  txSignature: string;
}

export interface TransferItemRequest {
  mintAddress: string;
  fromAddress: string;
  toAddress: string;
}

export interface BurnItemRequest {
  mintAddress: string;
  ownerAddress: string;
}

export interface TxResult {
  txSignature: string;
}

export interface BlockchainProvider {
  readonly name: string;
  readonly chain: ChainId;
  connectWallet(options?: ConnectWalletOptions): Promise<Wallet>;
  /** Native balance of an address (display only). */
  getBalance(address: string): Promise<number>;
  mintItem(request: MintItemRequest): Promise<MintResult>;
  transferItem(request: TransferItemRequest): Promise<TxResult>;
  burnItem(request: BurnItemRequest): Promise<TxResult>;
  getAssetOwner(mintAddress: string): Promise<string | null>;
}

export class BlockchainError extends Error {
  constructor(
    readonly code: 'NOT_IMPLEMENTED' | 'INVALID_ADDRESS' | 'NOT_OWNER' | 'UNKNOWN_ASSET',
    message: string,
  ) {
    super(message);
    this.name = 'BlockchainError';
  }
}
