import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { BN } from 'ethereumjs-util';
import { Evidence } from '../../../src/consensus/reimint/evidence';
import { EvidenceDatabase } from '../../../src/consensus/reimint/evdb';
import { EvidencePool } from '../../../src/consensus/reimint/evpool';
import { createLevelDB } from '@gxchain2/database';

describe('evpool', () => {
  const evidencedb = createLevelDB(path.join(options.databasePath, 'evidence'));
  const evpool = new EvidencePool();
  before(() => {});

  it('should pop correctly', () => {});
});
