import EthereumJSCommon from '@ethereumjs/common';

import { Common } from '@gxchain2/interface';

import * as constants from './constants';

class CommonImpl extends EthereumJSCommon implements Common {}

export { constants, CommonImpl };
