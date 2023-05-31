import { Address, BN, keccak256, setLengthLeft } from 'ethereumjs-util';
import { StateManager } from '../../../stateManager/stateManager';

export class StorageLoader {
  private readonly stateManager: StateManager; // The state manager
  private readonly address: Address; // The address of the contract

  constructor(stateManager: StateManager, address: Address) {
    this.stateManager = stateManager;
    this.address = address;
  }

  /**
   * Convert an index to a slot index
   * @param index The index to convert
   * @returns The slot index
   */
  static indexToSlotIndex(index: BN): Buffer {
    return setLengthLeft(index.toBuffer(), 32);
  }

  /**
   * get the storage index for a mapping
   * @param slotIndex The slot index of the mapping
   * @param key The key of the mapping
   * @returns The storage index
   */
  public getMappingStorageIndex(slotIndex: Buffer, key: Buffer) {
    return keccak256(Buffer.concat([setLengthLeft(key, 32), slotIndex]));
  }

  /**
   * get the storage index for an array
   * @param slotIndex The slot index of the array
   * @param index The index of the array
   * @param step The step of the element, it can be understood as how many storage slots the element occupies
   * @returns The storage index
   */
  public getArrayStorageIndex(slotIndex: Buffer, index: BN, step: BN = new BN(1)) {
    return setLengthLeft(new BN(keccak256(slotIndex)).add(index.mul(step)).toBuffer(), 32);
  }

  /**
   * get the storage index for a struct
   * @param slotIndex The slot index of the struct
   * @param index The index of the struct
   * @returns The storage index
   */
  public getStructStorageIndex(slotIndex: Buffer, index: BN) {
    return setLengthLeft(new BN(slotIndex).add(index).toBuffer(), 32);
  }

  /**
   * Load the storage slot
   * @param slotIndex The slot index to load
   * @returns The storage slot
   */
  async loadStorageSlot(slotIndex: Buffer): Promise<Buffer> {
    return await this.stateManager.getContractStorage(this.address, slotIndex);
  }

  /**
   * Load the storage slot as a string or bytes
   * @param slotIndex The slot index to load
   * @returns The storage slot as a string
   */
  async loadBytesOrString(slotIndex: Buffer): Promise<Buffer> {
    let storageSlot = await this.stateManager.getContractStorage(this.address, slotIndex);
    if (storageSlot.length === 0) {
      return storageSlot;
    }
    const last = storageSlot[storageSlot.length - 1];
    if (last % 2 === 0) {
      storageSlot = setLengthLeft(storageSlot, 32);
      return storageSlot.slice(0, last / 2);
    } else {
      const tempBufferArray = new Array<Buffer>();
      const len = new BN(storageSlot).subn(1).divn(2);
      const tempMod = len.modrn(32);
      const slotLen = tempMod > 0 ? len.divn(32).addn(1) : len.divn(32);
      const slotHash = keccak256(slotIndex);
      for (let i = new BN(0); i.lt(slotLen); i = i.addn(1)) {
        let tempSlot = setLengthLeft(await this.stateManager.getContractStorage(this.address, new BN(slotHash).iadd(i).toBuffer()), 32);
        if (i.eq(slotLen.subn(1))) {
          tempSlot = tempSlot.slice(0, tempMod);
        }
        tempBufferArray.push(tempSlot);
      }
      return Buffer.concat(tempBufferArray);
    }
  }
}
