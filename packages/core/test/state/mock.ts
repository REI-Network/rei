import EventEmitter from 'events';
import { Address, BN, intToBuffer, ecsign } from 'ethereumjs-util';
import { Common } from '@gxchain2/common';
import { BlockHeader, HeaderData, Block, BlockOptions, TypedTransaction } from '@gxchain2/structure';
import { Signer, Config, EvidencePool, StateMachine, StateMachineBackend } from '../../src/consensus/reimint/state';
import { Message, SendMessageOptions, ReimintBlockOptions, Proposal, VoteSet, formatHeaderData, ExtraData, calcBlockHeaderHash, VoteType } from '../../src/consensus/reimint';
import { defaultRound, defaultPOLRound, defaultProposalTimestamp, defaultValidaterSetSize, defaultEvidence } from '../../src/consensus/reimint';
import { Evidence } from '../../src/consensus/reimint/evidence';
import { ProcessBlockOptions } from '../../src';

export const common = Common.createCommonByBlockNumber(1, 'gxc2-testnet');
const num = common.hardforkBlockBN('testnet-hf1')!;
common.setHardforkByBlockNumber(num);

export class MockSigner implements Signer {
  private privKey: Buffer;

  constructor(privKey: Buffer) {
    this.privKey = privKey;
  }

  address(): Address {
    return Address.fromPrivateKey(this.privKey);
  }

  sign(msg: Buffer): Buffer {
    const signature = ecsign(msg, this.privKey);
    return Buffer.concat([signature.r, signature.s, intToBuffer(signature.v - 27)]);
  }
}

export class MockConfig implements Config {
  proposeDuration(round: number) {
    return 300 + 50 * round;
  }

  prevoteDuration(round: number) {
    return 100 + 50 * round;
  }

  precommitDutaion(round: number) {
    return 100 + 50 * round;
  }
}

export class MockEvidencePool extends EventEmitter implements EvidencePool {
  addEvidence(ev: Evidence): Promise<void> {
    this.emit('addEvidence', ev);
    return Promise.resolve();
  }

  pickEvidence(height: BN, count: number): Promise<Evidence[]> {
    return Promise.resolve([]);
  }
}

export class MockBackend extends EventEmitter implements StateMachineBackend {
  readonly signer: MockSigner;

  constructor(signer: MockSigner) {
    super();
    this.signer = signer;
  }

  broadcastMessage(msg: Message, options: SendMessageOptions): void {}

  generateBlockHeaderAndProposal(data?: HeaderData, options?: ReimintBlockOptions): { header: BlockHeader; proposal?: Proposal } {
    const header = BlockHeader.fromHeaderData(data, options);
    data = formatHeaderData(data);

    const round = options?.round ?? defaultRound;
    const POLRound = options?.POLRound ?? defaultPOLRound;
    const timestamp = options?.proposalTimestamp ?? defaultProposalTimestamp;
    const validaterSetSize = options?.validatorSetSize ?? defaultValidaterSetSize;
    const evidence = options?.evidence ?? defaultEvidence;

    // calculate block hash
    const headerHash = calcBlockHeaderHash(header, round, POLRound, []);
    const proposal = new Proposal({
      round,
      POLRound,
      height: header.number,
      type: VoteType.Proposal,
      hash: headerHash,
      timestamp
    });
    proposal.signature = this.signer.sign(proposal.getMessageToSign());
    const extraData = new ExtraData(round, POLRound, evidence, proposal, options?.voteSet);
    return {
      header: BlockHeader.fromHeaderData({ ...data, extraData: Buffer.concat([data.extraData as Buffer, extraData.serialize(validaterSetSize)]) }, options),
      proposal
    };
  }

  generateBlockAndProposal(data?: HeaderData, transactions?: TypedTransaction[], options?: ReimintBlockOptions): { block: Block; proposal?: Proposal } {
    const { header, proposal } = this.generateBlockHeaderAndProposal(data, options);
    return { block: new Block(header, transactions, undefined, options), proposal };
  }

  generateFinalizedBlock(data: HeaderData, transactions: TypedTransaction[], evidence: Evidence[], proposal: Proposal, votes: VoteSet, options?: BlockOptions) {
    const extraData = new ExtraData(proposal.round, proposal.POLRound, evidence, proposal, votes);
    data = formatHeaderData(data);
    const header = BlockHeader.fromHeaderData({ ...data, extraData: Buffer.concat([data.extraData as Buffer, extraData.serialize()]) }, options);
    return new Block(header, transactions, undefined, options);
  }

  processBlock(block: Block, options: ProcessBlockOptions): Promise<boolean> {
    this.emit('processBlock', block);
    return Promise.resolve(true);
  }
}

export type Event<T = any> = {
  name: string;
  arg: T;
};

type Callback<T = any> = {
  resolve: (arg: T) => void;
  reject: (reason?: any) => void;
  timeout: NodeJS.Timeout;
};

export class TestStateMachine {
  readonly signer: MockSigner;
  readonly config: MockConfig;
  readonly evpool: MockEvidencePool;
  readonly backend: MockBackend;
  readonly state: StateMachine;

  private events: Event[] = [];
  private waitting = new Map<string, Callback>();

  constructor(privKey: Buffer) {
    this.config = new MockConfig();
    this.signer = new MockSigner(privKey);
    this.evpool = new MockEvidencePool();
    this.backend = new MockBackend(this.signer);
    const chainId = common.chainIdBN().toNumber();
    this.state = new StateMachine(this.backend, this.evpool, chainId, this.config, this.signer);

    this.listen();
  }

  private listen() {
    const events: [EventEmitter, string][] = [
      [this.evpool, 'addEvidence'],
      [this.backend, 'processBlock']
    ];
    for (const [emitter, name] of events) {
      emitter.on(name, (arg) => {
        this.receivedEvent({
          name,
          arg
        });
      });
    }
  }

  private receivedEvent(event: Event) {
    const cb = this.waitting.get(event.name);
    if (cb) {
      cb.resolve(event.arg);
      clearTimeout(cb.timeout);
      this.waitting.delete(event.name);
    } else {
      this.events.push(event);
    }
  }

  clear() {
    this.events = [];
    for (const [, { reject, timeout }] of this.waitting) {
      reject(new Error('cleared'));
      clearTimeout(timeout);
    }
    this.waitting.clear();
  }

  async ensureEvent<T = any>(name: string, timeout: number = 1000) {
    const event: Event<T> | undefined = this.events.find(({ name: _name }) => _name === name);
    if (event) {
      return event.arg;
    } else {
      if (this.waitting.has(name)) {
        throw new Error('repeat:' + name);
      }
      return new Promise<T>((resolve, reject) => {
        this.waitting.set(name, {
          resolve,
          reject,
          timeout: setTimeout(() => {
            reject(new Error('waitting timeout'));
            this.waitting.delete(name);
          }, timeout)
        });
      });
    }
  }
}

export class TestStateMachineManager {
  private stateMap: Map<number, TestStateMachine>;

  constructor(addresses: Buffer[]) {
    this.stateMap = new Map<number, TestStateMachine>(
      addresses.map((privKey, i) => {
        return [i, new TestStateMachine(privKey)];
      })
    );
  }

  i2b(index: number) {
    const backend = this.stateMap.get(index);
    if (!backend) {
      throw new Error('missing index:' + `${index}`);
    }
    return backend;
  }
}
