#!/usr/bin/env node

import process from 'process';
import { program } from 'commander';
import { installOptions, installStartAction, installAccountCommand } from './commands';

installOptions(program);
installStartAction(program);
installAccountCommand(program);
program.parse(process.argv);
