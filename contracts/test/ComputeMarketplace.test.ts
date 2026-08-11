import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import pkg from 'hardhat';

import {
  CPU_PER_HOUR,
  H100,
  H100_PER_HOUR,
  HOUR,
  balanceOf,
  deploy,
  deployStack,
  gasCost,
  registerNode,
} from './helpers.ts';

const { ethers } = pkg;

const JOB_TYPE = 'Inference';
const SPEC = 'ipfs://spec';

describe('ComputeMarketplace', () => {
  describe('escrow conservation', () => {
    it('pays out exactly what the consumer escrowed across create → accept → complete', async () => {
      const { provider, consumer, marketplace, registry, nodeId } = await loadFixture(deployStack);

      const escrow = H100_PER_HOUR * 2n;
      const providerAddr = await provider.getAddress();
      const consumerAddr = await consumer.getAddress();
      const marketplaceAddr = await marketplace.getAddress();

      const providerBefore = await balanceOf(providerAddr);
      const consumerBefore = await balanceOf(consumerAddr);

      const createTx = await marketplace
        .connect(consumer)
        .createJob(nodeId, JOB_TYPE, SPEC, 2, { value: escrow });
      const createReceipt = await createTx.wait();

      const acceptTx = await marketplace.connect(provider).acceptJob(1);
      const acceptReceipt = await acceptTx.wait();

      const job = await marketplace.getJob(1);
      await time.setNextBlockTimestamp(Number(job.startedAt) + HOUR);

      const completeTx = await marketplace.connect(provider).completeJob(1);
      const completeReceipt = await completeTx.wait();

      const cost = H100_PER_HOUR;
      const refund = escrow - cost;

      expect(await balanceOf(marketplaceAddr)).to.equal(0n);
      expect(
        (await balanceOf(providerAddr)) -
          providerBefore +
          gasCost(acceptReceipt) +
          gasCost(completeReceipt),
      ).to.equal(cost);
      expect(consumerBefore - (await balanceOf(consumerAddr)) - gasCost(createReceipt)).to.equal(
        escrow - refund,
      );

      expect(await marketplace.totalVolumeWei()).to.equal(cost);
      expect((await registry.getNode(nodeId)).totalRevenue).to.equal(cost);
      expect((await marketplace.getJob(1)).status).to.equal(2);
    });

    it('splits settled revenue between the provider and the index fund without leaking escrow', async () => {
      const { provider, consumer, marketplace, cif, nodeId } = await loadFixture(deployStack);
      await marketplace.setIndexFeeBps(1000);

      const escrow = H100_PER_HOUR * 2n;
      const providerAddr = await provider.getAddress();
      const cifAddr = await cif.getAddress();

      const providerBefore = await balanceOf(providerAddr);

      await marketplace.connect(consumer).createJob(nodeId, JOB_TYPE, SPEC, 2, { value: escrow });
      const acceptReceipt = await (await marketplace.connect(provider).acceptJob(1)).wait();
      const job = await marketplace.getJob(1);
      await time.setNextBlockTimestamp(Number(job.startedAt) + HOUR);
      const completeReceipt = await (await marketplace.connect(provider).completeJob(1)).wait();

      const cost = H100_PER_HOUR;
      const fee = (cost * 1000n) / 10000n;

      expect(await balanceOf(cifAddr)).to.equal(fee);
      expect(await cif.totalValueLocked()).to.equal(fee);
      expect(
        (await balanceOf(providerAddr)) -
          providerBefore +
          gasCost(acceptReceipt) +
          gasCost(completeReceipt),
      ).to.equal(cost - fee);
      expect(await balanceOf(await marketplace.getAddress())).to.equal(0n);
    });

    it('credits a refund the consumer cannot receive instead of bricking the provider payout', async () => {
      const { provider, consumer, marketplace, nodeId } = await loadFixture(deployStack);

      const mock = await deploy('MockConsumer');
      const mockAddr = await mock.getAddress();
      const marketplaceAddr = await marketplace.getAddress();

      const escrow = H100_PER_HOUR * 2n;
      await mock
        .connect(consumer)
        .forward(
          marketplaceAddr,
          marketplace.interface.encodeFunctionData('createJob', [nodeId, JOB_TYPE, SPEC, 2]),
          {
            value: escrow,
          },
        );

      await marketplace.connect(provider).acceptJob(1);
      const job = await marketplace.getJob(1);
      await time.setNextBlockTimestamp(Number(job.startedAt) + HOUR);

      const providerAddr = await provider.getAddress();
      const providerBefore = await balanceOf(providerAddr);
      const completeReceipt = await (await marketplace.connect(provider).completeJob(1)).wait();

      const refund = escrow - H100_PER_HOUR;
      expect((await balanceOf(providerAddr)) - providerBefore + gasCost(completeReceipt)).to.equal(
        H100_PER_HOUR,
      );
      expect(await marketplace.pendingWithdrawals(mockAddr)).to.equal(refund);
      expect(await balanceOf(marketplaceAddr)).to.equal(refund);

      await mock.setAccepting(true);
      await mock
        .connect(consumer)
        .forward(marketplaceAddr, marketplace.interface.encodeFunctionData('withdrawPending', []));

      expect(await marketplace.pendingWithdrawals(mockAddr)).to.equal(0n);
      expect(await balanceOf(mockAddr)).to.equal(refund);
      expect(await balanceOf(marketplaceAddr)).to.equal(0n);
    });
  });

  describe('createJob guards', () => {
    it('reverts when the node has never been verified', async () => {
      const { provider, consumer, registry, marketplace } = await loadFixture(deployStack);
      const unverified = await registerNode(registry, provider, H100, 80, 1979, 'us-east');
      await registry.connect(provider).updateStatus(unverified, 1);

      await expect(
        marketplace
          .connect(consumer)
          .createJob(unverified, JOB_TYPE, SPEC, 1, { value: H100_PER_HOUR }),
      ).to.be.revertedWithCustomError(marketplace, 'NodeNotVerified');
    });

    it('reverts when the node is not Active', async () => {
      const { provider, consumer, registry, marketplace, nodeId } = await loadFixture(deployStack);
      await registry.connect(provider).updateStatus(nodeId, 3);

      await expect(
        marketplace
          .connect(consumer)
          .createJob(nodeId, JOB_TYPE, SPEC, 1, { value: H100_PER_HOUR }),
      ).to.be.revertedWithCustomError(marketplace, 'NodeNotActive');
    });

    it('reverts once the oracle quote is older than MAX_PRICE_AGE', async () => {
      const { consumer, marketplace, nodeId } = await loadFixture(deployStack);
      await time.increase(Number(await marketplace.MAX_PRICE_AGE()) + 1);

      await expect(
        marketplace
          .connect(consumer)
          .createJob(nodeId, JOB_TYPE, SPEC, 1, { value: H100_PER_HOUR }),
      ).to.be.revertedWithCustomError(marketplace, 'StalePrice');
    });

    it("reverts when the quote's confidence is below the configured floor", async () => {
      const { consumer, marketplace, nodeId } = await loadFixture(deployStack);
      await marketplace.setMinConfidenceBps(9000);

      await expect(
        marketplace
          .connect(consumer)
          .createJob(nodeId, JOB_TYPE, SPEC, 1, { value: H100_PER_HOUR }),
      ).to.be.revertedWithCustomError(marketplace, 'LowConfidence');
    });

    it('reverts on a zero or oversized duration', async () => {
      const { consumer, marketplace, nodeId } = await loadFixture(deployStack);

      await expect(
        marketplace
          .connect(consumer)
          .createJob(nodeId, JOB_TYPE, SPEC, 0, { value: H100_PER_HOUR }),
      ).to.be.revertedWithCustomError(marketplace, 'InvalidDuration');

      const tooLong = (await marketplace.MAX_DURATION_HOURS()) + 1n;
      await expect(
        marketplace
          .connect(consumer)
          .createJob(nodeId, JOB_TYPE, SPEC, tooLong, { value: H100_PER_HOUR }),
      ).to.be.revertedWithCustomError(marketplace, 'InvalidDuration');
    });
  });

  describe('price spoofing', () => {
    it('takes no caller-supplied GPU model', async () => {
      const { marketplace } = await loadFixture(deployStack);
      const fragment = marketplace.interface.getFunction('createJob');

      expect(fragment?.inputs.map((input) => input.name)).to.deep.equal([
        'nodeId',
        'jobType',
        'specHash',
        'durationHours',
      ]);
    });

    it('rejects leasing an H100 node at the CPU rate', async () => {
      const { consumer, marketplace, nodeId } = await loadFixture(deployStack);

      await expect(
        marketplace.connect(consumer).createJob(nodeId, JOB_TYPE, SPEC, 1, { value: CPU_PER_HOUR }),
      ).to.be.revertedWithCustomError(marketplace, 'InsufficientPayment');
    });

    it("prices the lease from the node's own registered model", async () => {
      const { consumer, marketplace, nodeId } = await loadFixture(deployStack);

      await marketplace
        .connect(consumer)
        .createJob(nodeId, JOB_TYPE, SPEC, 1, { value: H100_PER_HOUR });

      expect((await marketplace.getJob(1)).pricePerHourWei).to.equal(H100_PER_HOUR);
    });
  });

  describe('settleExpiredJob', () => {
    it('reverts before the lease and its grace window have elapsed', async () => {
      const { provider, consumer, outsider, marketplace, nodeId } = await loadFixture(deployStack);
      await marketplace
        .connect(consumer)
        .createJob(nodeId, JOB_TYPE, SPEC, 1, { value: H100_PER_HOUR * 2n });
      await marketplace.connect(provider).acceptJob(1);

      await expect(marketplace.connect(outsider).settleExpiredJob(1)).to.be.revertedWithCustomError(
        marketplace,
        'LeaseNotExpired',
      );
    });

    it('lets anyone settle an abandoned lease and releases the whole escrow', async () => {
      const { provider, consumer, outsider, marketplace, registry, nodeId } =
        await loadFixture(deployStack);

      const escrow = H100_PER_HOUR * 2n;
      await marketplace.connect(consumer).createJob(nodeId, JOB_TYPE, SPEC, 1, { value: escrow });
      await marketplace.connect(provider).acceptJob(1);

      const providerAddr = await provider.getAddress();
      const consumerAddr = await consumer.getAddress();
      const providerBefore = await balanceOf(providerAddr);
      const consumerBefore = await balanceOf(consumerAddr);

      await time.increaseTo(await marketplace.settleableAt(1));
      await marketplace.connect(outsider).settleExpiredJob(1);

      const cost = H100_PER_HOUR;
      expect((await balanceOf(providerAddr)) - providerBefore).to.equal(cost);
      expect((await balanceOf(consumerAddr)) - consumerBefore).to.equal(escrow - cost);
      expect(await balanceOf(await marketplace.getAddress())).to.equal(0n);
      expect((await registry.getNode(nodeId)).totalRevenue).to.equal(cost);
      expect((await marketplace.getJob(1)).status).to.equal(2);
    });

    it('cannot be replayed once the job is settled', async () => {
      const { provider, consumer, outsider, marketplace, nodeId } = await loadFixture(deployStack);
      await marketplace
        .connect(consumer)
        .createJob(nodeId, JOB_TYPE, SPEC, 1, { value: H100_PER_HOUR });
      await marketplace.connect(provider).acceptJob(1);
      await time.increaseTo(await marketplace.settleableAt(1));
      await marketplace.connect(outsider).settleExpiredJob(1);

      await expect(marketplace.connect(outsider).settleExpiredJob(1)).to.be.revertedWithCustomError(
        marketplace,
        'JobNotActive',
      );
    });
  });

  describe('extendJob', () => {
    it('extends the same job at the rate locked when it was created', async () => {
      const { provider, consumer, oracle, marketplace, nodeId } = await loadFixture(deployStack);

      const escrow = H100_PER_HOUR * 2n;
      await marketplace.connect(consumer).createJob(nodeId, JOB_TYPE, SPEC, 2, { value: escrow });
      await marketplace.connect(provider).acceptJob(1);

      await oracle.updatePrice(H100, ethers.parseEther('10'), 9000);

      await expect(
        marketplace.connect(consumer).extendJob(1, 2, { value: H100_PER_HOUR * 2n }),
      ).to.emit(marketplace, 'JobExtended');

      const job = await marketplace.getJob(1);
      expect(await marketplace.nextJobId()).to.equal(2n);
      expect(job.durationHours).to.equal(4n);
      expect(job.pricePerHourWei).to.equal(H100_PER_HOUR);
      expect(job.paymentAmount).to.equal(escrow * 2n);
      expect(job.status).to.equal(1);
    });

    it('rejects a caller who is not the consumer', async () => {
      const { provider, consumer, outsider, marketplace, nodeId } = await loadFixture(deployStack);
      await marketplace
        .connect(consumer)
        .createJob(nodeId, JOB_TYPE, SPEC, 1, { value: H100_PER_HOUR });
      await marketplace.connect(provider).acceptJob(1);

      await expect(
        marketplace.connect(outsider).extendJob(1, 1, { value: H100_PER_HOUR }),
      ).to.be.revertedWithCustomError(marketplace, 'NotConsumer');
    });

    it('rejects an underfunded extension', async () => {
      const { consumer, marketplace, nodeId } = await loadFixture(deployStack);
      await marketplace
        .connect(consumer)
        .createJob(nodeId, JOB_TYPE, SPEC, 1, { value: H100_PER_HOUR });

      await expect(
        marketplace.connect(consumer).extendJob(1, 2, { value: H100_PER_HOUR }),
      ).to.be.revertedWithCustomError(marketplace, 'InsufficientPayment');
    });

    it('pays the provider for the extended duration', async () => {
      const { provider, consumer, marketplace, nodeId } = await loadFixture(deployStack);
      await marketplace
        .connect(consumer)
        .createJob(nodeId, JOB_TYPE, SPEC, 1, { value: H100_PER_HOUR });
      await marketplace.connect(provider).acceptJob(1);
      await marketplace.connect(consumer).extendJob(1, 1, { value: H100_PER_HOUR });

      const providerAddr = await provider.getAddress();
      const providerBefore = await balanceOf(providerAddr);

      await time.increaseTo(await marketplace.settleableAt(1));
      await marketplace.settleExpiredJob(1);

      expect((await balanceOf(providerAddr)) - providerBefore).to.equal(H100_PER_HOUR * 2n);
    });
  });

  describe('cancelJob', () => {
    it('refunds the full escrow before acceptance and blocks a second cancel', async () => {
      const { consumer, marketplace, nodeId } = await loadFixture(deployStack);
      const escrow = H100_PER_HOUR * 2n;
      await marketplace.connect(consumer).createJob(nodeId, JOB_TYPE, SPEC, 2, { value: escrow });

      await expect(marketplace.connect(consumer).cancelJob(1)).to.changeEtherBalance(
        consumer,
        escrow,
      );
      await expect(marketplace.connect(consumer).cancelJob(1)).to.be.revertedWithCustomError(
        marketplace,
        'JobNotPending',
      );
    });
  });

  describe('admin', () => {
    it('caps the index fee and rejects non-owners', async () => {
      const { outsider, marketplace } = await loadFixture(deployStack);
      const cap = await marketplace.MAX_INDEX_FEE_BPS();

      await expect(marketplace.setIndexFeeBps(cap + 1n)).to.be.revertedWithCustomError(
        marketplace,
        'FeeTooHigh',
      );
      await expect(marketplace.connect(outsider).setIndexFeeBps(100)).to.be.revertedWithCustomError(
        marketplace,
        'OwnableUnauthorizedAccount',
      );
    });

    it('skips the index cut cleanly when no fund is configured', async () => {
      const { provider, consumer, marketplace, nodeId } = await loadFixture(deployStack);
      await marketplace.setIndexFeeBps(1000);
      await marketplace.setIndexFund(ethers.ZeroAddress);

      await marketplace
        .connect(consumer)
        .createJob(nodeId, JOB_TYPE, SPEC, 1, { value: H100_PER_HOUR });
      await marketplace.connect(provider).acceptJob(1);

      const providerAddr = await provider.getAddress();
      const providerBefore = await balanceOf(providerAddr);
      await time.increaseTo(await marketplace.settleableAt(1));
      await marketplace.settleExpiredJob(1);

      expect((await balanceOf(providerAddr)) - providerBefore).to.equal(H100_PER_HOUR);
    });
  });
});
