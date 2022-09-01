#!/usr/bin/env node

import process from 'process';
import { program } from 'commander';
import { installOptions, installStartAction, installAccountCommand, installAttachCommand, installConsoleCommand } from './commands';

installOptions(program);
installStartAction(program);
installAccountCommand(program);
installAttachCommand(program);
installConsoleCommand(program);
program.parse(process.argv);
