import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import pkg from 'hardhat';

import { balanceOf, deployStack, runLease } from './helpers.ts';

const { ethers } = pkg;
const ONE = ethers.parseEther('1');

describe('ComputeIndexToken', () => {
  it('quotes par while no shares are outstanding', async () => {
    const { cif } = await loadFixture(deployStack);

    expect(await cif.totalSupply()).to.equal(0n);
    expect(await cif.getIndexPrice()).to.equal(ONE);
  });

  it('refuses to mint against a node that has never settled a job', async () => {
    const { provider, cif, nodeId } = await loadFixture(deployStack);

    await expect(
      cif.connect(provider).depositRevenue(nodeId, { value: ONE }),
    ).to.be.revertedWithCustomError(cif, 'ExceedsSettledRevenue');
  });

  it("caps deposits at the node's settled revenue", async () => {
    const deployment = await loadFixture(deployStack);
    const { provider, cif, nodeId } = deployment;
    const revenue = await runLease(deployment, 1n, 1);

    await expect(
      cif.connect(provider).depositRevenue(nodeId, { value: revenue + 1n }),
    ).to.be.revertedWithCustomError(cif, 'ExceedsSettledRevenue');

    await cif.connect(provider).depositRevenue(nodeId, { value: revenue });

    await expect(
      cif.connect(provider).depositRevenue(nodeId, { value: 1n }),
    ).to.be.revertedWithCustomError(cif, 'ExceedsSettledRevenue');
  });

  it('rejects a depositor who does not own the node', async () => {
    const deployment = await loadFixture(deployStack);
    const { outsider, cif, nodeId } = deployment;
    const revenue = await runLease(deployment, 1n, 1);

    await expect(
      cif.connect(outsider).depositRevenue(nodeId, { value: revenue }),
    ).to.be.revertedWithCustomError(cif, 'NotNodeProvider');
  });

  it("rejects a deposit once the node's attestation is revoked", async () => {
    const deployment = await loadFixture(deployStack);
    const { provider, registry, cif, nodeId } = deployment;
    const revenue = await runLease(deployment, 1n, 1);
    await registry.unverifyNode(nodeId);

    await expect(
      cif.connect(provider).depositRevenue(nodeId, { value: revenue }),
    ).to.be.revertedWithCustomError(cif, 'NodeNotVerified');
  });

  it('mints the first deposit at par', async () => {
    const deployment = await loadFixture(deployStack);
    const { provider, cif, nodeId } = deployment;
    const revenue = await runLease(deployment, 1n, 1);

    await cif.connect(provider).depositRevenue(nodeId, { value: revenue });

    expect(await cif.balanceOf(await provider.getAddress())).to.equal(revenue);
    expect(await cif.totalValueLocked()).to.equal(revenue);
    expect(await cif.totalNodesBacked()).to.equal(1n);
    expect(await cif.getIndexPrice()).to.equal(ONE);
  });

  it('only lets the marketplace push protocol revenue', async () => {
    const { outsider, cif } = await loadFixture(deployStack);

    await expect(
      cif.connect(outsider).receiveRevenue({ value: ONE }),
    ).to.be.revertedWithCustomError(cif, 'NotMarketplace');
  });

  it('lifts the index price above par when settlement routes revenue in', async () => {
    const deployment = await loadFixture(deployStack);
    const { provider, marketplace, cif, nodeId } = deployment;

    const revenue = await runLease(deployment, 1n, 1);
    await cif.connect(provider).depositRevenue(nodeId, { value: revenue });
    expect(await cif.getIndexPrice()).to.equal(ONE);

    await marketplace.setIndexFeeBps(1000);
    const secondLease = await runLease(deployment, 2n, 1);
    const fee = (secondLease * 1000n) / 10000n;

    expect(await cif.totalValueLocked()).to.equal(revenue + fee);
    expect(await cif.getIndexPrice()).to.equal(((revenue + fee) * ONE) / revenue);
    expect(await cif.getIndexPrice()).to.be.greaterThan(ONE);
  });

  it('redeems at the index price and books the redemption fee', async () => {
    const deployment = await loadFixture(deployStack);
    const { provider, marketplace, cif, nodeId } = deployment;

    const revenue = await runLease(deployment, 1n, 1);
    await cif.connect(provider).depositRevenue(nodeId, { value: revenue });

    await marketplace.setIndexFeeBps(1000);
    const secondLease = await runLease(deployment, 2n, 1);
    const backing = revenue + (secondLease * 1000n) / 10000n;

    const shares = await cif.balanceOf(await provider.getAddress());
    const gross = (shares * backing) / (await cif.totalSupply());
    const fee = (gross * (await cif.WITHDRAW_FEE_BPS())) / 10000n;

    await expect(cif.connect(provider).withdraw(shares)).to.changeEtherBalance(
      provider,
      gross - fee,
    );

    expect(gross).to.be.greaterThan(shares);
    expect(await cif.balanceOf(await provider.getAddress())).to.equal(0n);
    expect(await cif.totalSupply()).to.equal(0n);
    expect(await cif.totalValueLocked()).to.equal(0n);
    expect(await cif.accruedFees()).to.equal(fee);
    expect(await balanceOf(await cif.getAddress())).to.equal(fee);
  });

  it('lets only the owner sweep accrued fees', async () => {
    const deployment = await loadFixture(deployStack);
    const { owner, provider, outsider, marketplace, cif, nodeId } = deployment;

    const revenue = await runLease(deployment, 1n, 1);
    await cif.connect(provider).depositRevenue(nodeId, { value: revenue });
    await marketplace.setIndexFeeBps(1000);
    await runLease(deployment, 2n, 1);
    await cif.connect(provider).withdraw(await cif.balanceOf(await provider.getAddress()));

    const fees = await cif.accruedFees();
    expect(fees).to.be.greaterThan(0n);

    await expect(
      cif.connect(outsider).sweepFees(await outsider.getAddress()),
    ).to.be.revertedWithCustomError(cif, 'OwnableUnauthorizedAccount');

    await expect(cif.connect(owner).sweepFees(await outsider.getAddress())).to.changeEtherBalance(
      outsider,
      fees,
    );
    expect(await cif.accruedFees()).to.equal(0n);
  });

  it('does not dilute existing holders when a later deposit arrives above par', async () => {
    const deployment = await loadFixture(deployStack);
    const { provider, marketplace, cif, nodeId } = deployment;

    const first = await runLease(deployment, 1n, 1);
    await cif.connect(provider).depositRevenue(nodeId, { value: first });

    await marketplace.setIndexFeeBps(1000);
    await runLease(deployment, 2n, 1);

    const priceBefore = await cif.getIndexPrice();
    const room =
      (await deployment.registry.getNode(nodeId)).totalRevenue -
      (await cif.depositedPerNode(nodeId));
    await cif.connect(provider).depositRevenue(nodeId, { value: room });

    // Rounding on the share calculation can only ever favour existing holders.
    const priceAfter = await cif.getIndexPrice();
    expect(priceAfter).to.be.greaterThanOrEqual(priceBefore);
    expect(priceAfter - priceBefore).to.be.lessThan(1000n);
  });

  it('exposes the standard ERC20 surface', async () => {
    const deployment = await loadFixture(deployStack);
    const { provider, outsider, cif, nodeId } = deployment;
    const revenue = await runLease(deployment, 1n, 1);
    await cif.connect(provider).depositRevenue(nodeId, { value: revenue });

    expect(await cif.name()).to.equal('Compute Index Fund');
    expect(await cif.symbol()).to.equal('CIF');
    expect(await cif.decimals()).to.equal(18n);

    await cif.connect(provider).transfer(await outsider.getAddress(), revenue / 2n);
    expect(await cif.balanceOf(await outsider.getAddress())).to.equal(revenue / 2n);
  });
});
