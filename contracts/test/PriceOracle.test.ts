import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import pkg from 'hardhat';

import { H100, deployStack } from './helpers.ts';

const { ethers } = pkg;

describe('PriceOracle', () => {
  it('rejects a quote above the ceiling', async () => {
    const { oracle } = await loadFixture(deployStack);
    const ceiling = await oracle.maxPriceWei();

    await expect(oracle.updatePrice(H100, ceiling + 1n, 9000)).to.be.revertedWithCustomError(
      oracle,
      'AboveMaxPrice',
    );
    await expect(oracle.updatePrice(H100, ceiling, 9000)).to.emit(oracle, 'PriceUpdated');
  });

  it('rejects a quote below the floor', async () => {
    const { oracle } = await loadFixture(deployStack);
    const floor = await oracle.floorPriceWei();

    await expect(oracle.updatePrice(H100, floor - 1n, 9000)).to.be.revertedWithCustomError(
      oracle,
      'BelowFloorPrice',
    );
  });

  it('rejects an out-of-range confidence, including in a batch', async () => {
    const { oracle } = await loadFixture(deployStack);

    await expect(
      oracle.updatePrice(H100, ethers.parseEther('1'), 10001),
    ).to.be.revertedWithCustomError(oracle, 'ConfidenceOutOfRange');
    await expect(
      oracle.batchUpdatePrices([H100], [ethers.parseEther('1')], [10001]),
    ).to.be.revertedWithCustomError(oracle, 'ConfidenceOutOfRange');
  });

  it('rejects prices for models that were never benchmarked', async () => {
    const { oracle } = await loadFixture(deployStack);

    await expect(
      oracle.updatePrice('NVIDIA B200', ethers.parseEther('5'), 9000),
    ).to.be.revertedWithCustomError(oracle, 'UnsupportedModel');
    await expect(oracle.getPrice('NVIDIA B200')).to.be.revertedWithCustomError(
      oracle,
      'NoPriceForModel',
    );
  });

  it('only lets the operator or owner push prices', async () => {
    const { outsider, oracle } = await loadFixture(deployStack);

    await expect(
      oracle.connect(outsider).updatePrice(H100, ethers.parseEther('1'), 9000),
    ).to.be.revertedWithCustomError(oracle, 'NotOperator');

    await oracle.setOperator(await outsider.getAddress());
    await expect(oracle.connect(outsider).updatePrice(H100, ethers.parseEther('1'), 9000)).to.emit(
      oracle,
      'PriceUpdated',
    );
  });

  it('keeps the floor below the ceiling when either bound moves', async () => {
    const { oracle } = await loadFixture(deployStack);

    await expect(
      oracle.setFloorPrice((await oracle.maxPriceWei()) + 1n),
    ).to.be.revertedWithCustomError(oracle, 'InvalidPriceBounds');
    await expect(
      oracle.setMaxPrice((await oracle.floorPriceWei()) - 1n),
    ).to.be.revertedWithCustomError(oracle, 'InvalidPriceBounds');
  });

  it('rejects a mismatched batch', async () => {
    const { oracle } = await loadFixture(deployStack);

    await expect(oracle.batchUpdatePrices([H100], [], [9000])).to.be.revertedWithCustomError(
      oracle,
      'ArrayLengthMismatch',
    );
  });
});
