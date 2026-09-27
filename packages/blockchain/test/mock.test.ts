import { describe, expect, it } from 'vitest';
import { BlockchainError, MockBlockchainProvider, createBlockchainProvider } from '../src';

describe('MockBlockchainProvider', () => {
  const meta = { name: 'Genesis Crown', rarity: 'MYTHIC', itemId: 'genesis_crown', serialNumber: 73, maxSupply: 1000, seasonId: 'season-1' };

  it('connects wallets and mints to the owner', async () => {
    const chain = new MockBlockchainProvider();
    const wallet = await chain.connectWallet();
    const mint = await chain.mintItem({ inventoryItemId: 'inv1', ownerAddress: wallet.address, metadata: meta });
    expect(mint.tokenId).toBe('73');
    expect(await chain.getAssetOwner(mint.mintAddress)).toBe(wallet.address);
  });

  it('only the owner can transfer or burn', async () => {
    const chain = new MockBlockchainProvider();
    const a = await chain.connectWallet();
    const b = await chain.connectWallet();
    const mint = await chain.mintItem({ inventoryItemId: 'inv2', ownerAddress: a.address, metadata: meta });
    await expect(chain.transferItem({ mintAddress: mint.mintAddress, fromAddress: b.address, toAddress: b.address })).rejects.toBeInstanceOf(
      BlockchainError,
    );
    await chain.transferItem({ mintAddress: mint.mintAddress, fromAddress: a.address, toAddress: b.address });
    expect(await chain.getAssetOwner(mint.mintAddress)).toBe(b.address);
    await expect(chain.burnItem({ mintAddress: mint.mintAddress, ownerAddress: a.address })).rejects.toBeInstanceOf(BlockchainError);
    await chain.burnItem({ mintAddress: mint.mintAddress, ownerAddress: b.address });
    expect(await chain.getAssetOwner(mint.mintAddress)).toBeNull();
  });

  it('factory refuses the unimplemented solana provider', () => {
    expect(() => createBlockchainProvider('solana')).toThrow(/future feature/);
    expect(createBlockchainProvider('mock').name).toBe('mock');
  });
});
