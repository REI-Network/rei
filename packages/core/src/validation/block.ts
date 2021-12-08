import { Block } from '@rei-network/structure';

export async function preValidateBlock(this: Block) {
  await this.validateData();
  if (this.uncleHeaders.length > 0) {
    throw this._error('invalid uncle headers');
  }
}
