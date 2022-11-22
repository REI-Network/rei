import { logger } from '@rei-network/utils';
import { handleSIGINT } from '../handleSignals';
import { startServices, stopServices } from '../services';

export function installStartAction(program: any) {
  program.action(async () => {
    try {
      const services = await startServices(program.opts());
      handleSIGINT(stopServices.bind(undefined, services));
    } catch (err) {
      logger.error('Start error:', err);
      process.exit(1);
    }
  });
}
