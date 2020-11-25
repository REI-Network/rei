import { DefaultStateManager } from '@ethereumjs/vm/dist/state';

import { StateManager } from '@gxchain2/interface';

class StateManagerImpl extends DefaultStateManager implements StateManager {}

export { StateManagerImpl };
