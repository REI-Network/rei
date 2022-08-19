#!/usr/bin/env node

import process from 'process';
import { program } from 'commander';
import { installOptions, installStartAction, installAccountCommand, installIpcCommand } from './commands';

installOptions(program);
installStartAction(program);
installAccountCommand(program);
installIpcCommand(program);
program.parse(process.argv);
