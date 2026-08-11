import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import pkg from 'hardhat';

import { CPU, H100, H100_PER_HOUR, deploy, deployStack, registerNode } from './helpers.ts';

const { ethers } = pkg;

describe('ComputeRegistry', () => {
  describe('verification', () => {
    it('reverts when a non-verifier tries to verify a node', async () => {
      const { provider, outsider, registry } = await loadFixture(deployStack);
      const nodeId = await registerNode(registry, provider, H100, 80, 1979, 'us-east');

      await expect(registry.connect(outsider).verifyNode(nodeId)).to.be.revertedWithCustomError(
        registry,
        'NotVerifier',
      );
      await expect(registry.connect(provider).verifyNode(nodeId)).to.be.revertedWithCustomError(
        registry,
        'NotVerifier',
      );
      expect((await registry.getNode(nodeId)).verified).to.equal(false);
    });

    it('lets the owner rotate the verifier key', async () => {
      const { owner, provider, outsider, registry } = await loadFixture(deployStack);
      const nodeId = await registerNode(registry, provider, H100, 80, 1979, 'us-east');

      await expect(
        registry.connect(outsider).setVerifier(await outsider.getAddress()),
      ).to.be.revertedWithCustomError(registry, 'OwnableUnauthorizedAccount');

      await expect(registry.connect(owner).setVerifier(await outsider.getAddress()))
        .to.emit(registry, 'VerifierSet')
        .withArgs(await outsider.getAddress());

      await registry.connect(outsider).verifyNode(nodeId);
      expect((await registry.getNode(nodeId)).verified).to.equal(true);
    });

    it('revokes an attestation and blocks new leases', async () => {
      const { consumer, registry, marketplace, nodeId } = await loadFixture(deployStack);

      await expect(registry.unverifyNode(nodeId)).to.emit(registry, 'NodeUnverified');
      expect((await registry.getNode(nodeId)).verified).to.equal(false);

      await expect(
        marketplace
          .connect(consumer)
          .createJob(nodeId, 'Inference', 'spec', 1, { value: H100_PER_HOUR }),
      ).to.be.revertedWithCustomError(marketplace, 'NodeNotVerified');
    });
  });

  describe('marketplace wiring', () => {
    it('cannot be claimed by an arbitrary caller while unset', async () => {
      const [, , , outsider] = await ethers.getSigners();
      const registry = await deploy('ComputeRegistry');

      expect(await registry.marketplace()).to.equal(ethers.ZeroAddress);
      await expect(
        registry.connect(outsider).setMarketplace(await outsider.getAddress()),
      ).to.be.revertedWithCustomError(registry, 'OwnableUnauthorizedAccount');
    });

    it('only lets the marketplace book revenue', async () => {
      const { outsider, registry, nodeId } = await loadFixture(deployStack);

      await expect(registry.connect(outsider).addRevenue(nodeId, 1)).to.be.revertedWithCustomError(
        registry,
        'NotMarketplace',
      );
    });
  });

  describe('registration', () => {
    it('accepts a CPU-only node with no dedicated VRAM', async () => {
      const { provider, registry } = await loadFixture(deployStack);

      const nodeId = await registerNode(registry, provider, CPU, 0, 40, 'ap-south');
      const node = await registry.getNode(nodeId);

      expect(node.specs.model).to.equal(CPU);
      expect(node.specs.vramGB).to.equal(0n);
      expect(node.provider).to.equal(await provider.getAddress());
    });

    it('requires a model name', async () => {
      const { provider, registry } = await loadFixture(deployStack);

      await expect(
        registry.connect(provider).registerNode('', 24, 100, 'eu-west'),
      ).to.be.revertedWithCustomError(registry, 'ModelRequired');
    });

    it('reverts when reading a node that was never registered', async () => {
      const { registry } = await loadFixture(deployStack);

      await expect(registry.getNode(1)).to.be.revertedWithCustomError(registry, 'NodeNotFound');
    });
  });

  describe('status', () => {
    it('tracks the active node count in both directions', async () => {
      const { provider, registry, nodeId } = await loadFixture(deployStack);

      expect(await registry.totalActiveNodes()).to.equal(1n);
      await registry.connect(provider).updateStatus(nodeId, 3);
      expect(await registry.totalActiveNodes()).to.equal(0n);
      await registry.connect(provider).updateStatus(nodeId, 1);
      expect(await registry.totalActiveNodes()).to.equal(1n);
    });

    it("only lets the node's provider update it", async () => {
      const { outsider, registry, nodeId } = await loadFixture(deployStack);

      await expect(
        registry.connect(outsider).updateStatus(nodeId, 0),
      ).to.be.revertedWithCustomError(registry, 'NotNodeProvider');
      await expect(registry.connect(outsider).heartbeat(nodeId)).to.be.revertedWithCustomError(
        registry,
        'NotNodeProvider',
      );
    });
  });
});
