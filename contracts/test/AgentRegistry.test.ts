import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import type { Signer } from 'ethers';
import pkg from 'hardhat';

import { type ContractHandle, deploy } from './helpers.ts';

const { ethers } = pkg;

async function deployAgentRegistry(): Promise<{ registry: ContractHandle; provider: Signer }> {
  const [, provider] = await ethers.getSigners();
  return { registry: await deploy('AgentRegistry'), provider };
}

describe('AgentRegistry', () => {
  it('stores an https endpoint and emits it', async () => {
    const { registry, provider } = await loadFixture(deployAgentRegistry);
    const url = 'https://weathered-star-1234.trycloudflare.com';

    await expect(registry.connect(provider).setAgentUrl(url))
      .to.emit(registry, 'AgentUrlSet')
      .withArgs(await provider.getAddress(), url);

    expect(await registry.getAgentUrl(await provider.getAddress())).to.equal(url);
  });

  it('rejects a plaintext or non-http scheme', async () => {
    const { registry, provider } = await loadFixture(deployAgentRegistry);

    for (const url of [
      'http://agent.example.com',
      'javascript:alert(1)//padding',
      'wss://agent.example.com',
    ]) {
      await expect(registry.connect(provider).setAgentUrl(url)).to.be.revertedWithCustomError(
        registry,
        'InvalidUrlScheme',
      );
    }
  });

  it('rejects an empty or oversized url', async () => {
    const { registry, provider } = await loadFixture(deployAgentRegistry);

    await expect(registry.connect(provider).setAgentUrl('')).to.be.revertedWithCustomError(
      registry,
      'InvalidUrlLength',
    );
    await expect(
      registry.connect(provider).setAgentUrl(`https://${'a'.repeat(250)}.com`),
    ).to.be.revertedWithCustomError(registry, 'InvalidUrlLength');
  });

  it('keeps one endpoint per provider and lets it be replaced', async () => {
    const { registry, provider } = await loadFixture(deployAgentRegistry);
    const [owner] = await ethers.getSigners();

    await registry.connect(provider).setAgentUrl('https://first.trycloudflare.com');
    await registry.connect(provider).setAgentUrl('https://second.trycloudflare.com');

    expect(await registry.getAgentUrl(await provider.getAddress())).to.equal(
      'https://second.trycloudflare.com',
    );
    expect(await registry.getAgentUrl(await owner.getAddress())).to.equal('');
  });
});
