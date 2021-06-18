#!/usr/bin/env node

import process from 'process';
import program from './program';
import { installStartAction } from './start';
import { installAccountCommand } from './account';

installStartAction(program);
installAccountCommand(program);
program.parse(process.argv);
