#!/usr/bin/env node

import process from 'process';
import program from './program';
import { logger } from '@gxchain2/utils';
import { startNode } from './start';

program
  .command('start')
  .description('start gxchain2')
  .action(async () => {
    try {
      await startNode(program.opts());
    } catch (err) {
      logger.error('Start error:', err);
    }
  });

program.parse(process.argv);
