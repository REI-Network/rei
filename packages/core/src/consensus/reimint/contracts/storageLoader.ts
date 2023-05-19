import { Address, BN, keccak256, setLengthLeft } from 'ethereumjs-util';
import { StateManager } from '../../../stateManager/stateManager';

class StorageUint256Array {
  private readonly stateManager: StateManager;
  private readonly address: Address;
  private readonly slotBuffer: Buffer;
  private readonly hashSlotBuffer: Buffer;

  constructor(stateManager: StateManager, address: Address, slot: BN) {
    this.stateManager = stateManager;
    this.address = address;
    this.slotBuffer = setLengthLeft(slot.toBuffer(), 32);
    this.hashSlotBuffer = keccak256(this.slotBuffer);
  }

  /**
   * get length of array
   * @returns length of array
   */
  async length(): Promise<BN> {
    return new BN(await this.stateManager.getContractStorage(this.address, this.slotBuffer));
  }

  /**
   * get value from index
   * @param index - the index in array
   * @returns value in that index
   */
  async at(index: BN): Promise<Buffer> {
    return await this.stateManager.getContractStorage(this.address, new BN(this.hashSlotBuffer).add(index).toBuffer());
  }
}

class StorageMap {
  private readonly stateManager: StateManager;
  private readonly address: Address;
  private readonly slotBuffer: Buffer;

  constructor(stateManager: StateManager, address: Address, slot: BN) {
    this.stateManager = stateManager;
    this.address = address;
    this.slotBuffer = setLengthLeft(slot.toBuffer(), 32);
  }

  /**
   * get value from key
   * @param key - the key in map
   * @returns value in that key
   */
  async get(key: Buffer): Promise<Buffer> {
    return await this.stateManager.getContractStorage(this.address, keccak256(Buffer.concat([setLengthLeft(key, 32), this.slotBuffer])));
  }
}

export class StorageLoader {
  private readonly stateManager: StateManager;
  private readonly address: Address;

  constructor(stateManager: StateManager, address: Address) {
    this.stateManager = stateManager;
    this.address = address;
  }

  /**
   * load map from slot
   * @param slot - the slot in contract
   * @returns map in that slot
   */
  loadMap(slot: BN): StorageMap {
    return new StorageMap(this.stateManager, this.address, slot);
  }

  /**
   * load uint256 array from slot
   * @param slot - the slot in contract
   * @returns uint256 array in that slot
   */
  loadUint256Array(slot: BN): StorageUint256Array {
    return new StorageUint256Array(this.stateManager, this.address, slot);
  }

  /**
   * load slot from slot index
   * @param slot - the slot in contract
   * @returns slot in that slot
   */
  async loadStorageSlot(slot: BN): Promise<Buffer> {
    return await this.stateManager.getContractStorage(this.address, setLengthLeft(slot.toBuffer(), 32));
  }

  /**
   * load bytes or string from slot
   * @param slot - the slot in contract
   * @returns Bytes in that slot
   */
  async loadBytesOrString(slot: BN): Promise<Buffer> {
    const slotBuffer = setLengthLeft(slot.toBuffer(), 32);
    const storageSlot = await this.stateManager.getContractStorage(this.address, slotBuffer);
    if (storageSlot[31] % 2 === 0) {
      return storageSlot.slice(0, storageSlot[31] / 2);
    } else {
      const tempBufferArray = new Array<Buffer>();
      const len = new BN(storageSlot).subn(1).divn(2);
      const tempMod = len.modrn(32);
      const slotLen = tempMod > 0 ? len.divn(32).addn(1) : len.divn(32);
      const slotHash = keccak256(slotBuffer);
      for (let i = new BN(0); i.lt(slotLen); i = i.addn(1)) {
        let tempSlot = await this.stateManager.getContractStorage(this.address, new BN(slotHash).iadd(i).toBuffer());
        if (i.eq(slotLen.subn(1))) {
          tempSlot = tempSlot.slice(0, tempMod);
        }
        tempBufferArray.push(tempSlot);
      }
      return Buffer.concat(tempBufferArray);
    }
  }
}
