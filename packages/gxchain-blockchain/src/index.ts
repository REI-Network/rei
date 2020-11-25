import EthereumJSBlockchain, { BlockchainOptions } from '@ethereumjs/blockchain';

class BlockchainImpl extends EthereumJSBlockchain {
  private static installBlockchain?: (blockchain: BlockchainImpl) => void;
  static initBlockchainImpl(installBlockchain: (blockchain: BlockchainImpl) => void) {
    if (BlockchainImpl.installBlockchain) {
      throw new Error('Repeated init BlockchainImpl');
    }
    BlockchainImpl.installBlockchain = installBlockchain;
  }

  constructor(opt: BlockchainOptions = {}) {
    if (!BlockchainImpl.installBlockchain) {
      throw new Error('You must init BlockchainImpl before create object');
    }
    super(opt);
    BlockchainImpl.installBlockchain(this);
  }
}

export { BlockchainImpl };
