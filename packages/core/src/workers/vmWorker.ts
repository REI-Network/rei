import { setLevel } from '@rei-network/utils';
import { VMWorker } from '../link/vmWorker';

// TODO: move this to init
setLevel('info');

new VMWorker().start();
