import * as fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { BN } from 'ethereumjs-util';
import { assert, expect } from 'chai';
import { WAL, WALReader, StateMachineEndHeight, StateMachineMessage, StateMachineMsg, RoundStepType, GetProposalBlockMessage, NewRoundStepMessage } from '../../src/reimint';

const testDir = path.join(__dirname, 'test-dir');
const wal = new WAL({ path: testDir });
// force set head size limit and the duration
(wal as any).group.headSizeLimit = 10;
(wal as any).group.groupCheckDuration = 300;

const clearup = async () => {
  try {
    await fs.access(testDir);
    await fs.rm(testDir, { recursive: true, force: true });
  } catch (err) {
    // ignore all errors
  }
};

const readAndClose = async (reader: WALReader) => {
  const messages: StateMachineMsg[] = [];
  let message: StateMachineMsg | undefined;
  while ((message = await reader.read())) {
    messages.push(message);
  }
  await reader.close();
  return messages;
};

describe('WAL', () => {
  before(async () => {
    await clearup();
    await fs.mkdir(testDir);
  });

  it('should open successfully(1)', async () => {
    await wal.open();
  });

  let randomHash: Buffer;
  it('should write successfully(1)', async () => {
    await wal.write(new StateMachineEndHeight(new BN(100)), true);
    randomHash = crypto.randomBytes(32);
    await wal.write(new StateMachineMessage('peerId1', new GetProposalBlockMessage(randomHash)), true);
  });

  it('should read successfully', async () => {
    const messages = await readAndClose(wal.newReader());
    expect(messages.length).be.equal(2);

    expect(messages[0] instanceof StateMachineEndHeight).be.true;
    expect((messages[0] as StateMachineEndHeight).height.toString()).be.equal('100');

    expect(messages[1] instanceof StateMachineMessage).be.true;
    const message1 = messages[1] as StateMachineMessage;
    expect(message1.peerId).be.equal('peerId1');
    expect(message1.msg instanceof GetProposalBlockMessage).be.true;
    const message1_msg = message1.msg as GetProposalBlockMessage;
    expect(message1_msg.hash.equals(randomHash)).be.true;
  });

  it('should write successfully(2)', async () => {
    await wal.write(new StateMachineEndHeight(new BN(101)), true);
    await wal.write(new StateMachineMessage('peerId2', new NewRoundStepMessage(new BN(101), 10, RoundStepType.NewHeight)));
  });

  it("shouldn't find end height message", async () => {
    const result = await wal.searchForLatestEndHeight();
    expect(result === undefined || !result.height.eq(new BN(102))).be.true;
  });

  const readMessagesAfter101 = async () => {
    const result = await wal.searchForLatestEndHeight();
    expect(result !== undefined).be.true;
    const { reader, height } = result!;
    expect(height.eq(new BN(101))).be.true;

    const messages = await readAndClose(reader!);
    expect(messages.length).be.equal(1);

    expect(messages[0] instanceof StateMachineMessage).be.true;
    const message0 = messages[0] as StateMachineMessage;
    expect(message0.peerId).be.equal('peerId2');
    expect(message0.msg instanceof NewRoundStepMessage).be.true;
    const message0_msg = message0.msg as NewRoundStepMessage;
    expect(message0_msg.height.toString()).be.equal('101');
    expect(message0_msg.round).be.equal(10);
    expect(message0_msg.step).be.equal(RoundStepType.NewHeight);
  };

  it('should find end height message(1)', async () => {
    await readMessagesAfter101();
  });

  it('should close successfully', async () => {
    await new Promise((r) => setTimeout(r, 300 + 10));
    await wal.close();

    const files = await fs.readdir(testDir);
    expect(files.length).be.equal(2);
    expect(files[0]).be.equal('WAL');
    expect(files[1]).be.equal('WAL.000');
  });

  it('should open successfully(2)', async () => {
    await wal.open();
  });

  it('should find end height message(2)', async () => {
    await readMessagesAfter101();
  });

  it('should close successfully(2)', async () => {
    await wal.close();

    // destroy WAL content
    await fs.writeFile(path.join(testDir, 'WAL'), '01234');
    await fs.writeFile(path.join(testDir, 'WAL.000'), '56789');
  });

  it('should open successfully(3)', async () => {
    await wal.open();
  });

  it('should read failed', async () => {
    const reader = wal.newReader();
    try {
      await readAndClose(reader);
      assert.fail('should failed');
    } catch (err) {
    } finally {
      await reader.close();
    }
  });

  it('should clear successfully', async () => {
    await wal.clear();

    const files = await fs.readdir(testDir);
    expect(files.length).be.equal(0);
  });

  after(async () => {
    await clearup();
  });
});
