import '@typechain/hardhat';
import '@nomicfoundation/hardhat-toolbox';
import '@nomiclabs/hardhat-ethers';
import * as dotenv from 'dotenv';
import './tasks';

dotenv.config();

const accounts = process.env.PRIVATE_KEY !== undefined ? process.env.PRIVATE_KEY.split(',') : [];

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
export default {
  typechain: {
    outDir: 'types',
    target: 'ethers-v5'
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_KEY
  },
  namedAccounts: {
    deployer: {
      localhost: 0,
      default: process.env.DEV_ADDR || 0
    }
  },
  solidity: {
    compilers: [
      {
        version: '0.6.2',
        settings: {
          optimizer: {
            enabled: true,
            runs: 100
          },
          debug: {
            revertStrings: 'strip'
          }
        }
      }
    ]
  },
  networks: {
    localhost: {
      url: 'http://127.0.0.1:8545',
      accounts
    },
    'rei-devnet': {
      url: 'http://127.0.0.1:11451',
      accounts
    },
    'rei-testnet': {
      url: 'https://rpc-testnet.rei.network/',
      accounts
    },
    'rei-mainnet': {
      url: 'https://rpc-mainnet.rei.network/',
      accounts
    }
  },
  paths: {
    sources: './src',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts'
  }
};
