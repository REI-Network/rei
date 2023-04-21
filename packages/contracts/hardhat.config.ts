import '@typechain/hardhat';
import '@nomicfoundation/hardhat-toolbox';
import '@nomiclabs/hardhat-ethers';
import './tasks';

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const accounts = {
  mnemonic: process.env.MNEMONIC || 'test test test test test test test test test test test junk'
};

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
      live: false,
      saveDeployments: true,
      url: 'http://127.0.0.1:8545',
      loggingEnabled: true
    },
    'rei-devnet': {
      live: false,
      saveDeployments: true,
      url: 'http://127.0.0.1:11451',
      accounts,
      chainId: 23579
    },
    'rei-testnet': {
      url: 'https://rpc-testnet.rei.network/',
      accounts,
      chainId: 12357,
      live: true,
      saveDeployments: true
    },
    'rei-mainnet': {
      url: 'https://rpc-mainnet.rei.network/',
      accounts,
      chainId: 47805,
      live: true,
      saveDeployments: true
    }
  },
  paths: {
    sources: './src',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts'
  }
};
