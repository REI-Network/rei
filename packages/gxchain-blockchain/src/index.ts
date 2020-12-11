import EthereumJSBlockchain, { BlockchainOptions } from '@ethereumjs/blockchain';

class Blockchain extends EthereumJSBlockchain {
  private static installBlockchain?: (blockchain: Blockchain) => void;
  static initBlockchainImpl(installBlockchain: (blockchain: Blockchain) => void) {
    if (Blockchain.installBlockchain) {
      throw new Error('Repeated init BlockchainImpl');
    }
    Blockchain.installBlockchain = installBlockchain;
  }

  constructor(opt: BlockchainOptions = {}) {
    if (!Blockchain.installBlockchain) {
      throw new Error('You must init BlockchainImpl before create object');
    }
    super(opt);
    Blockchain.installBlockchain(this);
  }
}

export { Blockchain };
