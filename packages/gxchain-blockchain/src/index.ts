import EthereumJSBlockchain from '@ethereumjs/blockchain';

import { Blockchain } from '@gxchain2/interface';

class BlockchainImpl extends EthereumJSBlockchain implements Blockchain {}

export { BlockchainImpl };
