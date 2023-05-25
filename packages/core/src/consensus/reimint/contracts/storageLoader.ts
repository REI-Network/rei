import { Address, BN, keccak256, setLengthLeft } from 'ethereumjs-util';
import { StateManager } from '../../../stateManager/stateManager';

export class StorageLoader {
  private readonly stateManager: StateManager;
  private readonly address: Address;

  constructor(stateManager: StateManager, address: Address) {
    this.stateManager = stateManager;
    this.address = address;
  }

  static indexToSlotIndex(index: BN): Buffer {
    return setLengthLeft(index.toBuffer(), 32);
  }

  public getMappingStorageIndex(slotIndex: Buffer, key: Buffer) {
    return keccak256(Buffer.concat([setLengthLeft(key, 32), slotIndex]));
  }

  public getArrayStorageIndex(slotIndex: Buffer, index: BN) {
    return setLengthLeft(new BN(keccak256(slotIndex)).add(index).toBuffer(), 32);
  }

  public getStructStorageIndex(slotIndex: Buffer, index: BN) {
    return setLengthLeft(new BN(slotIndex).add(index).toBuffer(), 32);
  }

  async loadStorageSlot(slotIndex: Buffer): Promise<Buffer> {
    return await this.stateManager.getContractStorage(this.address, slotIndex);
  }

  async loadBytesOrString(slotIndex: Buffer): Promise<Buffer> {
    const storageSlot = await this.stateManager.getContractStorage(this.address, slotIndex);
    if (storageSlot[31] % 2 === 0) {
      return storageSlot.slice(0, storageSlot[31] / 2);
    } else {
      const tempBufferArray = new Array<Buffer>();
      const len = new BN(storageSlot).subn(1).divn(2);
      const tempMod = len.modrn(32);
      const slotLen = tempMod > 0 ? len.divn(32).addn(1) : len.divn(32);
      const slotHash = keccak256(slotIndex);
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
