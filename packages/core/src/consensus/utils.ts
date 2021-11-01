import { Address, BN } from 'ethereumjs-util';
import { PostByzantiumTxReceipt, TxReceipt } from '@gxchain2-ethereumjs/vm/dist/types';
import { Common } from '@gxchain2/common';
import { CLIQUE_EXTRA_VANITY, Receipt, Log } from '@gxchain2/structure';
import { hexStringToBN } from '@gxchain2/utils';

export const EMPTY_HASH = Buffer.alloc(32);
export const EMPTY_ADDRESS = Address.zero();
export const EMPTY_EXTRA_DATA = Buffer.alloc(CLIQUE_EXTRA_VANITY);
export const EMPTY_MIX_HASH = Buffer.alloc(32);
export const EMPTY_NONCE = Buffer.alloc(8);

export function isEmptyAddress(address: Address) {
  return address.equals(EMPTY_ADDRESS);
}

export function isEmptyHash(hash: Buffer) {
  return hash.equals(EMPTY_HASH);
}

export function postByzantiumTxReceiptsToReceipts(receipts: TxReceipt[]) {
  return (receipts as PostByzantiumTxReceipt[]).map(
    (r) =>
      new Receipt(
        r.gasUsed,
        r.bitvector,
        r.logs.map((l) => new Log(l[0], l[1], l[2])),
        r.status
      )
  );
}

export function getGasLimitByCommon(common: Common): BN {
  const limit = common.param('vm', 'gasLimit');
  return hexStringToBN(limit === null ? common.genesis().gasLimit : limit);
}
