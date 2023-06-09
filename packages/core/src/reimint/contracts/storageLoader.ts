import { Address, BN, bufferToHex, keccak256, setLengthLeft } from 'ethereumjs-util';
import { AbiCoder } from '@ethersproject/abi';
import { StateManager } from '../../stateManager/stateManager';

const coder = new AbiCoder();

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
   * Get the storage index for a mapping
   * @param slotIndex The slot index of the mapping
   * @param key The key of the mapping
   * @returns The storage index
   */
  static getMappingStorageIndex(slotIndex: Buffer, key: Buffer) {
    return keccak256(Buffer.concat([setLengthLeft(key, 32), slotIndex]));
  }

  /**
   * Get the storage index for an array
   * @param slotIndex The slot index of the array
   * @param index The index of the array
   * @param step The step of the element, it can be understood as how many storage slots the element occupies
   * @returns The storage index
   */
  static getArrayStorageIndex(slotIndex: Buffer, index: BN, step: BN = new BN(1)) {
    return setLengthLeft(new BN(keccak256(slotIndex)).add(index.mul(step)).toBuffer(), 32);
  }

  /**
   * Get the storage index for a struct
   * @param slotIndex The slot index of the struct
   * @param index The index of the struct
   * @returns The storage index
   */
  static getStructStorageIndex(slotIndex: Buffer, index: BN) {
    return setLengthLeft(new BN(slotIndex).add(index).toBuffer(), 32);
  }

  /**
   * Load the storage slot
   * @param slotIndex The slot index to load
   * @returns The storage slot
   */
  async loadStorageSlot(slotIndex: Buffer): Promise<Buffer> {
    return setLengthLeft(await this.stateManager.getContractStorage(this.address, slotIndex), 32);
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

  /**
   * Decode the storage slot to the corresponding type
   * @param slotStorage The storage slot to decode
   * @param type The type to decode
   * @returns The decoded value
   */
  static decode(slotStorage: Buffer, type: string) {
    if (slotStorage.length !== 32) {
      throw new Error('slotStorage length is not 32');
    }
    switch (type) {
      case 'bytes32':
        return slotStorage;
      case 'address':
        return bufferToHex(slotStorage.slice(12, 32));
      case 'bool':
        return Boolean(slotStorage.slice(31, 32)[0]);
      case 'uint8':
      case 'uint16':
      case 'uint32':
      case 'uint64':
      case 'uint128':
      case 'uint256':
        return new BN(slotStorage);
      case 'int8':
      case 'int16':
      case 'int32':
      case 'int64':
      case 'int128':
      case 'int256':
        return new BN(coder.decode(['int256'], slotStorage)[0].toString());
      default:
        throw new Error('unknown type: ' + type);
    }
  }
}
