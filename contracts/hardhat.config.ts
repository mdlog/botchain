import path from 'node:path';
import { fileURLToPath } from 'node:url';

import '@nomicfoundation/hardhat-toolbox';
import * as dotenv from 'dotenv';
import { HardhatUserConfig } from 'hardhat/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '.env') });

// A throwaway key keeps `hardhat compile` and `hardhat test` working without a
// .env; every network entry here is a testnet, so it can never move real value.
const FALLBACK_KEY = '0x0000000000000000000000000000000000000000000000000000000000000001';
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? FALLBACK_KEY;

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'paris',
    },
  },
  paths: {
    sources: './contracts',
    tests: './test',
    artifacts: './artifacts',
    cache: './cache',
  },
  networks: {
    'botchain-testnet': {
      url: process.env.BOTCHAIN_RPC_URL ?? 'https://rpc.bohr.life',
      chainId: 968,
      accounts: [PRIVATE_KEY],
      gasPrice: 20_000_000_000,
    },
    hardhat: {
      chainId: 31337,
    },
  },
};

export default config;
