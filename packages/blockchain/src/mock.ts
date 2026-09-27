import { createHash, randomBytes } from 'node:crypto';
import {
  BlockchainError,
  type BlockchainProvider,
  type BurnItemRequest,
  type ConnectWalletOptions,
  type MintItemRequest,
  type MintResult,
  type TransferItemRequest,
  type TxResult,
  type Wallet,
} from './types';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) + BigInt(b);
  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out || '1';
}

const ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidMockAddress(address: string): boolean {
  return ADDRESS_RE.test(address);
}

/**
 * In-memory blockchain for development and tests. Behaves like a real
 * provider (ownership checks, unique mint addresses) without any network.
 */
export class MockBlockchainProvider implements BlockchainProvider {
  readonly name = 'mock';
  readonly chain = 'mock' as const;
  private readonly owners = new Map<string, string>();
  private readonly balances = new Map<string, number>();

  async connectWallet(options: ConnectWalletOptions = {}): Promise<Wallet> {
    const address = options.address ?? base58(randomBytes(32));
    if (!isValidMockAddress(address)) throw new BlockchainError('INVALID_ADDRESS', 'Invalid wallet address');
    if (!this.balances.has(address)) this.balances.set(address, 10);
    return { address, chain: this.chain, provider: this.name };
  }

  async getBalance(address: string): Promise<number> {
    return this.balances.get(address) ?? 0;
  }

  async mintItem(request: MintItemRequest): Promise<MintResult> {
    if (!isValidMockAddress(request.ownerAddress)) throw new BlockchainError('INVALID_ADDRESS', 'Invalid owner address');
    const mintAddress = base58(randomBytes(32));
    this.owners.set(mintAddress, request.ownerAddress);
    const assetId = createHash('sha256').update(`${request.inventoryItemId}:${mintAddress}`).digest('hex').slice(0, 32);
    return {
      chain: this.chain,
      mintAddress,
      tokenId: String(request.metadata.serialNumber ?? 1),
      blockchainAssetId: assetId,
      txSignature: base58(randomBytes(64)),
    };
  }

  async transferItem(request: TransferItemRequest): Promise<TxResult> {
    const owner = this.owners.get(request.mintAddress);
    if (!owner) throw new BlockchainError('UNKNOWN_ASSET', 'Unknown asset');
    if (owner !== request.fromAddress) throw new BlockchainError('NOT_OWNER', 'Sender does not own this asset');
    if (!isValidMockAddress(request.toAddress)) throw new BlockchainError('INVALID_ADDRESS', 'Invalid recipient');
    this.owners.set(request.mintAddress, request.toAddress);
    return { txSignature: base58(randomBytes(64)) };
  }

  async burnItem(request: BurnItemRequest): Promise<TxResult> {
    const owner = this.owners.get(request.mintAddress);
    if (!owner) throw new BlockchainError('UNKNOWN_ASSET', 'Unknown asset');
    if (owner !== request.ownerAddress) throw new BlockchainError('NOT_OWNER', 'Only the owner can burn');
    this.owners.delete(request.mintAddress);
    return { txSignature: base58(randomBytes(64)) };
  }

  async getAssetOwner(mintAddress: string): Promise<string | null> {
    return this.owners.get(mintAddress) ?? null;
  }
}
